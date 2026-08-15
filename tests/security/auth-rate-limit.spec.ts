import { afterEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { createApiApp } from '../../apps/api/src/app.factory.js';
import { FixedWindowRateLimiter } from '../../apps/api/src/rate-limit.js';

const WEB_ORIGIN = 'http://127.0.0.1:4610';
const apps: Array<Awaited<ReturnType<typeof createApiApp>>> = [];

afterEach(async () => {
  while (apps.length > 0) {
    await apps.pop()?.close();
  }
});

async function signInApp() {
  // No rows for any lookup: every attempt is a failed sign-in, which is exactly
  // the shape of a guessing run.
  const pool = {
    query: vi.fn(async () => ({ rows: [] })),
    end: vi.fn(async () => undefined),
  } as unknown as pg.Pool;
  const app = await createApiApp({ pool, webDist: null, allowedWebOrigin: WEB_ORIGIN });
  apps.push(app);
  return app.getHttpAdapter().getInstance();
}

type Fastify = Awaited<ReturnType<typeof signInApp>>;

function attempt(fastify: Fastify, identifier: string) {
  return fastify.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { host: '127.0.0.1:4611', origin: WEB_ORIGIN, 'content-type': 'application/json' },
    payload: { identifier, password: 'wrong-password' },
  });
}

describe('sign-in abuse ceiling', () => {
  it('answers 429 once one identifier is guessed too many times', async () => {
    const fastify = await signInApp();
    const identifier = 'target@example.test';

    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      statuses.push((await attempt(fastify, identifier)).statusCode);
    }

    // The identifier ceiling is ten attempts per window.
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);

    const blocked = await attempt(fastify, identifier);
    expect(blocked.json().error.code).toBe('too_many_attempts');
    expect(blocked.json().error.retryAfterSeconds).toBeGreaterThan(0);
  }, 30_000);

  it('keeps registration behind a ceiling as well', async () => {
    const fastify = await signInApp();

    const statuses: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { host: '127.0.0.1:4611', origin: WEB_ORIGIN, 'content-type': 'application/json' },
        payload: {
          email: `person-${i}@example.test`,
          password: 'Long-enough-password-1',
          username: `person${i}`,
          displayName: `Person ${i}`,
          birthDate: '1990-01-01',
          country: 'RU',
        },
      });
      statuses.push(response.statusCode);
    }

    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
  }, 30_000);
});

describe('rate limiter housekeeping', () => {
  it('forgets expired windows instead of growing without bound', () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter({ limit: 1, windowMs: 1000, now: () => now });

    for (let i = 0; i < 500; i += 1) {
      limiter.consume(`client-${i}`);
      now += 10;
    }
    const trackedWhileActive = limiter.size();
    expect(trackedWhileActive).toBeGreaterThan(0);

    now += 5000;
    limiter.consume('someone-else');
    expect(limiter.size()).toBe(1);
  });

  it('never exceeds its key cap even under a flood of distinct clients', () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter({
      limit: 5,
      windowMs: 60_000,
      maxKeys: 50,
      now: () => now,
    });

    for (let i = 0; i < 5000; i += 1) {
      limiter.consume(`client-${i}`);
      now += 1;
    }

    expect(limiter.size()).toBeLessThanOrEqual(50);
  });
});
