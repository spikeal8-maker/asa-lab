import { describe, expect, it, vi } from 'vitest';
import { AccountLoginUseCase } from '../application/account-login.usecase';
import { LoginUseCase } from '../application/login.usecase';
import type { AccountDirectoryPort, SessionV2StorePort } from '../application/account.ports';

describe('external-only Account password boundaries', () => {
  it.each([null, ''])(
    'rejects missing hash %j in both password entry paths without a session or exception',
    async (passwordHash) => {
      const record = { id: 'external-only', email: null, passwordHash };
      const accounts = {
        findByEmail: vi.fn(async () => record),
        findByUsername: vi.fn(async () => record),
      } as unknown as AccountDirectoryPort;
      const create = vi.fn();
      const sessions = { create } as unknown as SessionV2StorePort;
      const expected = { ok: false, code: 'invalid_credentials' };
      await expect(
        new AccountLoginUseCase(accounts, sessions).execute({
          identifier: 'external_user',
          password: 'wrong-password',
        }),
      ).resolves.toEqual(expected);
      await expect(
        new LoginUseCase({ findTenantIdBySlug: async () => 'tenant' }, accounts, sessions).execute({
          workspace: 'school',
          email: 'unused@example.test',
          password: 'wrong-password',
        }),
      ).resolves.toEqual(expected);
      expect(create).not.toHaveBeenCalled();
    },
  );
});
