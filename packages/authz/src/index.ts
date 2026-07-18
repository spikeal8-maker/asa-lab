/** Foundation surface for the authz package. Server-side policy engine primitives. */
export const PACKAGE_NAME = '@asa-lab/authz';

export interface PackageInfo {
  readonly name: string;
  readonly stable: boolean;
}

export function packageInfo(): PackageInfo {
  return { name: PACKAGE_NAME, stable: false };
}
