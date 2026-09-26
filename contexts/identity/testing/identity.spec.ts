import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../domain/password';
import { createSessionToken, hashSessionToken } from '../domain/session-token';
import { isValidEmail, isValidWorkspace, normalizeEmail } from '../domain/validation';
import { LoginUseCase } from '../application/login.usecase';
import type { AccountDirectoryPort, SessionV2StorePort } from '../application/account.ports';
import type { TenantLocatorPort } from '../application/ports';

describe('identity domain', () => {
  it('hashes and verifies passwords with a versioned scrypt hash', () => {
    const stored = hashPassword('s3cret');
    expect(stored.startsWith('scrypt-v1$')).toBe(true);
    expect(stored).not.toContain('s3cret');
    expect(verifyPassword('s3cret', stored)).toBe(true);
    expect(verifyPassword('wrong', stored)).toBe(false);
    expect(verifyPassword('s3cret', 'plain')).toBe(false);
  });

  it('generates unique tokens and stable hashes', () => {
    const a = createSessionToken();
    expect(a).not.toBe(createSessionToken());
    expect(hashSessionToken(a)).toBe(hashSessionToken(a));
    expect(hashSessionToken(a)).not.toBe(a);
  });

  it('validates and normalizes credentials input', () => {
    expect(isValidEmail('t@x.ru')).toBe(true);
    expect(isValidEmail('nope')).toBe(false);
    expect(normalizeEmail('  T@X.RU ')).toBe('t@x.ru');
    expect(isValidWorkspace('school-1580')).toBe(true);
    expect(isValidWorkspace('BAD SLUG')).toBe(false);
  });
});
type LoginFakeOptions = Partial<{
  tenant: string | null;
  hasAccount: boolean;
  accountPassword: string;
  hasOrganization: boolean;
  organizationTenant: string;
  hasPersonal: boolean;
}>;

function fakes(overrides: LoginFakeOptions = {}) {
  const tenantId = overrides.tenant === undefined ? 'tenant-1' : overrides.tenant;
  const stored: Array<{ principalId: string; workspaceId: string; tokenHash: string }> = [];
  const seen: { workspace?: string; email?: string } = {};
  const tenants: TenantLocatorPort = {
    findTenantIdBySlug: async (workspace) => {
      seen.workspace = workspace;
      return tenantId;
    },
  };
  const accounts: Pick<
    AccountDirectoryPort,
    'findByEmail' | 'workspaces' | 'personalWorkspace' | 'legacyActor' | 'accountForUser'
  > = {
    findByEmail: async (email) => {
      seen.email = email;
      return overrides.hasAccount === false
        ? null
        : {
            id: 'account-1',
            email: 't@x.ru',
            passwordHash: hashPassword(overrides.accountPassword ?? 'pw-1'),
          };
    },
    workspaces: async () =>
      overrides.hasOrganization === false
        ? []
        : [
            {
              workspaceId: 'org-1',
              tenantId: overrides.organizationTenant ?? 'tenant-1',
              kind: 'organization',
              title: 'School',
              role: 'educator',
            },
          ],
    personalWorkspace: async () =>
      overrides.hasPersonal === false
        ? null
        : {
            workspaceId: 'personal-1',
            tenantId: 'personal-tenant',
            principalId: 'principal-1',
          },
    legacyActor: async () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
    accountForUser: async () => ({
      accountId: 'account-1',
      principalId: 'principal-1',
      workspaceId: 'org-1',
    }),
  };
  const sessions: Pick<SessionV2StorePort, 'create'> = {
    create: async (principalId, workspaceId, tokenHash) => {
      stored.push({ principalId, workspaceId, tokenHash });
    },
  };
  return {
    usecase: new LoginUseCase(tenants, accounts, sessions),
    stored,
    seen,
  };
}

describe('organization login use case', () => {
  it('uses the Account password and creates a canonical session in the requested organization', async () => {
    const { usecase, stored } = fakes();
    const result = await usecase.execute({
      workspace: 'school-1580',
      email: 't@x.ru',
      password: 'pw-1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accountId).toBe('account-1');
      expect(result.workspaceId).toBe('org-1');
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        principalId: 'principal-1',
        workspaceId: 'org-1',
      });
      expect(stored[0]?.tokenHash).not.toBe(result.token);
    }
  });

  it('rejects an unknown workspace as invalid credentials', async () => {
    const { usecase } = fakes({ tenant: null });
    const result = await usecase.execute({ workspace: 'ghost', email: 't@x.ru', password: 'pw-1' });
    expect(result).toEqual({ ok: false, code: 'invalid_credentials' });
  });
  it('rejects an unknown Account as invalid credentials', async () => {
    const { usecase } = fakes({ hasAccount: false });
    const result = await usecase.execute({
      workspace: 'school-1580',
      email: 'missing@x.ru',
      password: 'pw-1',
    });
    expect(result).toEqual({ ok: false, code: 'invalid_credentials' });
  });

  it('rejects a valid Account that is not a member of the requested organization', async () => {
    const { usecase, stored } = fakes({ organizationTenant: 'foreign-tenant' });
    const result = await usecase.execute({
      workspace: 'school-1580',
      email: 't@x.ru',
      password: 'pw-1',
    });
    expect(result).toEqual({ ok: false, code: 'invalid_credentials' });
    expect(stored).toHaveLength(0);
  });

  it('rejects malformed input as validation error', async () => {
    const { usecase } = fakes();
    const result = await usecase.execute({ workspace: 'x', email: 'bad', password: '' });
    expect(result).toEqual({ ok: false, code: 'validation_error' });
  });

  it('normalizes workspace and email before canonical lookup', async () => {
    const { usecase, stored, seen } = fakes();
    const result = await usecase.execute({
      workspace: '  SCHOOL-1580  ',
      email: '  T@X.RU ',
      password: 'pw-1',
    });
    expect(result.ok).toBe(true);
    expect(seen).toEqual({ workspace: 'school-1580', email: 't@x.ru' });
    expect(stored).toHaveLength(1);
  });
  it('does not trim the password', async () => {
    const { usecase } = fakes();
    const result = await usecase.execute({
      workspace: 'school-1580',
      email: 't@x.ru',
      password: ' pw-1 ',
    });
    expect(result).toEqual({ ok: false, code: 'invalid_credentials' });
  });

  it('rejects a wrong canonical Account password', async () => {
    const { usecase } = fakes();
    const result = await usecase.execute({
      workspace: 'school-1580',
      email: 't@x.ru',
      password: 'nope',
    });
    expect(result).toEqual({ ok: false, code: 'invalid_credentials' });
  });
});
