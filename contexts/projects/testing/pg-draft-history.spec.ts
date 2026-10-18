import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PgProjectRepository } from '../infrastructure/pg-project.repository';

const actor = { principalId: 'principal-1', userId: 'active-user' };
const row = {
  id: 'project-1',
  project_scope: 'personal',
  classroom_id: null,
  module_key: 'electronics',
  title: 'History fixture',
  status: 'active',
  created_at: '2026-10-18T09:00:00Z',
  updated_at: '2026-10-18T10:00:00Z',
  document_json: { schemaVersion: 1, components: [], connections: [] },
  revision: 7,
  preview_json: null,
  preview_digest: null,
};
const versions = [4, 3].map((version_no) => ({
  id: `version-${version_no}`,
  project_id: row.id,
  version_no,
  label: `Checkpoint ${version_no}`,
  created_at: '2026-10-18T09:30:00Z',
}));

function fixture({ accessible = true, draftExists = true, historyFails = false } = {}) {
  const history = vi.fn(async () => {
    if (historyFails) throw new Error('history query unavailable');
    return { rows: versions };
  });
  const query = vi.fn(async (...args: [sql: string, values?: readonly unknown[]]) => {
    const [sql] = args;
    if (sql.includes('FROM project_versions')) return history();
    if (sql.includes('FROM projects p')) return { rows: draftExists ? [row] : [] };
    return { rows: [], command: sql === 'COMMIT' ? 'COMMIT' : '' };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const context = vi.fn(async () => ({
    rows: accessible ? [{ tenant_id: 'resolved-tenant', user_id: 'resolved-user' }] : [],
  }));
  const repository = new PgProjectRepository({ connect, query: context } as unknown as pg.Pool);
  return { repository, history, query, release, connect, context };
}

describe('draft saves omit unused history without changing the authorized project read', () => {
  it('keeps full history for default loads and omits only history for the explicit projection', async () => {
    const f = fixture();
    const full = await f.repository.load('active-tenant', row.id, actor);
    const projected = await f.repository.load('active-tenant', row.id, actor, {
      includeVersions: false,
    });
    expect(full).not.toBeNull();
    expect(projected).toEqual({ ...full, versions: [] });
    expect(full?.versions).toEqual(
      versions.map((v) => ({
        id: v.id,
        projectId: v.project_id,
        versionNo: v.version_no,
        label: v.label,
        createdAt: v.created_at,
      })),
    );
    expect(projected?.draft).toMatchObject({ document: row.document_json, revision: row.revision });
    expect(f.history).toHaveBeenCalledTimes(1);
    const reads = f.query.mock.calls.filter(([sql]) => sql.includes('FROM projects p'));
    expect(reads).toHaveLength(2);
    expect(reads[1]).toEqual(reads[0]);
    expect(reads[1][1]).toEqual(['resolved-tenant', row.id, actor.principalId, 'resolved-user']);
    expect(f.context).toHaveBeenCalledWith(
      expect.stringContaining('project_context_for_principal'),
      [actor.principalId, row.id],
    );
    expect(f.query).toHaveBeenCalledWith("SELECT set_config('app.tenant_id', $1, true)", [
      'resolved-tenant',
    ]);
  });

  it.each([undefined, { includeVersions: false } as const])(
    'denies an unresolved principal before borrowing a tenant connection (%j)',
    async (options) => {
      const f = fixture({ accessible: false });
      expect(await f.repository.load('active-tenant', row.id, actor, options)).toBeNull();
      expect(f.connect).not.toHaveBeenCalled();
      expect(f.history).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, { includeVersions: false } as const])(
    'preserves the project/draft join and denies a missing or inaccessible row (%j)',
    async (options) => {
      const f = fixture({ draftExists: false });
      expect(await f.repository.load('active-tenant', row.id, actor, options)).toBeNull();
      expect(f.query).toHaveBeenCalledWith(
        expect.stringContaining('JOIN project_drafts'),
        expect.any(Array),
      );
      expect(f.history).not.toHaveBeenCalled();
      expect(f.release).toHaveBeenCalledWith(false);
    },
  );

  it('does not query history for the projection; default history errors still propagate', async () => {
    const f = fixture({ historyFails: true });
    await expect(
      f.repository.load('active-tenant', row.id, actor, { includeVersions: false }),
    ).resolves.toMatchObject({
      draft: { revision: row.revision },
      versions: [],
    });
    expect(f.history).not.toHaveBeenCalled();
    await expect(f.repository.load('active-tenant', row.id, actor)).rejects.toThrow(
      'history query unavailable',
    );
    expect(f.history).toHaveBeenCalledTimes(1);
    expect(f.query).toHaveBeenCalledWith('ROLLBACK');
    expect(f.release).toHaveBeenCalledTimes(2);
  });
});
