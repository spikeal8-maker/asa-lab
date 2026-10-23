import { afterEach, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { MutationAbuseProtection } from './abuse-protection.js';
import {
  noteAuthoritativeMutationSession,
  requestMutationAdmission,
} from './mutation-session-proof.js';

function request(token?: string): FastifyRequest {
  return {
    raw: { socket: { remoteAddress: '127.0.0.1' } },
    headers: {},
    cookies: token ? { asa_student_session: token } : {},
    method: 'PUT',
    routeOptions: { url: '/api/projects/:projectId/draft' },
  } as unknown as FastifyRequest;
}
afterEach(() => vi.useRealTimers());

it('rechecks 60 known pupils after the 30-second TTL without exhausting unknown-IP proof work', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const resolve = vi.fn(async () => true);
  const protection = new MutationAbuseProtection(resolve);
  for (let n = 0; n < 900; n++) await protection.consume(request());
  const first = await Promise.all(
    Array.from({ length: 60 }, (_, i) => protection.consume(request(`learner-${i}`))),
  );
  expect(first.every((decision) => decision.allowed)).toBe(true);
  vi.advanceTimersByTime(30_001);
  const refresh = await Promise.all(
    Array.from({ length: 60 }, (_, i) => protection.consume(request(`learner-${i}`))),
  );
  expect(refresh.every((decision) => decision.allowed)).toBe(true);
  expect(resolve).toHaveBeenCalledTimes(120);
  expect((await protection.consume(request('unknown-61'))).allowed).toBe(false);
});

it('admits 100 cold pupils after an authoritative project read, even after 900 shared mutations', async () => {
  const resolve = vi.fn(async () => false);
  const protection = new MutationAbuseProtection(resolve);
  for (let n = 0; n < 900; n++) await protection.consume(request());
  for (let n = 0; n < 100; n++) {
    const read = request(`learner-${n}`);
    protection.observe(read);
    noteAuthoritativeMutationSession(read, 'seat-legacy', `learner-${n}`);
    expect((await protection.consume(request(`learner-${n}`))).allowed).toBe(true);
  }
  expect(resolve).not.toHaveBeenCalled();
});

it('labels the exact exhausted proof-work budget and keeps rejected proof lookups bounded', async () => {
  const resolve = vi.fn(async () => false);
  const protection = new MutationAbuseProtection(resolve);
  for (let n = 0; n < 900; n++) await protection.consume(request());
  for (let n = 0; n < 60; n++) await protection.consume(request(`garbage-${n}`));
  const denied = request('garbage-61');
  expect(await protection.consume(denied)).toEqual({ allowed: false, retryAfterSeconds: 60 });
  expect(requestMutationAdmission.get(denied)).toEqual({ blockedBudget: 'new_proof_work' });
  expect(resolve).toHaveBeenCalledTimes(60);
});

it('retained refresh eligibility rechecks revocation after thirty seconds', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let valid = true;
  const resolve = vi.fn(async () => valid);
  const protection = new MutationAbuseProtection(resolve);
  for (let n = 0; n < 900; n++) await protection.consume(request());
  expect((await protection.consume(request('revoked'))).allowed).toBe(true);
  valid = false;
  vi.advanceTimersByTime(30_001);
  expect((await protection.consume(request('revoked'))).allowed).toBe(false);
  expect(resolve).toHaveBeenCalledTimes(2);
});

it('expires refresh eligibility after five minutes rather than retaining permanent verified identities', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const resolve = vi.fn(async () => true);
  const protection = new MutationAbuseProtection(resolve);
  const read = request('old-pupil');
  protection.observe(read);
  noteAuthoritativeMutationSession(read, 'seat-legacy', 'old-pupil');
  vi.advanceTimersByTime(300_001);
  for (let n = 0; n < 900; n++) await protection.consume(request());
  for (let n = 0; n < 60; n++) await protection.consume(request(`new-pupil-${n}`));
  const denied = request('old-pupil');
  expect((await protection.consume(denied)).allowed).toBe(false);
  expect(requestMutationAdmission.get(denied)?.blockedBudget).toBe('new_proof_work');
  expect(resolve).toHaveBeenCalledTimes(60);
});

it('bounds retained authoritative proofs to 1024 records without trusting client metadata', async () => {
  const protection = new MutationAbuseProtection(async () => false);
  for (let n = 0; n < 1500; n++) {
    const read = request(`learner-${n}`);
    protection.observe(read);
    noteAuthoritativeMutationSession(read, 'seat-legacy', `learner-${n}`);
  }
  expect((Reflect.get(protection, 'verified') as Map<string, unknown>).size).toBe(1024);
  for (let n = 0; n < 900; n++) await protection.consume(request());
  // The evicted oldest proof must pass authoritative lookup again; a cookie or
  // forged success/identity header cannot recreate the server-only evidence.
  const evicted = request('learner-0');
  evicted.headers['x-asa-session-verified'] = 'true';
  expect((await protection.consume(evicted)).allowed).toBe(false);
  expect((await protection.consume(request('learner-1499'))).allowed).toBe(true);
});

it('replays 30/60/100 pupil stages over thirty virtual minutes without a proof bottleneck', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const protection = new MutationAbuseProtection(async () => true);
  for (const pupils of [30, 60, 100]) {
    for (let pupil = 0; pupil < pupils; pupil++) {
      const read = request(`learner-${pupil}`);
      protection.observe(read);
      noteAuthoritativeMutationSession(read, 'seat-legacy', `learner-${pupil}`);
    }
    for (let tick = 0; tick < 60; tick++) {
      for (let pupil = 0; pupil < pupils; pupil++) {
        // Electronics drafts every 10s; Scratch renewals every 60s. Runtime
        // Scratch saves use their separate capability budget and are excluded.
        if (pupil % 2 === 1 || tick % 6 === 0)
          expect((await protection.consume(request(`learner-${pupil}`))).allowed).toBe(true);
      }
      vi.advanceTimersByTime(10_000);
    }
  }
});
