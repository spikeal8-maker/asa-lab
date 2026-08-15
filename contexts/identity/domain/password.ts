import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';

/** Versioned memory-hard password hashing (scrypt-v1). */
const VERSION = 'scrypt-v1';
const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;

interface ScryptParams {
  readonly N: number;
  readonly r: number;
  readonly p: number;
}

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLen: number,
  params: ScryptParams,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLen, params, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/**
 * Asynchronous scrypt runs on the libuv thread pool, which is shared with file
 * and DNS work. Letting password hashing take every thread frees the event loop
 * but starves static file serving instead, so hashing gets at most half the
 * pool and the rest of the runtime keeps making progress under a login burst.
 */
function hashConcurrencyLimit(): number {
  const poolSize = Number.parseInt(process.env['UV_THREADPOOL_SIZE'] ?? '', 10);
  const effective = Number.isInteger(poolSize) && poolSize > 0 ? poolSize : 4;
  return Math.max(1, Math.floor(effective / 2));
}

const LIMIT = hashConcurrencyLimit();
let active = 0;
const waiting: (() => void)[] = [];

async function withHashSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= LIMIT) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

function encode(salt: Buffer, key: Buffer): string {
  return `${VERSION}$${N}$${R}$${P}$${salt.toString('hex')}$${key.toString('hex')}`;
}

interface StoredHash {
  readonly salt: Buffer;
  readonly expected: Buffer;
  readonly params: { N: number; r: number; p: number };
}

function decode(stored: string): StoredHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== VERSION) {
    return null;
  }
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  return {
    salt: Buffer.from(saltHex as string, 'hex'),
    expected: Buffer.from(hashHex as string, 'hex'),
    params: { N: Number(nStr), r: Number(rStr), p: Number(pStr) },
  };
}

/** Synchronous hashing. Seeds, fixtures and tests only — it blocks the loop. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return encode(salt, scryptSync(password, salt, KEY_LEN, { N, r: R, p: P }));
}

/** Synchronous verification. Seeds, fixtures and tests only. */
export function verifyPassword(password: string, stored: string): boolean {
  const parsed = decode(stored);
  if (parsed === null) return false;
  const key = scryptSync(password, parsed.salt, parsed.expected.length, parsed.params);
  return key.length === parsed.expected.length && timingSafeEqual(key, parsed.expected);
}

/** Request-path hashing: off the event loop, bounded against pool starvation. */
export async function hashPasswordAsync(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await withHashSlot(() => scryptAsync(password, salt, KEY_LEN, { N, r: R, p: P }));
  return encode(salt, key);
}

/** Request-path verification: off the event loop, bounded against starvation. */
export async function verifyPasswordAsync(password: string, stored: string): Promise<boolean> {
  const parsed = decode(stored);
  if (parsed === null) return false;
  const key = await withHashSlot(() =>
    scryptAsync(password, parsed.salt, parsed.expected.length, parsed.params),
  );
  return key.length === parsed.expected.length && timingSafeEqual(key, parsed.expected);
}

/**
 * A stored hash that matches no password, used when the identifier belongs to
 * nobody. Without it `account === null || verify(...)` short-circuits and a
 * missing account answers a full hash faster than an existing one, which
 * discloses who is registered.
 */
let decoy: string | null = null;

export async function verifyAgainstDecoy(password: string): Promise<false> {
  decoy ??= hashPassword(randomBytes(32).toString('hex'));
  await verifyPasswordAsync(password, decoy);
  return false;
}
