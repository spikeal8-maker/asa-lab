import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { gamesProjectGuard } from './games-project-guard.js';

const actor = {
  principalId: 'principal',
  userId: null,
  studentSession: {
    tenantId: 'tenant',
    classroomId: 'class',
    seatId: 'seat',
    tokenHash: 'trusted-hash',
  },
};
const denied = {
  eligible: true,
  state: 'active',
  mode: 'deny',
  threshold: null,
  override: 'inherit',
  rating: null,
};

describe('Project transaction game guard', () => {
  it('does not replace independent Account project permissions', async () => {
    const query = vi.fn();
    await gamesProjectGuard({ query } as unknown as pg.PoolClient, {
      tenantId: 'tenant',
      actor: { principalId: 'account', userId: null },
      moduleKey: 'chess',
    });
    expect(query).not.toHaveBeenCalled();
  });
  it('fails closed when a selected Seat cannot resolve the exact authorized Project', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(
      gamesProjectGuard({ query } as unknown as pg.PoolClient, {
        tenantId: 'tenant',
        actor,
        projectId: 'foreign',
      }),
    ).rejects.toMatchObject({ response: { error: { code: 'project_not_found' } }, status: 404 });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain('project_context_for_principal');
    expect(query.mock.calls[0]?.[1]).toEqual(['tenant', 'foreign', 'principal']);
  });
  it('excludes games from a mixed shelf and rejects an explicit game shelf on the same locked current policy', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ data: denied }] });
    const client = { query } as unknown as pg.PoolClient;
    expect(
      await gamesProjectGuard(client, { tenantId: 'tenant', actor, operation: 'list' }),
    ).toEqual({ excludeGames: true });
    await expect(
      gamesProjectGuard(client, {
        tenantId: 'tenant',
        actor,
        operation: 'list',
        moduleKey: 'checkers',
      }),
    ).rejects.toMatchObject({
      response: { error: { code: 'games_access_denied', reason: 'class_disabled' } },
      status: 403,
    });
    expect(query.mock.calls[0]?.[0]).toContain('classroom_games_admission_lock');
    expect(query.mock.calls[0]?.[1]).toEqual([
      'principal',
      'tenant',
      'class',
      'seat',
      'trusted-hash',
    ]);
  });
  it('keeps an authorized ordinary educational document independent of the game policy', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ module_key: 'electronics' }] });
    await gamesProjectGuard({ query } as unknown as pg.PoolClient, {
      tenantId: 'tenant',
      actor,
      projectId: 'work',
    });
    expect(query).toHaveBeenCalledOnce();
  });
});
