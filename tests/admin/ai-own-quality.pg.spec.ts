import type pg from 'pg';
import { afterAll, beforeAll } from 'vitest';
import { testAdminPool, testAppPool } from '../portal/helpers';
import { lockAiPostgresSuite } from './ai-postgres-suite-lock';
import { aiOwnQualityContract } from './ai-own-quality.contract';
import { aiOwnQualityHttpContract } from './ai-own-quality-http.contract';
let admin: pg.Pool, runtime: pg.Pool, unlock: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const urls = ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL'].map((key) => {
    const value = process.env[key];
    if (!value) throw new Error('Explicit isolated _test database required');
    const u = new URL(value);
    if (!decodeURIComponent(u.pathname).endsWith('_test'))
      throw new Error('Only isolated _test database allowed');
    return u;
  });
  if (urls[0]!.host !== urls[1]!.host || urls[0]!.pathname !== urls[1]!.pathname)
    throw new Error('Both roles must use the same isolated database');
  admin = testAdminPool();
  runtime = testAppPool();
  unlock = await lockAiPostgresSuite(admin);
}, 30000);
afterAll(async () => {
  try {
    await runtime?.end();
  } finally {
    await unlock?.();
    await admin?.end();
  }
});
aiOwnQualityContract(() => ({ admin, runtime }));
aiOwnQualityHttpContract(() => ({ admin, runtime }));
