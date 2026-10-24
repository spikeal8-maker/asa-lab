import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';
import { seedTeacher, testAdminPool, testAppPool } from '../portal/helpers';

let admin: pg.Pool;
let runtime: pg.Pool;
beforeAll(() => {
  admin = testAdminPool();
  runtime = testAppPool();
});
afterAll(async () => {
  await Promise.all([admin?.end(), runtime?.end()]);
});

async function fixture() {
  const teacher = await seedTeacher(admin, 'prepared-save');
  const link = (
    await admin.query(
      'SELECT principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
      [teacher.tenantId, teacher.teacherId],
    )
  ).rows[0];
  const actor = { principalId: link.principal_id as string, userId: teacher.teacherId };
  const repo = new PgProjectRepository(runtime);
  const created = await repo.createWithDraft({
    tenantId: teacher.tenantId,
    scope: 'personal',
    classroomId: null,
    actor,
    moduleKey: 'electronics',
    title: 'Prepared save',
    idempotencyKey: randomUUID(),
    requestFingerprint: randomUUID(),
    initialDocument: { schemaVersion: 1, components: [], connections: [] },
    initialPreview: null,
  });
  if (created.kind !== 'created') throw new Error('fixture_create_failed');
  const input = {
    document: { schemaVersion: 1, components: [], connections: [] },
    preview: null,
    baseRevision: 1,
    mutationId: randomUUID(),
  };
  return { teacher, actor, repo, projectId: created.project.id, input };
}

describe('prepared draft saves on the restricted PostgreSQL role', () => {
  it('persists, replays one receipt and rejects a stale mutation without incrementing twice', async () => {
    const f = await fixture();
    const target = await f.repo.prepareDraftSave(f.teacher.tenantId, f.projectId, f.actor);
    expect(target?.moduleKey).toBe('electronics');
    const saved = await target!.save(f.input);
    expect(saved?.revision).toBe(2);
    expect(await target!.save(f.input)).toEqual(saved);
    expect(await target!.save({ ...f.input, mutationId: randomUUID() })).toBeNull();
    const stored = await f.repo.load(f.teacher.tenantId, f.projectId, f.actor, {
      includeVersions: false,
    });
    expect(stored?.draft).toEqual(saved);
  });

  it('denies a prepared write and receipt replay after the legacy mapping changes', async () => {
    const f = await fixture();
    const target = await f.repo.prepareDraftSave(f.teacher.tenantId, f.projectId, f.actor);
    expect(await target!.save(f.input)).toMatchObject({ revision: 2 });
    // Owner principal still has current access, but its resolved user is now
    // null. A saved context must not reuse the retired legacy-user authority.
    await admin.query(
      "UPDATE legacy_user_account_links SET migration_state='retired' WHERE tenant_id=$1 AND user_id=$2",
      [f.teacher.tenantId, f.teacher.teacherId],
    );
    expect(await target!.save(f.input)).toBeNull();
    expect(
      await target!.save({ ...f.input, baseRevision: 2, mutationId: randomUUID() }),
    ).toBeNull();
    const stored = await admin.query(
      'SELECT revision FROM project_drafts WHERE tenant_id=$1 AND project_id=$2',
      [f.teacher.tenantId, f.projectId],
    );
    expect(stored.rows[0].revision).toBe(2);
  });

  it('denies another principal from a different tenant before returning a writer', async () => {
    const f = await fixture();
    const foreign = await fixture();
    expect(
      await f.repo.prepareDraftSave(foreign.teacher.tenantId, f.projectId, foreign.actor),
    ).toBeNull();
  });
});
