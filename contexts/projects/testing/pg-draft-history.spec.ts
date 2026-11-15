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

function fixture({
  accessible = true,
  draftExists = true,
  historyFails = false,
  writeDenied = false,
} = {}) {
  const history = vi.fn(async () => {
    if (historyFails) throw new Error('history query unavailable');
    return { rows: versions };
  });
  const query = vi.fn(async (...args: [sql: string, values?: readonly unknown[]]) => {
    const [sql] = args;
    if (sql.includes('project_editor_has_immutable_learning_origin'))
      return { rows: [{ has_origin: false }] };
    if (sql.includes('UPDATE project_drafts d'))
      return { rows: writeDenied ? [] : [{ ...row, project_id: row.id, was_replayed: false }] };
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

describe('identity-bound draft save preparation', () => {
  const mutation = {
    document: row.document_json,
    preview: null,
    baseRevision: 7,
    mutationId: '00000000-0000-4000-8000-000000000007',
  };

  it('removes one pool acquisition and the old document transfer, preserving write predicates', async () => {
    const original = fixture();
    await original.repository.load('active-tenant', row.id, actor, { includeVersions: false });
    await original.repository.saveDraft({
      ...mutation,
      tenantId: 'active-tenant',
      projectId: row.id,
      actor,
    });
    expect(original.context.mock.calls.length + original.connect.mock.calls.length).toBe(4);

    const optimized = fixture();
    const target = await optimized.repository.prepareDraftSave('active-tenant', row.id, actor);
    expect(target?.moduleKey).toBe('electronics');
    await expect(target!.save(mutation)).resolves.toMatchObject({ revision: 7 });
    expect(optimized.context.mock.calls.length + optimized.connect.mock.calls.length).toBe(3);
    expect(optimized.history).not.toHaveBeenCalled();
    const metadata = optimized.query.mock.calls.find(([sql]) =>
      sql.includes('SELECT p.module_key'),
    )!;
    expect(metadata[0]).not.toMatch(/document_json|preview_json|project_versions/);
    expect(metadata[0]).toContain('JOIN project_drafts');
    const write = optimized.query.mock.calls.find(([sql]) =>
      sql.includes('UPDATE project_drafts d'),
    )!;
    expect(write[0]).toContain('project_context_for_principal($3,$2)');
    expect(write[0]).toContain('current_context.user_id IS NOT DISTINCT FROM $4::uuid');
    expect(write[0]).toContain('d.revision=$8');
    expect(write[0]).toContain('d.last_mutation_id=$9::uuid');
    expect(optimized.release).toHaveBeenCalledTimes(2);
  });

  it('binds principal, project and resolved tenant, ignoring extra caller identity fields', async () => {
    const f = fixture();
    const mutableActor = { ...actor };
    const target = await f.repository.prepareDraftSave('wrong-active-tenant', row.id, mutableActor);
    mutableActor.principalId = 'attacker';
    await target!.save({
      ...mutation,
      tenantId: 'attacker-tenant',
      projectId: 'attacker-project',
      actor: mutableActor,
    } as typeof mutation);
    const write = f.query.mock.calls.find(([sql]) => sql.includes('UPDATE project_drafts d'))!;
    expect(write[1]?.slice(0, 4)).toEqual([
      'resolved-tenant',
      row.id,
      actor.principalId,
      'resolved-user',
    ]);
    expect(write[1]).not.toContain('attacker');
  });

  it.each([{ accessible: false }, { draftExists: false }])(
    'does not return a writer after denial: %j',
    async (options) => {
      const f = fixture(options);
      expect(await f.repository.prepareDraftSave('active-tenant', row.id, actor)).toBeNull();
      expect(f.query.mock.calls.some(([sql]) => sql.includes('UPDATE project_drafts d'))).toBe(
        false,
      );
    },
  );

  it('does not turn a rejected current write into a save acknowledgement', async () => {
    const f = fixture({ writeDenied: true });
    const target = await f.repository.prepareDraftSave('active-tenant', row.id, actor);
    expect(await target!.save(mutation)).toBeNull();
    expect(
      f.query.mock.calls.some(([sql]) => sql.includes('classroom_activity_record_project')),
    ).toBe(false);
  });
});
