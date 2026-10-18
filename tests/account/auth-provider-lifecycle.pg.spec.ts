import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  hashPassword,
  hashSessionToken,
  verifyPasswordAsync,
} from '../../contexts/identity/dist/index.js';
import { testAdminPool } from '../portal/helpers';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan as applyPlan } from '../migration/isolated-postgres-plan';

type Provider = 'max' | 'telegram';
interface Account {
  account_id: string;
  principal_id: string;
  workspace_id: string;
  tenant_id: string;
  sessionHash: string;
}
interface Pairing {
  provider: Provider;
  tokenHash: string;
  nonceHash: string;
}
const databaseName = `asa_provider_isolated_${randomUUID().replaceAll('-', '')}_test`;
const PASSWORD = 'Known-provider-fallback-Password-1';
let passwordHash: string;
let databaseOwner: pg.Pool;
let databaseCreated = false;
let admin: pg.Pool;
let runtime: pg.Pool;
let platformAdmin: Account;

const hash = () => hashSessionToken(randomBytes(32).toString('base64url'));
const subject = () => BigInt('0x' + randomBytes(12).toString('hex')).toString();
const assertion = () => `proof:${randomUUID()}`;

async function account(passwordConfigured = true): Promise<Account> {
  const unique = randomUUID().replaceAll('-', '');
  const sessionHash = hash();
  const result = await runtime.query<Account>(
    "SELECT * FROM auth_register_account($1,$2,'Synthetic provider',$3,DATE '1990-04-12','RU','provider-test',$4,24)",
    [`${unique}@provider.test`, passwordHash, `p${unique.slice(0, 28)}`, sessionHash],
  );
  const value = { ...result.rows[0]!, sessionHash };
  if (!passwordConfigured)
    await admin.query('UPDATE accounts SET password_configured=false WHERE id=$1', [
      value.account_id,
    ]);
  return value;
}

async function start(provider: Provider = 'max', target?: Account): Promise<Pairing> {
  const pair = { provider, tokenHash: hash(), nonceHash: hash() };
  const result = await runtime.query<{ created: boolean }>(
    'SELECT auth_provider_pairing_start($1,$2,$3,10,$4,$5) AS created',
    [
      provider,
      pair.tokenHash,
      pair.nonceHash,
      target?.account_id ?? null,
      target ? 'link' : 'login',
    ],
  );
  expect(result.rows[0]?.created).toBe(true);
  return pair;
}

async function approve(pair: Pairing, identity: string): Promise<string> {
  const result = await runtime.query<{ result: string }>(
    'SELECT auth_provider_pairing_approve($1,$2,$3,$4,extract(epoch FROM now())::bigint,$5,$6) AS result',
    [pair.provider, pair.tokenHash, identity, assertion(), 'external_user', 'External profile'],
  );
  return result.rows[0]!.result;
}

async function link(user: Account, provider: Provider, identity: string, proof = assertion()) {
  const result = await runtime.query<{ result: string }>(
    'SELECT auth_provider_link($1,$2,$3,$4,extract(epoch FROM now())::bigint,NULL,NULL) AS result',
    [provider, user.account_id, identity, proof],
  );
  return result.rows[0]!.result;
}

async function consume(
  pair: Pairing,
  options: { nonce?: string | null; current?: Account; sessionHash?: string } = {},
) {
  const sessionHash = options.sessionHash ?? hash();
  const result = await runtime.query<{
    result: string;
    account_id: string | null;
    display_name: string | null;
    username: string | null;
  }>('SELECT * FROM auth_provider_pairing_consume($1,$2,$3,$4,24,NULL,$5)', [
    pair.provider,
    pair.tokenHash,
    options.nonce === undefined ? pair.nonceHash : options.nonce,
    sessionHash,
    options.current?.account_id ?? null,
  ]);
  return { ...result.rows[0]!, sessionHash };
}

