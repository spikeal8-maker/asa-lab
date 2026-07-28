/**
 * What an adult account has to satisfy before it can exist.
 *
 * The age rule is the product's, not a formality: a self-registered account is
 * an adult account, and a younger person is routed to the school paths instead
 * of being refused into nothing.
 */
export const AGE_POLICY_VERSION = 'asa-lab-2026-07';
export const ADULT_MIN_AGE_YEARS = 18;

export function parseBirthDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function ageInYears(birthDate: Date, now: Date = new Date()): number {
  let years = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const month = now.getUTCMonth() - birthDate.getUTCMonth();
  if (month < 0 || (month === 0 && now.getUTCDate() < birthDate.getUTCDate())) {
    years -= 1;
  }
  return years;
}

export function isEligibleAdult(birthDate: Date, now: Date = new Date()): boolean {
  return ageInYears(birthDate, now) >= ADULT_MIN_AGE_YEARS;
}

/** ISO 3166-1 alpha-2, so the policy can differ by country later. */
export function isValidCountryCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z]{2}$/.test(value.trim());
}

export function isValidPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 10 && value.length <= 200;
}

/**
 * The username is a pseudonym the person chooses. It is never derived from the
 * email — that would leak the address — and a real name is never required.
 */
export function isValidUsername(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-z0-9](?:[a-z0-9._-]{1,38})[a-z0-9]$/.test(value.trim().toLowerCase())
  );
}

/** A display name is optional; when given it only has to be sane. */
export function isValidDisplayName(value: unknown): value is string | undefined {
  if (value === undefined || value === null || value === '') return true;
  return typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 255;
}

/** Where a person under the adult age should go instead of a dead end. */
export type MinorRoute = 'class_code' | 'student_account_next_stage';

export function routeForMinor(): readonly MinorRoute[] {
  return ['class_code', 'student_account_next_stage'];
}
