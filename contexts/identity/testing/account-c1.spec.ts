import { describe, expect, it } from 'vitest';
import { AccountManagementUseCase } from '../application/account-management.usecase';
import type {
  AccountDirectoryPort,
  AccountProfileRecord,
  AccountSessionRef,
  EducatorAttestation,
  SessionV2StorePort,
} from '../application/account.ports';
import { hashSessionToken } from '../domain/session-token';

const ACCOUNT_ID = '087e994f-9970-4fad-b32f-8172c3273132';
const PRINCIPAL_ID = '45cf51a5-6792-47aa-9fa2-20f03720a3f7';
const WORKSPACE_ID = 'c08a45cd-af7e-4813-bc7d-d45d9b194921';
const OTHER_WORKSPACE_ID = '74e0374a-935c-4b8c-bef2-1bc0259fdc75';
const SESSION_ID = 'c26a6a84-06aa-4db6-9cc0-33f3bb65c755';

const PROFILE: AccountProfileRecord = {
  email: 'owner@example.test',
  emailVerificationState: 'verified',
  username: 'owner',
  displayName: 'Владелец',
  bio: '',
  birthDate: '1990-04-12',
  country: 'RU',
};

function directory(
  overrides: {
    profile?: AccountProfileRecord | null;
    attestation?: EducatorAttestation;
    usernameTaken?: boolean;
  } = {},
): AccountDirectoryPort {
  return {
    usernameAvailable: async () => true,
    register: async () => ({
      accountId: ACCOUNT_ID,
      principalId: PRINCIPAL_ID,
      workspaceId: WORKSPACE_ID,
      tenantId: '9b093c8e-e711-4410-b127-cb93fced6e80',
    }),
    findByIdentifier: async () => null,
    personalWorkspace: async () => ({
      workspaceId: WORKSPACE_ID,
      tenantId: '9b093c8e-e711-4410-b127-cb93fced6e80',
    }),
    capabilities: async () => [{ capability: 'creator', state: 'verified' }],
    workspaces: async () => [
      {
        workspaceId: WORKSPACE_ID,
        kind: 'personal',
        title: 'Личное пространство',
        role: 'owner',
      },
    ],
    profile: async () => (overrides.profile === undefined ? PROFILE : overrides.profile),
    avatar: async () => ({ avatarDataUrl: null }),
    updateAvatar: async (_accountId, avatarDataUrl) => ({ avatarDataUrl }),
    updateProfile: async (_accountId, username, displayName, bio) =>
      overrides.usernameTaken
        ? { conflict: 'username' }
        : { ...PROFILE, username, displayName, bio },
    selfAttestEducator: async () =>
      overrides.attestation ?? { eligible: true, state: 'provisional', created: true },
    accountForUser: async () => null,
    legacyActor: async () => null,
  };
}

function sessionStore(
  overrides: {
    switchResult?: 'switched' | 'unauthorized' | 'forbidden';
    revokeResult?: 'revoked' | 'unauthorized' | 'current_session' | 'not_found';
  } = {},
): SessionV2StorePort & { hashes: string[] } {
  const hashes: string[] = [];
  const sessions: AccountSessionRef[] = [
    {
      id: SESSION_ID,
      createdAt: '2026-07-30T10:00:00.000Z',
      lastSeenAt: '2026-07-30T10:05:00.000Z',
      expiresAt: '2026-08-29T10:00:00.000Z',
      current: true,
      userAgentSummary: 'Chrome · Windows',
    },
  ];
  return {
    hashes,
    create: async () => undefined,
    resolve: async () => null,
    revoke: async () => undefined,
    switchContext: async (tokenHash) => {
      hashes.push(tokenHash);
      return overrides.switchResult ?? 'switched';
    },
    list: async (tokenHash) => {
      hashes.push(tokenHash);
      return sessions;
    },
    revokeById: async (tokenHash) => {
      hashes.push(tokenHash);
      return overrides.revokeResult ?? 'revoked';
    },
    revokeOthers: async (tokenHash) => {
      hashes.push(tokenHash);
      return 2;
    },
  };
}

