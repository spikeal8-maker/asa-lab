import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import type { PersonalProgressSummaryV1 } from '@asa-lab/contracts';
import { planMigrations } from '../../tools/migrate.mjs';
import { seedTeacher } from '../portal/helpers';
import { applyIsolatedTestPlan } from './isolated-postgres-plan';

const enabled =
  process.env['CI'] === 'true' &&
  !!process.env['TEST_DATABASE_URL'] &&
  !!process.env['APP_TEST_DATABASE_URL'];
type Sql = pg.Pool | pg.PoolClient;
type Plan = ReturnType<typeof planMigrations>;

async function withDatabase(
  prefixOnly: boolean,
  run: (admin: pg.Pool, runtime: pg.Pool, plan: Plan) => Promise<void>,
) {
  const source = new URL(process.env['TEST_DATABASE_URL']!);
  const appSource = new URL(process.env['APP_TEST_DATABASE_URL']!);
  if (
    !decodeURIComponent(source.pathname).endsWith('_test') ||
    appSource.pathname !== source.pathname ||
    appSource.host !== source.host
  ) {
    throw new Error('Matching isolated *_test PostgreSQL URLs are required');
  }
  const name = `asa_account_join_${randomUUID().replaceAll('-', '')}_test`;
  const owner = new pg.Client({ connectionString: source.toString() });
  let created = false;
  let admin: pg.Pool | undefined;
  let runtime: pg.Pool | undefined;
  try {
    await owner.connect();
    await owner.query(`CREATE DATABASE "${name}"`);
    created = true;
    source.pathname = appSource.pathname = '/' + name;
    admin = new pg.Pool({ connectionString: source.toString(), max: 5 });
    runtime = new pg.Pool({ connectionString: appSource.toString(), max: 5 });
    // This regression owns the 0320 -> 0321 boundary, not the forever-latest
    // migration. Existing full-plan upgrade fixtures cover subsequent tails.
    const plan = planMigrations().filter((item) => Number(item.version) <= 321);
    expect(plan.find((item) => item.version === '0321')?.file).toBe(
      '0321_account_join_learner_identity.sql',
    );
    await upgrade(admin, prefixOnly ? plan.filter((item) => Number(item.version) <= 320) : plan);
    expect(
      (
        await runtime.query(
          'SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user',
        )
      ).rows,
    ).toEqual([{ name: 'asalab_app', rolsuper: false, rolbypassrls: false }]);
    await run(admin, runtime, plan);
  } finally {
    await Promise.all([runtime?.end(), admin?.end()]);
    try {
      if (created) await owner.query(`DROP DATABASE "${name}"`);
    } finally {
      await owner.end();
    }
  }
}

async function upgrade(admin: pg.Pool, plan: Plan) {
  const client = await admin.connect();
  try {
    return await applyIsolatedTestPlan(client, plan);
  } finally {
    client.release();
  }
}

async function teacher(admin: pg.Pool) {
  const result = await seedTeacher(admin, `join-upgrade-${randomUUID().slice(0, 8)}`);
  const actor = (
    await admin.query<{ account_id: string; principal_id: string }>(
      'SELECT account_id,principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
      [result.tenantId, result.teacherId],
    )
  ).rows[0]!;
  return { ...result, accountId: actor.account_id, principalId: actor.principal_id };
}
type Teacher = Awaited<ReturnType<typeof teacher>>;

async function account(admin: pg.Pool, principal = true) {
  const id = randomUUID();
  await admin.query(
    `INSERT INTO accounts(id,email,password_hash,birth_date,country)
     VALUES($1,$2,'isolated-no-password-login',DATE '1990-01-01','RU')`,
    [id, `join-${id}@isolated.test`],
  );
  await admin.query('INSERT INTO profiles(account_id,username,display_name) VALUES($1,$2,$3)', [
    id,
    `join_${id.replaceAll('-', '').slice(0, 24)}`,
    'Ordinary Account',
  ]);
  const principalId = principal
    ? (
        await admin.query<{ id: string }>(
          "INSERT INTO principals(kind,account_id) VALUES('account',$1) RETURNING id",
          [id],
        )
      ).rows[0]!.id
    : null;
  return { id, principalId };
}
type Account = Awaited<ReturnType<typeof account>>;

async function classroom(admin: pg.Pool, owner: Teacher) {
  const id = randomUUID();
  const code = randomUUID().replaceAll('-', '').repeat(2);
  await admin.query(
    `INSERT INTO classrooms(id,tenant_id,school_id,academic_period_id,title,created_by)
     VALUES($1,$2,$3,$4,'Account admission class',$5)`,
    [id, owner.tenantId, owner.schoolId, owner.periodId, owner.teacherId],
  );
  await admin.query(
    `INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role)
     VALUES($1,$2,$3,$4,'owner')`,
    [owner.tenantId, id, owner.teacherId, owner.accountId],
  );
  await admin.query(
    'INSERT INTO classroom_join_codes(tenant_id,classroom_id,token_hash,version) VALUES($1,$2,$3,1)',
    [owner.tenantId, id, code],
  );
  return { id, code, owner };
}
type Classroom = Awaited<ReturnType<typeof classroom>>;

