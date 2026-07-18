/** Foundation surface for the module-sdk package. Versioned subject-module contract surface. */
export const PACKAGE_NAME = '@asa-lab/module-sdk';

export interface PackageInfo {
  readonly name: string;
  readonly stable: boolean;
}

export function packageInfo(): PackageInfo {
  return { name: PACKAGE_NAME, stable: false };
}
