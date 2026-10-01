import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';

describe('personal Project list Learning marker', () => {
  it.each([
    { userId: null, status: 'active' as const },
    { userId: randomUUID(), status: 'active' as const },
    { userId: null, status: 'archived' as const },
    { userId: randomUUID(), status: 'archived' as const },
  ])(
    'uses one marker read for a full $status page (userId $userId)',
    async ({ userId, status }) => {
      const principalId = randomUUID();
      const tenantId = randomUUID();
      const rows = Array.from({ length: 40 }, () => ({
        id: randomUUID(),
        project_scope: 'personal',
        classroom_id: null,
        module_key: 'electronics',
        title: 'Project',
        status,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        preview_json: null,
        preview_digest: null,
        snapshot_revision: null,
      }));
      const query = vi.fn(async (sql: string, _values?: unknown[]) => {
        if (sql === 'COMMIT') return { rows: [], command: 'COMMIT' };
        if (sql.includes('learning_personal_project_origin_ids'))
          return { rows: [{ project_id: rows[0]?.id }] };
        if (sql.includes('FROM projects p')) return { rows };
        return { rows: [] };
      });
      const pool = {
        connect: async () => ({ query, release: vi.fn() }),
        query: vi.fn(async () => ({ rows: [] })),
      } as unknown as pg.Pool;
      const listed = await new PgProjectRepository(pool).listForActor(
        tenantId,
        { principalId, userId },
        { scope: 'personal', status, limit: 40 },
      );
      expect(listed).toHaveLength(40);
      expect(listed.find((project) => project.id === rows[0]?.id)?.isLearningWork).toBe(true);
      expect(
        listed
          .filter((project) => project.id !== rows[0]?.id)
          .every((project) => project.isLearningWork === false),
      ).toBe(true);
      const markerCalls = query.mock.calls.filter(([sql]) =>
        sql.includes('learning_personal_project_origin_ids'),
      );
      expect(markerCalls).toHaveLength(1);
      expect(markerCalls[0]?.[1]).toEqual([principalId, rows.map((row) => row.id)]);
    },
  );

  it('merges only authorized linked Account rows before page truncation', async () => {
    const principalId = randomUUID();
    const tenantId = randomUUID();
    const row = (id: string, updatedAt: string) => ({
      id,
      project_scope: 'personal',
      classroom_id: null,
      module_key: 'electronics',
      title: id,
      status: 'active',
      created_at: updatedAt,
      updated_at: updatedAt,
      preview_json: null,
      preview_digest: null,
      snapshot_revision: null,
    });
    const ownNewest = row(randomUUID(), '2026-01-03T00:00:00.000Z');
    const ownOlder = row(randomUUID(), '2026-01-01T00:00:00.000Z');
    const linked = row(randomUUID(), '2026-01-02T00:00:00.000Z');
    const query = vi.fn(async (sql: string) => {
      if (sql === 'COMMIT') return { rows: [], command: 'COMMIT' };
      if (sql.includes('learning_personal_project_origin_ids'))
        return { rows: [{ project_id: ownNewest.id }] };
      if (sql.includes('FROM projects p')) return { rows: [ownNewest, ownOlder] };
      return { rows: [] };
    });
    const linkedQuery = vi.fn(async () => ({ rows: [{ project: linked }] }));
    const pool = {
      connect: async () => ({ query, release: vi.fn() }),
      query: linkedQuery,
    } as unknown as pg.Pool;
    const repository = new PgProjectRepository(pool);
    const actor = { principalId, userId: randomUUID() };
    const all = await repository.listForActor(tenantId, actor, {
      scope: 'personal',
      limit: 2,
      kind: 'all',
    });
    expect(all.map((project) => project.id)).toEqual([ownNewest.id, linked.id]);
    expect(all[1]?.isLearningWork).toBe(true);
    expect(linkedQuery).toHaveBeenCalledWith(
      expect.stringContaining('learning_linked_account_project_list'),
      [principalId, 'active', null, null, false, 'recent', null, null, 2],
    );
    linkedQuery.mockClear();
    const personal = await repository.listForActor(tenantId, actor, {
      scope: 'personal',
      limit: 2,
      kind: 'personal',
    });
    expect(personal.map((project) => project.id)).toEqual([ownNewest.id, ownOlder.id]);
    expect(linkedQuery).not.toHaveBeenCalled();
  });
});
