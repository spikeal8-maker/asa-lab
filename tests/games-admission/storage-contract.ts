import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { expect, it } from 'vitest';
import { seedTeacher } from '../portal/helpers';
import { evaluateGamesAccess, type GamesPolicySnapshot } from '../../apps/api/src/games-access';

/** Both embedded PostgreSQL and isolated CI use the real migrated classroom,
 * principal, credential, learner-link and participant-metrics implementations.
 * Only the transport differs. No policy/ACL/rating function is stubbed here.
 */
export interface SqlClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
export function storageContract(clients: () => { admin: SqlClient; runtime: SqlClient }) {
  async function fixture() {
    const { admin, runtime } = clients();
    const teacher = await seedTeacher(admin as pg.Pool, `games-${randomUUID().slice(0, 8)}`);
    const identity = (
      await admin.query(
        'SELECT account_id,principal_id FROM legacy_user_account_links WHERE user_id=$1',
        [teacher.teacherId],
      )
    ).rows[0]!;
    const actor = identity['principal_id'] as string;
    const account = identity['account_id'] as string;
    const classroomId = randomUUID();
    await admin.query(
      `INSERT INTO classrooms(id,tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,$4,'Games admission',$5)`,
      [classroomId, teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
    );
    await admin.query(
      `INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner')`,
      [teacher.tenantId, classroomId, teacher.teacherId, account],
    );
    const seatId = (
      await admin.query(`SELECT id FROM classroom_management_add_seat($1,$2,'Learner',$3,true)`, [
        account,
        classroomId,
        randomUUID().slice(0, 8),
      ])
    ).rows[0]!['id'] as string;
    await admin.query(`UPDATE classroom_student_seats SET status='active' WHERE id=$1`, [seatId]);
    await runtime.query('SELECT classroom_participant_prepare($1,$2::uuid[])', [
      actor,
      [classroomId],
    ]);
    const principal = (await admin.query('SELECT id FROM principals WHERE seat_id=$1', [seatId]))
      .rows[0]!['id'] as string;
    const hash = randomUUID().replaceAll('-', '').repeat(2);
    await admin.query(
      `INSERT INTO classroom_seat_credentials(seat_id,credential_hash,version,last_request_id,issued_by_account_id)
      VALUES($1,$2,1,$3,$4)`,
      [seatId, hash, randomUUID(), account],
    );
    await admin.query(
      `INSERT INTO classroom_student_sessions(seat_id,token_hash,expires_at,credential_version) VALUES($1,$2,now()+interval '1 hour',1)`,
      [seatId, hash],
    );
    const fn = async (name: string, params: unknown[]) =>
      (
        await runtime.query(
          `SELECT public.${name}(${params.map((_, i) => `$${i + 1}`).join(',')}) data`,
          params,
        )
      ).rows[0]?.['data'];
    const read = (
      targetSeat: string | null = null,
      targetActor = actor,
      tenant = teacher.tenantId,
      targetClass = classroomId,
    ) => fn('classroom_games_policy_read', [targetActor, tenant, targetClass, targetSeat]);
    const write = (
      action: string,
      input: unknown,
      targetSeat: string | null = null,
      targetActor = actor,
      tenant = teacher.tenantId,
      targetClass = classroomId,
    ) =>
      fn('classroom_games_policy_write', [
        targetActor,
        tenant,
        targetClass,
        targetSeat,
        action,
        JSON.stringify(input),
      ]);
    const snapshot = async (
      args: unknown[] = [principal, teacher.tenantId, classroomId, seatId, hash],
    ) => (await fn('classroom_games_admission_snapshot', args)) as GamesPolicySnapshot | null;
    const decision = async () => evaluateGamesAccess('chess', await snapshot());
    return {
      admin,
      runtime,
      teacher,
      actor,
      account,
      classroomId,
      seatId,
      principal,
      hash,
      read,
      write,
      snapshot,
      decision,
    };
  }

  it('defaults new class/Seat to allow/inherit for both SafeMode values, without storing a policy', async () => {
    const f = await fixture();
    expect(await f.read(f.seatId)).toEqual({
      mode: 'allow',
      threshold: null,
      state: 'active',
      version: 0,
      override: 'inherit',
    });
    for (const safeMode of [false, true]) {
      await f.admin.query('UPDATE classrooms SET safe_mode_default=$2 WHERE id=$1', [
        f.classroomId,
        safeMode,
      ]);
      await f.admin.query('UPDATE classroom_student_seats SET safe_mode=$2 WHERE id=$1', [
        f.seatId,
        safeMode,
      ]);
      expect((await f.decision()).granted).toBe(true);
    }
    expect(
      (
        await f.admin.query(
          'SELECT count(*)::int n FROM classroom_games_policies WHERE classroom_id=$1',
          [f.classroomId],
        )
      ).rows[0]?.['n'],
    ).toBe(0);
  });
  it('persists class deny, explicit Seat allow/deny/inherit, audit/version and soft revoke', async () => {
    const f = await fixture();
    expect(
      await f.write('class', { mode: 'deny', threshold: null, expectedVersion: 0 }),
    ).toMatchObject({ mode: 'deny', version: 1 });
    expect((await f.decision()).reason).toBe('class_disabled');
    await f.write('seat', { override: 'allow', expectedVersion: 1 }, f.seatId);
    expect((await f.decision()).granted).toBe(true);
    await f.write('revoke', { expectedVersion: 2 });
    expect((await f.decision()).reason).toBe('policy_revoked');
    await f.write('class', { mode: 'allow', threshold: null, expectedVersion: 3 });
    await f.write('seat', { override: 'deny', expectedVersion: 4 }, f.seatId);
    expect((await f.decision()).reason).toBe('seat_disabled');
    await f.write('seat', { override: 'inherit', expectedVersion: 5 }, f.seatId);
    expect((await f.decision()).granted).toBe(true);
    const audit = await f.admin.query(
      `SELECT payload_json FROM audit_events WHERE entity_id=$1 AND action LIKE 'classroom.games.%' ORDER BY (payload_json->'after'->>'version')::integer`,
      [f.classroomId],
    );
    expect(audit.rows).toHaveLength(6);
    expect(audit.rows[0]?.['payload_json']).toMatchObject({
      actorId: f.actor,
      before: { version: 0 },
      after: { version: 1 },
    });
    expect(audit.rows[5]?.['payload_json']).toMatchObject({
      after: { version: 6, override: 'inherit' },
    });
  });
  it('uses actual current participant metrics.score/settings/period, equality and null, with no extra rounding', async () => {
    const f = await fixture();
    const canonical = async () =>
      (
        await f.admin.query(
          `SELECT (item->>'score')::numeric score FROM classroom_participant_metrics($1) WHERE item->>'seatId'=$2`,
          [f.classroomId, f.seatId],
        )
      ).rows[0]?.['score'];
    const score = Number(await canonical());
    expect(Number.isFinite(score)).toBe(true);
    // Default canonical zero is a real zero, not a guessed positive school score.
    expect(score).toBe(0);
    await f.write('class', { mode: 'rating_threshold', threshold: score, expectedVersion: 0 });
    expect((await f.snapshot())?.rating).toBe(score);
    expect((await f.decision()).granted).toBe(true);
    await f.write('class', {
      mode: 'rating_threshold',
      threshold: score + 0.001,
      expectedVersion: 1,
    });
    expect((await f.decision()).reason).toBe('rating_below_threshold');
    // A real recent educational project changes the canonical rating. This is
    // not a fake score column or a replacement rating implementation.
    await f.admin.query(
      `UPDATE classroom_participant_settings SET period_days=7 WHERE classroom_id=$1`,
      [f.classroomId],
    );
    await f.admin.query(
      `INSERT INTO projects(tenant_id,project_scope,module_key,title,status,owner_principal_id) VALUES($1,'personal','three-d','Rating source','active',$2)`,
      [f.teacher.tenantId, f.principal],
    );
    const changed = Number(await canonical());
    expect(changed).toBeGreaterThan(score);
    expect((await f.snapshot())?.rating).toBe(changed);
    expect((await f.decision()).granted).toBe(true);
    await f.admin.query(
      `INSERT INTO classroom_participant_settings(classroom_id,period_days,factors) VALUES($1,30,'{"projects":false,"logins":false,"days":false,"time":false,"grades":false}')
      ON CONFLICT(classroom_id) DO UPDATE SET factors=excluded.factors`,
      [f.classroomId],
    );
    expect(await canonical()).toBeNull();
    expect((await f.decision()).reason).toBe('rating_unavailable');
  });
  it('rejects stale class/Seat versions without mutations or extra audit', async () => {
    const f = await fixture();
    const body = { mode: 'deny', threshold: null, expectedVersion: 0 };
    await f.write('class', body);
    expect(await f.write('seat', { override: 'allow', expectedVersion: 0 }, f.seatId)).toEqual({
      error: 'version_conflict',
    });
    expect(await f.write('class', body)).toEqual({ error: 'version_conflict' });
    expect(await f.read(f.seatId)).toMatchObject({ version: 1, override: 'inherit' });
    expect(
      (
        await f.admin.query(
          `SELECT count(*)::int n FROM audit_events WHERE entity_id=$1 AND action LIKE 'classroom.games.%'`,
          [f.classroomId],
        )
      ).rows[0]?.['n'],
    ).toBe(1);
  });
  it('denies other teachers, tenant/class/Seat substitutions and Seat-as-teacher', async () => {
    const f = await fixture();
    const other = await fixture();
    expect(await f.read(null, other.actor)).toBeNull();
    expect(await f.read(null, f.actor, other.teacher.tenantId)).toBeNull();
    expect(await f.read(other.seatId)).toBeNull();
    expect(await f.write('seat', { override: 'allow', expectedVersion: 0 }, other.seatId)).toEqual({
      error: 'forbidden',
    });
    expect(
      await f.write(
        'class',
        { mode: 'allow', threshold: null, expectedVersion: 0 },
        null,
        f.principal,
      ),
    ).toEqual({ error: 'forbidden' });
    for (const args of [
      [other.principal, f.teacher.tenantId, f.classroomId, f.seatId, f.hash],
      [f.principal, other.teacher.tenantId, f.classroomId, f.seatId, f.hash],
      [f.principal, f.teacher.tenantId, other.classroomId, f.seatId, f.hash],
      [f.principal, f.teacher.tenantId, f.classroomId, other.seatId, f.hash],
      [f.actor, f.teacher.tenantId, f.classroomId, f.seatId, f.hash],
    ])
      expect(await f.snapshot(args)).toBeNull();
  });
  it.each(['suspended', 'removed'])('Seat %s overrides explicit allow', async (status) => {
    const f = await fixture();
    await f.write('seat', { override: 'allow', expectedVersion: 0 }, f.seatId);
    await f.admin.query('UPDATE classroom_student_seats SET status=$2 WHERE id=$1', [
      f.seatId,
      status,
    ]);
    expect((await f.decision()).granted).toBe(false);
  });
  it('denies archived class, disabled/hidden/unlinked identity, revoked/expired/stale/rotated sessions', async () => {
    const f = await fixture();
    const changes = [
      [
        `UPDATE classrooms SET status='archived' WHERE id=$1`,
        `UPDATE classrooms SET status='active' WHERE id=$1`,
        f.classroomId,
      ],
      [
        `UPDATE learner_identity_links SET status='inactive',disabled_at=now() WHERE seat_id=$1`,
        `UPDATE learner_identity_links SET status='active',disabled_at=NULL WHERE seat_id=$1`,
        f.seatId,
      ],
      [
        `UPDATE learner_identities SET state='inactive' WHERE id IN (SELECT learner_identity_id FROM learner_identity_links WHERE seat_id=$1)`,
        `UPDATE learner_identities SET state='active' WHERE id IN (SELECT learner_identity_id FROM learner_identity_links WHERE seat_id=$1)`,
        f.seatId,
      ],
      [
        `UPDATE classroom_student_sessions SET revoked_at=now() WHERE seat_id=$1`,
        `UPDATE classroom_student_sessions SET revoked_at=NULL WHERE seat_id=$1`,
        f.seatId,
      ],
      [
        `UPDATE classroom_student_sessions SET expires_at=now()-interval '1 second' WHERE seat_id=$1`,
        `UPDATE classroom_student_sessions SET expires_at=now()+interval '1 hour' WHERE seat_id=$1`,
        f.seatId,
      ],
      [
        `UPDATE classroom_student_sessions SET last_seen_at=now()-interval '61 minutes' WHERE seat_id=$1`,
        `UPDATE classroom_student_sessions SET last_seen_at=now() WHERE seat_id=$1`,
        f.seatId,
      ],
      [
        `UPDATE classroom_seat_credentials SET version=2 WHERE seat_id=$1`,
        `UPDATE classroom_seat_credentials SET version=1 WHERE seat_id=$1`,
        f.seatId,
      ],
    ];
    for (const [disable, restore, id] of changes) {
      await f.admin.query(disable!, [id]);
      expect((await f.decision()).granted, disable).toBe(false);
      await f.admin.query(restore!, [id]);
      expect((await f.decision()).granted, restore).toBe(true);
    }
    await f.admin.query('DELETE FROM learner_identity_links WHERE seat_id=$1', [f.seatId]);
    expect((await f.decision()).granted).toBe(false);
  });
  it('rechecks teacher Account/capability and archived class on writes', async () => {
    const f = await fixture();
    await f.admin.query(`UPDATE classrooms SET status='archived' WHERE id=$1`, [f.classroomId]);
    expect(await f.read()).toBeNull();
    expect(await f.write('class', { mode: 'deny', threshold: null, expectedVersion: 0 })).toEqual({
      error: 'forbidden',
    });
    await f.admin.query(`UPDATE classrooms SET status='active' WHERE id=$1`, [f.classroomId]);
    await f.admin.query(
      `UPDATE capability_grants SET state='revoked' WHERE account_id=$1 AND capability='educator'`,
      [f.account],
    );
    expect(await f.read()).toBeNull();
    expect(await f.write('class', { mode: 'deny', threshold: null, expectedVersion: 0 })).toEqual({
      error: 'forbidden',
    });
  });
  it('linked Account does not replace the selected Seat or confer snapshot authority', async () => {
    const f = await fixture();
    const linked = await fixture();
    await f.admin.query('UPDATE classroom_student_seats SET account_id=$2 WHERE id=$1', [
      f.seatId,
      linked.account,
    ]);
    const learner = (
      await f.admin.query(
        'SELECT learner_identity_id FROM learner_identity_links WHERE seat_id=$1',
        [f.seatId],
      )
    ).rows[0]!['learner_identity_id'];
    await f.admin.query(
      `INSERT INTO learner_identity_links(id,tenant_id,school_id,learner_identity_id,link_kind,account_id)
      VALUES($1,$2,$3,$4,'account',$5)`,
      [randomUUID(), f.teacher.tenantId, f.teacher.schoolId, learner, linked.account],
    );
    await f.write('class', { mode: 'deny', threshold: null, expectedVersion: 0 });
    expect((await f.decision()).reason).toBe('class_disabled');
    expect(
      await f.snapshot([linked.actor, f.teacher.tenantId, f.classroomId, f.seatId, f.hash]),
    ).toBeNull();
  });
  it('runtime cannot read/write protected policy tables or execute private authority helper', async () => {
    const f = await fixture();
    for (const sql of [
      'SELECT * FROM public.classroom_games_policies',
      'SELECT * FROM public.classroom_games_seat_overrides',
      `SELECT public.classroom_games_teacher(NULL,NULL,NULL)`,
      `INSERT INTO public.classroom_games_policies(classroom_id,tenant_id,updated_by) VALUES('${f.classroomId}','${f.teacher.tenantId}','${f.actor}')`,
    ])
      await expect(f.runtime.query(sql)).rejects.toMatchObject({ code: '42501' });
    const functions = await f.admin.query(
      `SELECT proname,proconfig FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'classroom_games_%'`,
    );
    expect(functions.rows).toHaveLength(4);
    for (const row of functions.rows)
      expect(row['proconfig']).toContain('search_path=pg_catalog, pg_temp');
  });
  it('validates threshold/body/version at the DB boundary and enforces CHECK constraints', async () => {
    const f = await fixture();
    for (const input of [
      { mode: 'rating_threshold', threshold: null, expectedVersion: 0 },
      { mode: 'rating_threshold', threshold: 'NaN', expectedVersion: 0 },
      { mode: 'rating_threshold', threshold: 101, expectedVersion: 0 },
      { mode: 'allow', threshold: 1, expectedVersion: 0 },
      { mode: 'allow', threshold: null, expectedVersion: -1 },
      { mode: 'allow', threshold: null, expectedVersion: 0, actor: f.actor },
    ])
      expect(await f.write('class', input)).toEqual({ error: 'invalid_policy' });
    await f.write('class', { mode: 'allow', threshold: null, expectedVersion: 0 });
    await expect(
      f.admin.query(
        `UPDATE classroom_games_policies SET mode='rating_threshold',threshold='NaN' WHERE classroom_id=$1`,
        [f.classroomId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
  return fixture;
}
