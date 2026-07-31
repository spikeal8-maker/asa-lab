export const AGE_POLICY_VERSION = 'asa-lab-2026-07';
export const ADULT_MIN_AGE_YEARS = 18;

export function parseBirthDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function ageInYears(birthDate: Date, now: Date = new Date()): number {
  let years = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const month = now.getUTCMonth() - birthDate.getUTCMonth();
  if (month < 0 || (month === 0 && now.getUTCDate() < birthDate.getUTCDate())) years -= 1;
  return years;
}

export function isEligibleAdult(birthDate: Date, now: Date = new Date()): boolean {
  return ageInYears(birthDate, now) >= ADULT_MIN_AGE_YEARS;
}

export function isValidCountryCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z]{2}$/.test(value.trim());
}

export function isValidPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 10 && value.length <= 200;
}

export function isValidUsername(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-z0-9](?:[a-z0-9._-]{1,38})[a-z0-9]$/.test(value.trim().toLowerCase())
  );
}

export function isValidDisplayName(value: unknown): value is string | undefined {
  if (value === undefined || value === null || value === '') return true;
  return typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 255;
}

export type MinorRoute = 'class_code' | 'student_account_next_stage';

export function routeForMinor(): readonly MinorRoute[] {
  return ['class_code', 'student_account_next_stage'];
}