async function revoke(user: Account, provider: Provider, kind: 'self' | 'admin' = 'self') {
  const result = await runtime.query<{ result: string }>(
    'SELECT auth_provider_revoke($1,$2,$3,$4,$5,$6) AS result',
    [
      provider,
      user.account_id,
      kind === 'self' ? user.principal_id : platformAdmin.principal_id,
      kind,
      kind === 'self' ? 'self-service unlink' : 'administrative provider review',
      kind === 'admin' ? randomUUID() : null,
    ],
  );
  return result.rows[0]!.result;
}

async function registerPair(
  pair: Pairing,
  options: { passwordHash?: string | null; birthDate?: string | null; nonce?: string } = {},
) {
  const unique = randomUUID().replaceAll('-', '');
  const result = await runtime.query<{ result: string; account_id: string | null }>(
    "SELECT * FROM auth_provider_pairing_register($1,$2,$3,$4,$5,'Synthetic registration',$6,$7::date,'RU','provider-test',$8,24)",
    [
      pair.provider,
      pair.tokenHash,
      options.nonce ?? pair.nonceHash,
      `${unique}@provider.test`,
      options.passwordHash === undefined ? passwordHash : options.passwordHash,
      `p${unique.slice(0, 28)}`,
      options.birthDate === undefined ? '1990-04-12' : options.birthDate,
      hash(),
    ],
  );
  return result.rows[0]!;
}

beforeAll(async () => {
  if (!/^asa_provider_isolated_[a-f0-9]{32}_test$/.test(databaseName))
    throw new Error('Unsafe generated test database name');
  const adminUrl = new URL(process.env['TEST_DATABASE_URL']!);
  const runtimeUrl = new URL(process.env['APP_TEST_DATABASE_URL']!);
  if (!adminUrl.pathname.endsWith('_test') || runtimeUrl.pathname !== adminUrl.pathname)
    throw new Error('Matching disposable admin/runtime test databases required');
  databaseOwner = testAdminPool();
  await databaseOwner.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  adminUrl.pathname = runtimeUrl.pathname = '/' + databaseName;
  admin = new pg.Pool({ connectionString: adminUrl.toString(), max: 3 });
  const migrationClient = await admin.connect();
  try {
    await applyPlan(migrationClient, planMigrations());
  } finally {
    migrationClient.release();
  }
  runtime = new pg.Pool({ connectionString: runtimeUrl.toString(), max: 3 });
  passwordHash = hashPassword(PASSWORD);
  platformAdmin = await account();
  await admin.query(
    "INSERT INTO capability_grants (account_id,capability,state,policy_version,granted_by) VALUES ($1,'platform_admin','verified','provider-test','admin')",
    [platformAdmin.account_id],
  );
}, 120_000);

beforeEach(async () => {
  // Synthetic SQL fixtures only. No real credential is decrypted or sent.
  await admin.query(`UPDATE auth_provider_settings SET enabled=true,
    bot_username='synthetic_test_bot', mini_app_url='https://example.test/sign-in',
    token_ciphertext='synthetic-ciphertext', token_iv='synthetic-iv', token_auth_tag='synthetic-tag',
    token_fingerprint='synthetic123', token_verified_at=now(), configuration_version=configuration_version+1,
    health_available=true, health_reason='ready', health_checked_at=now()`);
});

afterAll(async () => {
  try {
    await runtime?.end();
    await admin?.end();
    if (databaseCreated) await databaseOwner.query(`DROP DATABASE "${databaseName}"`);
  } finally {
    await databaseOwner?.end();
  }
});

