import { createHmac, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { FixedWindowRateLimiter, type RateLimitDecision } from './rate-limit.js';
import { clientAddress } from './client-address.js';
import { SESSION_COOKIE } from './tokens.js';
import { STUDENT_SESSION_COOKIE } from './seat-context.js';

const WINDOW_MS = 5 * 60 * 1000;
const PER_ADDRESS = 900;
const PER_SESSION = 600;
// One classroom of 15 verified sessions can use its existing individual budgets.
const SHARED_ADDRESS_CEILING = 15 * PER_SESSION;

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
  private readonly sharedAddress = new FixedWindowRateLimiter({
    limit: SHARED_ADDRESS_CEILING,
    windowMs: WINDOW_MS,
    maxKeys: 5000,
  });
  private readonly verificationBudget = new FixedWindowRateLimiter({
    limit: 60,
    windowMs: 60_000,
    maxKeys: 5000,
  });
  private readonly verified = new Map<string, { valid: boolean; until: number }>();
  private readonly pending = new Map<string, Promise<boolean>>();

  constructor(
    private readonly resolveSession: (
      kind: 'account' | 'student',
      token: string,
    ) => Promise<boolean> = async () => false,
    private readonly now: () => number = Date.now,
  ) {}

  private async validSession(
    address: string,
    key: string,
    kind: 'account' | 'student',
    token: string,
  ): Promise<boolean> {
    const time = this.now();
    for (const [id, value] of this.verified) if (value.until <= time) this.verified.delete(id);
    const cached = this.verified.get(key);
    if (cached) return cached.valid;
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    if (this.pending.size >= 1024 || !this.verificationBudget.consume(address).allowed)
      return false;
    const verification = Promise.resolve()
      .then(() => this.resolveSession(kind, token))
      .catch(() => false)
      .then((valid) => {
        if (this.verified.size >= 1024) this.verified.delete(this.verified.keys().next().value!);
        this.verified.set(key, { valid, until: this.now() + (valid ? 30_000 : 5_000) });
        return valid;
      });
    this.pending.set(key, verification);
    try {
      return await verification;
    } finally {
      this.pending.delete(key);
    }
  }

  async consume(request: FastifyRequest): Promise<RateLimitDecision> {
    const token =
      request.cookies[SESSION_COOKIE] ?? request.cookies[STUDENT_SESSION_COOKIE] ?? undefined;
    const kind = request.cookies[SESSION_COOKIE] ? 'account' : 'student';
    const opaqueKey = token
      ? createHmac('sha256', this.key).update(`${kind}:${token}`).digest('base64url')
      : undefined;
    if (opaqueKey) {
      const session = this.bySession.consume(opaqueKey);
      if (!session.allowed) return session;
    }
    const source = clientAddress(request);
    const aggregate = this.sharedAddress.consume(source);
    if (!aggregate.allowed) return aggregate;
    const address = this.byAddress.consume(source);
    if (address.allowed || !token || !opaqueKey || token.length > 2048) return address;
    // A client-supplied cookie is only a partition key until the existing
    // authoritative session resolver confirms it. This cache grants no access.
    return (await this.validSession(source, opaqueKey, kind, token)) ? aggregate : address;
  }
}
