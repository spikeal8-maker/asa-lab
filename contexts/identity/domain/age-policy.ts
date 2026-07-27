/**
 * Server-side age policy. The rule lives here, never in React: the browser may
 * show it, but only the server decides.
 */

export const AGE_POLICY_VERSION = 'asa-lab-2026-07';

/** Minimum age for self-attested educator capability in the first release. */
export const EDUCATOR_MIN_AGE_YEARS = 18;

/** Minimum age for an independent adult account. */
export const ADULT_MIN_AGE_YEARS = 18;

export function ageInYears(birthDate: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - birthDate.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < birthDate.getUTCDate())) {
    age -= 1;
  }
  return age;
}

export function isEligibleAdult(birthDate: Date, now: Date = new Date()): boolean {
  return ageInYears(birthDate, now) >= ADULT_MIN_AGE_YEARS;
}

/** Educator self-attestation is 18+; younger accounts can never self-grant it. */
export function maySelfAttestEducator(birthDate: Date, now: Date = new Date()): boolean {
  return ageInYears(birthDate, now) >= EDUCATOR_MIN_AGE_YEARS;
}

export function parseBirthDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  // Reject dates in the future and implausible ones.
  const now = new Date();
  if (parsed.getTime() > now.getTime() || parsed.getUTCFullYear() < 1900) {
    return null;
  }
  return parsed;
}

export function isValidCountryCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z]{2}$/.test(value.trim());
}

export function isValidPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 10 && value.length <= 200;
}

/** Display name is optional: a pseudonym is enough to use ASA Lab. */
export function isValidDisplayName(value: unknown): value is string | undefined {
  if (value === undefined || value === null || value === '') {
    return true;
  }
  return typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 255;
}

/**
 * Username is a separate pseudonym. Real names are never required and the
 * value is never derived from the email address.
 */
export function isValidUsername(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-z0-9](?:[a-z0-9._-]{1,38})[a-z0-9]$/.test(value.trim().toLowerCase())
  );
}

/** A random pseudonym proposal that carries no personal data. */
export function suggestUsername(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  let suffix = '';
  for (let index = 0; index < 8; index += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `user-${suffix}`;
}

/**
 * Where a person should go when they are too young for an adult account.
 * A refusal without a next step is a dead end, so the policy names the route.
 */
export type MinorRoute = 'class_code' | 'student_account_next_stage';

export function routeForMinor(): readonly MinorRoute[] {
  return ['class_code', 'student_account_next_stage'];
}

export function usernameFromEmail(email: string): string {
  const base = email.split('@')[0] ?? 'user';
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 40);
  return cleaned.length >= 3 ? cleaned : `user-${Date.now().toString(36)}`;
}
