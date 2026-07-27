/**
 * A class code is a locator, not a credential: it identifies which class a
 * student is looking at and grants nothing on its own.
 *
 * Codes travel on whiteboards, printouts and chat messages, so spaces, dashes
 * and case are normalized away before anything is looked up.
 */
export function normalizeJoinCode(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

export function isValidJoinCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z0-9]{4,16}$/.test(normalizeJoinCode(value));
}
