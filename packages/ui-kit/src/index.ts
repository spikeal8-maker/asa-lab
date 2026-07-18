/** Foundation surface for the ui-kit package. Shared UI primitives. */
export const PACKAGE_NAME = '@asa-lab/ui-kit';

export interface PackageInfo {
  readonly name: string;
  readonly stable: boolean;
}

export function packageInfo(): PackageInfo {
  return { name: PACKAGE_NAME, stable: false };
}
