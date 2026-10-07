import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inflateRawSync } from 'node:zlib';
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
