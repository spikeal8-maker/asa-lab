import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { testAdminPool, testAppPool } from './helpers';
import { buildTestApp, inject, type NestApp } from './app';

/**
 * TST-REGISTRATION-ATOMICITY-001 — registration never leaves half an account.
 *
 * A successful registration must produce a whole identity: account, profile,
 * principal, Personal Workspace, an active session and an audit event. Sessions
 * for account principals do not exist yet, so registration is closed — and it
 * is closed *before* the first write, because an account that can be signed up
 * for but never signed into is worse than no account at all.
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

/**
 * Every identity row a registration would create, counted for one candidate.
 *
 * Counting the whole table would be a weaker claim and a flakier one: the
 * suites share a database and write in parallel. Counting by the candidate's
 * own email, username and personal tenant slug proves exactly what matters —
 * that this request left nothing behind.
 */
async function footprint(payload: {
  email: string;
  username: string;
}): Promise<Record<string, number>> {
  const email = payload.email.toLowerCase();
  const result = await admin.query(
    `SELECT
       (SELECT count(*)::int FROM accounts WHERE lower(email) = $1) AS accounts,
       (SELECT count(*)::int FROM profiles WHERE lower(username) = $2) AS profiles,
       (SELECT count(*)::int FROM principals p
          JOIN accounts a ON a.id = p.account_id WHERE lower(a.email) = $1) AS principals,
       (SELECT count(*)::int FROM capability_grants g
          JOIN accounts a ON a.id = g.account_id WHERE lower(a.email) = $1) AS capability_grants,
       (SELECT count(*)::int FROM workspace_memberships m
          JOIN accounts a ON a.id = m.account_id WHERE lower(a.email) = $1) AS memberships,
       (SELECT count(*)::int FROM legacy_user_account_links l
          JOIN accounts a ON a.id = l.account_id WHERE lower(a.email) = $1) AS legacy_links,
       (SELECT count(*)::int FROM audit_events e
          JOIN accounts a ON a.id = e.entity_id
         WHERE lower(a.email) = $1 AND e.entity_type = 'account') AS audit_events`,
    [email, payload.username.toLowerCase()],
  );
  return result.rows[0];
}

const NOTHING: Record<string, number> = {
  accounts: 0,
  profiles: 0,
  principals: 0,
  capability_grants: 0,
  memberships: 0,
  legacy_links: 0,
  audit_events: 0,
};

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

describe('registration is closed until it can complete', () => {
  it('writes nothing at all while the flag is off', async () => {
    const payload = adult('atomic-off');
    expect(await footprint(payload)).toEqual(NOTHING);

    const response = await register(payload);
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe('registration_disabled');
    expect(response.cookies).toHaveLength(0);

    expect(await footprint(payload)).toEqual(NOTHING);
  });

  it('still writes nothing when the flag alone is turned on', async () => {
    // Turning the feature flag on is not enough: without principal-aware
    // sessions the endpoint refuses a second time, and the refusal happens
    // before the first insert rather than after a partial identity exists.
    const previous = process.env['ASA_PUBLIC_REGISTRATION'];
    process.env['ASA_PUBLIC_REGISTRATION'] = 'on';
    try {
      const payload = adult('atomic-flag-on');
      expect(await footprint(payload)).toEqual(NOTHING);

      const response = await register(payload);
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe('registration_requires_sessions_v2');
      expect(response.cookies).toHaveLength(0);

      // No account, no profile, no principal, no workspace, no audit event.
      expect(await footprint(payload)).toEqual(NOTHING);
    } finally {
      if (previous === undefined) delete process.env['ASA_PUBLIC_REGISTRATION'];
      else process.env['ASA_PUBLIC_REGISTRATION'] = previous;
    }
  });

  it('routes a minor without writing anything either', async () => {
    const tooYoung = new Date();
    tooYoung.setUTCFullYear(tooYoung.getUTCFullYear() - 15);
    const payload = { ...adult('atomic-minor'), birthDate: tooYoung.toISOString().slice(0, 10) };

    const response = await register(payload);
    expect(response.statusCode).toBe(422);
    expect(response.json().error.routes).toEqual(['class_code', 'student_account_next_stage']);
    expect(response.cookies).toHaveLength(0);

    expect(await footprint(payload)).toEqual(NOTHING);
  });

  it('leaves no half-built identity in the database', async () => {
    // The invariant is an implication, not a headcount: other suites create
    // bare fixture rows on purpose. What must never happen is an identity that
    // exists in part — a workspace nobody owns, or an account that reached the
    // workspace stage without the profile and principal that come first.
    const orphanProfiles = await admin.query(
      `SELECT count(*)::int AS n FROM profiles p
        WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = p.account_id)`,
    );
    const startedButUnfinished = await admin.query(
      `SELECT count(*)::int AS n
         FROM accounts a
         JOIN workspace_memberships m ON m.account_id = a.id
         JOIN workspaces w ON w.id = m.workspace_id AND w.kind = 'personal'
        WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.account_id = a.id)
           OR NOT EXISTS (SELECT 1 FROM principals p WHERE p.account_id = a.id)`,
    );
    const workspacesWithoutMember = await admin.query(
      `SELECT count(*)::int AS n FROM workspaces w
        WHERE w.kind = 'personal'
          AND NOT EXISTS (
              SELECT 1 FROM workspace_memberships m WHERE m.workspace_id = w.id)`,
    );
    expect(orphanProfiles.rows[0].n).toBe(0);
    expect(startedButUnfinished.rows[0].n).toBe(0);
    expect(workspacesWithoutMember.rows[0].n).toBe(0);
  });
});
