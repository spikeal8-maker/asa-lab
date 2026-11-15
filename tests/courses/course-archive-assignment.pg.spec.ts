import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, inject, type NestApp } from '../portal/app';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';
import { acquireLearningSubmissionSuiteLock } from './learning-submission-suite-lock';

interface Actor {
  seed: SeededTeacher;
  principalId: string;
  accountId: string;
  cookie: string;
}
interface Fixture {
  actor: Actor;
  classroomId: string;
  courseId: string;
  versionId: string;
  seatId: string;
}
interface Assignment {
  result_code: string;
  run_id: string | null;
  version_number: number | null;
  reused: boolean;
}
interface AssignmentOptions {
  principalId?: string;
  classroomId?: string;
  courseId?: string;
  dueAt?: string | null;
  version?: number;
  zone?: string;
}

let admin: pg.Pool;
let runtime: pg.Pool;
let api: NestApp;
let owner: Actor;
let foreign: Actor;
let releaseSubmissionSuiteLock: (() => Promise<void>) | undefined;
const key = (operation: string) => 'fix08:' + operation + ':' + randomUUID();
const policies = {
  attemptPolicy: { maxAttempts: 1 },
  resultSelectionPolicy: { mode: 'latest_accepted' },
  completionPolicy: { mode: 'accepted' },
  latePolicy: { mode: 'allow_until_close' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'immediate' },
};

async function inTenant<T>(actor: Actor, action: (client: pg.PoolClient) => Promise<T>) {
  const client = await runtime.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [actor.seed.tenantId]);
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function actor(label: string): Promise<Actor> {
  const seed = await seedTeacher(admin, label);
  const identity = (
    await admin.query(
      'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
      [seed.tenantId, seed.teacherId],
    )
  ).rows[0];
  const login = await inject(api, {
    method: 'POST',
    url: '/api/auth/login',
    payload: { workspace: seed.workspace, email: seed.email, password: seed.password },
  });
  expect(login.statusCode, login.body).toBe(200);
  const token = login.cookies.find((cookie) => cookie.name === 'asa_session')?.value;
  expect(token).toBeTruthy();
  return {
    seed,
    principalId: identity.principal_id,
    accountId: identity.account_id,
    cookie: 'asa_session=' + token,
  };
}

beforeAll(async () => {
  // Other existing suites temporarily install submission triggers. Use their
  // established coordination for the non-empty academic-history regression.
  releaseSubmissionSuiteLock = await acquireLearningSubmissionSuiteLock();
  admin = testAdminPool();
  runtime = testAppPool();
  const role = (
    await runtime.query(
      'SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user',
    )
  ).rows[0];
  expect(role).toEqual({ name: 'asalab_app', rolsuper: false, rolbypassrls: false });
  api = await buildTestApp(runtime);
  owner = await actor('course-archive-owner');
  foreign = await actor('course-archive-foreign');
}, 90_000);

afterAll(async () => {
  try {
    if (api) await api.close();
    else await runtime?.end();
    await admin?.end();
  } finally {
    await releaseSubmissionSuiteLock?.();
  }
});

async function seat(actor: Actor, classroomId: string) {
  return (
    await admin.query(
      `INSERT INTO classroom_student_seats
         (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by)
       VALUES($1,$2,'Ученик',$3,$3,true,'active',$4) RETURNING id`,
      [
        actor.seed.tenantId,
        classroomId,
        'fix08-' + randomUUID().replaceAll('-', '').slice(0, 20),
        actor.seed.teacherId,
      ],
    )
  ).rows[0].id as string;
}

