import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool } from './helpers';
import { buildTestApp, inject, type NestApp } from './app';

/**
 * C1.1 — global Account identity and Personal Workspace.
 *
 * TST-ACCOUNT-FLAG-001: public registration stays off until principal-aware
 * sessions exist, and the server says so instead of failing silently.
 * TST-ACCOUNT-REG-001: registration creates an account, a personal workspace
 * and the creator capability — and never a school, a period or a teacher user.
 * TST-ACCOUNT-MINOR-001: a minor is routed, not dead-ended, and no adult
 * account appears.
 * TST-ACCOUNT-NAME-001: the username is a pseudonym with its own availability
 * check, never derived from the email.
 * TST-AUTH-NOWS-001: sign-in needs no organization code; the legacy
 * organization path keeps working as a separate route.
 * TST-AUTH-CAPS-001: the server states capabilities; a creator cannot reach
 * the educator API and cannot forge a grant.
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
    username: `pseudo${id}`
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '')
      .slice(0, 40),
    displayName: '',
    birthDate: '1990-05-17',
    country: 'RU',
  };
}

async function register(payload: Record<string, unknown>) {
  return inject(app, { method: 'POST', url: '/api/auth/register', payload });
}

/** Registration is flag-gated; the tests state which side of the flag they run on. */
async function withRegistrationEnabled<T>(body: () => Promise<T>): Promise<T> {
  const previous = process.env['ASA_PUBLIC_REGISTRATION'];
  process.env['ASA_PUBLIC_REGISTRATION'] = 'on';
  try {
    return await body();
  } finally {
    if (previous === undefined) delete process.env['ASA_PUBLIC_REGISTRATION'];
    else process.env['ASA_PUBLIC_REGISTRATION'] = previous;
  }
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

describe('public registration feature flag', () => {
  it('is off by default and explains the state instead of half-creating an account', async () => {
    const payload = adult('flag-off');
    const response = await register(payload);
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('registration_disabled');

    const stored = await admin.query(`SELECT id FROM accounts WHERE lower(email) = $1`, [
      payload.email.toLowerCase(),
    ]);
    expect(stored.rows).toHaveLength(0);
  });
});

describe('adult registration', () => {
  it('creates an account, a personal workspace, the creator capability and an audit event', async () => {
    const payload = adult('reg');
    const response = await withRegistrationEnabled(() => register(payload));
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
      `SELECT w.kind, m.role, m.user_id FROM workspace_memberships m
         JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.account_id = $1`,
      [accountId],
    );
    expect(workspaces.rows).toEqual([{ kind: 'personal', role: 'owner', user_id: null }]);

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

  it('never turns a personal workspace into a school with a teacher in it', async () => {
    const payload = adult('no-school');
    const response = await withRegistrationEnabled(() => register(payload));
    expect(response.statusCode).toBe(201);

    const tenant = await admin.query(
      `SELECT w.tenant_id FROM workspaces w
         JOIN workspace_memberships m ON m.workspace_id = w.id
        WHERE m.account_id = $1`,
      [response.json().account.id],
    );
    const tenantId = tenant.rows[0].tenant_id as string;

    // Counting inside the new tenant, not globally: other suites run in
    // parallel against the same test database.
    const inside = await admin.query(
      `SELECT (SELECT count(*)::int FROM schools WHERE tenant_id = $1) AS schools,
              (SELECT count(*)::int FROM academic_periods WHERE tenant_id = $1) AS periods,
              (SELECT count(*)::int FROM users WHERE tenant_id = $1) AS users`,
      [tenantId],
    );
    expect(inside.rows[0]).toEqual({ schools: 0, periods: 0, users: 0 });
  });

  it('rejects malformed input and duplicate emails', async () => {
    await withRegistrationEnabled(async () => {
      const payload = adult('dup');
      expect((await register(payload)).statusCode).toBe(201);
      expect((await register({ ...payload, username: `${payload.username}x` })).statusCode).toBe(
        409,
      );

      for (const broken of [
        { ...adult('bad'), email: 'not-an-email' },
        { ...adult('bad'), password: 'short' },
        { ...adult('bad'), birthDate: '17.05.1990' },
        { ...adult('bad'), country: 'Россия' },
        { ...adult('bad'), username: 'no' },
        { ...adult('bad'), username: 'пседоним' },
      ]) {
        const response = await register(broken);
        expect(response.statusCode, JSON.stringify(broken)).toBe(400);
      }
      // Additional properties are rejected like everywhere else.
      const extra = await register({ ...adult('extra'), capability: 'platform_admin' });
      expect(extra.statusCode).toBe(400);
    });
  });

  it('never lets the client grant itself the educator capability', async () => {
    await withRegistrationEnabled(async () => {
      const forged = await register({ ...adult('forge'), capabilities: ['educator'] });
      expect(forged.statusCode).toBe(400);

      const payload = adult('forge-ok');
      const response = await register(payload);
      expect(response.statusCode).toBe(201);
      const grants = await admin.query(
        `SELECT capability FROM capability_grants WHERE account_id = $1`,
        [response.json().account.id],
      );
      expect(grants.rows.map((row) => row.capability)).toEqual(['creator']);
    });
  });
});

describe('username as a pseudonym', () => {
  it('is chosen by the person, checked for availability and never taken from the email', async () => {
    await withRegistrationEnabled(async () => {
      const payload = adult('name');
      const free = await inject(app, {
        method: 'GET',
        url: `/api/auth/username-available?username=${payload.username}`,
      });
      expect(free.json().available).toBe(true);

      expect((await register(payload)).statusCode).toBe(201);

      const taken = await inject(app, {
        method: 'GET',
        url: `/api/auth/username-available?username=${payload.username}`,
      });
      expect(taken.json().available).toBe(false);

      // The same pseudonym with a different email is refused, not silently renamed.
      const clash = await register({ ...adult('name-clash'), username: payload.username });
      expect(clash.statusCode).toBe(409);
      expect(clash.json().error.code).toBe('username_taken');

      const stored = await admin.query(
        `SELECT p.username FROM profiles p
           JOIN accounts a ON a.id = p.account_id
          WHERE lower(a.email) = $1`,
        [payload.email.toLowerCase()],
      );
      expect(stored.rows[0].username).toBe(payload.username);
      expect(stored.rows[0].username).not.toBe(payload.email.split('@')[0]);
    });
  });
});

describe('a minor is routed, never dead-ended', () => {
  it('answers with real routes and creates no adult account', async () => {
    await withRegistrationEnabled(async () => {
      const tooYoung = new Date();
      tooYoung.setUTCFullYear(tooYoung.getUTCFullYear() - 15);
      const payload = { ...adult('minor'), birthDate: tooYoung.toISOString().slice(0, 10) };
      const response = await register(payload);

      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('age_routed');
      expect(response.json().error.routes).toEqual(['class_code', 'student_account_next_stage']);

      const stored = await admin.query(`SELECT id FROM accounts WHERE lower(email) = $1`, [
        payload.email.toLowerCase(),
      ]);
      expect(stored.rows).toHaveLength(0);
      expect(response.cookies.find((entry) => entry.name === 'asa_session')).toBeUndefined();
    });
  });
});

describe('sign-in', () => {
  it('needs no organization code and never invents a working context', async () => {
    const payload = adult('login');
    await withRegistrationEnabled(() => register(payload));

    const login = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: payload.email, password: payload.password },
    });
    // A personal workspace has no tenant-scoped user yet: the server says so
    // instead of fabricating a teacher to sign in as.
    expect(login.statusCode).toBe(503);
    expect(login.json().error.code).toBe('context_unavailable');
    expect(login.cookies.find((entry) => entry.name === 'asa_session')).toBeUndefined();
  });

  it('rejects a wrong password with the credential contract', async () => {
    const payload = adult('login-deny');
    await withRegistrationEnabled(() => register(payload));
    const login = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: payload.email, password: 'wrong-password-value' },
    });
    expect(login.statusCode).toBe(401);
    expect(login.json().error.code).toBe('invalid_credentials');
  });

  it('keeps the legacy organization sign-in working as its own path', async () => {
    const teacher = await seedTeacher(admin, 'legacy-login');

    const denied = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        workspace: teacher.workspace,
        email: teacher.email,
        password: 'definitely-not-the-password',
      },
    });
    expect(denied.statusCode).toBe(401);

    const accepted = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        workspace: teacher.workspace,
        email: teacher.email,
        password: teacher.password,
      },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().user.email).toBe(teacher.email);
    // The answer states capabilities and workspaces; no role is claimed.
    expect(accepted.json().user.role).toBeUndefined();
    expect(Array.isArray(accepted.json().capabilities)).toBe(true);
    expect(Array.isArray(accepted.json().workspaces)).toBe(true);
    expect(accepted.cookies.find((entry) => entry.name === 'asa_session')?.httpOnly).toBe(true);
  });
});

