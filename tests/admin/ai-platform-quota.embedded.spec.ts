import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AiChatService, type AiAdminUpdate } from '../../apps/api/src/ai-chat.service';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';

let db: PGlite;
let owner: string;
let stranger: string;
let platformAdmin: string;

async function identity(elevated = false): Promise<string> {
  const account = await db.query<{ id: string }>(
    `INSERT INTO accounts (email, password_hash, birth_date, country)
     VALUES ($1, 'quota-test-only', DATE '1990-01-01', 'RU') RETURNING id`,
    [`quota-${randomUUID()}@example.test`],
  );
  const id = account.rows[0]!.id;
  const principal = await db.query<{ id: string }>(
    "INSERT INTO principals (kind, account_id) VALUES ('account', $1) RETURNING id",
    [id],
  );
  if (elevated)
    await db.query(
      `INSERT INTO capability_grants (account_id, capability, state, policy_version, granted_by)
     VALUES ($1, 'platform_admin', 'verified', 'admin-stage-a-2026-08', 'admin')`,
      [id],
    );
  return principal.rows[0]!.id;
}

async function runtime<T>(sql: string, params: unknown[] = []) {
  await db.exec('SET ROLE asalab_app');
  try {
    return await db.query<T>(sql, params);
  } finally {
    await db.exec('RESET ROLE');
  }
}

async function setLimit(limit: number | null, principal = platformAdmin) {
  return runtime<{ ai_admin_set_config: string }>(
    `SELECT ai_admin_set_config($1, true, 'openai', 'gpt-5-mini', 'replace',
       'quota-test-ciphertext', 'quota-test-iv', 'quota-test-auth-tag', 'quota-hash',
       'quota-test', $2::integer)`,
    [principal, limit],
  );
}

async function createThread(principal = owner): Promise<string> {
  return (await runtime<{ id: string }>('SELECT ai_chat_create($1) AS id', [principal])).rows[0]!
    .id;
}

async function begin(principal: string, thread: string, request = randomUUID(), version?: number) {
  const current = await runtime<{ configuration_version: string }>(
    'SELECT * FROM ai_runtime_config()',
  );
  return runtime<{ admitted: boolean }>(
    "SELECT ai_chat_begin_paid($1,$2,$3,'Hello',$4::bigint) AS admitted",
    [principal, thread, request, version ?? Number(current.rows[0]!.configuration_version)],
  );
}

async function providerTest(principal = platformAdmin, version?: number) {
  const current = (
    await runtime<{ configuration_version: string }>('SELECT * FROM ai_admin_get_config($1)', [
      platformAdmin,
    ])
  ).rows[0]!;
  return runtime('SELECT ai_admin_test_begin($1,$2::bigint)', [
    principal,
    version ?? Number(current.configuration_version),
  ]);
}

async function count(): Promise<number> {
  return (
    await db.query<{ n: number }>('SELECT count(*)::integer AS n FROM ai_paid_operation_quota')
  ).rows[0]!.n;
}

beforeAll(async () => {
  db = new PGlite();
  await applyPlan(
    {
      query: async (sql: string, params?: unknown[]) => {
        if (params?.length) return db.query(sql, params);
        const results = await db.exec(sql);
        return { rows: results.at(-1)?.rows ?? [] };
      },
    },
    planMigrations('migrations'),
  );
  owner = await identity();
  stranger = await identity();
  platformAdmin = await identity(true);
}, 30000);

afterAll(async () => {
  await db?.close();
});

