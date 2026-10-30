import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { planMigrations, validateMigrationHistory } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan } from './isolated-postgres-plan';

const expectedPending = [
  '0226',
  '0227',
  '0228',
  '0229',
  '0230',
  '0231',
  '0232',
  '0233',
  '0234',
  '0235',
  '0236',
  '0237',
  '0238',
  '0239', // Optional LAN Ollama; preserve older published migrations.
  '0240', // Courses Teacher Home: function-local JIT only.
  '0241', // Native MAX external-only registration preserves canonical account bootstrap.
  '0242', // Local Ollama binds immutable attachments without paid quota.
  '0243', // Recover original owned attachments for regenerated responses.
  '0244', // Current-only private per-owner usage journal.
  '0245', // Typed admin catalog and bounded server keyset continuation.
  '0246', // Read-only retained per-user history.
  '0247', // Full typed CRM cards and exact teacher educational reads.
  '0248', // Encrypted SMTP and one-use verified Account email proof.
  '0249', // Filtered CRM aggregates/export and explicit organization class binding.
  '0250', // Exact Seat retained detail and immutable educational notes.
  '0251', // Scoped organization and exact-class responsibilities.
  '0252', // Additive Ollama Cloud credentials preserve installed history.
  '0253', // Optional scoped campaign observations and factual catalog projections.
  '0254', // Free server internet evidence and bounded public weather cache.
  '0255', // Read-only administrative visibility of retained legacy publications.
  '0256', // Read-only exact-subject dashboard and canonical classroom rating.
  '0257', // Canonical draft timestamp projection repair.
  '0258', // Immutable Public Projects publication pins.
  '0259', // Private immutable-revision report intake.
  '0260', // Exact immutable Electronics public display.
  '0261', // Complete AI answers preserve installed data and SQL signatures.
  '0262', // Local owner-bound 30-minute generation lease.
  '0263', // Governed generation policy and retrieval.
  '0264', // Private image generation and GPU admission.
  '0265', // Native tool provenance.
  '0266', // Administrative tool-policy controls.
  '0267', // Additive frozen Courses completion repair, no data rewrite.
  '0268', // Additive read-only AI usage overview.
  '0269', // Exact public Scratch player and version-scoped asset reads.
  '0271', // Accepted Ollama Cloud catalog migration.
  '0272', // Accepted Ollama Cloud key pool migration.
  '0273', // Accepted ComfyUI endpoint migration.
  '0274', // Audited class/Seat distribution and immutable publication admission.
  '0275', // Global and author acquisition controls.
  '0276', // Independent providers.
  '0277', // Cloud pool provider projection.
  '0278', // Model selection policy.
  '0279', // Soft monthly token budgets.
  '0280', // Six image presets.
  '0281', // Versioned image profiles.
  '0282', // Local inference overrides preserve legacy defaults.
];

interface Identity {
  account_id: string;
  principal_id: string;
}

interface MigrationRecord {
  id: number;
  version: string;
  name: string;
  checksum: string;
  applied_at: string;
}

async function ledger(db: pg.Pool): Promise<MigrationRecord[]> {
  // JSON retains PostgreSQL timestamp precision; node-postgres Date does not.
  return (
    await db.query<{ item: MigrationRecord }>(
      'SELECT to_jsonb(m) AS item FROM schema_migrations m ORDER BY version',
    )
  ).rows.map((row) => row.item);
}

async function legacySnapshot(db: pg.Pool) {
  const tables: Record<string, string[]> = {
    accounts: [],
    profiles: [],
    principals: [],
    classrooms: [],
    classroom_student_seats: [],
    learner_identity_links: [],
    ai_assistant_threads: ['owner_principal_id', 'archived_at', 'next_message_ordinal'],
    ai_assistant_messages: ['owner_principal_id', 'ordinal', 'source_user_message_id'],
    ai_assistant_request_quota: ['owner_principal_id'],
    ai_paid_operation_quota: [],
    courses: [],
    course_sections: [],
    course_lessons: [],
    course_versions: [],
    classroom_course_runs: [],
    classroom_course_run_lessons: [],
    classroom_assignments: [],
    learning_activities: [],
    learning_activity_versions: [],
    activity_runs: [],
    course_enrollments: [],
    activity_participations: [],
    learning_audience_definitions: [],
    learning_audience_membership_claims: [],
    audit_events: [],
    // 0235 adds these four optional origin fields; every pre-existing row
    // must remain byte-identical after excluding only these new columns.
    projects: [
      'copied_from_publication_id',
      'copied_from_revision_id',
      'copied_from_version_id',
      'copied_from_license',
    ],
    project_drafts: [],
    project_versions: [],
    project_snapshots: [],
    project_publications: [],
    project_reactions: ['publication_id'],
    // 0275 consent and 0283 reaction controls add only explicit default columns. Keep every old field
    // (and any unrecognized future field) in the strict preserved-data comparison.
    project_publication_state: [
      'acquisition_allowed',
      'acquisition_version',
      'reactions_enabled',
      'reactions_version',
    ],
    project_publication_revisions: [
      'module_key',
      'author_label',
      'preview_image',
      'preview_content_type',
      'preview_width',
      'preview_height',
    ],
  };
  const snapshot: Record<string, Record<string, unknown>[]> = {};
  for (const [table, addedColumns] of Object.entries(tables)) {
    // Table names are the closed fixture list above, never external input.
    snapshot[table] = (
      await db.query<{ item: Record<string, unknown> }>(
        `SELECT to_jsonb(t) - $1::text[] AS item FROM public.${table} t
         ORDER BY (to_jsonb(t) - $1::text[])::text`,
        [addedColumns],
      )
    ).rows.map((row) => row.item);
  }
  return snapshot;
}

