import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool } from '../portal/helpers';
import {
  runSessionContextQuery,
  runSessionDatabaseScope,
  sessionDatabaseDiagnostics,
} from '../../apps/api/src/session-database-diagnostics';

let admin: pg.Pool;
let runtime: pg.Pool;
let tokenHash: string;
let accountId: string;
let workspaceId: string;
const beforeName = `session_context_before_${crypto.randomUUID().replaceAll('-', '')}`;
const currentSql = 'SELECT * FROM public.session_v2_context($1)';

beforeAll(async () => {
  // Helpers reject anything except matching isolated *_test databases.
  admin = testAdminPool();
  runtime = testAppPool();
  const teacher = await seedTeacher(admin, 'context-contention');
  const identity = await admin.query(
    'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
    [teacher.tenantId, teacher.teacherId],
  );
  accountId = identity.rows[0].account_id;
  const workspace = await admin.query(
    "SELECT workspace_id FROM workspace_memberships WHERE account_id=$1 AND state='active' LIMIT 1",
    [accountId],
  );
  workspaceId = workspace.rows[0].workspace_id;
  tokenHash = `synthetic-context-${crypto.randomUUID()}`;
  await runtime.query('SELECT session_v2_create($1,$2,$3,12,NULL)', [
    identity.rows[0].principal_id,
    workspaceId,
    tokenHash,
  ]);
  const source = readFileSync(
    new URL('../../migrations/0011_account_c1_management.sql', import.meta.url),
    'utf8',
  );
  const original = source.match(
    /CREATE OR REPLACE FUNCTION session_v2_context\(p_token_hash text\)[\s\S]*?\r?\n\$\$;/,
  )?.[0];
  if (!original || !/^session_context_before_[a-f0-9]{32}$/.test(beforeName))
    throw new Error('Invalid isolated baseline fixture');
  await admin.query(
    original.replace('FUNCTION session_v2_context(', `FUNCTION public.${beforeName}(`),
  );
  await admin.query(
    `REVOKE ALL ON FUNCTION public.${beforeName}(text) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.${beforeName}(text) TO asalab_app`,
  );
}, 30000);

afterAll(async () => {
  try {
    if (admin) await admin.query(`DROP FUNCTION IF EXISTS public.${beforeName}(text)`);
  } finally {
    await runtime?.end();
    await admin?.end();
  }
});

