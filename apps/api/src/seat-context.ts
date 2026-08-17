import type pg from 'pg';
import { hashSessionToken } from '@asa-lab/identity';

/**
 * The identity a signed-in student seat works under.
 *
 * A seat is not an account: it has no email, no password, no capabilities and
 * nothing outside its class. What it does have, from migration 0026, is a
 * principal — and a principal is all the project stack has ever needed, because
 * `projects.owner_principal_id` and `project_context_for_principal` were
 * written against principals rather than users. So a learner reaches exactly
 * the same project endpoints as anyone else, and the difference between a
 * learner and a teacher lives in what those endpoints allow, not in a second
 * copy of them.
 */

export const STUDENT_SESSION_COOKIE = 'asa_student_session';

export interface SeatContext {
  readonly tenantId: string;
  readonly principalId: string;
  /** A seat has no row in `users`; project ownership rests on the principal. */
  readonly userId: null;
  readonly seatId: string;
  readonly classroomId: string;
  readonly displayName: string;
  readonly safeMode: boolean;
}

interface SeatSessionRow {
  seat_id: string;
  classroom_id: string;
  display_label: string;
  safe_mode: boolean;
}

interface SeatPrincipalRow {
  principal_id: string;
  tenant_id: string;
  classroom_id: string;
}

export class SeatContextUseCase {
  constructor(private readonly pool: pg.Pool | null) {}

  /**
   * Resolves a student cookie, giving the seat its identity the first time it
   * is needed. Returns null for an absent, expired or revoked session, and for
   * a seat the teacher has since suspended or removed — the database function
   * refuses those rather than this code re-deciding the rule.
   */
  async resolve(token: string | undefined): Promise<SeatContext | null> {
    if (!token || !this.pool) return null;
    const session = await this.pool.query(
      `SELECT seat_id, classroom_id, display_label, safe_mode
         FROM classroom_student_session_context($1)`,
      [hashSessionToken(token)],
    );
    const seat = session.rows[0] as SeatSessionRow | undefined;
    if (!seat) return null;

    const principal = await this.pool.query(
      `SELECT principal_id, tenant_id, classroom_id FROM student_seat_principal($1)`,
      [seat.seat_id],
    );
    const row = principal.rows[0] as SeatPrincipalRow | undefined;
    if (!row) return null;

    return {
      tenantId: row.tenant_id,
      principalId: row.principal_id,
      userId: null,
      seatId: seat.seat_id,
      classroomId: row.classroom_id,
      displayName: seat.display_label,
      safeMode: seat.safe_mode,
    };
  }
}
