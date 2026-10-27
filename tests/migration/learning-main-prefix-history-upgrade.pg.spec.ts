import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { planMigrations, validateMigrationHistory } from '../../tools/migrate.mjs';
import { seedTeacher } from '../portal/helpers';
import { applyIsolatedTestPlan } from './isolated-postgres-plan';

// The supported old prefix is 0225. A source-only main containing 0234 is not
// evidence that an installation applied it, or a supported upgrade starting point.
// Pin the published inputs, accepting only the runner's LF/CRLF representation.
const upgradeArtifacts = [
  [
    '0226',
    '0226_ai_student_admission.sql',
    '672ceca0a8cbeb7223dce9268a240682a7b07cf3c1c60ce3505a5bd4d623d02c',
  ],
  [
    '0227',
    '0227_ai_model_catalog_and_provider_credentials.sql',
    '5eaff82f9d885e4aa89bf89cd1b699b23af790e4df68e02df4dc6b6e98505b3d',
  ],
  [
    '0228',
    '0228_ai_text_history.sql',
    'b96d78cb46f8bceb24bd0ebfc1f87474f04cf4ee4c832bdc32f43f94274f9b87',
  ],
  [
    '0229',
    '0229_ai_private_attachments.sql',
    '4af4955624c3b43d35a8141900fa644e7f326bad051d130a78856b2c291f605d',
  ],
  [
    '0230',
    '0230_course_author_version_pins.sql',
    'fddba106b504cccf2ec80f66ac8bf93098bc7444e3d4571ff3012fb8e0045047',
  ],
  [
    '0231',
    '0231_course_prepublication_diagnostics.sql',
    'cf1780e9a7db1f6014dfe8453846008b4ed15a4b584796297cdb2f651fb38236',
  ],
  [
    '0232',
    '0232_course_archive_assignment_atomicity.sql',
    '436863aa0a25f4837223cfe6dd23200b0a3f757d99b54e3ff1d6caceea9c6c22',
  ],
  [
    '0233',
    '0233_classroom_participant_read_jit.sql',
    '4c64eab8224079ef95215346964b6cce03d2d6b945221d24c1ac612375341fe6',
  ],
  [
    '0234',
    '0234_public_projects.sql',
    '0a6ad164e27f8e1c9e91ec338198c9ca43bd92e945bd74f5e3bcd9cbdb30528e',
  ],
  [
    '0235',
    '0235_public_project_copy.sql',
    '854b5059940d6c08f7162ff42c68a96f4173c408f201bbbd88e60b6494402c85',
  ],
  [
    '0236',
    '0236_project_publication_moderation.sql',
    'ace151d291642c08087e88e4eb83b97430d4997871d8fd6740b4df3ae39dd4ef',
  ],
  [
    '0237',
    '0237_student_seat_context_nonblocking_heartbeat.sql',
    '9b1663082dd7e2d32098a14f6e2b032a192efb397aa87b1eae4c468b30cc8ba1',
  ],
  [
    '0238',
    '0238_project_publication_editorial.sql',
    '3ceff03616405346206a264172fa3ec3a178971f24db260772cceb550c9e7819',
  ],
  [
    '0239',
    '0239_ai_ollama_local.sql',
    '74e91546e9dd8e71ded2741575bb51be6e0125ca8f71933140db73c707164f22',
  ],
  [
    '0240',
    '0240_teacher_home_canonical_read_jit.sql',
    '60dae5f444e08a479acdb98752b434b1114680d3f742aa31dfc0484bfe5c9dd5',
  ],
  [
    '0241',
    '0241_max_external_only_registration.sql',
    '859c003111fafed508271fff05205aafe63cb15edc030986e27fc90ed8191e85',
  ],
  [
    '0242',
    '0242_ai_attachment_local_binding.sql',
    '742ad7fbb6ccb137b1f0cc06fc965e84f12d2156d32bf9bebcc6805353412cc4',
  ],
  [
    '0243',
    '0243_ai_attachment_regeneration_context.sql',
    '8b7cb925dea3402fe2242648c725aac0a90a4e2274fa13bab5ce73011121a8c9',
  ],
  [
    '0244',
    '0244_ai_usage_journal.sql',
    '8a1a8956cbc39d0623f1f72f635cf4d2ac2a7f3937aad3e8a580f16167c5da92',
  ],
  [
    '0245',
    '0245_admin_user_catalog.sql',
    'a632b0a9acdb797bd36d2761a41c382e89e40536ba47db139e569ff82a5acd3e',
  ],
  [
    '0246',
    '0246_admin_user_history.sql',
    '0f6794d87818d734de2b866c4f0a293387cba7058f4be9967c04855108ea1e01',
  ],
  [
    '0247',
    '0247_crm_user_cards.sql',
    '82b6a82c1e3a71fed096de87fa068a54fa052c707ea1a5e4166bc91dc0038b29',
  ],
  [
    '0248',
    '0248_verified_email_smtp.sql',
    'e8a1932af2b356614db98ea52af861803992fba6c09f48ab849c632af0ef3a56',
  ],
  [
    '0249',
    '0249_crm_directory.sql',
    '5ea5756bb4e61a926f48e67469b799395b2f3c19e068569a3b8e809031961b12',
  ],
  [
    '0250', // Exact Seat retained detail and immutable educational notes.
    '0250_crm_retained_detail.sql',
    '4f305043bb40aea37c4ee33afb3fea87775df6855c9f9941eb50a9e7c0b04ff7',
  ],
  [
    '0251', // Scoped organization and exact-class responsibilities.
    '0251_crm_responsibilities.sql',
    'b25d2cc12e0f75ee98a90d8e574ad38d9b66eb213b01add1c5341f831130a094',
  ],
  [
    '0252',
    '0252_ai_ollama_cloud.sql',
    '575c4b4bf41e0bdb5a4652f141289f6c0bfaa8171fd7feec60f519776ae53957',
  ],
  [
    '0253', // Optional scoped campaign observations and factual catalog projections.
    '0253_crm_acquisition_observations.sql',
    'eeb2f35f7c2408d8edb3400aef18b5db88e6e6985aeebf2911c976db9a0cd8dc',
  ],
  [
    '0254',
    '0254_ai_web_search.sql',
    'f308015796eb1ccfcfa43c4015bb2b6b78cc141bc41a6e94354c02c3878df2d5',
  ],
  [
    '0255',
    '0255_admin_legacy_publication_visibility.sql',
    '6839dd782fc3ced49f399f3ffd3e46481f40e3b65c177da40bda3f1fb0805cc5',
  ],
  [
    '0256',
    '0256_crm_user_dashboard.sql',
    '8aa19d8fc2ef76f8809f1f3dc2c8651132c59453e8712af70c56ff862132f9a8',
  ],
  [
    '0257',
    '0257_crm_dashboard_projection_fix.sql',
    'e7f6aca9b4c84a2fa01edb6d780374a09e5da112010ac7ed7f0eef6cd61e637e',
  ],
  [
    '0258',
    '0258_project_publication_pins.sql',
    '5dc9b4051ed78f80ec35963f006b630cc01ea52f5e4b9a6eacdcf499db5bb1fe',
  ],
  [
    '0259',
    '0259_project_publication_reports.sql',
    'c8332e0ee625d680442673bc662fa5cc631c5f31f45a75693b1e9ba5a5294b9d',
  ],
  [
    '0260',
    '0260_public_project_artifact_document.sql',
    'a7a2e2f208a356bbee227f3ca2e0ad95fcbcee36ed6ed51401caccb672e41dcf',
  ],
  [
    '0261',
    '0261_ai_long_answers.sql',
    'b675187ec818b7c26e2984ae76236ce5e6009571150320a5d11d0fa419b462b6',
  ],
  [
    '0262',
    '0262_ai_generation_lease.sql',
    '3a1513d7a748a8d30458fb705e5887c9fd6159d5dd4465f62384a575fd5fae69',
  ],
  [
    '0263',
    '0263_ai_generation_policy.sql',
    'db3b97a9b370b71ea7beb5867facb057a4faada53743711c59f0f949155d7bf2',
  ],
  [
    '0264',
    '0264_ai_local_image_generation.sql',
    '31a461e8943133697ff575ff0146f813f03ec2aac06e6118e979795c4e41f58b',
  ],
  [
    '0265',
    '0265_ai_native_image_tools.sql',
    '1f12daf30bc9f49fa9e6049873c97e574872a6395068f2ab5308041a695b1459',
  ],
  [
    '0266',
    '0266_ai_tool_policy.sql',
    '526f22047a29335f096660d4a833063899a57d0eb71e2f45ebf751c977215d35',
  ],
  [
    '0267',
    '0267_learning_mixed_course_completion.sql',
    '0b9a958ecd190cfd19f82fc5e6c9dabeeb9508f4d2de18214768b250f0c9bf38',
  ],
  [
    '0268',
    '0268_learning_course_academic_result_access.sql',
    '73c0aad46e2767de51a270e48e15f184dfe7fe43a8ad47992be6ac878ee1b6f4',
  ],
] as const;

