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
        MIGRATION_DATABASE_URL: 'postgres://migration@host/db',
        MIGRATION_EXPECT_DATABASE: 'db',
        MIGRATION_CONFIRM: 'APPLY:db',
        TEST_DATABASE_URL: 'postgres://admin@host/db_test',
        APP_TEST_DATABASE_URL: 'postgres://app@host/db_test',
        PATH: 'x',
      },
      4611,
    );
    expect(env['APP_DATABASE_URL']).toBe('postgres://app@host/db');
    expect(env['DATABASE_URL']).toBeUndefined();
    expect(env['MIGRATION_DATABASE_URL']).toBeUndefined();
    expect(env['MIGRATION_EXPECT_DATABASE']).toBeUndefined();
    expect(env['MIGRATION_CONFIRM']).toBeUndefined();
    expect(env['TEST_DATABASE_URL']).toBeUndefined();
    expect(env['APP_TEST_DATABASE_URL']).toBeUndefined();
    expect(env['API_PORT']).toBe('4611');
  });

  it('the web child environment carries no database credentials at all', () => {
    const env = webChildEnv({
      APP_DATABASE_URL: 'postgres://app@host/db',
      DATABASE_URL: 'postgres://admin@host/db',
      MIGRATION_DATABASE_URL: 'postgres://migration@host/db',
      MIGRATION_EXPECT_DATABASE: 'db',
      MIGRATION_CONFIRM: 'APPLY:db',
      TEST_DATABASE_URL: 'postgres://admin@host/db_test',
      APP_TEST_DATABASE_URL: 'postgres://app@host/db_test',
      PATH: 'x',
    });
    expect(env['APP_DATABASE_URL']).toBeUndefined();
    expect(env['DATABASE_URL']).toBeUndefined();
    expect(env['MIGRATION_DATABASE_URL']).toBeUndefined();
    expect(env['MIGRATION_EXPECT_DATABASE']).toBeUndefined();
    expect(env['MIGRATION_CONFIRM']).toBeUndefined();
    expect(env['TEST_DATABASE_URL']).toBeUndefined();
    expect(env['APP_TEST_DATABASE_URL']).toBeUndefined();
    expect(env['PATH']).toBe('x');
  });
});

describe('migration smoke isolation', () => {
  function smokeEnv(overrides: Record<string, string | undefined>): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && key !== 'TEST_DATABASE_URL') env[key] = value;
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    return env;
  }

  it('db:migrate:test refuses a database whose name is not *_test', () => {
    const result = spawnSync('node', ['tools/migrate.mjs', '--smoke'], {
      env: smokeEnv({ TEST_DATABASE_URL: 'postgres://admin:x@127.0.0.1:5433/asalab' }),
      encoding: 'utf8',
      timeout: 20000,
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toContain('*_test');
  });

  it('db:migrate:test is BLOCKED without TEST_DATABASE_URL (never falls back to dev)', () => {
    const result = spawnSync('node', ['tools/migrate.mjs', '--smoke'], {
      env: smokeEnv({}),
      encoding: 'utf8',
      timeout: 20000,
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toContain('TEST_DATABASE_URL');
  });
});

describe('explicit migration apply target', () => {
  function migrationEnv(overrides: Record<string, string | undefined>): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (
        value !== undefined &&
        ![
          'DATABASE_URL',
          'MIGRATION_DATABASE_URL',
          'MIGRATION_EXPECT_DATABASE',
          'MIGRATION_CONFIRM',
        ].includes(key)
      ) {
        env[key] = value;
      }
    }
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) env[key] = value;
    }
    return env;
  }

  it('never treats DATABASE_URL as an implicit --apply target', () => {
    const result = spawnSync('node', ['tools/migrate.mjs', '--apply'], {
      env: migrationEnv({ DATABASE_URL: 'postgres://admin:x@127.0.0.1:5433/asalab_dev' }),
      encoding: 'utf8',
      timeout: 20000,
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toContain('DATABASE_URL is never an implicit migration target');
  });

  it('rejects a URL whose database differs from the attested target', () => {
    const result = spawnSync('node', ['tools/migrate.mjs', '--apply'], {
      env: migrationEnv({
        MIGRATION_DATABASE_URL: 'postgres://admin:x@127.0.0.1:5433/asalab_dev',
        MIGRATION_EXPECT_DATABASE: 'asalab_test',
        MIGRATION_CONFIRM: 'APPLY:asalab_test',
      }),
      encoding: 'utf8',
      timeout: 20000,
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toContain('asalab_dev');
    expect(result.stderr).toContain('asalab_test');
  });

  it('requires an exact destructive-action confirmation for the attested database', () => {
    const result = spawnSync('node', ['tools/migrate.mjs', '--apply'], {
      env: migrationEnv({
        MIGRATION_DATABASE_URL: 'postgres://admin:x@127.0.0.1:5433/asalab_test',
        MIGRATION_EXPECT_DATABASE: 'asalab_test',
      }),
      encoding: 'utf8',
      timeout: 20000,
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toContain('MIGRATION_CONFIRM');
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
