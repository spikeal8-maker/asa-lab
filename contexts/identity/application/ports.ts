export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly schoolId: string | null;
  readonly passwordHash: string;
}

export interface SessionContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly schoolId: string | null;
}

/** Resolves a workspace slug to a tenant id (locator only, never authz). */
export interface TenantLocatorPort {
  findTenantIdBySlug(slug: string): Promise<string | null>;
}

export interface UserDirectoryPort {
  findActiveTeacherByEmail(tenantId: string, emailLower: string): Promise<SessionUser | null>;
}

export interface SessionStorePort {
  create(tenantId: string, userId: string, tokenHash: string, ttlHours: number): Promise<void>;
  revoke(tokenHash: string): Promise<void>;
  resolve(tokenHash: string): Promise<SessionContext | null>;
}