type Plan = ReturnType<typeof planMigrations>;

function completePlan(): Plan {
  const plan = planMigrations();
  expect(
    plan
      .filter((item) => Number(item.version) > 225)
      .map((item) => [
        item.version,
        item.file,
        createHash('sha256').update(item.sql.replace(/\r\n/g, '\n')).digest('hex'),
      ]),
  ).toEqual(upgradeArtifacts);
  expect(plan.filter((item) => Number(item.version) <= 225)).toHaveLength(220);
  return plan;
}

async function withPrefixDatabase(
  run: (pool: pg.Pool, client: pg.PoolClient, plan: Plan) => Promise<void>,
) {
  const plan = completePlan();
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !decodeURIComponent(new URL(source).pathname).endsWith('_test')) {
    throw new Error('Isolated TEST_DATABASE_URL required');
  }
  const name = 'asa_joint_prefix_' + randomUUID().replaceAll('-', '') + '_test';
  if (!/^asa_joint_prefix_[a-f0-9]{32}_test$/.test(name)) {
    throw new Error('Unsafe generated test database name');
  }
  const owner = new pg.Client({ connectionString: source });
  let created = false;
  let pool: pg.Pool | undefined;
  try {
    await owner.connect();
    await owner.query(`CREATE DATABASE "${name}"`);
    created = true;
    const target = new URL(source);
    target.pathname = '/' + name;
    pool = new pg.Pool({ connectionString: target.toString(), max: 3 });
    const client = await pool.connect();
    try {
      expect(
        await applyIsolatedTestPlan(
          client,
          plan.filter((item) => Number(item.version) <= 225),
        ),
      ).toBe(220);
      await run(pool, client, plan);
    } finally {
      client.release();
    }
  } finally {
    try {
      await pool?.end();
      if (created) await owner.query(`DROP DATABASE "${name}"`);
    } finally {
      await owner.end();
    }
  }
}

