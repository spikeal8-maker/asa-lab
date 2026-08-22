import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Bytes } from '../sha256';

const encoder = new TextEncoder();

function hex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('BotCheck SHA-256 fallback', () => {
  it.each(['', 'abc', 'ASA Lab', 'проверка', 'challenge-salt:2048'])(
    'matches the platform SHA-256 implementation for %j',
    (value) => {
      const expected = createHash('sha256').update(value).digest('hex');
      expect(hex(sha256Bytes(encoder.encode(value)))).toBe(expected);
    },
  );

  it('handles values spanning more than one SHA-256 block', () => {
    const value = 'asa-lab-bot-check:'.repeat(40);
    const expected = createHash('sha256').update(value).digest('hex');
    expect(hex(sha256Bytes(encoder.encode(value)))).toBe(expected);
  });
});