async function request(runtime: Sql, group: Classroom, pupil: Account) {
  const row = (
    await runtime.query<{ request_id: string; status: string }>(
      'SELECT * FROM classroom_account_request_join($1,$2)',
      [pupil.id, group.code],
    )
  ).rows[0]!;
  expect(row.status).toBe('pending');
  return row.request_id;
}

async function decide(runtime: Sql, group: Classroom, requestId: string, decision = 'approved') {
  return (
    await runtime.query<{ result: string }>(
      'SELECT classroom_account_join_decide($1,$2,$3,$4,$5,NULL) AS result',
      [group.owner.accountId, group.owner.principalId, group.id, requestId, decision],
    )
  ).rows[0]!.result;
}

async function legacyApproval(admin: pg.Pool, runtime: pg.Pool, group: Classroom, pupil: Account) {
  const requestId = await request(runtime, group, pupil);
  expect(await decide(runtime, group, requestId)).toBe('ok');
  const seat = (
    await admin.query<{ seat_id: string }>(
      'SELECT seat_id FROM classroom_account_join_requests WHERE id=$1',
      [requestId],
    )
  ).rows[0]!.seat_id;
  expect(
    (await admin.query('SELECT id FROM learner_identity_links WHERE seat_id=$1', [seat])).rows,
  ).toEqual([]);
  return { group, pupil, seat, requestId };
}
type Admission = Awaited<ReturnType<typeof legacyApproval>>;

// Explicit retained malformed/incomplete history; positive prefix fixtures above
// always use the real 0119 request and approval through asalab_app.
async function retainedAdmission(
  admin: pg.Pool,
  owner: Teacher,
  options: {
    status?: 'pending' | 'rejected' | 'approved' | 'absent';
    audit?: 'matching' | 'absent' | 'actor' | 'class' | 'tenant';
    pupil?: Account;
    seatPrincipal?: boolean;
  } = {},
): Promise<Admission> {
  const group = await classroom(admin, owner);
  const pupil = options.pupil ?? (await account(admin));
  const seat = randomUUID();
  const requestId = randomUUID();
  await admin.query(
    `INSERT INTO classroom_student_seats
     (id,tenant_id,classroom_id,account_id,display_label,login_handle,normalized_login_handle,status,created_by)
     VALUES($1,$2,$3,$4,'Retained learner','retained','retained','active',$5)`,
    [seat, owner.tenantId, group.id, pupil.id, owner.teacherId],
  );
  if (options.seatPrincipal !== false) {
    await admin.query("INSERT INTO principals(kind,seat_id) VALUES('student_seat',$1)", [seat]);
  }
  const status = options.status ?? 'approved';
  if (status !== 'absent') {
    await admin.query(
      `INSERT INTO classroom_account_join_requests
       (id,tenant_id,classroom_id,account_id,status,code_hash,decided_at,decided_by_principal_id,seat_id)
       VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $5='pending' THEN NULL ELSE now() END,
         CASE WHEN $5='pending' THEN NULL ELSE $7::uuid END,$8)`,
      [requestId, owner.tenantId, group.id, pupil.id, status, group.code, owner.principalId, seat],
    );
    if (options.audit !== 'absent') {
      const auditTenant =
        options.audit === 'tenant' ? (await teacher(admin)).tenantId : owner.tenantId;
      await admin.query(
        `INSERT INTO audit_events(tenant_id,entity_type,entity_id,action,payload_json)
         VALUES($1,'classroom_join_request',$2,'classroom.join.decided',$3::jsonb)`,
        [
          auditTenant,
          requestId,
          JSON.stringify({
            actorPrincipalId: options.audit === 'actor' ? randomUUID() : owner.principalId,
            classroomId: options.audit === 'class' ? randomUUID() : group.id,
            decision: status,
            reason: null,
          }),
        ],
      );
    }
  }
  return { group, pupil, seat, requestId };
}

async function batch(admin: pg.Pool, owner: Teacher, rolledBack = false) {
  const id = randomUUID();
  await admin.query(
    `INSERT INTO learning_migration_batches
     (id,tenant_id,school_id,batch_key,operation_kind,mode,state,source_snapshot_digest,as_of,disabled_at)
     VALUES($1,$2,$3,$4,'m0_identity_activity_convergence','automatic',$5,repeat('a',64),now(),
       CASE WHEN $5='rolled_back' THEN now() ELSE NULL END)`,
    [id, owner.tenantId, owner.schoolId, id, rolledBack ? 'rolled_back' : 'active'],
  );
  return id;
}

async function learner(
  admin: pg.Pool,
  owner: Teacher,
  options: { id?: string; inactive?: boolean; batchId?: string } = {},
) {
  const id = options.id ?? randomUUID();
  await admin.query(
    'INSERT INTO learner_identities(id,tenant_id,school_id,state,created_by_batch_id) VALUES($1,$2,$3,$4,$5)',
    [
      id,
      owner.tenantId,
      owner.schoolId,
      options.inactive ? 'inactive' : 'active',
      options.batchId ?? null,
    ],
  );
  return id;
}

