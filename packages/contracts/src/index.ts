/** Foundation surface for the contracts package. OpenAPI/JSON Schema and event contract types. */
export const PACKAGE_NAME = '@asa-lab/contracts';

export interface PackageInfo {
  readonly name: string;
  readonly stable: boolean;
}

export function packageInfo(): PackageInfo {
  return { name: PACKAGE_NAME, stable: false };
}
