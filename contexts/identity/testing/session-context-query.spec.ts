import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { PgSessionV2Store } from '../infrastructure/pg-session-v2.store.js';

describe('fixed session context query runner', () => {
  it('preserves canonical SQL, token binding, complete mapping and non-context writers', async () => {
    const row = {
      principal_id: 'principal',
      account_id: 'account',
      workspace_id: 'workspace',
      tenant_id: 'tenant',
      workspace_kind: 'personal',
      user_id: null,
      email: 'private',
      display_name: 'private',
      school_id: null,
    };
    const query = vi.fn().mockResolvedValue({ rows: [row] });
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as pg.Pool;
    const store = new PgSessionV2Store(pool, query);
    expect(await store.resolve('token-hash')).toEqual({
      principalId: 'principal',
      accountId: 'account',
      workspaceId: 'workspace',
      workspaceKind: 'personal',
      tenantId: 'tenant',
      userId: null,
      email: 'private',
      displayName: 'private',
      schoolId: null,
    });
    expect(query).toHaveBeenCalledExactlyOnceWith(
      pool,
      expect.stringContaining('FROM session_v2_context($1)'),
      ['token-hash'],
    );
    await store.revoke('token-hash');
    expect(pool.query).toHaveBeenCalledExactlyOnceWith('SELECT session_v2_revoke($1)', [
      'token-hash',
    ]);
    expect(query).toHaveBeenCalledOnce();
  });
  it('keeps the original query-only adapter and null authority result', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as pg.Pool;
    expect(await new PgSessionV2Store(pool).resolve('token')).toBeNull();
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('session_v2_context'), [
      'token',
    ]);
  });
});
