import { Controller, Get, Inject, Optional, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type pg from 'pg';
import type { RuntimeMetrics, RuntimeMetricsSnapshot } from '@asa-lab/observability';
import { TOKENS } from './tokens.js';

const READINESS_TIMEOUT_MS = 1500;
/**
 * A probe that times out means the pool is busy, not that the database is gone.
 * Answering 503 for the first slow probe hands an orchestrator a reason to pull
 * a healthy instance out of rotation exactly when load is highest, which turns
 * one overloaded instance into an outage. Report unavailable only once the
 * database has failed to answer repeatedly.
 */
const CONSECUTIVE_TIMEOUTS_BEFORE_DOWN = 5;

type DatabaseState = 'up' | 'busy' | 'down';

export interface ReadinessBody {
  status: 'ready' | 'not_ready';
  dependencies: { database: DatabaseState };
}

@Controller('health')
export class HealthController {
  private consecutiveTimeouts = 0;

  constructor(
    @Optional() @Inject(TOKENS.pool) private readonly pool: pg.Pool | null,
    @Optional()
    @Inject(TOKENS.runtimeMetrics)
    private readonly runtimeMetrics: RuntimeMetrics | null,
  ) {}

  @Get('live')
  live(): { status: 'live' } {
    return { status: 'live' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<ReadinessBody> {
    const database = await this.probeDatabase();
    const ready = database !== 'down';
    reply.code(ready ? 200 : 503);
    return { status: ready ? 'ready' : 'not_ready', dependencies: { database } };
  }

  /** Runtime counters only: no project content, no learner data, no secrets. */
  @Get('metrics')
  metrics(): RuntimeMetricsSnapshot | { error: { code: string; message: string } } {
    if (!this.runtimeMetrics) {
      return { error: { code: 'metrics_disabled', message: 'runtime metrics are not enabled' } };
    }
    return this.runtimeMetrics.snapshot(this.poolStats());
  }

  private poolStats(): { total: number; idle: number; waiting: number } | null {
    if (!this.pool) return null;
    const pool = this.pool as unknown as {
      totalCount?: number;
      idleCount?: number;
      waitingCount?: number;
    };
    if (typeof pool.totalCount !== 'number') return null;
    return {
      total: pool.totalCount,
      idle: pool.idleCount ?? 0,
      waiting: pool.waitingCount ?? 0,
    };
  }

  private async probeDatabase(): Promise<DatabaseState> {
    if (!this.pool) return 'down';

    let timer: NodeJS.Timeout | undefined;
    const timedOut = Symbol('timed-out');
    try {
      const outcome = await Promise.race([
        this.pool.query('SELECT 1').then(() => 'answered' as const),
        new Promise<typeof timedOut>((resolve) => {
          timer = setTimeout(() => resolve(timedOut), READINESS_TIMEOUT_MS);
        }),
      ]);
      if (outcome === timedOut) {
        this.consecutiveTimeouts += 1;
        return this.consecutiveTimeouts >= CONSECUTIVE_TIMEOUTS_BEFORE_DOWN ? 'down' : 'busy';
      }
      this.consecutiveTimeouts = 0;
      return 'up';
    } catch {
      // A refused or broken connection is a real outage, not congestion.
      this.consecutiveTimeouts = CONSECUTIVE_TIMEOUTS_BEFORE_DOWN;
      return 'down';
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
