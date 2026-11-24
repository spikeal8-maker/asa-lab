import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { acquireLlamaCppSlot } from '../../apps/api/src/ai-llamacpp-slot';
import { AiChatService } from '../../apps/api/src/ai-chat.service';
import { aiIdentity, type AiIdentity } from './ai-student-access.contract';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan } from '../migration/isolated-postgres-plan';

let admin: pg.Pool;
let first: pg.Pool;
let second: pg.Pool;
let cluster: pg.Client | undefined;
let created = false;
const databaseName = 'asa_ai_llamacpp_' + randomUUID().replaceAll('-', '') + '_test';
let platform: AiIdentity;
let owner: AiIdentity;
let stranger: AiIdentity;

beforeAll(async () => {
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true')
    throw new Error('The isolated llama.cpp PostgreSQL fixture runs only in GitHub CI');
  const urls = ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL'].map((key) => {
    const raw = process.env[key];
    if (!raw || !decodeURIComponent(new URL(raw).pathname).endsWith('_test'))
      throw new Error(key + ' must point to an isolated _test PostgreSQL database');
    return new URL(raw);
  });
  if (urls[0]!.host !== urls[1]!.host || urls[0]!.pathname !== urls[1]!.pathname)
    throw new Error('Admin and runtime must use the same isolated database');
  if (!/^asa_ai_llamacpp_[a-f0-9]{32}_test$/.test(databaseName))
    throw new Error('Unsafe fixture database name');
  cluster = new pg.Client({ connectionString: urls[0]!.href });
  await cluster.connect();
  await cluster.query('CREATE DATABASE "' + databaseName + '"');
  created = true;
  const isolated = urls.map((url) => {
    const target = new URL(url);
    target.pathname = '/' + databaseName;
    return target.href;
  });
  // Private fixture state cannot inherit or rewrite another suite's policy.
  admin = new pg.Pool({ connectionString: isolated[0], max: 3 });
  first = new pg.Pool({ connectionString: isolated[1], max: 4 });
  second = new pg.Pool({ connectionString: isolated[1], max: 4 });
  const migrationClient = await admin.connect();
  try {
    await applyIsolatedTestPlan(migrationClient, planMigrations('migrations'));
  } finally {
    migrationClient.release();
  }
  platform = await aiIdentity(admin);
  owner = await aiIdentity(admin);
  stranger = await aiIdentity(admin);
  await admin.query(
    "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','test','admin')",
    [platform.account_id],
  );
  await admin.query(
    "UPDATE public.ai_llamacpp_settings SET enabled=true,base_url='http://127.0.0.1:8080',model='fixture:pg',revision=revision+1,api_key_ciphertext=NULL,api_key_iv=NULL,api_key_auth_tag=NULL,key_fingerprint=NULL,confirmed_context_tokens=212992 WHERE singleton_key",
  );
  await admin.query(
    "UPDATE public.ai_generation_policy SET customized=true,allowed_models='[\"llamacpp-local\"]',default_model='llamacpp-local',model_preferences='[]',revision=revision+1 WHERE singleton_key",
  );
  await admin.query(
    "UPDATE public.ai_token_budget_policy SET limits='[]',revision=revision+1 WHERE singleton_key",
  );
}, 90000);

afterAll(async () => {
  try {
    await first?.end();
  } finally {
    try {
      await second?.end();
    } finally {
      try {
        await admin?.end();
      } finally {
        try {
          if (created) await cluster!.query('DROP DATABASE "' + databaseName + '"');
        } finally {
          await cluster?.end();
        }
      }
    }
  }
});

async function operation() {
  const thread = (
    await first.query<{ id: string }>('SELECT ai_chat_create($1) AS id', [owner.principal_id])
  ).rows[0]!.id;
  const request = randomUUID();
  const config = (
    await admin.query<{ revision: string }>('SELECT revision FROM ai_llamacpp_settings')
  ).rows[0]!;
  const policy = (
    await admin.query<{ revision: string }>('SELECT revision FROM ai_generation_policy')
  ).rows[0]!;
  const payload = JSON.stringify({
    text: 'PG local answer',
    model: 'llamacpp-local',
    source: null,
    uploads: [],
    webSearchMode: null,
    weatherCity: null,
  });
  const args = [
    owner.principal_id,
    thread,
    request,
    payload,
    'llamacpp-local',
    policy.revision,
    config.revision,
  ];
  return {
    thread,
    request,
    payload,
    args,
    identity: { owner: owner.principal_id, threadId: thread, requestId: request },
  };
}
const admission =
  'SELECT ai_generation_begin($1,$2,$3,$4::jsonb,$5::varchar,$6::bigint,$7::bigint) AS admitted';

