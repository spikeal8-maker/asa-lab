export interface AccountRecord {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly emailVerificationState: string;
}

export interface WorkspaceRef {
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly kind: 'personal' | 'organization';
  readonly title: string;
  readonly role: string;
  readonly userId: string | null;
}

export interface CapabilityRef {
  readonly capability: string;
  readonly state: string;
  readonly policyVersion: string;
}

export interface AccountProfile {
  readonly username: string;
  readonly displayName: string;
  readonly email: string;
  readonly emailVerificationState: string;
  readonly birthDate: string;
}

export interface RegisterAccountInput {
  /** Pseudonym chosen by the account holder; never derived from the email. */
  readonly email: string;
  readonly passwordHash: string;
  readonly displayName: string;
  readonly username: string;
  readonly birthDate: string;
  readonly country: string;
  readonly policyVersion: string;
}

export interface RegisteredAccount {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
}

export interface AccountDirectoryPort {
  findByEmail(emailLower: string): Promise<AccountRecord | null>;
  /** Universal sign-in also accepts the pseudonym instead of the address. */
  findByUsername(usernameLower: string): Promise<AccountRecord | null>;
  register(input: RegisterAccountInput): Promise<RegisteredAccount | { readonly conflict: true }>;
  workspaces(accountId: string): Promise<WorkspaceRef[]>;
  capabilities(accountId: string): Promise<CapabilityRef[]>;
  profile(accountId: string): Promise<AccountProfile | null>;
  isUsernameAvailable(username: string): Promise<boolean>;
  /** Account behind a legacy tenant-scoped session, if the session maps to one. */
  accountForUser(tenantId: string, userId: string): Promise<string | null>;
}