describe('actual Account context heartbeat contention', () => {
  it('proves the prior function waits on the held row while current authority returns without that lock', async () => {
    const baseline = await runtime.query(`SELECT * FROM public.${beforeName}($1)`, [tokenHash]);
    expect(baseline.rows).toHaveLength(1);
    await admin.query(
      "UPDATE sessions_v2 SET last_seen_at='2000-01-01T00:00:00Z' WHERE token_hash=$1",
      [tokenHash],
    );
    const locker = await admin.connect();
    const reader = await runtime.connect();
    try {
      await locker.query('BEGIN');
      await locker.query('SELECT id FROM sessions_v2 WHERE token_hash=$1 FOR UPDATE', [tokenHash]);
      const pid = (await reader.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await reader.query("SET statement_timeout='1000ms'");
      const beforeStarted = performance.now();
      const oldFailure = reader.query(`SELECT * FROM public.${beforeName}($1)`, [tokenHash]).then(
        () => null,
        (error) => error,
      );
      let blocked = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const activity = await admin.query(
          'SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',
          [pid],
        );
        if (activity.rows[0]?.wait_event_type === 'Lock') {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      expect(await oldFailure).toMatchObject({ code: '57014' });
      const beforeMs = performance.now() - beforeStarted;
      const afterStarted = performance.now();
      const current = await reader.query(currentSql, [tokenHash]);
      const afterMs = performance.now() - afterStarted;
      expect(current.rows).toEqual(baseline.rows);
      expect(
        (
          await admin.query('SELECT last_seen_at FROM sessions_v2 WHERE token_hash=$1', [tokenHash])
        ).rows[0].last_seen_at.getUTCFullYear(),
      ).toBe(2000);
      // No COMMIT/ROLLBACK on locker occurred before the successful read above.
      console.info(
        JSON.stringify({
          kind: 'session_context_contention_evidence',
          beforeObservedLock: blocked,
          beforeSqlstate: '57014',
          beforeMs: Math.round(beforeMs),
          afterMs: Math.round(afterMs),
          returnedRows: current.rows.length,
          heartbeatSkippedWhileLocked: true,
        }),
      );
    } finally {
      await locker.query('ROLLBACK');
      await reader.query('RESET statement_timeout');
      locker.release();
      reader.release();
    }
  });

  it('updates a due heartbeat after release and does not rewrite it on a 30-read burst', async () => {
    await admin.query(
      "UPDATE sessions_v2 SET last_seen_at='2000-01-01T00:00:00Z' WHERE token_hash=$1",
      [tokenHash],
    );
    const before = (
      await admin.query('SELECT expires_at FROM sessions_v2 WHERE token_hash=$1', [tokenHash])
    ).rows[0];
    const diagnosticRequest = {};
    let measured!: ReturnType<typeof runSessionContextQuery>;
    runSessionDatabaseScope(diagnosticRequest, () => {
      measured = runSessionContextQuery(runtime, currentSql, [tokenHash]);
    });
    expect((await measured).rows).toHaveLength(1);
    expect(sessionDatabaseDiagnostics(diagnosticRequest)).toMatchObject({
      operation: 'identity.session.resolve',
      calls: 1,
      failures: 0,
    });
    const updated = (
      await admin.query(
        'SELECT xmin::text,last_seen_at,expires_at FROM sessions_v2 WHERE token_hash=$1',
        [tokenHash],
      )
    ).rows[0];
    expect(updated.last_seen_at.getUTCFullYear()).toBeGreaterThan(2000);
    for (const value of await Promise.all(
      Array.from({ length: 30 }, () => runtime.query(currentSql, [tokenHash])),
    ))
      expect(value.rows).toHaveLength(1);
    const after = (
      await admin.query(
        'SELECT xmin::text,last_seen_at,expires_at FROM sessions_v2 WHERE token_hash=$1',
        [tokenHash],
      )
    ).rows[0];
    expect(after).toEqual(updated);
    expect(after.expires_at).toEqual(before.expires_at);
    console.info(
      JSON.stringify({
        kind: 'session_context_heartbeat_evidence',
        measured: sessionDatabaseDiagnostics(diagnosticRequest),
        burstReads: 30,
        rowVersionUnchangedAfterFirstHeartbeat: true,
        expiryUnchanged: true,
      }),
    );
  });

  it('keeps committed expiry, revocation, Account, workspace and membership rejection authoritative', async () => {
    const expiry = (
      await admin.query('SELECT expires_at FROM sessions_v2 WHERE token_hash=$1', [tokenHash])
    ).rows[0].expires_at;
    const cases: [string, unknown[], string, unknown[]][] = [
      [
        "UPDATE sessions_v2 SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
        [tokenHash],
        'UPDATE sessions_v2 SET expires_at=$2 WHERE token_hash=$1',
        [tokenHash, expiry],
      ],
      [
        'UPDATE sessions_v2 SET revoked_at=now() WHERE token_hash=$1',
        [tokenHash],
        'UPDATE sessions_v2 SET revoked_at=NULL WHERE token_hash=$1',
        [tokenHash],
      ],
      [
        "UPDATE accounts SET status='suspended' WHERE id=$1",
        [accountId],
        "UPDATE accounts SET status='active' WHERE id=$1",
        [accountId],
      ],
      [
        "UPDATE workspaces SET status='suspended' WHERE id=$1",
        [workspaceId],
        "UPDATE workspaces SET status='active' WHERE id=$1",
        [workspaceId],
      ],
      [
        "UPDATE workspace_memberships SET state='revoked' WHERE account_id=$1 AND workspace_id=$2",
        [accountId, workspaceId],
        "UPDATE workspace_memberships SET state='active' WHERE account_id=$1 AND workspace_id=$2",
        [accountId, workspaceId],
      ],
    ];
    for (const [mutation, args, restore, restoreArgs] of cases) {
      await admin.query(mutation, args);
      try {
        expect((await runtime.query(currentSql, [tokenHash])).rows).toEqual([]);
      } finally {
        await admin.query(restore, restoreArgs);
      }
      expect((await runtime.query(currentSql, [tokenHash])).rows).toHaveLength(1);
    }
    expect((await runtime.query(currentSql, ['unknown-token'])).rows).toEqual([]);
    const definition = (
      await admin.query(
        "SELECT prosecdef,proconfig FROM pg_proc WHERE oid='public.session_v2_context(text)'::regprocedure",
      )
    ).rows[0];
    expect(definition.prosecdef).toBe(true);
    expect(definition.proconfig.join(',')).toMatch(/search_path=pg_catalog, pg_temp/);
    expect(
      (
        await admin.query(
          "SELECT has_function_privilege('asalab_app','public.session_v2_context(text)','EXECUTE') AS allowed",
        )
      ).rows[0].allowed,
    ).toBe(true);
  });
});
