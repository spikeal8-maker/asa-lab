import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';
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
    // The canonical creation command materializes a genuinely new StudentCode
    // Seat, before sign-in or any teacher roster/participant preparation.
    expect(
      (
        await admin.query(
          `SELECT count(*)::int n FROM learner_identity_links link
       JOIN learner_identities learner ON learner.id=link.learner_identity_id
       WHERE link.seat_id=$1 AND link.link_kind='student_seat' AND link.status='active'
         AND link.disabled_at IS NULL AND learner.state='active'
         AND link.tenant_id=$2 AND learner.tenant_id=$2
         AND link.school_id=$3 AND learner.school_id=$3`,
          [seatId, teacher.tenantId, teacher.schoolId],
        )
      ).rows[0]?.['n'],
    ).toBe(1);
    // The creation command must also make the principal available immediately.
    // A fixture must not conceal a teacher-first lifecycle defect by calling
    // student_seat_principal or participant_prepare before checking its result.
    const principals = await admin.query(
      'SELECT id,kind,account_id FROM principals WHERE seat_id=$1',
      [seatId],
    );
    expect(principals.rows).toEqual([
      expect.objectContaining({ kind: 'student_seat', account_id: null }),
    ]);
    const principal = principals.rows[0]!['id'] as string;
    expect(typeof principal).toBe('string');
    await admin.query(`UPDATE classroom_student_seats SET status='active' WHERE id=$1`, [seatId]);
    const token = randomUUID().replaceAll('-', '').repeat(2);
    const hash = hashSessionToken(token);
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
      token,
      read,
      write,
      snapshot,
      decision,
    };
  }

  it.each([false, true])(
    'makes a new issued Seat immediately visible to teacher metrics/profile (dynamic audience=%s)',
    async (dynamicAudience) => {
      const f = await fixture();
      let audienceId: string | null = null;
      let runId: string | null = null;
      if (dynamicAudience) {
        // Use the existing whole-class audience command and its real AFTER INSERT
        // lifecycle. The new Seat below must receive a principal even when that
        // trigger has already materialized the learner before INSERT returns.
        const courseId = (
          await f.admin.query(
            `INSERT INTO courses(tenant_id,owner_principal_id,title,visibility)
           VALUES($1,$2,'Principal lifecycle course','private') RETURNING id`,
            [f.teacher.tenantId, f.actor],
          )
        ).rows[0]!['id'] as string;
        const versionId = (
          await f.admin.query(
            `INSERT INTO course_versions(tenant_id,course_id,version_number,title,outline,content_hash,published_by_principal_id)
           VALUES($1,$2,1,'Principal lifecycle course','{"sections":[]}'::jsonb,$3,$4) RETURNING id`,
            [f.teacher.tenantId, courseId, randomUUID().replaceAll('-', ''), f.actor],
          )
        ).rows[0]!['id'] as string;
        runId = (
          await f.admin.query(
            `INSERT INTO classroom_course_runs(tenant_id,classroom_id,course_id,course_version_id,title,version_number,assigned_by_principal_id)
           VALUES($1,$2,$3,$4,'Principal lifecycle course',1,$5) RETURNING id`,
            [f.teacher.tenantId, f.classroomId, courseId, versionId, f.actor],
          )
        ).rows[0]!['id'] as string;
        // The explicit dependency on scope also orders set_config before the
        // restricted runtime command within this one SQL statement/transaction.
        const created = await f.runtime.query(
          `WITH scope AS MATERIALIZED (SELECT set_config('app.tenant_id',$1,true) tenant_id)
         SELECT result.* FROM scope CROSS JOIN LATERAL public.learning_audience_create(
           $2,'course_run',$3,'whole_class','dynamic',ARRAY[]::uuid[],
           scope.tenant_id || ':games:' || $4::text) result`,
          [f.teacher.tenantId, f.actor, runId, randomUUID()],
        );
        expect(created.rows[0]).toMatchObject({ result_code: 'ok', reused: false });
        audienceId = created.rows[0]!['audience_id'] as string;
        expect(typeof audienceId).toBe('string');
      }
      const issued = (
        await f.runtime.query(
          `SELECT id,status FROM public.classroom_management_add_seat($1,$2,'Teacher-first learner',$3,true)`,
          [f.account, f.classroomId, randomUUID().slice(0, 8)],
        )
      ).rows[0]!;
      const seatId = issued['id'] as string;
      expect(issued['status']).toBe('issued');
      const identityState = async () =>
        (
          await f.admin.query(
            `SELECT
          (SELECT jsonb_agg(jsonb_build_object('id',principal.id,'kind',principal.kind,'accountId',principal.account_id) ORDER BY principal.id)
             FROM principals principal WHERE principal.seat_id=$1) principals,
          (SELECT jsonb_agg(jsonb_build_object('id',link.id,'learnerId',learner.id,'kind',link.link_kind,
              'status',link.status,'disabledAt',link.disabled_at,'state',learner.state,
              'tenantId',link.tenant_id,'schoolId',link.school_id,
              'learnerTenantId',learner.tenant_id,'learnerSchoolId',learner.school_id) ORDER BY link.id)
             FROM learner_identity_links link JOIN learner_identities learner ON learner.id=link.learner_identity_id
             WHERE link.seat_id=$1) links,
          (SELECT count(*)::int FROM classroom_student_sessions WHERE seat_id=$1) sessions,
          (SELECT count(*)::int FROM classroom_seat_credentials WHERE seat_id=$1) credentials`,
            [seatId],
          )
        ).rows[0]!;
      const before = await identityState();
      expect(before).toEqual({
        principals: [{ id: expect.any(String), kind: 'student_seat', accountId: null }],
        links: [
          {
            id: expect.any(String),
            learnerId: expect.any(String),
            kind: 'student_seat',
            status: 'active',
            disabledAt: null,
            state: 'active',
            tenantId: f.teacher.tenantId,
            schoolId: f.teacher.schoolId,
            learnerTenantId: f.teacher.tenantId,
            learnerSchoolId: f.teacher.schoolId,
          },
        ],
        sessions: 0,
        credentials: 0,
      });
      // These are teacher-authorized reads before prepare, principal resolution,
      // credential issuance or the pupil's first login. Zero work must be real.
      const roster = (
        await f.runtime.query('SELECT public.classroom_participant_roster($1,$2) data', [
          f.actor,
          f.classroomId,
        ])
      ).rows[0]!['data'] as { items: Record<string, unknown>[] };
      expect(roster.items.find((item) => item['seatId'] === seatId)).toMatchObject({
        seatId,
        totalWorks: 0,
        archivedWorks: 0,
      });
      const profile = (
        await f.runtime.query('SELECT public.classroom_participant_profile($1,$2,$3) data', [
          f.actor,
          f.classroomId,
          seatId,
        ])
      ).rows[0]!['data'];
      expect(profile).toMatchObject({
        student: { id: seatId, status: 'issued' },
        metrics: { seatId, totalWorks: 0, archivedWorks: 0 },
        submittedCount: 0,
        awaitingReview: 0,
      });
      expect(await identityState()).toEqual(before);
      const membershipState = async () =>
        (
          await f.admin.query(
            `SELECT claim.id,claim.learner_identity_id,claim.course_enrollment_id,
          enrollment.status,enrollment.assignment_source
         FROM learning_audience_membership_claims claim
         JOIN course_enrollments enrollment ON enrollment.id=claim.course_enrollment_id
         JOIN learner_identity_links link ON link.learner_identity_id=claim.learner_identity_id
         WHERE claim.audience_id=$1 AND enrollment.course_run_id=$2 AND link.seat_id=$3`,
            [audienceId, runId, seatId],
          )
        ).rows;
      const membership = dynamicAudience ? await membershipState() : [];
      if (dynamicAudience)
        expect(membership).toEqual([
          expect.objectContaining({ status: 'assigned', assignment_source: 'whole_class_dynamic' }),
        ]);
      expect(
        (
          await f.runtime.query(
            'SELECT public.classroom_participant_prepare($1,$2::uuid[]) prepared',
            [f.actor, [f.classroomId]],
          )
        ).rows[0]!['prepared'],
      ).toBe(true);
      // A subsequent canonical teacher preparation preserves the exact identities
      // and audience materialization, rather than repairing or duplicating them.
      expect(await identityState()).toEqual(before);
      if (dynamicAudience) expect(await membershipState()).toEqual(membership);
    },
  );

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
  it('materializes new batch Seats once, preserving code case and no repair on replay, duplicate or reissue', async () => {
    const f = await fixture();
    const requestId = randomUUID();
    const students = JSON.stringify([
      { displayLabel: 'First batch learner', safeMode: true },
      { displayLabel: 'Second batch learner', safeMode: false },
    ]);
    const prepare = async (request = requestId, input = students) =>
      (
        await f.runtime.query(
          'SELECT * FROM public.classroom_student_seat_batch_prepare_v2($1,$2,$3,$4::jsonb)',
          [f.account, f.classroomId, request, input],
        )
      ).rows;
    const commit = async (request = requestId, input = students) =>
      (
        await f.runtime.query(
          'SELECT * FROM public.classroom_student_seat_batch_commit_v2($1,$2,$3,$4::jsonb)',
          [f.account, f.classroomId, request, input],
        )
      ).rows;
    // Current batch preparation generates and reserves codes. Explicit codes
    // are deliberately not part of its input contract.
    const prepared = await prepare();
    expect(prepared).toHaveLength(2);
    expect(
      prepared.map((row) => [
        row['result_code'],
        row['reused'],
        row['row_status'],
        row['reason_code'],
      ]),
    ).toEqual([
      ['ok', false, 'valid', 'ready'],
      ['ok', false, 'valid', 'ready'],
    ]);
    const codes = prepared.map((row) => row['login_handle'] as string);
    for (const code of codes) expect(code).toMatch(/^[A-Za-z0-9]{6}$/);
    expect(new Set(codes).size).toBe(2);
    const created = await commit();
    expect(created).toHaveLength(2);
    expect(
      created.map((row) => [
        row['result_code'],
        row['reused'],
        row['row_status'],
        row['login_handle'],
        row['safe_mode'],
      ]),
    ).toEqual([
      ['ok', false, 'created', codes[0], true],
      ['ok', false, 'created', codes[1], false],
    ]);
    const seatIds = created.map((row) => row['seat_id'] as string);
    const batchPrincipals = (
      await f.admin.query(
        'SELECT id,seat_id,kind,account_id FROM principals WHERE seat_id=ANY($1::uuid[])',
        [seatIds],
      )
    ).rows;
    expect(batchPrincipals).toHaveLength(2);
    expect(new Set(batchPrincipals.map((row) => row['seat_id']))).toEqual(new Set(seatIds));
    expect(new Set(batchPrincipals.map((row) => row['id'])).size).toBe(2);
    for (const principal of batchPrincipals)
      expect(principal).toMatchObject({ kind: 'student_seat', account_id: null });
    const links = async (targetSeats = seatIds) =>
      (
        await f.admin.query(
          `SELECT link.seat_id,link.learner_identity_id FROM learner_identity_links link
       JOIN learner_identities learner ON learner.id=link.learner_identity_id
       WHERE link.seat_id=ANY($1::uuid[]) AND link.status='active' AND link.disabled_at IS NULL
         AND learner.state='active' AND link.tenant_id=$2 AND learner.tenant_id=$2
         AND link.school_id=$3 AND learner.school_id=$3`,
          [targetSeats, f.teacher.tenantId, f.teacher.schoolId],
        )
      ).rows;
    const initialLinks = await links();
    expect(initialLinks).toHaveLength(2);
    expect(new Set(initialLinks.map((row) => row['learner_identity_id'])).size).toBe(2);
    await f.admin.query('DELETE FROM learner_identity_links WHERE seat_id=$1', [seatIds[0]]);
    expect(
      (await commit()).map((row) => [row['reused'], row['seat_id'], row['login_handle']]),
    ).toEqual([
      [true, seatIds[0], codes[0]],
      [true, seatIds[1], codes[1]],
    ]);
    expect(await links()).toHaveLength(1);

    // Interleave a real canonical creation after another request has reserved
    // its code. Commit must take the existing-Seat duplicate path without
    // recreating a link removed from that Seat.
    const duplicateRequest = randomUUID();
    const duplicateStudents = JSON.stringify([
      { displayLabel: 'Interleaved learner', safeMode: true },
    ]);
    const reserved = await prepare(duplicateRequest, duplicateStudents);
    expect(reserved).toHaveLength(1);
    expect(reserved[0]).toMatchObject({ result_code: 'ok', row_status: 'valid', reused: false });
    const duplicateCode = reserved[0]!['login_handle'] as string;
    expect(duplicateCode).toMatch(/^[A-Za-z0-9]{6}$/);
    const existing = (
      await f.runtime.query(
        `SELECT id FROM public.classroom_management_add_seat($1,$2,'Interleaved learner',$3,true)`,
        [f.account, f.classroomId, duplicateCode],
      )
    ).rows[0]!['id'] as string;
    expect(await links([existing])).toHaveLength(1);
    await f.admin.query('DELETE FROM learner_identity_links WHERE seat_id=$1', [existing]);
    expect(await commit(duplicateRequest, duplicateStudents)).toEqual([
      expect.objectContaining({
        result_code: 'ok',
        reused: false,
        row_status: 'duplicate',
        reason_code: 'existing_same_seat',
        seat_id: existing,
        login_handle: duplicateCode,
      }),
    ]);
    expect(await links([existing])).toHaveLength(0);
    expect(await links()).toHaveLength(1);
    const issued = await f.runtime.query(
      'SELECT result_code FROM public.classroom_seat_credential_issue($1,$2,$3,$4,$5)',
      [
        f.account,
        f.classroomId,
        seatIds[0],
        hashSessionToken('ReissuedNewCredential'),
        randomUUID(),
      ],
    );
    expect(issued.rows[0]?.['result_code']).toBe('issued');
    expect(await links()).toHaveLength(1);
    expect(
      (
        await f.admin.query('SELECT count(*)::int n FROM learner_identity_links WHERE seat_id=$1', [
          seatIds[0],
        ])
      ).rows[0]?.['n'],
    ).toBe(0);

    // Case-sensitive explicit codes belong to the single-Seat constructor,
    // which both canonical issuance paths share. They remain distinct.
    const explicitIds: string[] = [];
    for (const code of ['AbC234', 'aBc234']) {
      const row = (
        await f.runtime.query(
          `SELECT id,login_handle FROM public.classroom_management_add_seat($1,$2,'Case learner',$3,true)`,
          [f.account, f.classroomId, code],
        )
      ).rows[0]!;
      expect(row['login_handle']).toBe(code);
      explicitIds.push(row['id'] as string);
    }
    expect(new Set(explicitIds).size).toBe(2);
    const explicitLinks = await links(explicitIds);
    expect(explicitLinks).toHaveLength(2);
    expect(new Set(explicitLinks.map((row) => row['learner_identity_id'])).size).toBe(2);
  });
  it('keeps raw historical Seat rows unmaterialized and preserves the reserved Account-code validation', async () => {
    const f = await fixture();
    const rawId = randomUUID();
    const code = `raw${randomUUID().slice(0, 6)}`;
    await f.admin.query(
      `INSERT INTO classroom_student_seats(id,tenant_id,classroom_id,display_label,
       login_handle,normalized_login_handle,safe_mode,status,created_by)
       VALUES($1,$2,$3,'Existing raw Seat',$4,$4,true,'issued',$5)`,
      [rawId, f.teacher.tenantId, f.classroomId, code, f.teacher.teacherId],
    );
    await f.admin.query(`UPDATE classroom_student_seats SET status='active' WHERE id=$1`, [rawId]);
    await f.runtime.query('SELECT principal_id FROM public.student_seat_principal($1)', [rawId]);
    expect(
      (
        await f.admin.query('SELECT count(*)::int n FROM learner_identity_links WHERE seat_id=$1', [
          rawId,
        ])
      ).rows[0]?.['n'],
    ).toBe(0);
    const countSeats = async () =>
      (
        await f.admin.query(
          'SELECT count(*)::int n FROM classroom_student_seats WHERE classroom_id=$1',
          [f.classroomId],
        )
      ).rows[0]?.['n'];
    const before = await countSeats();
    await expect(
      f.runtime.query(
        `SELECT * FROM public.classroom_management_add_seat($1,$2,'Invalid Account handle','acc:abcd',true)`,
        [f.account, f.classroomId],
      ),
    ).rejects.toThrow('invalid student code');
    expect(await countSeats()).toBe(before);
    await expect(
      f.runtime.query('SELECT public.learning_audience_ensure_seat_identity($1)', [rawId]),
    ).rejects.toMatchObject({ code: '42501' });
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
    expect(functions.rows.map((row) => row['proname']).sort()).toEqual([
      'classroom_games_admission_lock',
      'classroom_games_admission_snapshot',
      'classroom_games_policy_read',
      'classroom_games_policy_write',
      'classroom_games_teacher',
      'classroom_games_teacher_seat_snapshot',
    ]);
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
