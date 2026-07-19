import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

/** Password hashing: scrypt with per-password salt, constant-time verify.
 * Format: scrypt$N$r$p$saltHex$hashHex */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
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

/** Session tokens: 256-bit random value; only its SHA-256 is stored server-side. */
export function createSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Input validation helpers for the slice. */
export function isValidEmail(value: unknown): value is string {
  return (
    typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 255
  );
}

export function isValidClassroomTitle(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 255;
}
