import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import type pg from 'pg';
import { withTenantContext } from '../../packages/database/dist/index.js';
import { apiChildEnv, webChildEnv } from '../../tools/child-env.mjs';
import { testAdminPool, testAppPool } from './helpers';

/** TST-TENANT-001: database URL isolation and verified tenant context. */

let admin: pg.Pool;
let runtime: pg.Pool;

beforeAll(() => {
  admin = testAdminPool();
  runtime = testAppPool();
});

afterAll(async () => {
  await admin.end();
  await runtime.end();
});

describe('database URL isolation', () => {
  it('the API refuses to start with only DATABASE_URL (no APP_DATABASE_URL)', () => {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && key !== 'APP_DATABASE_URL') env[key] = value;
    }
    env['DATABASE_URL'] = 'postgres://admin:secret@127.0.0.1:5433/asalab';
    const result = spawnSync('node', ['apps/api/dist/main.js'], {
      env,
      encoding: 'utf8',
      timeout: 20000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('APP_DATABASE_URL is required');
  });

  it('the API child environment never contains admin or test URLs', () => {
    const env = apiChildEnv(
      {
        APP_DATABASE_URL: 'postgres://app@host/db',
        DATABASE_URL: 'postgres://admin@host/db',
        TEST_DATABASE_URL: 'postgres://admin@host/db_test',
        PATH: 'x',
      },
      4611,
    );
    expect(env['APP_DATABASE_URL']).toBe('postgres://app@host/db');
    expect(env['DATABASE_URL']).toBeUndefined();
    expect(env['TEST_DATABASE_URL']).toBeUndefined();
    expect(env['API_PORT']).toBe('4611');
  });

  it('the web child environment carries no database credentials at all', () => {
    const env = webChildEnv({
      APP_DATABASE_URL: 'postgres://app@host/db',
      DATABASE_URL: 'postgres://admin@host/db',
      TEST_DATABASE_URL: 'postgres://admin@host/db_test',
      PATH: 'x',
    });
    expect(env['APP_DATABASE_URL']).toBeUndefined();
    expect(env['DATABASE_URL']).toBeUndefined();
    expect(env['TEST_DATABASE_URL']).toBeUndefined();
    expect(env['PATH']).toBe('x');
  });
});

describe('verified tenant context', () => {
  it('SET LOCAL app.tenant_id clears before the connection returns to the pool', async () => {
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true)`,
      );
      await client.query('COMMIT');
      const after = await client.query(`SELECT current_setting('app.tenant_id', true) AS v`);
      expect(after.rows[0].v ?? '').toBe('');
    } finally {
      client.release();
    }
  });

  it('withTenantContext rolls back and clears the context on error', async () => {
    await expect(
      withTenantContext(runtime, '00000000-0000-0000-0000-000000000001', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const check = await runtime.query(`SELECT current_setting('app.tenant_id', true) AS v`);
    expect(check.rows[0].v ?? '').toBe('');
  });
});
