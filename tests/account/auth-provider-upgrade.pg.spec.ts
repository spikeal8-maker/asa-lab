import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { hashPassword, hashSessionToken } from '../../contexts/identity/dist/index.js';
import { MaxAuthService } from '../../apps/api/dist/max-auth.service.js';
import {
  BotProviderIngress,
  IngressProbeRegistry,
} from '../../apps/api/dist/bot-provider-ingress.js';
import { testAdminPool } from '../portal/helpers';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan as applyPlan } from '../migration/isolated-postgres-plan';

type HistoricalKind = 'self' | 'admin-other' | 'admin-own' | 'admin-reused-audit';
type Flow = 'raw' | 'native';
interface Account {
  account_id: string;
  principal_id: string;
  workspace_id: string;
  sessionHash: string;
}
interface HistoricalIdentity extends Account {
  subject: string;
  snapshot: Record<string, unknown>;
}
const kinds: HistoricalKind[] = ['self', 'admin-other', 'admin-own', 'admin-reused-audit'];
const cases = kinds.flatMap((kind) => (['raw', 'native'] as const).map((flow) => ({ kind, flow })));
const identities = new Map<string, HistoricalIdentity>();
const databaseName = `asa_provider_upgrade_${randomUUID().replaceAll('-', '')}_test`;
const reason = 'self-service unlink';
const hash = () => hashSessionToken(randomBytes(32).toString('base64url'));
let databaseOwner: pg.Pool;
let databaseCreated = false;
let admin: pg.Pool;
let runtime: pg.Pool;
let passwordHash: string;
let platformAdmin: Account;
let configurationVersion: string;
const LEGACY_KEY = Buffer.alloc(32, 29);
const LEGACY_TOKEN = 'synthetic-legacy-max-only-token';
const LEGACY_USERNAME = 'synthetic_legacy_max_bot';
let legacyAccount: Account;
let legacySubject: string;
let legacySessionSnapshot: Record<string, unknown>;
let legacyIdentitySnapshot: Record<string, unknown>;

async function account(): Promise<Account> {
  const unique = randomUUID().replaceAll('-', '');
  const sessionHash = hash();
  const result = await runtime.query<Account>(
    "SELECT * FROM auth_register_account($1,$2,'Historical provider',$3,DATE '1990-04-12','RU','provider-upgrade-test',$4,24)",
    [`${unique}@provider-upgrade.test`, passwordHash, `p${unique.slice(0, 28)}`, sessionHash],
  );
  return { ...result.rows[0]!, sessionHash };
}

async function grantAdministrator(user: Account) {
  await admin.query(
    "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES ($1,'platform_admin','verified','provider-upgrade-test','admin')",
    [user.account_id],
  );
}

async function identitySnapshot(user: Account) {
  const result = await admin.query(
    `SELECT id,account_id,provider,subject,linked_at::text,verified_at::text,
      revoked_at::text,revoked_by_principal_id,revoke_reason
     FROM account_external_identities WHERE account_id=$1 AND provider='max'`,
    [user.account_id],
  );
  return result.rows[0] as Record<string, unknown>;
}