async function fixture(actor: Actor = owner, practice = false): Promise<Fixture> {
  const classroomId = (
    await admin.query(
      `INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by)
       VALUES($1,$2,$3,'Архив курса и выдача',$4) RETURNING id`,
      [actor.seed.tenantId, actor.seed.schoolId, actor.seed.periodId, actor.seed.teacherId],
    )
  ).rows[0].id as string;
  await admin.query(
    `INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role)
     VALUES($1,$2,$3,$4,'owner')`,
    [actor.seed.tenantId, classroomId, actor.seed.teacherId, actor.accountId],
  );
  const seatId = await seat(actor, classroomId);
  let activityVersionId: string | null = null;
  if (practice) {
    const created = (
      await inTenant(actor, (client) =>
        client.query(
          `SELECT * FROM learning_activity_create(
             $1,$2,'school','private','project','Сохранённая практика','Соберите модель.',
             'completion',NULL,$3::jsonb,'electronics',NULL,NULL,NULL,$4)`,
          [actor.principalId, actor.seed.tenantId, JSON.stringify(policies), key('activity')],
        ),
      )
    ).rows[0];
    expect(created.result_code).toBe('ok');
    const publication = (
      await inTenant(actor, (client) =>
        client.query('SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)', [
          actor.principalId,
          actor.seed.tenantId,
          created.activity_id,
          key('activity-publish'),
        ]),
      )
    ).rows[0];
    expect(publication.result_code).toBe('ok');
    activityVersionId = publication.activity_version_id;
  }
  const courseId = (
    await inTenant(actor, (client) =>
      client.query(
        "SELECT * FROM course_save_v2($1,$2,NULL,'Курс для архива',NULL,NULL,'private',NULL,$3)",
        [actor.principalId, actor.seed.tenantId, key('course')],
      ),
    )
  ).rows[0].id as string;
  const outline = await inTenant(actor, (client) =>
    client.query('SELECT * FROM course_outline_v3($1,$2,$3,$4)', [
      courseId,
      actor.principalId,
      actor.accountId,
      actor.seed.tenantId,
    ]),
  );
  const sectionId = outline.rows[0].section_id;
  const lesson = (
    await inTenant(actor, (client) =>
      client.query(
        'SELECT course_lesson_save_v3($1,$2,$3,NULL,$4,NULL,$5::jsonb,$6,NULL,15,$7) AS id',
        [
          actor.principalId,
          courseId,
          sectionId,
          practice ? 'Практика с историей' : 'Точное содержание курса',
          JSON.stringify(practice ? [] : [{ id: 'theory', type: 'paragraph', text: 'Теория V1' }]),
          practice ? 'assignment' : 'material',
          activityVersionId,
        ],
      ),
    )
  ).rows[0];
  expect(lesson.id).toBeTruthy();
  const publication = (
    await inTenant(actor, (client) =>
      client.query('SELECT * FROM course_publish_v3($1,$2,course_draft_revision($1,$2),$3)', [
        actor.principalId,
        courseId,
        key('publish'),
      ]),
    )
  ).rows[0];
  expect(publication).toMatchObject({ result_code: 'ok', version_number: 1 });
  return { actor, classroomId, seatId, courseId, versionId: publication.version_id };
}

async function archive(f: Fixture, archived: boolean, client: pg.Pool | pg.PoolClient = runtime) {
  return (
    await client.query('SELECT * FROM course_archive_set($1,$2,$3,course_draft_revision($1,$2))', [
      f.actor.principalId,
      f.courseId,
      archived,
    ])
  ).rows[0] as { result_code: string; draft_revision: number; archived_at: Date | null };
}

async function assign(
  f: Fixture,
  requestId: string,
  options: AssignmentOptions = {},
  client: pg.Pool | pg.PoolClient = runtime,
): Promise<Assignment> {
  const args = [
    options.principalId ?? f.actor.principalId,
    options.classroomId ?? f.classroomId,
    options.courseId ?? f.courseId,
    options.dueAt ?? null,
    options.version ?? 1,
    'whole_class',
    [],
    requestId,
  ];
  return (
    await client.query(
      options.zone === undefined
        ? 'SELECT * FROM classroom_course_run_assign_v3($1,$2,$3,$4,$5,$6,$7::uuid[],$8)'
        : 'SELECT * FROM classroom_course_run_assign_v4($1,$2,$3,$4,$5,$6,$7::uuid[],$8,$9)',
      options.zone === undefined ? args : [...args, options.zone],
    )
  ).rows[0] as Assignment;
}

function requestBody(f: Fixture, requestId: string) {
  return {
    courseId: f.courseId,
    versionNumber: 1,
    dueAt: null,
    audienceType: 'whole_class',
    seatIds: [],
    requestId,
    timeZone: 'Europe/Moscow',
  };
}

function requestAssignment(f: Fixture, requestId: string) {
  return inject(api, {
    method: 'POST',
    url: `/api/classrooms/${f.classroomId}/course-runs`,
    headers: { cookie: f.actor.cookie },
    payload: requestBody(f, requestId),
  });
}