async function ledger(pool: pg.Pool) {
  return (await pool.query('SELECT * FROM schema_migrations ORDER BY version')).rows;
}

const preservedTables = [
  'accounts',
  'profiles',
  'principals',
  'legacy_user_account_links',
  'capability_grants',
  'workspace_memberships',
  'classrooms',
  'classroom_memberships',
  'classroom_student_seats',
  'learner_identities',
  'learner_identity_links',
  'learning_activities',
  'learning_activity_versions',
  'courses',
  'course_sections',
  'course_lessons',
  'course_versions',
  'classroom_course_runs',
  'classroom_course_run_lessons',
  'course_enrollments',
  'activity_runs',
  'activity_participations',
  'projects',
  'project_drafts',
  'project_versions',
  'project_snapshots',
  'project_publications',
  'project_publication_state',
  'ai_paid_operation_quota',
] as const;

const copiedProjectOriginFields = [
  'copied_from_publication_id',
  'copied_from_revision_id',
  'copied_from_version_id',
  'copied_from_license',
] as const;

async function preservedData(pool: pg.Pool) {
  const result: Record<string, unknown[]> = {};
  // Only this fixed list of test-owned table identifiers is interpolated.
  for (const table of preservedTables) {
    const addedColumns = table === 'projects' ? [...copiedProjectOriginFields] : [];
    result[table] = (
      await pool.query(
        `SELECT to_jsonb(snapshot_row) - $1::text[] AS value
           FROM public.${table} snapshot_row
          ORDER BY (to_jsonb(snapshot_row) - $1::text[])::text`,
        [addedColumns],
      )
    ).rows;
  }
  return result;
}

