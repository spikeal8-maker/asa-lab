import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ownerAdminOptions } from '../../tools/platform-admin.mjs';

const identity = {
  email: 'owner@example.test',
  accountId: '11111111-2222-4333-8444-555555555555',
  expectedDatabase: 'owner_admin_test',
  reason: 'Confirmed operator request',
};

describe('owner administrator operator input', () => {
  it('normalizes the exact email without guessing or accepting a display name', () => {
    expect(ownerAdminOptions({ email: ' Owner@Example.Test ' }, 'plan').email).toBe(identity.email);
    expect(() => ownerAdminOptions({ email: 'Owner <owner@example.test>' }, 'plan')).toThrow();
  });

  it.each(['email', 'accountId', 'expectedDatabase', 'reason'])(
    'requires %s for a grant',
    (key) => {
      expect(() => ownerAdminOptions({ ...identity, [key]: '' }, 'grant')).toThrow();
    },
  );

  it('rejects an invalid UUID and unbounded audit reason', () => {
    expect(() => ownerAdminOptions({ ...identity, accountId: '1' }, 'grant')).toThrow();
    expect(() => ownerAdminOptions({ ...identity, reason: 'x'.repeat(501) }, 'grant')).toThrow();
    expect(ownerAdminOptions(identity, 'grant').accountId).toBe(identity.accountId);
  });

  it.each([['--grant', '--plan'], ['--unknown']])(
    'rejects ambiguous/unknown CLI options: %s',
    (...args) => {
      const result = spawnSync(process.execPath, ['tools/platform-admin.mjs', ...args], {
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: '', ASA_OWNER_ADMIN_EMAIL: '' },
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('platform-admin FAIL:');
    },
  );

  it('does not echo a private connection on a connection failure', () => {
    const result = spawnSync(process.execPath, ['tools/platform-admin.mjs', '--stdin', '--plan'], {
      encoding: 'utf8',
      input: JSON.stringify({
        email: identity.email,
        databaseUrl: 'postgresql://private-marker@127.0.0.1:invalid/owner_test',
      }),
      env: { ...process.env, PGHOST: '127.0.0.1', PGPORT: '1' },
      timeout: 15000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('private-marker');
    expect(result.stderr).toContain('platform-admin FAIL:');
  });
});
