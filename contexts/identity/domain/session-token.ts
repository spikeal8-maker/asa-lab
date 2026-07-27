import { createHash, randomBytes } from 'node:crypto';

/** Session tokens: CSPRNG value; only its SHA-256 hash is stored server-side. */
export function createSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
