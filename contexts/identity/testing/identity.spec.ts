import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../domain/password';
import { createSessionToken, hashSessionToken } from '../domain/session-token';
import { isValidEmail, isValidWorkspace, normalizeEmail } from '../domain/validation';
import { LoginUseCase } from '../application/login.usecase';
import type { SessionStorePort, TenantLocatorPort, UserDirectoryPort } from '../application/ports';

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

function fakes(overrides: Partial<{ tenant: string | null; hasUser: boolean }> = {}) {
  const tenantId = overrides.tenant === undefined ? 'tenant-1' : overrides.tenant;
  const stored: string[] = [];
  const tenants: TenantLocatorPort = {
    findTenantIdBySlug: async () => tenantId,
  };
  const users: UserDirectoryPort = {
    findActiveTeacherByEmail: async () =>
      overrides.hasUser === false
        ? null
        : {
            id: 'user-1',
            email: 't@x.ru',
            displayName: 'Teacher',
            schoolId: 'school-1',
            passwordHash: hashPassword('pw-1'),
          },
  };
  const sessions: SessionStorePort = {
    create: async (_t, _u, tokenHash) => {
      stored.push(tokenHash);
    },
    revoke: async () => undefined,
    resolve: async () => null,
  };
  return { usecase: new LoginUseCase(tenants, users, sessions), stored };
}

describe('login use case', () => {
  it('logs in and stores only the token hash', async () => {
    const { usecase, stored } = fakes();
    const result = await usecase.execute({
      workspace: 'school-1580',
      email: 't@x.ru',
      password: 'pw-1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(stored).toHaveLength(1);
      expect(stored[0]).not.toBe(result.token);
      expect(result.context.tenantId).toBe('tenant-1');
    }
  });

  it('rejects an unknown workspace as invalid credentials', async () => {
    const { usecase } = fakes({ tenant: null });
    const result = await usecase.execute({ workspace: 'ghost', email: 't@x.ru', password: 'pw-1' });
    expect(result).toEqual({ ok: false, code: 'invalid_credentials' });
  });

  it('rejects malformed input as validation error', async () => {
    const { usecase } = fakes();
    const result = await usecase.execute({ workspace: 'x', email: 'bad', password: '' });
    expect(result).toEqual({ ok: false, code: 'validation_error' });
  });

  it('rejects a wrong password', async () => {
    const { usecase } = fakes();
    const result = await usecase.execute({
      workspace: 'school-1580',
      email: 't@x.ru',
      password: 'nope',
    });
    expect(result).toEqual({ ok: false, code: 'invalid_credentials' });
  });
});
