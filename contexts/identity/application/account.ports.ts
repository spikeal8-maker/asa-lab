export interface AccountRecord {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
}

export interface RegisterAccountInput {
  readonly email: string;
  readonly passwordHash: string;
  readonly username: string;
  readonly displayName: string;
  readonly birthDate: string;
  readonly country: string;
  readonly policyVersion: string;
  /** The session is opened in the same statement as the account. */
  readonly tokenHash: string;
  readonly ttlHours: number;
}

export interface RegisteredAccount {
  readonly accountId: string;
  readonly principalId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
}

export interface WorkspaceRef {
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly kind: 'personal' | 'organization';
  readonly title: string;
  readonly role: string;
}

export interface CapabilityRef {
  readonly capability: string;
  readonly state: string;
}

export interface PersonalWorkspaceRef {
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly principalId: string;
}

export interface LinkedAccount {
  readonly accountId: string;
  readonly principalId: string;
  readonly workspaceId: string;
}

export interface AccountDirectoryPort {
  /**
   * Creates the whole identity — account, profile, principal, capability,
   * workspace, membership, session and audit event — or none of it.
   */
  register(input: RegisterAccountInput): Promise<RegisteredAccount | { readonly conflict: true }>;
  findByEmail(emailLower: string): Promise<AccountRecord | null>;
  findByUsername(usernameLower: string): Promise<AccountRecord | null>;
  isUsernameAvailable(username: string): Promise<boolean>;
  personalWorkspace(accountId: string): Promise<PersonalWorkspaceRef | null>;
  capabilities(accountId: string): Promise<CapabilityRef[]>;
  workspaces(accountId: string): Promise<WorkspaceRef[]>;
  /** The account behind a legacy tenant-scoped session, if one is linked. */
  accountForUser(tenantId: string, userId: string): Promise<LinkedAccount | null>;
}

/**
 * The ActiveContext of a request: who is acting, in which workspace, and — for
 * a workspace that still has one — as which tenant-scoped user.
 */
export interface ActiveContext {
  readonly principalId: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly workspaceKind: 'personal' | 'organization';
  readonly tenantId: string;
  readonly userId: string | null;
  readonly email: string;
  readonly displayName: string;
  readonly schoolId: string | null;
}

export interface SessionV2StorePort {
  create(
    principalId: string,
    workspaceId: string,
    tokenHash: string,
    ttlHours: number,
  ): Promise<void>;
  resolve(tokenHash: string): Promise<ActiveContext | null>;
  revoke(tokenHash: string): Promise<void>;
}
