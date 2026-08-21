import { createHmac, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { FixedWindowRateLimiter, type RateLimitDecision } from './rate-limit.js';
import { clientAddress } from './client-address.js';
import { SESSION_COOKIE } from './tokens.js';
import { STUDENT_SESSION_COOKIE } from './seat-context.js';

const WINDOW_MS = 5 * 60 * 1000;
const PER_ADDRESS = 900;
const PER_SESSION = 600;

/** A broad last-resort ceiling in addition to route-specific and edge limits. */
export class MutationAbuseProtection {
  private readonly byAddress = new FixedWindowRateLimiter({
    limit: PER_ADDRESS,
    windowMs: WINDOW_MS,
    maxKeys: 5_000,
  });
  private readonly bySession = new FixedWindowRateLimiter({
    limit: PER_SESSION,
    windowMs: WINDOW_MS,
    maxKeys: 10_000,
  });
  private readonly key = randomBytes(32);

  consume(request: FastifyRequest): RateLimitDecision {
    const address = this.byAddress.consume(clientAddress(request));
    if (!address.allowed) return address;

    const token =
      request.cookies[SESSION_COOKIE] ?? request.cookies[STUDENT_SESSION_COOKIE] ?? undefined;
    if (!token) return address;
    const opaqueKey = createHmac('sha256', this.key).update(token).digest('base64url');
    return this.bySession.consume(opaqueKey);
  }
}
