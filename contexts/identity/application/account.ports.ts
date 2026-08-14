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

export interface AccountProfileRecord {
  readonly email: string;
  readonly emailVerificationState: string;
  readonly username: string;
  readonly displayName: string;
  readonly birthDate: string;
  readonly country: string;
}

export interface AccountAvatarRecord {
  readonly avatarDataUrl: string | null;
}

export interface EducatorAttestation {
  readonly eligible: boolean;
  readonly state: string | null;
  readonly created: boolean;
}

export interface AccountSessionRef {
  readonly id: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
  readonly current: boolean;
  readonly userAgentSummary: string | null;
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
  profile(accountId: string): Promise<AccountProfileRecord | null>;
  avatar(accountId: string): Promise<AccountAvatarRecord | null>;
  updateAvatar(
    accountId: string,
    avatarDataUrl: string | null,
  ): Promise<AccountAvatarRecord | null>;
  updateProfile(
    accountId: string,
    username: string,
    displayName: string,
  ): Promise<AccountProfileRecord | RegistrationConflict | null>;
  selfAttestEducator(accountId: string): Promise<EducatorAttestation>;
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
    userAgentSummary?: string,
  ): Promise<void>;
  resolve(tokenHash: string): Promise<ActiveContext | null>;
  revoke(tokenHash: string): Promise<void>;
  switchContext(
    tokenHash: string,
    workspaceId: string,
  ): Promise<'switched' | 'unauthorized' | 'forbidden'>;
  list(tokenHash: string): Promise<AccountSessionRef[]>;
  revokeById(
    tokenHash: string,
    sessionId: string,
  ): Promise<'revoked' | 'unauthorized' | 'current_session' | 'not_found'>;
  revokeOthers(tokenHash: string): Promise<number>;
}
