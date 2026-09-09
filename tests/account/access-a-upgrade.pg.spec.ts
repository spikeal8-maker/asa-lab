import { afterAll, beforeAll, expect, it } from 'vitest';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
import { buildTestApp, inject, type NestApp } from '../portal/app';
import { hashSessionToken } from '../../contexts/identity/dist/index.js';

let root: pg.Client;
let admin: pg.Pool;
let app: NestApp;
beforeAll(async () => {
  const source = new URL(process.env['TEST_DATABASE_URL']!);
  if (!source.pathname.endsWith('_test'))
    throw new Error('Explicit isolated test database required');
  root = new pg.Client({ connectionString: source.href });
  await root.connect();
  const name = `access_upgrade_${randomBytes(6).toString('hex')}_test`;
  await root.query(`CREATE DATABASE ${name}`);
  source.pathname = `/${name}`;
  admin = new pg.Pool({ connectionString: source.href, max: 2 });
  const client = await admin.connect();
  try {
    await applyPlan(
      client,
      planMigrations().filter((m: { version: string }) => Number(m.version) <= 103),
    );
  } finally {
    client.release();
  }
  const runtime = new URL(process.env['APP_TEST_DATABASE_URL']!);
  runtime.pathname = source.pathname;
  app = await buildTestApp(new pg.Pool({ connectionString: runtime.href, max: 2 }));
}, 60000);
afterAll(async () => {
  await app?.close();
  await admin?.end();
  await root?.end();
});

