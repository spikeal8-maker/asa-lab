/** Foundation surface for the eventing package. Transactional outbox and idempotent consumer types. */
export const PACKAGE_NAME = '@asa-lab/eventing';

export interface PackageInfo {
  readonly name: string;
  readonly stable: boolean;
}

export function packageInfo(): PackageInfo {
  return { name: PACKAGE_NAME, stable: false };
}
