import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { planMigrations, validateMigrationHistory } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan } from './isolated-postgres-plan';

const expectedPending = ['0226', '0227', '0228', '0229', '0233'];

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

describe('AI atomic upgrade from the supported current-main prefix', () => {
  it('keeps the unsupported 0233-only draft history rejected by the pure pre-SQL guard', () => {
    const plan = planMigrations();
    const unsupported = new Map(
      plan
        .filter((item) => Number(item.version) <= 225 || item.version === '0233')
        .map((item) => [item.version, { checksum: item.checksum }]),
    );
    expect(unsupported.has('0225')).toBe(true);
    expect(unsupported.has('0233')).toBe(true);
    expect(() => validateMigrationHistory(unsupported, plan)).toThrow(
      /Forbidden out-of-order pending migration\(s\): 0226, 0227, 0228, 0229; maximum applied migration version is 0233\./,
    );
  });

  it('upgrades real 0225 history with ownership, paid receipts and exact migration ledger intact', async () => {
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
        expect(await applyIsolatedTestPlan(upgrade, plan)).toBe(5);
      } finally {
        upgrade.release();
      }
      const ledgerAfter = await ledger(db);
      expect(ledgerAfter.slice(0, ledgerBefore.length)).toEqual(ledgerBefore);
      expect(ledgerAfter.slice(ledgerBefore.length).map((row) => row.version)).toEqual(
        expectedPending,
      );
      expect(
        ledgerAfter.map(({ version, name, checksum }) => ({ version, name, checksum })),
      ).toEqual(plan.map(({ version, name, checksum }) => ({ version, name, checksum })));
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
      const configAfter = (await db.query('SELECT to_jsonb(c) AS item FROM ai_assistant_config c'))
        .rows[0]!.item;
      expect(configAfter).toEqual({
        ...configBefore,
        model: 'deepseek-flash',
        enabled: false,
        migrated_from_model: 'deepseek-chat',
        configuration_version: configBefore.configuration_version + 1,
        updated_at: expect.any(String),
      });
      expect(
        (
          await db.query('SELECT to_jsonb(p) AS item FROM ai_provider_settings p ORDER BY provider')
        ).rows.map((row) => row.item),
      ).toEqual([
        {
          provider: 'deepseek',
          model: 'deepseek-flash',
          api_key_ciphertext: configBefore.api_key_ciphertext,
          api_key_iv: configBefore.api_key_iv,
          api_key_auth_tag: configBefore.api_key_auth_tag,
          key_fingerprint: configBefore.key_fingerprint,
          updated_at: configAfter.updated_at,
        },
        {
          provider: 'openai',
          model: 'gpt-6-luna',
          api_key_ciphertext: null,
          api_key_iv: null,
          api_key_auth_tag: null,
          key_fingerprint: null,
          updated_at: expect.any(String),
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
