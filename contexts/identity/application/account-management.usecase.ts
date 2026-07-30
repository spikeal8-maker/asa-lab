import { hashSessionToken } from '../domain/session-token.js';
import { isValidDisplayName, isValidUsername } from '../domain/account-policy.js';
import type {
  AccountDirectoryPort,
  AccountProfileRecord,
  AccountSessionRef,
  CapabilityRef,
  EducatorAttestation,
  SessionV2StorePort,
  WorkspaceRef,
} from './account.ports.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AccountProfileView extends AccountProfileRecord {
  readonly capabilities: CapabilityRef[];
  readonly workspaces: WorkspaceRef[];
}

export type UpdateProfileResult =
  | { readonly ok: true; readonly profile: AccountProfileView }
  | { readonly ok: false; readonly code: 'validation_error' | 'username_taken' | 'not_found' };

export type EducatorAttestationResult =
  | { readonly ok: true; readonly state: string; readonly created: boolean }
  | { readonly ok: false; readonly code: 'underage' | 'grant_unavailable' };

export class AccountManagementUseCase {
  constructor(
    private readonly accounts: AccountDirectoryPort,
    private readonly sessions: SessionV2StorePort,
  ) {}

  async profile(accountId: string): Promise<AccountProfileView | null> {
    const [profile, capabilities, workspaces] = await Promise.all([
      this.accounts.profile(accountId),
      this.accounts.capabilities(accountId),
      this.accounts.workspaces(accountId),
    ]);
    return profile === null ? null : { ...profile, capabilities, workspaces };
  }

  async updateProfile(
    accountId: string,
    input: { username: unknown; displayName: unknown },
  ): Promise<UpdateProfileResult> {
    if (!isValidUsername(input.username) || !isValidDisplayName(input.displayName)) {
      return { ok: false, code: 'validation_error' };
    }
    const username = (input.username as string).trim().toLowerCase();
    const displayName = (input.displayName as string).trim();
    const updated = await this.accounts.updateProfile(accountId, username, displayName);
    if (updated === null) return { ok: false, code: 'not_found' };
    if ('conflict' in updated) return { ok: false, code: 'username_taken' };
    const profile = await this.profile(accountId);
    return profile === null ? { ok: false, code: 'not_found' } : { ok: true, profile };
  }

  async selfAttestEducator(accountId: string): Promise<EducatorAttestationResult> {
    const result: EducatorAttestation = await this.accounts.selfAttestEducator(accountId);
    if (!result.eligible) return { ok: false, code: 'underage' };
    if (result.state !== 'provisional' && result.state !== 'verified') {
      return { ok: false, code: 'grant_unavailable' };
    }
    return { ok: true, state: result.state, created: result.created };
  }

  async switchContext(
    token: string | undefined,
    workspaceId: unknown,
  ): Promise<'switched' | 'unauthorized' | 'forbidden' | 'validation_error'> {
    if (!token) return 'unauthorized';
    if (typeof workspaceId !== 'string' || !UUID_PATTERN.test(workspaceId)) {
      return 'validation_error';
    }
    return this.sessions.switchContext(hashSessionToken(token), workspaceId);
  }

  async listSessions(token: string | undefined): Promise<AccountSessionRef[] | null> {
    if (!token) return null;
    return this.sessions.list(hashSessionToken(token));
  }

  async revokeSession(
    token: string | undefined,
    sessionId: unknown,
  ): Promise<'revoked' | 'unauthorized' | 'current_session' | 'not_found' | 'validation_error'> {
    if (!token) return 'unauthorized';
    if (typeof sessionId !== 'string' || !UUID_PATTERN.test(sessionId)) {
      return 'validation_error';
    }
    return this.sessions.revokeById(hashSessionToken(token), sessionId);
  }

  async revokeOtherSessions(token: string | undefined): Promise<number | null> {
    if (!token) return null;
    const count = await this.sessions.revokeOthers(hashSessionToken(token));
    return count < 0 ? null : count;
  }
}
