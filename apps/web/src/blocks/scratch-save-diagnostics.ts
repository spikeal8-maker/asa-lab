// Closed Scratch save vocabulary used at the diagnostics boundary.
export const SCRATCH_SAVE_FAILURE_CODES = [
  'scratch-save-asset',
  'scratch-save-asset-missing',
  'scratch-save-asset-invalid',
  'scratch-save-asset-response',
  'scratch-save-draft',
  'scratch-save-prepare',
  'scratch-save-exit-timeout',
  'scratch-save-exit-unavailable',
  'scratch-save-recovery',
  'scratch-save-recovery-quota',
  'scratch-save-recovery-media',
] as const;

export function isScratchSaveFailureCode(value: unknown): boolean {
  return SCRATCH_SAVE_FAILURE_CODES.some((code) => code === value);
}
