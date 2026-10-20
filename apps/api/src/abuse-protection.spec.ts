import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type {} from '@fastify/cookie';
import {
  createMutationSessionResolver,
  isAiMutationRoute,
  MutationAbuseProtection,
} from './abuse-protection.js';
import { SeatContextUseCase } from './seat-context.js';
import type pg from 'pg';

function request(session = 'session-a'): FastifyRequest {
  return {
    raw: { socket: { remoteAddress: '127.0.0.1' } },
    headers: { 'x-forwarded-for': '203.0.113.70' },
    cookies: { asa_session: session },
  } as unknown as FastifyRequest;
}

describe('MutationAbuseProtection', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.ASA_TRUSTED_PROXY_CIDRS;
  });
  it('stops a session that sustains more than the mutation ceiling', async () => {
    const protection = new MutationAbuseProtection();
    for (let attempt = 0; attempt < 600; attempt += 1) {
      expect((await protection.consume(request())).allowed).toBe(true);
    }
    expect((await protection.consume(request())).allowed).toBe(false);
  });

  it.each(['public', 'unknown-proxy'])(
    'admits 15 verified learner sessions behind one %s source without expanding any individual budget',
    async (mode) => {
      process.env.ASA_TRUSTED_PROXY_CIDRS = '172.16.0.0/12';
      const resolve = vi.fn(async (_kind, token) => token.startsWith('valid-'));
      const protection = new MutationAbuseProtection(resolve);
      function learner(index: number) {
        const candidate = request();
        candidate.cookies = { asa_student_session: `valid-${index}` };
        if (mode === 'unknown-proxy') {
          Object.assign(candidate.raw.socket, { remoteAddress: '172.21.0.4' });
          candidate.headers['x-forwarded-for'] = '172.21.0.1';
        }
        return candidate;
      }
      for (let round = 0; round < 600; round += 1) {
        for (let student = 0; student < 15; student += 1)
          expect((await protection.consume(learner(student))).allowed).toBe(true);
      }
      for (let student = 0; student < 15; student += 1)
        expect((await protection.consume(learner(student))).allowed).toBe(false);
      expect(resolve).toHaveBeenCalledTimes(15);
      expect(resolve.mock.calls.every(([kind]) => kind === 'student')).toBe(true);
      expect((await protection.consume(learner(16))).allowed).toBe(false);
    },
  );

  it('does not let rotating garbage cookies enlarge the anonymous ceiling or create an unbounded DB flood', async () => {
    const resolve = vi.fn(async () => false);
    const protection = new MutationAbuseProtection(resolve);
    for (let index = 0; index < 1100; index += 1)
      expect((await protection.consume(request(`garbage-${index}`))).allowed).toBe(index < 900);
    expect(resolve).toHaveBeenCalledTimes(60);
  });

  it('rechecks expired budget cache and never turns a revoked session into authentication authority', async () => {
    vi.useFakeTimers();
    let valid = true;
    const resolve = vi.fn(async () => valid);
    const protection = new MutationAbuseProtection(resolve);
    for (let index = 0; index < 900; index += 1)
      expect((await protection.consume(request(`warm-${index}`))).allowed).toBe(true);
    expect((await protection.consume(request('account-current'))).allowed).toBe(true);
    valid = false;
    // A bounded cached budget class does not bypass any route's session lookup.
    expect((await protection.consume(request('account-current'))).allowed).toBe(true);
    vi.advanceTimersByTime(30_001);
    expect((await protection.consume(request('account-current'))).allowed).toBe(false);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent validation and fails closed when the resolver fails', async () => {
    const resolve = vi.fn(async () => {
      throw new Error('database offline');
    });
    const protection = new MutationAbuseProtection(resolve);
    for (let index = 0; index < 900; index += 1) await protection.consume(request(`warm-${index}`));
    const decisions = await Promise.all(
      Array.from({ length: 15 }, () => protection.consume(request('one-cookie'))),
    );
    expect(decisions.every((value) => !value.allowed)).toBe(true);
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});

