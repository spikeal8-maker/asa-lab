import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { testAdminPool, testAppPool, seedTeacher } from '../portal/helpers';

let admin: pg.Pool, runtime: pg.Pool;
beforeAll(() => {
  admin = testAdminPool();
  runtime = testAppPool();
});
afterAll(async () => {
  await runtime.end();
  await admin.end();
});
describe('actual diagnostic provenance and PostgreSQL coverage', () => {
  it('derives resolved/unresolved on real restricted ingest and preserves receipts/actor denial', async () => {
    const teacher = await seedTeacher(admin, 'coverage');
    const identity = (
      await admin.query(
        'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
        [teacher.tenantId, teacher.teacherId],
      )
    ).rows[0];
    const workspace = (
      await admin.query(
        "SELECT workspace_id FROM workspace_memberships WHERE account_id=$1 AND state='active' LIMIT 1",
        [identity.account_id],
      )
    ).rows[0].workspace_id;
    const sql =
      'SELECT analytics_ingest_v2($1,$2,$3,$4,NULL,$5,NULL,$6,$7::jsonb,$8::jsonb,now()) AS receipt';
    for (const address of [null, '203.0.113.18']) {
      const id = randomUUID();
      const semantic = { outcome: 'succeeded', visitId: randomUUID(), entryRoute: 'projects' };
      const metadata = {
        address,
        networkKind: address ? 'public' : 'proxy',
        browser: 'Firefox',
        major: 128,
        os: 'Linux',
        device: 'desktop',
      };
      const args = [
        id,
        'account',
        identity.account_id,
        identity.principal_id,
        workspace,
        'visit.observed',
        JSON.stringify(semantic),
        JSON.stringify(metadata),
      ];
      const first = (await runtime.query(sql, args)).rows[0].receipt;
      expect((await runtime.query(sql, args)).rows[0].receipt).toEqual(first);
      const expected = address ? 'server_resolved' : 'server_unresolved';
      expect(
        (
          await admin.query(
            'SELECT address_provenance FROM product_analytics_events WHERE receipt_event_id=$1',
            [id],
          )
        ).rows[0].address_provenance,
      ).toBe(expected);
      expect(
        (
          await admin.query(
            'SELECT address_provenance FROM analytics_operation_receipts WHERE event_id=$1',
            [id],
          )
        ).rows[0].address_provenance,
      ).toBe(expected);
    }
    await expect(
      runtime.query(sql, [
        randomUUID(),
        'account',
        randomUUID(),
        identity.principal_id,
        workspace,
        'visit.observed',
        '{"outcome":"succeeded"}',
        '{}',
      ]),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('records actual blocked waits without exposing statement/bind values', async () => {
    await admin.query('CREATE TABLE coverage_wait_fixture(id integer PRIMARY KEY,value text)');
    await admin.query("INSERT INTO coverage_wait_fixture VALUES(1,'synthetic')");
    const locker = await admin.connect(),
      waiter = await admin.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await locker.query('BEGIN');
      await locker.query('SELECT * FROM coverage_wait_fixture WHERE id=1 FOR UPDATE');
      pending = waiter.query('UPDATE coverage_wait_fixture SET value=$1 WHERE id=1', [
        'PRIVATE_COVERAGE_CANARY',
      ]);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const source = readFileSync(new URL('../../tools/collect_logs.py', import.meta.url), 'utf8');
      const inner = source.match(
        /DATABASE_METRICS_SQL = """[\s\S]*?COPY \(([\s\S]*?)\) TO STDOUT/,
      )?.[1];
      if (!inner) throw new Error('Missing actual collector metric SQL');
      const sample = (await admin.query(inner)).rows[0].json_build_object;
      expect(sample.blockedSessions).toBeGreaterThanOrEqual(1);
      expect(
        sample.waits.some((wait: { wait_event_type: string }) => wait.wait_event_type === 'Lock'),
      ).toBe(true);
      expect(sample.longestActiveMs).toBeGreaterThanOrEqual(1000);
      expect(JSON.stringify(sample)).not.toMatch(
        /PRIVATE|SELECT|UPDATE|query_start|pid|client_addr/,
      );
    } finally {
      await locker.query('ROLLBACK');
      await pending;
      locker.release();
      waiter.release();
    }
    console.info(JSON.stringify({ blockedWaitObserved: true }));
  });
  it.skipIf(process.env.ASA_COVERAGE_POSTGRES_PROBE !== '1')(
    'checks actual Compose settings and host logs only in the explicit disposable harness',
    async () => {
      // Host Docker access is not available to ordinary PG/access/data suites.
      // This probe is opt-in only in Coverage Diagnostics, never inferred from CI.
      await expect(
        admin.query('SELECT 1/(length($1)-length($1))', ['PRIVATE_COVERAGE_CANARY']),
      ).rejects.toMatchObject({ code: '22012' });
      const config = (
        await admin.query('SELECT name,setting FROM pg_settings WHERE name=ANY($1::text[])', [
          [
            'log_lock_waits',
            'log_error_verbosity',
            'log_min_error_statement',
            'log_statement',
            'log_parameter_max_length',
            'log_parameter_max_length_on_error',
          ],
        ])
      ).rows;
      expect(Object.fromEntries(config.map((row) => [row.name, row.setting]))).toEqual({
        log_lock_waits: 'on',
        log_error_verbosity: 'terse',
        log_min_error_statement: 'panic',
        log_statement: 'none',
        log_parameter_max_length: '0',
        log_parameter_max_length_on_error: '0',
      });
      const logs = spawnSync('docker', ['logs', `asa-coverage-${process.env.GITHUB_RUN_ID}`], {
        encoding: 'utf8',
      });
      expect(logs.status).toBe(0);
      const text = logs.stdout + logs.stderr;
      expect(text).toMatch(/still waiting for|acquired .* after/);
      expect(text).not.toMatch(/PRIVATE_COVERAGE_CANARY|STATEMENT:|CONTEXT:|DETAIL:/);
      console.info(
        JSON.stringify({
          lockLogObserved: true,
          statementOrBindCanaryLeaked: false,
        }),
      );
    },
  );
});
