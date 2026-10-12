import { randomUUID } from 'node:crypto';
import { hashSessionToken } from '../../contexts/identity/domain/session-token';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testAdminPool, testAppPool, seedTeacher } from './helpers';
import { buildTestApp, inject, type NestApp } from './app';
import {
  profileTeacherIdentity,
  seedProfileProjectActivity,
  seedProfileTheory,
} from './classroom-profile-fixture';
import type {
  ObservationSummary,
  ObservationProjectsPage,
  ObservationHistoryPage,
} from '../../apps/web/src/classroom-observation-api';

let admin: pg.Pool, runtime: pg.Pool, api: NestApp;
beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  api = await buildTestApp(runtime);
}, 30_000);
afterAll(async () => {
  await api?.close();
  await Promise.all([admin?.end(), runtime?.end()]);
});
async function read<T>(fn: string, args: unknown[]): Promise<T> {
  const result = await runtime.query(
    `SELECT ${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) data`,
    args,
  );
  return result.rows[0]?.data as T;
}
async function fixture(count = 2) {
  const teacher = await seedTeacher(admin, `observation-${randomUUID().slice(0, 8)}`);
  const actor = await profileTeacherIdentity(admin, teacher);
  async function createClass() {
    const id = randomUUID();
    await admin.query(
      'INSERT INTO classrooms(id,tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,$4,$5,$6)',
      [
        id,
        teacher.tenantId,
        teacher.schoolId,
        teacher.periodId,
        `Наблюдение ${id}`,
        teacher.teacherId,
      ],
    );
    await admin.query(
      "INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner')",
      [teacher.tenantId, id, teacher.teacherId, actor.account_id],
    );
    return id;
  }
  const classId = await createClass();
  async function seat(targetClass = classId, accountId: string | null = null) {
    const id = (
      await admin.query('SELECT id FROM classroom_management_add_seat($1,$2,$3,$4,true)', [
        actor.account_id,
        targetClass,
        `Ученик ${randomUUID().slice(0, 6)}`,
        randomUUID().replaceAll('-', '').slice(0, 8),
      ])
    ).rows[0].id as string;
    await admin.query(
      "UPDATE classroom_student_seats SET status='active',account_id=$2 WHERE id=$1",
      [id, accountId],
    );
    expect(await read('classroom_participant_prepare', [actor.principal_id, [targetClass]])).toBe(
      true,
    );
    const principal = (await admin.query('SELECT id FROM principals WHERE seat_id=$1', [id]))
      .rows[0].id as string;
    const token = randomUUID();
    await admin.query(
      "INSERT INTO classroom_student_sessions(seat_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')",
      [id, hashSessionToken(token)],
    );
    return { id, principal, token };
  }
  const seats = [];
  for (let i = 0; i < count; i++) seats.push(await seat());
  const login = await inject(api, {
    method: 'POST',
    url: '/api/auth/login',
    payload: { workspace: teacher.workspace, email: teacher.email, password: teacher.password },
  });
  expect(login.statusCode, login.body).toBe(200);
  const teacherToken = login.cookies.find((c) => c.name === 'asa_session')!.value;
  async function project(
    principal: string,
    module = 'three-d',
    status = 'active',
    targetClass: string | null = null,
    tenant = teacher.tenantId,
  ) {
    const id = randomUUID();
    await admin.query(
      'INSERT INTO projects(id,tenant_id,classroom_id,project_scope,module_key,title,status,owner_principal_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        id,
        tenant,
        targetClass,
        targetClass ? 'classroom' : 'personal',
        module,
        `Работа ${id}`,
        status,
        principal,
      ],
    );
    await admin.query(
      'INSERT INTO project_drafts(project_id,tenant_id,document_json,updated_by_principal_id) VALUES($1,$2,$3::jsonb,$4)',
      [id, tenant, JSON.stringify({ value: 0 }), principal],
    );
    return id;
  }
  const summary = (ids = [classId]) =>
    read<ObservationSummary>('classroom_observation_summary', [actor.principal_id, ids]);
  const projects = (
    filters: {
      module?: string;
      learner?: string;
      search?: string;
      assignment?: string;
      archive?: boolean;
      offset?: number;
      limit?: number;
    } = {},
  ) =>
    read<ObservationProjectsPage>('classroom_observation_projects', [
      actor.principal_id,
      classId,
      filters.module ?? null,
      filters.learner ?? null,
      filters.search ?? null,
      filters.assignment ?? null,
      filters.archive ?? false,
      filters.offset ?? 0,
      filters.limit ?? 30,
    ]);
  const history = (
    category = 'all',
    cursor: string | null = null,
    learner: string | null = null,
  ) => {
    const [before, id] = cursor?.split('|') ?? [];
    return read<ObservationHistoryPage>('classroom_observation_history', [
      actor.principal_id,
      classId,
      learner,
      category,
      null,
      null,
      before ?? null,
      id ?? null,
    ]);
  };
  async function assign(ids: string[]) {
    const version = await seedProfileProjectActivity(admin, teacher, 'Самостоятельная работа');
    const result = (
      await runtime.query(
        "SELECT * FROM learning_direct_assignment_create($1,$2,$3,$4,NULL,'named_learners',$5::uuid[],$6)",
        [actor.principal_id, teacher.tenantId, classId, version, ids, randomUUID()],
      )
    ).rows[0];
    expect(result.result_code).toBe('ok');
    const run = (
      await admin.query('SELECT id FROM activity_runs WHERE source_classroom_assignment_id=$1', [
        result.classroom_assignment_id,
      ])
    ).rows[0].id as string;
    return { assignment: result.classroom_assignment_id as string, run };
  }
  async function start(run: string, pupil = seats[0]!) {
    const response = await inject(api, {
      method: 'POST',
      url: `/api/learning/work/runs/${run}/start`,
      cookies: { asa_student_session: pupil.token },
      payload: { requestId: randomUUID() },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as { projectId: string; attemptId: string; participationId: string };
  }
  return {
    teacher,
    actor,
    classId,
    seats,
    seat,
    createClass,
    teacherToken,
    project,
    summary,
    projects,
    history,
    assign,
    start,
  };
}

describe('classroom observation — real PostgreSQL, restricted runtime and API', () => {
  it('records confirmed first admission transactionally without allocating an identity principal', async () => {
    const f = await fixture(0);
    const id = randomUUID(),
      handle = randomUUID().replaceAll('-', '').slice(0, 8);
    await admin.query(
      `INSERT INTO classroom_student_seats(id,tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by)
       VALUES($1,$2,$3,'Новый ученик',$4,lower($4),true,'issued',$5)`,
      [id, f.teacher.tenantId, f.classId, handle, f.teacher.teacherId],
    );
    const principalCount = async () =>
      Number(
        (await admin.query('SELECT count(*) n FROM principals WHERE seat_id=$1', [id])).rows[0].n,
      );
    expect(await principalCount()).toBe(0);
    const client = await admin.connect();
    async function admit() {
      await client.query(
        "INSERT INTO classroom_student_sessions(seat_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')",
        [id, hashSessionToken(randomUUID())],
      );
      await client.query("UPDATE classroom_student_seats SET status='active' WHERE id=$1", [id]);
    }
    try {
      await client.query('BEGIN');
      await admit();
      expect(
        Number(
          (
            await client.query(
              'SELECT count(*) n FROM classroom_activation_observations WHERE seat_id=$1',
              [id],
            )
          ).rows[0].n,
        ),
      ).toBe(1);
      await client.query('ROLLBACK');
      expect(
        (
          await admin.query('SELECT * FROM classroom_activation_observations WHERE seat_id=$1', [
            id,
          ])
        ).rows,
      ).toEqual([]);
      await client.query('BEGIN');
      await admit();
      await client.query('COMMIT');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect(await principalCount()).toBe(0);
    const history = await f.history('access');
    expect(history.items.filter((event) => event.seatId === id)).toEqual([
      expect.objectContaining({ action: 'seat.activated', byTeacher: false, projectId: null }),
    ]);
    expect(await principalCount()).toBe(0);
    await expect(runtime.query('SELECT * FROM classroom_activation_observations')).rejects.toThrow(
      /permission denied/,
    );
    const outside = await fixture(0);
    expect(
      await read('classroom_observation_history', [
        outside.actor.principal_id,
        f.classId,
        null,
        'all',
        null,
        null,
        null,
        null,
      ]),
    ).toBeNull();
  });

  it('counts a 2-of-30 audience, immutable-origin submission and teacher/self profile identically, without GET side effects', async () => {
    const f = await fixture(30);
    const [a, b] = f.seats;
    const issued = await f.assign([a!.id, b!.id]);
    const work = await f.start(issued.run);
    const revision = (
      await admin.query('SELECT revision FROM project_drafts WHERE project_id=$1', [work.projectId])
    ).rows[0].revision;
    const submit = (
      await runtime.query('SELECT * FROM learning_origin_project_submission_create($1,$2,$3,$4)', [
        a!.principal,
        work.projectId,
        randomUUID(),
        revision,
      ])
    ).rows[0];
    expect(submit.result_code).toBe('ok');
    const summary = await f.summary();
    expect(summary.items[0]).toMatchObject({
      students: 30,
      works: 1,
      assigned: 2,
      submitted: 1,
      waiting: 1,
      notSubmitted: 1,
    });
    const progress = (
      await runtime.query('SELECT * FROM classroom_progress_summary($1,$2)', [
        f.actor.account_id,
        f.classId,
      ])
    ).rows[0];
    expect(progress).toMatchObject({
      assigned_count: 2,
      submitted_count: 1,
      awaiting_review: 1,
      behind_count: 1,
    });
    for (const actor of [f.actor.principal_id, a!.principal]) {
      expect(await read('classroom_participant_profile', [actor, f.classId, a!.id])).toMatchObject({
        assignedCount: 1,
        submittedCount: 1,
        awaitingReview: 1,
      });
    }
    expect(
      await read('classroom_participant_profile', [b!.principal, f.classId, a!.id]),
    ).toBeNull();
    const counts = async () =>
      (
        await admin.query(
          `SELECT (SELECT count(*) FROM learning_attempts WHERE classroom_id=$1) attempts,
      (SELECT count(*) FROM learner_identity_links WHERE tenant_id=$2) links,(SELECT count(*) FROM projects WHERE tenant_id=$2) projects`,
          [f.classId, f.teacher.tenantId],
        )
      ).rows[0];
    const before = await counts();
    for (const endpoint of ['projects', 'history']) {
      const result = await inject(api, {
        method: 'GET',
        url: `/api/classrooms/${f.classId}/observation/${endpoint}`,
        cookies: { asa_session: f.teacherToken },
      });
      expect(result.statusCode, result.body).toBe(200);
    }
    const result = await inject(api, {
      method: 'POST',
      url: '/api/classrooms/observation/summary',
      cookies: { asa_session: f.teacherToken },
      payload: { classroomIds: [f.classId] },
    });
    expect(result.statusCode).toBe(201);
    expect(result.json()).toEqual(summary);
    expect(await counts()).toEqual(before);
    expect(
      (await f.history('projects')).items.some(
        (e) => e.action === 'submission.created' && e.projectId === work.projectId && !e.byTeacher,
      ),
    ).toBe(true);
  }, 60_000);

  it('does not resurrect modern ghost work; preserves whole-class legacy work and stable submission counts after corrections/withdrawal', async () => {
    const f = await fixture(3),
      [a, b, outside] = f.seats;
    const issued = await f.assign([a!.id, b!.id]);
    const ghost = await f.project(outside!.principal);
    await admin.query(
      'INSERT INTO classroom_assignment_work(tenant_id,assignment_id,seat_id,project_id,submitted_at) VALUES($1,$2,$3,$4,now())',
      [f.teacher.tenantId, issued.assignment, outside!.id, ghost],
    );
    expect((await f.summary()).totals).toMatchObject({
      assigned: 2,
      submitted: 0,
      waiting: 0,
      notSubmitted: 2,
    });
    const started = await f.start(issued.run);
    const revision = (
      await admin.query('SELECT revision FROM project_drafts WHERE project_id=$1', [
        started.projectId,
      ])
    ).rows[0].revision;
    expect(
      (
        await runtime.query(
          'SELECT * FROM learning_origin_project_submission_create($1,$2,$3,$4)',
          [a!.principal, started.projectId, randomUUID(), revision],
        )
      ).rows[0].result_code,
    ).toBe('ok');
    const reviewed = (
      await runtime.query(
        "SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,'accepted',NULL,'Готово',NULL,NULL,$5)",
        [f.actor.account_id, f.actor.principal_id, f.classId, started.attemptId, randomUUID()],
      )
    ).rows[0];
    expect(reviewed.result_code).toBe('ok');
    expect((await f.summary()).totals).toMatchObject({
      assigned: 2,
      submitted: 1,
      waiting: 0,
      notSubmitted: 1,
    });
    const correction = (
      await runtime.query(
        "SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,'changes_requested',NULL,'Доработать','Уточнение',$5,$6)",
        [
          f.actor.account_id,
          f.actor.principal_id,
          f.classId,
          started.attemptId,
          reviewed.assessment_result_id,
          randomUUID(),
        ],
      )
    ).rows[0];
    expect(correction.result_code).toBe('ok');
    const revisionWork = await f.start(issued.run);
    expect(revisionWork.attemptId).not.toBe(started.attemptId);
    expect(
      (
        await admin.query('SELECT state FROM learning_attempts WHERE id=$1', [
          revisionWork.attemptId,
        ])
      ).rows[0].state,
    ).toBe('in_progress');
    expect((await f.summary()).totals).toMatchObject({
      assigned: 2,
      submitted: 1,
      waiting: 0,
      notSubmitted: 1,
    });
    expect(
      (
        await runtime.query('SELECT * FROM activity_participation_withdraw($1,$2)', [
          f.actor.principal_id,
          started.participationId,
        ])
      ).rows[0].result_code,
    ).toBe('ok');
    expect((await f.summary()).totals).toMatchObject({
      assigned: 1,
      submitted: 0,
      waiting: 0,
      notSubmitted: 1,
    });
    const otherParticipation = (
      await admin.query(
        "SELECT participation.id FROM activity_participations participation JOIN learner_identity_links link ON link.learner_identity_id=participation.learner_identity_id WHERE participation.activity_run_id=$1 AND link.seat_id=$2 AND link.link_kind='student_seat'",
        [issued.run, b!.id],
      )
    ).rows[0].id;
    expect(
      (
        await runtime.query('SELECT * FROM activity_participation_withdraw($1,$2)', [
          f.actor.principal_id,
          otherParticipation,
        ])
      ).rows[0].result_code,
    ).toBe('ok');
    expect((await f.summary()).totals).toMatchObject({
      assigned: 0,
      submitted: 0,
      waiting: 0,
      notSubmitted: 0,
    });
    const authored = (
      await admin.query(
        "INSERT INTO teacher_assignments(tenant_id,owner_principal_id,title,brief,module_key,visibility) VALUES($1,$2,'Legacy','Build','three-d','private') RETURNING id",
        [f.teacher.tenantId, f.actor.principal_id],
      )
    ).rows[0].id;
    const legacy = (
      await admin.query(
        "INSERT INTO classroom_assignments(tenant_id,classroom_id,assignment_id,status,created_by) VALUES($1,$2,$3,'open',$4) RETURNING id",
        [f.teacher.tenantId, f.classId, authored, f.teacher.teacherId],
      )
    ).rows[0].id;
    await admin.query(
      'INSERT INTO classroom_assignment_work(tenant_id,assignment_id,seat_id,project_id,submitted_at) VALUES($1,$2,$3,$4,now())',
      [f.teacher.tenantId, legacy, outside!.id, ghost],
    );
    expect((await f.summary()).totals).toMatchObject({
      assigned: 3,
      submitted: 1,
      waiting: 1,
      notSubmitted: 2,
    });
  }, 60_000);

  it('counts active/archived supported projects without assignments, applies filters/pages and never leaks denied content', async () => {
    const f = await fixture(),
      a = f.seats[0]!;
    const ids = [];
    for (let i = 0; i < 55; i++) {
      const id = await f.project(a.principal, ['three-d', 'electronics', 'blocks'][i % 3]);
      await admin.query(
        'UPDATE project_drafts SET updated_at=$2::timestamptz WHERE project_id=$1',
        [id, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()],
      );
      ids.push(id);
    }
    const archived = await f.project(a.principal, 'blocks', 'archived');
    await f.project(a.principal, 'chess');
    await f.project(a.principal, 'electronics', 'trashed');
    expect((await f.summary()).totals).toMatchObject({
      works: 56,
      assigned: 0,
      submitted: 0,
      notSubmitted: 0,
    });
    const first = await f.projects({ limit: 50 });
    expect(first.total).toBe(55);
    expect(first.nextOffset).toBe(50);
    expect(first.items.map((p) => p.id)).toEqual(ids.slice(5).reverse());
    const second = await f.projects({ limit: 50, offset: 50 });
    expect(second.items.map((p) => p.id)).toEqual(ids.slice(0, 5).reverse());
    expect(second.nextOffset).toBeNull();
    expect(
      (await f.projects({ archive: true, module: 'blocks' })).items.some((p) => p.id === archived),
    ).toBe(true);
    expect((await f.projects({ search: ids[17] })).items.map((p) => p.id)).toEqual([ids[17]]);
    expect((await f.projects({ assignment: 'assigned' })).items).toEqual([]);
    expect((await f.projects({ learner: f.seats[1]!.id })).items).toEqual([]);
    const accountId = randomUUID(),
      principal = randomUUID();
    await admin.query(
      "INSERT INTO accounts(id,email,password_hash,birth_date,country) VALUES($1,$2,'test','2000-01-01','RU')",
      [accountId, `${accountId}@test.local`],
    );
    await admin.query("INSERT INTO principals(id,kind,account_id) VALUES($1,'account',$2)", [
      principal,
      accountId,
    ]);
    const linked = await f.seat(f.classId, accountId);
    const outsider = await fixture(0);
    const hidden = await f.project(principal, 'three-d', 'active', null, outsider.teacher.tenantId);
    const denied = await f.projects();
    expect(denied.hidden).toBe(1);
    expect(JSON.stringify(denied)).not.toContain(hidden);
    await admin.query(
      "INSERT INTO classroom_activity_events(tenant_id,classroom_id,seat_id,actor_principal_id,action,project_id,project_title) VALUES($1,$2,$3,$4,'project.saved',$5,'PRIVATE SECRET TITLE')",
      [f.teacher.tenantId, f.classId, linked.id, principal, hidden],
    );
    expect(JSON.stringify(await f.history())).not.toContain('PRIVATE SECRET TITLE');
    expect(
      await read('classroom_observation_projects', [
        outsider.actor.principal_id,
        f.classId,
        null,
        null,
        null,
        null,
        true,
        0,
        50,
      ]),
    ).toBeNull();
    expect(
      await read('classroom_observation_summary', [
        f.actor.principal_id,
        [f.classId, outsider.classId],
      ]),
    ).toBeNull();
    await expect(
      runtime.query('SELECT * FROM classroom_observation_obligations($1)', [f.classId]),
    ).rejects.toMatchObject({ code: '42501' });
  }, 60_000);

  it('deduplicates shared Account work across classes, uses active canonical links despite stale account_id and ends revoked authority', async () => {
    const f = await fixture(0),
      accountId = randomUUID(),
      principal = randomUUID();
    await admin.query(
      "INSERT INTO accounts(id,email,password_hash,birth_date,country) VALUES($1,$2,'test','2000-01-01','RU')",
      [accountId, `${accountId}@test.local`],
    );
    await admin.query("INSERT INTO principals(id,kind,account_id) VALUES($1,'account',$2)", [
      principal,
      accountId,
    ]);
    const second = await f.createClass(),
      a = await f.seat(f.classId, accountId),
      b = await f.seat(second, accountId);
    const shared = await f.project(principal);
    await admin.query('UPDATE classroom_student_seats SET account_id=NULL WHERE id=$1', [a.id]);
    expect(await read('classroom_participant_prepare', [principal, [f.classId]])).toBe(true);
    expect(await read('classroom_participant_profile', [principal, f.classId, a.id])).toMatchObject(
      { assignedCount: 0, submittedCount: 0 },
    );
    await admin.query(
      "INSERT INTO product_analytics_events(actor_kind,account_id,principal_id,event_type,outcome,auth_method,ip_address) VALUES('account',$1,$2,'auth.login','succeeded','password','127.0.0.1')",
      [accountId, principal],
    );
    expect((await f.history('access')).items).toEqual([
      expect.objectContaining({ action: 'asa.signed_in', seatId: a.id, byTeacher: false }),
    ]);
    const summary = await f.summary([f.classId, second]);
    expect(summary.items.map((i) => i.works)).toEqual([1, 1]);
    expect(summary.totals.works).toBe(1);
    expect(
      (
        await read<{ metrics: { totalWorks: number } }>('classroom_participant_profile', [
          f.actor.principal_id,
          f.classId,
          a.id,
        ])
      ).metrics.totalWorks,
    ).toBe(1);
    expect((await f.summary()).totals.works).toBe(1);
    await admin.query(
      "UPDATE learner_identity_links SET status='inactive',disabled_at=now() WHERE account_id=$1 AND link_kind='account'",
      [accountId],
    );
    expect((await f.summary([f.classId, second])).totals.works).toBe(0);
    expect(await read('classroom_participant_profile', [principal, f.classId, a.id])).toBeNull();
    // Revoking the Account link never removes the Seat's independent projects.
    await f.project(b.principal);
    expect((await f.summary([f.classId, second])).totals.works).toBe(1);
    expect((await admin.query('SELECT id FROM projects WHERE id=$1', [shared])).rows).toHaveLength(
      1,
    );
  }, 30_000);

  it('merges genuine access/edit events with actor provenance, stable cursor/date filters and no host metadata or invented exits', async () => {
    const f = await fixture(),
      a = f.seats[0]!,
      work = await f.project(a.principal);
    const none = await f.history();
    expect(none.items).toEqual([]); // updated_at is not a sign-in or edit event.
    await runtime.query('SELECT analytics_record_admission_v2($1,$2,$3,$4,true,$5::jsonb,now())', [
      randomUUID(),
      randomUUID(),
      a.id,
      f.classId,
      JSON.stringify({ address: '127.0.0.1', networkKind: 'unknown' }),
    ]);
    await runtime.query('SELECT classroom_student_session_revoke($1)', [hashSessionToken(a.token)]);
    await runtime.query('SELECT analytics_record_admission_v2($1,$2,$3,$4,false,$5::jsonb,now())', [
      randomUUID(),
      randomUUID(),
      a.id,
      f.classId,
      JSON.stringify({ address: '127.0.0.1', networkKind: 'unknown' }),
    ]);
    await admin.query(
      'UPDATE project_drafts SET document_json=$2::jsonb,updated_by_principal_id=$3 WHERE project_id=$1',
      [work, JSON.stringify({ value: 1 }), a.principal],
    );
    await admin.query(
      'UPDATE project_drafts SET document_json=$2::jsonb,updated_by_principal_id=$3 WHERE project_id=$1',
      [work, JSON.stringify({ value: 2 }), f.actor.principal_id],
    );
    const history = await f.history();
    expect(history.items.filter((e) => e.action === 'seat.signed_in')).toHaveLength(1);
    expect(history.items.filter((e) => e.action === 'seat.signed_out')).toHaveLength(1);
    expect(
      history.items
        .filter((e) => e.action === 'project.saved')
        .map((e) => e.byTeacher)
        .sort(),
    ).toEqual([false, true]);
    for (const secret of ['127.0.0.1', 'token', 'password', 'email', 'address', 'networkKind'])
      expect(JSON.stringify(history)).not.toContain(secret);
    expect((await f.history('access')).items.every((e) => e.projectId === null)).toBe(true);
    expect((await f.history('projects')).items.every((e) => e.projectId === work)).toBe(true);
    expect((await f.history('all', null, f.seats[1]!.id)).items).toEqual([]);
    // Equal timestamps still page exactly by source-qualified id, not only time.
    for (let i = 0; i < 55; i++)
      await admin.query(
        "INSERT INTO classroom_activity_events(tenant_id,classroom_id,seat_id,actor_principal_id,action,occurred_at) VALUES($1,$2,$3,$4,'seat.signed_in','2026-10-01T12:00:00Z')",
        [f.teacher.tenantId, f.classId, a.id, a.principal],
      );
    const first = await f.history(),
      second = await f.history('all', first.nextCursor);
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    expect(new Set([...first.items, ...second.items].map((e) => e.id)).size).toBe(
      first.items.length + second.items.length,
    );
    const dateFiltered = await read<ObservationHistoryPage>('classroom_observation_history', [
      f.actor.principal_id,
      f.classId,
      null,
      'all',
      '2026-10-01T00:00:00Z',
      '2026-10-02T00:00:00Z',
      null,
      null,
    ]);
    expect(dateFiltered.items).toHaveLength(50);
    const outsider = await fixture(0);
    expect(
      await read('classroom_observation_history', [
        outsider.actor.principal_id,
        f.classId,
        null,
        'all',
        null,
        null,
        null,
        null,
      ]),
    ).toBeNull();
  }, 60_000);

  it('counts named-audience theory as a completion obligation without manufacturing projects or pending review', async () => {
    const f = await fixture(),
      a = f.seats[0]!;
    const theory = await seedProfileTheory(admin, f.teacher, f.classId, [a.id]);
    expect((await f.summary()).totals).toMatchObject({
      assigned: 1,
      works: 0,
      submitted: 0,
      waiting: 0,
      notSubmitted: 1,
    });
    await admin.query(
      'INSERT INTO classroom_course_lesson_progress(tenant_id,run_id,lesson_id,seat_id) VALUES($1,$2,$3,$4)',
      [f.teacher.tenantId, theory.courseRunId, theory.lessonId, a.id],
    );
    expect((await f.summary()).totals).toMatchObject({
      assigned: 1,
      works: 0,
      submitted: 1,
      waiting: 0,
      notSubmitted: 0,
    });
    await f.assign([a.id]);
    const compatibility = await inject(api, {
      method: 'GET',
      url: `/api/classrooms/${f.classId}/students/${a.id}`,
      cookies: { asa_session: f.teacherToken },
    });
    expect(compatibility.statusCode, compatibility.body).toBe(200);
    expect(compatibility.json()).toMatchObject({
      submittedCount: 1,
      awaitingReview: 0,
      student: { assignedCount: 2, submittedCount: 1, awaitingReview: 0 },
    });
    expect((await f.summary()).totals).toMatchObject({
      assigned: 2,
      submitted: 1,
      waiting: 0,
      notSubmitted: 0,
    });
  }, 30_000);
});
