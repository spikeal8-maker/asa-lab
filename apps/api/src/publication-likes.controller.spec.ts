import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { ModuleRegistry } from '@asa-lab/module-sdk';
import { PublicProjectsController } from './public-projects.controller.js';
import { SeatContextUseCase, STUDENT_SESSION_COOKIE } from './seat-context.js';
import { SESSION_COOKIE } from './tokens.js';
const ID = '11111111-1111-4111-8111-111111111111';
const REVISION = '22222222-2222-4222-8222-222222222222';
function fixture(cookies: Record<string, string> = { [SESSION_COOKIE]: 'account-token' }) {
  const resolve = vi.fn(async () => ({ principalId: ID }));
  const resolveExisting = vi.fn(async (token) => (token ? { principalId: REVISION } : null));
  const query = vi.fn(async (_sql: string, _values: unknown[]) => ({
    rows: [{ result: { liked: true } }],
  }));
  const api = new PublicProjectsController(
    { query } as unknown as pg.Pool,
    { resolve } as unknown as ActiveContextUseCase,
    {} as ModuleRegistry,
    { resolveExisting } as unknown as SeatContextUseCase,
  );
  return {
    api,
    query,
    resolve,
    resolveExisting,
    request: { cookies } as unknown as FastifyRequest,
  };
}
describe('publication likes transport', () => {
  it('binds Account and Seat requests to server-resolved principal and hashed session', async () => {
    const sessions: Record<string, string>[] = [
      { [SESSION_COOKIE]: 'account-token' },
      { [STUDENT_SESSION_COOKIE]: 'seat-token' },
    ];
    for (const cookies of sessions) {
      const f = fixture(cookies);
      await f.api.like(f.request, ID, { revisionId: REVISION, on: true });
      const values = f.query.mock.calls[0]![1] as unknown[];
      expect(values.slice(1, 4)).toEqual([ID, REVISION, true]);
      expect(values[4]).toMatch(/^[a-f0-9]{64}$/);
      if (STUDENT_SESSION_COOKIE in cookies) expect(f.resolve).not.toHaveBeenCalled();
    }
  });
  it('never falls back from an empty selected Seat cookie to a valid Account', async () => {
    const f = fixture({ [SESSION_COOKIE]: 'account-token', [STUDENT_SESSION_COOKIE]: '' });
    await expect(
      f.api.like(f.request, ID, { revisionId: REVISION, on: true }),
    ).rejects.toMatchObject({ status: 401 });
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.query).not.toHaveBeenCalled();
  });
  it.each([
    { revisionId: REVISION, on: 'yes' },
    { revisionId: 'bad', on: true },
    { revisionId: REVISION, on: true, actorId: ID },
  ])('rejects forged/malformed action %o', async (body) => {
    const f = fixture();
    await expect(f.api.like(f.request, ID, body)).rejects.toMatchObject({ status: 400 });
    expect(f.query).not.toHaveBeenCalled();
  });
  it.each([
    ['P5R01', 401],
    ['P5R02', 403],
    ['P5R03', 403],
    ['P5C02', 409],
    ['P5P04', 404],
  ])('maps %s without leaking database text', async (code, status) => {
    const f = fixture();
    f.query.mockRejectedValueOnce({ code, message: 'private-sql' });
    await expect(
      f.api.like(f.request, ID, { revisionId: REVISION, on: true }),
    ).rejects.toMatchObject({ status });
  });
});