async function link(
  admin: pg.Pool,
  admission: Admission,
  learnerId: string,
  kind: 'student_seat' | 'account',
  options: { inactive?: boolean; batchId?: string } = {},
) {
  const id = randomUUID();
  await admin.query(
    `INSERT INTO learner_identity_links
     (id,tenant_id,school_id,learner_identity_id,link_kind,seat_id,account_id,status,disabled_at,created_by_batch_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $8='inactive' THEN now() ELSE NULL END,$9)`,
    [
      id,
      admission.group.owner.tenantId,
      admission.group.owner.schoolId,
      learnerId,
      kind,
      kind === 'student_seat' ? admission.seat : null,
      kind === 'account' ? admission.pupil.id : null,
      options.inactive ? 'inactive' : 'active',
      options.batchId ?? null,
    ],
  );
  return id;
}

async function artifact(
  admin: pg.Pool,
  admission: Admission,
  batchId: string,
  kind: 'learner_identity' | 'identity_link',
  artifactId: string,
  source: 'accounts' | 'classroom_student_seats',
  learnerId: string,
) {
  await admin.query(
    `INSERT INTO learning_migration_artifacts
     (id,tenant_id,school_id,batch_id,artifact_kind,artifact_id,source_table,source_id,
      operation_type,operation_mode,source_evidence)
     VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,'retained_fixture','automatic',$8::jsonb)`,
    [
      admission.group.owner.tenantId,
      admission.group.owner.schoolId,
      batchId,
      kind,
      artifactId,
      source,
      source === 'accounts' ? admission.pupil.id : admission.seat,
      JSON.stringify({ learnerId, accountId: admission.pupil.id, seatId: admission.seat }),
    ],
  );
}

async function deterministic(admin: pg.Pool, owner: Teacher, kind: 'account' | 'seat', id: string) {
  return (
    await admin.query<{ id: string }>('SELECT learning_m0_deterministic_uuid($1) AS id', [
      `learner:${owner.schoolId}:${kind}:${id}`,
    ])
  ).rows[0]!.id;
}

const preservedTables = [
  'accounts',
  'principals',
  'classrooms',
  'classroom_student_seats',
  'classroom_account_join_requests',
  'classroom_memberships',
  'audit_events',
  'learning_migration_batches',
  'learning_migration_artifacts',
  'learning_attempts',
  'learning_submissions',
  'learning_audience_operations',
  'learning_audience_membership_claims',
  'course_enrollments',
  'activity_participations',
  'projects',
  'sessions_v2',
] as const;
async function snapshot(admin: pg.Pool, tables: readonly string[] = preservedTables) {
  const result: Record<string, unknown> = {};
  for (const table of tables) {
    if (![...preservedTables, 'learner_identities', 'learner_identity_links'].includes(table)) {
      throw new Error('Unknown fixture snapshot table');
    }
    result[table] = (
      await admin.query(
        `SELECT COALESCE(jsonb_agg(to_jsonb(row) ORDER BY row.id),'[]'::jsonb) AS rows FROM public.${table} row`,
      )
    ).rows[0]!.rows;
  }
  return result;
}

async function functionSnapshot(admin: pg.Pool) {
  return (
    await admin.query(
      `SELECT p.oid,p.proname,p.proowner,p.proacl::text,p.prosecdef,p.provolatile,p.proconfig,
        pg_get_functiondef(p.oid) AS definition FROM pg_proc p
       JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
       AND p.proname=ANY($1::text[]) ORDER BY p.proname,p.oid`,
      [
        [
          'classroom_account_join_decide',
          'classroom_account_join_materialize_internal',
          'learning_audience_ensure_seat_identity',
          'classroom_participant_principals',
          'personal_progress_summary',
        ],
      ],
    )
  ).rows;
}

async function session(admin: pg.Pool, pupil: Account) {
  if (!pupil.principalId) throw new Error('Session requires an existing Account principal');
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const hash = randomUUID().replaceAll('-', '').repeat(2);
  await admin.query('INSERT INTO tenants(id,title,workspace_slug) VALUES($1,$2,$3)', [
    tenantId,
    'Personal',
    tenantId,
  ]);
  await admin.query(
    "INSERT INTO workspaces(id,tenant_id,kind,title) VALUES($1,$2,'personal','Personal')",
    [workspaceId, tenantId],
  );
  await admin.query(
    "INSERT INTO workspace_memberships(account_id,workspace_id,role) VALUES($1,$2,'owner')",
    [pupil.id, workspaceId],
  );
  await admin.query(
    "INSERT INTO sessions_v2(principal_id,active_workspace_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",
    [pupil.principalId, workspaceId, hash],
  );
  return hash;
}

async function groups(runtime: pg.Pool, pupil: Account, hash: string) {
  const value = (
    await runtime.query<{ summary: PersonalProgressSummaryV1 }>(
      "SELECT personal_progress_summary('account',$1,$2,$3,NULL) AS summary",
      [pupil.id, pupil.principalId, hash],
    )
  ).rows[0]!.summary;
  expect(value.groups.availability).toBe('available');
  return value.groups.items!.map((item) => item.groupId).sort();
}

