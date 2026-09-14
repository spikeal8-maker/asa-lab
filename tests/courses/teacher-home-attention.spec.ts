import { afterEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { FastifyRequest } from 'fastify';
import { ClassroomsController } from '../../apps/api/src/classrooms.controller';
import { teacherHomeAttention } from '../../apps/api/src/teacher-home-attention';
import type { Classroom } from '@asa-lab/classroom';

function controller(authenticated = true, educator = true) {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const list = vi.fn().mockResolvedValue([]);
  const args = [
    { resolve: vi.fn().mockResolvedValue(authenticated ? { accountId: 'actor-account' } : null) },
    {
      capabilities: vi
        .fn()
        .mockResolvedValue(educator ? [{ capability: 'educator', state: 'verified' }] : []),
    },
    {},
    {},
    { execute: list },
    { query },
  ] as unknown as ConstructorParameters<typeof ClassroomsController>;
  return { value: new ClassroomsController(...args), query, list };
}
const request = {
  cookies: { asa_session: 'session' },
  query: { accountId: 'foreign' },
} as unknown as FastifyRequest;

afterEach(() => vi.unstubAllEnvs());

describe('Teacher Home read boundary', () => {
  it.each([
    [false, true, 401],
    [true, false, 403],
  ])(
    'rejects unauthorized actors before reading data (%s, %s)',
    async (authenticated, educator, status) => {
      const target = controller(Boolean(authenticated), Boolean(educator));
      await expect(target.value.homeAttention(request)).rejects.toMatchObject({ status });
      expect(target.query).not.toHaveBeenCalled();
      expect(target.list).not.toHaveBeenCalled();
    },
  );

  it('uses the authenticated account and returns an empty canonical projection with constant queries', async () => {
    const target = controller();
    expect(await target.value.homeAttention(request)).toEqual({
      reviews: [],
      classrooms: [],
      joinRequests: [],
      joinRequestsMayBeLimited: false,
    });
    expect(target.list).toHaveBeenCalledWith('actor-account');
    expect(target.query).toHaveBeenCalledTimes(2);
    expect(target.query.mock.calls.every((call) => call[1][0] === 'actor-account')).toBe(true);
    expect(
      target.query.mock.calls.every((call) => !/INSERT|UPDATE|DELETE|notifications/i.test(call[0])),
    ).toBe(true);
  });

  it('refuses an unavailable canonical projection without falling back to notification or legacy counts', async () => {
    vi.stubEnv('LEARNING_CANONICAL_READS', 'legacy');
    const target = controller();
    await expect(target.value.homeAttention(request)).rejects.toMatchObject({
      status: 503,
      response: { error: { code: 'canonical_projection_unavailable' } },
    });
    expect(target.query).not.toHaveBeenCalled();
  });

  it('does not claim the capped existing join history is a complete pending count', async () => {
    const query = vi.fn(async (sql: string) => ({
      rows: sql.includes('canonical_evidence')
        ? []
        : Array.from({ length: 200 }, (_, n) => ({
            kind: 'request',
            classroom_id: 'class',
            detail: { id: String(n), status: 'approved' },
          })),
    }));
    const result = await teacherHomeAttention({ query } as unknown as pg.Pool, 'actor', [
      { id: 'class', status: 'active', title: 'Class' },
    ] as Classroom[]);
    expect(result).toMatchObject({ joinRequests: [], joinRequestsMayBeLimited: true });
    expect(query).toHaveBeenCalledTimes(2);
  });
});