async function historicalIdentity(kind: HistoricalKind): Promise<HistoricalIdentity> {
  const user = await account();
  const subject = BigInt('0x' + randomBytes(12).toString('hex')).toString();
  const linked = await runtime.query<{ result: string }>(
    'SELECT * FROM auth_max_link($1,$2,$3,extract(epoch FROM now())::bigint,NULL,NULL)',
    [user.account_id, subject, `historical-proof:${randomUUID()}`],
  );
  expect(linked.rows[0]?.result).toBe('linked');
  if (kind === 'self') {
    const unlinked = await runtime.query<{ unlinked: boolean }>(
      'SELECT auth_max_unlink_self($1,$2) AS unlinked',
      [user.account_id, user.principal_id],
    );
    expect(unlinked.rows[0]?.unlinked).toBe(true);
  } else {
    const actor = kind === 'admin-other' ? platformAdmin : user;
    if (actor === user) await grantAdministrator(actor);
    const requestId = randomUUID();
    if (kind === 'admin-reused-audit') {
      // The real 0065 audit writer returns this unrelated receipt when 0085
      // reuses its idempotency key. There will be no target-specific revoke audit.
      await runtime.query(
        "SELECT admin_append_audit_event($1,'platform',NULL,'administration.max_configuration.update','integration','max','admin_console','Historical unrelated operation',NULL,$2,$2,'succeeded',NULL,NULL)",
        [actor.principal_id, requestId],
      );
    }
    const revoked = await runtime.query<{ revoked: boolean }>(
      'SELECT admin_revoke_max_identity($1,$2,$3,$4) AS revoked',
      [actor.principal_id, user.account_id, reason, requestId],
    );
    expect(revoked.rows[0]?.revoked).toBe(true);
  }
  const snapshot = await identitySnapshot(user);
  expect(snapshot.revoke_reason).toBe(reason);
  expect(snapshot.revoked_at).not.toBeNull();
  const provenance = await admin.query<{
    same_account: boolean;
    identity_event: boolean;
    administrative_history: boolean;
    target_revoke_audit: boolean;
  }>(
    `SELECT
    EXISTS(SELECT 1 FROM principals p WHERE p.id=i.revoked_by_principal_id
      AND p.account_id=i.account_id) AS same_account,
    EXISTS(SELECT 1 FROM account_external_identity_events e WHERE e.identity_id=i.id
      AND e.event='revoked' AND e.reason=i.revoke_reason
      AND e.actor_principal_id=i.revoked_by_principal_id AND e.occurred_at=i.revoked_at) AS identity_event,
    EXISTS(SELECT 1 FROM administrative_audit_events a
      WHERE a.actor_principal_id=i.revoked_by_principal_id) AS administrative_history,
    EXISTS(SELECT 1 FROM administrative_audit_events a
      WHERE a.actor_principal_id=i.revoked_by_principal_id
        AND a.action='administration.max_identity.revoke'
        AND a.target_id=i.account_id::text AND a.result='succeeded') AS target_revoke_audit
    FROM account_external_identities i WHERE i.id=$1`,
    [snapshot.id],
  );
  expect(provenance.rows[0]).toEqual({
    same_account: kind !== 'admin-other',
    identity_event: true,
    administrative_history: kind !== 'self',
    target_revoke_audit: kind === 'admin-other' || kind === 'admin-own',
  });
  return { ...user, subject, snapshot };
}

