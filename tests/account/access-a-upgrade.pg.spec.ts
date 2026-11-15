import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan as applyPlan } from '../migration/isolated-postgres-plan';
import { buildTestApp, inject, type NestApp } from '../portal/app';
import { hashPassword, hashSessionToken } from '../../contexts/identity/dist/index.js';
import { HealthController } from '../../apps/api/dist/health.controller.js';

let root: pg.Client;
let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;
const databaseName = `access_upgrade_${randomBytes(6).toString('hex')}_test`;
let databaseCreated = false;
beforeAll(async () => {
  const source = new URL(process.env['TEST_DATABASE_URL']!);
  const runtimeUrl = new URL(process.env['APP_TEST_DATABASE_URL']!);
  if (
    !source.pathname.endsWith('_test') ||
    runtimeUrl.pathname !== source.pathname ||
    !/^access_upgrade_[a-f0-9]{12}_test$/.test(databaseName)
  )
    throw new Error('Matching isolated test databases required');
  root = new pg.Client({ connectionString: source.href });
  await root.connect();
  await root.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  source.pathname = `/${databaseName}`;
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
  runtimeUrl.pathname = source.pathname;
  runtime = new pg.Pool({ connectionString: runtimeUrl.href, max: 2 });
  // The current application requires the current schema. Seed 0103 through
  // its SQL interfaces and construct the application only after the upgrade.
}, 60000);
afterAll(async () => {
  try {
    if (app) await app.close();
    else await runtime?.end();
    await admin?.end();
    if (databaseCreated) await root.query(`DROP DATABASE "${databaseName}"`);
  } finally {
    await root?.end();
  }
});

