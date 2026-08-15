import { afterEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { createApiApp } from '../../apps/api/src/app.factory.js';
import {
  LOGIN_PER_ADDRESS,
  LOGIN_PER_IDENTIFIER,
  LOGIN_WINDOW_MS,
  REGISTER_PER_ADDRESS,
  REGISTER_WINDOW_MS,
} from '../../apps/api/src/auth.controller.js';
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

  it('does not punish a whole class for sharing one address', async () => {
    const fastify = await signInApp();

    // A class signs in from one NAT address. Every learner uses their own
    // identifier, so nothing here looks like guessing — and nothing may be
    // refused. Getting this wrong locks out the room, not the attacker.
    const statuses: number[] = [];
    for (let seat = 0; seat < 30; seat += 1) {
      statuses.push((await attempt(fastify, `learner-${seat}@school.test`)).statusCode);
    }

    expect(statuses.every((status) => status === 401)).toBe(true);
  }, 60_000);
});

describe('ceilings are sized for a school, not a single household', () => {
  it('lets a full class sign in and retry from one address', () => {
    const CLASS_SIZE = 30;
    const RETRIES_PER_LEARNER = 4;
    expect(LOGIN_PER_ADDRESS).toBeGreaterThanOrEqual(CLASS_SIZE * RETRIES_PER_LEARNER);
  });

  it('still stops guessing at one identifier long before that', () => {
    expect(LOGIN_PER_IDENTIFIER).toBeLessThan(LOGIN_PER_ADDRESS / 4);
  });

  it('lets a staff room register without tripping the ceiling', () => {
    expect(REGISTER_PER_ADDRESS).toBeGreaterThanOrEqual(30);
  });

  it('keeps the worst case a client can buy down to a slice of one thread', () => {
    const HASH_COST_MS = 27;
    const loginCpuShare = (LOGIN_PER_ADDRESS * HASH_COST_MS) / LOGIN_WINDOW_MS;
    const registerCpuShare = (REGISTER_PER_ADDRESS * HASH_COST_MS) / REGISTER_WINDOW_MS;
    expect(loginCpuShare).toBeLessThan(0.05);
    expect(registerCpuShare).toBeLessThan(0.05);
  });
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