describe('0215 real PostgreSQL functions, guards and non-refundable platform quota (embedded)', () => {
  it('defaults to zero; legacy settings saves and enabled configuration cannot open the quota', async () => {
    const config = await runtime<{ paid_operations_per_hour: number }>(
      'SELECT * FROM ai_admin_get_config($1)',
      [platformAdmin],
    );
    expect(config.rows[0]!.paid_operations_per_hour).toBe(0);
    await setLimit(null);
    await expect(begin(owner, await createThread())).rejects.toThrow('AI_PLATFORM_QUOTA_EXHAUSTED');
    await expect(providerTest()).rejects.toThrow('AI_PLATFORM_QUOTA_EXHAUSTED');
    expect(await count()).toBe(0);
  });

  it('rejects unprivileged configuration, tests, helper bypass and direct ledger writes', async () => {
    await expect(begin(randomUUID(), randomUUID())).rejects.toMatchObject({ code: '42501' });
    await expect(setLimit(100, owner)).rejects.toMatchObject({ code: '42501' });
    await expect(providerTest(owner)).rejects.toMatchObject({ code: '42501' });
    await expect(setLimit(-1)).rejects.toMatchObject({ code: '22023' });
    await expect(runtime("SELECT ai_paid_operation_reserve('chat')")).rejects.toMatchObject({
      code: '42501',
    });
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
      const result = await db.query<{ allowed: boolean }>(
        "SELECT has_table_privilege('asalab_app', 'ai_paid_operation_quota', $1) AS allowed",
        [privilege],
      );
      expect(result.rows[0]!.allowed).toBe(false);
    }
    const policy = await db.query<{ relrowsecurity: boolean }>(
      "SELECT relrowsecurity FROM pg_class WHERE oid = 'ai_paid_operation_quota'::regclass",
    );
    expect(policy.rows[0]!.relrowsecurity).toBe(true);
    const security = await db.query<{ prosecdef: boolean; proconfig: string[] }>(
      `SELECT prosecdef, proconfig FROM pg_proc WHERE proname IN
       ('ai_chat_begin','ai_chat_begin_paid','ai_admin_get_config','ai_admin_set_config','ai_admin_test_begin','ai_paid_operation_reserve')`,
    );
    expect(security.rows).toHaveLength(6);
    expect(
      security.rows.every(
        (row) => row.prosecdef && row.proconfig.includes('search_path=pg_catalog, pg_temp'),
      ),
    ).toBe(true);
  });

  it('shares quota between accounts and provider tests; abort, deletion and replay never refund', async () => {
    await setLimit(2);
    const thread = await createThread();
    const request = randomUUID();
    expect((await begin(owner, thread, request)).rows[0]!.admitted).toBe(true);
    await runtime('SELECT ai_chat_abort($1,$2,$3)', [owner, thread, request]);
    await providerTest();
    expect(await count()).toBe(2);
    expect((await begin(owner, thread, request)).rows[0]!.admitted).toBe(false);
    await expect(begin(stranger, await createThread(stranger))).rejects.toThrow(
      'AI_PLATFORM_QUOTA_EXHAUSTED',
    );
    await expect(providerTest()).rejects.toThrow('AI_PLATFORM_QUOTA_EXHAUSTED');
    await runtime('SELECT ai_chat_delete($1,$2)', [owner, thread]);
    await expect(begin(owner, await createThread(), request)).rejects.toThrow(
      'AI_REQUEST_ID_REUSED',
    );
    expect(await count()).toBe(2);
    await setLimit(0);
    await setLimit(2);
    await expect(providerTest()).rejects.toThrow('AI_PLATFORM_QUOTA_EXHAUSTED');
  });

  it('rolls back a reservation when thread admission fails, rejects ownership, and checks test version', async () => {
    await setLimit(3);
    const thread = await createThread();
    await expect(begin(stranger, thread)).rejects.toThrow('AI_THREAD_BUSY_OR_MISSING');
    await expect(providerTest(platformAdmin, 0)).rejects.toThrow('AI_CONFIG_CHANGED');
    expect(await count()).toBe(2);
    await begin(owner, thread);
    expect(await count()).toBe(3);
    await setLimit(4);
    await expect(begin(owner, thread)).rejects.toThrow('AI_THREAD_BUSY_OR_MISSING');
    expect(await count()).toBe(3);
  });

  it('expires only old admissions using database time after acquiring the lock', async () => {
    await db.exec(
      "UPDATE ai_paid_operation_quota SET created_at = clock_timestamp() - interval '61 minutes'",
    );
    await setLimit(1);
    await providerTest();
    await expect(begin(stranger, await createThread(stranger))).rejects.toThrow(
      'AI_PLATFORM_QUOTA_EXHAUSTED',
    );
    expect(await count()).toBe(4);
  });
});