async function seedOldContracts(pool: pg.Pool, client: pg.PoolClient) {
  const teacher = await seedTeacher(pool, 'joint-prefix');
  const identity = (
    await pool.query(
      'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
      [teacher.tenantId, teacher.teacherId],
    )
  ).rows[0] as { principal_id: string; account_id: string };
  const principal = identity.principal_id;
  const account = identity.account_id;
  await pool.query(
    `INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by)
     VALUES($1,'platform_admin','verified','admin-stage-a-2026-08','admin')`,
    [account],
  );
  // Deliberately synthetic encrypted-key fields: SQL admission only, no provider
  // client or network call. The retired old choice must migrate without losing it.
  const configurationVersion = (
    await pool.query(
      `SELECT ai_admin_set_config($1,true,'deepseek','deepseek-chat','replace',
       'prefix-test-ciphertext','prefix-test-iv','prefix-test-auth-tag','prefix-test-key',
       'prefix-config-225',100) AS version`,
      [principal],
    )
  ).rows[0].version as string;
  const prompt = 'Preserve this pre-upgrade question';
  const request = randomUUID();
  const thread = (await pool.query('SELECT ai_chat_create($1) AS id', [principal])).rows[0]
    .id as string;
  expect(
    (
      await pool.query('SELECT ai_chat_begin_paid($1,$2,$3,$4,$5) AS admitted', [
        principal,
        thread,
        request,
        prompt,
        configurationVersion,
      ])
    ).rows[0].admitted,
  ).toBe(true);
  expect(
    (
      await pool.query(
        "SELECT ai_chat_finish($1,$2,$3,'Preserve the original answer','complete') AS ok",
        [principal, thread, request],
      )
    ).rows[0].ok,
  ).toBe(true);
  const deletedThread = (await pool.query('SELECT ai_chat_create($1) AS id', [principal])).rows[0]
    .id as string;
  const deletedRequest = randomUUID();
  expect(
    (
      await pool.query(
        "SELECT ai_chat_begin_paid($1,$2,$3,'Deleted history quota',$4) AS admitted",
        [principal, deletedThread, deletedRequest, configurationVersion],
      )
    ).rows[0].admitted,
  ).toBe(true);
  await pool.query('SELECT ai_chat_abort($1,$2,$3)', [principal, deletedThread, deletedRequest]);
  expect(
    (await pool.query('SELECT ai_chat_delete($1,$2) AS ok', [principal, deletedThread])).rows[0].ok,
  ).toBe(true);

  const classroom = (
    await pool.query(
      `INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by)
     VALUES($1,$2,$3,'Prefix classroom',$4) RETURNING id`,
      [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
    )
  ).rows[0].id as string;
  await pool.query(
    `INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role)
     VALUES($1,$2,$3,$4,'owner')`,
    [teacher.tenantId, classroom, teacher.teacherId, account],
  );
  // Prefix 0224 initializes both learner identity and principal in the canonical
  // Seat creation command; a direct INSERT does not provide that contract.
  const seat = (
    await pool.query(
      "SELECT id FROM classroom_management_add_seat($1,$2,'Prefix learner','prefix225',true)",
      [account, classroom],
    )
  ).rows[0].id as string;
  // Issuance starts at 'issued'; retain the original fixture's active Seat using
  // the historical update command, without rotating its valid StudentCode.
  expect(
    (
      await pool.query(
        `SELECT id,status FROM classroom_management_update_seat(
         $1,$2,$3,'Prefix learner','prefix225',true,'active',NULL)`,
        [account, classroom, seat],
      )
    ).rows,
  ).toEqual([{ id: seat, status: 'active' }]);
  const seatPrincipals = (
    await pool.query(
      "SELECT id,account_id FROM principals WHERE kind='student_seat' AND seat_id=$1",
      [seat],
    )
  ).rows;
  expect(seatPrincipals).toEqual([{ id: expect.any(String), account_id: null }]);
  const seatPrincipal = seatPrincipals[0].id as string;
  const policies = {
    attemptPolicy: { maxAttempts: 2 },
    resultSelectionPolicy: { mode: 'latest_accepted' },
    completionPolicy: { mode: 'accepted' },
    latePolicy: { mode: 'allow_until_close' },
    assessmentPolicy: { mode: 'manual' },
    feedbackReleasePolicy: { mode: 'immediate' },
  };
  const activity = (
    await pool.query(
      `SELECT * FROM learning_activity_create($1,$2,'school','private','project',
       'Historical practice','Keep this exact activity','completion',NULL,$3::jsonb,
       'electronics',NULL,NULL,NULL,'prefix-activity-225')`,
      [principal, teacher.tenantId, JSON.stringify(policies)],
    )
  ).rows[0];
  expect(activity.result_code).toBe('ok');
  const activityPublication = (
    await pool.query(
      "SELECT * FROM learning_activity_publish($1,$2,$3,1,'prefix-activity-publish-225')",
      [principal, teacher.tenantId, activity.activity_id],
    )
  ).rows[0];
  expect(activityPublication.result_code).toBe('ok');
  const course = (
    await pool.query(
      `SELECT * FROM course_save_v2($1,$2,NULL,'Historical course','Keep its learner history',
       NULL,'private',NULL,'prefix-course-225')`,
      [principal, teacher.tenantId],
    )
  ).rows[0].id as string;
  const section = (
    await pool.query('SELECT section_id FROM course_outline_v3($1,$2,$3,$4) LIMIT 1', [
      course,
      principal,
      account,
      teacher.tenantId,
    ])
  ).rows[0].section_id as string;
  const lesson = (
    await pool.query(
      `SELECT course_lesson_save_v3($1,$2,$3,NULL,'Historical lesson',NULL,$4::jsonb,
       'assignment',NULL,15,$5) AS id`,
      [
        principal,
        course,
        section,
        JSON.stringify([{ id: 'intro', type: 'paragraph', text: 'Keep the lesson' }]),
        activityPublication.activity_version_id,
      ],
    )
  ).rows[0].id as string;
  const courseRevision = Number(
    (await pool.query('SELECT draft_revision FROM courses WHERE id=$1', [course])).rows[0]
      .draft_revision,
  );
  const publicationRequest = 'prefix-course-publish-225';
  const publication = (
    await pool.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
      principal,
      course,
      courseRevision,
      publicationRequest,
    ])
  ).rows[0];
  expect(publication).toMatchObject({ result_code: 'ok', version_number: 1, reused: false });
  const assignmentRequest = 'prefix-course-assign-225';
  const assignment = (
    await pool.query(
      "SELECT * FROM classroom_course_run_assign_v3($1,$2,$3,NULL,1,'named_learners',$4::uuid[],$5)",
      [principal, classroom, course, [seat], assignmentRequest],
    )
  ).rows[0];
  expect(assignment).toMatchObject({ result_code: 'ok', version_number: 1, reused: false });
  const participation = (
    await pool.query(
      `SELECT part.id,part.source_course_enrollment_id AS enrollment
     FROM activity_participations part JOIN activity_runs run ON run.id=part.activity_run_id
     WHERE run.source_course_run_id=$1`,
      [assignment.run_id],
    )
  ).rows;
  expect(participation).toHaveLength(1);
  // This historical command reads app.tenant_id. Keep its context and decision
  // on one connection/transaction; a prior autocommit query cannot supply it.
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [teacher.tenantId]);
    expect(
      (
        await client.query(
          "SELECT * FROM activity_participation_excuse($1,$2,'Existing excused decision')",
          [principal, participation[0].id],
        )
      ).rows[0].result_code,
    ).toBe('ok');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  const project = (
    await pool.query(
      `INSERT INTO projects(tenant_id,project_scope,module_key,title,owner_principal_id)
     VALUES($1,'personal','electronics','Historical public project',$2) RETURNING id`,
      [teacher.tenantId, principal],
    )
  ).rows[0].id as string;
  await pool.query(
    `INSERT INTO project_drafts(project_id,tenant_id,document_json,updated_by_principal_id)
     VALUES($1,$2,$3::jsonb,$4)`,
    [
      project,
      teacher.tenantId,
      JSON.stringify({ schemaVersion: 1, components: [], connections: [] }),
      principal,
    ],
  );
  await pool.query(
    `INSERT INTO project_snapshots(project_id,tenant_id,image,content_type,width,height,
       source_revision,captured_by_principal_id)
     VALUES($1,$2,$3,'image/png',16,16,1,$4)`,
    [project, teacher.tenantId, Buffer.alloc(64, 17), principal],
  );
  expect(
    (await pool.query('SELECT gallery_publish($1,$2) AS ok', [principal, project])).rows[0].ok,
  ).toBe(true);
  const projectPublication = (
    await pool.query(
      `SELECT state.id,revision.id AS revision_id,revision.schema_version
     FROM project_publication_state state JOIN project_publication_revisions revision
       ON revision.id=state.current_revision_id WHERE state.project_id=$1`,
      [project],
    )
  ).rows[0];
  expect(projectPublication.schema_version).toBe(1);
  return {
    principal,
    account,
    thread,
    request,
    prompt,
    deletedThread,
    deletedRequest,
    configurationVersion,
    classroom,
    seat,
    seatPrincipal,
    course,
    section,
    lesson,
    courseRevision,
    publicationRequest,
    publication,
    assignmentRequest,
    assignment,
    activityPublication,
    projectPublication,
  };
}

