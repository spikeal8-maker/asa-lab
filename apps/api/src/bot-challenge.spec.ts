import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BotChallengeService, type BotChallenge, type BotProof } from './bot-challenge.js';

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

function solve(challenge: BotChallenge): BotProof {
  for (let counter = 0; counter < 100_000; counter += 1) {
    const digest = createHash('sha256').update(`${challenge.salt}:${counter}`).digest();
    if (leadingZeroBits(digest) >= challenge.difficulty) return { ...challenge, counter };
  }
  throw new Error('test proof was not found');
}

describe('BotChallengeService', () => {
  it('accepts one signed proof for the issuing browser and rejects replay', () => {
    let now = 1_000_000;
    const service = new BotChallengeService({
      now: () => now,
      secret: Buffer.alloc(32, 7),
      difficulty: 8,
      required: true,
    });
    const proof = solve(service.issue('login', 'browser'));

    expect(service.verify('login', proof, 'browser')).toBe(true);
    expect(service.verify('login', proof, 'browser')).toBe(false);
    now += 1;
  });

  it('rejects a proof copied to another browser, action, or expired request', () => {
    let now = 2_000_000;
    const service = new BotChallengeService({
      now: () => now,
      secret: Buffer.alloc(32, 9),
      difficulty: 8,
      ttlMs: 1_000,
      required: true,
    });
    const proof = solve(service.issue('register', 'browser'));

    expect(service.verify('register', proof, 'other-browser')).toBe(false);
    expect(service.verify('login', proof, 'browser')).toBe(false);
    now += 1_001;
    expect(service.verify('register', proof, 'browser')).toBe(false);
  });
});
