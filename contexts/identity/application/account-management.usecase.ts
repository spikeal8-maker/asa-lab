import { hashSessionToken } from '../domain/session-token.js';
import { isValidDisplayName, isValidUsername } from '../domain/account-policy.js';
import type {
  AccountDirectoryPort,
  AccountAvatarRecord,
  AccountProfileRecord,
  AccountSessionRef,
  CapabilityRef,
  EducatorAttestation,
  EducatorModeChange,
  SchoolWorkspaceRecord,
  SessionV2StorePort,
  WorkspaceRef,
} from './account.ports.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AVATAR_DATA_URL_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_AVATAR_DATA_URL_LENGTH = 300_000;
const MAX_PROFILE_BIO_LENGTH = 960;

export interface AccountProfileView extends AccountProfileRecord {
  readonly capabilities: CapabilityRef[];
  readonly workspaces: WorkspaceRef[];
}

export type UpdateProfileResult =
  | { readonly ok: true; readonly profile: AccountProfileView }
  | { readonly ok: false; readonly code: 'validation_error' | 'username_taken' | 'not_found' };

export type UpdateAvatarResult =
  | { readonly ok: true; readonly avatar: AccountAvatarRecord }
  | { readonly ok: false; readonly code: 'validation_error' | 'not_found' };

export function isValidAvatarDataUrl(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      value.length <= MAX_AVATAR_DATA_URL_LENGTH &&
      AVATAR_DATA_URL_PATTERN.test(value))
  );
}

export type EducatorAttestationResult =
  | { readonly ok: true; readonly state: string; readonly created: boolean }
  | { readonly ok: false; readonly code: 'underage' | 'grant_unavailable' };

export type SetAccountRoleResult =
  | {
      readonly ok: true;
      readonly role: 'creator' | 'educator';
      readonly state: string | null;
      readonly changed: boolean;
    }
  | {
      readonly ok: false;
      readonly code: 'validation_error' | 'underage' | 'grant_unavailable';
    };

export type CreateSchoolWorkspaceResult =
  | { readonly ok: true; readonly school: SchoolWorkspaceRecord }
  | { readonly ok: false; readonly code: 'validation_error' | 'educator_required' };

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
    input: { username: unknown; displayName: unknown; bio: unknown },
  ): Promise<UpdateProfileResult> {
    if (
      !isValidUsername(input.username) ||
      !isValidDisplayName(input.displayName) ||
      typeof input.bio !== 'string' ||
      input.bio.trim().length > MAX_PROFILE_BIO_LENGTH
    ) {
      return { ok: false, code: 'validation_error' };
    }
    const username = (input.username as string).trim().toLowerCase();
    const displayName = (input.displayName as string).trim();
    const bio = input.bio.trim();
    const updated = await this.accounts.updateProfile(accountId, username, displayName, bio);
    if (updated === null) return { ok: false, code: 'not_found' };
    if ('conflict' in updated) return { ok: false, code: 'username_taken' };
    const profile = await this.profile(accountId);
    return profile === null ? { ok: false, code: 'not_found' } : { ok: true, profile };
  }

  async avatar(accountId: string): Promise<AccountAvatarRecord | null> {
    return this.accounts.avatar(accountId);
  }

  async updateAvatar(accountId: string, avatarDataUrl: unknown): Promise<UpdateAvatarResult> {
    if (!isValidAvatarDataUrl(avatarDataUrl)) {
      return { ok: false, code: 'validation_error' };
    }
    const avatar = await this.accounts.updateAvatar(accountId, avatarDataUrl);
    return avatar === null ? { ok: false, code: 'not_found' } : { ok: true, avatar };
  }

  async selfAttestEducator(accountId: string): Promise<EducatorAttestationResult> {
    const result: EducatorAttestation = await this.accounts.selfAttestEducator(accountId);
    if (!result.eligible) return { ok: false, code: 'underage' };
    if (result.state !== 'provisional' && result.state !== 'verified') {
      return { ok: false, code: 'grant_unavailable' };
    }
    return { ok: true, state: result.state, created: result.created };
  }

  async setAccountRole(accountId: string, role: unknown): Promise<SetAccountRoleResult> {
    if (role !== 'creator' && role !== 'educator') {
      return { ok: false, code: 'validation_error' };
    }
    const result: EducatorModeChange = await this.accounts.setEducatorMode(
      accountId,
      role === 'educator',
    );
    if (!result.eligible) return { ok: false, code: 'underage' };
    if (role === 'educator' && result.state !== 'provisional' && result.state !== 'verified') {
      return { ok: false, code: 'grant_unavailable' };
    }
    return { ok: true, role, state: result.state, changed: result.changed };
  }

  async createSchoolWorkspace(
    accountId: string,
    title: unknown,
  ): Promise<CreateSchoolWorkspaceResult> {
    if (typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 120) {
      return { ok: false, code: 'validation_error' };
    }
    const school = await this.accounts.createSchoolWorkspace(accountId, title.trim());
    return school ? { ok: true, school } : { ok: false, code: 'educator_required' };
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
