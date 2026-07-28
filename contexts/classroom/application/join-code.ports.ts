/** What a visitor may see about a class before identifying themselves. */
export interface ClassroomPreview {
  readonly classroomId: string;
  readonly tenantId: string;
  readonly title: string;
  readonly educatorDisplayName: string;
  readonly codeVersion: number;
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
  /** Is this code version still the active one for the class? */
  isVersionActive(classroomId: string, version: number): Promise<boolean>;
  /** Preview of a class the server already identified, for a verified intent. */
  previewById(classroomId: string): Promise<ClassroomPreview | null>;
  /** How many active codes exist; used to refuse a silent pepper change. */
  activeCodeCount(): Promise<number>;
}

/**
 * Supplies the server-side secret behind class-code digests and join-intent
 * tokens.
 *
 * It is a port rather than a value so a deployment without the secret fails
 * closed and visibly, instead of silently digesting with an empty key.
 */
export interface JoinCodeSecretPort {
  secret(): string | null;
}