beforeAll(async () => {
  if (!/^asa_provider_upgrade_[a-f0-9]{32}_test$/.test(databaseName))
    throw new Error('Unsafe generated test database name');
  const adminUrl = new URL(process.env['TEST_DATABASE_URL']!);
  const runtimeUrl = new URL(process.env['APP_TEST_DATABASE_URL']!);
  if (!adminUrl.pathname.endsWith('_test') || runtimeUrl.pathname !== adminUrl.pathname)
    throw new Error('Matching disposable admin/runtime test databases required');
  databaseOwner = testAdminPool();
  await databaseOwner.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  adminUrl.pathname = runtimeUrl.pathname = '/' + databaseName;
  admin = new pg.Pool({ connectionString: adminUrl.toString(), max: 2 });
  runtime = new pg.Pool({ connectionString: runtimeUrl.toString(), max: 2 });
  const plan = planMigrations();
  const historicalPlan = plan.filter((migration) => Number(migration.version) <= 217);
  expect(Number(historicalPlan.at(-1)?.version)).toBe(217);
  const historicalClient = await admin.connect();
  try {
    await applyPlan(historicalClient, historicalPlan);
  } finally {
    historicalClient.release();
  }
  const absent =
    await admin.query(`SELECT count(*)::integer AS count FROM information_schema.columns
    WHERE table_schema='public' AND table_name='account_external_identities' AND column_name='revocation_kind'`);
  expect(absent.rows[0].count).toBe(0);
  passwordHash = hashPassword('Known-historical-provider-fallback-Password-1');
  platformAdmin = await account();
  await grantAdministrator(platformAdmin);
  // Build a real pre-0218 MAX-only Account, whose generated password is not
  // known to a user. The old runtime's valid encrypted token is retained.
  legacyAccount = await account();
  legacySubject = String(Number.parseInt(randomBytes(6).toString('hex'), 16));
  await admin.query('UPDATE accounts SET password_configured=false,password_hash=$2 WHERE id=$1', [
    legacyAccount.account_id,
    hashPassword(randomBytes(48).toString('base64url')),
  ]);
  const oldLink = await runtime.query(
    'SELECT * FROM auth_max_link($1,$2,$3,extract(epoch FROM now())::bigint,NULL,NULL)',
    [legacyAccount.account_id, legacySubject, `historical-active:${randomUUID()}`],
  );
  expect(oldLink.rows[0].result).toBe('linked');
  const iv = Buffer.alloc(12, 17);
  const cipher = createCipheriv('aes-256-gcm', LEGACY_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(LEGACY_TOKEN), cipher.final()]).toString(
    'base64url',
  );
  await runtime.query(
    "SELECT admin_set_max_runtime_config($1,true,$2,'https://legacy-provider.test/max-login','replace',$3,$4,$5,$6,'1001','Synthetic legacy bot','Historical MAX configuration',$7)",
    [
      platformAdmin.principal_id,
      LEGACY_USERNAME,
      ciphertext,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      createHash('sha256').update(LEGACY_TOKEN).digest('hex').slice(0, 12),
      randomUUID(),
    ],
  );
  legacySessionSnapshot = (
    await admin.query(
      'SELECT id,principal_id,token_hash,expires_at::text,revoked_at::text FROM sessions_v2 WHERE token_hash=$1',
      [legacyAccount.sessionHash],
    )
  ).rows[0];
  legacyIdentitySnapshot = await identitySnapshot(legacyAccount);
  for (const { kind, flow } of cases) {
    identities.set(`${kind}:${flow}`, await historicalIdentity(kind));
  }
  const upgradePlan = plan.filter((migration) => Number(migration.version) <= 220);
  expect(
    upgradePlan
      .filter((migration) => Number(migration.version) > 217)
      .map((migration) => Number(migration.version)),
  ).toEqual([218, 219, 220]);
  const upgradeClient = await admin.connect();
  try {
    await applyPlan(upgradeClient, upgradePlan);
  } finally {
    upgradeClient.release();
  }
  await expect(runtime.query('SELECT * FROM auth_verification_policy()')).resolves.toMatchObject({
    rows: [{ enabled: false, activated_at: null }],
  });
  const configuration = await runtime.query(
    "SELECT configuration_version,enabled,webhook_verified_at,native_confirmation_verified_at FROM auth_provider_runtime_config('max')",
  );
  expect(configuration.rows[0]).toMatchObject({
    enabled: true,
    webhook_verified_at: null,
    native_confirmation_verified_at: null,
  });
  configurationVersion = configuration.rows[0].configuration_version;
}, 120_000);

afterAll(async () => {
  try {
    await runtime?.end();
    await admin?.end();
    if (databaseCreated) await databaseOwner.query(`DROP DATABASE "${databaseName}"`);
  } finally {
    await databaseOwner?.end();
  }
});

async function relink(identity: HistoricalIdentity, flow: Flow) {
  if (flow === 'raw') {
    const linked = await runtime.query<{ result: string }>(
      "SELECT auth_provider_link('max',$1,$2,$3,extract(epoch FROM now())::bigint,NULL,NULL,$4) AS result",
      [identity.account_id, identity.subject, `new-proof:${randomUUID()}`, configurationVersion],
    );
    return { approval: null, result: linked.rows[0]!.result };
  }
  const token = hash();
  const nonce = hash();
  const started = await runtime.query<{ created: boolean }>(
    "SELECT auth_provider_pairing_start('max',$1,$2,10,$3,'link') AS created",
    [token, nonce, identity.account_id],
  );
  expect(started.rows[0]?.created).toBe(true);
  const approved = await runtime.query<{ result: string }>(
    "SELECT auth_provider_pairing_approve('max',$1,$2,$3,extract(epoch FROM now())::bigint,NULL,NULL,$4) AS result",
    [token, identity.subject, `new-proof:${randomUUID()}`, configurationVersion],
  );
  const consumed = await runtime.query<{ result: string }>(
    "SELECT * FROM auth_provider_pairing_consume('max',$1,$2,$3,24,NULL,$4)",
    [token, nonce, hash(), identity.account_id],
  );
  return { approval: approved.rows[0]!.result, result: consumed.rows[0]!.result };
}

