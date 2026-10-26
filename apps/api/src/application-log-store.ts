import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { logModule, logSubsystem } from './log-subsystems.js';

const FIELDS = new Set([
  'time',
  'kind',
  'phase',
  'level',
  'requestId',
  'revision',
  'method',
  'path',
  'subsystem',
  'module',
  'status',
  'durationMs',
  'code',
  'errorCode',
  'errorClass',
  'frames',
  'clientAttemptId',
  'instanceId',
  'eventId',
  'sessionDatabase',
  'runtime',
  'addressResolution',
  'pipeline',
  'counters',
  'gauges',
  'coverage',
  'outcome',
  'actorKind',
  'sessionKind',
  'delivery',
  'mutationOutcome',
  'reasonCode',
  'untrustedClientReport',
  'untrustedClientContext',
  'eventLoopDelaySinceStartMs',
  'enqueued',
  'persisted',
  'retried',
  'expired',
  'queueFull',
  'rejected',
  'unrecordable',
  'abandoned',
  'qualityWriteFailures',
  'responseTimedOut',
  'pending',
  'inFlight',
  'final',
  'durableQueue',
  'abruptTerminationTail',
]);
const SEGMENT = /^seg-\d{16}-\d{16}\.jsonl$/;
type Segment = {
  file: string;
  bytes: number;
  rawBytes: number;
  count: number;
  first: string;
  last: string;
  sources: string[];
  modules: string[];
  levels: string[];
  sha256: string;
  schema: number;
};

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[bounded]';
  if (typeof value === 'string')
    return Array.from(value)
      .slice(0, 2048)
      .map((character) => (character.charCodeAt(0) < 32 ? ' ' : character))
      .join('');
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.slice(0, 32).map((v) => safeValue(v, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/password|secret|cookie|authorization|credential|token|api.?key|prompt|content|email/i.test(
              key,
            ),
        )
        .slice(0, 40)
        .map(([key, item]) => [key, safeValue(item, depth + 1)]),
    );
  return null;
}

/** Application-owned diagnostic storage; optional host collectors never gate this writer. */
export class ApplicationLogStore {
  private queue: Record<string, unknown>[] = [];
  private queuedBytes = 0;
  private reportedDropped = 0;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ready: Promise<void> | null = null;
  private segments: Segment[] = [];
  private sequence = 0;
  private trimmed = false;
  private closing = false;
  private lastFailure: string | null = null;
  private lastSuccessAt: string | null = null;
  readonly counters = { accepted: 0, persisted: 0, dropped: 0, failures: 0 };
  constructor(
    readonly root: string,
    private readonly maxBytes = 128 * 1024 * 1024,
    private readonly maxQueue = 4096,
  ) {}

  isIdleHealthy(): boolean {
    return (
      !this.closing &&
      !!this.ready &&
      !this.running &&
      this.queue.length === 0 &&
      !this.lastFailure &&
      this.counters.dropped === 0
    );
  }

