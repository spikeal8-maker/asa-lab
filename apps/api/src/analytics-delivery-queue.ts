import { randomUUID } from 'node:crypto';

export class AnalyticsDeliveryError extends Error {
  constructor(
    readonly code:
      'telemetry_capacity' | 'telemetry_unavailable' | 'telemetry_conflict' | 'context_denied',
  ) {
    super(code);
  }
}

interface Job {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  background: boolean;
  expiresAt: number;
  availableAt: number;
  failures: number;
}

/** All ProductAnalytics SQL is serialized here, including awaited browser writes. */
export class AnalyticsDeliveryQueue {
  private readonly streamId = randomUUID();
  private readonly startedAt = new Date().toISOString();
  private jobs: Job[] = [];
  private active: Job | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private qualityTimer: ReturnType<typeof setInterval> | undefined;
  private closing = false;
  private closePromise: Promise<void> | undefined;
  private foregroundStreak = 0;
  private lastSnapshot = -Infinity;
  private degraded = false;
  readonly counters = {
    enqueued: 0,
    persisted: 0,
    retried: 0,
    expired: 0,
    queueFull: 0,
    rejected: 0,
    unrecordable: 0,
    abandoned: 0,
    qualityWriteFailures: 0,
  };

  constructor(
    private readonly enabled = true,
    private readonly now = Date.now,
    private readonly emit: (value: object) => void = (value) =>
      process.stdout.write(`${JSON.stringify(value)}\n`),
  ) {}

  get pending() {
    return this.jobs.length;
  }
  get inFlight() {
    return this.active ? 1 : 0;
  }

  submit<T>(run: () => Promise<T>, background = false): Promise<T> {
    if (!this.enabled || this.closing) {
      this.counters.rejected += 1;
      this.snapshot();
      return Promise.reject(new AnalyticsDeliveryError('telemetry_unavailable'));
    }
    if (this.pending + this.inFlight >= 256) {
      this.counters.queueFull += 1;
      this.snapshot();
      return Promise.reject(new AnalyticsDeliveryError('telemetry_capacity'));
    }
    this.counters.enqueued += 1;
    if (!this.qualityTimer) {
      this.qualityTimer = setInterval(() => this.snapshot(true), 60_000);
      this.qualityTimer.unref?.();
    }
    const now = this.now();
    const result = new Promise<unknown>((resolve, reject) => {
      this.jobs.push({
        run,
        resolve,
        reject,
        background,
        expiresAt: now + (background ? 300_000 : 5_000),
        availableAt: now,
        failures: 0,
      });
    });
    this.snapshot();
    queueMicrotask(() => {
      void this.pump();
    });
    return result as Promise<T>;
  }

  /** Queue admission is not a persistence acknowledgement. */
  enqueue(run: () => Promise<unknown>): { state: 'queued' | 'unavailable' } {
    const admitted = this.enabled && !this.closing && this.pending + this.inFlight < 256;
    void this.submit(run, true).catch(() => undefined);
    return { state: admitted ? 'queued' : 'unavailable' };
  }

  private snapshot(force = false, final = false): void {
    if (!force && this.now() - this.lastSnapshot < 60_000) return;
    this.lastSnapshot = this.now();
    const snapshot = {
      kind: 'analytics_delivery_quality',
      level: this.degraded ? 'warn' : 'info',
      streamId: this.streamId,
      startedAt: this.startedAt,
      time: new Date(this.now()).toISOString(),
      ...this.counters,
      pending: this.pending,
      inFlight: this.inFlight,
      final,
      durableQueue: false,
      abruptTerminationTail: 'unknown',
    };
    try {
      this.emit(snapshot);
    } catch {
      // A failed quality sink must not fail authentication or recurse.
      this.counters.qualityWriteFailures += 1;
    }
  }

  private async pump(): Promise<void> {
    if (this.active || this.timer) return;
    const now = this.now();
    const remaining: Job[] = [];
    for (const job of this.jobs) {
      if (job.expiresAt <= now) {
        this.counters.expired += 1;
        job.reject(new AnalyticsDeliveryError('telemetry_unavailable'));
      } else remaining.push(job);
    }
    this.jobs = remaining;
    const ready = (job: Job) => job.availableAt <= now;
    let index = this.jobs.findIndex(
      (job) => ready(job) && job.background === this.foregroundStreak >= 3,
    );
    if (index < 0) index = this.jobs.findIndex(ready);
    if (index < 0) {
      if (this.jobs.length && !this.closing) {
        const delay = Math.max(
          1,
          Math.min(...this.jobs.map((job) => Math.min(job.availableAt, job.expiresAt))) - now,
        );
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.pump();
        }, delay);
        this.timer.unref?.();
      }
      return;
    }
    const job = this.jobs.splice(index, 1)[0]!;
    this.active = job;
    this.foregroundStreak = job.background ? 0 : this.foregroundStreak + 1;
    try {
      const value = await job.run();
      this.counters.persisted += 1;
      job.resolve(value);
      if (this.degraded) {
        this.degraded = false;
        this.snapshot(true);
      }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      const permanent =
        ['42501', '22023', '23505'].includes(code) || error instanceof AnalyticsDeliveryError;
      if (job.background && !permanent && !this.closing && this.now() < job.expiresAt) {
        job.failures += 1;
        job.availableAt = this.now() + Math.min(30_000, 1000 * 2 ** Math.min(5, job.failures - 1));
        this.jobs.push(job);
        this.counters.retried += 1;
      } else {
        this.counters.rejected += 1;
        if (job.background && code === '42501') this.counters.unrecordable += 1;
        job.reject(error);
      }
      if (!this.degraded) {
        this.degraded = true;
        this.snapshot(true);
      }
    } finally {
      this.active = undefined;
      this.snapshot();
      queueMicrotask(() => {
        void this.pump();
      });
    }
  }

  shutdown(): Promise<void> {
    this.closePromise ??= (async () => {
      this.closing = true;
      if (this.qualityTimer) clearInterval(this.qualityTimer);
      this.qualityTimer = undefined;
      if (this.timer) clearTimeout(this.timer);
      this.timer = undefined;
      const deadline = Date.now() + 5_000;
      void this.pump();
      while ((this.active || this.jobs.length) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (!this.active) {
          // Shutdown drains ready work only, never waits through retry backoff.
          for (const job of this.jobs) job.availableAt = this.now();
          void this.pump();
        }
      }
      for (const job of this.jobs) {
        this.counters.abandoned += 1;
        job.reject(new AnalyticsDeliveryError('telemetry_unavailable'));
      }
      this.jobs = [];
      this.snapshot(true, !this.active);
      if (this.active) throw new AnalyticsDeliveryError('telemetry_unavailable');
    })();
    return this.closePromise;
  }
}
