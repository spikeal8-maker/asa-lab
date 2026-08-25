import { Controller, Get, Inject, Optional, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type pg from 'pg';
import type { RuntimeMetrics, RuntimeMetricsSnapshot } from '@asa-lab/observability';
import { runtimeBuildMetadata } from './build-metadata.js';
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
  deployment: {
    readonly revision: string;
    readonly builtAt: string | null;
    readonly schemaVersion: number | null;
    readonly expectedSchemaVersion: number | null;
    readonly synchronized: boolean | null;
    readonly artifactIntegrity: 'verified' | 'unknown';
    readonly artifactVerifiedAt: string | null;
  };
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
    const probe = await this.probeDatabase();
    const build = runtimeBuildMetadata();
    const synchronized =
      build.expectedSchemaVersion === null || probe.schemaVersion === null
        ? null
        : build.expectedSchemaVersion === probe.schemaVersion;
    const ready = probe.database !== 'down' && synchronized !== false;
    reply.code(ready ? 200 : 503);
    return {
      status: ready ? 'ready' : 'not_ready',
      dependencies: { database: probe.database },
      deployment: {
        revision: build.revision,
        builtAt: build.builtAt,
        schemaVersion: probe.schemaVersion,
        expectedSchemaVersion: build.expectedSchemaVersion,
        synchronized,
        artifactIntegrity: build.artifactIntegrity,
        artifactVerifiedAt: build.artifactVerifiedAt,
      },
    };
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

  private async probeDatabase(): Promise<{
    readonly database: DatabaseState;
    readonly schemaVersion: number | null;
  }> {
    if (!this.pool) return { database: 'down', schemaVersion: null };

    let timer: NodeJS.Timeout | undefined;
    const timedOut = Symbol('timed-out');
    try {
      const outcome = await Promise.race([
        this.pool
          .query<{ version: number | string }>('SELECT version FROM runtime_schema_version()')
          .then((result) => ({
            answered: true as const,
            version: result.rows[0]?.version ?? null,
          })),
        new Promise<typeof timedOut>((resolve) => {
          timer = setTimeout(() => resolve(timedOut), READINESS_TIMEOUT_MS);
        }),
      ]);
      if (outcome === timedOut) {
        this.consecutiveTimeouts += 1;
        return {
          database: this.consecutiveTimeouts >= CONSECUTIVE_TIMEOUTS_BEFORE_DOWN ? 'down' : 'busy',
          schemaVersion: null,
        };
      }
      this.consecutiveTimeouts = 0;
      const parsed = outcome.version === null ? Number.NaN : Number(outcome.version);
      return {
        database: 'up',
        schemaVersion: Number.isSafeInteger(parsed) ? parsed : null,
      };
    } catch {
      // A refused or broken connection is a real outage, not congestion.
      this.consecutiveTimeouts = CONSECUTIVE_TIMEOUTS_BEFORE_DOWN;
      return { database: 'down', schemaVersion: null };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