async function protectedState(courseId: string) {
  return (
    await admin.query(
      `WITH runs AS (SELECT * FROM classroom_course_runs WHERE course_id=$1),
       lessons AS (SELECT * FROM classroom_course_run_lessons WHERE run_id IN (SELECT id FROM runs)),
       activities AS (SELECT * FROM activity_runs WHERE source_course_run_id IN (SELECT id FROM runs)),
       enrollments AS (SELECT * FROM course_enrollments WHERE course_run_id IN (SELECT id FROM runs)),
       participations AS (SELECT * FROM activity_participations WHERE activity_run_id IN (SELECT id FROM activities)),
       attempts AS (SELECT * FROM learning_attempts WHERE activity_participation_id IN (SELECT id FROM participations)),
       submissions AS (SELECT * FROM learning_submissions WHERE attempt_id IN (SELECT id FROM attempts))
       SELECT jsonb_build_object(
         'versions',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.id),'[]'::jsonb) FROM course_versions v WHERE course_id=$1),
         'runs',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) FROM runs r),
         'lessons',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]'::jsonb) FROM lessons l),
         'activities',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) FROM activities a),
         'enrollments',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) FROM enrollments e),
         'participations',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb) FROM participations p),
         'attempts',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) FROM attempts a),
         'submissions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb) FROM submissions s),
         'results',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) FROM assessment_results r WHERE attempt_id IN (SELECT id FROM attempts)),
         'projectVersions',(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.id),'[]'::jsonb) FROM project_versions v WHERE id IN (SELECT project_version_id FROM submissions)),
         'gradebook',(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.classroom_assignment_id,g.seat_id),'[]'::jsonb) FROM gradebook_entries g WHERE classroom_assignment_id IN (SELECT classroom_assignment_id FROM lessons))
       ) AS value`,
      [courseId],
    )
  ).rows[0].value as Record<string, Array<Record<string, unknown>>>;
}

async function expectBlocked(blockedPid: number, blockingPid: number) {
  await expect
    .poll(
      async () =>
        (
          await admin.query(
            `SELECT wait_event_type='Lock' AND $2=ANY(pg_blocking_pids(pid)) AS blocked
             FROM pg_stat_activity WHERE pid=$1 AND state='active'`,
            [blockedPid, blockingPid],
          )
        ).rows[0]?.blocked,
      { timeout: 5000, interval: 20 },
    )
    .toBe(true);
}

