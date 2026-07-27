import { createHmac, randomInt } from 'node:crypto';

/**
 * A class code is a locator a teacher hands out; it is never a credential on
 * its own, and resolving one grants nothing.
 *
 * Codes travel on whiteboards, printouts and chat messages, so spaces, dashes
 * and case are normalized away before anything is looked up. The alphabet has
 * no look-alike characters (no O/0, I/1, L), because a misread code is the
 * most common way this flow fails.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export function normalizeJoinCode(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

export function isValidJoinCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z0-9]{6,16}$/.test(normalizeJoinCode(value));
}

/**
 * Generates a code with a cryptographically secure source.
 *
 * `randomInt` is rejection-sampled by Node, so the alphabet stays uniform; a
 * database `random()` is neither uniform for this purpose nor unpredictable,
 * and an attacker who can guess codes can enumerate classes.
 */
export function generateJoinCode(): string {
  let code = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/**
 * Keyed digest stored instead of the code itself.
 *
 * The pepper is a server-side secret, so a copy of the database does not hand
 * anyone a working code, and lookup stays a single indexed comparison.
 */
export function joinCodeDigest(code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(normalizeJoinCode(code)).digest('hex');
}
