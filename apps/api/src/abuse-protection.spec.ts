import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { MutationAbuseProtection } from './abuse-protection.js';

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
          candidate.raw.socket.remoteAddress = '172.21.0.4';
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
