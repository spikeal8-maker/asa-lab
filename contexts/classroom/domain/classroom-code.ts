import { createHash, createHmac } from 'node:crypto';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeClassroomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function formatClassroomCode(value: string): string {
  const normalized = normalizeClassroomCode(value);
  return normalized.match(/.{1,3}/g)?.join(' ') ?? normalized;
}

export function classroomCodeHash(value: string): string {
  return createHash('sha256').update(normalizeClassroomCode(value)).digest('hex');
}

/**
 * Join codes are deterministically recoverable by the application from a
 * server-held secret, while PostgreSQL stores only their SHA-256 hashes.
 */
export function classroomCodeFor(classroomId: string, version: number, secret: string): string {
  const bytes = createHmac('sha256', secret)
    .update(`asa-classroom:${classroomId}:v${version}`)
    .digest();
  let code = '';
  for (let index = 0; index < 9; index += 1) {
    code += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
  }
  return formatClassroomCode(code);
}
