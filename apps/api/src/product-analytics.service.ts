import { isIP } from 'node:net';
import { Logger } from '@nestjs/common';
import type pg from 'pg';
import type { ActiveContext } from '@asa-lab/identity';
import type { SeatContext } from './seat-context.js';
import type { ClientNetworkKind } from './client-address.js';

export type AnalyticsEventType =
  | 'auth.login'
  | 'auth.register'
  | 'auth.max'
  | 'auth.class_join'
  | 'session.observed'
  | 'module.opened';
export type AnalyticsOutcome = 'succeeded' | 'failed' | 'blocked';
export type AnalyticsAuthMethod = 'password' | 'organization' | 'max' | 'class_code';
export type AnalyticsModuleKey = 'electronics' | 'three-d' | 'chess' | 'checkers';

interface EventBase {
  readonly eventType: AnalyticsEventType;
  readonly outcome: AnalyticsOutcome;
  readonly authMethod?: AnalyticsAuthMethod | null;
  readonly moduleKey?: AnalyticsModuleKey | null;
  readonly flowId?: string | null;
  readonly address?: string | null;
  readonly networkKind?: ClientNetworkKind | null;
  readonly userAgentSummary?: string | null;
}

export type AnalyticsActor =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'account'; readonly context: ActiveContext }
  | { readonly kind: 'student'; readonly context: SeatContext };

export type ProductAnalyticsEvent = EventBase & { readonly actor: AnalyticsActor };

/**
 * Writes observability after the product action has made its own decision.
 * Analytics is deliberately best-effort: a telemetry outage must never lock a
 * learner out or stop an editor opening.
 */
export class ProductAnalyticsService {
  private readonly logger = new Logger(ProductAnalyticsService.name);
  private lastFailureWarningAt = 0;

  constructor(private readonly pool: pg.Pool) {}

  private warnWriteFailure(): void {
    const now = Date.now();
    if (now - this.lastFailureWarningAt < 60_000) return;
    this.lastFailureWarningAt = now;
    this.logger.warn(
      'Product analytics write failed; the product action continued, but this event was not recorded.',
    );
  }

  async record(event: ProductAnalyticsEvent): Promise<boolean> {
    const account = event.actor.kind === 'account' ? event.actor.context : null;
    const student = event.actor.kind === 'student' ? event.actor.context : null;
    const address = event.address && isIP(event.address) !== 0 ? event.address : null;
    try {
      await this.pool.query(
        `SELECT analytics_record_event(
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::inet,$12,$13
         )`,
        [
          event.actor.kind,
          account?.accountId ?? null,
          account?.principalId ?? student?.principalId ?? null,
          student?.seatId ?? null,
          account?.workspaceId ?? null,
          event.eventType,
          event.outcome,
          event.authMethod ?? null,
          event.moduleKey ?? null,
          event.flowId ?? null,
          address,
          event.userAgentSummary?.trim().slice(0, 128) || null,
          event.networkKind ?? 'unknown',
        ],
      );
      return true;
    } catch {
      this.warnWriteFailure();
      return false;
    }
  }

  async startModuleSession(input: {
    readonly sessionId: string;
    readonly projectId: string;
    readonly actor: AnalyticsActor;
    readonly moduleKey: AnalyticsModuleKey;
    readonly address?: string | null;
    readonly networkKind?: ClientNetworkKind | null;
    readonly userAgentSummary?: string | null;
  }): Promise<boolean> {
    const account = input.actor.kind === 'account' ? input.actor.context : null;
    const student = input.actor.kind === 'student' ? input.actor.context : null;
    const address = input.address && isIP(input.address) !== 0 ? input.address : null;
    if (input.actor.kind === 'anonymous') return false;
    try {
      await this.pool.query(
        `SELECT analytics_start_module_session(
           $1,$2,$3,$4,$5,$6,$7,$8,$9::inet,$10,$11
         )`,
        [
          input.sessionId,
          input.actor.kind,
          account?.accountId ?? null,
          account?.principalId ?? student?.principalId ?? null,
          student?.seatId ?? null,
          account?.workspaceId ?? null,
          input.moduleKey,
          input.projectId,
          address,
          input.networkKind ?? 'unknown',
          input.userAgentSummary?.trim().slice(0, 128) || null,
        ],
      );
      return true;
    } catch {
      this.warnWriteFailure();
      return false;
    }
  }

  async touchModuleSession(input: {
    readonly sessionId: string;
    readonly actor: AnalyticsActor;
    readonly closed: boolean;
  }): Promise<boolean> {
    const account = input.actor.kind === 'account' ? input.actor.context : null;
    const student = input.actor.kind === 'student' ? input.actor.context : null;
    if (input.actor.kind === 'anonymous') return false;
    try {
      await this.pool.query(`SELECT analytics_touch_module_session($1,$2,$3,$4,$5)`, [
        input.sessionId,
        input.actor.kind,
        account?.accountId ?? null,
        account?.principalId ?? student?.principalId ?? null,
        input.closed,
      ]);
      return true;
    } catch {
      this.warnWriteFailure();
      return false;
    }
  }
}
