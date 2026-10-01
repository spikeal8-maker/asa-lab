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
      } as unknown as pg.Pool;
      const listed = await new PgProjectRepository(pool).listForActor(
        tenantId,
        { principalId, userId },
        { scope: 'personal', status, limit: 40 },
      );
      expect(listed).toHaveLength(40);
      expect(listed[0]?.isLearningWork).toBe(true);
      expect(listed.slice(1).every((project) => project.isLearningWork === false)).toBe(true);
      const markerCalls = query.mock.calls.filter(([sql]) =>
        sql.includes('learning_personal_project_origin_ids'),
      );
      expect(markerCalls).toHaveLength(1);
      expect(markerCalls[0]?.[1]).toEqual([principalId, rows.map((row) => row.id)]);
    },
  );
});