describe('Account C1 management use case', () => {
  it('returns the profile with server-owned capabilities and workspaces', async () => {
    const usecase = new AccountManagementUseCase(directory(), sessionStore());
    await expect(usecase.profile(ACCOUNT_ID)).resolves.toEqual({
      ...PROFILE,
      capabilities: [{ capability: 'creator', state: 'verified' }],
      workspaces: [
        {
          workspaceId: WORKSPACE_ID,
          kind: 'personal',
          title: 'Личное пространство',
          role: 'owner',
        },
      ],
    });
  });

  it('validates profile input and reports a case-insensitive username conflict', async () => {
    const usecase = new AccountManagementUseCase(
      directory({ usernameTaken: true }),
      sessionStore(),
    );
    await expect(
      usecase.updateProfile(ACCOUNT_ID, {
        username: 'not valid!',
        displayName: 'Владелец',
        bio: '',
      }),
    ).resolves.toEqual({ ok: false, code: 'validation_error' });
    await expect(
      usecase.updateProfile(ACCOUNT_ID, {
        username: 'OWNER',
        displayName: 'Владелец',
        bio: '',
      }),
    ).resolves.toEqual({ ok: false, code: 'username_taken' });
  });

  it('accepts safe raster avatars, supports removal and rejects executable or oversized data', async () => {
    const usecase = new AccountManagementUseCase(directory(), sessionStore());
    const png = 'data:image/png;base64,aGVsbG8=';
    await expect(usecase.updateAvatar(ACCOUNT_ID, png)).resolves.toEqual({
      ok: true,
      avatar: { avatarDataUrl: png },
    });
    await expect(usecase.updateAvatar(ACCOUNT_ID, null)).resolves.toEqual({
      ok: true,
      avatar: { avatarDataUrl: null },
    });
    await expect(
      usecase.updateAvatar(ACCOUNT_ID, 'data:image/svg+xml;base64,PHN2Zz4='),
    ).resolves.toEqual({ ok: false, code: 'validation_error' });
    await expect(
      usecase.updateAvatar(ACCOUNT_ID, `data:image/png;base64,${'A'.repeat(300_001)}`),
    ).resolves.toEqual({ ok: false, code: 'validation_error' });
  });

  it('accepts an adult educator attestation and preserves idempotent state', async () => {
    const created = new AccountManagementUseCase(directory(), sessionStore());
    await expect(created.selfAttestEducator(ACCOUNT_ID)).resolves.toEqual({
      ok: true,
      state: 'provisional',
      created: true,
    });

    const repeated = new AccountManagementUseCase(
      directory({
        attestation: { eligible: true, state: 'provisional', created: false },
      }),
      sessionStore(),
    );
    await expect(repeated.selfAttestEducator(ACCOUNT_ID)).resolves.toEqual({
      ok: true,
      state: 'provisional',
      created: false,
    });
  });

  it('rejects an underage attestation and a suspended grant', async () => {
    const underage = new AccountManagementUseCase(
      directory({ attestation: { eligible: false, state: null, created: false } }),
      sessionStore(),
    );
    await expect(underage.selfAttestEducator(ACCOUNT_ID)).resolves.toEqual({
      ok: false,
      code: 'underage',
    });

    const suspended = new AccountManagementUseCase(
      directory({ attestation: { eligible: true, state: 'suspended', created: false } }),
      sessionStore(),
    );
    await expect(suspended.selfAttestEducator(ACCOUNT_ID)).resolves.toEqual({
      ok: false,
      code: 'grant_unavailable',
    });
  });

  it('validates context and session identifiers before reaching persistence', async () => {
    const sessions = sessionStore();
    const usecase = new AccountManagementUseCase(directory(), sessions);
    await expect(usecase.switchContext('token', 'foreign-tenant')).resolves.toBe(
      'validation_error',
    );
    await expect(usecase.revokeSession('token', 'forged-session')).resolves.toBe(
      'validation_error',
    );
    expect(sessions.hashes).toEqual([]);
  });

  it('passes only a one-way token hash to session management', async () => {
    const sessions = sessionStore();
    const usecase = new AccountManagementUseCase(directory(), sessions);

    await expect(usecase.switchContext('secret-token', OTHER_WORKSPACE_ID)).resolves.toBe(
      'switched',
    );
    await expect(usecase.listSessions('secret-token')).resolves.toHaveLength(1);
    await expect(usecase.revokeSession('secret-token', SESSION_ID)).resolves.toBe('revoked');
    await expect(usecase.revokeOtherSessions('secret-token')).resolves.toBe(2);

    expect(sessions.hashes).toHaveLength(4);
    expect(new Set(sessions.hashes)).toEqual(new Set([hashSessionToken('secret-token')]));
    expect(sessions.hashes).not.toContain('secret-token');
  });
});