describe('historical MAX revocation provenance across 0217 → 0220', () => {
  it('preserves a legacy MAX-only Account and signed Mini App access before any native webhook test', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://platform-api2.max.ru/me');
      return new Response(
        JSON.stringify({ user_id: 1001, username: LEGACY_USERNAME, is_bot: true }),
        { status: 200 },
      );
    });
    const networkRequest = vi.fn();
    const ingress = new BotProviderIngress({
      registry: new IngressProbeRegistry(),
      resolve: async () => {
        throw new Error('Synthetic missing ingress DNS');
      },
      request: networkRequest,
    });
    const service = new MaxAuthService(runtime, {
      encryptionKey: LEGACY_KEY.toString('base64url'),
      fetchImpl,
      ingress,
      publicWebOrigins: ['https://legacy-provider.test'],
    });
    await expect(service.config()).resolves.toMatchObject({ enabled: true });
    await expect(service.availability()).resolves.toMatchObject({
      available: false,
      enforcementEligible: false,
    });
    const proof = () => {
      const fields = new Map<string, string>([
        ['auth_date', String(Math.floor(Date.now() / 1000))],
        ['query_id', `legacy-miniapp:${randomUUID()}`],
        ['user', JSON.stringify({ id: Number(legacySubject), first_name: 'Legacy MAX user' })],
      ]);
      const text = [...fields.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
      const secret = createHmac('sha256', 'WebAppData').update(LEGACY_TOKEN).digest();
      fields.set('hash', createHmac('sha256', secret).update(text).digest('hex'));
      return new URLSearchParams(fields).toString();
    };
    await expect(service.signIn(proof())).resolves.toMatchObject({
      status: 'authenticated',
      accountId: legacyAccount.account_id,
    });
    await expect(service.link(legacyAccount.account_id, proof())).resolves.toMatchObject({
      status: 'already_linked',
    });
    const accountState = await admin.query(
      'SELECT password_configured,status FROM accounts WHERE id=$1',
      [legacyAccount.account_id],
    );
    expect(accountState.rows[0]).toEqual({ password_configured: false, status: 'active' });
    const session = (
      await admin.query(
        'SELECT id,principal_id,token_hash,expires_at::text,revoked_at::text FROM sessions_v2 WHERE token_hash=$1',
        [legacyAccount.sessionHash],
      )
    ).rows[0];
    expect(session).toEqual(legacySessionSnapshot);
    expect((await identitySnapshot(legacyAccount)).id).toBe(legacyIdentitySnapshot.id);
    const runtimeState = await runtime.query(
      "SELECT native_confirmation_configuration_version,native_confirmation_verified_at FROM auth_provider_runtime_config('max')",
    );
    expect(runtimeState.rows[0]).toEqual({
      native_confirmation_configuration_version: null,
      native_confirmation_verified_at: null,
    });
    await expect(service.status(legacyAccount.account_id)).resolves.toMatchObject({
      linked: true,
      canUnlink: false,
    });
    expect(networkRequest).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(cases)(
    'preserves $kind authority when relinking through $flow after upgrade',
    async ({ kind, flow }) => {
      const identity = identities.get(`${kind}:${flow}`)!;
      const migrated = await admin.query(
        'SELECT revocation_kind FROM account_external_identities WHERE id=$1',
        [identity.snapshot.id],
      );
      expect(migrated.rows[0].revocation_kind).toBe(kind === 'self' ? 'self' : 'admin');
      expect(await identitySnapshot(identity)).toEqual(identity.snapshot);
      const sessionCount = async () =>
        (
          await admin.query(
            'SELECT count(*)::integer AS count FROM sessions_v2 WHERE principal_id=$1',
            [identity.principal_id],
          )
        ).rows[0].count;
      const before = await sessionCount();
      const result = await relink(identity, flow);
      expect(result).toEqual(
        kind === 'self'
          ? { approval: flow === 'native' ? 'approved' : null, result: 'linked' }
          : {
              approval: flow === 'native' ? 'identity_revoked' : null,
              result: flow === 'native' ? 'invalid' : 'identity_revoked',
            },
      );
      expect(await sessionCount()).toBe(before);
      const after = await identitySnapshot(identity);
      expect(after.id).toBe(identity.snapshot.id);
      expect(after.account_id).toBe(identity.account_id);
      if (kind === 'self') expect(after.revoked_at).toBeNull();
      else expect(after).toEqual(identity.snapshot);
      const verification = await runtime.query(
        'SELECT verified_provider FROM auth_account_verification_state($1)',
        [identity.account_id],
      );
      expect(verification.rows[0].verified_provider).toBe(kind === 'self' ? 'max' : null);
    },
  );
});
