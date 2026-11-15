import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { testAdminPool, testAppPool } from '../portal/helpers';
import { aiIdentity, aiClassFixture } from '../admin/ai-student-access.contract';
import { emailTokenHash } from '../../apps/api/src/email.service';
let admin: pg.Pool, runtime: pg.Pool, snapshot: Record<string, unknown>;
beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  snapshot = (await admin.query('SELECT * FROM smtp_settings')).rows[0];
  await admin.query(
    `UPDATE smtp_settings SET config='{"enabled":true,"host":"smtp.example.test","port":465,"sender":"asa@example.test","username":"asa","siteOrigin":"https://portal.example.test"}',password_envelope='{"ciphertext":"encrypted-test-fixture","iv":"fixture","tag":"fixture"}',version=100,tested_version=100,test_ok=true,delivery_verified_version=NULL`,
  );
});
afterAll(async () => {
  if (snapshot)
    await admin.query(
      'UPDATE smtp_settings SET config=$1,password_envelope=$2,version=$3,tested_version=$4,tested_at=$5,test_ok=$6,delivery_verified_version=$7',
      [
        snapshot.config,
        snapshot.password_envelope,
        snapshot.version,
        snapshot.tested_version,
        snapshot.tested_at,
        snapshot.test_ok,
        snapshot.delivery_verified_version,
      ],
    );
  await runtime?.end();
  await admin?.end();
});
async function fixture() {
  const actor = await aiIdentity(admin),
    target = await aiIdentity(admin);
  await admin.query(
    `INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','test','admin')`,
    [actor.account_id],
  );
  const email = (await admin.query('SELECT email FROM accounts WHERE id=$1', [target.account_id]))
    .rows[0].email;
  return { actor, target, email };
}
async function intent(
  f: Awaited<ReturnType<typeof fixture>>,
  input: { own?: boolean; email?: string; request?: string; hash?: string } = {},
) {
  const own = input.own ?? false,
    actor = own ? f.target.principal_id : f.actor.principal_id;
  const version = (
    await runtime.query("SELECT crm_card($1,'account',$2,NULL,$3) AS value", [
      f.actor.principal_id,
      f.target.account_id,
      randomUUID(),
    ])
  ).rows[0].value.version;
  const token = randomBytes(32).toString('base64url'),
    hash = input.hash ?? emailTokenHash(token),
    id = randomUUID(),
    email = input.email ?? (own ? f.email : `new-${randomUUID()}@example.test`),
    request = input.request ?? randomUUID();
  const value = (
    await runtime.query('SELECT mail_intent_create($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS value', [
      actor,
      f.target.account_id,
      !own,
      email,
      own ? null : version,
      'User requested email proof',
      request,
      id,
      hash,
      100,
    ])
  ).rows[0].value;
  return { id, token, hash, email, request, value };
}
async function deliver(i: { id: string; hash: string }, sent = true) {
  await runtime.query('SELECT mail_intent_delivery($1,$2,$3)', [i.id, i.hash, sent]);
}
const consume = async (hash: string) =>
  (await runtime.query('SELECT mail_intent_consume($1) AS value', [hash])).rows[0].value;
