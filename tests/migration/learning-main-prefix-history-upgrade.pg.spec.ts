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
    '0236_teacher_home_canonical_read_jit.sql',
    '60dae5f444e08a479acdb98752b434b1114680d3f742aa31dfc0484bfe5c9dd5',
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
  it('upgrades real 0225 data through all eleven migrations without losing history or refunding quota', async () => {
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

      expect(await applyIsolatedTestPlan(client, plan)).toBe(11);
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
      const migratedConfig = (await pool.query('SELECT * FROM ai_assistant_config')).rows[0];
      expect(migratedConfig).toEqual({
        ...config,
        model: 'deepseek-flash',
        enabled: false,
        configuration_version: String(Number(config.configuration_version) + 1),
        migrated_from_model: 'deepseek-chat',
        updated_at: expect.any(Date),
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
          provider: 'openai',
          model: 'gpt-6-luna',
          api_key_ciphertext: null,
          api_key_iv: null,
          api_key_auth_tag: null,
          key_fingerprint: null,
          updated_at: expect.any(Date),
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
