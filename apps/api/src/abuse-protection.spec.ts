import { describe, expect, it } from 'vitest';
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
  it('stops a session that sustains more than the mutation ceiling', () => {
    const protection = new MutationAbuseProtection();
    for (let attempt = 0; attempt < 600; attempt += 1) {
      expect(protection.consume(request()).allowed).toBe(true);
    }
    expect(protection.consume(request()).allowed).toBe(false);
  });
});
