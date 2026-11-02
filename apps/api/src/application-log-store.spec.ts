import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ApplicationLogStore } from './application-log-store.js';
import { AdminLogsService } from './admin-logs.service.js';
import {
  queryLogs,
  readLogCatalog,
  MAX_LOG_CATALOG_BYTES,
  type LogFilter,
} from './admin-logs.worker.js';

const filter: LogFilter = {
  from: '2026-01-01T00:00:00.000Z',
  to: '2099-01-01T00:00:00.000Z',
  scope: 'application',
  source: '',
  module: '',
  level: '',
  search: '',
  before: null,
};
function event(code: string) {
  return JSON.stringify({
    kind: 'server_error',
    time: new Date().toISOString(),
    level: 'error',
    path: '/api/electronics/fixture?secret=private',
    module: 'electronics',
    errorCode: code,
    password: 'never-retain',
    content: 'private-message',
    runtime: { token: 'never-retain', rssBytes: 1234 },
  });
}

describe('application-owned logging without host services', () => {
  it('persists accepted HTTP 429 correlation through the real controller emit and native reader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-native-429-'));
    let store: ApplicationLogStore | undefined;
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      vi.resetModules();
      vi.stubEnv('ASA_APPLICATION_LOG_STORE', root);
      const { applicationLogStore } = await import('./application-log-store.js');
      const { ClientDiagnosticsController } = await import('./client-diagnostics.controller.js');
      const controller = new ClientDiagnosticsController();
      store = applicationLogStore()!;
      const request = {
        id: '10000000-0000-4000-8000-000000000001',
        ip: '127.0.0.1',
        raw: { socket: { remoteAddress: '127.0.0.1' } },
        headers: {},
      } as unknown as Parameters<typeof controller.report>[0];
      const body = {
        code: 'request_failed',
        module: 'electronics',
        revision: 'abcdef0',
        phase: 'request',
        method: 'PUT',
        httpStatus: 429,
        relatedRequestId: '20000000-0000-4000-8000-000000000002',
        operation: 'electronics_draft_write',
        failureKind: 'http',
        clientAttemptId: '30000000-0000-4000-8000-000000000003',
      };
      expect(() =>
        controller.report(request, { ...body, url: 'PRIVATE', prompt: 'PRIVATE' }),
      ).toThrow();
      expect(store.counters.accepted).toBe(0);
      expect(controller.report(request, body)).toEqual({ accepted: true });
      await store.close();
      const result = await queryLogs(
        root,
        { ...filter, source: 'api', module: 'electronics' },
        100,
      );
      expect(result.items).toHaveLength(1);
      expect(JSON.parse(result.items[0]!.message)).toMatchObject({
        kind: 'client_diagnostic',
        level: 'error',
        requestId: request.id,
        untrustedClientReport: true,
        httpStatus: 429,
        relatedRequestId: body.relatedRequestId,
        operation: body.operation,
        failureKind: 'http',
        clientAttemptId: body.clientAttemptId,
      });
      expect(result.items[0]!.message).not.toContain('PRIVATE');
      expect(store.counters).toMatchObject({ accepted: 1, persisted: 1, dropped: 0, failures: 0 });
    } finally {
      await store?.close();
      output.mockRestore();
      vi.unstubAllEnvs();
      vi.resetModules();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rechecks closed client request fields at the writer boundary without expanding other producers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-native-request-context-'));
    const store = new ApplicationLogStore(root);
    const invalid = [
      { httpStatus: 99 },
      { httpStatus: 600 },
      { httpStatus: 429.5 },
      { httpStatus: '429' },
      { httpStatus: null },
      { httpStatus: { text: 'PRIVATE' } },
      { relatedRequestId: 'PRIVATE' },
      { relatedRequestId: ['10000000-0000-4000-8000-000000000001'] },
      { operation: 'https://PRIVATE?token=PRIVATE' },
      { operation: ['project_save'] },
      { failureKind: 'PRIVATE' },
      { failureKind: { message: 'PRIVATE' } },
    ];
    try {
      for (const detail of invalid)
        store.enqueue(
          JSON.stringify({
            kind: 'client_diagnostic',
            time: new Date().toISOString(),
            module: 'portal',
            code: 'request_failed',
            ...detail,
            url: 'PRIVATE',
            prompt: 'PRIVATE',
            responseBody: 'PRIVATE',
          }),
        );
      store.enqueue(
        JSON.stringify({
          kind: 'server_error',
          module: 'portal',
          httpStatus: 429,
          relatedRequestId: '10000000-0000-4000-8000-000000000001',
          operation: 'other_api',
          failureKind: 'http',
        }),
      );
      await store.close();
      const result = await queryLogs(root, filter, 100);
      expect(result.items).toHaveLength(invalid.length + 1);
      for (const row of result.items) {
        const body = JSON.parse(row.message);
        for (const field of ['httpStatus', 'relatedRequestId', 'operation', 'failureKind'])
          expect(body).not.toHaveProperty(field);
        expect(row.message).not.toMatch(/PRIVATE|responseBody/);
      }
      expect(store.counters.dropped).toBe(0);
    } finally {
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not mark a healthy idle application writer stale or rewrite its evidence timestamp', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-native-idle-'));
    const store = new ApplicationLogStore(root);
    try {
      store.enqueue(event('quiet'));
      await store.flush();
      const catalog = await readFile(join(root, 'catalog.json'), 'utf8');
      const actualNow = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(actualNow + 600000);
      const service = new AdminLogsService(
        join(root, 'absent'),
        join(root, 'exports'),
        () => store,
      );
      expect(await service.status()).toMatchObject({ state: 'ok', hostCollection: 'unavailable' });
      expect(await readFile(join(root, 'catalog.json'), 'utf8')).toBe(catalog);
      clock.mockRestore();
    } finally {
      vi.restoreAllMocks();
      await store.close();
      await rm(root, { recursive: true, force: true });
    }
  });
  it('persists, reads and reopens application failures without an OS collector and strips private fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-native-logs-'));
    try {
      const store = new ApplicationLogStore(root);
      store.enqueue(event('fixture_one'));
      await store.close();
      const first = await queryLogs(root, filter, 100);
      expect(first.items).toHaveLength(1);
      expect(first.items[0]).toMatchObject({
        module: 'electronics',
        level: 'error',
        source: 'api',
      });
      expect(first.items[0]!.message).not.toContain('never-retain');
      expect(first.items[0]!.message).not.toContain('private-message');
      expect(first.items[0]!.message).not.toContain('?secret');
      const restarted = new ApplicationLogStore(root);
      restarted.enqueue(event('fixture_two'));
      await restarted.close();
      const next = await queryLogs(root, filter, 100);
      expect(next.items).toHaveLength(2);
      expect(new Set(next.items.map((row) => row.id)).size).toBe(2);
      const service = new AdminLogsService(
        join(root, 'absent-host'),
        join(root, 'exports'),
        () => restarted,
      );
      const status = await service.status();
      expect(status).toMatchObject({
        state: 'ok',
        applicationCollection: 'embedded',
        hostCollection: 'unavailable',
        coverageComplete: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('bounds a burst, reports dropped evidence, and detects retained segment corruption', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-native-bounds-'));
    try {
      const store = new ApplicationLogStore(root, 128 * 1024 * 1024, 2);
      store.enqueue(event('a'));
      store.enqueue(event('b'));
      store.enqueue(event('c'));
      await store.close();
      expect(store.counters).toMatchObject({ accepted: 2, persisted: 2, dropped: 1 });
      expect(JSON.parse(await readFile(join(root, 'collector-health.json'), 'utf8')).state).toBe(
        'error',
      );
      const catalog = await readLogCatalog(root);
      await writeFile(join(root, catalog!.segments[0]!.file), 'bad');
      await expect(queryLogs(root, filter, 100)).rejects.toThrow('LOG_SEGMENT_INVALID');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects oversized events before buffering and exposes incomplete all-scope fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-native-coverage-'));
    try {
      const store = new ApplicationLogStore(root);
      store.enqueue(JSON.stringify({ kind: 'server_error', frames: ['x'.repeat(300000)] }));
      store.enqueue(event('available'));
      await store.flush();
      expect(store.counters).toMatchObject({ accepted: 1, dropped: 1, persisted: 1 });
      const service = new AdminLogsService(
        join(root, 'absent'),
        join(root, 'exports'),
        () => store,
      );
      const worker = vi
        .spyOn(
          service as unknown as {
            worker(...args: unknown[]): Promise<unknown>;
          },
          'worker',
        )
        .mockResolvedValue({ items: [], next: null, partial: false, scanned: 0 });
      expect(await service.query({ ...filter, scope: 'all' })).toMatchObject({
        coverage: { complete: false, host: 'not_included' },
      });
      const exported = await service.createExport('owner', { ...filter, scope: 'all' });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(await service.exportStatus('owner', exported.id)).toMatchObject({ state: 'failed' });
      worker.mockRestore();
      await store.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('never overwrites a corrupt existing catalog and does not throw into application requests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-native-corrupt-'));
    try {
      await writeFile(join(root, 'catalog.json'), 'corrupt');
      const store = new ApplicationLogStore(root);
      store.enqueue(event('a'));
      await expect(store.close()).resolves.toBeUndefined();
      expect(store.counters.failures).toBe(1);
      expect(await readFile(join(root, 'catalog.json'), 'utf8')).toBe('corrupt');
      expect(JSON.parse(await readFile(join(root, 'collector-health.json'), 'utf8')).state).toBe(
        'error',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts a valid catalog above the old 16 MiB cutoff and retains an explicit upper bound', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-native-catalog-'));
    try {
      const path = join(root, 'catalog.json');
      await writeFile(
        path,
        JSON.stringify({ version: 1, sources: [], segments: [] }) + ' '.repeat(17 * 1024 * 1024),
      );
      expect(await readLogCatalog(root)).toMatchObject({ version: 1, segments: [] });
      await truncate(path, MAX_LOG_CATALOG_BYTES + 1);
      await expect(readLogCatalog(root)).rejects.toThrow('LOG_CATALOG_INVALID');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('commits a bounded snapshot under continuous arrivals and never counts a failed catalog as persisted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-native-commit-'));
    try {
      const store = new ApplicationLogStore(root);
      const io = store as unknown as { atomic(name: string, text: string): Promise<void> };
      const original = io.atomic.bind(store);
      let arriving = true;
      const hook = vi.spyOn(io, 'atomic').mockImplementation(async (name, text) => {
        if (arriving && name.startsWith('seg-')) store.enqueue(event('arrived-during-write'));
        return original(name, text);
      });
      store.enqueue(event('first'));
      await store.flush();
      expect((await queryLogs(root, filter, 100)).items).toHaveLength(1);
      expect(store.counters.persisted).toBe(1);
      arriving = false;
      hook.mockImplementation(async (name, text) => {
        if (name === 'catalog.json') throw new Error('simulated disk commit failure');
        return original(name, text);
      });
      await store.flush();
      expect(store.counters).toMatchObject({ persisted: 1, dropped: 1, failures: 1 });
      expect((await queryLogs(root, filter, 100)).items).toHaveLength(1);
      hook.mockRestore();
      await store.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps rotation bounded and preserves the retained catalog through restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-native-retain-'));
    try {
      const store = new ApplicationLogStore(root, 4096);
      for (let i = 0; i < 33; i++) store.enqueue(event(`record_${i}`));
      await store.close();
      expect(await readLogCatalog(root)).toMatchObject({ trimmed: true });
      const before = await queryLogs(root, filter, 100);
      expect(before.items).toHaveLength(1);
      const resumed = new ApplicationLogStore(root, 4096);
      resumed.enqueue(event('after_restart'));
      await resumed.close();
      const after = await queryLogs(root, filter, 100);
      expect(after.items).toHaveLength(2);
      expect(after.items.map((row) => row.id)).toContain(before.items[0]!.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