describe('provider lifecycle PostgreSQL authority and atomicity', () => {
  it('denies raw provider tables, private session creation and unauthorized administration', async () => {
    const ordinary = await account();
    await expect(runtime.query('SELECT * FROM auth_provider_settings')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(runtime.query('SELECT * FROM auth_provider_pairings')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      runtime.query("SELECT auth_provider_session_create('max',$1,$2,24,NULL)", [
        ordinary.account_id,
        hash(),
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      runtime.query("SELECT * FROM admin_get_auth_provider_config($1,'telegram')", [
        ordinary.principal_id,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    const safe = await runtime.query(
      "SELECT * FROM admin_get_auth_provider_config($1,'telegram')",
      [platformAdmin.principal_id],
    );
    expect(safe.rows[0].token_configured).toBe(true);
    expect(safe.rows[0]).not.toHaveProperty('token_ciphertext');
  });

  it('rejects missing/wrong nonces without consuming a valid pending or approved challenge', async () => {
    const user = await account();
    const identity = subject();
    expect(await link(user, 'max', identity)).toBe('linked');
    const pair = await start();
    expect((await consume(pair)).result).toBe('pending');
    expect((await consume(pair, { nonce: null })).result).toBe('invalid');
    expect((await consume(pair, { nonce: hash() })).result).toBe('invalid');
    expect(await approve(pair, identity)).toBe('approved');
    expect((await consume(pair, { nonce: hash() })).result).toBe('invalid');
    expect(await consume(pair)).toMatchObject({
      result: 'authenticated',
      account_id: user.account_id,
    });
    expect((await consume(pair)).result).toBe('consumed');
  });

  it('creates exactly one session across concurrent consumers of one approved challenge', async () => {
    const user = await account();
    const identity = subject();
    await link(user, 'telegram', identity);
    const pair = await start('telegram');
    await approve(pair, identity);
    const attempts = await Promise.all(Array.from({ length: 12 }, () => consume(pair)));
    expect(attempts.filter((value) => value.result === 'authenticated')).toHaveLength(1);
    expect(attempts.filter((value) => value.result === 'consumed')).toHaveLength(11);
    const sessions = await admin.query(
      "SELECT count(*)::integer AS count FROM sessions_v2 WHERE principal_id=$1 AND client_metadata->>'authenticationProvider'='telegram'",
      [user.principal_id],
    );
    expect(sessions.rows[0].count).toBe(1);
  });

  it('rejects expired challenges and every challenge from a disabled or replaced configuration', async () => {
    const user = await account();
    const identity = subject();
    await link(user, 'max', identity);
    const expired = await start();
    await approve(expired, identity);
    await admin.query(
      "UPDATE auth_provider_pairings SET created_at=now()-interval '20 minutes',expires_at=now()-interval '1 minute' WHERE token_hash=$1",
      [expired.tokenHash],
    );
    expect((await consume(expired)).result).toBe('expired');
    const disabled = await start();
    await approve(disabled, identity);
    await runtime.query(
      "SELECT admin_set_auth_provider_config($1,'max',false,'synthetic_test_bot','https://example.test/sign-in','keep',NULL,NULL,NULL,NULL,NULL,NULL,'disable test',$2)",
      [platformAdmin.principal_id, randomUUID()],
    );
    expect((await consume(disabled)).result).toBe('invalid');
    await admin.query("UPDATE auth_provider_settings SET enabled=true WHERE provider='max'");
    expect((await consume(disabled)).result).toBe('invalid');
    const changed = await start();
    await approve(changed, identity);
    await admin.query(
      "UPDATE auth_provider_settings SET configuration_version=configuration_version+1 WHERE provider='max'",
    );
    expect((await consume(changed)).result).toBe('invalid');
  });

  it('does not mutate Account links at callback approval and requires the still-authenticated same Account', async () => {
    const user = await account();
    const other = await account();
    const identity = subject();
    const pair = await start('telegram', user);
    await approve(pair, identity);
    const before = await admin.query(
      "SELECT count(*)::integer AS count FROM account_external_identities WHERE provider='telegram' AND subject=$1",
      [identity],
    );
    expect(before.rows[0].count).toBe(0);
    expect((await consume(pair)).result).toBe('invalid');
    expect((await consume(pair, { current: other })).result).toBe('invalid');
    const linked = await consume(pair, { current: user });
    expect(linked).toMatchObject({ result: 'linked', account_id: user.account_id });
    const after = await admin.query(
      "SELECT account_id FROM account_external_identities WHERE provider='telegram' AND subject=$1",
      [identity],
    );
    expect(after.rows).toEqual([{ account_id: user.account_id }]);
    const sessions = await admin.query(
      'SELECT count(*)::integer AS count FROM sessions_v2 WHERE principal_id=$1',
      [user.principal_id],
    );
    expect(sessions.rows[0].count).toBe(1);
    const workspace = await runtime.query('SELECT workspace_id FROM auth_personal_workspace($1)', [
      user.account_id,
    ]);
    expect(workspace.rows[0].workspace_id).toBe(user.workspace_id);
  });

  it('keeps unknown identities unregistered until a real adult profile and fallback password are submitted', async () => {
    const pair = await start('telegram');
    const identity = subject();
    await approve(pair, identity);
    const count = async () =>
      (await admin.query('SELECT count(*)::integer AS count FROM accounts')).rows[0].count;
    const initial = await count();
    expect(await consume(pair)).toMatchObject({
      result: 'registration_required',
      display_name: 'External profile',
    });
    expect((await registerPair(pair, { nonce: hash() })).result).toBe('unavailable');
    expect((await registerPair(pair, { passwordHash: null })).result).toBe('validation_error');
    expect((await registerPair(pair, { birthDate: null })).result).toBe('validation_error');
    expect((await registerPair(pair, { birthDate: '2020-01-01' })).result).toBe('age_routed');
    expect(await count()).toBe(initial);
    const registered = await registerPair(pair);
    expect(registered.result).toBe('authenticated');
    expect(await count()).toBe(initial + 1);
    const stored = await admin.query(
      'SELECT email,password_hash,password_configured,email_verification_state,birth_date::text,country FROM accounts WHERE id=$1',
      [registered.account_id],
    );
    expect(stored.rows[0]).toMatchObject({
      password_configured: true,
      email_verification_state: 'unverified',
      birth_date: '1990-04-12',
      country: 'RU',
    });
    const passwordLogin = await runtime.query('SELECT * FROM auth_find_account($1)', [
      stored.rows[0].email,
    ]);
    await expect(verifyPasswordAsync(PASSWORD, passwordLogin.rows[0].password_hash)).resolves.toBe(
      true,
    );
    expect((await registerPair(pair)).result).toBe('unavailable');
  });

  it('does not allow provider proof to merge Accounts or replace a different bound identity', async () => {
    const user = await account();
    const other = await account();
    const identity = subject();
    expect(await link(user, 'max', identity)).toBe('linked');
    expect(await link(other, 'max', identity)).toBe('identity_taken');
    expect(await link(user, 'max', subject())).toBe('account_already_linked');
    const proof = assertion();
    expect(await link(user, 'max', identity, proof)).toBe('already_linked');
    expect(await link(user, 'max', identity, proof)).toBe('assertion_replayed');
  });

  it('prevents removal of the last usable sign-in method and ignores an unhealthy alternate provider', async () => {
    const user = await account(false);
    await link(user, 'max', subject());
    expect(await revoke(user, 'max')).toBe('last_sign_in_method');
    await link(user, 'telegram', subject());
    await admin.query(
      "UPDATE auth_provider_settings SET health_available=false WHERE provider='telegram'",
    );
    expect(await revoke(user, 'max')).toBe('last_sign_in_method');
    await admin.query(
      "UPDATE auth_provider_settings SET health_available=true,health_checked_at=now() WHERE provider='telegram'",
    );
    expect(await revoke(user, 'max')).toBe('unlinked');
    expect(await revoke(user, 'telegram')).toBe('last_sign_in_method');
    await admin.query('UPDATE accounts SET password_configured=true WHERE id=$1', [
      user.account_id,
    ]);
    expect(await revoke(user, 'telegram')).toBe('unlinked');
  });

  it('revokes approved pairings and all provider sessions, including sessions without a refresh family', async () => {
    const user = await account();
    const identity = subject();
    await link(user, 'telegram', identity);
    const first = await start('telegram');
    await approve(first, identity);
    const firstSession = await consume(first);
    const attached = await runtime.query(
      "SELECT session_refresh_attach($1,$2,'telegram',30) AS attached",
      [firstSession.sessionHash, hash()],
    );
    expect(attached.rows[0].attached).toBe(true);
    const second = await start('telegram');
    await approve(second, identity);
    await consume(second);
    const approved = await start('telegram');
    await approve(approved, identity);
    expect(await revoke(user, 'telegram')).toBe('unlinked');
    expect((await consume(approved)).result).toBe('invalid');
    const active = await admin.query(
      "SELECT count(*)::integer AS count FROM sessions_v2 WHERE principal_id=$1 AND revoked_at IS NULL AND client_metadata->>'authenticationProvider'='telegram'",
      [user.principal_id],
    );
    expect(active.rows[0].count).toBe(0);
    const refreshed = await admin.query(
      'SELECT count(*)::integer AS count FROM session_refresh_tokens token JOIN session_refresh_families family ON family.id=token.family_id JOIN sessions_v2 session ON session.id=family.session_id WHERE session.principal_id=$1 AND (token.revoked_at IS NULL OR family.revoked_at IS NULL)',
      [user.principal_id],
    );
    expect(refreshed.rows[0].count).toBe(0);
    const passwordSession = await admin.query(
      'SELECT revoked_at FROM sessions_v2 WHERE token_hash=$1',
      [user.sessionHash],
    );
    expect(passwordSession.rows[0].revoked_at).toBeNull();
  });

  it('allows same-Account self relinking but keeps an administrative revocation blocked', async () => {
    const user = await account();
    const identity = subject();
    await link(user, 'max', identity);
    await revoke(user, 'max');
    const relink = await start('max', user);
    await approve(relink, identity);
    expect((await consume(relink, { current: user })).result).toBe('linked');
    await revoke(user, 'max', 'admin');
    expect(await link(user, 'max', identity)).toBe('identity_revoked');
    const blocked = await start('max', user);
    expect(await approve(blocked, identity)).toBe('identity_revoked');
    expect((await consume(blocked, { current: user })).result).toBe('invalid');
    const history = await admin.query(
      "SELECT revoked_at,revocation_kind FROM account_external_identities WHERE provider='max' AND subject=$1",
      [identity],
    );
    expect(history.rows[0].revoked_at).not.toBeNull();
    expect(history.rows[0].revocation_kind).toBe('admin');
  });

  it('never authenticates a suspended Account even with approved provider proof', async () => {
    const user = await account();
    const identity = subject();
    await link(user, 'max', identity);
    const pair = await start();
    await approve(pair, identity);
    await admin.query("UPDATE accounts SET status='suspended' WHERE id=$1", [user.account_id]);
    expect((await consume(pair)).result).toBe('account_suspended');
  });

  it('accepts Telegram telemetry through both existing SQL recording boundaries', async () => {
    const legacy = await runtime.query(
      "SELECT analytics_record_event('anonymous',NULL,NULL,NULL,NULL,'auth.telegram','failed','telegram',NULL,$1,NULL,NULL) AS id",
      [randomUUID()],
    );
    expect(Number(legacy.rows[0].id)).toBeGreaterThan(0);
    const ingested = await runtime.query(
      "SELECT analytics_ingest_v2($1,'anonymous',NULL,NULL,NULL,NULL,NULL,'auth.telegram',$2::jsonb,'{}'::jsonb,now()) AS result",
      [randomUUID(), JSON.stringify({ outcome: 'failed', authMethod: 'telegram' })],
    );
    expect(ingested.rows[0].result).toBeTruthy();
    await expect(
      runtime.query(
        "SELECT analytics_record_event('anonymous',NULL,NULL,NULL,NULL,'auth.telegram','failed','forged-provider',NULL,$1,NULL,NULL)",
        [randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '22023' });
  });
});