it('upgrades a populated 0103 account/class/seat/project and immutable learning evidence without remapping IDs', async () => {
  const unique = randomBytes(10).toString('hex');
  const register = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email: `${unique}@upgrade.test`,
      username: `u${unique}`,
      displayName: 'Исторический преподаватель',
      password: `Strong-${unique}-Password`,
      birthDate: '1990-04-12',
      country: 'RU',
    },
  });
  expect(register.statusCode, register.body).toBe(201);
  const account = register.json().user.id;
  const cookie = `asa_session=${register.cookies.find((c) => c.name === 'asa_session')!.value}`;
  const attest = await inject(app, {
    method: 'POST',
    url: '/api/capabilities/educator/self-attest',
    headers: { cookie },
    payload: {},
  });
  expect(attest.statusCode).toBe(201);
  const created = await inject(app, {
    method: 'POST',
    url: '/api/classrooms',
    headers: { cookie, 'idempotency-key': unique },
    payload: {
      title: 'Существующий класс',
      ageBand: 'mixed',
      topicKeys: [],
      safeModeDefault: true,
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const classId = created.json().classroom.id;
  const added = await inject(app, {
    method: 'POST',
    url: `/api/classrooms/${classId}/seats`,
    headers: { cookie },
    payload: {
      displayLabel: 'Исторический ученик',
      loginHandle: 'existing-learner',
      safeMode: true,
    },
  });
  expect(added.statusCode, added.body).toBe(201);
  const seatId = added.json().student.id;
  const token = randomBytes(32).toString('hex');
  const code = await admin.query(
    "SELECT token_hash FROM classroom_join_codes WHERE classroom_id=$1 AND status='active'",
    [classId],
  );
  await admin.query(
    'SELECT * FROM classroom_student_seat_sign_in($1::varchar,$2::varchar,$3::varchar,8)',
    [code.rows[0].token_hash, 'existing-learner', hashSessionToken(token)],
  );
  const seatCookie = `asa_student_session=${token}`;
  const project = await inject(app, {
    method: 'POST',
    url: '/api/projects',
    headers: { cookie: seatCookie, 'idempotency-key': `p-${unique}` },
    payload: { scope: 'personal', module: 'electronics', title: 'Работа до обновления' },
  });
  expect(project.statusCode, project.body).toBe(201);
  const assignment = await inject(app, {
    method: 'POST',
    url: '/api/assignments',
    headers: { cookie },
    payload: {
      title: 'Старое задание',
      brief: 'Соберите схему',
      goal: null,
      moduleKey: 'electronics',
    },
  });
  expect(assignment.statusCode, assignment.body).toBe(201);
  const authored = await inject(app, {
    method: 'POST',
    url: '/api/learning/activities',
    headers: { cookie },
    payload: {
      requestId: crypto.randomUUID(),
      kind: 'project',
      title: 'Старое задание',
      instructions: 'Соберите схему',
      scope: 'personal',
      visibility: 'private',
      sourceTeacherAssignmentId: assignment.json().id,
      resultMode: 'completion',
      maxPoints: null,
      moduleKey: 'electronics',
      policies: {
        attemptPolicy: { maxAttempts: 1 },
        resultSelectionPolicy: { mode: 'latest' },
        completionPolicy: { mode: 'submission' },
        latePolicy: { mode: 'allow_mark_late' },
        assessmentPolicy: { mode: 'manual' },
        feedbackReleasePolicy: { mode: 'after_review' },
      },
    },
  });
  expect(authored.statusCode, authored.body).toBe(201);
  const version = await inject(app, {
    method: 'POST',
    url: `/api/learning/activities/${authored.json().id}/publish`,
    headers: { cookie },
    payload: { expectedRevision: 1, requestId: crypto.randomUUID() },
  });
  expect(version.statusCode, version.body).toBe(201);
  const assigned = await inject(app, {
    method: 'POST',
    url: `/api/classrooms/${classId}/learning/activity-runs`,
    headers: { cookie },
    payload: {
      activityVersionId: version.json().id,
      audienceType: 'whole_class',
      seatIds: [],
      dueAt: null,
      requestId: crypto.randomUUID(),
    },
  });
  expect(assigned.statusCode, assigned.body).toBe(201);
  const assignments = await inject(app, {
    method: 'GET',
    url: '/api/class-join/me/assignments',
    headers: { cookie: seatCookie },
  });
  expect(assignments.statusCode, assignments.body).toBe(200);
  const task = assignments
    .json()
    .items.find((item: { title: string }) => item.title === 'Старое задание');
  expect(task).toBeTruthy();
  const started = await inject(app, {
    method: 'POST',
    url: `/api/class-join/me/assignments/${task.id}/work`,
    headers: { cookie: seatCookie },
    payload: { projectId: project.json().project.id },
  });
  expect(started.statusCode, started.body).toBe(200);
  const submitted = await inject(app, {
    method: 'POST',
    url: `/api/class-join/me/assignments/${task.id}/submit`,
    headers: { cookie: seatCookie },
    payload: { submitted: true, clientRequestId: `upgrade-${unique}` },
  });
  expect(submitted.statusCode, submitted.body).toBe(200);
  // Mixed upgrade: retain a real institution alongside the historical hidden
  // personal school, not only a clean/new independent context.
  const institution = await inject(app, {
    method: 'POST',
    url: '/api/schools',
    headers: { cookie },
    payload: { title: 'Существующая реальная школа' },
  });
  expect(institution.statusCode, institution.body).toBe(201);
  const tables = [
    'accounts',
    'profiles',
    'workspaces',
    'schools',
    'classrooms',
    'classroom_student_seats',
    'personal_teaching_contexts',
    'learner_identities',
    'learner_identity_links',
    'projects',
    'classroom_assignment_work',
    'learning_attempts',
    'learning_submissions',
    'assessment_results',
  ];
  const snapshots = new Map<string, unknown>();
  for (const table of tables) {
    const exists = await admin.query('SELECT to_regclass($1) AS name', [table]);
    if (exists.rows[0].name)
      snapshots.set(
        table,
        (await admin.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`))
          .rows,
      );
  }
  expect((snapshots.get('learner_identities') as unknown[]).length).toBeGreaterThan(0);
  expect((snapshots.get('learning_attempts') as unknown[]).length).toBeGreaterThan(0);
  expect((snapshots.get('learning_submissions') as unknown[]).length).toBeGreaterThan(0);
  const client = await admin.connect();
  try {
    expect(await applyPlan(client, planMigrations())).toBe(3);
    expect(await applyPlan(client, planMigrations())).toBe(0);
  } finally {
    client.release();
  }
  for (const [table, before] of snapshots)
    expect(
      (await admin.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`))
        .rows,
      table,
    ).toEqual(before);
  const context = await admin.query(
    'SELECT lc.kind,lc.legacy_school_id,c.school_id FROM learning_contexts lc JOIN classrooms c ON c.school_id=lc.id WHERE c.id=$1',
    [classId],
  );
  expect(context.rows[0].kind).toBe('independent_teaching');
  expect(context.rows[0].legacy_school_id).toBe(context.rows[0].school_id);
  const realContext = await admin.query(
    'SELECT kind,school_id FROM learning_contexts WHERE id=$1',
    [institution.json().school.schoolId],
  );
  expect(realContext.rows[0]).toEqual({
    kind: 'school',
    school_id: institution.json().school.schoolId,
  });
  const access = await inject(app, {
    method: 'GET',
    url: `/api/classrooms/${classId}/roster`,
    headers: { cookie },
  });
  expect(access.statusCode, access.body).toBe(200);
  expect(access.json().items.some((item: { id: string }) => item.id === seatId)).toBe(true);
  const oldLogin = await inject(app, {
    method: 'GET',
    url: '/api/class-join/me',
    headers: { cookie: seatCookie },
  });
  expect(oldLogin.json().authenticated).toBe(false);
  expect(
    (
      await admin.query('SELECT owner_account_id FROM learning_contexts WHERE id=$1', [
        context.rows[0].school_id,
      ])
    ).rows[0].owner_account_id,
  ).toBe(account);
}, 60000);
