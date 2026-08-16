import { afterEach, describe, expect, it } from 'vitest';
import { poolSettings } from './app.factory.js';

const KEYS = [
  'ASA_DB_POOL_MAX',
  'ASA_DB_CONNECTION_TIMEOUT_MS',
  'ASA_DB_IDLE_TIMEOUT_MS',
  'ASA_DB_STATEMENT_TIMEOUT_MS',
  'ASA_DB_QUERY_TIMEOUT_MS',
] as const;

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe('database pool settings', () => {
  it('bounds every wait so a slow statement cannot become an outage', () => {
    const settings = poolSettings();
    // Without these a single slow statement holds its connection forever and
    // every caller behind it waits with no upper bound.
    expect(settings.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(settings.idleTimeoutMillis).toBeGreaterThan(0);
    expect(settings.statement_timeout).toBeGreaterThan(0);
    expect(settings.query_timeout).toBeGreaterThan(0);
  });

  it('keeps the measured pool size as the default', () => {
    // Ten is what the load measurement supports: fifty was slower with a worse
    // tail, because the contention moves into PostgreSQL.
    expect(poolSettings().max).toBe(10);
  });

  it('takes the size and the timeouts from the environment', () => {
    process.env['ASA_DB_POOL_MAX'] = '24';
    process.env['ASA_DB_STATEMENT_TIMEOUT_MS'] = '2000';
    const settings = poolSettings();
    expect(settings.max).toBe(24);
    expect(settings.statement_timeout).toBe(2000);
  });

  it('refuses a value that is not a positive integer instead of guessing', () => {
    process.env['ASA_DB_POOL_MAX'] = 'plenty';
    expect(() => poolSettings()).toThrow(/ASA_DB_POOL_MAX/);
    process.env['ASA_DB_POOL_MAX'] = '0';
    expect(() => poolSettings()).toThrow(/positive integer/);
  });
});
