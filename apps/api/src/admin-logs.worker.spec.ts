import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inflateRawSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { queryLogs, exportLogs, type LogFilter } from './admin-logs.worker.js';
const filter: LogFilter = {
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-10-07T23:59:59.999Z',
  source: '',
  module: '',
  level: '',
  search: '',
  before: null,
};

describe('retained log reader and archive', () => {
  it('respects application scope in whole-segment exports of mixed historical segments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-logs-scope-'));
    try {
      const rows = ['api', 'windows:System'].map((source, i) => ({
        id: String(i + 1).padStart(64, '0'),
        time: filter.from,
        source,
        module: 'system',
        level: 'info',
        message: 'fixture',
      }));
      const raw = Buffer.from(rows.map((e) => JSON.stringify(e)).join('\n') + '\n'),
        data = gzipSync(raw);
      const file = 'seg-0000000000000001-0000000000000002.jsonl.gz';
      await writeFile(join(root, file), data);
      await writeFile(
        join(root, 'catalog.json'),
        JSON.stringify({
          version: 1,
          sources: [],
          segments: [
            {
              file,
              schema: 2,
              sha256: createHash('sha256').update(raw).digest('hex'),
              rawBytes: raw.length,
              bytes: data.length,
              count: 2,
              first: filter.from,
              last: filter.from,
              sources: rows.map((e) => e.source),
              modules: ['system'],
              levels: ['info'],
            },
          ],
        }),
      );
      const scoped = { ...filter, scope: 'application' as const };
      expect((await queryLogs(root, scoped, 100)).items.map((e) => e.source)).toEqual(['api']);
      expect((await exportLogs(root, scoped, join(root, 'scope.zip'))).count).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('continues a rare search beyond 200,000 rows on the same snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-logs-search-'));
    try {
      const segments = [];
      for (let i = 0; i < 201; i++) {
        const first = i * 1000 + 1,
          last = first + 999;
        const rows = Array.from({ length: 1000 }, (_, n) => ({
          id: (first + n).toString(16).padStart(64, '0'),
          time: filter.from,
          source: 'api',
          module: 'portal',
          level: 'error',
          message: i === 200 && n === 999 ? 'rare failure' : 'ordinary',
        }));
        const data = gzipSync(rows.map((e) => JSON.stringify(e)).join('\n') + '\n');
        const file = `seg-${String(first).padStart(16, '0')}-${String(last).padStart(16, '0')}.jsonl.gz`;
        await writeFile(join(root, file), data);
        segments.push({
          file,
          bytes: data.length,
          count: 1000,
          first: filter.from,
          last: filter.from,
          sources: ['api'],
          modules: ['portal'],
          levels: ['error'],
        });
      }
      await writeFile(
        join(root, 'catalog.json'),
        JSON.stringify({ version: 1, sources: [], segments }),
      );
      const first = await queryLogs(root, { ...filter, search: 'rare failure' }, 100);
      expect(first).toMatchObject({ items: [], partial: true, scanned: 200000 });
      expect(first.scanState).toBeDefined();
      // A collector publication cannot change the search's captured frontier.
      await writeFile(
        join(root, 'catalog.json'),
        JSON.stringify({ version: 1, sources: [], segments: [] }),
      );
      const last = await queryLogs(
        root,
        { ...filter, search: 'rare failure' },
        100,
        first.scanState,
      );
      expect(last.partial).toBe(false);
      expect(last.scanned).toBe(201000);
      expect(last.items.map((e) => e.message)).toEqual(['rare failure']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
  it('exports more than the old 256 MiB limit from compressed segments without losing rows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-logs-large-'));
    try {
      const segments = [];
      let rawBytes = 0;
      for (let n = 0; n < 300; n += 1) {
        const first = n * 64 + 1,
          last = first + 63;
        const events = Array.from({ length: 64 }, (_, i) => ({
          id: (first + i).toString(16).padStart(64, '0'),
          time: '2026-10-03T12:00:00.000Z',
          source: 'api',
          module: 'portal',
          level: 'info',
          message: 'А'.repeat(7500),
          requestId: null,
          revision: null,
          origin: '',
          truncated: false,
        }));
        const raw = Buffer.from(events.map((e) => JSON.stringify(e)).join('\n') + '\n');
        const stored = gzipSync(raw);
        const file = `seg-${String(first).padStart(16, '0')}-${String(last).padStart(16, '0')}.jsonl.gz`;
        await writeFile(join(root, file), stored);
        rawBytes += raw.length;
        segments.push({
          file,
          schema: 2,
          sha256: createHash('sha256').update(raw).digest('hex'),
          rawBytes: raw.length,
          bytes: stored.length,
          count: events.length,
          first: events[0]!.time,
          last: events[0]!.time,
          sources: ['api'],
          modules: ['portal'],
          levels: ['info'],
        });
      }
      await writeFile(
        join(root, 'catalog.json'),
        JSON.stringify({ version: 1, sources: [], segments }),
      );
      expect(rawBytes).toBeGreaterThan(256 * 1024 * 1024);
      const output = join(root, 'all.zip');
      const result = await exportLogs(root, filter, output);
      expect(result.count).toBe(19200);
      // Extract every ZIP local entry independently. Reused gzip deflate streams
      // must decode to ordinary JSONL, including the first and last occurrences.
      const archive = await readFile(output);
      let offset = 0,
        rows = 0;
      const identities = new Set<string>();
      while (archive.readUInt32LE(offset) === 0x04034b50) {
        const size = archive.readUInt32LE(offset + 18);
        const nameSize = archive.readUInt16LE(offset + 26);
        const name = archive.subarray(offset + 30, offset + 30 + nameSize).toString();
        const dataOffset = offset + 30 + nameSize;
        const raw = inflateRawSync(archive.subarray(dataOffset, dataOffset + size));
        if (name.endsWith('.jsonl'))
          for (const line of raw.toString().trimEnd().split('\n')) {
            rows += 1;
            identities.add((JSON.parse(line) as { id: string }).id);
          }
        offset = dataOffset + size;
      }
      expect(rows).toBe(result.count);
      expect(identities.size).toBe(rows);
      expect(archive.readUInt32LE(offset)).toBe(0x02014b50);
      const page = await queryLogs(root, filter, 100);
      expect(page.items).toHaveLength(100);
      expect((await queryLogs(root, { ...filter, level: 'error' }, 100)).items).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60000);

  it('rejects corrupted gzip, mismatched checksums, overlapping ranges and retired snapshots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-logs-corrupt-'));
    try {
      const file = 'seg-0000000000000001-0000000000000001.jsonl.gz';
      const event = {
        id: 'a'.repeat(64),
        time: filter.from,
        source: 'api',
        module: 'system',
        level: 'info',
        message: 'ok',
      };
      const raw = Buffer.from(JSON.stringify(event) + '\n'),
        stored = gzipSync(raw);
      const segment = {
        file,
        bytes: stored.length,
        rawBytes: raw.length,
        schema: 2,
        sha256: '0'.repeat(64),
        count: 1,
        first: filter.from,
        last: filter.from,
        sources: ['api'],
        modules: ['system'],
        levels: ['info'],
      };
      await writeFile(join(root, file), stored);
      const catalog = { version: 1, sources: [], segments: [segment] };
      await writeFile(join(root, 'catalog.json'), JSON.stringify(catalog));
      await expect(queryLogs(root, filter, 100)).rejects.toThrow('LOG_SEGMENT_INVALID');
      segment.sha256 = createHash('sha256').update(raw).digest('hex');
      await writeFile(
        join(root, 'catalog.json'),
        JSON.stringify({ ...catalog, segments: [segment, segment] }),
      );
      await expect(exportLogs(root, filter, join(root, 'overlap.zip'))).rejects.toThrow(
        'LOG_CATALOG_INVALID',
      );
      await writeFile(join(root, 'catalog.json'), JSON.stringify(catalog));
      const broken = Buffer.from(stored);
      broken[broken.length - 8] = broken[broken.length - 8]! ^ 255;
      await writeFile(join(root, file), broken);
      await expect(queryLogs(root, filter, 100)).rejects.toThrow('LOG_SEGMENT_INVALID');
      await rm(join(root, file));
      await expect(queryLogs(root, filter, 100)).rejects.toThrow('LOG_SNAPSHOT_CHANGED');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('orders interleaved segments, paginates without loss, filters and produces a readable ZIP', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-logs-'));
    try {
      const events = [1, 3, 2].map((n) => ({
        id: n.toString(16).padStart(64, '0'),
        time: `2026-10-0${n}T12:00:00.000Z`,
        source: 'api',
        module: n === 2 ? 'electronics' : 'scratch',
        level: n === 1 ? 'info' : 'error',
        message: `Сообщение ${n}`,
        requestId: null,
        revision: null,
        origin: '',
        truncated: false,
      }));
      const segments = [];
      for (let n = 0; n < events.length; n++) {
        const event = events[n]!;
        const file = `seg-${String(n + 1).padStart(16, '0')}-${String(n + 1).padStart(16, '0')}.jsonl`;
        const data = JSON.stringify(event) + '\n';
        await writeFile(join(root, file), data);
        segments.push({
          file,
          bytes: Buffer.byteLength(data),
          count: 1,
          first: event.time,
          last: event.time,
          sources: ['api'],
          modules: [event.module],
          levels: [event.level],
        });
      }
      await writeFile(
        join(root, 'catalog.json'),
        JSON.stringify({
          version: 1,
          collectedAt: new Date().toISOString(),
          sources: [],
          segments,
        }),
      );
      const page = await queryLogs(root, filter, 2);
      expect(page.items.map((e) => e.message)).toEqual(['Сообщение 3', 'Сообщение 2']);
      expect(
        (await queryLogs(root, { ...filter, before: page.next }, 2)).items.map((e) => e.message),
      ).toEqual(['Сообщение 1']);
      expect((await queryLogs(root, { ...filter, module: 'electronics' }, 100)).items).toHaveLength(
        1,
      );
      const unicodeFile = segments[0]!.file;
      const unicodeData = JSON.stringify({ ...events[0], message: '🔥'.repeat(16384) }) + '\n';
      await writeFile(join(root, unicodeFile), unicodeData);
      segments[0]!.bytes = Buffer.byteLength(unicodeData);
      await writeFile(
        join(root, 'catalog.json'),
        JSON.stringify({
          version: 1,
          collectedAt: new Date().toISOString(),
          sources: [],
          segments,
        }),
      );
      expect((await queryLogs(root, filter, 100)).items).toHaveLength(3);
      const output = join(root, 'test.zip');
      expect((await exportLogs(root, filter, output)).count).toBe(3);
      const zip = await readFile(output);
      expect(zip.readUInt32LE()).toBe(0x04034b50);
      const compressedSize = zip.readUInt32LE(18),
        nameLength = zip.readUInt16LE(26);
      const first = inflateRawSync(
        zip.subarray(30 + nameLength, 30 + nameLength + compressedSize),
      ).toString();
      expect(first.split('\n').filter(Boolean)).toHaveLength(3);
      expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
      await expect(exportLogs(root, filter, output)).rejects.toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('fails closed on catalog path traversal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-logs-'));
    try {
      await writeFile(
        join(root, 'catalog.json'),
        JSON.stringify({
          version: 1,
          sources: [],
          segments: [
            {
              file: '../secret',
              first: filter.from,
              last: filter.to,
              sources: ['api'],
              modules: ['scratch'],
              levels: ['error'],
            },
          ],
        }),
      );
      await expect(queryLogs(root, filter, 100)).rejects.toThrow('LOG_SEGMENT_INVALID');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
