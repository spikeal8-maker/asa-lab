import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { workers, inputs } = vi.hoisted(() => ({
  workers: [] as EventEmitter[],
  inputs: [] as { filter: unknown }[],
}));
vi.mock('node:worker_threads', () => ({
  parentPort: null,
  workerData: null,
  Worker: class extends EventEmitter {
    constructor(_file: string, options: { workerData: { filter: unknown } }) {
      super();
      inputs.push(options.workerData);
      workers.push(this);
    }
    terminate() {
      return Promise.resolve(0);
    }
  },
}));
import { AdminLogsService } from './admin-logs.service.js';
const filter = {
  from: '2026-10-01T00:00:00.000Z',
  to: '2026-10-07T23:59:59.999Z',
  source: '',
  module: '',
  level: '',
  search: '',
  before: null,
};
function emitWorker(offset: number, message: unknown): void {
  const worker = workers.at(offset);
  if (!worker) throw new Error('Fixture worker absent');
  worker.emit('message', message);
}
afterEach(() => {
  inputs.length = 0;
  for (const worker of workers.splice(0)) worker.emit('message', { ok: false });
});
describe('bounded archive jobs', () => {
  it('freezes effective default dates across continuation requests', async () => {
    const service = new AdminLogsService('fixture', 'fixture');
    const first = service.query(filter, 'owner', '', { from: true, to: true });
    emitWorker(-1, {
      ok: true,
      result: {
        items: [],
        next: null,
        partial: true,
        scanned: 200000,
        scanState: {
          catalog: { version: 1, sources: [], segments: [] },
          offset: 1,
          matches: [],
          scanned: 200000,
        },
      },
    });
    const page = (await first) as { scanCursor: string };
    const resumed = service.query(
      { ...filter, from: '2026-10-02T00:00:01.000Z', to: '2026-10-08T00:00:01.000Z' },
      'owner',
      page.scanCursor,
      { from: true, to: true },
    );
    emitWorker(-1, {
      ok: true,
      result: { items: [], next: null, partial: false, scanned: 200001 },
    });
    expect(inputs.at(-1)?.filter).toEqual(filter);
    expect(await resumed).toMatchObject({ partial: false, scanCursor: null });
  });
  it('resumes searches only for the same owner/filter, reserves capacity, and hides private snapshots', async () => {
    const service = new AdminLogsService('fixture', 'fixture');
    const first = service.query(filter, 'owner');
    const second = service.query(filter, 'owner');
    await expect(service.query(filter, 'owner')).rejects.toThrow('LOG_BUSY');
    const state = {
      catalog: { version: 1, segments: [], sources: [] },
      offset: 1,
      matches: [],
      scanned: 200000,
    };
    emitWorker(-2, {
      ok: true,
      result: { items: [], next: null, partial: true, scanned: 200000, scanState: state },
    });
    emitWorker(-1, { ok: true, result: { items: [], next: null, partial: false, scanned: 0 } });
    const page = (await first) as { scanCursor: string; scanState?: unknown };
    await second;
    expect(page.scanCursor).toMatch(/^[a-f0-9-]{36}$/);
    expect(page.scanState).toBeUndefined();
    await expect(service.query(filter, 'other', page.scanCursor)).rejects.toThrow('LOG_NOT_FOUND');
    await expect(
      service.query({ ...filter, search: 'changed' }, 'owner', page.scanCursor),
    ).rejects.toThrow('LOG_NOT_FOUND');
    const continuation = service.query(filter, 'owner', page.scanCursor);
    await expect(service.query(filter, 'owner', page.scanCursor)).rejects.toThrow('LOG_BUSY');
    emitWorker(-1, {
      ok: true,
      result: { items: [], next: null, partial: false, scanned: 200001 },
    });
    expect(await continuation).toMatchObject({ partial: false, scanCursor: null });
    await expect(service.query(filter, 'owner', page.scanCursor)).rejects.toThrow('LOG_NOT_FOUND');
  });
  it('shows a collector failure even when the catalog is fresh', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-log-health-'));
    try {
      await writeFile(
        join(root, 'catalog.json'),
        JSON.stringify({
          version: 1,
          collectedAt: new Date().toISOString(),
          sources: [],
          segments: [],
          bytes: 0,
        }),
      );
      await writeFile(
        join(root, 'collector-health.json'),
        JSON.stringify({
          version: 1,
          state: 'error',
          checkedAt: new Date().toISOString(),
          detail: 'fixture interruption',
        }),
      );
      expect(await new AdminLogsService(root, root).status()).toMatchObject({
        state: 'error',
        collectorHealth: { state: 'error' },
      });
      await rm(join(root, 'catalog.json'));
      expect(await new AdminLogsService(root, root).status()).toMatchObject({
        state: 'unavailable',
        collectorHealth: { state: 'error' },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it.each([
    ['LOG_EXPORT_TOO_LARGE', 'Архив превышает допустимый объём. Выберите меньший период.'],
    ['LOG_SEGMENT_INVALID', 'Обнаружен повреждённый файл журнала. Требуется проверка сборщика.'],
    ['LOG_SNAPSHOT_CHANGED', 'Журналы обновились во время сборки. Повторите сбор архива.'],
    ['password=private-value', 'Не удалось собрать архив. Повторите позже.'],
  ])('reports a safe actionable export failure for %s', async (code, message) => {
    const root = await mkdtemp(join(tmpdir(), 'asa-log-job-'));
    try {
      const service = new AdminLogsService(root, root);
      const job = await service.createExport('owner', filter);
      emitWorker(-1, { ok: false, error: code });
      await vi.waitFor(async () =>
        expect((await service.exportStatus('owner', job.id)).error).toBe(message),
      );
      await expect(service.download('owner', job.id)).rejects.toThrow('LOG_NOT_FOUND');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('reserves concurrent exports atomically and denies another owner access', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-log-job-'));
    try {
      const service = new AdminLogsService(root, root);
      const results = await Promise.allSettled([
        service.createExport('owner', filter),
        service.createExport('owner', filter),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      const job = (
        results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ id: string }>
      ).value;
      await expect(service.exportStatus('other', job.id)).rejects.toThrow('LOG_NOT_FOUND');
      await expect(service.download('other', job.id)).rejects.toThrow('LOG_NOT_FOUND');
      emitWorker(-1, { ok: true, result: { count: 3, bytes: 200 } });
      await vi.waitFor(async () =>
        expect((await service.exportStatus('owner', job.id)).state).toBe('ready'),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('cleans restart orphans but preserves unrelated files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'asa-log-job-'));
    try {
      await writeFile(join(root, '10000000-0000-4000-8000-000000000001.zip'), 'orphan');
      await writeFile(join(root, 'owner-backup.zip'), 'preserved');
      const service = new AdminLogsService(root, root);
      await service.status();
      expect(await readdir(root)).toEqual(['owner-backup.zip']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
