import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';
import type { CreateProjectInput } from '../../contexts/projects/application/ports';
import { seedTeacher, testAdminPool, testAppPool } from './helpers';

let admin: pg.Pool;
let runtime: pg.Pool;

beforeAll(() => {
  admin = testAdminPool();
  runtime = testAppPool();
});

afterAll(async () => {
  await runtime?.end();
  await admin?.end();
});

async function teacherProjectInput(label: string): Promise<CreateProjectInput> {
  const teacher = await seedTeacher(admin, `publication-${label}`);
  const principal = await admin.query(
    'SELECT principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
    [teacher.tenantId, teacher.teacherId],
  );
  return {
    tenantId: teacher.tenantId,
    scope: 'personal',
    classroomId: null,
    actor: {
      userId: teacher.teacherId,
      principalId: principal.rows[0].principal_id as string,
    },
    moduleKey: 'electronics',
    title: `Publication ${label}`,
    idempotencyKey: crypto.randomUUID(),
    requestFingerprint: `publication-${label}`,
    initialDocument: { schemaVersion: 1, components: [], connections: [] },
    initialPreview: null,
  };
}

async function createProjectWithVersion(
  repo: PgProjectRepository,
  base: CreateProjectInput,
  label: string,
) {
  const created = await repo.createWithDraft({
    ...base,
    title: `Publication ${label}`,
    idempotencyKey: crypto.randomUUID(),
    requestFingerprint: `publication-${label}-${crypto.randomUUID()}`,
  });
  if (created.kind !== 'created') {
    throw new Error(`fixture project ${label} was not created`);
  }

  const version = await repo.createCheckpoint(
    base.tenantId,
    created.project.id,
    base.actor,
    `Publish ${label}`,
  );
  if (!version) {
    throw new Error(`fixture version ${label} was not created`);
  }

  return { project: created.project, version };
}

describe('R7-01A publication revision schema on real PostgreSQL', () => {
  it('binds an immutable revision to an exact ProjectVersion from the same Project', async () => {
    const base = await teacherProjectInput('exact-version');
    const repo = new PgProjectRepository(runtime);
    const first = await createProjectWithVersion(repo, base, 'first');
    const second = await createProjectWithVersion(repo, base, 'second');

    const publication = await admin.query(
      `INSERT INTO project_publication_state
         (tenant_id, project_id, owner_principal_id, created_by_principal_id, state)
       VALUES ($1,$2,$3,$3,'public')
       RETURNING id`,
      [base.tenantId, first.project.id, base.actor.principalId],
    );
    const publicationId = publication.rows[0].id as string;

    const revision = await admin.query(
      `INSERT INTO project_publication_revisions
         (publication_id, tenant_id, project_id, revision_no, project_version_id,
          title, published_by_principal_id)
       VALUES ($1,$2,$3,1,$4,$5,$6)
       RETURNING id`,
      [
        publicationId,
        base.tenantId,
        first.project.id,
        first.version.id,
        first.project.title,
        base.actor.principalId,
      ],
    );
    const revisionId = revision.rows[0].id as string;

    await admin.query(
      `UPDATE project_publication_state
          SET current_revision_id=$2, published_at=now()
        WHERE id=$1`,
      [publicationId, revisionId],
    );

    const stored = await admin.query(
      `SELECT s.current_revision_id, r.project_version_id, r.revision_no
         FROM project_publication_state s
         JOIN project_publication_revisions r ON r.id=s.current_revision_id
        WHERE s.id=$1`,
      [publicationId],
    );
    expect(stored.rows[0]).toMatchObject({
      current_revision_id: revisionId,
      project_version_id: first.version.id,
      revision_no: 1,
    });

    const wrongProjectVersion = admin.query(
      `INSERT INTO project_publication_revisions
         (publication_id, tenant_id, project_id, revision_no, project_version_id,
          title, published_by_principal_id)
       VALUES ($1,$2,$3,2,$4,'wrong project version',$5)`,
      [publicationId, base.tenantId, first.project.id, second.version.id, base.actor.principalId],
    );
    await expect(wrongProjectVersion).rejects.toMatchObject({ code: '23503' });

    const mutateRevision = admin.query(
      'UPDATE project_publication_revisions SET title=$2 WHERE id=$1',
      [revisionId, 'mutated'],
    );
    await expect(mutateRevision).rejects.toMatchObject({ code: 'P0001' });

    const deleteRevision = admin.query('DELETE FROM project_publication_revisions WHERE id=$1', [
      revisionId,
    ]);
    await expect(deleteRevision).rejects.toMatchObject({ code: 'P0001' });
  });

  it('does not grant the runtime role direct access to publication storage', async () => {
    const privileges = await admin.query(
      `SELECT
         has_table_privilege('asalab_app','public.project_publication_state','SELECT')
           AS state_select,
         has_table_privilege('asalab_app','public.project_publication_revisions','SELECT')
           AS revision_select`,
    );
    expect(privileges.rows[0]).toMatchObject({
      state_select: false,
      revision_select: false,
    });
  });

  it('keeps the legacy Gallery publish and unpublish path operational', async () => {
    const base = await teacherProjectInput('gallery-compat');
    const repo = new PgProjectRepository(runtime);
    const created = await repo.createWithDraft(base);
    if (created.kind !== 'created') {
      throw new Error('gallery fixture project was not created');
    }

    const snapshot = await repo.saveSnapshot({
      tenantId: base.tenantId,
      actor: base.actor,
      projectId: created.project.id,
      image: {
        bytes: new Uint8Array(64),
        contentType: 'image/png',
        width: 16,
        height: 16,
      },
      sourceRevision: 1,
    });
    expect(snapshot).not.toBeNull();

    const published = await runtime.query('SELECT gallery_publish($1,$2) AS ok', [
      base.actor.principalId,
      created.project.id,
    ]);
    expect(published.rows[0].ok).toBe(true);

    const afterPublish = await admin.query(
      'SELECT count(*)::integer AS n FROM project_publications WHERE project_id=$1',
      [created.project.id],
    );
    expect(afterPublish.rows[0].n).toBe(1);

    const unpublished = await runtime.query('SELECT gallery_unpublish($1,$2) AS ok', [
      base.actor.principalId,
      created.project.id,
    ]);
    expect(unpublished.rows[0].ok).toBe(true);

    const afterUnpublish = await admin.query(
      'SELECT count(*)::integer AS n FROM project_publications WHERE project_id=$1',
      [created.project.id],
    );
    expect(afterUnpublish.rows[0].n).toBe(0);
  });
});

