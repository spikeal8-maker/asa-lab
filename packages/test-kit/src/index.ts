/** Foundation surface for the test-kit package. Shared deterministic test helpers. */
export const PACKAGE_NAME = '@asa-lab/test-kit';

export interface PackageInfo {
  readonly name: string;
  readonly stable: boolean;
}

export function packageInfo(): PackageInfo {
  return { name: PACKAGE_NAME, stable: false };
}
