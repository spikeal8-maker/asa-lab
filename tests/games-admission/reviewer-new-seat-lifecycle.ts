import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { expect, it } from 'vitest';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
import { inject, type NestApp } from '../portal/app';
import type { storageContract } from './storage-contract';

/** Independent insertion/read separation regression. The real StudentCode
 * browser test covers credential entry; this SQL/HTTP contract isolates the
 * lifecycle rule that reads may never repair an existing missing Seat link.
 */
export function newSeatLifecycleContract(
  clients: () => { admin: pg.Pool; runtime: pg.Pool; app: NestApp },
  fixture: ReturnType<typeof storageContract>,
): void {
  it('independent: a new Seat gets one canonical identity at insertion, but deleting its link remains denied on update/read/create', async () => {
    const f = await fixture();
    const { admin, app } = clients();
    // The fixture prepared the original Seat before this one existed. No
    // participant_prepare, audience publication or teacher roster read follows.
    const created = await admin.query<{ id: string }>(
      `SELECT id FROM classroom_management_add_seat($1,$2,'Independent fresh Seat',$3,true)`,
      [f.account, f.classroomId, randomUUID().slice(0, 8)],
    );
    const seatId = created.rows[0]!.id;
    const links = async () =>
      (
        await admin.query(
          `SELECT link.status,link.disabled_at,learner.state AS learner_state
       FROM learner_identity_links link JOIN learner_identities learner ON learner.id=link.learner_identity_id
       WHERE link.seat_id=$1`,
          [seatId],
        )
      ).rows;
    expect(await links()).toEqual([
      { status: 'active', disabled_at: null, learner_state: 'active' },
    ]);
    await admin.query(`UPDATE classroom_student_seats SET status='active' WHERE id=$1`, [seatId]);
    const token = randomUUID().replaceAll('-', '').repeat(2);
    const hash = hashSessionToken(token);
    await admin.query(
      `INSERT INTO classroom_seat_credentials(seat_id,credential_hash,version,last_request_id,issued_by_account_id)
       VALUES($1,$2,1,$3,$4)`,
      [seatId, hash, randomUUID(), f.account],
    );
    await admin.query(
      `INSERT INTO classroom_student_sessions(seat_id,token_hash,expires_at,credential_version)
       VALUES($1,$2,now()+interval '1 hour',1)`,
      [seatId, hash],
    );
    const cookies = { asa_student_session: token };
    const admission = await inject(app, {
      method: 'GET',
      url: '/api/games/access?game=chess',
      cookies,
    });
    expect(admission.statusCode, admission.body).toBe(200);
    expect(admission.json()).toEqual({ granted: true, reason: 'allowed', threshold: null });
    expect(await links()).toHaveLength(1);

    await admin.query('DELETE FROM learner_identity_links WHERE seat_id=$1', [seatId]);
    await admin.query(
      `UPDATE classroom_student_seats SET display_label='Existing Seat with missing link' WHERE id=$1`,
      [seatId],
    );
    expect(await links()).toEqual([]);
    const countProjects = async () =>
      Number(
        (
          await admin.query(
            `SELECT count(*)::int n FROM projects WHERE owner_principal_id IN
       (SELECT id FROM principals WHERE seat_id=$1)`,
            [seatId],
          )
        ).rows[0].n,
      );
    const before = await countProjects();
    for (const game of ['chess', 'checkers']) {
      const denied = await inject(app, {
        method: 'GET',
        url: `/api/games/access?game=${game}`,
        cookies,
      });
      expect(denied.statusCode, denied.body).toBe(200);
      expect(denied.json()).toEqual({
        granted: false,
        reason: 'access_unavailable',
        threshold: null,
      });
      const noCreate = await inject(app, {
        method: 'POST',
        url: '/api/projects',
        cookies,
        headers: { 'idempotency-key': randomUUID() },
        payload: { scope: 'personal', module: game, title: 'Must not repair deleted link' },
      });
      expect(noCreate.statusCode, noCreate.body).toBe(403);
      expect(noCreate.json()).toMatchObject({
        error: { code: 'games_access_denied', reason: 'access_unavailable' },
      });
      expect(await countProjects()).toBe(before);
      expect(await links()).toEqual([]);
    }
  });
}