describe('joint AI, Courses, Portal and Projects supported-prefix upgrade', () => {
  it('upgrades real 0225 data through all pinned migrations without losing history or refunding quota', async () => {
    await withPrefixDatabase(async (pool, client, plan) => {
      const fixture = await seedOldContracts(pool, client);
      const beforeLedger = await ledger(pool);
      expect(
        beforeLedger.map(({ version, name, checksum }) => ({ version, name, checksum })),
      ).toEqual(
        plan
          .filter((item) => Number(item.version) <= 225)
          .map(({ version, name, checksum }) => ({ version, name, checksum })),
      );
      const before = await preservedData(pool);
      expect(before.course_versions).toHaveLength(1);
      expect(before.course_enrollments).toHaveLength(1);
      expect(before.activity_participations).toHaveLength(1);
      expect(before.project_versions).toHaveLength(1);
      expect(before.ai_paid_operation_quota).toHaveLength(2);
      const threads = (await pool.query('SELECT * FROM ai_assistant_threads ORDER BY id')).rows;
      const messages = (
        await pool.query('SELECT * FROM ai_assistant_messages ORDER BY created_at,id')
      ).rows;
      const quota = (
        await pool.query('SELECT * FROM ai_assistant_request_quota ORDER BY request_id')
      ).rows;
      expect(threads).toHaveLength(1);
      expect(messages).toHaveLength(2);
      expect(quota).toHaveLength(2);
      const config = (await pool.query('SELECT * FROM ai_assistant_config')).rows[0];
      const projectRevisions = (
        await pool.query('SELECT * FROM project_publication_revisions ORDER BY id')
      ).rows;
      expect(projectRevisions).toHaveLength(1);
      const completionBefore = (
        await pool.query(
          'SELECT learning_course_completion_internal(id) AS value FROM course_enrollments ORDER BY id',
        )
      ).rows;
      const participantFunctions = (
        await pool.query(
          `SELECT oid::regprocedure::text AS signature,prosrc,proowner,proacl,prosecdef,proconfig
         FROM pg_proc WHERE oid IN ('classroom_participant_roster(uuid,uuid)'::regprocedure,
           'classroom_participant_profile(uuid,uuid,uuid)'::regprocedure,
           'learning_canonical_evidence_for_teacher_account(uuid)'::regprocedure) ORDER BY oid::regprocedure::text`,
        )
      ).rows;
      expect(participantFunctions).toHaveLength(3);
      expect(
        validateMigrationHistory(new Map(beforeLedger.map((row) => [row.version, row])), plan).map(
          (item) => item.version,
        ),
      ).toEqual(upgradeArtifacts.map(([version]) => version));

      expect(await applyIsolatedTestPlan(client, plan)).toBe(upgradeArtifacts.length);
      const afterLedger = await ledger(pool);
      expect(afterLedger.filter((row) => Number(row.version) <= 225)).toEqual(beforeLedger);
      expect(
        afterLedger.map(({ version, name, checksum }) => ({ version, name, checksum })),
      ).toEqual(plan.map(({ version, name, checksum }) => ({ version, name, checksum })));
      expect(await preservedData(pool)).toEqual(before);
      // New public-copy provenance columns must be NULL on every historical Project.
      expect(
        (
          await pool.query(
            `SELECT copied_from_publication_id, copied_from_revision_id,
                    copied_from_version_id, copied_from_license
               FROM public.projects ORDER BY id`,
          )
        ).rows,
      ).toEqual(
        before.projects!.map(() => ({
          copied_from_publication_id: null,
          copied_from_revision_id: null,
          copied_from_version_id: null,
          copied_from_license: null,
        })),
      );
      expect(
        (
          await pool.query(
            'SELECT learning_course_completion_internal(id) AS value FROM course_enrollments ORDER BY id',
          )
        ).rows,
      ).toEqual(completionBefore);
      expect((await pool.query('SELECT * FROM ai_assistant_threads ORDER BY id')).rows).toEqual(
        threads.map((row) => ({
          ...row,
          owner_principal_id: fixture.principal,
          archived_at: null,
          next_message_ordinal: '2',
        })),
      );
      const userMessage = messages.find((row) => row.role === 'user');
      expect(userMessage).toBeDefined();
      expect(
        (await pool.query('SELECT * FROM ai_assistant_messages ORDER BY created_at,id')).rows,
      ).toEqual(
        messages.map((row, index) => ({
          ...row,
          owner_principal_id: fixture.principal,
          ordinal: String(index + 1),
          source_user_message_id: row.role === 'assistant' ? userMessage!.id : null,
        })),
      );
      expect(
        (await pool.query('SELECT * FROM ai_assistant_request_quota ORDER BY request_id')).rows,
      ).toEqual(quota.map((row) => ({ ...row, owner_principal_id: fixture.principal })));
      // Adding a provider must not retimestamp the slots created by migration 0227.
      const providerCatalogAppliedAt = afterLedger.find(
        (row) => row.version === '0227',
      )!.applied_at;
      const cloudProviderAppliedAt = afterLedger.find((row) => row.version === '0252')!.applied_at;
      const migratedConfig = (await pool.query('SELECT * FROM ai_assistant_config')).rows[0];
      expect(migratedConfig).toEqual({
        ...config,
        model: 'deepseek-flash',
        enabled: false,
        configuration_version: String(Number(config.configuration_version) + 1),
        migrated_from_model: 'deepseek-chat',
        updated_at: providerCatalogAppliedAt,
      });
      expect(migratedConfig.updated_at.getTime()).toBeGreaterThanOrEqual(
        config.updated_at.getTime(),
      );
      expect(
        (await pool.query('SELECT * FROM ai_provider_settings ORDER BY provider')).rows,
      ).toEqual([
        {
          provider: 'deepseek',
          model: 'deepseek-flash',
          api_key_ciphertext: config.api_key_ciphertext,
          api_key_iv: config.api_key_iv,
          api_key_auth_tag: config.api_key_auth_tag,
          key_fingerprint: config.key_fingerprint,
          updated_at: migratedConfig.updated_at,
        },
        {
          provider: 'ollama-cloud',
          model: 'gemma4:31b',
          api_key_ciphertext: null,
          api_key_iv: null,
          api_key_auth_tag: null,
          key_fingerprint: null,
          updated_at: cloudProviderAppliedAt,
        },
        {
          provider: 'openai',
          model: 'gpt-6-luna',
          api_key_ciphertext: null,
          api_key_iv: null,
          api_key_auth_tag: null,
          key_fingerprint: null,
          updated_at: providerCatalogAppliedAt,
        },
      ]);
      expect(
        (await pool.query('SELECT ai_student_access($1) AS value', [fixture.seat])).rows[0].value,
      ).toEqual({
        canGenerate: false,
        reason: 'ai_teacher_permission_required',
        rating: null,
        minimumRating: 50,
      });
      expect(
        (await pool.query('SELECT ai_access_owner($1,NULL) AS owner', [fixture.seatPrincipal]))
          .rows[0].owner,
      ).toBe(fixture.seatPrincipal);
      for (const table of [
        'ai_classroom_policies',
        'ai_seat_overrides',
        'ai_assistant_regenerations',
        'ai_attachment_uploads',
        'ai_attachment_message_receipts',
        'ai_attachment_bindings',
      ]) {
        expect(
          (await pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count,
        ).toBe(0);
      }
      const privateAttachments = (
        await pool.query(
          `SELECT relname,relrowsecurity,relforcerowsecurity,
           has_table_privilege('asalab_app',oid,'SELECT') AS runtime_read
         FROM pg_class WHERE oid IN ('ai_attachment_uploads'::regclass,
           'ai_attachment_message_receipts'::regclass,'ai_attachment_bindings'::regclass) ORDER BY relname`,
        )
      ).rows;
      expect(privateAttachments).toEqual(
        ['ai_attachment_bindings', 'ai_attachment_message_receipts', 'ai_attachment_uploads'].map(
          (relname) => ({
            relname,
            relrowsecurity: true,
            relforcerowsecurity: true,
            runtime_read: false,
          }),
        ),
      );

      expect(
        (
          await pool.query(
            'SELECT pointer,pin_kind,available,version_id FROM course_author_version_pins($1,$2,$3)',
            [fixture.principal, fixture.course, fixture.publication.version_id],
          )
        ).rows,
      ).toEqual([
        {
          pointer: '/sections/0/lessons/0/assignment',
          pin_kind: 'project',
          available: true,
          version_id: fixture.activityPublication.activity_version_id,
        },
      ]);
      expect(
        (
          await pool.query('SELECT result_code FROM course_prepublication_validation_v2($1,$2)', [
            fixture.principal,
            fixture.course,
          ])
        ).rows,
      ).toEqual([{ result_code: 'ok' }]);
      expect(
        (
          await pool.query('SELECT * FROM course_publish_v4($1,$2,$3,$4)', [
            fixture.principal,
            fixture.course,
            fixture.courseRevision,
            fixture.publicationRequest,
          ])
        ).rows[0],
      ).toMatchObject({
        result_code: 'ok',
        version_id: fixture.publication.version_id,
        version_number: 1,
        reused: true,
      });
      expect(
        (
          await pool.query(
            "SELECT * FROM classroom_course_run_assign_v3($1,$2,$3,NULL,1,'named_learners',$4::uuid[],$5)",
            [
              fixture.principal,
              fixture.classroom,
              fixture.course,
              [fixture.seat],
              fixture.assignmentRequest,
            ],
          )
        ).rows,
      ).toEqual([
        { result_code: 'ok', run_id: fixture.assignment.run_id, version_number: 1, reused: true },
      ]);
      const afterFunctions = (
        await pool.query(
          `SELECT oid::regprocedure::text AS signature,prosrc,proowner,proacl,prosecdef,proconfig
         FROM pg_proc WHERE oid IN ('classroom_participant_roster(uuid,uuid)'::regprocedure,
           'classroom_participant_profile(uuid,uuid,uuid)'::regprocedure,
           'learning_canonical_evidence_for_teacher_account(uuid)'::regprocedure) ORDER BY oid::regprocedure::text`,
        )
      ).rows;
      expect(afterFunctions).toEqual(
        participantFunctions.map((row) => ({
          ...row,
          proconfig: [
            ...(row.proconfig ?? []).filter((setting: string) => !setting.startsWith('jit=')),
            'jit=off',
          ],
        })),
      );
      expect(
        (await pool.query('SELECT * FROM project_publication_revisions ORDER BY id')).rows,
      ).toEqual(
        projectRevisions.map((row) => ({
          ...row,
          module_key: null,
          author_label: null,
          preview_image: null,
          preview_content_type: null,
          preview_width: null,
          preview_height: null,
        })),
      );
      expect(
        (
          await pool.query('SELECT * FROM public_projects_read($1,NULL,NULL,1,0)', [
            fixture.projectPublication.id,
          ])
        ).rows,
      ).toEqual([]);

      // Old request identities still replay without recharging; deletion did not
      // erase the second request's non-refundable tombstone during backfill.
      expect(
        (
          await pool.query('SELECT ai_chat_begin_paid($1,$2,$3,$4,$5) AS admitted', [
            fixture.principal,
            fixture.thread,
            fixture.request,
            fixture.prompt,
            fixture.configurationVersion,
          ])
        ).rows[0].admitted,
      ).toBe(false);
      await expect(
        pool.query("SELECT ai_chat_begin_paid($1,$2,$3,'Deleted history quota',$4)", [
          fixture.principal,
          fixture.deletedThread,
          fixture.deletedRequest,
          fixture.configurationVersion,
        ]),
      ).rejects.toMatchObject({ code: '22023', message: 'AI_REQUEST_ID_REUSED' });
      expect(await preservedData(pool)).toEqual(before);
      expect(
        (await pool.query('SELECT * FROM ai_assistant_request_quota ORDER BY request_id')).rows,
      ).toEqual(quota.map((row) => ({ ...row, owner_principal_id: fixture.principal })));

      const beforeRepeat = {
        data: await preservedData(pool),
        threads: (await pool.query('SELECT * FROM ai_assistant_threads ORDER BY id')).rows,
        messages: (await pool.query('SELECT * FROM ai_assistant_messages ORDER BY created_at,id'))
          .rows,
        config: (await pool.query('SELECT * FROM ai_assistant_config')).rows,
        providers: (await pool.query('SELECT * FROM ai_provider_settings ORDER BY provider')).rows,
        revisions: (await pool.query('SELECT * FROM project_publication_revisions ORDER BY id'))
          .rows,
      };
      expect(await applyIsolatedTestPlan(client, plan)).toBe(0);
      expect(await ledger(pool)).toEqual(afterLedger);
      expect({
        data: await preservedData(pool),
        threads: (await pool.query('SELECT * FROM ai_assistant_threads ORDER BY id')).rows,
        messages: (await pool.query('SELECT * FROM ai_assistant_messages ORDER BY created_at,id'))
          .rows,
        config: (await pool.query('SELECT * FROM ai_assistant_config')).rows,
        providers: (await pool.query('SELECT * FROM ai_provider_settings ORDER BY provider')).rows,
        revisions: (await pool.query('SELECT * FROM project_publication_revisions ORDER BY id'))
          .rows,
      }).toEqual(beforeRepeat);
    });
  }, 60_000);

  it.each([
    {
      history: '0233 without AI/Courses',
      applied: ['0233'],
      missing: ['0226', '0227', '0228', '0229', '0230', '0231', '0232'],
      frontier: '0233',
    },
    {
      history: '0234 without lower pending migrations',
      applied: ['0234'],
      missing: ['0226', '0227', '0228', '0229', '0230', '0231', '0232', '0233'],
      frontier: '0234',
    },
    {
      history: 'Courses first without AI',
      applied: ['0230', '0231', '0232'],
      missing: ['0226', '0227', '0228', '0229'],
      frontier: '0232',
    },
  ])(
    'rejects actually applied unsupported $history before any pending SQL',
    async ({ applied, missing, frontier }) => {
      await withPrefixDatabase(async (pool, client, plan) => {
        // These are deliberate unsupported negative fixtures in private databases,
        // not fake ledger rows and not newly supported release histories.
        expect(
          await applyIsolatedTestPlan(
            client,
            plan.filter((item) => applied.includes(item.version)),
          ),
        ).toBe(applied.length);
        const before = await ledger(pool);
        expect(before.filter((row) => Number(row.version) > 225).map((row) => row.version)).toEqual(
          applied,
        );
        const pendingSql = new Set(
          plan
            .filter((item) => !before.some((row) => row.version === item.version))
            .map((item) => item.sql),
        );
        const submitted = vi.spyOn(client, 'query');
        try {
          await expect(applyIsolatedTestPlan(client, plan)).rejects.toThrow(
            `Forbidden out-of-order pending migration(s): ${missing.join(', ')}; maximum applied migration version is ${frontier}. New additive migrations must use a version greater than every applied migration.`,
          );
          expect(
            submitted.mock.calls.some(([sql]) => typeof sql === 'string' && pendingSql.has(sql)),
          ).toBe(false);
        } finally {
          submitted.mockRestore();
        }
        expect(await ledger(pool)).toEqual(before);
        expect(
          (
            await pool.query(
              "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_assistant_threads' AND column_name='owner_principal_id'",
            )
          ).rows,
        ).toEqual([]);
      });
    },
    60_000,
  );
});
