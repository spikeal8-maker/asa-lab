/** Foundation surface for the database package. Typed repository and migration support types. */
export const PACKAGE_NAME = '@asa-lab/database';

export interface PackageInfo {
  readonly name: string;
  readonly stable: boolean;
}

export function packageInfo(): PackageInfo {
  return { name: PACKAGE_NAME, stable: false };
}
