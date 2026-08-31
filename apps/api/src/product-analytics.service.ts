import { isIP } from 'node:net';
import type pg from 'pg';
import type { ActiveContext } from '@asa-lab/identity';
import type { SeatContext } from './seat-context.js';

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
  readonly userAgentSummary?: string | null;
}

type AnalyticsActor =
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
  constructor(private readonly pool: pg.Pool) {}

  async record(event: ProductAnalyticsEvent): Promise<boolean> {
    const account = event.actor.kind === 'account' ? event.actor.context : null;
    const student = event.actor.kind === 'student' ? event.actor.context : null;
    const address = event.address && isIP(event.address) !== 0 ? event.address : null;
    try {
      await this.pool.query(
        `SELECT analytics_record_event(
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::inet,$12
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
        ],
      );
      return true;
    } catch {
      return false;
    }
  }
}