describe('AI mutation budget identity boundary', () => {
  const routes = [
    ['POST', '/api/ai/threads'],
    ['PATCH', '/api/ai/threads/:threadId'],
    ['DELETE', '/api/ai/threads/:threadId'],
    ['POST', '/api/ai/threads/:threadId/messages'],
    ['POST', '/api/ai/threads/:threadId/messages/stream'],
    ['POST', '/api/ai/threads/:threadId/requests/:requestId/stop'],
    ['PATCH', '/api/ai/threads/:threadId/archive'],
    ['POST', '/api/ai/threads/:threadId/regenerations/stream'],
    ['PUT', '/api/ai/classrooms/:classroomId/access'],
    ['PUT', '/api/admin/v1/ai'],
    ['POST', '/api/admin/v1/ai/test'],
    ['POST', '/api/ai/attachments'],
    ['PUT', '/api/ai/attachments/:uploadId/bytes'],
    ['DELETE', '/api/ai/attachments/:uploadId'],
    ['POST', '/api/ai/attachments/:uploadId/reconcile'],
  ];
  function aiRequest(method: string, route: string, token = 'seat-current') {
    const candidate = request();
    Object.assign(candidate, {
      cookies: { asa_student_session: token },
      method,
      routeOptions: { url: route } as FastifyRequest['routeOptions'],
    });
    return candidate;
  }
  async function saturateAddress(protection: MutationAbuseProtection) {
    for (let index = 0; index < 900; index += 1)
      expect((await protection.consume(request(`warm-${index}`))).allowed).toBe(true);
  }
  function authority(state: 'existing' | 'missing' | 'invalid') {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('classroom_student_session_context'))
        return {
          rows:
            state === 'invalid'
              ? []
              : [{ seat_id: 'seat', classroom_id: 'class', display_label: 'Ученик' }],
        };
      if (sql.includes('ai_student_principal_existing'))
        return {
          rows:
            state === 'existing'
              ? [{ principal_id: 'principal', tenant_id: 'tenant', classroom_id: 'class' }]
              : [],
        };
      throw new Error(`Unexpected identity write: ${sql}`);
    });
    const seats = new SeatContextUseCase({ query } as unknown as pg.Pool);
    const initialize = vi.spyOn(seats, 'resolve');
    const accounts = { resolve: vi.fn(async () => ({ accountId: 'unrelated-account' })) };
    return { query, initialize, seats, accounts };
  }

  it.each(routes)(
    'uses existing-only Seat proof after 900 requests for %s %s',
    async (method, route) => {
      const { query, initialize, seats, accounts } = authority('existing');
      const protection = new MutationAbuseProtection(
        createMutationSessionResolver(accounts, seats),
      );
      await saturateAddress(protection);
      expect((await protection.consume(aiRequest(method!, route!))).allowed).toBe(true);
      expect(query.mock.calls.map(([sql]) => sql)).toEqual([
        expect.stringContaining('classroom_student_session_context'),
        expect.stringContaining('ai_student_principal_existing'),
      ]);
      expect(initialize).not.toHaveBeenCalled();
      expect(accounts.resolve).not.toHaveBeenCalled();
    },
  );

  it.each(['missing', 'invalid'] as const)(
    'rejects saturated %s Seat without initializer or Account fallback',
    async (state) => {
      const { query, initialize, seats, accounts } = authority(state);
      const protection = new MutationAbuseProtection(
        createMutationSessionResolver(accounts, seats),
      );
      await saturateAddress(protection);
      const candidate = aiRequest('POST', '/api/ai/threads/:threadId/messages/stream');
      // The global HTTP conflict guard rejects these two cookies even earlier;
      // this lower-level proof must itself never choose the retained Account.
      candidate.cookies.asa_session = 'retained-account';
      expect((await protection.consume(candidate)).allowed).toBe(false);
      expect(query.mock.calls).toHaveLength(state === 'missing' ? 2 : 1);
      expect(query.mock.calls.every(([sql]) => sql.trim().startsWith('SELECT'))).toBe(true);
      expect(initialize).not.toHaveBeenCalled();
      expect(accounts.resolve).not.toHaveBeenCalled();
    },
  );

  it('keeps Account and non-AI Seat resolution unchanged and ignores forged URL/header prefixes', async () => {
    const accounts = { resolve: vi.fn(async () => ({ accountId: 'account' })) };
    const seats = {
      resolve: vi.fn(async () => ({ principalId: 'legacy-seat' })),
      resolveExisting: vi.fn(async () => null),
    };
    const resolve = createMutationSessionResolver(accounts, seats);
    const ordinary = aiRequest('POST', '/api/projects');
    ordinary.raw.url = '/api/ai/threads';
    ordinary.headers['x-original-url'] = '/api/ai/threads';
    expect(isAiMutationRoute(ordinary)).toBe(false);
    expect(await resolve('student', 'seat-current', ordinary)).toBe(true);
    expect(seats.resolve).toHaveBeenCalledWith('seat-current');
    expect(seats.resolveExisting).not.toHaveBeenCalled();
    const personal = aiRequest('POST', '/api/ai/threads');
    personal.cookies = { asa_session: 'personal' };
    expect(await resolve('account', 'personal', personal)).toBe(true);
    expect(accounts.resolve).toHaveBeenCalledWith('personal');
    expect(isAiMutationRoute(aiRequest('GET', '/api/ai/threads'))).toBe(false);
    expect(isAiMutationRoute(aiRequest('POST', '/api/ai/threads/unregistered'))).toBe(false);
  });
});