  enqueue(text: string): void {
    if (Buffer.byteLength(text) > 256 * 1024) {
      this.counters.dropped++;
      this.schedule();
      return;
    }
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    if (!value || typeof value !== 'object' || typeof value['kind'] !== 'string') return;
    // Routine liveness probes are not user activity and would dominate a quiet installation.
    if (typeof value['path'] === 'string' && /^\/health\//.test(value['path'])) return;
    if (this.closing || this.queue.length >= this.maxQueue) {
      this.counters.dropped++;
      return;
    }
    const projected = Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => FIELDS.has(key))
        .map(([key, item]) => [key, safeValue(item)]),
    );
    if (typeof projected['path'] === 'string') projected['path'] = projected['path'].split('?')[0];
    const bytes = Buffer.byteLength(JSON.stringify(projected));
    if (bytes > 16384 || this.queuedBytes + bytes > 8 * 1024 * 1024) {
      this.counters.dropped++;
      this.schedule();
      return;
    }
    this.queue.push(projected);
    this.queuedBytes += bytes;
    this.counters.accepted++;
    this.schedule();
  }

  private schedule(): void {
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, 1000);
      this.timer.unref();
    }
  }

  private async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    this.segments = [];
    try {
      const path = join(this.root, 'catalog.json');
      if ((await stat(path)).size > 32 * 1024 * 1024) throw new Error('catalog_limit');
      const catalog = JSON.parse(await readFile(path, 'utf8'));
      if (
        catalog.version !== 1 ||
        catalog.applicationOwned !== true ||
        !Array.isArray(catalog.segments) ||
        catalog.segments.length > 32768
      )
        throw new Error('catalog_invalid');
      for (const segment of catalog.segments as Segment[]) {
        if (
          !SEGMENT.test(segment.file) ||
          !Number.isSafeInteger(segment.bytes) ||
          segment.bytes < 0 ||
          segment.bytes > 4 * 1024 * 1024 ||
          !/^[a-f0-9]{64}$/.test(segment.sha256)
        )
          throw new Error('catalog_invalid');
        this.sequence = Math.max(this.sequence, Number(segment.file.split('-')[2]!.split('.')[0]));
      }
      this.segments = catalog.segments;
      this.trimmed = !!catalog.trimmed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    // A crash can leave an immutable segment whose catalog was not committed.
    // Never reuse its filename or silently overwrite that evidence on restart.
    const referenced = new Set(this.segments.map((segment) => segment.file));
    for (const name of await readdir(this.root)) {
      if (SEGMENT.test(name)) {
        this.sequence = Math.max(this.sequence, Number(name.split('-')[2]!.split('.')[0]));
        // Recover only writer-owned unreferenced debt, after the longest
        // resumable-reader lifetime. Never delete a catalog-referenced segment.
        if (
          !referenced.has(name) &&
          Date.now() - (await stat(join(this.root, name))).mtimeMs > 600000
        )
          await rm(join(this.root, name));
      }
    }
  }

  private async atomic(name: string, text: string): Promise<void> {
    const temporary = join(this.root, `.${name}.${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(text);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, join(this.root, name));
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async flush(): Promise<void> {
    if (this.running) {
      await this.running;
      return;
    }
    if (this.ready && this.queue.length === 0 && this.reportedDropped === this.counters.dropped)
      return;
    this.running = this.publish();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }

  private async publish(): Promise<void> {
    let batch: Record<string, unknown>[] = [];
    let staged = 0;
    let committed = false;
    const newFiles: string[] = [];
    try {
      this.ready ??= this.initialize();
      await this.ready;
      // Snapshot the batch budget. Continuous user traffic must not postpone
      // catalog publication indefinitely while an unbounded drain chases it.
      let remaining = Math.min(this.queue.length, 1024);
      while (remaining > 0) {
        batch = this.queue.splice(0, Math.min(remaining, 32));
        this.queuedBytes -= batch.reduce(
          (sum, value) => sum + Buffer.byteLength(JSON.stringify(value)),
          0,
        );
        remaining -= batch.length;
        const rows = batch.map((value) => {
          const message = JSON.stringify(value).slice(0, 16000);
          const time =
            typeof value['time'] === 'string' && Number.isFinite(Date.parse(value['time']))
              ? value['time']
              : new Date().toISOString();
          const path = typeof value['path'] === 'string' ? value['path'] : '';
          return {
            id: createHash('sha256').update(randomUUID()).digest('hex'),
            time,
            source: 'api',
            module: logModule(
              'api',
              logSubsystem('api', path, '', String(value['kind']), String(value['module'] ?? '')),
              String(value['module'] ?? ''),
            ),
            subsystem: logSubsystem(
              'api',
              path,
              '',
              String(value['kind']),
              String(value['module'] ?? ''),
            ),
            level:
              value['level'] === 'error' || Number(value['status']) >= 500
                ? 'error'
                : value['level'] === 'warn' || Number(value['status']) >= 400
                  ? 'warn'
                  : 'info',
            message,
            requestId: typeof value['requestId'] === 'string' ? value['requestId'] : null,
            revision: typeof value['revision'] === 'string' ? value['revision'] : null,
            origin: 'application-owned',
            truncated: JSON.stringify(value).length > 16000,
          };
        });
        const raw = rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
        const first = this.sequence + 1;
        this.sequence += rows.length;
        const file = `seg-${String(first).padStart(16, '0')}-${String(this.sequence).padStart(16, '0')}.jsonl`;
        await this.atomic(file, raw);
        newFiles.push(file);
        this.segments.push({
          file,
          bytes: Buffer.byteLength(raw),
          rawBytes: Buffer.byteLength(raw),
          count: rows.length,
          first: rows.reduce((a, b) => (a < b.time ? a : b.time), rows[0]!.time),
          last: rows.reduce((a, b) => (a > b.time ? a : b.time), rows[0]!.time),
          sources: ['api'],
          modules: [...new Set(rows.map((row) => row.module))],
          levels: [...new Set(rows.map((row) => row.level))],
          sha256: createHash('sha256').update(raw).digest('hex'),
          schema: 2,
        });
        staged += batch.length;
        batch = [];
      }
      const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
      let bytes = this.segments.reduce((sum, segment) => sum + segment.bytes, 0);
      const retired: Segment[] = [];
      while (
        this.segments.length &&
        (bytes > this.maxBytes || this.segments.length > 32768 || this.segments[0]!.last < cutoff)
      ) {
        const segment = this.segments.shift()!;
        retired.push(segment);
        bytes -= segment.bytes;
        this.trimmed = true;
      }
      await this.atomic(
        'catalog.json',
        JSON.stringify({
          version: 1,
          applicationOwned: true,
          collectedAt: new Date().toISOString(),
          retentionDays: 7,
          maxBytes: this.maxBytes,
          bytes,
          trimmed: this.trimmed,
          sources: [
            {
              source: 'api',
              state: this.counters.dropped ? 'error' : 'ok',
              checkedAt: new Date().toISOString(),
              lastCollectedAt: new Date().toISOString(),
              detail: `Application-owned storage; accepted=${this.counters.accepted}; persisted=${this.counters.persisted + staged}; dropped=${this.counters.dropped}`,
            },
          ],
          segments: this.segments,
        }),
      );
      committed = true;
      this.counters.persisted += staged;
      staged = 0;
      this.lastSuccessAt = new Date().toISOString();
      // Readers detect a changed snapshot and explicitly ask to retry; never return partial files.
      for (const segment of retired) await rm(join(this.root, segment.file), { force: true });
      this.lastFailure = null;
    } catch (error) {
      this.counters.failures++;
      this.counters.dropped += batch.length + staged;
      this.lastFailure = (error as NodeJS.ErrnoException).code ?? 'application_log_write_failed';
      // A transient disk error may recover; a corrupt existing catalog remains fail-closed.
      this.ready = null;
      if (!committed) {
        for (const file of newFiles) {
          try {
            await rm(join(this.root, file), { force: true });
          } catch {
            /* Preserved orphan is never reused. */
          }
        }
      }
      if (this.closing) {
        this.counters.dropped += this.queue.length;
        this.queue = [];
        this.queuedBytes = 0;
      }
    }
    try {
      await this.atomic(
        'collector-health.json',
        JSON.stringify({
          version: 1,
          state: this.lastFailure || this.counters.dropped ? 'error' : 'ok',
          checkedAt: new Date().toISOString(),
          lastSuccessAt: this.lastSuccessAt,
          detail:
            this.lastFailure ??
            `Application logs active; dropped=${this.counters.dropped}; pending=${this.queue.length}`,
        }),
      );
      this.reportedDropped = this.counters.dropped;
    } catch {
      /* Existing health becomes observably stale when storage is unavailable. */
    }
    if (this.queue.length && !this.closing && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, 1000);
      this.timer.unref();
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const drain = async () => {
      do {
        await this.flush();
      } while (this.queue.length);
    };
    await Promise.race([
      drain(),
      new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          this.counters.dropped += this.queue.length;
          this.queue = [];
          this.queuedBytes = 0;
          this.lastFailure = 'shutdown_tail_unknown';
          resolve();
        }, 5000);
      }),
    ]);
    if (timeout) clearTimeout(timeout);
  }
}

let singleton: ApplicationLogStore | undefined;
export function applicationLogStore(): ApplicationLogStore | undefined {
  if (process.env['NODE_ENV'] === 'test' && !process.env['ASA_APPLICATION_LOG_STORE'])
    return undefined;
  singleton ??= new ApplicationLogStore(
    process.env['ASA_APPLICATION_LOG_STORE'] ?? resolve('.asa', 'diagnostics', 'application'),
  );
  return singleton;
}
export function emitApplicationLog(text: string, stream: 'stdout' | 'stderr' = 'stdout'): boolean {
  try {
    applicationLogStore()?.enqueue(text);
  } catch {
    /* stdout remains independent. */
  }
  return process[stream].write(text);
}
