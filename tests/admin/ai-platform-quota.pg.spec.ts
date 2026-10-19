import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lockAiPostgresSuite } from './ai-postgres-suite-lock';

// Runs alongside the chat suite under a shared suite lock. Admission itself uses
// independent backends (unlike embedded PostgreSQL) and never calls a provider.
let admin: pg.Pool;
let first: pg.Pool;
let second: pg.Pool;
let platformAdmin: string;
let owners: string[];
let originalConfig: Record<string, unknown> | undefined;
let originalProviders: Record<string, unknown>[] | undefined;
let unlockSuite: (() => Promise<void>) | undefined;

async function identity(elevated = false): Promise<string> {
  const account = await admin.query<{ id: string }>(
    `INSERT INTO accounts (email, password_hash, birth_date, country)
     VALUES ($1, 'quota-concurrency-test', DATE '1990-01-01', 'RU') RETURNING id`,
    [`quota-${randomUUID()}@example.test`],
  );
  const accountId = account.rows[0]!.id;
  const principal = await admin.query<{ id: string }>(
    "INSERT INTO principals (kind, account_id) VALUES ('account', $1) RETURNING id",
    [accountId],
  );
  if (elevated)
    await admin.query(
      `INSERT INTO capability_grants (account_id, capability, state, policy_version, granted_by)
     VALUES ($1, 'platform_admin', 'verified', 'admin-stage-a-2026-08', 'admin')`,
      [accountId],
    );
  return principal.rows[0]!.id;
}

async function used(): Promise<number> {
  return (
    await admin.query<{ n: number }>(
      "SELECT count(*)::integer AS n FROM ai_paid_operation_quota WHERE created_at > clock_timestamp() - interval '1 hour'",
    )
  ).rows[0]!.n;
}

async function setLimit(limit: number): Promise<number> {
  const result = await first.query<{ version: string }>(
    `SELECT ai_admin_set_config($1, c.enabled, c.provider, c.model, 'keep',
       NULL, NULL, NULL, NULL, 'quota-concurrency', $2::integer) AS version
     FROM ai_admin_get_config($1) c`,
    [platformAdmin, limit],
  );
  return Number(result.rows[0]!.version);
}

async function thread(principal: string): Promise<string> {
  return (await first.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [principal]))
    .rows[0]!.id;
}

beforeAll(async () => {
  const urls = ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL'].map((key) => {
    const value = process.env[key];
    if (!value) throw new Error(`${key} must explicitly name an isolated _test database`);
    const url = new URL(value);
    if (!decodeURIComponent(url.pathname).endsWith('_test')) {
      throw new Error(`${key} must name an isolated _test database`);
    }
    return url;
  });
  if (urls[0]!.host !== urls[1]!.host || urls[0]!.pathname !== urls[1]!.pathname) {
    throw new Error('Admin and runtime URLs must target the same isolated _test database');
  }
  admin = new pg.Pool({ connectionString: urls[0]!.href, max: 2 });
  first = new pg.Pool({ connectionString: urls[1]!.href, max: 6 });
  second = new pg.Pool({ connectionString: urls[1]!.href, max: 6 });
  unlockSuite = await lockAiPostgresSuite(admin);
  originalConfig = (await admin.query('SELECT * FROM ai_assistant_config')).rows[0];
  originalProviders = (await admin.query('SELECT * FROM ai_provider_settings')).rows;
  platformAdmin = await identity(true);
  // SQL-only fake key; never used to call an upstream provider.
  await first.query(
    `SELECT ai_admin_set_config($1, true, 'openai', 'gpt-6-luna', 'replace',
      'quota-test-ciphertext', 'quota-test-iv', 'quota-test-auth-tag', 'quota-hash',
      'quota-fixture-setup')`,
    [platformAdmin],
  );
  owners = [await identity(), await identity()];
}, 60000);