async function dynamicAudience(admin: pg.Pool, group: Classroom) {
  const owner = group.owner;
  const course = (
    await admin.query<{ id: string }>(
      "INSERT INTO courses(tenant_id,owner_principal_id,title,visibility) VALUES($1,$2,'Dynamic course','private') RETURNING id",
      [owner.tenantId, owner.principalId],
    )
  ).rows[0]!.id;
  const version = (
    await admin.query<{ id: string }>(
      `INSERT INTO course_versions(tenant_id,course_id,version_number,title,outline,content_hash,published_by_principal_id)
       VALUES($1,$2,1,'Dynamic course','{"sections":[]}',repeat('b',32),$3) RETURNING id`,
      [owner.tenantId, course, owner.principalId],
    )
  ).rows[0]!.id;
  const run = (
    await admin.query<{ id: string }>(
      `INSERT INTO classroom_course_runs(tenant_id,classroom_id,course_id,course_version_id,title,version_number,assigned_by_principal_id)
       VALUES($1,$2,$3,$4,'Dynamic course',1,$5) RETURNING id`,
      [owner.tenantId, group.id, course, version, owner.principalId],
    )
  ).rows[0]!.id;
  return (
    await admin.query<{ id: string }>(
      `INSERT INTO learning_audience_definitions
       (tenant_id,school_id,classroom_id,target_kind,target_course_run_id,audience_type,mode,
        created_by_principal_id,creation_request_id,creation_request_digest)
       VALUES($1,$2,$3,'course_run',$4,'whole_class','dynamic',$5,$6,repeat('c',64)) RETURNING id`,
      [owner.tenantId, owner.schoolId, group.id, run, owner.principalId, randomUUID()],
    )
  ).rows[0]!.id;
}

async function retainedAttempt(admin: pg.Pool, admission: Admission, learnerId: string) {
  const owner = admission.group.owner;
  const activity = (
    await admin.query<{ id: string }>(
      "INSERT INTO learning_activities(tenant_id,owner_principal_id,activity_type,title) VALUES($1,$2,'project','Retained work') RETURNING id",
      [owner.tenantId, owner.principalId],
    )
  ).rows[0]!.id;
  const version = (
    await admin.query<{ id: string }>(
      `INSERT INTO learning_activity_versions(tenant_id,activity_id,version_number,title,activity_type,module_key,max_points,content_digest)
       VALUES($1,$2,1,'Retained work','project','electronics',100,repeat('d',64)) RETURNING id`,
      [owner.tenantId, activity],
    )
  ).rows[0]!.id;
  const authored = (
    await admin.query<{ id: string }>(
      "INSERT INTO teacher_assignments(tenant_id,owner_principal_id,title,brief,module_key,visibility) VALUES($1,$2,'Retained work','Keep','electronics','private') RETURNING id",
      [owner.tenantId, owner.principalId],
    )
  ).rows[0]!.id;
  const assignment = (
    await admin.query<{ id: string }>(
      "INSERT INTO classroom_assignments(tenant_id,classroom_id,assignment_id,status,created_by) VALUES($1,$2,$3,'open',$4) RETURNING id",
      [owner.tenantId, admission.group.id, authored, owner.teacherId],
    )
  ).rows[0]!.id;
  await admin.query(
    `INSERT INTO learning_attempts(tenant_id,classroom_id,classroom_assignment_id,learning_activity_version_id,
      seat_id,attempt_number,learner_identity_id) VALUES($1,$2,$3,$4,$5,1,$6)`,
    [owner.tenantId, admission.group.id, assignment, version, admission.seat, learnerId],
  );
}

async function suppressAccountLink(admin: pg.Pool, pupil: Account) {
  // Controlled failure of the constructor's Account INSERT, including the
  // 0095 INSERT trigger path. No production function is replaced for this test.
  await admin.query(`CREATE FUNCTION public.c2_skip_account_link() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
    CREATE TRIGGER c2_skip_account_link BEFORE INSERT ON public.learner_identity_links
    FOR EACH ROW WHEN(NEW.link_kind='account' AND NEW.account_id='${pupil.id}'::uuid)
    EXECUTE FUNCTION public.c2_skip_account_link()`);
}

async function stopSuppressing(admin: pg.Pool) {
  await admin.query(
    'DROP TRIGGER c2_skip_account_link ON public.learner_identity_links; DROP FUNCTION public.c2_skip_account_link()',
  );
}

