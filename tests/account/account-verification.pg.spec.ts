import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import type { LightMyRequestResponse } from 'fastify';
import { hashPassword } from '../../contexts/identity/dist/index.js';
import { TOKENS } from '../../apps/api/dist/tokens.js';
import type { AccountVerificationService } from '../../apps/api/dist/account-verification.service.js';
import type { AuthProviderAvailability } from '../../apps/api/dist/auth-provider-availability.js';
import type { MaxAuthService } from '../../apps/api/dist/max-auth.service.js';
import type { TelegramAuthService } from '../../apps/api/dist/telegram-auth.service.js';
import { buildTestApp, inject, type NestApp } from '../portal/app';
import { seedTeacher, testAdminPool } from '../portal/helpers';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan as applyPlan } from '../migration/isolated-postgres-plan';

// The switch is platform-wide. This suite owns a disposable database so it
// cannot change the policy underneath other parallel Account/StudentSeat tests.
const databaseName = `asa_verification_isolated_${randomUUID().replaceAll('-', '')}_test`;
let databaseOwner: pg.Pool;
let databaseCreated = false;
let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;
let verification: AccountVerificationService;
let platformAdmin: Awaited<ReturnType<typeof account>>;
let platformPrincipal: string;

const ready = (id: 'max' | 'telegram'): AuthProviderAvailability => ({
  id,
  available: true,
  reason: 'ready',
  enforcementEligible: true,
  enforcementReason: 'ready',
  checkedAt: new Date().toISOString(),
  launchUrl: id === 'max' ? 'https://max.ru/synthetic_test_bot' : 'https://t.me/synthetic_test_bot',
});
const down = (id: 'max' | 'telegram'): AuthProviderAvailability => ({
  id,
  available: false,
  reason: 'invalid_token',
  enforcementEligible: false,
  enforcementReason: 'invalid_token',
  checkedAt: new Date().toISOString(),
});
let maxAvailability = ready('max');
let telegramAvailability = down('telegram');

function accessCookie(response: LightMyRequestResponse): string {
  const token = response.cookies.find((cookie) => cookie.name === 'asa_session')?.value;
  expect(token, response.body).toBeTruthy();
  return `asa_session=${token}`;
}