it('uses the restricted runtime role and denies secret tables and direct ungated local admission', async () => {
  expect(
    (
      await first.query(
        'SELECT current_database() AS database, current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user',
      )
    ).rows,
  ).toEqual([{ database: databaseName, role: 'asalab_app', rolsuper: false, rolbypassrls: false }]);
  expect(
    (await admin.query<{ database: string }>('SELECT current_database() AS database')).rows[0]
      ?.database,
  ).toBe(databaseName);
  expect(
    (await second.query<{ database: string }>('SELECT current_database() AS database')).rows[0]
      ?.database,
  ).toBe(databaseName);
  await expect(first.query('SELECT * FROM ai_llamacpp_settings')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(first.query('SELECT * FROM ai_llamacpp_slot')).rejects.toMatchObject({
    code: '42501',
  });
  await expect(
    first.query('SELECT ai_llamacpp_admin_get($1)', [owner.principal_id]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    first.query('SELECT ai_text_begin_llamacpp($1,$2,$3,$4,$5)', [
      owner.principal_id,
      randomUUID(),
      randomUUID(),
      'bypass',
      1,
    ]),
  ).rejects.toMatchObject({ code: '42501' });
});

it('serializes the installation slot across two actual connections and protects the exact owner binding', async () => {
  const a = await first.connect();
  const b = await second.connect();
  const request = randomUUID();
  try {
    const pids = await Promise.all(
      [a, b].map((client) => client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')),
    );
    expect(pids[0]!.rows[0]!.pid).not.toBe(pids[1]!.rows[0]!.pid);
    const rows = await Promise.all([
      a.query<{ acquired: boolean }>('SELECT ai_llamacpp_slot_acquire($1,NULL,$2) AS acquired', [
        platform.principal_id,
        request,
      ]),
      b.query<{ acquired: boolean }>('SELECT ai_llamacpp_slot_acquire($1,NULL,$2) AS acquired', [
        platform.principal_id,
        request,
      ]),
    ]);
    expect(rows.filter((row) => row.rows[0]?.acquired)).toHaveLength(1);
    const winner = rows[0]?.rows[0]?.acquired ? a : b;
    const loser = winner === a ? b : a;
    expect(
      (
        await loser.query<{ released: boolean }>(
          'SELECT ai_llamacpp_slot_release($1,NULL,$2) AS released',
          [platform.principal_id, request],
        )
      ).rows[0]?.released,
    ).toBe(false);
    expect(
      (
        await winner.query<{ released: boolean }>(
          'SELECT ai_llamacpp_slot_release($1,NULL,$2) AS released',
          [stranger.principal_id, request],
        )
      ).rows[0]?.released,
    ).toBe(false);
    expect(
      (
        await winner.query<{ released: boolean }>(
          'SELECT ai_llamacpp_slot_release($1,NULL,$2) AS released',
          [platform.principal_id, request],
        )
      ).rows[0]?.released,
    ).toBe(true);
    expect(
      (
        await loser.query<{ acquired: boolean }>(
          'SELECT ai_llamacpp_slot_acquire($1,NULL,$2) AS acquired',
          [platform.principal_id, request],
        )
      ).rows[0]?.acquired,
    ).toBe(true);
    await loser.query('SELECT ai_llamacpp_slot_release($1,NULL,$2)', [
      platform.principal_id,
      request,
    ]);
  } finally {
    a.release(true);
    b.release(true);
  }
});

it('fails closed for stale runtime revisions and a released lock even when stale binding metadata exists', async () => {
  const op = await operation();
  const slot = await acquireLlamaCppSlot(first, op.identity);
  try {
    await admin.query('UPDATE ai_llamacpp_settings SET revision=revision+1 WHERE singleton_key');
    await expect(slot.client.query(admission, op.args)).rejects.toMatchObject({ code: '40001' });
    const revision = (
      await admin.query<{ revision: string }>('SELECT revision FROM ai_llamacpp_settings')
    ).rows[0]!.revision;
    op.args[6] = revision;
    await slot.client.query('SELECT pg_advisory_unlock(7333,1)');
    await expect(slot.client.query(admission, op.args)).rejects.toThrow(
      'AI_LLAMACPP_SLOT_REQUIRED',
    );
    expect(
      (
        await admin.query(
          'SELECT 1 FROM ai_generation_receipts WHERE owner_principal_id=$1 AND request_id=$2',
          [owner.principal_id, op.request],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await admin.query(
          'SELECT 1 FROM ai_token_budget_reservations WHERE owner_principal_id=$1 AND request_id=$2',
          [owner.principal_id, op.request],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await slot.release();
  }
});

it('rejects busy chat before canonical admission without quota or upstream side effects', async () => {
  const op = await operation();
  const slot = await acquireLlamaCppSlot(first, {
    owner: platform.principal_id,
    threadId: null,
    requestId: randomUUID(),
  });
  let sends = 0;
  const service = new AiChatService(second, {
    fetchImpl: async () => {
      sends++;
      throw new Error('Unexpected upstream');
    },
  });
  try {
    await expect(
      service.sendStream(
        owner.principal_id,
        op.thread,
        'busy request',
        op.request,
        () => undefined,
        new AbortController().signal,
        'llamacpp-local',
      ),
    ).rejects.toMatchObject({ code: 'ai_llamacpp_busy', status: 409 });
    expect(sends).toBe(0);
    expect(
      (
        await admin.query(
          'SELECT 1 FROM ai_assistant_request_quota WHERE owner_principal_id=$1 AND request_id=$2',
          [owner.principal_id, op.request],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await admin.query(
          'SELECT 1 FROM ai_token_budget_reservations WHERE owner_principal_id=$1 AND request_id=$2',
          [owner.principal_id, op.request],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await slot.release();
  }
});

it('keeps canonical policy, receipt and budget admission on the locked connection and replays without a slot', async () => {
  const op = await operation();
  await expect(second.query(admission, op.args)).rejects.toThrow('AI_LLAMACPP_SLOT_REQUIRED');
  const slot = await acquireLlamaCppSlot(first, op.identity);
  try {
    expect(
      (await slot.client.query<{ admitted: boolean }>(admission, op.args)).rows[0]?.admitted,
    ).toBe(true);
    const receipt = (
      await admin.query(
        'SELECT model,provider FROM ai_generation_receipts WHERE owner_principal_id=$1 AND request_id=$2',
        [owner.principal_id, op.request],
      )
    ).rows[0];
    expect(receipt).toEqual({ model: 'llamacpp-local', provider: 'llamacpp-local' });
    expect(
      (
        await admin.query(
          'SELECT 1 FROM ai_token_budget_reservations WHERE owner_principal_id=$1 AND request_id=$2',
          [owner.principal_id, op.request],
        )
      ).rowCount,
    ).toBe(1);
    expect((await second.query<{ admitted: boolean }>(admission, op.args)).rows[0]?.admitted).toBe(
      false,
    );
    await expect(
      second.query(admission, [stranger.principal_id, ...op.args.slice(1)]),
    ).rejects.toBeInstanceOf(Error);
    await first.query('SELECT ai_chat_abort($1,$2,$3)', [
      owner.principal_id,
      op.thread,
      op.request,
    ]);
  } finally {
    await slot.release();
  }
});

it('recovers a crashed database session by automatic PostgreSQL unlock and aborts only that transport', async () => {
  const op = await operation();
  const slot = await acquireLlamaCppSlot(first, op.identity);
  const pid = (await slot.client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!
    .pid;
  const snapshot = async () =>
    (
      await admin.query<{ value: unknown }>(
        `SELECT jsonb_build_object(
      'receipt',(SELECT to_jsonb(r) FROM ai_generation_receipts r WHERE owner_principal_id=$1 AND request_id=$2),
      'usage',(SELECT to_jsonb(u) FROM ai_usage_journal u WHERE owner_principal_id=$1 AND request_id=$2),
      'reservation',(SELECT to_jsonb(b) FROM ai_token_budget_reservations b WHERE owner_principal_id=$1 AND request_id=$2)
    ) AS value`,
        [owner.principal_id, op.request],
      )
    ).rows[0]!.value;
  let before: unknown;
  try {
    expect(
      (await slot.client.query<{ admitted: boolean }>(admission, op.args)).rows[0]?.admitted,
    ).toBe(true);
    await slot.client.query(
      "SELECT ai_usage_begin($1,$2,$3,'chat','sse','llamacpp-local','fixture:pg')",
      [owner.principal_id, op.thread, op.request],
    );
    before = await snapshot();
    expect(before).toMatchObject({
      receipt: { provider: 'llamacpp-local' },
      usage: { status: 'running' },
      reservation: { model: 'llamacpp-local' },
    });
    await admin.query('SELECT pg_terminate_backend($1)', [pid]);
    await expect.poll(() => slot.signal.aborted, { timeout: 5000 }).toBe(true);
  } finally {
    await slot.release();
  }
  const recovered = await acquireLlamaCppSlot(second, {
    owner: platform.principal_id,
    threadId: null,
    requestId: randomUUID(),
  });
  try {
    expect(recovered.signal.aborted).toBe(false);
    expect(await snapshot()).toEqual(before);
  } finally {
    await recovered.release();
  }
});

it('claims apply before any probe exactly once across clients and preserves completed receipts against late failure', async () => {
  const request = randomUUID();
  const digest = '4a'.repeat(32);
  const config = (
    await first.query<{ value: Record<string, unknown> }>(
      'SELECT ai_llamacpp_admin_get($1) AS value',
      [platform.principal_id],
    )
  ).rows[0]!.value;
  const args = [platform.principal_id, request, digest, config['revision']];
  const claims = await Promise.all(
    [first, second].map((pool) =>
      pool.query<{ value: { state: string } }>(
        'SELECT ai_llamacpp_apply_claim($1,$2,$3,$4) AS value',
        args,
      ),
    ),
  );
  expect(claims.map((claim) => claim.rows[0]!.value.state).sort()).toEqual(['claimed', 'pending']);
  const body = {
    ...config,
    enabled: false,
    action: 'keep',
    applyDigest: digest,
    verified: false,
    test: { injected: 'ignored' },
  };
  const complete = (
    await first.query<{ value: unknown }>(
      'SELECT ai_llamacpp_admin_set($1,$2::jsonb,$3) AS value',
      [platform.principal_id, JSON.stringify(body), request],
    )
  ).rows[0]!.value;
  await second.query('SELECT ai_llamacpp_apply_fail($1,$2,$3,$4::jsonb)', [
    platform.principal_id,
    request,
    digest,
    JSON.stringify({ code: 'ai_llamacpp_timeout', status: 503, message: 'Проверка прервана.' }),
  ]);
  expect(
    (
      await second.query<{ value: unknown }>(
        'SELECT ai_llamacpp_apply_claim($1,$2,$3,$4) AS value',
        args,
      )
    ).rows[0]!.value,
  ).toMatchObject({ state: 'complete', result: complete });
  expect(JSON.stringify(complete)).not.toContain('injected');
});

it('does not let an unknown late apply commit after its durable failure', async () => {
  const request = randomUUID();
  const digest = '5b'.repeat(32);
  const config = (
    await first.query<{ value: Record<string, unknown> }>(
      'SELECT ai_llamacpp_admin_get($1) AS value',
      [platform.principal_id],
    )
  ).rows[0]!.value;
  await first.query('SELECT ai_llamacpp_apply_claim($1,$2,$3,$4)', [
    platform.principal_id,
    request,
    digest,
    config['revision'],
  ]);
  await second.query('SELECT ai_llamacpp_apply_fail($1,$2,$3,$4::jsonb)', [
    platform.principal_id,
    request,
    digest,
    JSON.stringify({ code: 'ai_llamacpp_timeout', status: 503, message: 'Проверка прервана.' }),
  ]);
  await expect(
    first.query('SELECT ai_llamacpp_admin_set($1,$2::jsonb,$3)', [
      platform.principal_id,
      JSON.stringify({ ...config, action: 'keep', applyDigest: digest, verified: false }),
      request,
    ]),
  ).rejects.toMatchObject({ code: '55000' });
});
