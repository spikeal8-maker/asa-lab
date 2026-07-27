/** What a visitor may see about a class before identifying themselves. */
export interface ClassroomPreview {
  readonly classroomId: string;
  readonly title: string;
  readonly educatorDisplayName: string;
}

export interface IssuedJoinCode {
  readonly joinCodeId: string;
  readonly version: number;
}

export interface JoinCodeDirectoryPort {
  /** Stores a new active code digest and rotates the previous one out. */
  issue(tenantId: string, classroomId: string, lookupDigest: string): Promise<IssuedJoinCode>;
  /** Revokes the active code without issuing a replacement. */
  revoke(tenantId: string, classroomId: string): Promise<number>;
  /** Resolves an active digest, or null when nothing matches. */
  resolve(lookupDigest: string): Promise<ClassroomPreview | null>;
}

/**
 * Supplies the server-side pepper for code digests.
 *
 * It is a port rather than a value so a deployment without the secret fails
 * closed and visibly, instead of silently digesting with an empty key.
 */
export interface JoinCodePepperPort {
  pepper(): string | null;
}
