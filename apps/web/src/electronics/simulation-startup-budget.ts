/**
 * Budget for first accepted simulation frame, not for physical/model time.
 * The optional school profile must be selected explicitly by the deployment;
 * test failures must never silently activate it.
 */
export const ELECTRONICS_COLD_START_STANDARD_MS = 5_000;
export const ELECTRONICS_COLD_START_SCHOOL_MS = 10_000;

export function electronicsColdStartBudgetMs(profile: unknown): number {
  return profile === 'school'
    ? ELECTRONICS_COLD_START_SCHOOL_MS
    : ELECTRONICS_COLD_START_STANDARD_MS;
}