describe('chat runtime configuration changes before durable admission', () => {
  const changes: Array<[string, Partial<AiAdminUpdate>]> = [
    ['disable', { enabled: false }],
    ['clear key', { enabled: false, apiKey: undefined, clearApiKey: true }],
    ['replace key', { apiKey: 'replacement-provider-test-key' }],
    [
      'switch provider',
      { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'new-deepseek-test-key' },
    ],
    ['switch model', { model: 'gpt-4.1-mini' }],
  ];
  for (const mode of ['send', 'stream'] as const) {
    it.each(changes)(
      `${mode}: rejects %s committed after runtime read without reserving or fetching`,
      async (_name, change) => {
        let changeAfterRead = false;
        const fetchImpl = vi.fn<typeof fetch>();
        const settings: AiAdminUpdate = {
          enabled: true,
          provider: 'openai',
          model: 'gpt-5-mini',
          paidOperationsPerHour: 100,
          apiKey: 'initial-provider-test-key',
        };
        const pool = {
          query: async (sql: string, params: unknown[] = []) => {
            const result = await runtime(sql, params);
            if (changeAfterRead && sql.includes('ai_runtime_config')) {
              changeAfterRead = false;
              await service.saveAdminConfig(
                platformAdmin,
                { ...settings, ...change },
                randomUUID(),
              );
            }
            return result;
          },
        };
        const service = new AiChatService(pool as unknown as pg.Pool, {
          encryptionKey: '7a'.repeat(32),
          fetchImpl,
        });
        await service.saveAdminConfig(platformAdmin, settings, randomUUID());
        const thread = await createThread();
        const baseline = await count();
        changeAfterRead = true;
        const result =
          mode === 'send'
            ? service.send(owner, thread, 'Hello', randomUUID())
            : service.sendStream(
                owner,
                thread,
                'Hello',
                randomUUID(),
                () => undefined,
                new AbortController().signal,
              );
        await expect(result).rejects.toMatchObject({ code: 'ai_config_changed', status: 409 });
        expect(changeAfterRead).toBe(false);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(await count()).toBe(baseline);
        expect(await service.messages(owner, thread)).toEqual([]);
      },
    );
  }

  it('checks disabled/keyless config but resolves an admitted replay before stale/disabled guards', async () => {
    await setLimit(100);
    const thread = await createThread();
    const request = randomUUID();
    const version = Number(
      (await runtime<{ configuration_version: string }>('SELECT * FROM ai_runtime_config()'))
        .rows[0]!.configuration_version,
    );
    await begin(owner, thread, request, version);
    const baseline = await count();
    await runtime('SELECT ai_chat_abort($1,$2,$3)', [owner, thread, request]);
    await db.exec(
      'UPDATE ai_assistant_config SET enabled = false, configuration_version = configuration_version + 1',
    );
    expect((await begin(owner, thread, request, version)).rows[0]!.admitted).toBe(false);
    await expect(begin(owner, await createThread())).rejects.toThrow('AI_DISABLED');
    await db.exec(
      'UPDATE ai_assistant_config SET api_key_ciphertext = NULL, api_key_iv = NULL, api_key_auth_tag = NULL, key_fingerprint = NULL',
    );
    await expect(begin(owner, await createThread())).rejects.toThrow('AI_DISABLED');
    expect(await count()).toBe(baseline);
  });
});

it('0215 upgrades an enabled 0214 installation to zero and backfills prior chat admissions', async () => {
  const upgrade = new PGlite();
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      if (params?.length) return upgrade.query(sql, params);
      const results = await upgrade.exec(sql);
      return { rows: results.at(-1)?.rows ?? [] };
    },
  };
  try {
    const migrations = planMigrations('migrations');
    await applyPlan(
      client,
      migrations.filter((m) => m.version < '0215'),
    );
    await expect(
      upgrade.query('SELECT ai_chat_begin_paid($1,$2,$3,$4::varchar,$5::bigint)', [
        randomUUID(),
        randomUUID(),
        randomUUID(),
        'Hello',
        1,
      ]),
    ).rejects.toMatchObject({ code: '42883' });
    const account = await upgrade.query<{ id: string }>(
      `INSERT INTO accounts (email,password_hash,birth_date,country)
       VALUES ('quota-upgrade@example.test','test',DATE '1990-01-01','RU') RETURNING id`,
    );
    await upgrade.query(
      'INSERT INTO ai_assistant_request_quota(account_id,request_id) VALUES ($1,$2)',
      [account.rows[0]!.id, randomUUID()],
    );
    await upgrade.exec(`UPDATE ai_assistant_config SET enabled = true,
      api_key_ciphertext = 'fake-ciphertext', api_key_iv = 'fake-iv',
      api_key_auth_tag = 'fake-tag', key_fingerprint = 'fake-hash'`);
    await applyPlan(client, migrations);
    const config = await upgrade.query<{ enabled: boolean; paid_operations_per_hour: number }>(
      'SELECT enabled, paid_operations_per_hour FROM ai_assistant_config',
    );
    expect(config.rows).toEqual([{ enabled: true, paid_operations_per_hour: 0 }]);
    expect(
      (
        await upgrade.query<{ n: number }>(
          'SELECT count(*)::integer AS n FROM ai_paid_operation_quota',
        )
      ).rows[0]!.n,
    ).toBe(1);
  } finally {
    await upgrade.close();
  }
}, 30000);