afterAll(async () => {
  try {
    if (originalConfig) {
      await admin.query(
        `UPDATE ai_assistant_config c SET
          enabled = saved.enabled, provider = saved.provider, model = saved.model,
          api_key_ciphertext = saved.api_key_ciphertext, api_key_iv = saved.api_key_iv,
          api_key_auth_tag = saved.api_key_auth_tag, key_fingerprint = saved.key_fingerprint,
          paid_operations_per_hour = saved.paid_operations_per_hour,
          configuration_version = saved.configuration_version,
          migrated_from_model = saved.migrated_from_model,
          updated_by_principal = saved.updated_by_principal, updated_at = saved.updated_at
         FROM json_populate_record(NULL::ai_assistant_config, $1::json) saved
         WHERE c.singleton_key`,
        [JSON.stringify(originalConfig)],
      );
    }
    if (originalProviders) {
      await admin.query(
        `UPDATE ai_provider_settings p SET
          model = saved.model, api_key_ciphertext = saved.api_key_ciphertext,
          api_key_iv = saved.api_key_iv, api_key_auth_tag = saved.api_key_auth_tag,
          key_fingerprint = saved.key_fingerprint, updated_at = saved.updated_at
         FROM json_populate_recordset(NULL::ai_provider_settings, $1::json) saved
         WHERE p.provider = saved.provider`,
        [JSON.stringify(originalProviders)],
      );
    }
  } finally {
    await Promise.all([first?.end(), second?.end()]);
    await unlockSuite?.();
    await admin?.end();
  }
});

describe('platform quota under independent PostgreSQL connections', () => {
  it('holds the shared fixture lock while admission uses separate backends', async () => {
    const a = await first.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    const b = await second.query<{ pid: number; acquired: boolean }>(
      'SELECT pg_backend_pid() AS pid, pg_try_advisory_lock(7312, 215) AS acquired',
    );
    expect(a.rows[0]!.pid).not.toBe(b.rows[0]!.pid);
    expect(b.rows[0]!.acquired).toBe(false);
  });

  it('admits exactly five of 24 competing chat/provider-test operations across pools and accounts', async () => {
    const baseline = await used();
    const version = await setLimit(baseline + 5);
    const threads = await Promise.all(Array.from({ length: 16 }, (_, i) => thread(owners[i % 2]!)));
    const results = await Promise.allSettled(
      Array.from({ length: 24 }, (_, i) => {
        const pool = i % 2 ? first : second;
        return i < 16
          ? pool.query("SELECT ai_chat_begin_paid($1,$2,$3,'Hello',$4::bigint)", [
              owners[i % 2],
              threads[i],
              randomUUID(),
              version,
            ])
          : pool.query('SELECT ai_admin_test_begin($1,$2::bigint)', [platformAdmin, version]);
      }),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(19);
    for (const result of rejected) {
      expect(result.reason.message).toContain('AI_PLATFORM_QUOTA_EXHAUSTED');
    }
    expect(await used()).toBe(baseline + 5);
  });

  it('concurrent account replays consume one slot; abort never refunds it', async () => {
    const baseline = await used();
    const version = await setLimit(baseline + 1);
    const id = await thread(owners[0]!);
    const request = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        (i % 2 ? first : second).query<{ admitted: boolean }>(
          "SELECT ai_chat_begin_paid($1,$2,$3,'Hello',$4::bigint) AS admitted",
          [owners[0], id, request, version],
        ),
      ),
    );
    expect(results.filter((r) => r.rows[0]!.admitted)).toHaveLength(1);
    expect(await used()).toBe(baseline + 1);
    await first.query('SELECT ai_chat_abort($1,$2,$3)', [owners[0], id, request]);
    expect(
      (
        await second.query<{ admitted: boolean }>(
          "SELECT ai_chat_begin_paid($1,$2,$3,'Hello',$4::bigint) AS admitted",
          [owners[0], id, request, version],
        )
      ).rows[0]!.admitted,
    ).toBe(false);
    expect(await used()).toBe(baseline + 1);
  });

  it('a stale repeatable-read snapshot fails closed instead of admitting from an old count', async () => {
    const baseline = await used();
    const version = await setLimit(baseline + 2);
    const stale = await second.connect();
    try {
      await stale.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await stale.query('SELECT * FROM ai_runtime_config()');
      await first.query('SELECT ai_admin_test_begin($1,$2::bigint)', [platformAdmin, version]);
      await expect(
        stale.query('SELECT ai_admin_test_begin($1,$2::bigint)', [platformAdmin, version]),
      ).rejects.toMatchObject({ code: '40001' });
    } finally {
      await stale.query('ROLLBACK');
      stale.release();
    }
    expect(await used()).toBe(baseline + 1);
  });
});