describe.skipIf(!enabled)(
  'Account admission canonical identity forward upgrade in isolated PostgreSQL',
  () => {
    it('upgrades qualified prefix0320 approvals atomically, preserving every negative and retained history', async () => {
      await withDatabase(true, async (admin, runtime, plan) => {
        const owner = await teacher(admin);
        const pupil = await account(admin);
        const positives: Admission[] = [];
        for (let index = 0; index < 3; index += 1) {
          positives.push(
            await legacyApproval(admin, runtime, await classroom(admin, owner), pupil),
          );
        }
        const hash = await session(admin, pupil);
        expect(await groups(runtime, pupil, hash)).toEqual([]);
        expect(
          (
            await admin.query('SELECT id FROM classroom_memberships WHERE account_id=$1', [
              pupil.id,
            ])
          ).rows,
        ).toEqual([]);

        const otherOwner = await teacher(admin);
        const otherSchool = await legacyApproval(
          admin,
          runtime,
          await classroom(admin, otherOwner),
          pupil,
        );
        const otherLearner = await learner(admin, otherOwner);
        await link(admin, otherSchool, otherLearner, 'student_seat');
        await link(admin, otherSchool, otherLearner, 'account');

        const reusedAccount = await account(admin);
        const healthy = await legacyApproval(
          admin,
          runtime,
          await classroom(admin, owner),
          reusedAccount,
        );
        const activeBatch = await batch(admin, owner);
        const m0Learner = await learner(admin, owner, {
          id: await deterministic(admin, owner, 'account', reusedAccount.id),
          batchId: activeBatch,
        });
        const healthySeatLink = await link(admin, healthy, m0Learner, 'student_seat', {
          batchId: activeBatch,
        });
        const healthyAccountLink = await link(admin, healthy, m0Learner, 'account', {
          batchId: activeBatch,
        });
        await artifact(
          admin,
          healthy,
          activeBatch,
          'learner_identity',
          m0Learner,
          'classroom_student_seats',
          m0Learner,
        );
        await artifact(
          admin,
          healthy,
          activeBatch,
          'identity_link',
          healthySeatLink,
          'classroom_student_seats',
          m0Learner,
        );
        await artifact(
          admin,
          healthy,
          activeBatch,
          'identity_link',
          healthyAccountLink,
          'accounts',
          m0Learner,
        );
        const reuse = await legacyApproval(
          admin,
          runtime,
          await classroom(admin, owner),
          reusedAccount,
        );

        const negatives: Admission[] = [];
        // The published batch FK includes tenant, but not school. Keep each
        // identity/link in this school while only its provenance points at a
        // different school of the SAME tenant; a different tenant would be
        // rejected by that FK before the admission guard can be exercised.
        const foreignBatchSchool = (
          await admin.query<{ id: string; tenant_id: string }>(
            "INSERT INTO schools(tenant_id,title) VALUES($1,'Other batch school') RETURNING id,tenant_id",
            [owner.tenantId],
          )
        ).rows[0]!;
        expect(foreignBatchSchool.tenant_id).toBe(owner.tenantId);
        expect(foreignBatchSchool.id).not.toBe(owner.schoolId);
        const foreignBatch = await batch(admin, { ...owner, schoolId: foreignBatchSchool.id });
        const foreignBatchLineages: { target: Admission; anchor: Admission; reason: string }[] = [];
        for (const subject of ['learner', 'account-link', 'seat-link'] as const) {
          const target = await retainedAdmission(admin, owner);
          const anchor = await retainedAdmission(admin, owner, {
            pupil: target.pupil,
            status: 'absent',
          });
          const retainedLearner = await learner(
            admin,
            owner,
            subject === 'learner' ? { batchId: foreignBatch } : {},
          );
          await link(
            admin,
            target,
            retainedLearner,
            'account',
            subject === 'account-link' ? { batchId: foreignBatch } : {},
          );
          await link(
            admin,
            anchor,
            retainedLearner,
            'student_seat',
            subject === 'seat-link' ? { batchId: foreignBatch } : {},
          );
          negatives.push(target, anchor);
          foreignBatchLineages.push({
            target,
            anchor,
            reason:
              subject === 'seat-link'
                ? 'conflicting_or_partial_lineage'
                : 'inactive_or_conflicting_account_link',
          });
        }
        for (const status of ['pending', 'rejected', 'absent'] as const)
          negatives.push(await retainedAdmission(admin, owner, { status }));
        for (const audit of ['absent', 'actor', 'class', 'tenant'] as const)
          negatives.push(await retainedAdmission(admin, owner, { audit }));
        negatives.push(await retainedAdmission(admin, owner, { seatPrincipal: false }));
        negatives.push(
          await retainedAdmission(admin, owner, { pupil: await account(admin, false) }),
        );
        for (const status of ['suspended', 'removed'] as const) {
          const row = await retainedAdmission(admin, owner);
          await admin.query('UPDATE classroom_student_seats SET status=$2 WHERE id=$1', [
            row.seat,
            status,
          ]);
          negatives.push(row);
        }
        const inactiveAccount = await retainedAdmission(admin, owner);
        await admin.query("UPDATE accounts SET status='suspended' WHERE id=$1", [
          inactiveAccount.pupil.id,
        ]);
        negatives.push(inactiveAccount);
        const archivedClass = await retainedAdmission(admin, owner);
        await admin.query("UPDATE classrooms SET status='archived',archived_at=now() WHERE id=$1", [
          archivedClass.group.id,
        ]);
        negatives.push(archivedClass);
        const wrongAccount = await retainedAdmission(admin, owner);
        await admin.query('UPDATE classroom_account_join_requests SET account_id=$2 WHERE id=$1', [
          wrongAccount.requestId,
          pupil.id,
        ]);
        negatives.push(wrongAccount);
        const wrongClass = await retainedAdmission(admin, owner);
        await admin.query(
          'UPDATE classroom_account_join_requests SET classroom_id=$2 WHERE id=$1',
          [wrongClass.requestId, positives[0]!.group.id],
        );
        negatives.push(wrongClass);
        const wrongTenant = await retainedAdmission(admin, owner);
        await admin.query(
          'UPDATE classroom_account_join_requests SET tenant_id=$2,classroom_id=$3 WHERE id=$1',
          [wrongTenant.requestId, otherOwner.tenantId, otherSchool.group.id],
        );
        negatives.push(wrongTenant);

        for (const mode of [
          'seat-inactive',
          'account-inactive',
          'learner-inactive',
          'rolled-back',
          'seat-tombstone',
          'account-tombstone',
          'artifact',
          'account-artifact',
          'other-seat-artifact',
          'attempt',
          'audience',
          'partial',
          'conflict',
        ] as const) {
          const row = await retainedAdmission(admin, owner);
          const batchId =
            mode === 'rolled-back' || mode.includes('artifact')
              ? await batch(admin, owner, mode === 'rolled-back')
              : undefined;
          const learnerId = await learner(admin, owner, {
            inactive: mode === 'learner-inactive' || mode.endsWith('tombstone'),
            ...(batchId ? { batchId } : {}),
            id:
              mode === 'seat-tombstone'
                ? await deterministic(admin, owner, 'seat', row.seat)
                : mode === 'account-tombstone'
                  ? await deterministic(admin, owner, 'account', row.pupil.id)
                  : randomUUID(),
          });
          if (mode === 'seat-inactive')
            await link(admin, row, learnerId, 'student_seat', { inactive: true });
          if (['account-inactive', 'learner-inactive', 'rolled-back'].includes(mode)) {
            await link(admin, row, learnerId, 'account', {
              inactive: mode === 'account-inactive',
              ...(batchId ? { batchId } : {}),
            });
          }
          if (mode === 'artifact')
            await artifact(
              admin,
              row,
              batchId!,
              'learner_identity',
              learnerId,
              'classroom_student_seats',
              learnerId,
            );
          if (mode === 'account-artifact')
            await artifact(
              admin,
              row,
              batchId!,
              'identity_link',
              randomUUID(),
              'accounts',
              learnerId,
            );
          if (mode === 'other-seat-artifact') {
            const anchor = await retainedAdmission(admin, owner, {
              pupil: row.pupil,
              status: 'absent',
            });
            await artifact(
              admin,
              anchor,
              batchId!,
              'learner_identity',
              learnerId,
              'classroom_student_seats',
              learnerId,
            );
            negatives.push(anchor);
          }
          if (mode === 'attempt') await retainedAttempt(admin, row, learnerId);
          if (mode === 'audience') {
            const audience = await dynamicAudience(admin, row.group);
            await admin.query(
              `INSERT INTO learning_audience_operations(tenant_id,school_id,audience_id,learner_identity_id,
             operation_kind,request_id,request_digest,result_code,source_seat_id)
             VALUES($1,$2,$3,$4,'dynamic_learner_materialized',$5,repeat('e',64),'completed',$6)`,
              [owner.tenantId, owner.schoolId, audience, learnerId, randomUUID(), row.seat],
            );
          }
          if (mode === 'partial' || mode === 'conflict') {
            const anchor = await retainedAdmission(admin, owner, {
              pupil: row.pupil,
              status: 'absent',
            });
            await link(admin, anchor, learnerId, 'student_seat');
            if (mode === 'conflict') await link(admin, row, await learner(admin, owner), 'account');
            negatives.push(anchor);
          }
          negatives.push(row);
        }

        const preserved = await snapshot(admin);
        const identitiesBefore = await snapshot(admin, [
          'learner_identities',
          'learner_identity_links',
        ]);
        const functionsBefore = await functionSnapshot(admin);
        const ledgerBefore = (await admin.query('SELECT * FROM schema_migrations ORDER BY version'))
          .rows;
        expect(ledgerBefore.at(-1)?.version).toBe('0320');

        const assertAbortedUpgrade = async () => {
          expect(
            (await admin.query('SELECT * FROM schema_migrations ORDER BY version')).rows,
          ).toEqual(ledgerBefore);
          expect(await snapshot(admin)).toEqual(preserved);
          expect(await snapshot(admin, ['learner_identities', 'learner_identity_links'])).toEqual(
            identitiesBefore,
          );
          expect(await functionSnapshot(admin)).toEqual(functionsBefore);
          expect(
            (
              await admin.query(
                "SELECT to_regprocedure('public.classroom_account_join_identity_guard(uuid,uuid,uuid)') AS guard",
              )
            ).rows[0]!.guard,
          ).toBeNull();
        };
        const oldWriter = await admin.connect();
        try {
          await oldWriter.query('BEGIN');
          // Actual old helper: owns S2 and an uncommitted unique Account link.
          await oldWriter.query('SELECT learning_audience_ensure_seat_identity($1)', [
            positives[1]!.seat,
          ]);
          expect(
            (
              await oldWriter.query(
                "SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND relation='classroom_student_seats'::regclass AND mode='RowShareLock' AND granted",
              )
            ).rowCount,
          ).toBe(1);
          await expect(upgrade(admin, plan)).rejects.toMatchObject({ code: '55P03' });
          await assertAbortedUpgrade();
        } finally {
          await oldWriter.query('ROLLBACK');
          oldWriter.release();
        }
        const admissionWriter = await admin.connect();
        try {
          await admissionWriter.query('BEGIN');
          await admissionWriter.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            `account-join-learner:${owner.tenantId}:${owner.schoolId}:${pupil.id}`,
          ]);
          await expect(upgrade(admin, plan)).rejects.toMatchObject({ code: '55P03' });
          await assertAbortedUpgrade();
        } finally {
          await admissionWriter.query('ROLLBACK');
          admissionWriter.release();
        }
        await suppressAccountLink(admin, pupil);
        try {
          await expect(upgrade(admin, plan)).rejects.toThrow(
            'historical approved join has incoherent learner identity',
          );
          await assertAbortedUpgrade();
        } finally {
          await stopSuppressing(admin);
        }

        expect(await upgrade(admin, plan)).toBe(1);
        const ledgerAfter = (await admin.query('SELECT * FROM schema_migrations ORDER BY version'))
          .rows;
        expect(ledgerAfter.slice(0, -1)).toEqual(ledgerBefore);
        expect(ledgerAfter.at(-1)).toMatchObject({
          version: '0321',
          checksum: plan.at(-1)!.checksum,
        });
        expect(await snapshot(admin)).toEqual(preserved);
        const oldLinks = identitiesBefore['learner_identity_links'] as { id: string }[];
        const oldLearners = identitiesBefore['learner_identities'] as { id: string }[];
        const after = await snapshot(admin, ['learner_identities', 'learner_identity_links']);
        expect(
          (after['learner_identity_links'] as { id: string }[]).filter((row) =>
            oldLinks.some((old) => old.id === row.id),
          ),
        ).toEqual(oldLinks);
        expect(
          (after['learner_identities'] as { id: string }[]).filter((row) =>
            oldLearners.some((old) => old.id === row.id),
          ),
        ).toEqual(oldLearners);
        expect((after['learner_identities'] as unknown[]).length).toBe(oldLearners.length + 1);
        expect((after['learner_identity_links'] as unknown[]).length).toBe(oldLinks.length + 5);
        const mapped = (
          await admin.query(
            'SELECT seat_id,learner_identity_id FROM learner_identity_links WHERE seat_id=ANY($1::uuid[]) ORDER BY seat_id',
            [positives.map((item) => item.seat)],
          )
        ).rows;
        expect(mapped).toHaveLength(3);
        expect(new Set(mapped.map((row) => row.learner_identity_id)).size).toBe(1);
        expect(
          (
            await admin.query(
              'SELECT learner_identity_id FROM learner_identity_links WHERE seat_id=$1',
              [reuse.seat],
            )
          ).rows,
        ).toEqual([{ learner_identity_id: m0Learner }]);
        for (const row of [...positives, reuse]) {
          expect(
            (await admin.query('SELECT id FROM classroom_participant_principals($1)', [row.seat]))
              .rows,
          ).toContainEqual({ id: row.pupil.principalId });
        }
        expect(await groups(runtime, pupil, hash)).toEqual(
          [...positives.map((row) => row.group.id), otherSchool.group.id].sort(),
        );
        for (const row of negatives) {
          const before = oldLinks.filter(
            (item) => (item as { seat_id?: string }).seat_id === row.seat,
          );
          const actual = (after['learner_identity_links'] as { seat_id?: string }[]).filter(
            (item) => item.seat_id === row.seat,
          );
          expect(actual, row.requestId).toEqual(before);
        }
        for (const { target, anchor, reason } of foreignBatchLineages) {
          expect(
            (
              await admin.query(
                `SELECT classroom_account_join_identity_guard($1,$2,$3) AS reason,
                   classroom_account_join_identity_coherent($1,$4,$5) AS coherent`,
                [target.pupil.id, target.group.id, target.seat, anchor.group.id, anchor.seat],
              )
            ).rows,
          ).toEqual([{ reason, coherent: false }]);
        }
        const functionsAfter = await functionSnapshot(admin);
        for (const before of functionsBefore) {
          const actual = functionsAfter.find((item) => item.oid === before.oid)!;
          if (before.proname === 'classroom_account_join_decide') {
            expect(actual.definition).not.toBe(before.definition);
            expect({ ...actual, definition: null }).toEqual({ ...before, definition: null });
          } else expect(actual).toEqual(before);
        }
        expect(await upgrade(admin, plan)).toBe(0);
        expect(
          (await admin.query('SELECT * FROM schema_migrations ORDER BY version')).rows,
        ).toEqual(ledgerAfter);
        expect(await snapshot(admin, ['learner_identities', 'learner_identity_links'])).toEqual(
          after,
        );
      });
    }, 120_000);

    it('serializes new same-school approvals before dynamic triggers and rolls back a failed identity postcondition', async () => {
      await withDatabase(false, async (admin, runtime) => {
        const owner = await teacher(admin);
        const pupil = await account(admin);
        const classes: Classroom[] = [];
        for (let index = 0; index < 3; index += 1) classes.push(await classroom(admin, owner));
        await dynamicAudience(admin, classes[0]!);
        const requests = await Promise.all(classes.map((group) => request(runtime, group, pupil)));
        const gate = await admin.connect();
        const clients = await Promise.all(classes.map(() => runtime.connect()));
        let results: Promise<string>[] = [];
        try {
          await gate.query('BEGIN');
          const pid = (await gate.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
            .pid;
          await gate.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            `account-join-learner:${owner.tenantId}:${owner.schoolId}:${pupil.id}`,
          ]);
          results = classes.map((group, index) => decide(clients[index]!, group, requests[index]!));
          await expect
            .poll(
              async () =>
                (
                  await admin.query<{ waiting: number }>(
                    'SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))',
                    [pid],
                  )
                ).rows[0]!.waiting,
              { timeout: 5_000, interval: 20 },
            )
            .toBe(3);
          expect(
            (
              await admin.query('SELECT id FROM classroom_student_seats WHERE account_id=$1', [
                pupil.id,
              ])
            ).rows,
          ).toEqual([]);
          await gate.query('COMMIT');
          expect(await Promise.all(results)).toEqual(['ok', 'ok', 'ok']);
        } finally {
          await gate.query('ROLLBACK');
          await Promise.allSettled(results);
          clients.forEach((client) => client.release());
          gate.release();
        }
        const seats = (
          await admin.query<{ id: string }>(
            'SELECT id FROM classroom_student_seats WHERE account_id=$1 ORDER BY id',
            [pupil.id],
          )
        ).rows;
        expect(seats).toHaveLength(3);
        const identities = (
          await admin.query('SELECT * FROM learner_identities WHERE school_id=$1', [owner.schoolId])
        ).rows;
        expect(identities).toHaveLength(1);
        expect(
          (
            await admin.query(
              'SELECT learner_identity_id FROM learner_identity_links WHERE school_id=$1',
              [owner.schoolId],
            )
          ).rows,
        ).toEqual(Array.from({ length: 4 }, () => ({ learner_identity_id: identities[0]!.id })));
        expect(
          (
            await admin.query('SELECT id FROM course_enrollments WHERE learner_identity_id=$1', [
              identities[0]!.id,
            ])
          ).rows,
        ).toHaveLength(1);
        const beforeReplay = await snapshot(admin, [
          ...preservedTables,
          'learner_identities',
          'learner_identity_links',
        ]);
        expect(
          await Promise.all(
            classes.map((group, index) => decide(runtime, group, requests[index]!)),
          ),
        ).toEqual(['ok', 'ok', 'ok']);
        expect(await decide(runtime, classes[0]!, requests[0]!, 'rejected')).toBe(
          'decision_conflict',
        );
        expect(
          await snapshot(admin, [
            ...preservedTables,
            'learner_identities',
            'learner_identity_links',
          ]),
        ).toEqual(beforeReplay);

        const denied = await retainedAdmission(admin, owner, { status: 'absent' });
        const tombstone = await learner(admin, owner);
        await link(admin, denied, tombstone, 'account', { inactive: true });
        const deniedRequest = await request(runtime, classes[0]!, denied.pupil);
        const beforeDeny = await snapshot(admin, [
          ...preservedTables,
          'learner_identities',
          'learner_identity_links',
        ]);
        expect(await decide(runtime, classes[0]!, deniedRequest)).toBe('not_available');
        expect(
          await snapshot(admin, [
            ...preservedTables,
            'learner_identities',
            'learner_identity_links',
          ]),
        ).toEqual(beforeDeny);

        const failing = await account(admin);
        const failingRequest = await request(runtime, classes[0]!, failing);
        const beforeFailure = await snapshot(admin, [
          ...preservedTables,
          'learner_identities',
          'learner_identity_links',
        ]);
        await suppressAccountLink(admin, failing);
        try {
          await expect(decide(runtime, classes[0]!, failingRequest)).rejects.toThrow(
            'approved join has incoherent learner identity',
          );
          expect(
            await snapshot(admin, [
              ...preservedTables,
              'learner_identities',
              'learner_identity_links',
            ]),
          ).toEqual(beforeFailure);
        } finally {
          await stopSuppressing(admin);
        }
        expect(await decide(runtime, classes[0]!, failingRequest)).toBe('ok');
        expect(
          (
            await admin.query(
              "SELECT id FROM audit_events WHERE entity_id=$1 AND action='classroom.join.decided'",
              [failingRequest],
            )
          ).rows,
        ).toHaveLength(1);

        const rejected = await account(admin);
        const rejectedRequest = await request(runtime, classes[1]!, rejected);
        expect(
          (
            await runtime.query<{ result: string }>(
              "SELECT classroom_account_join_decide($1,$2,$3,$4,'approved',NULL) AS result",
              [pupil.id, pupil.principalId, classes[1]!.id, rejectedRequest],
            )
          ).rows[0]!.result,
        ).toBe('forbidden');
        expect(await decide(runtime, classes[1]!, rejectedRequest, 'rejected')).toBe('ok');
        expect(
          (
            await admin.query('SELECT id FROM classroom_student_seats WHERE account_id=$1', [
              rejected.id,
            ])
          ).rows,
        ).toEqual([]);
        for (const functionCall of [
          'classroom_account_join_identity_guard($1,$2,$3)',
          'classroom_account_join_identity_coherent($1,$2,$3)',
        ]) {
          await expect(
            runtime.query(`SELECT ${functionCall}`, [pupil.id, classes[0]!.id, seats[0]!.id]),
          ).rejects.toMatchObject({ code: '42501' });
        }
        await expect(
          runtime.query('SELECT learning_audience_ensure_seat_identity($1)', [seats[0]!.id]),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          runtime.query('SELECT * FROM classroom_account_join_materialize_internal($1,$2)', [
            pupil.id,
            classes[0]!.code,
          ]),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(runtime.query('SELECT * FROM learner_identity_links')).rejects.toMatchObject({
          code: '42501',
        });
      });
    }, 120_000);
  },
);