describe('capabilities decide who reaches the classroom API', () => {
  /** Links an account to a seeded tenant user, the way sessions_v2 will. */
  async function linkAccount(
    teacher: Awaited<ReturnType<typeof seedTeacher>>,
    capabilities: { capability: string; state: string }[],
  ): Promise<string> {
    const account = await admin.query(
      `INSERT INTO accounts (email, password_hash, birth_date, country)
       VALUES ($1, 'x', DATE '1990-01-01', 'RU') RETURNING id`,
      [`linked-${unique('acc')}@test.local`],
    );
    const accountId = account.rows[0].id as string;
    await admin.query(
      `INSERT INTO profiles (account_id, username, display_name) VALUES ($1, $2, $2)`,
      [accountId, unique('linked').slice(0, 40)],
    );
    const workspace = await admin.query(
      `INSERT INTO workspaces (tenant_id, kind, title) VALUES ($1, 'organization', 'Тест')
       ON CONFLICT (tenant_id) DO UPDATE SET title = EXCLUDED.title RETURNING id`,
      [teacher.tenantId],
    );
    await admin.query(
      `INSERT INTO workspace_memberships (account_id, workspace_id, role, user_id)
       VALUES ($1, $2, 'owner', $3)`,
      [accountId, workspace.rows[0].id, teacher.teacherId],
    );
    for (const grant of capabilities) {
      await admin.query(
        `INSERT INTO capability_grants (account_id, capability, state, policy_version)
         VALUES ($1, $2, $3, 'asa-lab-2026-07')`,
        [accountId, grant.capability, grant.state],
      );
    }
    return accountId;
  }

  async function signIn(teacher: Awaited<ReturnType<typeof seedTeacher>>): Promise<string> {
    const login = await inject(app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { workspace: teacher.workspace, email: teacher.email, password: teacher.password },
    });
    expect(login.statusCode).toBe(200);
    return login.cookies.find((entry) => entry.name === 'asa_session')?.value ?? '';
  }

  it('refuses a creator: no classroom list and no classroom creation', async () => {
    const teacher = await seedTeacher(admin, 'creator-guard');
    await linkAccount(teacher, [{ capability: 'creator', state: 'verified' }]);
    const token = await signIn(teacher);

    const list = await inject(app, {
      method: 'GET',
      url: '/api/classrooms',
      cookies: { asa_session: token },
    });
    expect(list.statusCode).toBe(403);
    expect(list.json().error.code).toBe('educator_required');

    const created = await inject(app, {
      method: 'POST',
      url: '/api/classrooms',
      headers: { 'idempotency-key': unique('key') },
      cookies: { asa_session: token },
      payload: { title: 'Класс от создателя' },
    });
    expect(created.statusCode).toBe(403);
  });

  it('does not let a session claim a capability the server never granted', async () => {
    const teacher = await seedTeacher(admin, 'creator-claim');
    await linkAccount(teacher, [{ capability: 'creator', state: 'verified' }]);
    const token = await signIn(teacher);

    const me = await inject(app, {
      method: 'GET',
      url: '/api/auth/me',
      cookies: { asa_session: token },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().capabilities.map((entry: { capability: string }) => entry.capability)).toEqual(
      ['creator'],
    );

    // Sending a capability with the request changes nothing about access.
    const forged = await inject(app, {
      method: 'GET',
      url: '/api/classrooms',
      cookies: { asa_session: token },
      headers: { 'x-capability': 'educator' },
    });
    expect(forged.statusCode).toBe(403);
  });

  it('admits an account the server granted the educator capability', async () => {
    const teacher = await seedTeacher(admin, 'educator-guard');
    await linkAccount(teacher, [
      { capability: 'creator', state: 'verified' },
      { capability: 'educator', state: 'verified' },
    ]);
    const token = await signIn(teacher);

    const list = await inject(app, {
      method: 'GET',
      url: '/api/classrooms',
      cookies: { asa_session: token },
    });
    expect(list.statusCode).toBe(200);
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