it('keeps old verified login until proof, atomically changes it once and revokes sessions and refresh credentials', async () => {
  const f = await fixture();
  await admin.query("UPDATE accounts SET email_verification_state='verified' WHERE id=$1", [
    f.target.account_id,
  ]);
  const session = (
    await admin.query(
      'SELECT s.id FROM sessions_v2 s JOIN principals p ON p.id=s.principal_id WHERE p.account_id=$1 LIMIT 1',
      [f.target.account_id],
    )
  ).rows[0].id;
  const family = (
    await admin.query(
      "INSERT INTO session_refresh_families(session_id,source,absolute_expires_at) VALUES($1,'password',now()+interval '1 day') RETURNING id",
      [session],
    )
  ).rows[0].id;
  await admin.query(
    "INSERT INTO session_refresh_tokens(family_id,token_hash,generation,expires_at) VALUES($1,$2,1,now()+interval '1 day')",
    [family, randomUUID()],
  );
  const i = await intent(f);
  expect(i.value.status).toMatchObject({
    email: f.email,
    verified: true,
    pending: { email: i.email, state: 'sending' },
  });
  expect(await consume(i.hash)).toEqual({ confirmed: false });
  await deliver(i);
  const results = await Promise.all([consume(i.hash), consume(i.hash)]);
  expect(results.filter((x) => x.confirmed)).toHaveLength(1);
  expect(
    (
      await admin.query('SELECT email,email_verification_state FROM accounts WHERE id=$1', [
        f.target.account_id,
      ])
    ).rows[0],
  ).toEqual({ email: i.email, email_verification_state: 'verified' });
  expect(
    (
      await admin.query(
        'SELECT count(*)::integer n FROM sessions_v2 s JOIN principals p ON p.id=s.principal_id WHERE p.account_id=$1 AND s.revoked_at IS NULL',
        [f.target.account_id],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await admin.query(
        'SELECT revoked_at IS NOT NULL revoked FROM session_refresh_families WHERE id=$1',
        [family],
      )
    ).rows[0].revoked,
  ).toBe(true);
  expect(
    (
      await admin.query(
        'SELECT bool_and(revoked_at IS NOT NULL) revoked FROM session_refresh_tokens WHERE family_id=$1',
        [family],
      )
    ).rows[0].revoked,
  ).toBe(true);
  const audit = (
    await admin.query(
      "SELECT metadata_json,reason_text,actor_principal_id FROM administrative_audit_events WHERE action='account.email.change.confirmed' AND target_id=$1",
      [f.target.account_id],
    )
  ).rows[0];
  expect(audit.actor_principal_id).toBe(f.actor.principal_id);
  expect(audit.metadata_json.before.email).toBe(f.email);
  expect(audit.metadata_json.after.email).toBe(i.email);
  expect(JSON.stringify(audit)).not.toContain(i.hash);
  expect(JSON.stringify(audit)).not.toContain(i.token);
});
it('verifies own current email without changing login or logging out and records delivery proof for this configuration', async () => {
  const f = await fixture(),
    i = await intent(f, { own: true });
  const before = (
    await admin.query(
      'SELECT count(*)::integer n FROM sessions_v2 s JOIN principals p ON p.id=s.principal_id WHERE p.account_id=$1 AND revoked_at IS NULL',
      [f.target.account_id],
    )
  ).rows[0].n;
  await deliver(i);
  expect(await consume(i.hash)).toEqual({ confirmed: true, changed: false });
  expect(await consume(i.hash)).toEqual({ confirmed: false });
  expect(
    (
      await admin.query('SELECT email,email_verification_state FROM accounts WHERE id=$1', [
        f.target.account_id,
      ])
    ).rows[0],
  ).toEqual({ email: f.email, email_verification_state: 'verified' });
  expect(
    (
      await admin.query(
        'SELECT count(*)::integer n FROM sessions_v2 s JOIN principals p ON p.id=s.principal_id WHERE p.account_id=$1 AND revoked_at IS NULL',
        [f.target.account_id],
      )
    ).rows[0].n,
  ).toBe(before);
  expect(
    (await admin.query('SELECT delivery_verified_version FROM smtp_settings')).rows[0]
      .delivery_verified_version,
  ).toBe(100);
});
it('denies teacher/foreign own targets, Seat principals, raw tables and internal helper ACLs', async () => {
  const f = await fixture(),
    other = await aiIdentity(admin),
    seat = await aiClassFixture(admin, runtime);
  await expect(
    runtime.query('SELECT mail_intent_status($1,$2,false)', [
      seat.principalId,
      f.target.account_id,
    ]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    runtime.query('SELECT mail_intent_status($1,$2,true)', [
      other.principal_id,
      f.target.account_id,
    ]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    runtime.query('SELECT mail_intent_status($1,$2,false)', [
      other.principal_id,
      f.target.account_id,
    ]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    runtime.query('SELECT mail_admin_config($1)', [other.principal_id]),
  ).rejects.toMatchObject({ code: '42501' });
  for (const table of ['smtp_settings', 'account_email_intents'])
    await expect(runtime.query('SELECT * FROM ' + table)).rejects.toMatchObject({ code: '42501' });
  await expect(
    runtime.query('SELECT mail_authorize($1,$2,true)', [f.actor.principal_id, f.target.account_id]),
  ).rejects.toMatchObject({ code: '42501' });
  const safe = (
    await runtime.query('SELECT mail_admin_config($1) AS value', [f.actor.principal_id])
  ).rows[0].value;
  expect(safe.passwordConfigured).toBe(true);
  expect(JSON.stringify(safe)).not.toContain('encrypted-test-fixture');
});
it('deduplicates intent retries, enforces cooldown, and supersedes older proof on resend', async () => {
  const f = await fixture(),
    i = await intent(f);
  await deliver(i);
  const retry = await intent(f, { email: i.email, request: i.request });
  expect(retry.value.created).toBe(false);
  await expect(intent(f)).rejects.toMatchObject({ code: '54000' });
  await admin.query(
    "UPDATE account_email_intents SET created_at=created_at-interval '61 seconds' WHERE id=$1",
    [i.id],
  );
  const newer = await intent(f);
  await deliver(newer);
  expect(await consume(i.hash)).toEqual({ confirmed: false });
  expect(await consume(newer.hash)).toEqual({ confirmed: true, changed: true });
});
it('rejects expiry, cancelled proof, delivery failure, config drift and closed accounts', async () => {
  for (const mode of ['expired', 'cancelled', 'failed', 'config', 'closed']) {
    const f = await fixture(),
      i = await intent(f);
    await deliver(i);
    if (mode === 'expired')
      await admin.query(
        "UPDATE account_email_intents SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [i.id],
      );
    if (mode === 'cancelled')
      await runtime.query('SELECT mail_intent_cancel($1,$2,true,$3,$4)', [
        f.actor.principal_id,
        f.target.account_id,
        i.id,
        randomUUID(),
      ]);
    if (mode === 'failed')
      await admin.query("UPDATE account_email_intents SET state='failed' WHERE id=$1", [i.id]);
    if (mode === 'config')
      await admin.query('UPDATE account_email_intents SET smtp_version=99 WHERE id=$1', [i.id]);
    if (mode === 'closed')
      await admin.query("UPDATE accounts SET status='closed' WHERE id=$1", [f.target.account_id]);
    expect(await consume(i.hash)).toEqual({ confirmed: false });
    expect(
      (await admin.query('SELECT email FROM accounts WHERE id=$1', [f.target.account_id])).rows[0]
        .email,
    ).toBe(f.email);
  }
});
it('handles duplicate email and a racing acquisition of the pending address without overwriting another account', async () => {
  const f = await fixture(),
    other = await aiIdentity(admin),
    taken = (await admin.query('SELECT email FROM accounts WHERE id=$1', [other.account_id]))
      .rows[0].email;
  await expect(intent(f, { email: taken })).rejects.toMatchObject({ code: '23505' });
  const i = await intent(f);
  await deliver(i);
  await admin.query('UPDATE accounts SET email=$1 WHERE id=$2', [i.email, other.account_id]);
  expect(await consume(i.hash)).toEqual({ confirmed: false });
  expect(
    (await admin.query('SELECT email FROM accounts WHERE id=$1', [f.target.account_id])).rows[0]
      .email,
  ).toBe(f.email);
});
it('protects optimistic versions and resets readiness on safe configuration changes without exporting the secret', async () => {
  const f = await fixture();
  await expect(
    runtime.query('SELECT mail_config_save($1,99,$2::jsonb,NULL,false,$3)', [
      f.actor.principal_id,
      JSON.stringify({ enabled: false }),
      randomUUID(),
    ]),
  ).rejects.toMatchObject({ code: '40001' });
  const saved = (
    await runtime.query('SELECT mail_config_save($1,100,$2::jsonb,NULL,false,$3) AS value', [
      f.actor.principal_id,
      JSON.stringify({ enabled: false }),
      randomUUID(),
    ])
  ).rows[0].value;
  expect(saved).toMatchObject({
    version: 101,
    testOk: false,
    testedVersion: null,
    passwordConfigured: true,
  });
  expect(saved).not.toHaveProperty('passwordEnvelope');
  await admin.query(
    'UPDATE smtp_settings SET version=100,config=$1,test_ok=true,tested_version=100',
    [
      JSON.stringify({
        enabled: true,
        host: 'smtp.example.test',
        port: 465,
        sender: 'asa@example.test',
        username: 'asa',
        siteOrigin: 'https://portal.example.test',
      }),
    ],
  );
});

it('adds a proven email to the same existing external-only Account without creating or merging identities', async () => {
  const f = await fixture();
  await admin.query(
    'UPDATE accounts SET email=NULL,password_hash=NULL,password_configured=false WHERE id=$1',
    [f.target.account_id],
  );
  const i = await intent(f);
  expect(i.value.status.email).toBeNull();
  await deliver(i);
  expect(await consume(i.hash)).toEqual({ confirmed: true, changed: true });
  expect(
    (
      await admin.query('SELECT email,password_configured FROM accounts WHERE id=$1', [
        f.target.account_id,
      ])
    ).rows[0],
  ).toEqual({ email: i.email, password_configured: false });
  expect(
    (
      await admin.query('SELECT count(*)::integer n FROM principals WHERE account_id=$1', [
        f.target.account_id,
      ])
    ).rows[0].n,
  ).toBe(1);
});

it('serializes simultaneous requests and bounds repeated hourly delivery attempts', async () => {
  const f = await fixture(),
    results = await Promise.allSettled([intent(f), intent(f)]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(
    results
      .filter((r) => r.status === 'rejected')
      .map((r) => (r as PromiseRejectedResult).reason.code),
  ).toEqual(['54000']);
  const g = await fixture();
  for (let n = 0; n < 5; n++) {
    const i = await intent(g);
    await admin.query(
      "UPDATE account_email_intents SET created_at=clock_timestamp()-interval '61 seconds' WHERE id=$1",
      [i.id],
    );
  }
  await expect(intent(g)).rejects.toMatchObject({ code: '54000' });
});