describe('R7-01B exact-version publish on real PostgreSQL', () => {
  it('keeps the live revision pinned until an explicit republish and does not duplicate retries', async () => {
    const base = await teacherProjectInput('publish-pin');
    const repo = new PgProjectRepository(runtime);
    const created = await repo.createWithDraft(base);
    if (created.kind !== 'created') {
      throw new Error('publish-pin fixture project was not created');
    }

    const firstSnapshot = await repo.saveSnapshot({
      tenantId: base.tenantId,
      actor: base.actor,
      projectId: created.project.id,
      image: {
        bytes: new Uint8Array(64),
        contentType: 'image/png',
        width: 16,
        height: 16,
      },
      sourceRevision: 1,
    });
    expect(firstSnapshot).not.toBeNull();

    const firstPublish = await runtime.query('SELECT gallery_publish($1,$2) AS ok', [
      base.actor.principalId,
      created.project.id,
    ]);
    expect(firstPublish.rows[0].ok).toBe(true);

    const firstLive = await admin.query(
      `SELECT state.current_revision_id, revision.revision_no,
              revision.project_version_id, revision.preview_snapshot_revision,
              version.version_no, version.document_json
         FROM project_publication_state state
         JOIN project_publication_revisions revision
           ON revision.id = state.current_revision_id
         JOIN project_versions version ON version.id = revision.project_version_id
        WHERE state.tenant_id=$1 AND state.project_id=$2`,
      [base.tenantId, created.project.id],
    );
    expect(firstLive.rows[0]).toMatchObject({
      revision_no: 1,
      preview_snapshot_revision: 1,
      version_no: 1,
      document_json: base.initialDocument,
    });
    const firstRevisionId = firstLive.rows[0].current_revision_id as string;
    const firstVersionId = firstLive.rows[0].project_version_id as string;

    const firstCounts = await admin.query(
      `SELECT
         (SELECT count(*)::integer FROM project_versions
           WHERE tenant_id=$1 AND project_id=$2) AS versions,
         (SELECT count(*)::integer FROM project_publication_revisions
           WHERE tenant_id=$1 AND project_id=$2) AS revisions`,
      [base.tenantId, created.project.id],
    );
    expect(firstCounts.rows[0]).toMatchObject({ versions: 1, revisions: 1 });

    const changedDocument = {
      schemaVersion: 1,
      components: [],
      connections: [],
      publicationMarker: 'changed',
    };
    const saved = await repo.saveDraft({
      tenantId: base.tenantId,
      projectId: created.project.id,
      actor: base.actor,
      document: changedDocument,
      preview: null,
      baseRevision: 1,
      mutationId: crypto.randomUUID(),
    });
    expect(saved?.revision).toBe(2);

    const stillFirstLive = await admin.query(
      `SELECT state.current_revision_id, revision.project_version_id,
              revision.revision_no, version.version_no, version.document_json
         FROM project_publication_state state
         JOIN project_publication_revisions revision
           ON revision.id = state.current_revision_id
         JOIN project_versions version ON version.id = revision.project_version_id
        WHERE state.tenant_id=$1 AND state.project_id=$2`,
      [base.tenantId, created.project.id],
    );
    expect(stillFirstLive.rows[0]).toMatchObject({
      current_revision_id: firstRevisionId,
      project_version_id: firstVersionId,
      revision_no: 1,
      version_no: 1,
      document_json: base.initialDocument,
    });

    const secondSnapshot = await repo.saveSnapshot({
      tenantId: base.tenantId,
      actor: base.actor,
      projectId: created.project.id,
      image: {
        bytes: new Uint8Array(64),
        contentType: 'image/png',
        width: 16,
        height: 16,
      },
      sourceRevision: 2,
    });
    expect(secondSnapshot).not.toBeNull();

    const secondPublish = await runtime.query('SELECT gallery_publish($1,$2) AS ok', [
      base.actor.principalId,
      created.project.id,
    ]);
    expect(secondPublish.rows[0].ok).toBe(true);

    const secondLive = await admin.query(
      `SELECT state.current_revision_id, revision.revision_no,
              revision.project_version_id, revision.preview_snapshot_revision,
              version.version_no, version.document_json
         FROM project_publication_state state
         JOIN project_publication_revisions revision
           ON revision.id = state.current_revision_id
         JOIN project_versions version ON version.id = revision.project_version_id
        WHERE state.tenant_id=$1 AND state.project_id=$2`,
      [base.tenantId, created.project.id],
    );
    expect(secondLive.rows[0]).toMatchObject({
      revision_no: 2,
      preview_snapshot_revision: 2,
      version_no: 2,
      document_json: changedDocument,
    });
    expect(secondLive.rows[0].current_revision_id).not.toBe(firstRevisionId);
    expect(secondLive.rows[0].project_version_id).not.toBe(firstVersionId);
    const secondRevisionId = secondLive.rows[0].current_revision_id as string;

    const secondCounts = await admin.query(
      `SELECT
         (SELECT count(*)::integer FROM project_versions
           WHERE tenant_id=$1 AND project_id=$2) AS versions,
         (SELECT count(*)::integer FROM project_publication_revisions
           WHERE tenant_id=$1 AND project_id=$2) AS revisions`,
      [base.tenantId, created.project.id],
    );
    expect(secondCounts.rows[0]).toMatchObject({ versions: 2, revisions: 2 });

    const retryPublish = await runtime.query('SELECT gallery_publish($1,$2) AS ok', [
      base.actor.principalId,
      created.project.id,
    ]);
    expect(retryPublish.rows[0].ok).toBe(true);

    const afterRetry = await admin.query(
      `SELECT state.current_revision_id,
              (SELECT count(*)::integer FROM project_versions version
                WHERE version.tenant_id=state.tenant_id
                  AND version.project_id=state.project_id) AS versions,
              (SELECT count(*)::integer FROM project_publication_revisions revision
                WHERE revision.publication_id=state.id) AS revisions
         FROM project_publication_state state
        WHERE state.tenant_id=$1 AND state.project_id=$2`,
      [base.tenantId, created.project.id],
    );
    expect(afterRetry.rows[0]).toMatchObject({
      current_revision_id: secondRevisionId,
      versions: 2,
      revisions: 2,
    });
  });
});