describe('mutation proof cache policy and credential isolation', () => {
  function candidate(ai: boolean, cookies: FastifyRequest['cookies']) {
    const value = request();
    Object.assign(value, {
      cookies,
      method: 'POST',
      routeOptions: {
        url: ai ? '/api/ai/threads' : '/api/diagnostics/client',
      } as FastifyRequest['routeOptions'],
    });
    return value;
  }
  function fixture(now?: () => number) {
    const accounts = {
      resolve: vi.fn<(token: string | undefined) => Promise<unknown>>(async () => ({
        accountId: 'account',
      })),
    };
    const seats = {
      resolve: vi.fn<(token: string | undefined) => Promise<unknown>>(async () => ({
        principalId: 'legacy',
      })),
      resolveExisting: vi.fn<(token: string | undefined) => Promise<unknown>>(async () => ({
        principalId: 'existing',
      })),
    };
    const protection = new MutationAbuseProtection(
      createMutationSessionResolver(accounts, seats),
      now,
    );
    return { protection, accounts, seats };
  }
  async function saturate(protection: MutationAbuseProtection) {
    for (let index = 0; index < 900; index += 1)
      expect((await protection.consume(candidate(false, {}))).allowed).toBe(true);
  }
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  it.each(['', 'invalid-seat'])(
    'does not substitute cached Account proof for an explicitly present %j Seat cookie',
    async (seatToken) => {
      const f = fixture();
      f.seats.resolveExisting.mockResolvedValue(null);
      await saturate(f.protection);
      const account = { asa_session: 'retained-account' };
      expect((await f.protection.consume(candidate(false, account))).allowed).toBe(true);
      // Account-only AI has the same actual resolver and can reuse this proof.
      expect((await f.protection.consume(candidate(true, account))).allowed).toBe(true);
      expect(f.accounts.resolve).toHaveBeenCalledExactlyOnceWith('retained-account');
      expect(
        (
          await f.protection.consume(
            candidate(true, { ...account, asa_student_session: seatToken }),
          )
        ).allowed,
      ).toBe(false);
      expect(f.seats.resolveExisting).toHaveBeenCalledExactlyOnceWith(seatToken);
      expect(f.accounts.resolve).toHaveBeenCalledTimes(1);
      expect(f.seats.resolve).not.toHaveBeenCalled();
      expect((await f.protection.consume(candidate(false, account))).allowed).toBe(true);
      expect(f.accounts.resolve).toHaveBeenCalledTimes(1);
    },
  );

  it('does not poison an Account proof with the negative result of an empty retained Seat cookie', async () => {
    const f = fixture();
    f.seats.resolveExisting.mockResolvedValue(null);
    await saturate(f.protection);
    expect(
      (
        await f.protection.consume(
          candidate(true, { asa_session: 'retained-account', asa_student_session: '' }),
        )
      ).allowed,
    ).toBe(false);
    expect(
      (await f.protection.consume(candidate(false, { asa_session: 'retained-account' }))).allowed,
    ).toBe(true);
    expect(f.seats.resolveExisting).toHaveBeenCalledExactlyOnceWith('');
    expect(f.accounts.resolve).toHaveBeenCalledExactlyOnceWith('retained-account');
  });

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])(
    'separates Seat cache hits for first AI=%s, first valid=%s in both directions',
    async (firstAi, firstValid) => {
      const f = fixture();
      await saturate(f.protection);
      f.seats.resolveExisting.mockResolvedValue(
        (firstAi ? firstValid : !firstValid) ? { principalId: 'existing' } : null,
      );
      f.seats.resolve.mockResolvedValue(
        (firstAi ? !firstValid : firstValid) ? { principalId: 'legacy' } : null,
      );
      const cookies = { asa_student_session: 'same-seat-token' };
      for (let repeat = 0; repeat < 2; repeat += 1) {
        expect((await f.protection.consume(candidate(firstAi!, cookies))).allowed).toBe(firstValid);
        expect((await f.protection.consume(candidate(!firstAi, cookies))).allowed).toBe(
          !firstValid,
        );
      }
      expect(f.seats.resolveExisting).toHaveBeenCalledExactlyOnceWith('same-seat-token');
      expect(f.seats.resolve).toHaveBeenCalledExactlyOnceWith('same-seat-token');
      expect(f.accounts.resolve).not.toHaveBeenCalled();
    },
  );

  it('keys the proof by the selected Seat token, independently of a retained Account partition key', async () => {
    const f = fixture();
    await saturate(f.protection);
    f.seats.resolveExisting.mockImplementation(async (token) =>
      token === 'valid-seat' ? { principalId: 'existing' } : null,
    );
    // The HTTP mixed-cookie hook rejects nonempty pairs earlier. This lower
    // boundary must still key its own selected credential correctly.
    expect(
      (
        await f.protection.consume(
          candidate(true, { asa_session: 'retained', asa_student_session: 'invalid-seat' }),
        )
      ).allowed,
    ).toBe(false);
    expect(
      (
        await f.protection.consume(
          candidate(true, { asa_session: 'retained', asa_student_session: 'valid-seat' }),
        )
      ).allowed,
    ).toBe(true);
    expect(
      (
        await f.protection.consume(
          candidate(true, { asa_session: 'different-retained', asa_student_session: 'valid-seat' }),
        )
      ).allowed,
    ).toBe(true);
    expect(f.seats.resolveExisting.mock.calls).toEqual([['invalid-seat'], ['valid-seat']]);
    expect(f.accounts.resolve).not.toHaveBeenCalled();
    expect(f.seats.resolve).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'does not join pending work from a different Seat resolver (first AI=%s)',
    async (firstAi) => {
      const f = fixture(),
        started = deferred(),
        release = deferred();
      await saturate(f.protection);
      const slow = firstAi ? f.seats.resolveExisting : f.seats.resolve;
      const fast = firstAi ? f.seats.resolve : f.seats.resolveExisting;
      slow.mockImplementation(async () => {
        started.resolve();
        await release.promise;
        return { principalId: 'slow' };
      });
      fast.mockResolvedValue(null);
      const cookies = { asa_student_session: 'concurrent-seat' };
      const pending = f.protection.consume(candidate(firstAi, cookies));
      await started.promise;
      const independent = f.protection.consume(candidate(!firstAi, cookies));
      try {
        await vi.waitFor(() => expect(fast).toHaveBeenCalledExactlyOnceWith('concurrent-seat'));
        expect((await independent).allowed).toBe(false);
        expect(slow).toHaveBeenCalledTimes(1);
      } finally {
        release.resolve();
        await Promise.allSettled([pending, independent]);
      }
      expect((await pending).allowed).toBe(true);
    },
  );

  it.each([true, false])(
    'does not join a pending Account/empty-Seat proof in either direction (first AI=%s)',
    async (firstAi) => {
      const f = fixture(),
        started = deferred(),
        release = deferred();
      await saturate(f.protection);
      const slow = firstAi ? f.seats.resolveExisting : f.accounts.resolve;
      const fast = firstAi ? f.accounts.resolve : f.seats.resolveExisting;
      slow.mockImplementation(async () => {
        started.resolve();
        await release.promise;
        return firstAi ? null : { accountId: 'account' };
      });
      if (!firstAi) f.seats.resolveExisting.mockResolvedValue(null);
      const ai = candidate(true, { asa_session: 'retained', asa_student_session: '' });
      const ordinary = candidate(false, { asa_session: 'retained' });
      const pending = f.protection.consume(firstAi ? ai : ordinary);
      await started.promise;
      const independent = f.protection.consume(firstAi ? ordinary : ai);
      try {
        await vi.waitFor(() =>
          expect(fast).toHaveBeenCalledExactlyOnceWith(firstAi ? 'retained' : ''),
        );
        expect((await independent).allowed).toBe(firstAi);
      } finally {
        release.resolve();
        await Promise.allSettled([pending, independent]);
      }
      expect((await pending).allowed).toBe(!firstAi);
      expect(f.seats.resolve).not.toHaveBeenCalled();
    },
  );

  it('coalesces one existing-only proof across registered AI routes and retains its cached result', async () => {
    const f = fixture(),
      started = deferred(),
      release = deferred();
    await saturate(f.protection);
    f.seats.resolveExisting.mockImplementation(async () => {
      started.resolve();
      await release.promise;
      return { principalId: 'existing' };
    });
    const first = candidate(true, { asa_student_session: 'same-seat' });
    const other = candidate(true, first.cookies);
    Object.assign(other, {
      routeOptions: { url: '/api/admin/v1/ai/test' } as FastifyRequest['routeOptions'],
    });
    const pending = f.protection.consume(first);
    await started.promise;
    const joined = f.protection.consume(other);
    release.resolve();
    expect((await Promise.all([pending, joined])).every((result) => result.allowed)).toBe(true);
    expect((await f.protection.consume(other)).allowed).toBe(true);
    expect(f.seats.resolveExisting).toHaveBeenCalledExactlyOnceWith('same-seat');
  });

  it('shares the unchanged 600-request budget across AI and non-AI proof domains', async () => {
    const f = fixture();
    await saturate(f.protection);
    const cookies = { asa_student_session: 'one-budget' };
    for (let index = 0; index < 600; index += 1)
      expect((await f.protection.consume(candidate(index % 2 === 0, cookies))).allowed).toBe(true);
    expect((await f.protection.consume(candidate(true, cookies))).allowed).toBe(false);
    expect((await f.protection.consume(candidate(false, cookies))).allowed).toBe(false);
    expect(f.seats.resolveExisting).toHaveBeenCalledTimes(1);
    expect(f.seats.resolve).toHaveBeenCalledTimes(1);
  });

  it('shares the same 60-per-address proof-work ceiling across all policy domains', async () => {
    const f = fixture();
    await saturate(f.protection);
    for (let index = 0; index < 80; index += 1) {
      const cookies: Record<string, string> =
        index % 3 === 0
          ? { asa_session: `account-${index}` }
          : { asa_student_session: `seat-${index}` };
      expect((await f.protection.consume(candidate(index % 2 === 0, cookies))).allowed).toBe(
        index < 60,
      );
    }
    expect(
      f.accounts.resolve.mock.calls.length +
        f.seats.resolve.mock.calls.length +
        f.seats.resolveExisting.mock.calls.length,
    ).toBe(60);
  });

  it('keeps the negative 5-second TTL distinct without evicting an independent positive legacy proof', async () => {
    let now = 0;
    const f = fixture(() => now);
    f.seats.resolveExisting.mockResolvedValue(null);
    await saturate(f.protection);
    const cookies = { asa_student_session: 'same-seat' };
    expect((await f.protection.consume(candidate(true, cookies))).allowed).toBe(false);
    expect((await f.protection.consume(candidate(false, cookies))).allowed).toBe(true);
    f.seats.resolveExisting.mockResolvedValue({ principalId: 'now-existing' });
    now = 4999;
    expect((await f.protection.consume(candidate(true, cookies))).allowed).toBe(false);
    now = 5001;
    expect((await f.protection.consume(candidate(true, cookies))).allowed).toBe(true);
    expect((await f.protection.consume(candidate(false, cookies))).allowed).toBe(true);
    expect(f.seats.resolveExisting).toHaveBeenCalledTimes(2);
    expect(f.seats.resolve).toHaveBeenCalledTimes(1);
  });

  it('applies the existing token-size proof-work bound to the actually selected Seat credential', async () => {
    const f = fixture();
    await saturate(f.protection);
    expect(
      (
        await f.protection.consume(
          candidate(true, { asa_session: 'short-retained', asa_student_session: 'x'.repeat(2049) }),
        )
      ).allowed,
    ).toBe(false);
    expect(f.accounts.resolve).not.toHaveBeenCalled();
    expect(f.seats.resolve).not.toHaveBeenCalled();
    expect(f.seats.resolveExisting).not.toHaveBeenCalled();
  });
});
