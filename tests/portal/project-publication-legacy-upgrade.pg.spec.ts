import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { expect, it } from 'vitest';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan } from '../migration/isolated-postgres-plan';
import { seedTeacher } from './helpers';

async function principalId(
  pool: pg.Pool,
  tenantId: string,
  userId: string,
): Promise<string> {
  const result = await pool.query(
    `SELECT principal_id
       FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [tenantId, userId],
  );
  return result.rows[0].principal_id as string;
}

it('converges populated legacy publications without losing reactions or Collections', async () => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test')) {
    throw new Error('Isolated TEST_DATABASE_URL is required');
  }

  const name = 'asa_project_legacy_' + randomUUID().replaceAll('-', '') + '_test';
  if (!/^asa_project_legacy_[a-f0-9]{32}_test$/.test(name)) {
    throw new Error('Unsafe generated database name');
  }

  const cluster = new pg.Client({ connectionString: source });
  await cluster.connect();
  await cluster.query(`CREATE DATABASE "${name}"`);

  const connection = new URL(source);
  connection.pathname = '/' + name;
  const pool = new pg.Pool({ connectionString: connection.toString(), max: 3 });

  try {
    const planned = planMigrations('migrations');
    const baseline = planned.filter((entry: { version: string }) => entry.version < '0143');
    const convergence = planned.filter((entry: { version: string }) => entry.version === '0143');
    expect(baseline.at(-1)?.version).toBe('0142');
    expect(convergence).toHaveLength(1);

    const baselineClient = await pool.connect();
    try {
      expect(await applyIsolatedTestPlan(baselineClient, baseline)).toBe(baseline.length);
    } finally {
      baselineClient.release();
    }

    const owner = await seedTeacher(pool, 'legacy-publication-owner');
    const audience = await seedTeacher(pool, 'legacy-publication-audience');
    const ownerPrincipal = await principalId(pool, owner.tenantId, owner.teacherId);
    const audiencePrincipal = await principalId(pool, audience.tenantId, audience.teacherId);

    const project = await pool.query(
      `INSERT INTO projects
         (tenant_id, project_scope, module_key, title, owner_principal_id)
       VALUES ($1, 'personal', 'electronics', 'Current working title', $2)
       RETURNING id`,
      [owner.tenantId, ownerPrincipal],
    );
    const projectId = project.rows[0].id as string;
    const oldDocument = { schemaVersion: 1, marker: 'older-checkpoint' };
    const currentDocument = { schemaVersion: 1, marker: 'current-at-convergence' };

    await pool.query(
      `INSERT INTO project_drafts
         (tenant_id, project_id, document_json, revision, updated_by_principal_id)
       VALUES ($1, $2, $3::jsonb, 7, $4)`,
      [owner.tenantId, projectId, JSON.stringify(currentDocument), ownerPrincipal],
    );
    await pool.query(
      `INSERT INTO project_versions
         (tenant_id, project_id, version_no, document_json, label,
          created_by_principal_id)
       VALUES ($1, $2, 1, $3::jsonb, 'Older checkpoint', $4)`,
      [owner.tenantId, projectId, JSON.stringify(oldDocument), ownerPrincipal],
    );

    const legacyPublishedAt = '2026-08-20T12:00:00Z';
    await pool.query(
      `INSERT INTO project_publications
         (project_id, tenant_id, owner_principal_id, published_by_principal_id,
          title, module_key, author_label, snapshot_revision, published_at)
       VALUES ($1, $2, $3, $3, 'Legacy published title', 'electronics',
               'Legacy Author', 7, $4::timestamptz)`,
      [projectId, owner.tenantId, ownerPrincipal, legacyPublishedAt],
    );
    await pool.query(
      `INSERT INTO project_reactions (project_id, reactor_principal_id, kind)
       VALUES ($1, $2, 'like')`,
      [projectId, audiencePrincipal],
    );
    const collection = await pool.query(
      `INSERT INTO collections (owner_principal_id, title)
       VALUES ($1, 'Legacy saves') RETURNING id`,
      [audiencePrincipal],
    );
    const collectionId = collection.rows[0].id as string;
    await pool.query(
      `INSERT INTO collection_items (collection_id, project_id)
       VALUES ($1, $2)`,
      [collectionId, projectId],
    );

    const publicationBefore = (
      await pool.query(
        'SELECT to_jsonb(pub) AS record FROM project_publications pub WHERE project_id=$1',
        [projectId],
      )
    ).rows[0].record;
    const reactionsBefore = (
      await pool.query(
        `SELECT to_jsonb(reaction) AS record
           FROM project_reactions reaction
          WHERE project_id=$1
          ORDER BY reactor_principal_id, kind`,
        [projectId],
      )
    ).rows;
    const collectionItemsBefore = (
      await pool.query(
        `SELECT to_jsonb(item) AS record
           FROM collection_items item
          WHERE project_id=$1
          ORDER BY collection_id`,
        [projectId],
      )
    ).rows;
    const projectBefore = (
      await pool.query('SELECT to_jsonb(project) AS record FROM projects project WHERE id=$1', [
        projectId,
      ])
    ).rows[0].record;

    expect(
      (
        await pool.query(
          'SELECT count(*)::integer AS n FROM project_publication_state WHERE project_id=$1',
          [projectId],
        )
      ).rows[0].n,
    ).toBe(0);

    const upgrade = await pool.connect();
    try {
      expect(await applyIsolatedTestPlan(upgrade, convergence)).toBe(1);
      expect(await applyIsolatedTestPlan(upgrade, convergence)).toBe(0);
    } finally {
      upgrade.release();
    }

    expect(
      (
        await pool.query(
          'SELECT to_jsonb(pub) AS record FROM project_publications pub WHERE project_id=$1',
          [projectId],
        )
      ).rows[0].record,
    ).toEqual(publicationBefore);
    expect(
      (
        await pool.query(
          `SELECT to_jsonb(reaction) AS record
             FROM project_reactions reaction
            WHERE project_id=$1
            ORDER BY reactor_principal_id, kind`,
          [projectId],
        )
      ).rows,
    ).toEqual(reactionsBefore);
    expect(
      (
        await pool.query(
          `SELECT to_jsonb(item) AS record
             FROM collection_items item
            WHERE project_id=$1
            ORDER BY collection_id`,
          [projectId],
        )
      ).rows,
    ).toEqual(collectionItemsBefore);
    expect(
      (
        await pool.query('SELECT to_jsonb(project) AS record FROM projects project WHERE id=$1', [
          projectId,
        ])
      ).rows[0].record,
    ).toEqual(projectBefore);

    const canonical = await pool.query(
      `SELECT state.state,
              revision.revision_no,
              revision.legacy_convergence,
              revision.title,
              revision.preview_snapshot_revision,
              revision.published_at = pub.published_at AS published_at_preserved,
              version.version_no,
              version.document_json,
              version.label
         FROM project_publication_state state
         JOIN project_publication_revisions revision
           ON revision.id = state.current_revision_id
         JOIN project_versions version ON version.id = revision.project_version_id
         JOIN project_publications pub ON pub.project_id = state.project_id
        WHERE state.tenant_id=$1 AND state.project_id=$2`,
      [owner.tenantId, projectId],
    );
    expect(canonical.rows[0]).toMatchObject({
      state: 'public',
      revision_no: 1,
      legacy_convergence: true,
      title: 'Legacy published title',
      preview_snapshot_revision: 7,
      published_at_preserved: true,
      version_no: 2,
      document_json: currentDocument,
      label: 'Legacy publication convergence',
    });

    const counts = await pool.query(
      `SELECT
         (SELECT count(*)::integer FROM project_publications WHERE project_id=$1)
           AS legacy_publications,
         (SELECT count(*)::integer FROM project_reactions WHERE project_id=$1)
           AS reactions,
         (SELECT count(*)::integer FROM collection_items WHERE project_id=$1)
           AS collection_items,
         (SELECT count(*)::integer FROM project_publication_state WHERE project_id=$1)
           AS publication_states,
         (SELECT count(*)::integer FROM project_publication_revisions WHERE project_id=$1)
           AS publication_revisions,
         (SELECT count(*)::integer FROM project_versions WHERE project_id=$1)
           AS project_versions`,
      [projectId],
    );
    expect(counts.rows[0]).toMatchObject({
      legacy_publications: 1,
      reactions: 1,
      collection_items: 1,
      publication_states: 1,
      publication_revisions: 1,
      project_versions: 2,
    });
  } finally {
    await pool.end();
    if (!/^asa_project_legacy_[a-f0-9]{32}_test$/.test(name)) {
      throw new Error('Unsafe generated database name');
    }
    await cluster.query(`DROP DATABASE "${name}"`);
    await cluster.end();
  }
}, 120000);
