import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type BotAction = 'login' | 'register' | 'class_join';

export interface BotChallenge {
  readonly action: BotAction;
  readonly nonce: string;
  readonly salt: string;
  readonly difficulty: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly signature: string;
}

export interface BotProof extends BotChallenge {
  readonly counter: number;
}

interface BotChallengeOptions {
  readonly now?: () => number;
  readonly secret?: Buffer;
  readonly difficulty?: number;
  readonly ttlMs?: number;
  readonly required?: boolean;
}

const MAX_USED_NONCES = 10_000;

function publicFields(value: BotChallenge): string {
  return [
    value.action,
    value.nonce,
    value.salt,
    value.difficulty,
    value.issuedAt,
    value.expiresAt,
  ].join('|');
}

function browserBinding(userAgent: string | undefined): string {
  return createHash('sha256')
    .update((userAgent ?? '').slice(0, 256))
    .digest('base64url');
}

function leadingZeroBits(digest: Buffer): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

function isBotAction(value: unknown): value is BotAction {
  return value === 'login' || value === 'register' || value === 'class_join';
}

export class BotChallengeService {
  private readonly now: () => number;
  private readonly secret: Buffer;
  private readonly difficulty: number;
  private readonly ttlMs: number;
  private readonly required: boolean;
  private readonly used = new Map<string, number>();

  constructor(options: BotChallengeOptions = {}) {
    this.now = options.now ?? Date.now;
    this.secret = options.secret ?? randomBytes(32);
    this.difficulty = options.difficulty ?? 12;
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
    this.required =
      options.required ??
      (process.env['NODE_ENV'] === 'production' || process.env['ASA_BOT_PROTECTION'] === '1');
  }

  isRequired(): boolean {
    return this.required;
  }

  issue(action: BotAction, userAgent: string | undefined): BotChallenge {
    const issuedAt = this.now();
    const unsigned: Omit<BotChallenge, 'signature'> = {
      action,
      nonce: randomBytes(16).toString('base64url'),
      salt: randomBytes(16).toString('base64url'),
      difficulty: this.difficulty,
      issuedAt,
      expiresAt: issuedAt + this.ttlMs,
    };
    const signature = this.sign(unsigned, userAgent);
    return { ...unsigned, signature };
  }

  verify(expectedAction: BotAction, rawProof: unknown, userAgent: string | undefined): boolean {
    if (!this.required && rawProof === undefined) return true;
    const proof = this.parse(rawProof);
    if (!proof || proof.action !== expectedAction) return false;

    const now = this.now();
    this.prune(now);
    if (
      proof.issuedAt > now ||
      proof.expiresAt <= now ||
      proof.expiresAt - proof.issuedAt > this.ttlMs
    ) {
      return false;
    }
    if (this.used.has(proof.nonce)) return false;

    const expected = Buffer.from(this.sign(proof, userAgent), 'base64url');
    const actual = Buffer.from(proof.signature, 'base64url');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;

    const digest = createHash('sha256').update(`${proof.salt}:${proof.counter}`).digest();
    if (leadingZeroBits(digest) < proof.difficulty) return false;

    this.used.set(proof.nonce, proof.expiresAt);
    while (this.used.size > MAX_USED_NONCES) {
      const oldest = this.used.keys().next();
      if (oldest.done) break;
      this.used.delete(oldest.value);
    }
    return true;
  }

  private sign(
    value: Omit<BotChallenge, 'signature'> | BotChallenge,
    userAgent: string | undefined,
  ): string {
    return createHmac('sha256', this.secret)
      .update(`${publicFields(value as BotChallenge)}|${browserBinding(userAgent)}`)
      .digest('base64url');
  }

  private parse(value: unknown): BotProof | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const proof = value as Record<string, unknown>;
    if (
      !isBotAction(proof['action']) ||
      typeof proof['nonce'] !== 'string' ||
      !/^[A-Za-z0-9_-]{20,32}$/.test(proof['nonce']) ||
      typeof proof['salt'] !== 'string' ||
      !/^[A-Za-z0-9_-]{20,32}$/.test(proof['salt']) ||
      !Number.isInteger(proof['difficulty']) ||
      proof['difficulty'] !== this.difficulty ||
      !Number.isSafeInteger(proof['issuedAt']) ||
      !Number.isSafeInteger(proof['expiresAt']) ||
      typeof proof['signature'] !== 'string' ||
      !/^[A-Za-z0-9_-]{40,48}$/.test(proof['signature']) ||
      !Number.isSafeInteger(proof['counter']) ||
      (proof['counter'] as number) < 0 ||
      (proof['counter'] as number) > 2_000_000
    ) {
      return null;
    }
    return proof as unknown as BotProof;
  }

  private prune(now: number): void {
    for (const [nonce, expiresAt] of this.used) {
      if (expiresAt <= now) this.used.delete(nonce);
    }
  }
}
