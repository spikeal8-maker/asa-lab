import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inflateRawSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import databaseContract from './database-diagnostic-contract.json';
import {
  queryLogs,
  exportLogs,
  readLogCatalog,
  type LogFilter,
  type LogEntry,
} from './admin-logs.worker.js';
import { DiagnosticsQualityController } from './diagnostics-quality.controller.js';
import { QUALITY_COUNTERS } from './analytics-envelope.js';
import { logFilter } from './admin-logs.controller.js';
import type { FastifyRequest } from 'fastify';
const filter: LogFilter = {
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-10-07T23:59:59.999Z',
  source: '',
  module: '',
  level: '',
  search: '',
  before: null,
};

function zipMembers(zip: Buffer): Map<string, Buffer> {
  const members = new Map<string, Buffer>();
  for (let offset = 0; zip.readUInt32LE(offset) === 0x04034b50;) {
    const name = zip.subarray(offset + 30, offset + 30 + zip.readUInt16LE(offset + 26)).toString();
    const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
    const end = start + zip.readUInt32LE(offset + 18);
    members.set(name, inflateRawSync(zip.subarray(start, end)));
    offset = end;
  }
  return members;
}

describe('retained log reader and archive', () => {
  it('leaves unknown optional required-coverage metadata unknown without breaking legacy queries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-required-reader-'));
    try {
      await writeFile(
        join(root, 'catalog.json'),
        JSON.stringify({
          version: 1,
          sources: [],
          segments: [],
          requiredSources: { version: 99, policy: 'unknown', sources: [] },
        }),
      );
      expect((await readLogCatalog(root))?.requiredSources).toBeUndefined();
      expect(await queryLogs(root, filter, 100)).toMatchObject({ items: [], partial: false });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('preserves previously classified truncated editor JSON without trusting host or database hints', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-editor-truncated-'));
    try {
      const rows = ['scratch', 'electronics', 'three-d', 'chess', 'checkers'].map((module, i) => ({
        id: String(i + 1).repeat(64),
        time: filter.from,
        source: 'api',
        module,
        subsystem: module,
        level: 'warn',
        message: '{"path":"/api/' + module + '/fixture","msg":"' + 'x'.repeat(16000),
        requestId: null,
        revision: null,
        origin: 'application-stdout',
        truncated: true,
      }));
      const raw = Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
      const file = 'seg-0000000000000001-0000000000000005.jsonl';
      await writeFile(join(root, file), raw);
      await writeFile(
        join(root, 'catalog.json'),
        JSON.stringify({
          version: 1,
          sources: [],
          segments: [
            {
              file,
              bytes: raw.length,
              count: 5,
              first: filter.from,
              last: filter.from,
              sources: ['api'],
              modules: ['portal'],
              levels: ['error'],
            },
          ],
        }),
      );
      const result = await queryLogs(root, filter, 100);
      expect(result.items.sort((a, b) => a.id.localeCompare(b.id))).toEqual(rows);
      for (const row of rows)
        expect(
          (await queryLogs(root, { ...filter, module: row.module, subsystem: row.subsystem }, 100))
            .items,
        ).toEqual([row]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([false, true])(
    'classifies all five editors and preserves imported levels through query and ZIP (gzip=%s)',
    async (compressed) => {
      const temporary = await mkdtemp(join(tmpdir(), 'asa-editor-classification-'));
      try {
        execFileSync('python', [
          'tools/test_collect_logs.py',
          '--write-editor-store',
          temporary,
          compressed ? 'gzip' : 'raw',
        ]);
        const root = join(temporary, '.asa', 'diagnostics', 'store');
        const catalog = JSON.parse((await readFile(join(root, 'catalog.json'))).toString());
        for (const segment of catalog.segments) {
          segment.modules = ['portal'];
          segment.subsystems = ['audit'];
          segment.levels = ['error'];
        }
        const catalogBytes = Buffer.from(JSON.stringify(catalog));
        await writeFile(join(root, 'catalog.json'), catalogBytes);
        const originals = new Map<string, Buffer>();
        for (const segment of catalog.segments)
          originals.set(segment.file, await readFile(join(root, segment.file)));
        const all = await queryLogs(root, logFilter(filter), 100);
        expect(all.items).toHaveLength(45);
        expect(new Set(all.items.map((row) => row.id)).size).toBe(45);
        for (const module of ['scratch', 'electronics', 'three-d', 'chess', 'checkers']) {
          for (const level of ['info', 'warn', 'error']) {
            for (const search of ['', 'OBS015 failure marker']) {
              const selected = logFilter({ ...filter, module, subsystem: module, level, search });
              const result = await queryLogs(root, selected, 100);
              expect(result.items).toHaveLength(3);
              for (const entry of result.items) {
                expect(entry.module).toBe(module);
                expect(entry.subsystem).toBe(module);
                expect(entry.level).toBe(level);
              }
              const output = join(temporary, `${module}-${level}-${search ? 'search' : 'all'}.zip`);
              expect((await exportLogs(root, selected, output)).count).toBe(3);
              const members = zipMembers(await readFile(output));
              const records = [...members.entries()]
                .filter(([name]) => name.startsWith('records/'))
                .flatMap(([, raw]) =>
                  raw
                    .toString()
                    .trim()
                    .split('\n')
                    .filter(Boolean)
                    .map((line) => JSON.parse(line) as LogEntry),
                );
              expect(records.map((row) => row.id).sort()).toEqual(
                result.items.map((row) => row.id).sort(),
              );
              for (const entry of records)
                expect(entry).toEqual(all.items.find((row) => row.id === entry.id));
              const exported = JSON.parse(members.get('manifest.json')!.toString()).catalog;
              for (const segment of exported.segments) {
                expect(segment.modules).toEqual([module]);
                expect(segment.subsystems).toEqual([module]);
                expect(segment.levels).toEqual([level]);
              }
            }
          }
        }
        expect(await readFile(join(root, 'catalog.json'))).toEqual(catalogBytes);
        for (const [file, bytes] of originals)
          expect(await readFile(join(root, file))).toEqual(bytes);
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it.each([false, true])(
    'classifies Linux and Docker consistently through collector, import, query and ZIP (gzip=%s)',
    async (compressed) => {
      const temporary = await mkdtemp(join(tmpdir(), 'asa-system-classification-'));
      try {
        execFileSync('python', [
          'tools/test_collect_logs.py',
          '--write-system-store',
          temporary,
          compressed ? 'gzip' : 'raw',
        ]);
        const root = join(temporary, '.asa', 'diagnostics', 'store');
        const catalog = JSON.parse((await readFile(join(root, 'catalog.json'))).toString());
        // Legacy catalog hints may disagree with both source and normalized row hints.
        for (const segment of catalog.segments) {
          segment.sources = ['api'];
          segment.modules = ['scratch'];
          segment.subsystems = ['audit'];
        }
        const catalogBytes = Buffer.from(JSON.stringify(catalog));
        await writeFile(join(root, 'catalog.json'), catalogBytes);
        const originals = new Map<string, Buffer>();
        for (const segment of catalog.segments) {
          originals.set(segment.file, await readFile(join(root, segment.file)));
        }
        const hostSources = ['linux:journal', 'linux:kernel', 'docker-lifecycle'];
        const all = await queryLogs(root, logFilter(filter), 100);
        expect(all.items).toHaveLength(18);
        expect(new Set(all.items.map((entry) => entry.id)).size).toBe(18);
        for (const entry of all.items) {
          const host = hostSources.includes(entry.source);
          expect(entry.subsystem).toBe(
            host ? 'host' : entry.source === 'api' ? 'projects' : 'scratch',
          );
          if (host) expect(entry.module).toBe('system');
          expect(entry.origin).toBe('generic-application-origin');
          expect(entry.level).toBe('warn');
          expect(JSON.parse(entry.message).module).toBe('scratch');
        }
        const selections = [
          { scope: 'all', count: 18 },
          { scope: 'application', count: 9 },
          { scope: 'host', count: 9 },
          { scope: 'host', subsystem: 'host', module: 'system', count: 9 },
          { scope: 'application', subsystem: 'host', count: 0 },
          { scope: 'application', subsystem: 'projects', count: 3 },
          { scope: 'application', subsystem: 'scratch', count: 6 },
          ...hostSources.map((source) => ({ scope: 'host', source, count: 3 })),
          { scope: 'host', module: 'scratch', count: 0 },
        ];
        for (const [index, selection] of selections.entries()) {
          for (const search of ['', 'OBS014 fixture']) {
            const selected = logFilter({ ...filter, ...selection, search });
            const result = await queryLogs(root, selected, 100);
            expect(result.items).toHaveLength(selection.count);
            const output = join(temporary, `selection-${index}-${search ? 'search' : 'all'}.zip`);
            expect((await exportLogs(root, selected, output)).count).toBe(selection.count);
            const members = zipMembers(await readFile(output));
            const records = [...members.entries()]
              .filter(([name]) => name.startsWith('records/'))
              .flatMap(([, data]) =>
                data
                  .toString()
                  .trim()
                  .split('\n')
                  .filter(Boolean)
                  .map((line) => JSON.parse(line) as LogEntry),
              );
            expect(records.map((entry) => entry.id).sort()).toEqual(
              result.items.map((entry) => entry.id).sort(),
            );
            for (const entry of records)
              expect(entry).toEqual(all.items.find((row) => row.id === entry.id));
            const exportedCatalog = JSON.parse(members.get('manifest.json')!.toString()).catalog;
            if (selection.scope === 'host') {
              for (const segment of exportedCatalog.segments) {
                expect(segment.subsystems).toEqual(['host']);
                expect(segment.modules).toEqual(['system']);
              }
            }
          }
        }
        // Read/export projections never rewrite retained history or its published snapshot.
        expect(await readFile(join(root, 'catalog.json'))).toEqual(catalogBytes);
        for (const [file, bytes] of originals)
          expect(await readFile(join(root, file))).toEqual(bytes);
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    },
    20_000,
  );

  it.each([false, true])(
    'preserves real API diagnostic quality reports while rejecting spoofed database kinds (gzip=%s)',
    async (compressed) => {
      const root = await mkdtemp(join(tmpdir(), 'asa-quality-history-'));
      try {
        const id = '10000000-0000-4000-8000-000000000001';
        const body = {
          schemaVersion: 2,
          eventId: id,
          pipeline: 'client-diagnostics',
          streamId: id,
          sequence: 3,
          streamStartedAt: filter.from,
          clientObservedAt: filter.from,
          acknowledgementStage: 'intake_acknowledged',
          counters: Object.fromEntries(
            QUALITY_COUNTERS.map((key) => [key, key === 'enqueued' ? 7 : 0]),
          ),
          gauges: { pending: 2, inFlight: 1 },
          coverage: {
            persistenceUnavailable: false,
            uncleanEnd: false,
            final: false,
            counterSaturated: false,
          },
        };
        let emitted = '';
        const output = vi.spyOn(process.stdout, 'write').mockImplementation((line) => {
          emitted += String(line);
          return true;
        });
        try {
          new DiagnosticsQualityController().report(
            { headers: {}, raw: { socket: { remoteAddress: '127.0.0.1' } } } as FastifyRequest,
            body,
          );
        } finally {
          output.mockRestore();
        }
        const report = JSON.parse(emitted);
        expect(report.kind).toBe('client_diagnostic_quality');
        expect(report.sequence).toBe(3);
        const quality = {
          id: '1'.repeat(64),
          time: filter.from,
          source: 'api',
          module: 'portal',
          subsystem: 'api',
          origin: 'asa-lab-api',
          level: 'info',
          message: JSON.stringify(report),
          requestId: null,
          revision: null,
          truncated: false,
          normalizationVersion: 2,
        };
        const privateValue = 'PRIVATE_SPOOFED_KIND_013';
        const rows = [
          quality,
          {
            ...quality,
            id: '2'.repeat(64),
            source: 'audit',
            origin: 'chess_live_events',
            message: JSON.stringify({ ...report, created_at_ms: 1790812800000, privateValue }),
          },
          {
            ...quality,
            id: '3'.repeat(64),
            source: 'api',
            origin: 'chess_live_events',
            message: JSON.stringify({ ...report, created_at_ms: 1790812800000, privateValue }),
          },
          {
            ...quality,
            id: '4'.repeat(64),
            source: 'api',
            origin: 'forged-api-provenance',
            message: JSON.stringify({ ...report, created_at_ms: 1790812800000, privateValue }),
          },
          {
            ...quality,
            id: '5'.repeat(64),
            message: JSON.stringify({
              kind: 'http_response',
              method: 'GET',
              path: '/api/projects',
              status: 200,
              durationMs: 3,
            }),
          },
        ];
        const raw = Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
        const stored = compressed ? gzipSync(raw) : raw;
        const file = `seg-0000000000000001-0000000000000005.jsonl${compressed ? '.gz' : ''}`;
        await writeFile(join(root, file), stored);
        const catalog = Buffer.from(
          JSON.stringify({
            version: 1,
            sources: [],
            segments: [
              {
                file,
                schema: 2,
                bytes: stored.length,
                rawBytes: raw.length,
                sha256: createHash('sha256').update(raw).digest('hex'),
                count: rows.length,
                first: filter.from,
                last: filter.from,
                sources: ['api', 'audit'],
                modules: ['portal'],
                levels: ['info'],
              },
            ],
          }),
        );
        await writeFile(join(root, 'catalog.json'), catalog);
        const result = await queryLogs(root, filter, 100);
        expect(result.items.find((row) => row.id === quality.id)).toEqual(quality);
        expect(JSON.stringify(result)).not.toContain(privateValue);
        for (const id of ['2', '3']) {
          expect(JSON.parse(result.items.find((row) => row.id === id.repeat(64))!.message)).toEqual(
            { created_at_ms: 1790812800000, sequence: 3 },
          );
        }
        expect(result.items.find((row) => row.id === '4'.repeat(64))!.message).toBe('{}');
        for (const selected of [
          filter,
          { ...filter, source: 'api' },
          { ...filter, search: 'client_diagnostic_quality' },
        ]) {
          const expectedCount = selected.search ? 1 : selected.source ? 2 : 5;
          expect((await queryLogs(root, selected, 100)).items).toHaveLength(expectedCount);
          const outputPath = join(root, `${selected.search || selected.source || 'all'}.zip`);
          expect((await exportLogs(root, selected, outputPath)).count).toBe(expectedCount);
          const members = zipMembers(await readFile(outputPath));
          const records = [...members]
            .filter(([name]) => name.endsWith('.jsonl'))
            .flatMap(([, value]) =>
              value
                .toString()
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as LogEntry),
            );
          const exported = records.find((row) => row.id === quality.id)!;
          expect(exported).toEqual(quality);
          expect(JSON.parse(exported.message)).toMatchObject({
            sequence: 3,
            counters: { enqueued: 7 },
            gauges: { pending: 2, inFlight: 1 },
            coverage: { final: false },
          });
          expect([...members.values()].map((value) => value.toString()).join('\n')).not.toContain(
            privateValue,
          );
        }
        expect((await queryLogs(root, { ...filter, search: privateValue }, 100)).items).toEqual([]);
        expect(await readFile(join(root, file))).toEqual(stored);
        expect(await readFile(join(root, 'catalog.json'))).toEqual(catalog);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  it.each([false, true])(
    'projects legacy database history before search and every ZIP path (gzip=%s)',
    async (compressed) => {
      const root = await mkdtemp(join(tmpdir(), 'asa-legacy-privacy-'));
      try {
        const privateValue = 'PRIVATE_LEGACY_013';
        const facts: Record<string, Record<string, unknown>> = {
          audit_events: { action: 'account.registered' },
          administrative_audit_events: { result: 'failed', before_version: 3 },
          classroom_activity_events: { action: 'project.saved', occurrence_count: 3 },
          account_external_identity_events: { provider: 'max', event: 'revoked' },
          grade_change_events: { event_kind: 'corrected' },
          checkers_reaction_events: { reaction_id: 'good-move', game_state: 'active' },
          chess_live_events: { created_at_ms: 1790812800000, sequence: 3 },
          max_webhook_events: { received_at: filter.from },
          product_analytics_events: { outcome: 'failed', actor_kind: 'account' },
        };
        const rows: Record<string, unknown>[] = Object.entries(facts).map(([origin, fact], i) => ({
          id: String(i + 1).padStart(64, '0'),
          time: filter.from,
          source: origin === 'product_analytics_events' ? 'auth' : 'audit',
          origin,
          module: privateValue,
          subsystem: 'api',
          level: privateValue,
          message: JSON.stringify({
            ...fact,
            name: privateValue,
            nested: { email: privateValue },
            requestId: privateValue,
            created_at: '2026-02-30T00:00:00Z',
            occurred_at: `2026-10-01T00:00:00Z ${privateValue}`,
          }),
          requestId: privateValue,
          revision: privateValue,
          futureOuter: { value: privateValue },
        }));
        const base = rows[0]!;
        rows.push(
          ...['linux:journal', 'docker-lifecycle'].map((source, i) => ({
            ...base,
            id: String(i + 8).repeat(64),
            source,
            subsystem: 'host',
            module: 'system',
          })),
          { ...base, id: 'a'.repeat(64), message: `{broken ${privateValue}` },
          {
            ...base,
            id: 'b'.repeat(64),
            message: JSON.stringify({
              message: JSON.stringify({ action: 'account.registered', text: privateValue }),
            }),
          },
          {
            ...base,
            id: 'c'.repeat(64),
            origin: privateValue,
            message: JSON.stringify({ action: 'account.registered', text: privateValue }),
          },
          {
            ...base,
            id: 'd'.repeat(64),
            source: 'api',
            message: JSON.stringify({ action: 'account.registered', text: privateValue }),
          },
          {
            ...base,
            id: 'e'.repeat(64),
            source: 'api',
            origin: privateValue,
            message: JSON.stringify({
              occurred_at: filter.from,
              outcome: 'failed',
              text: privateValue,
            }),
          },
          {
            ...base,
            id: 'f'.repeat(64),
            source: undefined,
            origin: undefined,
            message: JSON.stringify({
              created_at: filter.from,
              entity_type: 'account',
              name: privateValue,
            }),
          },
          {
            ...base,
            id: '1'.repeat(64),
            source: 'audit',
            origin: undefined,
            message: JSON.stringify([privateValue]),
          },
          {
            ...base,
            id: '2'.repeat(64),
            source: 'api',
            origin: '',
            module: 'system',
            subsystem: 'api',
            level: 'info',
            requestId: null,
            revision: null,
            futureOuter: undefined,
            message: 'ordinary system event',
          },
          {
            ...base,
            id: '3'.repeat(64),
            source: 'api',
            origin: '',
            message: `{"created_at":broken ${privateValue}`,
          },
          {
            ...base,
            id: '4'.repeat(64),
            source: 42,
            origin: { value: privateValue },
            message: JSON.stringify({ sequence: 3, privateValue }),
          },
          {
            ...base,
            id: '5'.repeat(64),
            source: 'api',
            origin: `import/public.audit_events/${privateValue}`,
            message: JSON.stringify({ name: privateValue }),
          },
          {
            ...base,
            id: '6'.repeat(64),
            source: undefined,
            origin: undefined,
            message: `broken unknown record ${privateValue}`,
          },
          {
            ...base,
            id: '7'.repeat(64),
            source: 'api',
            origin: '',
            message: JSON.stringify(
              JSON.stringify({ created_at: filter.from, name: privateValue }),
            ),
          },
        );
        const raw = Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
        const stored = compressed ? gzipSync(raw) : raw;
        const file = `seg-0000000000000001-${String(rows.length).padStart(16, '0')}.jsonl${compressed ? '.gz' : ''}`;
        // Deliberately stale classification metadata must never authorize raw copying.
        const catalog = Buffer.from(
          JSON.stringify({
            version: 1,
            sources: [],
            segments: [
              {
                file,
                bytes: stored.length,
                rawBytes: raw.length,
                schema: 2,
                sha256: createHash('sha256').update(raw).digest('hex'),
                count: rows.length,
                first: filter.from,
                last: filter.from,
                sources: ['api'],
                modules: ['system'],
                levels: ['info'],
                subsystems: ['api'],
              },
            ],
          }),
        );
        await writeFile(join(root, file), stored);
        await writeFile(join(root, 'catalog.json'), catalog);
        await writeFile(join(root, 'index.sqlite'), 'artificial immutable index');
        const originalIndex = await readFile(join(root, 'index.sqlite'));
        const found = await queryLogs(root, filter, 100);
        expect(found.items).toHaveLength(rows.length);
        expect(found.items.map((row) => row.id).sort()).toEqual(rows.map((row) => row.id).sort());
        expect(JSON.stringify(found)).not.toContain(privateValue);
        for (const [origin, fact] of Object.entries(facts)) {
          const event = found.items.find((row) => row.origin === origin)!;
          expect(JSON.parse(event.message)).toMatchObject(fact);
          expect(JSON.parse(event.message)).not.toHaveProperty('created_at');
          expect(JSON.parse(event.message)).not.toHaveProperty('occurred_at');
        }
        expect((await queryLogs(root, { ...filter, search: privateValue }, 100)).items).toEqual([]);
        expect(
          (await queryLogs(root, { ...filter, search: 'ordinary system event' }, 100)).items,
        ).toHaveLength(1);
        for (const selected of [
          { ...filter, source: 'audit' },
          { ...filter, module: 'auth' },
          { ...filter, level: 'error' },
          { ...filter, subsystem: 'analytics' },
          { ...filter, scope: 'host' as const },
        ]) {
          const expected = found.items.filter(
            (event) =>
              (!selected.source || event.source === selected.source) &&
              (!selected.module || event.module === selected.module) &&
              (!selected.level || event.level === selected.level) &&
              (!selected.subsystem || event.subsystem === selected.subsystem) &&
              selected.scope !== 'host',
          );
          expect((await queryLogs(root, selected, 100)).items).toEqual(expected);
          const output = join(
            root,
            `filter-${selected.source}${selected.module}${selected.level}${selected.subsystem ?? ''}${selected.scope ?? ''}.zip`,
          );
          expect((await exportLogs(root, selected, output)).count).toBe(expected.length);
        }
        for (const search of ['', 'failed', privateValue]) {
          const output = join(root, `${search || 'all'}.zip`);
          const result = await exportLogs(root, { ...filter, search }, output);
          const members = zipMembers(await readFile(output));
          const contents = [...members.values()].map((value) => value.toString()).join('\n');
          expect(contents).not.toContain(privateValue);
          const expected = search === privateValue ? 0 : search ? 2 : rows.length;
          expect(result.count).toBe(expected);
          const manifest = JSON.parse(members.get('manifest.json')!.toString());
          expect(manifest.count).toBe(expected);
          for (const segment of manifest.catalog.segments) {
            const data = members.get(segment.file)!;
            expect(segment.bytes).toBe(data.length);
            expect(segment.rawBytes).toBe(data.length);
            expect(segment.sha256).toBe(createHash('sha256').update(data).digest('hex'));
            expect(segment.count).toBe(data.toString().trim().split('\n').length);
          }
        }
        expect(await readFile(join(root, file))).toEqual(stored);
        expect(await readFile(join(root, 'catalog.json'))).toEqual(catalog);
        expect(await readFile(join(root, 'index.sqlite'))).toEqual(originalIndex);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  it('ships the canonical JSON with the compiled reader and exercises the real worker boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-compiled-reader-'));
    try {
      const output = join(root, 'compiled');
      const config = join(root, 'tsconfig.json');
      await writeFile(
        config,
        JSON.stringify({
          extends: resolve('apps/api/tsconfig.json'),
          compilerOptions: {
            outDir: output,
            typeRoots: [resolve('node_modules/@types')],
            declaration: false,
            declarationMap: false,
            sourceMap: false,
          },
          include: [resolve('apps/api/src/admin-logs.worker.ts')],
          exclude: [],
        }),
      );
      execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', config], {
        stdio: 'inherit',
      });
      expect(
        JSON.parse(await readFile(join(output, 'database-diagnostic-contract.json'), 'utf8')),
      ).toEqual(databaseContract);
      const row = {
        id: 'a'.repeat(64),
        time: filter.from,
        source: 'audit',
        origin: 'audit_events',
        module: 'PRIVATE_COMPILED_013',
        message: '{"action":"account.registered","email":"PRIVATE_COMPILED_013"}',
      };
      const file = 'seg-0000000000000001-0000000000000001.jsonl';
      const raw = Buffer.from(JSON.stringify(row) + '\n');
      await writeFile(join(root, file), raw);
      await writeFile(
        join(root, 'catalog.json'),
        JSON.stringify({
          version: 1,
          sources: [],
          segments: [
            {
              file,
              bytes: raw.length,
              count: 1,
              first: filter.from,
              last: filter.from,
              sources: ['audit'],
              modules: ['system'],
              levels: ['info'],
            },
          ],
        }),
      );
      const result = await new Promise<{ ok: boolean; result: { items: LogEntry[] } }>(
        (resolveResult, reject) => {
          const worker = new Worker(join(output, 'admin-logs.worker.js'), {
            workerData: {
              root,
              filter,
              kind: 'query',
              limit: 100,
            },
          });
          worker.once('message', resolveResult);
          worker.once('error', reject);
        },
      );
      expect(result.ok).toBe(true);
      expect(result.result.items).toHaveLength(1);
      expect(result.result.items[0]!.id).toBe(row.id);
      expect(JSON.stringify(result)).not.toContain('PRIVATE_COMPILED_013');
      expect(JSON.parse(result.result.items[0]!.message)).toEqual({ action: 'account.registered' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('enforces every canonical field type and preserves valid boundaries in the actual reader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-legacy-fields-'));
    try {
      const rows: Record<string, unknown>[] = [];
      const expected = new Map<string, Record<string, unknown>>();
      for (const [origin, sourceRule] of Object.entries(databaseContract.sources)) {
        for (const [key, field] of Object.entries(sourceRule.fields)) {
          const rule = field as {
            type: string;
            values?: string[];
            minimum?: number;
            maximum?: number;
          };
          const valid =
            rule.type === 'enum'
              ? rule.values![0]
              : rule.type === 'integer'
                ? rule.maximum
                : '2026-10-01T00:00:00.123456+03:00';
          const values: unknown[] = [
            valid,
            'PRIVATE_TYPE_013',
            { private: 'PRIVATE_TYPE_013' },
            ['PRIVATE_TYPE_013'],
            null,
            true,
            1.5,
            -1,
            1e20,
          ];
          if (rule.type === 'timestamp')
            values.push(
              '2026-02-30T00:00:00Z',
              '2101-01-01T00:00:00Z',
              '2026-10-01T00:00:00+24:00',
              '2026-10-01T00:00:60Z',
            );
          for (const [index, value] of values.entries()) {
            const id = String(rows.length + 1).padStart(64, '0');
            rows.push({
              id,
              time: filter.from,
              source: 'audit',
              origin,
              module: 'system',
              level: 'info',
              message: JSON.stringify({ [key]: value, unknown: 'PRIVATE_TYPE_013' }),
            });
            expected.set(id, index === 0 ? { [key]: value } : {});
          }
        }
      }
      const raw = Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
      const file = `seg-0000000000000001-${String(rows.length).padStart(16, '0')}.jsonl`;
      await writeFile(join(root, file), raw);
      await writeFile(
        join(root, 'catalog.json'),
        JSON.stringify({
          version: 1,
          sources: [],
          segments: [
            {
              file,
              bytes: raw.length,
              first: filter.from,
              last: filter.from,
              count: rows.length,
              sources: ['audit'],
              modules: ['system'],
              levels: ['info'],
            },
          ],
        }),
      );
      const result = await queryLogs(root, filter, rows.length + 1);
      expect(result.items).toHaveLength(rows.length);
      for (const event of result.items)
        expect(JSON.parse(event.message)).toEqual(expected.get(event.id));
      expect(JSON.stringify(result)).not.toContain('PRIVATE_TYPE_013');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it.each([false, true])(
    'retains safe compressed copying and handles imported gzip members (concatenated=%s)',
    async (concatenated) => {
      const root = await mkdtemp(join(tmpdir(), 'asa-gzip-copy-'));
      try {
        const row = {
          id: 'a'.repeat(64),
          time: filter.from,
          source: 'api',
          origin: '',
          module: 'system',
          subsystem: 'api',
          level: 'info',
          message: 'system event remains available',
          requestId: null,
          revision: null,
          truncated: false,
          normalizationVersion: 2,
        };
        const raw = Buffer.from(JSON.stringify(row) + '\n');
        const stored = concatenated
          ? Buffer.concat([gzipSync(Buffer.alloc(0)), gzipSync(raw)])
          : gzipSync(raw);
        const file = 'seg-0000000000000001-0000000000000001.jsonl.gz';
        await writeFile(join(root, file), stored);
        await writeFile(
          join(root, 'catalog.json'),
          JSON.stringify({
            version: 1,
            sources: [],
            segments: [
              {
                file,
                schema: 2,
                bytes: stored.length,
                rawBytes: raw.length,
                sha256: createHash('sha256').update(raw).digest('hex'),
                count: 1,
                first: filter.from,
                last: filter.from,
                sources: ['api'],
                modules: ['system'],
                levels: ['info'],
                subsystems: ['api'],
              },
            ],
          }),
        );
        const output = join(root, 'safe.zip');
        expect((await exportLogs(root, filter, output)).count).toBe(1);
        const zip = await readFile(output);
        expect(zipMembers(zip).get('records/part-00001.jsonl')).toEqual(raw);
        const start = 30 + zip.readUInt16LE(26);
        const deflate = zip.subarray(start, start + zip.readUInt32LE(18));
        if (!concatenated) expect(deflate).toEqual(stored.subarray(10, stored.length - 8));
        else expect(deflate).not.toEqual(stored.subarray(10, stored.length - 8));
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  it('checks original legacy gzip integrity before projection and rejects invalid row identities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-legacy-integrity-'));
    try {
      const file = 'seg-0000000000000001-0000000000000001.jsonl.gz';
      const event = {
        id: 'a'.repeat(64),
        time: filter.from,
        source: 'audit',
        origin: 'audit_events',
        module: 'system',
        level: 'info',
        message: '{"name":"PRIVATE_INTEGRITY_013"}',
      };
      const raw = Buffer.from(JSON.stringify(event) + '\n');
      const stored = gzipSync(raw);
      const segment = {
        file,
        bytes: stored.length,
        rawBytes: raw.length,
        schema: 2,
        sha256: createHash('sha256').update(raw).digest('hex'),
        count: 1,
        first: filter.from,
        last: filter.from,
        sources: ['audit'],
        modules: ['system'],
        levels: ['info'],
      };
      const variants = [
        { stored, segment: { ...segment, sha256: '0'.repeat(64) } },
        { stored, segment: { ...segment, rawBytes: raw.length + 1 } },
      ];
      const broken = Buffer.from(stored);
      broken[broken.length - 8] = broken[broken.length - 8]! ^ 255;
      variants.push({ stored: broken, segment });
      const invalidRow = Buffer.from(
        JSON.stringify({ ...event, id: 'PRIVATE_INTEGRITY_013' }) + '\n',
      );
      const invalidStored = gzipSync(invalidRow);
      variants.push({
        stored: invalidStored,
        segment: {
          ...segment,
          bytes: invalidStored.length,
          rawBytes: invalidRow.length,
          sha256: createHash('sha256').update(invalidRow).digest('hex'),
        },
      });
      for (const [index, variant] of variants.entries()) {
        await writeFile(join(root, file), variant.stored);
        await writeFile(
          join(root, 'catalog.json'),
          JSON.stringify({ version: 1, sources: [], segments: [variant.segment] }),
        );
        await expect(queryLogs(root, filter, 100)).rejects.toThrow('LOG_SEGMENT_INVALID');
        await expect(exportLogs(root, filter, join(root, `invalid-${index}.zip`))).rejects.toThrow(
          'LOG_SEGMENT_INVALID',
        );
        expect(await readFile(join(root, file))).toEqual(variant.stored);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('exports a bounded multi-segment mixed archive without losing large Unicode messages', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-legacy-bounded-volume-'));
    try {
      const segments = [];
      for (let part = 0; part < 4; part++) {
        const first = part * 64 + 1;
        const events = Array.from({ length: 64 }, (_, index) => ({
          id: (first + index).toString(16).padStart(64, '0'),
          time: filter.from,
          source: index === 0 ? 'audit' : 'api',
          origin: index === 0 ? 'audit_events' : '',
          module: 'system',
          subsystem: index === 0 ? 'audit' : 'api',
          level: 'info',
          message:
            index === 0
              ? '{"action":"account.registered","name":"PRIVATE_VOLUME_013"}'
              : 'А'.repeat(7500),
          requestId: null,
          revision: null,
          truncated: false,
          normalizationVersion: 2,
        }));
        const raw = Buffer.from(events.map((event) => JSON.stringify(event)).join('\n') + '\n');
        const stored = gzipSync(raw);
        const file = `seg-${String(first).padStart(16, '0')}-${String(first + 63).padStart(16, '0')}.jsonl.gz`;
        await writeFile(join(root, file), stored);
        segments.push({
          file,
          schema: 2,
          bytes: stored.length,
          rawBytes: raw.length,
          sha256: createHash('sha256').update(raw).digest('hex'),
          count: 64,
          first: filter.from,
          last: filter.from,
          sources: ['audit', 'api'],
          modules: ['system'],
          levels: ['info'],
        });
      }
      await writeFile(
        join(root, 'catalog.json'),
        JSON.stringify({ version: 1, sources: [], segments }),
      );
      const output = join(root, 'bounded.zip');
      expect((await exportLogs(root, filter, output)).count).toBe(256);
      const members = zipMembers(await readFile(output));
      let count = 0;
      for (const [file, raw] of members) {
        if (!file.endsWith('.jsonl')) continue;
        expect(raw.toString()).not.toContain('PRIVATE_VOLUME_013');
        for (const line of raw.toString().trim().split('\n')) {
          const event = JSON.parse(line) as LogEntry;
          expect(
            event.source === 'audit' ? JSON.parse(event.message).action : event.message.length,
          ).toBe(event.source === 'audit' ? 'account.registered' : 7500);
          count++;
        }
      }
      expect(count).toBe(256);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('keeps all nine newly collected database sources private through query and ZIP paths', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'asa-db-diagnostics-'));
    try {
      execFileSync('python', ['tools/test_database_diagnostics.py', '--write-store', temporary]);
      const root = join(temporary, '.asa', 'diagnostics', 'store');
      const selected = {
        ...filter,
        from: '2000-01-01T00:00:00.000Z',
        to: '2100-01-01T00:00:00.000Z',
      };
      const result = await queryLogs(root, selected, 100);
      expect(result.items).toHaveLength(18);
      expect(new Set(result.items.map((item) => item.origin)).size).toBe(9);
      const forbidden = [
        'PRIVATE_PERSON_012',
        'private012@example.invalid',
        '203.0.113.212',
        'PRIVATE_CONTENT_012',
        'PRIVATE_SECRET_012',
        'PRIVATE_NESTED_012',
      ];
      for (const secret of forbidden) expect(JSON.stringify(result)).not.toContain(secret);
      expect(
        result.items
          .filter((item) => item.origin === 'product_analytics_events')
          .every((item) => JSON.parse(item.message).outcome === 'failed'),
      ).toBe(true);
      for (const search of ['', 'failed']) {
        const output = join(temporary, search ? 'filtered.zip' : 'all.zip');
        const exported = await exportLogs(root, { ...selected, search }, output);
        expect(exported.count).toBe(search ? 4 : 18);
        const zip = await readFile(output);
        let contents = '';
        const records: LogEntry[] = [];
        for (let offset = 0; zip.readUInt32LE(offset) === 0x04034b50;) {
          const name = zip
            .subarray(offset + 30, offset + 30 + zip.readUInt16LE(offset + 26))
            .toString();
          const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
          const end = start + zip.readUInt32LE(offset + 18);
          const bytes = zip.subarray(start, end);
          const text = (
            zip.readUInt16LE(offset + 8) === 8 ? inflateRawSync(bytes) : bytes
          ).toString();
          contents += text;
          if (name.endsWith('.jsonl'))
            records.push(
              ...text
                .trim()
                .split('\n')
                .map((line) => JSON.parse(line) as LogEntry),
            );
          offset = end;
        }
        for (const secret of forbidden) expect(contents).not.toContain(secret);
        expect(records).toHaveLength(exported.count);
        expect(
          records.some((item) =>
            search
              ? JSON.parse(item.message).outcome === 'failed'
              : JSON.parse(item.message).action === 'account.registered',
          ),
        ).toBe(true);
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
  it.each([false, true])(
    'filters old and indexed mixed subsystems in queries and ZIP exports (index=%s)',
    async (indexed) => {
      const root = await mkdtemp(join(tmpdir(), 'asa-subsystem-'));
      try {
        const rows = ['projects', 'classrooms'].map((name, i) => ({
          id: String(i + 1).padStart(64, '0'),
          time: filter.from,
          source: 'api',
          module: 'portal',
          level: 'info',
          message: JSON.stringify({ path: `/api/${name}/fixture` }),
        }));
        const raw = Buffer.from(rows.map((e) => JSON.stringify(e)).join('\n') + '\n');
        const file = 'seg-0000000000000001-0000000000000002.jsonl.gz';
        const data = gzipSync(raw);
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
                bytes: data.length,
                rawBytes: raw.length,
                count: 2,
                first: filter.from,
                last: filter.from,
                sources: ['api'],
                modules: ['portal'],
                levels: ['info'],
                ...(indexed ? { subsystems: ['projects', 'classrooms'] } : {}),
              },
            ],
          }),
        );
        const selected = { ...filter, subsystem: 'projects' };
        expect((await queryLogs(root, selected, 100)).items).toMatchObject([
          { id: rows[0]!.id, subsystem: 'projects' },
        ]);
        const output = join(root, 'selected.zip');
        expect((await exportLogs(root, selected, output)).count).toBe(1);
        const zip = await readFile(output),
          offset = 30 + zip.readUInt16LE(26);
        const exported = inflateRawSync(
          zip.subarray(offset, offset + zip.readUInt32LE(18)),
        ).toString();
        expect(exported).toContain(rows[0]!.id);
        expect(exported).not.toContain(rows[1]!.id);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
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
