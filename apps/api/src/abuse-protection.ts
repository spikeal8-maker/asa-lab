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

// Match Fastify's registered route, never a client URL, prefix or header. The
// limiter proves only an existing session for these AI mutations; it must not
// initialize a historical Seat while deciding whether a shared school IP can
// use the unchanged per-session budget.
const AI_MUTATION_ROUTES = new Set([
  'POST /api/ai/threads',
  'PATCH /api/ai/threads/:threadId',
  'DELETE /api/ai/threads/:threadId',
  'POST /api/ai/threads/:threadId/messages',
  'POST /api/ai/threads/:threadId/messages/stream',
  'POST /api/ai/threads/:threadId/requests/:requestId/stop',
  'PATCH /api/ai/threads/:threadId/archive',
  'POST /api/ai/threads/:threadId/regenerations/stream',
  'PUT /api/ai/classrooms/:classroomId/access',
  'PUT /api/admin/v1/ai',
  'POST /api/admin/v1/ai/test',
]);

export function isAiMutationRoute(request: FastifyRequest): boolean {
  return AI_MUTATION_ROUTES.has(`${request.method} ${request.routeOptions?.url}`);
}

interface BudgetAccountResolver {
  resolve(token: string | undefined): Promise<unknown>;
}
interface BudgetSeatResolver extends BudgetAccountResolver {
  resolveExisting(token: string | undefined): Promise<unknown>;
}
type MutationSessionResolver = (
  kind: 'account' | 'student',
  token: string,
  request: FastifyRequest,
) => Promise<boolean>;

function mutationSessionProof(kind: 'account' | 'student', token: string, request: FastifyRequest) {
  if (isAiMutationRoute(request)) {
    const seatToken = request.cookies[STUDENT_SESSION_COOKIE];
    if (seatToken !== undefined || kind === 'student')
      return { policy: 'seat-existing', token: seatToken ?? token } as const;
  }
  return { policy: kind === 'account' ? 'account' : 'seat-legacy', token } as const;
}

export function createMutationSessionResolver(
  accounts: BudgetAccountResolver,
  seats: BudgetSeatResolver,
): MutationSessionResolver {
  return async (kind, token, request) => {
    const proof = mutationSessionProof(kind, token, request);
    // The same selection identifies the cache and the authoritative resolver.
    // A retained Account must not replace even an explicitly empty Seat cookie.
    if (proof.policy === 'seat-existing') return (await seats.resolveExisting(proof.token)) != null;
    return (
      (await (proof.policy === 'account'
        ? accounts.resolve(proof.token)
        : seats.resolve(proof.token))) !== null
    );
  };
}

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
    private readonly resolveSession: MutationSessionResolver = async () => false,
    private readonly now: () => number = Date.now,
  ) {}

  private async validSession(
    address: string,
    kind: 'account' | 'student',
    token: string,
    request: FastifyRequest,
  ): Promise<boolean> {
    const proof = mutationSessionProof(kind, token, request);
    if (proof.token.length > 2048) return false;
    // Proof identity follows what is actually verified. This separate HMAC is
    // never used by bySession: switching resolver policy must not grant another
    // 600-request budget. Both positive/negative results and in-flight work use
    // this domain, so AI cannot inherit or await a legacy Seat initializer.
    const proofKey = createHmac('sha256', this.key)
      .update(JSON.stringify([proof.policy, proof.token]))
      .digest('base64url');
    const time = this.now();
    for (const [id, value] of this.verified) if (value.until <= time) this.verified.delete(id);
    const cached = this.verified.get(proofKey);
    if (cached) return cached.valid;
    const inFlight = this.pending.get(proofKey);
    if (inFlight) return inFlight;
    if (this.pending.size >= 1024 || !this.verificationBudget.consume(address).allowed)
      return false;
    const verification = Promise.resolve()
      .then(() => this.resolveSession(kind, token, request))
      .catch(() => false)
      .then((valid) => {
        if (this.verified.size >= 1024) this.verified.delete(this.verified.keys().next().value!);
        this.verified.set(proofKey, { valid, until: this.now() + (valid ? 30_000 : 5_000) });
        return valid;
      });
    this.pending.set(proofKey, verification);
    try {
      return await verification;
    } finally {
      this.pending.delete(proofKey);
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
    return (await this.validSession(source, kind, token, request)) ? aggregate : address;
  }
}