describe('E1-FIX-08 atomic course archive and assignment', () => {
  it('returns the authorized exact HTTP receipt after archive and rejects a fresh request without partial writes', async () => {
    const f = await fixture();
    const requestId = key('http-replay');
    const first = await requestAssignment(f, requestId);
    expect(first.statusCode, first.body).toBe(201);
    const receipt = first.json<{ runId: string; versionNumber: number; reused: boolean }>();
    expect(receipt).toMatchObject({ versionNumber: 1, reused: false });
    const before = await protectedState(f.courseId);
    const revision = (
      await runtime.query('SELECT course_draft_revision($1,$2) AS revision', [
        owner.principalId,
        f.courseId,
      ])
    ).rows[0].revision;
    expect(await archive(f, true)).toMatchObject({ result_code: 'ok' });
    const archived = await runtime.query('SELECT course_draft_revision($1,$2) AS revision', [
      owner.principalId,
      f.courseId,
    ]);
    expect(Number(archived.rows[0].revision)).toBeGreaterThan(Number(revision));
    const replay = await requestAssignment(f, requestId);
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json()).toEqual({ ...receipt, reused: true });
    const fresh = await requestAssignment(f, key('new-after-archive'));
    expect(fresh.statusCode, fresh.body).toBe(409);
    expect(fresh.json()).toMatchObject({
      error: { code: 'course_archived', message: 'Восстановите курс из архива перед назначением.' },
    });
    expect(await protectedState(f.courseId)).toEqual(before);
    expect(await archive(f, false)).toMatchObject({ result_code: 'ok', archived_at: null });
    expect((await requestAssignment(f, key('after-restore'))).statusCode).toBe(201);
    const after = await protectedState(f.courseId);
    expect(after.runs).toHaveLength(2);
    expect(after.versions).toEqual(before.versions);
    expect(after.runs?.find((run) => run.id === receipt.runId)).toEqual(before.runs?.[0]);
  });

  it.each(['deadline', 'timezone'] as const)(
    'rejects an archived-course replay with a changed %s and leaves the completed receipt intact',
    async (changed) => {
      const f = await fixture();
      const requestId = key('conflict');
      const first = await assign(f, requestId, { zone: 'Europe/Moscow' });
      expect(first.result_code).toBe('ok');
      await archive(f, true);
      const before = await protectedState(f.courseId);
      expect(
        await assign(f, requestId, {
          zone: changed === 'timezone' ? 'UTC' : 'Europe/Moscow',
          ...(changed === 'deadline' ? { dueAt: '2027-05-01T12:00:00Z' } : {}),
        }),
      ).toEqual({
        result_code: changed === 'deadline' ? 'idempotency_conflict' : 'request_conflict',
        run_id: null,
        version_number: null,
        reused: false,
      });
      expect(await protectedState(f.courseId)).toEqual(before);
      expect(await assign(f, requestId, { zone: 'Europe/Moscow' })).toEqual({
        ...first,
        reused: true,
      });
    },
  );

  it.each(['classroom_course_run_assign', 'classroom_course_run_assign_v2', 'v3', 'v4'] as const)(
    'rejects a new archived assignment through the restricted-role %s entry point',
    async (entry) => {
      const f = await fixture();
      await archive(f, true);
      const before = await protectedState(f.courseId);
      const result =
        entry === 'v3' || entry === 'v4'
          ? await assign(f, key('archived'), entry === 'v4' ? { zone: 'UTC' } : {})
          : (
              await runtime.query(`SELECT * FROM ${entry}($1,$2,$3,NULL)`, [
                owner.principalId,
                f.classroomId,
                f.courseId,
              ])
            ).rows[0];
      expect(result).toEqual({
        result_code: 'course_archived',
        run_id: null,
        version_number: null,
        reused: false,
      });
      expect(await protectedState(f.courseId)).toEqual(before);
    },
  );

  it.each(['classroom_course_run_assign', 'classroom_course_run_assign_v2'] as const)(
    'preserves the retained %s delivery and its prior reuse semantics after restore',
    async (entry) => {
      const f = await fixture();
      const legacy = async (dueAt: string) =>
        (
          await runtime.query(`SELECT * FROM ${entry}($1,$2,$3,$4)`, [
            owner.principalId,
            f.classroomId,
            f.courseId,
            dueAt,
          ])
        ).rows[0] as Assignment;
      const first = await legacy('2027-05-01T12:00:00Z');
      expect(first).toMatchObject({ result_code: 'ok', version_number: 1, reused: false });
      const before = await protectedState(f.courseId);
      expect(await archive(f, true)).toMatchObject({ result_code: 'ok' });
      expect(await legacy('2028-05-01T12:00:00Z')).toEqual({
        result_code: 'course_archived',
        run_id: null,
        version_number: null,
        reused: false,
      });
      expect(await protectedState(f.courseId)).toEqual(before);
      expect(await archive(f, false)).toMatchObject({ result_code: 'ok' });
      expect(await legacy('2028-05-01T12:00:00Z')).toEqual({ ...first, reused: true });
      const after = await protectedState(f.courseId);
      expect(after.runs).toHaveLength(1);
      expect(after.runs?.[0]).toMatchObject({ id: first.run_id, course_version_id: f.versionId });
      expect(new Date(after.runs![0]!.due_at as string).toISOString()).toBe(
        '2028-05-01T12:00:00.000Z',
      );
      expect(after.versions).toEqual(before.versions);
      expect(after.lessons).toEqual(before.lessons);
    },
  );

  it('waits for an uncommitted archive and refuses the overlapping new assignment', async () => {
    const f = await fixture();
    const left = await runtime.connect();
    const right = await runtime.connect();
    let open = false;
    let pending: Promise<Assignment> | undefined;
    const before = await protectedState(f.courseId);
    try {
      const leftPid = (await left.query('SELECT pg_backend_pid() AS id')).rows[0].id;
      const rightPid = (await right.query('SELECT pg_backend_pid() AS id')).rows[0].id;
      await left.query('BEGIN');
      open = true;
      expect(await archive(f, true, left)).toMatchObject({ result_code: 'ok' });
      pending = assign(f, key('archive-first'), {}, right);
      void pending.catch(() => undefined);
      await expectBlocked(rightPid, leftPid);
      await left.query('COMMIT');
      open = false;
      expect(await pending).toEqual({
        result_code: 'course_archived',
        run_id: null,
        version_number: null,
        reused: false,
      });
    } finally {
      if (open) await left.query('ROLLBACK');
      await pending?.catch(() => undefined);
      left.release();
      right.release();
    }
    expect(await protectedState(f.courseId)).toEqual(before);
  }, 10000);

  it('holds archive behind an uncommitted assignment and preserves its exact replay and version pin', async () => {
    const f = await fixture();
    const requestId = key('assign-first');
    const left = await runtime.connect();
    const right = await runtime.connect();
    let open = false;
    let pending: ReturnType<typeof archive> | undefined;
    let first: Assignment | undefined;
    try {
      const leftPid = (await left.query('SELECT pg_backend_pid() AS id')).rows[0].id;
      const rightPid = (await right.query('SELECT pg_backend_pid() AS id')).rows[0].id;
      await left.query('BEGIN');
      open = true;
      first = await assign(f, requestId, { zone: 'Europe/Moscow' }, left);
      expect(first).toMatchObject({ result_code: 'ok', version_number: 1, reused: false });
      pending = archive(f, true, right);
      void pending.catch(() => undefined);
      await expectBlocked(rightPid, leftPid);
      await left.query('COMMIT');
      open = false;
      expect(await pending).toMatchObject({ result_code: 'ok' });
    } finally {
      if (open) await left.query('ROLLBACK');
      await pending?.catch(() => undefined);
      left.release();
      right.release();
    }
    const beforeReplay = await protectedState(f.courseId);
    expect(beforeReplay.runs).toHaveLength(1);
    expect(beforeReplay.runs?.[0]).toMatchObject({
      id: first!.run_id,
      course_version_id: f.versionId,
      assignment_timezone: 'Europe/Moscow',
    });
    const replay = await requestAssignment(f, requestId);
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.json()).toEqual({ runId: first!.run_id, versionNumber: 1, reused: true });
    expect(await protectedState(f.courseId)).toEqual(beforeReplay);
  }, 10000);

  it('allows the current exact-class co-teacher receipt but rejects it after staff revocation', async () => {
    const f = await fixture();
    const requestId = key('revoked');
    const first = await requestAssignment(f, requestId);
    expect(first.statusCode, first.body).toBe(201);
    await archive(f, true);
    const before = await protectedState(f.courseId);
    await admin.query(
      "UPDATE classroom_memberships SET member_role='co_teacher' WHERE classroom_id=$1 AND account_id=$2",
      [f.classroomId, owner.accountId],
    );
    const coTeacherReplay = await requestAssignment(f, requestId);
    expect(coTeacherReplay.statusCode, coTeacherReplay.body).toBe(201);
    expect(coTeacherReplay.json()).toEqual({ ...first.json(), reused: true });
    await admin.query('DELETE FROM classroom_memberships WHERE classroom_id=$1 AND account_id=$2', [
      f.classroomId,
      owner.accountId,
    ]);
    const denied = await requestAssignment(f, requestId);
    expect(denied.statusCode, denied.body).toBe(404);
    expect(denied.json()).toMatchObject({ error: { code: 'classroom_not_found' } });
    expect(denied.body).not.toContain(first.json<{ runId: string }>().runId);
    expect(await assign(f, requestId, { zone: 'Europe/Moscow' })).toEqual({
      result_code: 'classroom_not_found',
      run_id: null,
      version_number: null,
      reused: false,
    });
    expect(await protectedState(f.courseId)).toEqual(before);
  });

  it('denies foreign class and course UUIDs before revealing archive or receipt state', async () => {
    const own = await fixture();
    const other = await fixture(foreign);
    const requestId = key('foreign-receipt');
    const first = await assign(own, requestId);
    expect(first.result_code).toBe('ok');
    await archive(own, true);
    await archive(other, true);
    const before = await protectedState(own.courseId);
    const otherBefore = await protectedState(other.courseId);
    expect(await assign(own, requestId, { classroomId: other.classroomId })).toEqual({
      result_code: 'classroom_not_found',
      run_id: null,
      version_number: null,
      reused: false,
    });
    expect(await assign(own, requestId, { courseId: other.courseId })).toEqual({
      result_code: 'course_not_found',
      run_id: null,
      version_number: null,
      reused: false,
    });
    expect(await assign(other, requestId, { courseId: own.courseId })).toEqual({
      result_code: 'course_not_found',
      run_id: null,
      version_number: null,
      reused: false,
    });
    // A receipt from V1 cannot authorize a version absent from this course.
    expect(await assign(own, requestId, { version: 2 })).toEqual({
      result_code: 'course_not_published',
      run_id: null,
      version_number: null,
      reused: false,
    });
    expect(await protectedState(own.courseId)).toEqual(before);
    expect(await protectedState(other.courseId)).toEqual(otherBefore);
  });

  it('preserves non-empty submission and result history, closed runs and withdrawn enrollments across course archive and restore', async () => {
    const f = await fixture(owner, true);
    const withdrawnSeat = await seat(owner, f.classroomId);
    const delivery = await assign(f, key('history'));
    expect(delivery.result_code).toBe('ok');
    const handout = (
      await admin.query(
        'SELECT classroom_assignment_id FROM classroom_course_run_lessons WHERE run_id=$1',
        [delivery.run_id],
      )
    ).rows[0].classroom_assignment_id;
    const learner = (
      await runtime.query('SELECT principal_id FROM student_seat_principal($1)', [f.seatId])
    ).rows[0].principal_id;
    const project = (
      await admin.query(
        `INSERT INTO projects(tenant_id,project_scope,module_key,title,owner_principal_id)
         VALUES($1,'personal','electronics','История курса',$2) RETURNING id`,
        [owner.seed.tenantId, learner],
      )
    ).rows[0].id;
    await admin.query(
      `INSERT INTO project_drafts(tenant_id,project_id,document_json,revision,updated_by_principal_id)
       VALUES($1,$2,$3::jsonb,1,$4)`,
      [
        owner.seed.tenantId,
        project,
        JSON.stringify({ schemaVersion: 1, components: [{ id: 'r1', type: 'resistor' }] }),
        learner,
      ],
    );
    const start = (
      await inTenant(owner, (client) =>
        client.query('SELECT * FROM learning_direct_project_attempt_start($1,$2,$3,$4)', [
          learner,
          f.seatId,
          handout,
          project,
        ]),
      )
    ).rows[0];
    expect(start.result_code).toBe('ok');
    const submission = (
      await inTenant(owner, (client) =>
        client.query('SELECT * FROM learning_direct_project_submission_create($1,$2,$3,$4,1)', [
          learner,
          f.seatId,
          handout,
          key('submission'),
        ]),
      )
    ).rows[0];
    expect(submission.result_code).toBe('ok');
    const review = (
      await inTenant(owner, (client) =>
        client.query(
          "SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,'accepted',NULL,NULL,NULL,NULL,$5)",
          [owner.accountId, owner.principalId, f.classroomId, start.attempt_id, key('review')],
        ),
      )
    ).rows[0];
    expect(review.result_code).toBe('ok');
    const withdrawnEnrollment = (
      await admin.query(
        `SELECT enrollment.id FROM course_enrollments enrollment
         JOIN learner_identity_links link ON link.learner_identity_id=enrollment.learner_identity_id
         WHERE enrollment.course_run_id=$1 AND link.seat_id=$2`,
        [delivery.run_id, withdrawnSeat],
      )
    ).rows[0].id;
    expect(
      (
        await inTenant(owner, (client) =>
          client.query('SELECT * FROM course_enrollment_withdraw($1,$2)', [
            owner.principalId,
            withdrawnEnrollment,
          ]),
        )
      ).rows[0],
    ).toMatchObject({ result_code: 'ok', enrollment_status: 'withdrawn' });
    expect(
      (
        await runtime.query("SELECT classroom_course_run_set_status($1,$2,$3,'closed') AS ok", [
          owner.principalId,
          f.classroomId,
          delivery.run_id,
        ])
      ).rows[0].ok,
    ).toBe(true);
    const before = await protectedState(f.courseId);
    expect(before.submissions).toHaveLength(1);
    expect(before.results).toHaveLength(1);
    expect(before.projectVersions).toHaveLength(1);
    expect(before.gradebook).toHaveLength(1);
    expect(before.runs?.[0]).toMatchObject({ status: 'closed' });
    expect(before.enrollments?.find((entry) => entry.id === withdrawnEnrollment)).toMatchObject({
      status: 'withdrawn',
    });
    for (const archived of [true, false]) {
      expect(await archive(f, archived)).toMatchObject({ result_code: 'ok' });
      const teacherRead = await runtime.query(
        'SELECT * FROM classroom_course_runs_for_teacher_v2($1,$2)',
        [owner.accountId, f.classroomId],
      );
      expect(teacherRead.rows).toEqual([
        expect.objectContaining({
          run_id: delivery.run_id,
          course_version_id: f.versionId,
          run_status: 'closed',
        }),
      ]);
      const learnerRead = await inTenant(owner, (client) =>
        client.query('SELECT * FROM classroom_course_runs_for_seat_v2($1)', [f.seatId]),
      );
      expect(learnerRead.rows).toEqual([
        expect.objectContaining({
          run_id: delivery.run_id,
          course_version_id: f.versionId,
          run_status: 'closed',
        }),
      ]);
      expect(await protectedState(f.courseId)).toEqual(before);
    }
  }, 15000);
});