it('upgrades a populated 0103 account/class/seat/project and immutable learning evidence without remapping IDs', async () => {
  const unique = randomBytes(10).toString('hex');
  const accountToken = randomBytes(32).toString('hex');
  const registered = await runtime.query<{
    account_id: string;
    principal_id: string;
    workspace_id: string;
    tenant_id: string;
  }>('SELECT * FROM auth_register_account($1,$2,$3,$4,$5::date,$6,$7,$8,12)', [
    `${unique}@upgrade.test`,
    hashPassword(`Strong-${unique}-Password`),
    'Исторический преподаватель',
    `u${unique}`,
    '1990-04-12',
    'RU',
    'adult-v1',
    hashSessionToken(accountToken),
  ]);
  expect(registered.rows).toHaveLength(1);
  const identity = registered.rows[0];
  const account = identity.account_id;
  const cookie = `asa_session=${accountToken}`;
  const accountSession = await runtime.query('SELECT * FROM session_v2_context($1)', [
    hashSessionToken(accountToken),
  ]);
  expect(accountSession.rows[0]).toMatchObject({
    account_id: account,
    principal_id: identity.principal_id,
    workspace_id: identity.workspace_id,
  });
  const attest = await runtime.query('SELECT * FROM auth_self_attest_educator($1)', [account]);
  expect(attest.rows[0]).toEqual({ eligible: true, grant_state: 'provisional', created: true });
  const teacher = await runtime.query<{
    tenant_id: string;
    school_id: string;
    academic_period_id: string;
    user_id: string;
  }>('SELECT * FROM classroom_ensure_personal_teacher($1)', [account]);
  expect(teacher.rows).toHaveLength(1);
  const teaching = teacher.rows[0];
  const classId = randomUUID();
  const classWriter = await runtime.connect();
  try {
    await classWriter.query('BEGIN');
    await classWriter.query("SELECT set_config('app.tenant_id',$1,true)", [teaching.tenant_id]);
    // This is the tenant-scoped repository contract used by schema 0103.
    await classWriter.query(
      `INSERT INTO classrooms
        (id,tenant_id,school_id,academic_period_id,title,age_band,topic_keys,
         safe_mode_default,created_by,idempotency_key)
       VALUES ($1,$2,$3,$4,'Существующий класс','mixed',ARRAY[]::varchar[],true,$5,$6)`,
      [
        classId,
        teaching.tenant_id,
        teaching.school_id,
        teaching.academic_period_id,
        teaching.user_id,
        unique,
      ],
    );
    await classWriter.query(
      `INSERT INTO classroom_memberships (tenant_id,classroom_id,user_id,account_id,member_role)
       VALUES ($1,$2,$3,$4,'owner')`,
      [teaching.tenant_id, classId, teaching.user_id, account],
    );
    await classWriter.query(
      `INSERT INTO classroom_join_codes (tenant_id,classroom_id,token_hash,version,status)
       VALUES ($1,$2,$3,1,'active')`,
      [teaching.tenant_id, classId, hashSessionToken(randomBytes(32).toString('hex'))],
    );
    await classWriter.query('COMMIT');
  } catch (failure) {
    await classWriter.query('ROLLBACK');
    throw failure;
  } finally {
    classWriter.release();
  }
  const teacherAccess = await runtime.query('SELECT * FROM classroom_teacher_access($1,$2)', [
    account,
    classId,
  ]);
  expect(teacherAccess.rows[0]).toMatchObject({
    tenant_id: teaching.tenant_id,
    user_id: teaching.user_id,
    teacher_role: 'owner',
  });
  // Baseline 0103 predates versioned Seat credentials. Seed the historical Seat
  // through the DB contract that existed at that revision; exercising today's
  // controller here would require migrations that intentionally are not present yet.
  const added = await runtime.query(
    `SELECT id FROM classroom_management_add_seat($1,$2,$3,$4,$5)`,
    [account, classId, 'Исторический ученик', 'acd234', true],
  );
  const seatId = added.rows[0].id as string;
  const token = randomBytes(32).toString('hex');
  const code = await admin.query(
    "SELECT token_hash FROM classroom_join_codes WHERE classroom_id=$1 AND status='active'",
    [classId],
  );
  const signedIn = await runtime.query(
    'SELECT * FROM classroom_student_seat_sign_in($1::varchar,$2::varchar,$3::varchar,8)',
    [code.rows[0].token_hash, 'acd234', hashSessionToken(token)],
  );
  expect(signedIn.rows[0]).toMatchObject({ seat_id: seatId, classroom_id: classId });
  const seatCookie = `asa_student_session=${token}`;
  const seatSession = await runtime.query('SELECT * FROM classroom_student_session_context($1)', [
    hashSessionToken(token),
  ]);
  expect(seatSession.rows[0]).toMatchObject({ seat_id: seatId, classroom_id: classId });
  const seatIdentity = await runtime.query('SELECT * FROM student_seat_principal($1)', [seatId]);
  expect(seatIdentity.rows[0]).toMatchObject({
    tenant_id: teaching.tenant_id,
    classroom_id: classId,
  });
  const seatPrincipal = seatIdentity.rows[0].principal_id as string;
  const projectWriter = await runtime.connect();
  let projectId: string;
  try {
    await projectWriter.query('BEGIN');
    await projectWriter.query("SELECT set_config('app.tenant_id',$1,true)", [teaching.tenant_id]);
    const project = await projectWriter.query<{ id: string }>(
      `INSERT INTO projects (tenant_id,project_scope,module_key,title,owner_principal_id,idempotency_key)
       VALUES ($1,'personal','electronics','Работа до обновления',$2,$3) RETURNING id`,
      [teaching.tenant_id, seatPrincipal, `p-${unique}`],
    );
    projectId = project.rows[0].id;
    await projectWriter.query(
      `INSERT INTO project_drafts (tenant_id,project_id,document_json,updated_by_principal_id)
       VALUES ($1,$2,'{"schemaVersion":1,"components":[]}'::jsonb,$3)`,
      [teaching.tenant_id, projectId, seatPrincipal],
    );
    await projectWriter.query('COMMIT');
  } catch (failure) {
    await projectWriter.query('ROLLBACK');
    throw failure;
  } finally {
    projectWriter.release();
  }
  const assignment = await runtime.query<{ id: string }>(
    `SELECT teacher_assignment_save($1,NULL,'Старое задание','Соберите схему','electronics',NULL,NULL,NULL) AS id`,
    [identity.principal_id],
  );
  const assignmentId = assignment.rows[0].id;
  expect(assignmentId).toBeTruthy();
  // Today's HTTP create path passes the post-0168 goal argument. This fixture
  // deliberately runs schema 0103, so seed through its 15-argument SQL contract.
  const teacherSource = (
    await admin.query('SELECT tenant_id,owner_principal_id FROM teacher_assignments WHERE id=$1', [
      assignmentId,
    ])
  ).rows[0];
  expect(teacherSource).toBeTruthy();
  const authored = (
    await admin.query(
      `SELECT * FROM learning_activity_create(
        $1,$2,'personal','private','project','Старое задание','Соберите схему',
        'completion',NULL,$3::jsonb,'electronics',NULL,NULL,$4,$5
      )`,
      [
        teacherSource.owner_principal_id,
        teacherSource.tenant_id,
        JSON.stringify({
          attemptPolicy: { maxAttempts: 1 },
          resultSelectionPolicy: { mode: 'latest' },
          completionPolicy: { mode: 'submission' },
          latePolicy: { mode: 'allow_mark_late' },
          assessmentPolicy: { mode: 'manual' },
          feedbackReleasePolicy: { mode: 'after_review' },
        }),
        assignmentId,
        `access:upgrade:activity:${unique}`,
      ],
    )
  ).rows[0];
  expect(authored.result_code).toBe('ok');
  const version = (
    await admin.query('SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)', [
      teacherSource.owner_principal_id,
      teacherSource.tenant_id,
      authored.activity_id,
      `access:upgrade:publish:${unique}`,
    ])
  ).rows[0];
  expect(version.result_code).toBe('ok');
  const assigned = await runtime.query(
    'SELECT * FROM learning_direct_assignment_create($1,$2,$3,$4,NULL,$5,ARRAY[]::uuid[],$6)',
    [
      identity.principal_id,
      teaching.tenant_id,
      classId,
      version.activity_version_id,
      'whole_class',
      randomUUID(),
    ],
  );
  expect(assigned.rows[0]).toMatchObject({ result_code: 'ok', assigned_count: 1, reused: false });
  // The current assignment read projects safe blocks from schema 0169.
  // Resolve the historical 0103 assignment through its own DB contract.
  const task = (
    await runtime.query('SELECT id,title FROM classroom_assignments_for_seat($1) WHERE title=$2', [
      seatId,
      'Старое задание',
    ])
  ).rows[0] as { id: string; title: string } | undefined;
  expect(task).toBeTruthy();
  expect(task!.id).toBe(assigned.rows[0].classroom_assignment_id);
  // Populate the 0103 fixture with its actual four-argument SQL interfaces.
  // Today's HTTP work handlers require later schema, so they cannot exercise
  // this historical pre-upgrade state. Full 0106→E1 is covered by the Learning suite.
  const started = await runtime.query(
    'SELECT * FROM learning_direct_project_attempt_start($1,$2,$3,$4)',
    [seatPrincipal, seatId, task!.id, projectId],
  );
  expect(started.rows[0].result_code).toBe('ok');
  expect(started.rows[0].project_id).toBe(projectId);
  const submitted = await runtime.query(
    'SELECT * FROM learning_direct_project_submission_create($1,$2,$3,$4)',
    [seatPrincipal, seatId, task!.id, `upgrade-${unique}`],
  );
  expect(submitted.rows[0].result_code).toBe('ok');
  expect(submitted.rows[0]).toMatchObject({
    attempt_id: started.rows[0].attempt_id,
    project_id: projectId,
  });
  vi.stubEnv('ASA_EXPECTED_SCHEMA_VERSION', planMigrations().at(-1)!.version);
  try {
    // The public readiness probe has a 0078 SQL boundary and can independently
    // diagnose 0103. No current authentication controller is started here.
    const code = vi.fn();
    const readiness = await new HealthController(runtime, null).ready({
      code,
    } as unknown as FastifyReply);
    expect(code).toHaveBeenCalledWith(503);
    expect(readiness).toMatchObject({
      status: 'not_ready',
      dependencies: { database: 'up' },
      deployment: {
        schemaVersion: 103,
        expectedSchemaVersion: Number(planMigrations().at(-1)!.version),
        synchronized: false,
      },
    });
  } finally {
    vi.unstubAllEnvs();
  }
  // Mixed upgrade: retain a real institution alongside the historical hidden
  // personal school, not only a clean/new independent context.
  const institution = await runtime.query<{ school_id: string }>(
    'SELECT * FROM auth_create_school_workspace($1,$2)',
    [account, 'Существующая реальная школа'],
  );
  expect(institution.rows).toHaveLength(1);
  const institutionId = institution.rows[0].school_id;
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
    const accessAPlan = planMigrations().filter(
      (m: { version: string }) => Number(m.version) <= 106,
    );
    expect(await applyPlan(client, accessAPlan)).toBe(3);
    expect(await applyPlan(client, accessAPlan)).toBe(0);
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
    [institutionId],
  );
  expect(realContext.rows[0]).toEqual({
    kind: 'school',
    school_id: institutionId,
  });
  expect(
    (
      await admin.query('SELECT owner_account_id FROM learning_contexts WHERE id=$1', [
        context.rows[0].school_id,
      ])
    ).rows[0].owner_account_id,
  ).toBe(account);
  const preservedAccount = await runtime.query('SELECT * FROM session_v2_context($1)', [
    hashSessionToken(accountToken),
  ]);
  expect(preservedAccount.rows[0]).toMatchObject({
    account_id: account,
    principal_id: identity.principal_id,
    workspace_id: identity.workspace_id,
  });
  // 0106 intentionally refuses an old credential-less Seat session. The Seat
  // and its learning history above are unchanged; stale authority is not kept.
  expect(
    (
      await runtime.query('SELECT * FROM classroom_student_session_context($1)', [
        hashSessionToken(token),
      ])
    ).rows,
  ).toEqual([]);

  const submissionSql = `SELECT id,attempt_id,project_id,project_tenant_id,project_version_id,
      payload_manifest,payload_digest,client_request_id,submitted_at,late_state
    FROM learning_submissions WHERE id=$1`;
  const versionSql = `SELECT id,tenant_id,project_id,version_no,document_json,
      created_by_principal_id,created_at FROM project_versions WHERE id=$1`;
  const immutableSubmission = (await admin.query(submissionSql, [submitted.rows[0].submission_id]))
    .rows;
  const immutableVersion = (await admin.query(versionSql, [submitted.rows[0].project_version_id]))
    .rows;
  expect(immutableSubmission).toHaveLength(1);
  expect(immutableVersion).toHaveLength(1);
  const fullUpgrade = await admin.connect();
  try {
    const planned = planMigrations();
    expect(await applyPlan(fullUpgrade, planned)).toBe(
      planned.filter((migration: { version: string }) => Number(migration.version) > 106).length,
    );
    expect(await applyPlan(fullUpgrade, planned)).toBe(0);
  } finally {
    fullUpgrade.release();
  }
  expect((await admin.query(submissionSql, [submitted.rows[0].submission_id])).rows).toEqual(
    immutableSubmission,
  );
  expect((await admin.query(versionSql, [submitted.rows[0].project_version_id])).rows).toEqual(
    immutableVersion,
  );
  const lineage = await admin.query(
    `SELECT s.id AS seat_id,s.classroom_id,p.id AS principal_id,p.account_id,
            project.id AS project_id,project.owner_principal_id,
            attempt.id AS attempt_id,attempt.seat_id AS attempt_seat_id,
            attempt.activity_participation_id
       FROM classroom_student_seats s JOIN principals p ON p.seat_id=s.id
       JOIN projects project ON project.id=$2
       JOIN learning_attempts attempt ON attempt.id=$3 WHERE s.id=$1`,
    [seatId, projectId, started.rows[0].attempt_id],
  );
  expect(lineage.rows[0]).toEqual({
    seat_id: seatId,
    classroom_id: classId,
    principal_id: seatPrincipal,
    account_id: null,
    project_id: projectId,
    owner_principal_id: seatPrincipal,
    attempt_id: started.rows[0].attempt_id,
    attempt_seat_id: seatId,
    activity_participation_id: started.rows[0].participation_id,
  });

  app = await buildTestApp(runtime);
  const currentAccount = await inject(app, {
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie },
  });
  expect(currentAccount.statusCode, currentAccount.body).toBe(200);
  expect(currentAccount.json()).toMatchObject({
    authenticated: true,
    account: { id: account },
    verification: { policyEnabled: false, required: false },
  });
  vi.stubEnv('ASA_EXPECTED_SCHEMA_VERSION', planMigrations().at(-1)!.version);
  try {
    const readiness = await inject(app, { method: 'GET', url: '/health/ready' });
    expect(readiness.statusCode, readiness.body).toBe(200);
    expect(readiness.json().deployment).toMatchObject({
      schemaVersion: Number(planMigrations().at(-1)!.version),
      synchronized: true,
    });
  } finally {
    vi.unstubAllEnvs();
  }
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
  expect(oldLogin.statusCode, oldLogin.body).toBe(200);
  expect(oldLogin.json().authenticated).toBe(false);
}, 60000);
