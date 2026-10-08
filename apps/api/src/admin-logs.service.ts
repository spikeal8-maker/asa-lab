import { Worker } from 'node:worker_threads';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { readLogCatalog, type LogFilter } from './admin-logs.worker.js';

interface ExportJob {
  readonly id: string;
  readonly owner: string;
  readonly createdAt: number;
  readonly output: string;
  state: 'running' | 'ready' | 'failed';
  count: number | null;
  bytes: number | null;
  error: string | null;
}

export class AdminLogsService {
  private running = 0;
  private readonly jobs = new Map<string, ExportJob>();
  private lastCleanup = 0;
  constructor(
    private readonly root = process.env['ASA_LOG_STORE'] ?? '/var/lib/asa-logs',
    private readonly exportsRoot = process.env['ASA_LOG_EXPORTS'] ?? '/tmp/asa-log-exports',
  ) {}

  async status() {
    await this.expireJobs();
    const catalog = await readLogCatalog(this.root);
    if (!catalog)
      return {
        state: 'unavailable' as const,
        collectedAt: null,
        sources: [],
        retentionDays: null,
        bytes: 0,
        first: null,
        last: null,
        trimmed: false,
      };
    const age = Date.now() - Date.parse(catalog.collectedAt);
    return {
      state: age > 5 * 60_000 ? ('stale' as const) : ('ok' as const),
      collectedAt: catalog.collectedAt,
      sources: catalog.sources,
      eventSources: [...new Set(catalog.segments.flatMap((s) => s.sources))].sort(),
      retentionDays: catalog.retentionDays,
      bytes: catalog.bytes,
      first: catalog.segments.reduce<string | null>(
        (v, s) => (v === null || s.first < v ? s.first : v),
        null,
      ),
      last: catalog.segments.reduce<string | null>(
        (v, s) => (v === null || s.last > v ? s.last : v),
        null,
      ),
      trimmed: catalog.trimmed,
    };
  }

  private async worker(kind: 'query' | 'export', filter: LogFilter, output = ''): Promise<unknown> {
    if (this.running >= 2) throw new Error('LOG_BUSY');
    this.running += 1;
    return new Promise((resolve, reject) => {
      let worker: Worker;
      try {
        worker = new Worker(join(__dirname, 'admin-logs.worker.js'), {
          workerData: { kind, root: this.root, filter, limit: 100, output },
          resourceLimits: { maxOldGenerationSizeMb: 128 },
        });
      } catch {
        this.running -= 1;
        reject(new Error('LOG_WORKER_FAILED'));
        return;
      }
      let settled = false;
      const finish = (failure: Error | null, value?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.running -= 1;
        void worker.terminate();
        if (failure) reject(failure);
        else resolve(value);
      };
      const timer = setTimeout(
        () => finish(new Error('LOG_TIMEOUT')),
        kind === 'export' ? 120_000 : 20_000,
      );
      worker.once('message', (message: { ok: boolean; result?: unknown; error?: string }) => {
        finish(message.ok ? null : new Error(message.error ?? 'LOG_FAILED'), message.result);
      });
      worker.once('error', () => finish(new Error('LOG_WORKER_FAILED')));
      worker.once('exit', () => {
        if (!settled) finish(new Error('LOG_WORKER_FAILED'));
      });
    });
  }

  query(filter: LogFilter): Promise<unknown> {
    return this.worker('query', filter);
  }

  private async expireJobs(): Promise<void> {
    for (const [id, job] of this.jobs) {
      if (Date.now() - job.createdAt > 60 * 60_000 && job.state !== 'running') {
        this.jobs.delete(id);
        await rm(job.output, { force: true });
      }
    }
    if (Date.now() - this.lastCleanup < 60_000) return;
    this.lastCleanup = Date.now();
    let files: string[];
    try {
      files = await readdir(this.exportsRoot);
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw failure;
    }
    for (const name of files) {
      if (!/^[a-f0-9-]{36}\.zip$/.test(name) || this.jobs.has(name.slice(0, -4))) continue;
      await rm(join(this.exportsRoot, name), { force: true });
    }
  }

  async createExport(owner: string, filter: LogFilter) {
    await this.expireJobs();
    await mkdir(this.exportsRoot, { recursive: true, mode: 0o700 });
    if (this.running >= 2 || [...this.jobs.values()].some((j) => j.state === 'running'))
      throw new Error('LOG_BUSY');
    if (this.jobs.size >= 3 || [...this.jobs.values()].filter((j) => j.owner === owner).length >= 3)
      throw new Error('LOG_EXPORT_LIMIT');
    const id = randomUUID();
    const job: ExportJob = {
      id,
      owner,
      createdAt: Date.now(),
      output: join(this.exportsRoot, `${id}.zip`),
      state: 'running',
      count: null,
      bytes: null,
      error: null,
    };
    this.jobs.set(id, job);
    void this.worker('export', filter, job.output)
      .then((value) => {
        const result = value as { count: number; bytes: number };
        job.state = 'ready';
        job.count = result.count;
        job.bytes = result.bytes;
      })
      .catch(async (failure: unknown) => {
        job.state = 'failed';
        const code = failure instanceof Error ? failure.message : '';
        const reasons: Record<string, string> = {
          LOG_EXPORT_TOO_LARGE: 'Архив превышает допустимый объём. Выберите меньший период.',
          LOG_TIMEOUT: 'Сбор архива занял слишком много времени. Выберите меньший период.',
          LOG_SNAPSHOT_CHANGED: 'Журналы обновились во время сборки. Повторите сбор архива.',
          LOG_SEGMENT_INVALID: 'Обнаружен повреждённый файл журнала. Требуется проверка сборщика.',
          LOG_CATALOG_INVALID: 'Каталог журналов повреждён. Требуется проверка сборщика.',
          LOG_COLLECTOR_UNAVAILABLE: 'Сборщик журналов недоступен. Проверьте его подключение.',
        };
        job.error = reasons[code] ?? 'Не удалось собрать архив. Повторите позже.';
        await rm(job.output, { force: true }).catch(() => undefined);
      });
    return this.view(job);
  }

  private view(job: ExportJob) {
    return { id: job.id, state: job.state, count: job.count, bytes: job.bytes, error: job.error };
  }

  async exportStatus(owner: string, id: string) {
    await this.expireJobs();
    const job = this.jobs.get(id);
    if (!job || job.owner !== owner) throw new Error('LOG_NOT_FOUND');
    return this.view(job);
  }

  async download(owner: string, id: string): Promise<{ stream: Readable; bytes: number }> {
    await this.expireJobs();
    const job = this.jobs.get(id);
    if (!job || job.owner !== owner || job.state !== 'ready') throw new Error('LOG_NOT_FOUND');
    return { stream: createReadStream(job.output), bytes: (await stat(job.output)).size };
  }
}
