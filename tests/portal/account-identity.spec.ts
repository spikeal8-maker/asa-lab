import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { testAdminPool, testAppPool } from './helpers';
import { buildTestApp, inject, type NestApp } from './app';

/**
 * C1.1 — global Account identity and Personal Workspace.
 *
 * TST-ACCOUNT-REG-001: adult registration creates one account, one personal
 * workspace and the creator capability, records an audit event and leaves the
 * email state explicit.
 * TST-AUTH-NOWS-001: sign-in works without an organization code while the old
 * workspace path keeps working.
 * TST-IDENTITY-RLS-001: identity tables stay unreachable for the runtime role.
 */

let admin: pg.Pool;
let runtime: pg.Pool;
let app: NestApp;

function unique(label: string): string {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function adult(label: string) {
  const id = unique(label);
  return {
    email: `${id}@test.local`,
    password: 'sufficiently-long-password',
    displayName: `Педагог ${label}`,
    birthDate: '1990-05-17',
    country: 'RU',
  };
}

async function register(payload: Record<string, unknown>) {
  return inject(app, { method: 'POST', url: '/api/auth/register', payload });
}

beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  app = await buildTestApp(runtime);
});

afterAll(async () => {
  await app.close();
  await admin.end();
});

describe('adult registration', () => {
  it('creates an account, a personal workspace, the creator capability and an audit event', async () => {
    const payload = adult('reg');
    const response = await register(payload);
    expect(response.statusCode).toBe(201);
    const accountId = response.json().account.id as string;

    const account = await admin.query(
      `SELECT email, email_verification_state, country FROM accounts WHERE id = $1`,
      [accountId],
    );
    expect(account.rows[0].email).toBe(payload.email.toLowerCase());
    // The pilot lets the account work immediately, but the state is explicit.
    expect(account.rows[0].email_verification_state).toBe('unverified');
    expect(account.rows[0].country).toBe('RU');

    const workspaces = await admin.query(
      `SELECT w.kind, m.role FROM workspace_memberships m
         JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.account_id = $1`,
      [accountId],
    );
    expect(workspaces.rows).toEqual([{ kind: 'personal', role: 'owner' }]);

    const grants = await admin.query(
      `SELECT capability, state FROM capability_grants WHERE account_id = $1 ORDER BY capability`,
      [accountId],
    );
    // Educator is never granted by registration: it needs its own attestation.
    expect(grants.rows).toEqual([{ capability: 'creator', state: 'verified' }]);

    const principal = await admin.query(`SELECT kind FROM principals WHERE account_id = $1`, [
      accountId,
    ]);
    expect(principal.rows).toEqual([{ kind: 'account' }]);

    const audit = await admin.query(
      `SELECT action FROM audit_events WHERE entity_id = $1 AND entity_type = 'account'`,
      [accountId],
    );
    expect(audit.rows.map((row) => row.action)).toContain('account.registered');
  });

  it('signs the new account in straight away', async () => {
    const payload = adult('signed-in');
    const response = await register(payload);
    const cookie = response.cookies.find((entry) => entry.name === 'asa_session');
    expect(cookie?.httpOnly).toBe(true);

    const me = await inject(app, {
      method: 'GET',
      url: '/api/auth/me',
      cookies: { asa_session: cookie?.value ?? '' },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(payload.email.toLowerCase());
  });

  it('refuses anyone under 18 for self-registration', async () => {
    const tooYoung = new Date();
    tooYoung.setUTCFullYear(tooYoung.getUTCFullYear() - 15);
    const response = await register({
      ...adult('minor'),
      birthDate: tooYoung.toISOString().slice(0, 10),
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('age_restricted');
  });

  it('rejects malformed input and duplicate emails', async () => {
    const payload = adult('dup');
    expect((await register(payload)).statusCode).toBe(201);
    expect((await register(payload)).statusCode).toBe(409);

    for (const broken of [
      { ...adult('bad'), email: 'not-an-email' },
      { ...adult('bad'), password: 'short' },
      { ...adult('bad'), birthDate: '17.05.1990' },
      { ...adult('bad'), country: 'Россия' },
      { ...adult('bad'), displayName: '' },
    ]) {
      const response = await register(broken);
      expect(response.statusCode, JSON.stringify(broken)).toBe(400);
    }
    // Additional properties are rejected like everywhere else.
    const extra = await register({ ...adult('extra'), capability: 'platform_admin' });
    expect(extra.statusCode).toBe(400);
  });

  it('never lets the client grant itself a capability', async () => {
    const payload = adult('forge');
    const response = await register(payload);
    expect(response.statusCode).toBe(201);
    const grants = await admin.query(
      `SELECT capability FROM capability_grants WHERE account_id = $1`,
      [response.json().account.id],
    );
    expect(grants.rows.map((row) => row.capability)).not.toContain('platform_admin');
    expect(grants.rows.map((row) => row.capability)).not.toContain('educator');
  });
});

describe('sign-in without an organization code', () => {
  it('accepts email and password only', async () => {
    const payload = adult('login');
    await register(payload);

    const login = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: payload.email, password: payload.password },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().user.displayName).toBe(payload.displayName);

    const cookie = login.cookies.find((entry) => entry.name === 'asa_session');
    const me = await inject(app, {
      method: 'GET',
      url: '/api/auth/me',
      cookies: { asa_session: cookie?.value ?? '' },
    });
    expect(me.statusCode).toBe(200);
  });

  it('rejects a wrong password with the same shape as before', async () => {
    const payload = adult('login-deny');
    await register(payload);
    const login = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: payload.email, password: 'wrong-password-value' },
    });
    expect(login.statusCode).toBe(401);
    expect(login.json().error.code).toBe('invalid_credentials');
  });

  it('keeps the workspace sign-in path working for existing teachers', async () => {
    const seeded = await admin.query(
      `SELECT t.workspace_slug, u.email FROM users u JOIN tenants t ON t.id = u.tenant_id LIMIT 1`,
    );
    if (seeded.rows.length === 0) {
      return;
    }
    const response = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        workspace: seeded.rows[0].workspace_slug,
        email: seeded.rows[0].email,
        password: 'definitely-not-the-password',
      },
    });
    // The compatible path still answers with the credential contract, not 400.
    expect(response.statusCode).toBe(401);
  });
});

describe('identity storage hardening', () => {
  it('keeps the identity tables unreachable for the runtime role', async () => {
    for (const table of [
      'accounts',
      'profiles',
      'workspaces',
      'workspace_memberships',
      'capability_grants',
      'principals',
    ]) {
      await expect(runtime.query(`SELECT count(*) FROM ${table}`)).rejects.toMatchObject({
        code: '42501',
      });
    }
  });
});
