import { randomBytes, randomUUID } from 'node:crypto';
import type { LiveClockPort, LiveIdPort } from '../application/ports.js';

const PUBLIC_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class SystemLiveClock implements LiveClockPort {
  nowMs(): number {
    return Date.now();
  }
}

export class CryptoLiveIds implements LiveIdPort {
  nextId(prefix: 'challenge' | 'game' | 'event' | 'ticket' | 'rating'): string {
    return `${prefix}:${randomUUID()}`;
  }

  nextPublicCode(): string {
    const bytes = randomBytes(12);
    let code = '';
    for (const byte of bytes) code += PUBLIC_ALPHABET[byte % PUBLIC_ALPHABET.length];
    return code;
  }

  randomBit(): 0 | 1 {
    return (randomBytes(1)[0]! & 1) as 0 | 1;
  }
}