async function registerAccount(db: pg.Pool): Promise<Identity> {
  const unique = randomUUID().replaceAll('-', '');
  return (
    await db.query<Identity>(
      `SELECT account_id, principal_id FROM auth_register_account(
         $1, 'migration-fixture-only', 'Участник', $2,
         DATE '1990-01-01', 'RU', 'migration-fixture', $3, 1)`,
      [
        `ai-prefix-${unique}@example.test`,
        `ai${unique}`,
        createHash('sha256').update(unique).digest('hex'),
      ],
    )
  ).rows[0]!;
}

async function inTenant<T>(
  app: pg.Pool,
  tenantId: string,
  operation: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

describe('AI joint atomic upgrade from the supported installed prefix through 0225', () => {
  it.each([
    {
      history: '0234 with missing AI, Courses and Portal migrations',
      partial: ['0234'],
      missing: '0226, 0227, 0228, 0229, 0230, 0231, 0232, 0233',
      maximum: '0234',
    },
    {
      history: '0233 with missing AI and Courses migrations',
      partial: ['0233'],
      missing: '0226, 0227, 0228, 0229, 0230, 0231, 0232',
      maximum: '0233',
    },
    {
      history: 'Courses-first with missing AI migrations',
      partial: ['0230', '0231', '0232'],
      missing: '0226, 0227, 0228, 0229',
      maximum: '0232',
    },
  ])(
    'rejects unsupported $history with the pure pre-SQL guard',
    ({ partial, missing, maximum }) => {
      const plan = planMigrations();
      expect(plan.filter((item) => Number(item.version) > 225).map((item) => item.version)).toEqual(
        expectedPending,
      );
      const unsupported = new Map(
        plan
          .filter(
            (item) =>
              Number(item.version) <= 225 || partial.some((version) => version === item.version),
          )
          .map((item) => [item.version, { checksum: item.checksum }]),
      );
      expect(unsupported.has('0225')).toBe(true);
      for (const version of partial) expect(unsupported.has(version)).toBe(true);
      expect(() => validateMigrationHistory(unsupported, plan)).toThrow(
        `Forbidden out-of-order pending migration(s): ${missing}; maximum applied migration version is ${maximum}.`,
      );
    },
  );

  it('upgrades real 0225 AI, Course and Project history with exact data, receipts and ledger intact', async () => {
    const sources = ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL'].map((key) => {
      const value = process.env[key];
      if (!value) throw new Error(`${key} must explicitly name an isolated _test database`);
      const url = new URL(value);
      if (!decodeURIComponent(url.pathname).endsWith('_test'))
        throw new Error(`${key} must name an isolated _test database`);
      return url;
    });
    const source = sources[0]!;
    const appSource = sources[1]!;
    if (source.host !== appSource.host || source.pathname !== appSource.pathname)
      throw new Error('Admin and runtime roles must target the same isolated test database');
    const name = 'asa_ai_prefix_' + randomUUID().replaceAll('-', '') + '_test';
    if (!/^asa_ai_prefix_[a-f0-9]{32}_test$/.test(name))
      throw new Error('Unsafe generated test database name');

    const owner = new pg.Client({ connectionString: source.href });
    let databaseCreated = false;
    let admin: pg.Pool | undefined;
    let runtime: pg.Pool | undefined;
    try {
      await owner.connect();
      await owner.query('CREATE DATABASE "' + name + '"');
      databaseCreated = true;
      const target = new URL(source);
      target.pathname = '/' + name;
      const appTarget = new URL(appSource);
      appTarget.pathname = '/' + name;
      const db = (admin = new pg.Pool({ connectionString: target.href, max: 3 }));
      const app = (runtime = new pg.Pool({ connectionString: appTarget.href, max: 2 }));
      const plan = planMigrations();
      const prefix = plan.filter((item) => Number(item.version) <= 225);
      expect(prefix.at(-1)?.version).toBe('0225');
      expect(plan.filter((item) => Number(item.version) > 225).map((item) => item.version)).toEqual(
        expectedPending,
      );
      const bootstrap = await db.connect();
      try {
        expect(await applyIsolatedTestPlan(bootstrap, prefix)).toBe(prefix.length);
      } finally {
        bootstrap.release();
      }
      expect(
        (
          await app.query(
            `SELECT current_user AS role, rolsuper, rolbypassrls
             FROM pg_roles WHERE rolname = current_user`,
          )
        ).rows,
      ).toEqual([{ role: 'asalab_app', rolsuper: false, rolbypassrls: false }]);

      // All fixture identities and chat admissions use contracts already present
      // in 0225. No future columns or manually fabricated AI receipt rows.
      const account = await registerAccount(db);
      const stranger = await registerAccount(db);
      await db.query(
        `INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by)
         VALUES ($1,'educator','verified','migration-fixture','admin'),
                ($1,'platform_admin','verified','migration-fixture','admin')`,
        [account.account_id],
      );
      const context = (
        await app.query('SELECT * FROM classroom_ensure_personal_teacher($1)', [account.account_id])
      ).rows[0]!;
      const classroomId = (
        await db.query<{ id: string }>(
          `INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by)
           VALUES ($1,$2,$3,'Класс до обновления',$4) RETURNING id`,
          [context.tenant_id, context.school_id, context.academic_period_id, context.user_id],
        )
      ).rows[0]!.id;
      await db.query(
        `INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role)
         VALUES ($1,$2,$3,$4,'owner')`,
        [context.tenant_id, classroomId, context.user_id, account.account_id],
      );
      const seatId = (
        await app.query<{ id: string }>(
          "SELECT id FROM classroom_management_add_seat($1,$2,'Ученик без Account',$3,true)",
          [account.account_id, classroomId, randomUUID().slice(0, 8)],
        )
      ).rows[0]!.id;
      const seatPrincipal = (
        await db.query<{ id: string; account_id: string | null }>(
          "SELECT id, account_id FROM principals WHERE kind='student_seat' AND seat_id=$1",
          [seatId],
        )
      ).rows;
      expect(seatPrincipal).toEqual([{ id: expect.any(String), account_id: null }]);
      const seatOwner = seatPrincipal[0]!.id;

      // Exercise real pre-0226 authoring, delivery and Gallery commands. The
      // future joint tree must not replace these fixtures with post-upgrade rows.
      const legacy = await inTenant(app, context.tenant_id, async (client) => {
        const policies = {
          attemptPolicy: { maxAttempts: 2 },
          resultSelectionPolicy: { mode: 'latest' },
          completionPolicy: { mode: 'submission' },
          latePolicy: { mode: 'allow_mark_late' },
          assessmentPolicy: { mode: 'manual' },
          feedbackReleasePolicy: { mode: 'after_review' },
        };
        const activity = (
          await client.query(
            `SELECT * FROM learning_activity_create(
               $1,$2,'personal','private','project','Материал до обновления',
               'Сохранить точный материал','completion',NULL,$3::jsonb,
               'electronics',NULL,NULL,NULL,'prefix:activity:create')`,
            [account.principal_id, context.tenant_id, JSON.stringify(policies)],
          )
        ).rows[0]!;
        expect(activity.result_code).toBe('ok');
        const activityVersion = (
          await client.query(
            "SELECT * FROM learning_activity_publish($1,$2,$3,1,'prefix:activity:publish')",
            [account.principal_id, context.tenant_id, activity.activity_id],
          )
        ).rows[0]!;
        expect(activityVersion).toMatchObject({ result_code: 'ok', version_number: 1 });
        const course = (
          await client.query(
            `SELECT * FROM course_save_v2(
               $1,$2,NULL,'Курс до обновления','Сохранить версию и выдачу',NULL,
               'private',NULL,'prefix:course:create')`,
            [account.principal_id, context.tenant_id],
          )
        ).rows[0]!;
        expect(course.result_code).toBe('ok');
        const sectionId = (
          await client.query<{ section_id: string }>(
            'SELECT section_id FROM course_outline_v3($1,$2,$3,$4) LIMIT 1',
            [course.id, account.principal_id, account.account_id, context.tenant_id],
          )
        ).rows[0]!.section_id;
        const lessonId = (
          await client.query<{ id: string }>(
            `SELECT course_lesson_save_v3(
               $1,$2,$3,NULL,'Урок до обновления',NULL,$4::jsonb,
               'assignment',NULL,15,$5) AS id`,
            [
              account.principal_id,
              course.id,
              sectionId,
              JSON.stringify([{ id: 'prefix-text', type: 'paragraph', text: 'Старое содержание' }]),
              activityVersion.activity_version_id,
            ],
          )
        ).rows[0]!.id;
        expect(lessonId).toEqual(expect.any(String));
        const revision = (
          await client.query<{ revision: number }>(
            'SELECT course_draft_revision($1,$2) AS revision',
            [account.principal_id, course.id],
          )
        ).rows[0]!.revision;
        const publicationRequest = 'prefix:course:publish';
        const publication = (
          await client.query('SELECT to_jsonb(p) AS item FROM course_publish_v3($1,$2,$3,$4) p', [
            account.principal_id,
            course.id,
            revision,
            publicationRequest,
          ])
        ).rows[0]!.item;
        expect(publication).toMatchObject({ result_code: 'ok', version_number: 1, reused: false });
        const assignmentRequest = 'prefix:course:assign';
        const run = (
          await client.query(
            `SELECT * FROM classroom_course_run_assign_v3(
               $1,$2,$3,NULL,1,'whole_class','{}'::uuid[],$4)`,
            [account.principal_id, classroomId, course.id, assignmentRequest],
          )
        ).rows[0]!;
        expect(run).toMatchObject({ result_code: 'ok', version_number: 1, reused: false });
        const archived = (
          await client.query(
            'SELECT * FROM course_archive_set($1,$2,true,course_draft_revision($1,$2))',
            [account.principal_id, course.id],
          )
        ).rows[0]!;
        expect(archived.result_code).toBe('ok');
        expect(archived.archived_at).not.toBeNull();

        // Project Core's original runtime INSERT contract, followed by its old
        // Gallery publisher, creates a real immutable schema-1 publication.
        const document = {
          schemaVersion: 1,
          components: [],
          connections: [],
          privateMarker: 'prefix-original-document',
        };
        const projectId = (
          await client.query<{ id: string }>(
            `INSERT INTO projects
               (tenant_id,project_scope,module_key,title,created_by,owner_principal_id)
             VALUES ($1,'personal','electronics','Проект до обновления',$2,$3) RETURNING id`,
            [context.tenant_id, context.user_id, account.principal_id],
          )
        ).rows[0]!.id;
        await client.query(
          `INSERT INTO project_drafts
             (project_id,tenant_id,document_json,updated_by,updated_by_principal_id)
           VALUES ($1,$2,$3::jsonb,$4,$5)`,
          [
            projectId,
            context.tenant_id,
            JSON.stringify(document),
            context.user_id,
            account.principal_id,
          ],
        );
        await client.query(
          `INSERT INTO project_snapshots
             (project_id,tenant_id,image,content_type,width,height,source_revision,
              captured_by,captured_by_principal_id)
           VALUES ($1,$2,$3,'image/png',16,16,1,$4,$5)`,
          [
            projectId,
            context.tenant_id,
            Buffer.alloc(64, 23),
            context.user_id,
            account.principal_id,
          ],
        );
        expect(
          (
            await client.query('SELECT gallery_publish($1,$2) AS ok', [
              account.principal_id,
              projectId,
            ])
          ).rows,
        ).toEqual([{ ok: true }]);
        return {
          courseId: course.id as string,
          activityId: activity.activity_id as string,
          activityVersionId: activityVersion.activity_version_id as string,
          lessonId,
          revision,
          archivedRevision: archived.draft_revision as number,
          publication,
          publicationRequest,
          run,
          assignmentRequest,
          projectId,
          document,
        };
      });

      // Nonempty legacy like/wow rows must survive the new reaction namespace exactly.
      const legacyReactor = (
        await db.query<{ id: string }>('SELECT id FROM principals WHERE id<>$1 LIMIT 1', [
          account.principal_id,
        ])
      ).rows[0]!.id;
      await db.query(
        "INSERT INTO project_reactions(project_id,reactor_principal_id,kind) VALUES($1,$2,'like'),($1,$2,'wow')",
        [legacy.projectId, legacyReactor],
      );

      // Synthetic ciphertext is never decrypted or sent to any provider.
      const configurationVersion = (
        await app.query<{ version: string }>(
          `SELECT ai_admin_set_config($1,true,'deepseek','deepseek-chat','replace',
             'prefix-fixture-ciphertext','prefix-fixture-iv','prefix-fixture-auth-tag',
             'prefix-fixture',$2,100) AS version`,
          [account.principal_id, randomUUID()],
        )
      ).rows[0]!.version;
      const createThread = async () =>
        (await app.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [account.principal_id]))
          .rows[0]!.id;
      const threadId = await createThread();
      const turns = [
        {
          request: randomUUID(),
          prompt: 'Первый старый вопрос',
          answer: 'Первый ответ',
          state: 'complete',
        },
        {
          request: randomUUID(),
          prompt: 'Второй старый вопрос',
          answer: 'Неполный ответ',
          state: 'stopped',
        },
      ];
      for (const turn of turns) {
        expect(
          (
            await app.query<{ admitted: boolean }>(
              'SELECT ai_chat_begin_paid($1,$2,$3,$4,$5) AS admitted',
              [account.principal_id, threadId, turn.request, turn.prompt, configurationVersion],
            )
          ).rows[0]!.admitted,
        ).toBe(true);
        expect(
          (
            await app.query<{ saved: boolean }>('SELECT ai_chat_finish($1,$2,$3,$4,$5) AS saved', [
              account.principal_id,
              threadId,
              turn.request,
              turn.answer,
              turn.state,
            ])
          ).rows[0]!.saved,
        ).toBe(true);
      }
      const deletedThread = await createThread();
      const deletedRequest = randomUUID();
      expect(
        (
          await app.query<{ admitted: boolean }>(
            "SELECT ai_chat_begin_paid($1,$2,$3,'Удалённый вопрос',$4) AS admitted",
            [account.principal_id, deletedThread, deletedRequest, configurationVersion],
          )
        ).rows[0]!.admitted,
      ).toBe(true);
      await app.query('SELECT ai_chat_abort($1,$2,$3)', [
        account.principal_id,
        deletedThread,
        deletedRequest,
      ]);
      await app.query('SELECT ai_chat_delete($1,$2)', [account.principal_id, deletedThread]);
      const emptyThread = await createThread();
      expect(
        (
          await app.query<{ admitted: boolean }>('SELECT ai_admin_test_begin($1,$2) AS admitted', [
            account.principal_id,
            configurationVersion,
          ])
        ).rows[0]!.admitted,
      ).toBe(true);

      const before = await legacySnapshot(db);
      expect(before.ai_assistant_threads).toHaveLength(2);
      expect(before.ai_assistant_messages).toHaveLength(4);
      expect(before.ai_assistant_request_quota).toHaveLength(3);
      expect(before.ai_assistant_request_quota).toContainEqual(
        expect.objectContaining({ account_id: account.account_id, request_id: deletedRequest }),
      );
      expect(before.ai_paid_operation_quota).toHaveLength(4);
      expect(
        before.ai_paid_operation_quota!.filter((row) => row.operation === 'chat'),
      ).toHaveLength(3);
      expect(
        before.ai_paid_operation_quota!.filter((row) => row.operation === 'provider_test'),
      ).toHaveLength(1);
      expect(before.courses).toEqual([
        expect.objectContaining({
          id: legacy.courseId,
          owner_principal_id: account.principal_id,
          title: 'Курс до обновления',
          archived_at: expect.any(String),
        }),
      ]);
      expect(before.course_versions).toEqual([
        expect.objectContaining({ id: legacy.publication.version_id, version_number: 1 }),
      ]);
      expect(before.course_lessons).toEqual([
        expect.objectContaining({
          id: legacy.lessonId,
          learning_activity_version_id: legacy.activityVersionId,
          blocks: [{ id: 'prefix-text', type: 'paragraph', text: 'Старое содержание' }],
        }),
      ]);
      expect(before.classroom_course_runs).toEqual([
        expect.objectContaining({
          id: legacy.run.run_id,
          course_version_id: legacy.publication.version_id,
          creation_request_id: legacy.assignmentRequest,
        }),
      ]);
      expect(before.classroom_course_run_lessons).toEqual([
        expect.objectContaining({ run_id: legacy.run.run_id, source_lesson_id: legacy.lessonId }),
      ]);
      expect(before.activity_runs).toEqual([
        expect.objectContaining({
          source_course_run_id: legacy.run.run_id,
          learning_activity_version_id: legacy.activityVersionId,
        }),
      ]);
      expect(before.project_drafts).toEqual([
        expect.objectContaining({ project_id: legacy.projectId, document_json: legacy.document }),
      ]);
      expect(before.project_versions).toEqual([
        expect.objectContaining({
          project_id: legacy.projectId,
          document_json: legacy.document,
          version_no: 1,
        }),
      ]);
      expect(before.project_snapshots).toEqual([
        expect.objectContaining({
          project_id: legacy.projectId,
          image: '\\x' + Buffer.alloc(64, 23).toString('hex'),
          source_revision: 1,
        }),
      ]);
      expect(before.project_publications).toHaveLength(1);
      expect(before.project_publication_state).toEqual([
        expect.objectContaining({
          project_id: legacy.projectId,
          state: 'public',
          owner_principal_id: account.principal_id,
        }),
      ]);
      expect(before.project_publication_revisions).toEqual([
        expect.objectContaining({
          project_id: legacy.projectId,
          schema_version: 1,
          revision_no: 1,
          project_version_id: before.project_versions![0]!.id,
        }),
      ]);
      const courseVersionsBefore = before.course_versions!.map(
        ({ id, version_number, outline, published_at }) => ({
          id,
          version_number,
          outline,
          published_at,
        }),
      );
      const exactPinBefore = (
        await db.query(
          `SELECT '/sections/0/lessons/0/assignment'::text AS pointer,
                  'project'::varchar AS pin_kind, true AS available,
                  activity_id,id AS version_id,version_number,title,instructions,
                  goal,goal_snapshot_present,blocks,blocks_snapshot_present,
                  module_key,result_mode,max_points,policy_snapshot,content_digest
             FROM learning_activity_versions WHERE id=$1`,
          [legacy.activityVersionId],
        )
      ).rows;
      expect(exactPinBefore).toEqual([
        expect.objectContaining({
          activity_id: legacy.activityId,
          version_id: legacy.activityVersionId,
          title: 'Материал до обновления',
          instructions: 'Сохранить точный материал',
          content_digest: expect.any(String),
        }),
      ]);
      const configBefore = (await db.query('SELECT to_jsonb(c) AS item FROM ai_assistant_config c'))
        .rows[0]!.item;
      const oldOrder = (
        await db.query<{ id: string; role: string; request_id: string }>(
          `SELECT id,role,request_id FROM ai_assistant_messages
           WHERE thread_id=$1 ORDER BY created_at,id`,
          [threadId],
        )
      ).rows;
      const readHistory = async (actor: string) =>
        (
          await app.query(
            'SELECT to_jsonb(m) AS item FROM ai_chat_messages($1,$2) m ORDER BY created_at,id',
            [actor, threadId],
          )
        ).rows;
      const historyBefore = await readHistory(account.principal_id);
      expect(historyBefore).toHaveLength(4);
      const readPortal = async (client: pg.Pool | pg.PoolClient) =>
        (
          await client.query(
            `SELECT classroom_participant_roster($1,$2) AS roster,
                    classroom_participant_profile($1,$2,$3) AS profile`,
            [account.principal_id, classroomId, seatId],
          )
        ).rows[0]!;
      const portalBefore = await readPortal(app);
      expect(portalBefore.roster.items).toEqual([expect.objectContaining({ seatId })]);
      expect(portalBefore.profile.student.id).toBe(seatId);
      expect(portalBefore.profile.metrics).toMatchObject({ seatId });
      const ledgerBefore = await ledger(db);
      expect(
        ledgerBefore.map(({ version, name, checksum }) => ({ version, name, checksum })),
      ).toEqual(prefix.map(({ version, name, checksum }) => ({ version, name, checksum })));
      const applied = new Map(ledgerBefore.map((row) => [row.version, { checksum: row.checksum }]));
      expect(validateMigrationHistory(applied, plan).map((item) => item.version)).toEqual(
        expectedPending,
      );

      const upgrade = await db.connect();
      try {
        expect(await applyIsolatedTestPlan(upgrade, plan)).toBe(expectedPending.length);
        expect(
          (
            await upgrade.query(
              'SELECT enabled,version FROM publication_acquisition_settings WHERE singleton_key',
            )
          ).rows,
        ).toEqual([{ enabled: false, version: 0 }]);
        expect(
          (
            await upgrade.query(
              'SELECT acquisition_allowed, acquisition_version, reactions_enabled, reactions_version FROM project_publication_state ORDER BY id',
            )
          ).rows,
        ).toEqual(
          before.project_publication_state!.map(() => ({
            acquisition_allowed: false,
            acquisition_version: 0,
            reactions_enabled: true,
            reactions_version: 0,
          })),
        );
      } finally {
        upgrade.release();
      }
      expect(
        (
          await db.query(
            'SELECT count(*)::integer n FROM project_reactions WHERE project_id=$1 AND publication_id IS NULL',
            [legacy.projectId],
          )
        ).rows,
      ).toEqual([{ n: 2 }]);
      const ledgerAfter = await ledger(db);
      expect(ledgerAfter.slice(0, ledgerBefore.length)).toEqual(ledgerBefore);
      expect(ledgerAfter.slice(ledgerBefore.length).map((row) => row.version)).toEqual(
        expectedPending,
      );
      expect(
        ledgerAfter.map(({ version, name, checksum }) => ({ version, name, checksum })),
      ).toEqual(plan.map(({ version, name, checksum }) => ({ version, name, checksum })));
      // The newly added optional copy origin must be entirely NULL for every
      // historic Project, not just ignored by the legacy data comparison.
      expect(
        (
          await db.query(
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
      expect(await legacySnapshot(db)).toEqual(before);
      for (const table of [
        'ai_assistant_threads',
        'ai_assistant_messages',
        'ai_assistant_request_quota',
      ]) {
        expect((await db.query(`SELECT DISTINCT owner_principal_id FROM ${table}`)).rows).toEqual([
          { owner_principal_id: account.principal_id },
        ]);
      }
      expect(
        (
          await db.query(
            `SELECT id,ordinal,source_user_message_id FROM ai_assistant_messages
             WHERE thread_id=$1 ORDER BY ordinal`,
            [threadId],
          )
        ).rows,
      ).toEqual(
        oldOrder.map((message, index) => ({
          id: message.id,
          ordinal: String(index + 1),
          source_user_message_id:
            message.role === 'user'
              ? null
              : oldOrder.find(
                  (question) =>
                    question.role === 'user' && question.request_id === message.request_id,
                )!.id,
        })),
      );
      for (const [id, ordinal] of [
        [threadId, '4'],
        [emptyThread, '0'],
      ]) {
        expect(
          (
            await db.query(
              'SELECT archived_at,next_message_ordinal FROM ai_assistant_threads WHERE id=$1',
              [id],
            )
          ).rows,
        ).toEqual([{ archived_at: null, next_message_ordinal: ordinal }]);
      }
      // Slot timestamps belong to the transaction that created each provider, not
      // whichever migration happens to be last in the complete upgrade plan.
      const providerCatalogAppliedAt = ledgerAfter.find(
        (row) => row.version === '0227',
      )!.applied_at;
      const cloudProviderAppliedAt = ledgerAfter.find((row) => row.version === '0252')!.applied_at;
      const configAfter = (await db.query('SELECT to_jsonb(c) AS item FROM ai_assistant_config c'))
        .rows[0]!.item;
      expect(configAfter).toEqual({
        ...configBefore,
        model: 'deepseek-flash',
        enabled: false,
        migrated_from_model: 'deepseek-chat',
        configuration_version: configBefore.configuration_version + 1,
        updated_at: providerCatalogAppliedAt,
      });
      expect(
        (
          await db.query('SELECT to_jsonb(p) AS item FROM ai_provider_settings p ORDER BY provider')
        ).rows.map((row) => row.item),
      ).toEqual([
        {
          provider: 'deepseek',
          enabled: false,
          revision: 1,
          model: 'deepseek-flash',
          api_key_ciphertext: configBefore.api_key_ciphertext,
          api_key_iv: configBefore.api_key_iv,
          api_key_auth_tag: configBefore.api_key_auth_tag,
          key_fingerprint: configBefore.key_fingerprint,
          updated_at: configAfter.updated_at,
        },
        {
          provider: 'ollama-cloud',
          enabled: false,
          revision: 1,
          model: 'gemma4:31b',
          api_key_ciphertext: null,
          api_key_iv: null,
          api_key_auth_tag: null,
          key_fingerprint: null,
          updated_at: cloudProviderAppliedAt,
        },
        {
          provider: 'openai',
          enabled: false,
          revision: 1,
          model: 'gpt-6-luna',
          api_key_ciphertext: null,
          api_key_iv: null,
          api_key_auth_tag: null,
          key_fingerprint: null,
          updated_at: providerCatalogAppliedAt,
        },
      ]);

      const newPrivateTables = [
        'ai_classroom_policies',
        'ai_seat_overrides',
        'ai_classroom_policy_receipts',
        'ai_assistant_regenerations',
        'ai_attachment_uploads',
        'ai_attachment_message_receipts',
        'ai_attachment_bindings',
      ];
      for (const table of newPrivateTables) {
        expect((await db.query(`SELECT count(*)::integer AS n FROM ${table}`)).rows).toEqual([
          { n: 0 },
        ]);
      }
      const forceRlsTables = [
        ...newPrivateTables,
        'ai_assistant_threads',
        'ai_assistant_messages',
        'ai_assistant_request_quota',
      ].sort();
      expect(
        (
          await db.query(
            `SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class
           WHERE oid IN (SELECT ('public.' || name)::regclass FROM unnest($1::text[]) AS names(name))
           ORDER BY relname`,
            [forceRlsTables],
          )
        ).rows,
      ).toEqual(
        forceRlsTables.map((relname) => ({
          relname,
          relrowsecurity: true,
          relforcerowsecurity: true,
        })),
      );
      for (const table of [
        ...forceRlsTables,
        'ai_assistant_config',
        'ai_provider_settings',
        'ai_paid_operation_quota',
      ]) {
        await expect(app.query(`SELECT * FROM ${table}`)).rejects.toMatchObject({ code: '42501' });
      }
      expect((await app.query('SELECT ai_access_owner($1) AS owner', [seatOwner])).rows).toEqual([
        { owner: seatOwner },
      ]);
      expect((await app.query('SELECT ai_access_status($1) AS status', [seatOwner])).rows).toEqual([
        {
          status: {
            canGenerate: false,
            reason: 'ai_teacher_permission_required',
            rating: null,
            minimumRating: 50,
          },
        },
      ]);
      await expect(app.query('SELECT ai_chat_create($1)', [seatOwner])).rejects.toMatchObject({
        code: '42501',
        message: 'AI_STUDENT_DENIED',
      });
      await expect(
        app.query('SELECT ai_access_owner($1,$2)', [account.principal_id, seatId]),
      ).rejects.toMatchObject({ code: '42501' });
      expect(await readHistory(account.principal_id)).toEqual(historyBefore);
      expect(await readHistory(stranger.principal_id)).toEqual([]);
      expect(await readHistory(seatOwner)).toEqual([]);
      // Stale configuration and disabled migrated provider cannot charge a replay.
      expect(
        (
          await app.query<{ admitted: boolean }>(
            'SELECT ai_chat_begin_paid($1,$2,$3,$4,$5) AS admitted',
            [
              account.principal_id,
              threadId,
              turns[0]!.request,
              turns[0]!.prompt,
              configurationVersion,
            ],
          )
        ).rows[0]!.admitted,
      ).toBe(false);
      await expect(
        app.query("SELECT ai_chat_begin_paid($1,$2,$3,'Удалённый вопрос',$4)", [
          account.principal_id,
          deletedThread,
          deletedRequest,
          configurationVersion,
        ]),
      ).rejects.toMatchObject({ code: '22023', message: 'AI_REQUEST_ID_REUSED' });

      // The new author readers must use the old immutable CourseVersion and
      // ActivityVersion even after archive, with no access for another owner.
      const readCourseVersions = async (actor: string) =>
        (
          await app.query('SELECT to_jsonb(v) AS item FROM course_author_versions($1,$2) v', [
            actor,
            legacy.courseId,
          ])
        ).rows.map((row) => row.item);
      const readCoursePins = async (actor: string) =>
        (
          await app.query('SELECT * FROM course_author_version_pins($1,$2,$3)', [
            actor,
            legacy.courseId,
            legacy.publication.version_id,
          ])
        ).rows;
      expect(await readCourseVersions(account.principal_id)).toEqual(courseVersionsBefore);
      expect(await readCoursePins(account.principal_id)).toEqual(exactPinBefore);
      expect(await readCourseVersions(stranger.principal_id)).toEqual([]);
      expect(await readCoursePins(stranger.principal_id)).toEqual([]);
      expect(
        (
          await app.query('SELECT to_jsonb(p) AS item FROM course_publish_v4($1,$2,$3,$4) p', [
            account.principal_id,
            legacy.courseId,
            legacy.revision,
            legacy.publicationRequest,
          ])
        ).rows[0]!.item,
      ).toMatchObject({
        result_code: 'ok',
        version_id: legacy.publication.version_id,
        version_number: 1,
        published_at: legacy.publication.published_at,
        reused: true,
        problem_reason: null,
      });
      expect(
        (
          await app.query(
            "SELECT * FROM course_publish_v4($1,$2,$3,'prefix:course:fresh:publish')",
            [account.principal_id, legacy.courseId, legacy.archivedRevision],
          )
        ).rows[0],
      ).toMatchObject({
        result_code: 'prepublish_invalid',
        version_id: null,
        reused: false,
        problem_kind: 'course',
        problem_id: legacy.courseId,
        problem_field: 'archivedAt',
        problem_reason: 'course_archived',
      });
      const assignCourse = async (request: string) =>
        (
          await app.query(
            `SELECT * FROM classroom_course_run_assign_v3(
               $1,$2,$3,NULL,1,'whole_class','{}'::uuid[],$4)`,
            [account.principal_id, classroomId, legacy.courseId, request],
          )
        ).rows;
      expect(await assignCourse(legacy.assignmentRequest)).toEqual([
        { ...legacy.run, reused: true },
      ]);
      expect(await assignCourse('prefix:course:fresh:assign')).toEqual([
        { result_code: 'course_archived', run_id: null, version_number: null, reused: false },
      ]);

      // 0234 adds nullable schema-2 metadata; it must neither republish nor
      // discard the old schema-1 Gallery publication and exact private bytes.
      expect(
        (
          await db.query(
            `SELECT schema_version,module_key,author_label,preview_image,
                    preview_content_type,preview_width,preview_height
               FROM project_publication_revisions WHERE project_id=$1`,
            [legacy.projectId],
          )
        ).rows,
      ).toEqual([
        {
          schema_version: 1,
          module_key: null,
          author_label: null,
          preview_image: null,
          preview_content_type: null,
          preview_width: null,
          preview_height: null,
        },
      ]);
      const oldPublicationId = before.project_publication_state![0]!.id;
      expect(
        (
          await app.query('SELECT * FROM public_projects_read($1,NULL,NULL,1,0)', [
            oldPublicationId,
          ])
        ).rows,
      ).toEqual([]);
      expect(
        (await app.query('SELECT * FROM public_project_image($1,NULL)', [oldPublicationId])).rows,
      ).toEqual([]);
      expect(
        (await app.query('SELECT * FROM gallery_work(NULL,$1)', [legacy.projectId])).rows,
      ).toEqual([]);
      expect(
        (
          await app.query('SELECT project_publication_status($1,$2) AS status', [
            account.principal_id,
            legacy.projectId,
          ])
        ).rows,
      ).toEqual([{ status: { publication: null, canPublish: true, reasonCode: null } }]);
      expect(
        (
          await app.query('SELECT project_publication_status($1,$2) AS status', [
            stranger.principal_id,
            legacy.projectId,
          ])
        ).rows,
      ).toEqual([{ status: null }]);
      for (const table of ['project_publication_state', 'project_publication_revisions']) {
        expect(
          (
            await db.query(
              'SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass',
              ['public.' + table],
            )
          ).rows,
        ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
        await expect(app.query(`SELECT * FROM ${table}`)).rejects.toMatchObject({ code: '42501' });
      }

      const functions = (
        await db.query(
          `SELECT proname,proconfig FROM pg_proc WHERE oid IN (
           'public.classroom_participant_roster(uuid,uuid)'::regprocedure,
           'public.classroom_participant_profile(uuid,uuid,uuid)'::regprocedure)
         ORDER BY proname`,
        )
      ).rows;
      expect(functions).toEqual(
        ['classroom_participant_profile', 'classroom_participant_roster'].map((proname) => ({
          proname,
          proconfig: expect.arrayContaining(['jit=off', 'search_path=pg_catalog, pg_temp']),
        })),
      );
      const reader = await app.connect();
      try {
        await reader.query('BEGIN READ ONLY');
        await reader.query('SET LOCAL jit = on');
        expect(await readPortal(reader)).toEqual(portalBefore);
        expect((await reader.query('SHOW jit')).rows).toEqual([{ jit: 'on' }]);
      } finally {
        try {
          await reader.query('ROLLBACK');
        } finally {
          reader.release();
        }
      }
      const repeat = await db.connect();
      try {
        expect(await applyIsolatedTestPlan(repeat, plan)).toBe(0);
      } finally {
        repeat.release();
      }
      expect(await ledger(db)).toEqual(ledgerAfter);
      expect(await legacySnapshot(db)).toEqual(before);
    } finally {
      try {
        await runtime?.end();
      } finally {
        try {
          await admin?.end();
        } finally {
          try {
            if (databaseCreated) await owner.query('DROP DATABASE "' + name + '"');
          } finally {
            await owner.end();
          }
        }
      }
    }
  }, 60_000);
});
