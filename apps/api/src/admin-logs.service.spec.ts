import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { workers } = vi.hoisted(() => ({ workers: [] as EventEmitter[] }));
vi.mock('node:worker_threads', () => ({
  parentPort: null,
  workerData: null,
  Worker: class extends EventEmitter {
    constructor() {
      super();
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
afterEach(() => {
  for (const worker of workers.splice(0)) worker.emit('message', { ok: false });
});
describe('bounded archive jobs', () => {
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
      workers.at(-1)!.emit('message', { ok: false, error: code });
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
      workers.at(-1)!.emit('message', { ok: true, result: { count: 3, bytes: 200 } });
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
