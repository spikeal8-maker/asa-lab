import { it, expect, vi } from 'vitest';
import type pg from 'pg';
import type { AccountDirectoryPort } from '@asa-lab/identity';
import { parseHistoryQuery } from './admin-user-history';
import { AdminControlPlaneService, type ResolvedAdminAccess } from './admin-control-plane.service';
it('validates closed history categories, bounded cursor/limit and repeated query values', () => {
  expect(parseHistoryQuery({})).toEqual({ category: 'projects', limit: 50, cursor: null });
  for (const bad of [
    { category: 'secrets' },
    { category: ['ai'] },
    { limit: '101' },
    { cursor: 'a==' },
    { scopeKind: ['platform'] },
  ])
    expect(() => parseHistoryQuery(bad as never)).toThrow();
});
it('authorizes and audits each page, bounds the transaction and destroys only a client with a failed rollback', async () => {
  const primary = new Error('history failed'),
    release = vi.fn();
  let fail = false;
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('SELECT admin_user_history')) {
      if (fail) throw primary;
      return {
        rows: [{ value: { items: [], next: { last: { at: '2026-10-25T12:00:00.000001Z' } } } }],
      };
    }
    if (sql === 'ROLLBACK') throw new Error('rollback failed');
    return { rows: [] };
  });
  const audit = vi.fn(async () => ({ rows: [] }));
  const service = new AdminControlPlaneService(
    {} as AccountDirectoryPort,
    { query: audit, connect: vi.fn(async () => ({ query, release })) } as unknown as pg.Pool,
  );
  const allow = vi.spyOn(service, 'authorize').mockReturnValue(true);
  const access = { subject: { principalId: 'actor' } } as ResolvedAdminAccess;
  const input = {
    scope: { kind: 'platform' as const, id: null },
    kind: 'student' as const,
    targetId: 'seat',
    category: 'ai' as const,
    limit: 25,
    cursor: null,
    requestId: 'request',
  };
  const result = await service.userHistory(access, input);
  expect(JSON.parse(Buffer.from(result.next!, 'base64url').toString()).last.at).toContain('000001');
  expect(query.mock.calls.slice(0, 2).map(([sql]) => sql)).toEqual([
    'BEGIN READ ONLY',
    "SET LOCAL statement_timeout = '8s'",
  ]);
  expect(audit).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledWith(undefined);
  expect(release.mock.invocationCallOrder[0]).toBeLessThan(audit.mock.invocationCallOrder[0]!);
  const auditFailure = new Error('audit unavailable');
  audit.mockRejectedValueOnce(auditFailure);
  await expect(service.userHistory(access, input)).rejects.toBe(auditFailure);
  fail = true;
  await expect(service.userHistory(access, input)).rejects.toBe(primary);
  expect(release).toHaveBeenLastCalledWith(true);
  allow.mockReturnValue(false);
  await expect(service.userHistory(access, input)).rejects.toThrow('ADMIN_SCOPE_DENIED');
  expect(audit).toHaveBeenCalledTimes(2);
});
