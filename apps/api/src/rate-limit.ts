/**
 * Fixed-window rate limiting for unauthenticated endpoints whose work is
 * expensive: password hashing costs tens of milliseconds of pool time, so an
 * unlimited endpoint lets a single client consume the whole runtime.
 *
 * State is per-process. It is bounded on purpose — an unbounded map keyed by
 * client address is itself a way to exhaust a server. Running more than one API
 * instance needs shared storage; until then each instance limits its own share.
 */
export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  readonly limit: number;
  readonly windowMs: number;
  /** Hard cap on tracked keys; the oldest window is dropped when exceeded. */
  readonly maxKeys?: number;
  readonly now?: () => number;
}

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: RateLimiterOptions) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.maxKeys = options.maxKeys ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  consume(key: string): RateLimitDecision {
    const now = this.now();
    this.prune(now);

    const current = this.windows.get(key);
    if (current === undefined || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    current.count += 1;
    if (current.count > this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Test and diagnostics helper: how many windows are currently tracked. */
  size(): number {
    return this.windows.size;
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) {
        this.windows.delete(key);
      }
    }
    // Insertion order makes the first surviving entries the oldest windows.
    while (this.windows.size >= this.maxKeys) {
      const oldest = this.windows.keys().next();
      if (oldest.done === true) break;
      this.windows.delete(oldest.value);
    }
  }
}
