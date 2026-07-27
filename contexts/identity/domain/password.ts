import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Versioned memory-hard password hashing (scrypt-v1). */
const VERSION = 'scrypt-v1';
const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LEN, { N, r: R, p: P });
  return `${VERSION}$${N}$${R}$${P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== VERSION) {
    return false;
  }
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const salt = Buffer.from(saltHex as string, 'hex');
  const expected = Buffer.from(hashHex as string, 'hex');
  const key = scryptSync(password, salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
