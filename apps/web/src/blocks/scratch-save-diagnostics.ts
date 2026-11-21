// Match the closed API vocabulary without repeating full prefixes in the startup graph.
const SCRATCH_SAVE_FAILURE_CODE =
  /^scratch-save-(?:asset(?:-missing|-invalid|-response)?|draft|prepare|exit-(?:timeout|unavailable)|recovery(?:-quota|-media)?)$/;

export function isScratchSaveFailureCode(value: unknown): boolean {
  return typeof value === 'string' && SCRATCH_SAVE_FAILURE_CODE.test(value);
}
