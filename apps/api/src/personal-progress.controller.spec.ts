import { describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { createDecipheriv, createHash } from 'node:crypto';
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

describe('SP-04 learner-only group rating API', () => {
  const peer = '55555555-5555-4555-8555-555555555555';
  const second = '66666666-6666-4666-8666-666666666666';
  const page = () => ({
    groupId: CLASS,
    periodDays: 30,
    version: 'a'.repeat(32),
    asOf: '2026-11-13T21:00:00Z',
    own: { availability: 'available', score: 68.25, rank: 101 },
    peers: [
      { seatId: peer, score: 83.46, rank: 2, avatarKey: 'asa-avatar-09', avatarId: null },
      { seatId: second, score: 83.46, rank: 2, avatarKey: null, avatarId: peer },
    ],
    hasMore: false,
    afterSeat: null,
    afterScore: null,
  });
  const avatarDataUrl = 'data:image/png;base64,' + Buffer.from('PNG').toString('base64');

  it('uses the real session context and exposes no peer ID, name, secret or teacher roster', async () => {
    const raw = page();
    const f = fixture(raw);
    const result = await f.controller.accountRating(REQUEST, CLASS);
    expect(f.query).toHaveBeenCalledExactlyOnceWith(
      'SELECT public.personal_progress_group_rating($1,$2,$3,$4,$5,$6,$7,$8) AS result',
      ['account', ACCOUNT, PRINCIPAL, hashSessionToken('account-token'), CLASS, null, null, 5],
    );
    expect(result.peers.map((x) => [x.score, x.rank])).toEqual([
      [83.46, 2],
      [83.46, 2],
    ]);
    expect(result.own).toEqual({
      availability: 'available',
      score: 68.25,
      rank: 101,
      isSelf: true,
    });
    expect(result.peers[0]!.avatarSrc).toBe('/assets/avatars/default/avatar-09.webp');
    expect(result.peers[1]!.avatarTicket).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(result.peers[0]!.isSelf).toBe(false);
    const json = JSON.stringify(result);
    for (const forbidden of [
      peer,
      second,
      'seatId',
      'avatarId',
      'avatarKey',
      'principalId',
      'displayName',
      'lastActiveAt',
      'studentCode',
      'grades',
      'factors',
      'teacherRoster',
      'totalWorks',
      'sources',
      'email',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('bounds preview pages and rejects arbitrary roster parameters before database read', async () => {
    const f = fixture({ ...page(), peers: [page().peers[0]] });
    await f.controller.accountRating(REQUEST, CLASS, { limit: '1', view: 'preview' });
    expect(f.query.mock.calls[0]?.[1]?.at(-1)).toBe(1);
    for (const query of [
      { limit: '200' },
      { limit: '0' },
      { limit: ['1'] },
      { view: 'all', limit: '5' },
      { classroomId: CLASS },
      { view: 'preview', cursor: 'old' },
    ]) {
      await expect(f.controller.accountRating(REQUEST, CLASS, query)).rejects.toMatchObject({
        status: 400,
      });
    }
    expect(f.query).toHaveBeenCalledTimes(1);
  });

  it('binds pagination to the exact session and rejects a changed calculation version', async () => {
    const first = {
      ...page(),
      peers: [
        ...Array.from({ length: 19 }, (_, i) => ({
          seatId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
          score: 83.46,
          rank: 2,
          avatarKey: null,
          avatarId: null,
        })),
        page().peers[0],
      ],
      hasMore: true,
      afterSeat: peer,
      afterScore: 83.46,
    };
    const f = fixture(first);
    const result = await f.controller.accountRating(REQUEST, CLASS, { view: 'all' });
    expect(result.nextCursor).toBeTypeOf('string');
    expect(Buffer.from(result.nextCursor!, 'base64url').toString('utf8')).not.toContain(peer);
    f.query.mockResolvedValue({ rows: [{ result: { ...page(), version: 'b'.repeat(32) } }] });
    await expect(
      f.controller.accountRating(REQUEST, CLASS, {
        view: 'all',
        cursor: result.nextCursor!,
      }),
    ).rejects.toMatchObject({
      status: 409,
      response: { error: { code: 'progress_rating_stale' } },
    });
    expect(f.query.mock.calls.at(-1)?.[1]?.slice(5, 7)).toEqual([83.46, peer]);
    const otherSession = {
      cookies: { asa_session: 'other-token', asa_student_session: 'seat-token' },
    } as unknown as FastifyRequest;
    await expect(
      f.controller.accountRating(otherSession, CLASS, {
        view: 'all',
        cursor: result.nextCursor!,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('requires an independent server secret, not just the actor-readable session cookie, for cursor and image ticket encryption', async () => {
    const raw = page();
    const last = {
      ...raw.peers[1]!,
      avatarId: peer,
    };
    const peers = [
      ...Array.from({ length: 19 }, (_, i) => ({
        seatId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        score: 83.46,
        rank: 2,
        avatarKey: null,
        avatarId: null,
      })),
      last,
    ];
    const f = fixture({
      ...raw,
      peers,
      hasMore: true,
      afterSeat: second,
      afterScore: 83.46,
    });
    const result = await f.controller.accountRating(REQUEST, CLASS, { view: 'all' });
    expect(result.nextCursor).toBeTypeOf('string');
    expect(result.peers[19]!.avatarTicket).toBeTypeOf('string');
    // A learner can inspect their own HTTP-only cookie via browser tooling.
    // Such a cookie must not be sufficient to derive a key that reveals
    // somebody else's private Seat UUID from an encrypted cursor or ticket.
    const actorDerivableKey = createHash('sha256')
      .update('asa:sp04:ticket:v1:' + hashSessionToken('account-token'))
      .digest();
    for (const ticket of [result.nextCursor!, result.peers[19]!.avatarTicket!]) {
      const bytes = Buffer.from(ticket, 'base64url');
      expect(bytes.length).toBeGreaterThan(28);
      expect(() => {
        const decrypt = createDecipheriv('aes-256-gcm', actorDerivableKey, bytes.subarray(0, 12));
        decrypt.setAuthTag(bytes.subarray(12, 28));
        return Buffer.concat([decrypt.update(bytes.subarray(28)), decrypt.final()]);
      }).toThrow();
    }
  });

  it.each(['hex', 'base64url'] as const)(
    'reopens encrypted peer image tickets after an API module restart using existing %s settings key',
    async (format) => {
      const originalKey = Buffer.from('b3'.repeat(32), 'hex');
      const settingsKey =
        format === 'hex' ? originalKey.toString('hex') : originalKey.toString('base64url');
      vi.stubEnv('ASA_SETTINGS_ENCRYPTION_KEY', settingsKey);
      vi.stubEnv('ASA_SP04_TICKET_SECRET', '');
      const newController = (Controller: typeof PersonalProgressController, data: unknown) => {
        const query = vi.fn(async () => ({ rows: [{ result: data }] }));
        const resolve = vi.fn(async () => ({ accountId: ACCOUNT, principalId: PRINCIPAL }));
        const resolveExistingState = vi.fn();
        return {
          query,
          controller: new Controller(
            { query } as unknown as pg.Pool,
            { resolve } as unknown as ActiveContextUseCase,
            { resolveExistingState } as unknown as SeatContextUseCase,
          ),
        };
      };
      try {
        vi.resetModules();
        const firstModule = await import('./personal-progress.controller.js');
        const first = newController(firstModule.PersonalProgressController, page());
        const firstPage = await first.controller.accountRating(REQUEST, CLASS);
        const imageTicket = firstPage.peers[1]!.avatarTicket!;
        expect(imageTicket).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(imageTicket).not.toContain(second);
        vi.resetModules();
        const secondModule = await import('./personal-progress.controller.js');
        const secondController = newController(secondModule.PersonalProgressController, [
          { seatId: second, dataUrl: avatarDataUrl },
        ]);
        const images = await secondController.controller.accountRatingAvatars(REQUEST, CLASS, {
          tickets: [imageTicket],
        });
        expect(images).toEqual({
          items: [{ ticket: imageTicket, dataUrl: avatarDataUrl }],
        });
        expect(secondController.query).toHaveBeenCalledTimes(1);
        // The same cookie with a rotated server-held settings key cannot
        // decrypt a ticket issued by the old replica/process.
        vi.stubEnv('ASA_SETTINGS_ENCRYPTION_KEY', 'c4'.repeat(32));
        vi.resetModules();
        const rotatedModule = await import('./personal-progress.controller.js');
        const rotated = newController(rotatedModule.PersonalProgressController, []);
        await expect(
          rotated.controller.accountRatingAvatars(REQUEST, CLASS, {
            tickets: [imageTicket],
          }),
        ).rejects.toMatchObject({ status: 400 });
        expect(rotated.query).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllEnvs();
        vi.resetModules();
      }
    },
  );

  it('does not expose custom avatar pixels except through an encrypted session ticket', async () => {
    const f = fixture(page());
    const rating = await f.controller.accountRating(REQUEST, CLASS);
    const ticket = rating.peers[1]!.avatarTicket!;
    f.query.mockResolvedValue({ rows: [{ result: [{ seatId: second, dataUrl: avatarDataUrl }] }] });
    const image = await f.controller.accountRatingAvatars(REQUEST, CLASS, { tickets: [ticket] });
    expect(image).toEqual({ items: [{ ticket, dataUrl: avatarDataUrl }] });
    expect(f.query.mock.calls.at(-1)?.[1]?.slice(4)).toEqual([CLASS, [second]]);
    await expect(
      f.controller.accountRatingAvatars(REQUEST, CLASS, {
        tickets: [Buffer.from(JSON.stringify([1, 'image', CLASS, second])).toString('base64url')],
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      f.controller.accountRatingAvatars(REQUEST, CLASS, {
        tickets: Array(21).fill(ticket),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      f.controller.accountRatingAvatars(REQUEST, CLASS, {
        tickets: [ticket, ticket],
      }),
    ).rejects.toMatchObject({ status: 400 });
    const otherSession = { cookies: { asa_session: 'new-session' } } as unknown as FastifyRequest;
    await expect(
      f.controller.accountRatingAvatars(otherSession, CLASS, { tickets: [ticket] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('checks Seat-only authority and does not fall back to Account session', async () => {
    const f = fixture(page());
    const result = await f.controller.seatRating(REQUEST, CLASS);
    expect(result.peers).toHaveLength(2);
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.resolveExistingState).toHaveBeenCalledWith('seat-token');
    expect(f.query.mock.calls[0]?.[1]?.slice(0, 5)).toEqual([
      'seat',
      SEAT,
      PRINCIPAL,
      hashSessionToken('seat-token'),
      CLASS,
    ]);
  });

  it.each(['P6S01', 'P6S02', 'P6S03'])(
    'translates database %s without revealing internal access details',
    async (code) => {
      const f = fixture(page());
      f.query.mockRejectedValue({ code, message: 'PRIVATE info about somebody else' });
      await expect(f.controller.accountRating(REQUEST, CLASS)).rejects.toMatchObject({
        status: code === 'P6S01' ? 401 : code === 'P6S02' ? 403 : 400,
      });
    },
  );
});