async function account() {
  const unique = randomUUID().replaceAll('-', '');
  const email = `${unique}@verification.test`;
  const password = `Safe-${unique}-Password`;
  const response = await inject(app, {
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email,
      password,
      username: `v${unique.slice(0, 24)}`,
      displayName: 'Synthetic verification',
      birthDate: '1990-04-12',
      country: 'RU',
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  const session = response.json();
  const refresh = response.cookies.find((cookie) => cookie.name === 'asa_refresh')?.value;
  expect(refresh).toBeTruthy();
  return {
    id: session.user.id as string,
    email,
    password,
    cookie: accessCookie(response),
    refresh: refresh!,
    session,
  };
}

async function ageAccount(id: string): Promise<void> {
  await admin.query(
    "UPDATE accounts SET first_authenticated_at=now()-interval '48 hours' WHERE id=$1",
    [id],
  );
}

async function enableOverduePolicy(): Promise<void> {
  await admin.query(
    "UPDATE account_verification_policy SET activated_at=now()-interval '48 hours' WHERE singleton_key",
  );
  await verification.updatePolicy(platformPrincipal, true, randomUUID());
}

function profile(cookie: string) {
  return inject(app, { method: 'GET', url: '/api/account/profile', headers: { cookie } });
}

function login(user: { email: string; password: string }, password = user.password) {
  return inject(app, {
    method: 'POST',
    url: '/api/auth/login',
    payload: { identifier: user.email, password },
  });
}

beforeAll(async () => {
  if (!/^asa_verification_isolated_[a-f0-9]{32}_test$/.test(databaseName))
    throw new Error('Unsafe generated test database name');
  const adminUrl = new URL(process.env['TEST_DATABASE_URL']!);
  const runtimeUrl = new URL(process.env['APP_TEST_DATABASE_URL']!);
  if (!adminUrl.pathname.endsWith('_test') || runtimeUrl.pathname !== adminUrl.pathname)
    throw new Error('Matching isolated admin/runtime test databases required');
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
  app = await buildTestApp(runtime);
  verification = app.get<AccountVerificationService>(TOKENS.accountVerification);
  // Only outside bot health is simulated. Password validation, SQL sessions,
  // refresh rotation, policy, RBAC, HTTP guard and origin protection are real.
  vi.spyOn(app.get<MaxAuthService>(TOKENS.maxAuthService), 'availability').mockImplementation(
    async () => maxAvailability,
  );
  vi.spyOn(
    app.get<TelegramAuthService>(TOKENS.telegramAuthService),
    'availability',
  ).mockImplementation(async () => telegramAvailability);
  platformAdmin = await account();
  await admin.query(
    "INSERT INTO capability_grants (account_id,capability,state,policy_version,granted_by) VALUES ($1,'platform_admin','verified','verification-test','admin')",
    [platformAdmin.id],
  );
  const principal = await admin.query<{ id: string }>(
    'SELECT id FROM principals WHERE account_id=$1',
    [platformAdmin.id],
  );
  platformPrincipal = principal.rows[0]!.id;
}, 120_000);

beforeEach(async () => {
  maxAvailability = ready('max');
  telegramAvailability = down('telegram');
  await verification.updatePolicy(platformPrincipal, false, randomUUID());
});

afterAll(async () => {
  vi.restoreAllMocks();
  try {
    if (app) await app.close();
    else await runtime?.end();
    await admin?.end();
    if (databaseCreated) await databaseOwner.query(`DROP DATABASE "${databaseName}"`);
  } finally {
    await databaseOwner?.end();
  }
});

describe('Account verification HTTP and PostgreSQL authority', () => {
  it('persists an initially disabled platform switch, audits changes and never resets its activation date', async () => {
    const user = await account();
    const initial = await inject(app, {
      method: 'GET',
      url: '/api/admin/v1/auth/verification-policy',
      headers: { cookie: platformAdmin.cookie },
    });
    expect(initial.statusCode, initial.body).toBe(200);
    expect(initial.json()).toEqual({ enabled: false, activatedAt: null, graceHours: 24 });
    const denied = await inject(app, {
      method: 'POST',
      url: '/api/admin/v1/auth/verification-policy',
      headers: { cookie: user.cookie },
      payload: { enabled: true },
    });
    expect(denied.statusCode, denied.body).toBe(403);
    const activate = await inject(app, {
      method: 'POST',
      url: '/api/admin/v1/auth/verification-policy',
      headers: { cookie: platformAdmin.cookie },
      payload: { enabled: true },
    });
    expect(activate.statusCode, activate.body).toBe(200);
    const activatedAt = activate.json().activatedAt;
    expect(activatedAt).toEqual(expect.any(String));
    await verification.updatePolicy(platformPrincipal, false, randomUUID());
    expect(
      (await verification.updatePolicy(platformPrincipal, true, randomUUID())).activatedAt,
    ).toBe(activatedAt);
    await expect(runtime.query('SELECT * FROM account_verification_policy')).rejects.toMatchObject({
      code: '42501',
    });
    const audit = await admin.query(
      "SELECT count(*)::integer AS count FROM administrative_audit_events WHERE action='administration.verification_policy.update' AND actor_principal_id=$1",
      [platformPrincipal],
    );
    expect(audit.rows[0].count).toBeGreaterThanOrEqual(3);
  });

  it('returns a restricted same-Account session after a correct password and rejects direct product reads and writes', async () => {
    const user = await account();
    await ageAccount(user.id);
    await enableOverduePolicy();
    const entered = await login(user);
    expect(entered.statusCode, entered.body).toBe(200);
    expect(entered.json()).toMatchObject({
      authenticated: true,
      user: { id: user.id },
      capabilities: [],
      actions: [],
      verification: { required: true, reason: 'verification_required' },
    });
    const cookie = accessCookie(entered);
    const me = await inject(app, { method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode, me.body).toBe(200);
    expect(me.json()).toMatchObject({ account: { id: user.id }, verification: { required: true } });
    const read = await profile(cookie);
    expect(read.statusCode, read.body).toBe(403);
    expect(read.json().error.code).toBe('account_verification_required');
    const write = await inject(app, {
      method: 'POST',
      url: '/api/projects',
      headers: { cookie, 'idempotency-key': randomUUID() },
      payload: { title: 'Must not exist', moduleKey: 'three-d', scope: 'personal' },
    });
    expect(write.statusCode, write.body).toBe(403);
    expect(write.json().error.code).toBe('account_verification_required');
    const projects = await admin.query(
      'SELECT count(*)::integer AS count FROM projects WHERE owner_principal_id=(SELECT id FROM principals WHERE account_id=$1)',
      [user.id],
    );
    expect(projects.rows[0].count).toBe(0);
  });

  it('applies the gate to an already active browser cookie without requiring a new login', async () => {
    const user = await account();
    expect((await profile(user.cookie)).statusCode).toBe(200);
    await ageAccount(user.id);
    await enableOverduePolicy();
    expect((await profile(user.cookie)).statusCode).toBe(403);
    const status = await inject(app, {
      method: 'GET',
      url: '/api/auth/verification',
      headers: { cookie: user.cookie, 'x-verification-disabled': 'true' },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().required).toBe(true);
  });

  it('rotates a real refresh session while preserving the restriction on its new access cookie', async () => {
    const user = await account();
    await ageAccount(user.id);
    await enableOverduePolicy();
    const refresh = await inject(app, {
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: `asa_refresh=${user.refresh}` },
    });
    expect(refresh.statusCode, refresh.body).toBe(200);
    expect(refresh.json()).toEqual({ refreshed: true });
    expect(refresh.cookies.find((cookie) => cookie.name === 'asa_refresh')?.value).not.toBe(
      user.refresh,
    );
    const cookie = accessCookie(refresh);
    const me = await inject(app, { method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json()).toMatchObject({ account: { id: user.id }, verification: { required: true } });
    expect((await profile(cookie)).statusCode).toBe(403);
  });

  it('accepts a correct password during total provider outage, but rejects wrong passwords and invalid provider proofs', async () => {
    const user = await account();
    await ageAccount(user.id);
    await enableOverduePolicy();
    maxAvailability = down('max');
    telegramAvailability = { ...down('telegram'), reason: 'delivery_unavailable' };
    const entered = await login(user);
    expect(entered.statusCode, entered.body).toBe(200);
    expect(entered.json()).toMatchObject({
      user: { id: user.id },
      verification: { required: false, reason: 'providers_unavailable' },
    });
    expect(entered.json().capabilities.length).toBeGreaterThan(0);
    expect((await profile(accessCookie(entered))).statusCode).toBe(200);
    const wrong = await login(user, 'Definitely-another-password');
    expect(wrong.statusCode, wrong.body).toBe(401);
    expect(wrong.cookies.some((cookie) => cookie.name === 'asa_session')).toBe(false);
    const proof = await inject(app, {
      method: 'POST',
      url: '/api/auth/max/session',
      payload: { initData: 'forged-init-data' },
    });
    expect([401, 503]).toContain(proof.statusCode);
    expect(proof.cookies.some((cookie) => cookie.name === 'asa_session')).toBe(false);
    const refresh = await inject(app, {
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: `asa_refresh=${user.refresh}` },
    });
    expect(refresh.statusCode, refresh.body).toBe(200);
    expect((await profile(accessCookie(refresh))).statusCode).toBe(200);
  });

  it('requires a healthy Telegram alternative, accepts only this Account proof and rechecks revocation', async () => {
    const user = await account();
    const other = await account();
    await ageAccount(user.id);
    await enableOverduePolicy();
    maxAvailability = down('max');
    telegramAvailability = ready('telegram');
    const subject = String(BigInt('0x' + randomUUID().replaceAll('-', '')));
    await admin.query(
      "INSERT INTO account_external_identities (provider,subject,account_id,verified_at) VALUES ('telegram',$1,$2,now())",
      [subject, other.id],
    );
    expect((await profile(user.cookie)).statusCode).toBe(403);
    await admin.query(
      "UPDATE account_external_identities SET account_id=$2 WHERE subject=$1 AND provider='telegram'",
      [subject, user.id],
    );
    const me = await inject(app, {
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: user.cookie },
    });
    expect(me.json()).toMatchObject({
      account: { id: user.id },
      verification: { required: false, reason: 'verified', verifiedProvider: 'telegram' },
    });
    expect((await profile(user.cookie)).statusCode).toBe(200);
    const emailState = await admin.query(
      'SELECT email_verification_state FROM accounts WHERE id=$1',
      [user.id],
    );
    expect(emailState.rows[0].email_verification_state).toBe('unverified');
    await admin.query(
      "UPDATE account_external_identities SET revoked_at=now() WHERE subject=$1 AND provider='telegram'",
      [subject],
    );
    expect((await profile(user.cookie)).statusCode).toBe(403);
  });

  it('enforces the same policy after the compatibility organization password login', async () => {
    const teacher = await seedTeacher(admin, 'confirmation');
    const canonical = await admin.query(
      'SELECT account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
      [teacher.tenantId, teacher.teacherId],
    );
    const id = canonical.rows[0].account_id as string;
    const password = `Canonical-${randomUUID()}-Password`;
    await admin.query('UPDATE accounts SET password_hash=$2 WHERE id=$1', [
      id,
      hashPassword(password),
    ]);
    await ageAccount(id);
    await enableOverduePolicy();
    const entered = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { workspace: teacher.workspace, email: teacher.email, password },
    });
    expect(entered.statusCode, entered.body).toBe(200);
    expect(entered.json()).toMatchObject({ user: { id }, verification: { required: true } });
    expect((await profile(accessCookie(entered))).statusCode).toBe(403);
  });

  it('keeps suspended Account sessions and refresh credentials unauthorized during provider outage', async () => {
    const user = await account();
    await ageAccount(user.id);
    await enableOverduePolicy();
    maxAvailability = down('max');
    telegramAvailability = down('telegram');
    await admin.query("UPDATE accounts SET status='suspended' WHERE id=$1", [user.id]);
    expect((await login(user)).statusCode).toBe(401);
    expect((await profile(user.cookie)).statusCode).toBe(401);
    const refresh = await inject(app, {
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: `asa_refresh=${user.refresh}` },
    });
    expect(refresh.statusCode, refresh.body).toBe(401);
  });

  it('gives a new unverified Account its first 24 hours even with an older enabled policy', async () => {
    await enableOverduePolicy();
    const user = await account();
    expect(user.session.verification).toMatchObject({
      required: false,
      reason: 'grace_period',
      verifiedProvider: null,
    });
    expect(Date.parse(user.session.verification.dueAt)).toBeGreaterThan(
      Date.now() + 23 * 60 * 60 * 1000,
    );
    expect((await profile(user.cookie)).statusCode).toBe(200);
  });

  it('preserves public reads and independent StudentSeat introspection with a restricted Account cookie', async () => {
    const user = await account();
    await ageAccount(user.id);
    await enableOverduePolicy();
    for (const url of ['/api/modules', '/api/version', '/health/live']) {
      const response = await inject(app, { method: 'GET', url, headers: { cookie: user.cookie } });
      expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
    }
    const seat = await inject(app, {
      method: 'GET',
      url: '/api/class-join/me',
      headers: { cookie: user.cookie },
    });
    expect(seat.statusCode).toBe(200);
    expect(seat.json()).toEqual({ authenticated: false });
    expect(
      (await inject(app, { method: 'GET', url: '/api/gallery', headers: { cookie: user.cookie } }))
        .statusCode,
    ).toBe(403);
  });

  it('allows only the platform administrator to recover the switch while restricted and still rejects CSRF', async () => {
    const user = await account();
    await ageAccount(user.id);
    await ageAccount(platformAdmin.id);
    await enableOverduePolicy();
    for (const url of [
      '/api/admin/v1/me',
      '/api/admin/v1/scopes',
      '/api/admin/v1/auth/verification-policy',
      '/api/admin/v1/integrations/max',
      '/api/admin/v1/integrations/telegram',
    ]) {
      const response = await inject(app, {
        method: 'GET',
        url,
        headers: { cookie: platformAdmin.cookie },
      });
      expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
    }
    const ordinary = await inject(app, {
      method: 'GET',
      url: '/api/admin/v1/auth/verification-policy',
      headers: { cookie: user.cookie },
    });
    expect(ordinary.statusCode).toBe(403);
    const csrf = await inject(app, {
      method: 'POST',
      url: '/api/admin/v1/auth/verification-policy',
      headers: { cookie: platformAdmin.cookie, origin: 'https://untrusted.invalid' },
      payload: { enabled: false },
    });
    expect(csrf.statusCode, csrf.body).toBe(403);
    expect((await verification.adminPolicy(platformPrincipal)).enabled).toBe(true);
    const disable = await inject(app, {
      method: 'POST',
      url: '/api/admin/v1/auth/verification-policy',
      headers: { cookie: platformAdmin.cookie },
      payload: { enabled: false },
    });
    expect(disable.statusCode, disable.body).toBe(200);
    expect((await profile(user.cookie)).statusCode).toBe(200);
  });
});
