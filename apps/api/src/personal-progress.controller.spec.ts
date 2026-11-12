import { describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import type pg from 'pg';
import type { FastifyRequest } from 'fastify';
import { hashSessionToken, type ActiveContextUseCase } from '@asa-lab/identity';
import type { ProgressScopeV1 } from '@asa-lab/contracts';
import type { SeatContextUseCase } from './seat-context.js';
import { PersonalProgressController } from './personal-progress.controller.js';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const PRINCIPAL = '22222222-2222-4222-8222-222222222222';
const SEAT = '33333333-3333-4333-8333-333333333333';
const CLASS = '44444444-4444-4444-8444-444444444444';
const SCOPE: ProgressScopeV1 = { kind: 'account', accountId: ACCOUNT };
const REQUEST = {
  cookies: { asa_session: 'account-token', asa_student_session: 'seat-token' },
} as unknown as FastifyRequest;

function result(scope: ProgressScopeV1 = SCOPE) {
  return {
    scope,
    asOf: '2026-11-12T06:00:00Z',
    availability: 'available',
    metrics: {
      everPublishedWorks: { availability: 'available', value: 0 },
      currentLikes: { availability: 'available', value: 0 },
      createdCopies: { availability: 'available', value: 0 },
      activePublicWorks: { availability: 'available', value: 0 },
    },
    coverage: {
      everPublishedWorks: {
        basis: 'confirmed_publication_revisions',
        completeness: 'unknown',
        knownSince: null,
        limitations: ['history_before_canonical_records_unknown'],
      },
      currentLikes: {
        basis: 'current_publication_likes',
        completeness: 'complete',
        knownSince: null,
        limitations: [],
      },
      createdCopies: {
        basis: 'durable_publication_copy_receipts',
        completeness: 'unknown',
        knownSince: null,
        limitations: [
          'history_before_canonical_records_unknown',
          'copies_not_supported_by_all_modules',
        ],
      },
      activePublicWorks: {
        basis: 'current_catalog_visibility',
        completeness: 'complete',
        knownSince: null,
        limitations: [],
      },
    },
    personalRating: { availability: 'not_enabled', value: null },
    groups: {
      availability: 'available',
      items: [] as unknown[],
      hasMore: false,
      nextGroupId: null as string | null,
    },
  };
}

function fixture(data: unknown = result(), connected = true) {
  const query = vi.fn(async (sql: string, values: unknown[]) => {
    void sql;
    void values;
    return { rows: [{ result: data }] };
  });
  const resolve = vi.fn(async () => ({ accountId: ACCOUNT, principalId: PRINCIPAL }));
  const resolveExistingState = vi.fn(async (): Promise<unknown> => ({
    state: 'resolved',
    context: { seatId: SEAT, classroomId: CLASS, principalId: PRINCIPAL },
  }));
  return {
    query,
    resolve,
    resolveExistingState,
    controller: new PersonalProgressController(
      connected ? ({ query } as unknown as pg.Pool) : null,
      { resolve } as unknown as ActiveContextUseCase,
      { resolveExistingState } as unknown as SeatContextUseCase,
    ),
  };
}

describe('own progress authorization and explicit transport', () => {
  it('keeps an unavailable counter null while preserving confirmed zero and honest partial state', async () => {
    const data = result();
    const summary = await fixture({
      ...data,
      availability: 'partial',
      metrics: {
        ...data.metrics,
        currentLikes: { availability: 'unavailable', value: null, reason: 'source_unavailable' },
      },
    }).controller.account(REQUEST);
    expect(summary.availability).toBe('partial');
    expect(summary.metrics.currentLikes).toEqual({
      availability: 'unavailable',
      value: null,
      reason: 'source_unavailable',
    });
    expect(summary.metrics.everPublishedWorks).toEqual({ availability: 'available', value: 0 });
  });

  it('binds Account to the server resolver and hashed session, never to query owner IDs', async () => {
    const f = fixture();
    const summary = await f.controller.account(REQUEST);
    expect(f.query).toHaveBeenCalledExactlyOnceWith(
      'SELECT public.personal_progress_summary($1,$2,$3,$4,$5) AS result',
      ['account', ACCOUNT, PRINCIPAL, hashSessionToken('account-token'), null],
    );
    expect(f.resolveExistingState).not.toHaveBeenCalled();
    expect(summary.metrics.everPublishedWorks).toEqual({ availability: 'available', value: 0 });
    expect(summary.availability).toBe('available');
    expect(summary.personalRating).toEqual({ availability: 'not_enabled', value: null });
    expect(summary.coverage.everPublishedWorks.knownSince).toBeNull();
    await expect(f.controller.account(REQUEST, { accountId: SEAT })).rejects.toMatchObject({
      status: 400,
    });
    expect(f.query).toHaveBeenCalledTimes(1);
  });

  it('uses only the existing Seat resolver and its exact owner without Account fallback', async () => {
    const f = fixture(result({ kind: 'seat', seatId: SEAT, classroomId: CLASS }));
    const summary = await f.controller.seat(REQUEST);
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.resolveExistingState).toHaveBeenCalledExactlyOnceWith('seat-token');
    expect(f.query.mock.calls[0]).toEqual([
      'SELECT public.personal_progress_summary($1,$2,$3,$4,$5) AS result',
      ['seat', SEAT, PRINCIPAL, hashSessionToken('seat-token'), null],
    ]);
    expect(summary.scope).toEqual({ kind: 'seat', seatId: SEAT, classroomId: CLASS });
  });

  it.each(['account', 'seat'] as const)(
    'reports missing database before %s resolution',
    async (route) => {
      const f = fixture(undefined, false);
      await expect(f.controller[route](REQUEST)).rejects.toMatchObject({
        status: 503,
        response: { error: { code: 'database_unavailable' } },
      });
      expect(f.resolve).not.toHaveBeenCalled();
      expect(f.resolveExistingState).not.toHaveBeenCalled();
    },
  );

  it.each(['account', 'seat'] as const)(
    'sanitizes an infrastructure rejection from the %s resolver as unavailable',
    async (route) => {
      const f = fixture();
      const resolver = route === 'account' ? f.resolve : f.resolveExistingState;
      resolver.mockRejectedValue(new Error('PRIVATE SQL owner@example.test connection failed'));
      await expect(f.controller[route](REQUEST)).rejects.toMatchObject({
        status: 503,
        response: { error: { code: 'progress_unavailable', message: 'Сводка сейчас недоступна.' } },
      });
      expect(f.query).not.toHaveBeenCalled();
      expect(route === 'account' ? f.resolveExistingState : f.resolve).not.toHaveBeenCalled();
    },
  );

  it.each(['account', 'seat'] as const)(
    'preserves an intentional HttpException from the %s resolver',
    async (route) => {
      const f = fixture();
      const failure = new HttpException({ error: { code: 'unauthorized' } }, 401);
      (route === 'account' ? f.resolve : f.resolveExistingState).mockRejectedValue(failure);
      await expect(f.controller[route](REQUEST)).rejects.toBe(failure);
      expect(f.query).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['invalid_session', 401, 'unauthorized'],
    ['unavailable_owner', 403, 'progress_owner_unavailable'],
  ] as const)(
    'keeps Seat %s distinct without reading or materializing',
    async (state, status, code) => {
      const f = fixture();
      f.resolveExistingState.mockResolvedValue({ state });
      await expect(f.controller.seat(REQUEST)).rejects.toMatchObject({
        status,
        response: { error: { code } },
      });
      expect(f.query).not.toHaveBeenCalled();
      expect(f.resolve).not.toHaveBeenCalled();
    },
  );

  it('does not fall back from missing or empty Seat cookie to a valid Account cookie', async () => {
    for (const cookies of [
      { asa_session: 'account-token' },
      { asa_session: 'account-token', asa_student_session: '' },
    ]) {
      const f = fixture();
      await expect(
        f.controller.seat({ cookies } as unknown as FastifyRequest),
      ).rejects.toMatchObject({ status: 401 });
      expect(f.resolve).not.toHaveBeenCalled();
      expect(f.query).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['P6S01', 401, 'unauthorized'],
    ['P6S02', 403, 'progress_owner_unavailable'],
    ['57014', 503, 'progress_unavailable'],
  ] as const)(
    'maps SQL revalidation %s without exposing database details',
    async (sqlCode, status, code) => {
      const f = fixture();
      f.query.mockRejectedValue({ code: sqlCode, message: 'PRIVATE SQL owner@example.test' });
      await expect(f.controller.account(REQUEST)).rejects.toMatchObject({
        status,
        response: { error: { code } },
      });
    },
  );

  it('allowlists fields and preserves canonical fractional, zero and null results', async () => {
    const data = result();
    data.groups.items = [18.37, 0, null].map((score, i) => ({
      groupId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      title: `Group ${i}`,
      periodDays: [7, 30, 90][i],
      own: {
        availability: 'available',
        score,
        rank: score === null ? null : 1,
        grades: ['PRIVATE'],
      },
      studentCode: 'PRIVATE',
      peers: ['PRIVATE'],
    }));
    const f = fixture({ ...data, identityLinks: ['PRIVATE'], privateProjects: ['PRIVATE'] });
    const summary = await f.controller.account(REQUEST);
    expect(summary.groups.items?.map((item) => item.own.score)).toEqual([18.37, 0, null]);
    expect(summary.availability).toBe('available');
    expect(JSON.stringify(summary)).not.toContain('PRIVATE');
    expect(summary.groups.nextCursor).toBeNull();
    expect(summary.groups).not.toHaveProperty('nextGroupId');
  });

  it('represents ambiguous own participation as partial, not a chosen score', async () => {
    const data = result();
    data.availability = 'partial';
    data.groups.availability = 'partial';
    data.groups.items = [
      {
        groupId: CLASS,
        title: 'Group',
        periodDays: 30,
        own: {
          availability: 'unavailable',
          score: null,
          rank: null,
          reason: 'ambiguous_self_participant',
        },
      },
    ];
    const summary = await fixture(data).controller.account(REQUEST);
    expect(summary.availability).toBe('partial');
    expect(summary.groups.items?.[0]?.own).toEqual({
      availability: 'unavailable',
      score: null,
      rank: null,
      reason: 'ambiguous_self_participant',
    });
  });

  it('binds an opaque continuation to the current scope and preserves whole-owner counters', async () => {
    const data = result();
    data.groups.items = Array.from({ length: 20 }, (_, i) => ({
      groupId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      title: `Group ${i}`,
      periodDays: 30,
      own: { availability: 'available', score: 0, rank: 1 },
    }));
    data.groups.hasMore = true;
    data.groups.nextGroupId = '00000000-0000-4000-8000-000000000020';
    const f = fixture(data);
    const first = await f.controller.account(REQUEST);
    expect(first.groups.nextCursor).toEqual(expect.any(String));
    const second = await f.controller.account(REQUEST, { cursor: first.groups.nextCursor });
    expect(f.query.mock.calls[1]?.[1]).toEqual([
      'account',
      ACCOUNT,
      PRINCIPAL,
      hashSessionToken('account-token'),
      data.groups.nextGroupId,
    ]);
    expect(second.metrics).toEqual(first.metrics);
    await expect(
      f.controller.seat(REQUEST, { cursor: first.groups.nextCursor }),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.query).toHaveBeenCalledTimes(2);
  });

  it.each([
    { cursor: '' },
    { cursor: 'invalid' },
    { cursor: ['value'] },
    { cursor: 'x'.repeat(257) },
    { groupId: CLASS },
    { periodDays: '7' },
  ])('rejects unsupported or malformed page input %o', async (query) => {
    const f = fixture();
    await expect(f.controller.account(REQUEST, query)).rejects.toMatchObject({ status: 400 });
    expect(f.query).not.toHaveBeenCalled();
  });

  it('rejects a different SQL scope or invalid numeric result instead of displaying zero', async () => {
    const wrong = result({ kind: 'account', accountId: SEAT });
    await expect(fixture(wrong).controller.account(REQUEST)).rejects.toMatchObject({ status: 503 });
    const data = result();
    data.metrics.currentLikes.value = Number.MAX_SAFE_INTEGER + 1;
    await expect(fixture(data).controller.account(REQUEST)).rejects.toMatchObject({ status: 503 });
    await expect(fixture(null).controller.account(REQUEST)).rejects.toMatchObject({ status: 503 });
  });
});
