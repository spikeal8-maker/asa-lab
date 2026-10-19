import type pg from 'pg';
import type { SeatContext } from './seat-context.js';

export type OfflineGame = 'chess' | 'checkers';
export type GamesMode = 'allow' | 'deny' | 'rating_threshold';
export type GamesOverride = 'inherit' | 'allow' | 'deny';
export type GamesReason =
  | 'allowed'
  | 'access_unavailable'
  | 'policy_revoked'
  | 'class_disabled'
  | 'seat_disabled'
  | 'rating_below_threshold'
  | 'rating_unavailable'
  | 'unsupported_game';

/** Own decision only: no identity, roster, score, rank or durable capability. */
export interface GamesAdmission {
  readonly granted: boolean;
  readonly reason: GamesReason;
  readonly threshold: number | null;
}

export interface GamesPolicySnapshot {
  readonly eligible: boolean;
  readonly state: 'active' | 'revoked';
  readonly mode: GamesMode;
  readonly threshold: number | null;
  readonly override: GamesOverride;
  readonly rating: number | null;
}

export function isOfflineGame(value: unknown): value is OfflineGame {
  return value === 'chess' || value === 'checkers';
}

export function evaluateGamesAccess(
  game: unknown,
  policy: GamesPolicySnapshot | null,
): GamesAdmission {
  const deny = (reason: GamesReason, threshold: number | null = null): GamesAdmission => ({
    granted: false,
    reason,
    threshold,
  });
  if (!isOfflineGame(game)) return deny('unsupported_game');
  if (!policy || policy.eligible !== true) return deny('access_unavailable');
  if (policy.state === 'revoked') return deny('policy_revoked');
  if (policy.state !== 'active') return deny('access_unavailable');
  // Explicit Seat allow bypasses the class rule, never identity/activity/revocation.
  // SafeMode is intentionally absent: admission is only for educational offline play.
  if (policy.override === 'deny') return deny('seat_disabled');
  if (policy.override === 'allow') return { granted: true, reason: 'allowed', threshold: null };
  if (policy.override !== 'inherit') return deny('access_unavailable');
  if (policy.mode === 'deny') return deny('class_disabled');
  if (policy.mode === 'allow') return { granted: true, reason: 'allowed', threshold: null };
  if (
    policy.mode !== 'rating_threshold' ||
    policy.threshold === null ||
    !Number.isFinite(policy.threshold) ||
    policy.threshold < 0 ||
    policy.threshold > 100
  ) {
    return deny('access_unavailable');
  }
  if (
    policy.rating === null ||
    !Number.isFinite(policy.rating) ||
    policy.rating < 0 ||
    policy.rating > 100
  ) {
    return deny('rating_unavailable', policy.threshold);
  }
  return policy.rating >= policy.threshold
    ? { granted: true, reason: 'allowed', threshold: policy.threshold }
    : deny('rating_below_threshold', policy.threshold);
}

/** Re-read on every operation; callers must already have selected a trusted Seat.
 * SQL rechecks exact principal/tenant/class/session/credential/link activity in one
 * snapshot. This helper does not authorize project ACL or assigned game work.
 */
export async function currentSeatGamesAccess(
  pool: pg.Pool | null,
  seat: SeatContext,
  sessionHash: string,
  game: OfflineGame,
): Promise<GamesAdmission> {
  if (!pool) return evaluateGamesAccess(game, null);
  const result = await pool.query<{ data: GamesPolicySnapshot | null }>(
    'SELECT public.classroom_games_admission_snapshot($1,$2,$3,$4,$5) AS data',
    [seat.principalId, seat.tenantId, seat.classroomId, seat.seatId, sessionHash],
  );
  return evaluateGamesAccess(game, result.rows[0]?.data ?? null);
}
