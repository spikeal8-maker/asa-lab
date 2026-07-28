/**
 * Interface flags.
 *
 * Class-code entry stays hidden until a student can actually get in with it:
 * showing a door that leads nowhere is worse than not showing it at all. The
 * flag exists so the button can appear the day the seat login is real, instead
 * of waiting in the interface as a promise.
 *
 * `import.meta.env` is typed locally because the web app compiles without the
 * bundler's ambient types.
 */
interface BuildEnvironment {
  readonly VITE_ASA_CLASS_CODE_ENTRY?: string;
}

export function isClassCodeEntryEnabled(): boolean {
  const environment = (import.meta as unknown as { env?: BuildEnvironment }).env;
  return environment?.VITE_ASA_CLASS_CODE_ENTRY === 'on';
}
