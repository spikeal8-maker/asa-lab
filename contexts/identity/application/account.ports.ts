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

export interface LegacyActor {
  readonly tenantId: string;
  readonly userId: string;
}

export type RegistrationConflict = { readonly conflict: 'email' | 'username' };

export interface AccountDirectoryPort {
  register(input: RegisterAccountInput): Promise<RegisteredAccount | RegistrationConflict>;
  findByEmail(emailLower: string): Promise<AccountRecord | null>;
  findByUsername(usernameLower: string): Promise<AccountRecord | null>;
  isUsernameAvailable(username: string): Promise<boolean>;
  personalWorkspace(accountId: string): Promise<PersonalWorkspaceRef | null>;
  capabilities(accountId: string): Promise<CapabilityRef[]>;
  workspaces(accountId: string): Promise<WorkspaceRef[]>;
  accountForUser(tenantId: string, userId: string): Promise<LinkedAccount | null>;
  legacyActor(accountId: string): Promise<LegacyActor | null>;
}

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
