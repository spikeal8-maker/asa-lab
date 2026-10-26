import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan } from './isolated-postgres-plan';
import { seedTeacher } from '../portal/helpers';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';

describe('0260 publisher module admission on disposable PostgreSQL', () => {
  it('hides populated game publications without deleting data and admits three publisher modules', async () => {
    const source = process.env['TEST_DATABASE_URL'];
    if (!source || !new URL(source).pathname.endsWith('_test')) {
      throw new Error('Disposable TEST_DATABASE_URL required');
    }
    const name = 'asa_admission_' + randomUUID().replaceAll('-', '') + '_test';
    const owner = new pg.Client({ connectionString: source });
    let pool: pg.Pool | undefined;
    let created = false;
    try {
      await owner.connect();
      await owner.query('CREATE DATABASE "' + name + '"');
      created = true;
      const target = new URL(source);
      target.pathname = '/' + name;
      pool = new pg.Pool({ connectionString: target.href, max: 6 });
      const plan = planMigrations();
      const prefix = plan.filter((migration) => Number(migration.version) <= 259);
      expect(prefix.at(-1)?.version).toBe('0259');
      expect(plan.at(-1)?.file).toBe('0260_project_publication_module_admission.sql');
      const admin = await pool.connect();
      try {
        await applyIsolatedTestPlan(admin, prefix);
      } finally {
        admin.release();
      }

      const teacher = await seedTeacher(pool, 'reports-owner');
      const principal = (
        await pool.query(
          'SELECT principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
          [teacher.tenantId, teacher.teacherId],
        )
      ).rows[0].principal_id as string;
      const personalTenant = (
        await pool.query('INSERT INTO tenants(title,workspace_slug) VALUES ($1,$2) RETURNING id', [
          'Copy reader',
          'copy-' + randomUUID(),
        ])
      ).rows[0].id;
      const personalWorkspace = (
        await pool.query(
          "INSERT INTO workspaces(tenant_id,kind,title) VALUES ($1,'personal','Copy reader') RETURNING id",
          [personalTenant],
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO workspace_memberships(account_id,workspace_id,role) SELECT account_id,$2,'owner' FROM principals WHERE id=$1",
        [principal, personalWorkspace],
      );
      const repo = new PgProjectRepository(pool);
      async function makePublication(index: number, moduleKey = 'electronics') {
        const createdProject = await repo.createWithDraft({
          tenantId: teacher.tenantId,
          scope: 'personal',
          classroomId: null,
          actor: { userId: teacher.teacherId, principalId: principal },
          moduleKey,
          title: 'Module admission fixture ' + index,
          idempotencyKey: randomUUID(),
          requestFingerprint: randomUUID().replaceAll('-', '').repeat(2),
          initialDocument: { schemaVersion: 1, components: [], connections: [] },
          initialPreview: null,
        });
        if (createdProject.kind !== 'created') throw new Error('Cannot create fixture Project');
        await repo.saveSnapshot({
          tenantId: teacher.tenantId,
          actor: { userId: teacher.teacherId, principalId: principal },
          projectId: createdProject.project.id,
          sourceRevision: 1,
          image: {
            bytes: Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGNQCu34TwlmGDVg1IBRA4aLAQDLpv4Q+i0QiwAAAABJRU5ErkJggg==',
              'base64',
            ),
            contentType: 'image/png',
            width: 16,
            height: 16,
          },
        });
        const status = await pool!.query(
          'SELECT project_publication_publish($1,$2,$3::jsonb) AS result',
          [principal, createdProject.project.id, JSON.stringify({ title: 'Published ' + index })],
        );
        return {
          ...(status.rows[0].result.publication as {
            publicationId: string;
            revisionId: string;
          }),
          projectId: createdProject.project.id,
        };
      }
      const legacy = await makePublication(0, 'chess');
      const oldTables = [
        'projects',
        'project_drafts',
        'project_versions',
        'project_snapshots',
        'project_publication_state',
        'project_publication_revisions',
      ];
      async function retained() {
        return Promise.all(
          oldTables.map(
            async (table) =>
              (
                await pool!.query(
                  'SELECT to_jsonb(t) AS data FROM public.' +
                    table +
                    ' t ORDER BY to_jsonb(t)::text',
                )
              ).rows,
          ),
        );
      }
      const before = await retained();
      const historyBefore = (
        await pool.query('SELECT version,name,checksum FROM schema_migrations ORDER BY version')
      ).rows;
      const migrator = await pool.connect();
      try {
        expect(await applyIsolatedTestPlan(migrator, plan)).toBe(1);
        expect(await applyIsolatedTestPlan(migrator, plan)).toBe(0);
      } finally {
        migrator.release();
      }
      expect(await retained()).toEqual(before);
      expect(
        (
          await pool.query(
            "SELECT version,name,checksum FROM schema_migrations WHERE version<>'0260' ORDER BY version",
          )
        ).rows,
      ).toEqual(historyBefore);
      expect(
        (
          await pool.query('SELECT project_publication_readable($1) AS readable', [
            legacy.publicationId,
          ])
        ).rows[0].readable,
      ).toBe(false);
      for (const module of ['chess', 'checkers']) {
        await pool.query('UPDATE projects SET module_key=$1 WHERE id=$2', [
          module,
          legacy.projectId,
        ]);
        expect(
          (
            await pool.query('SELECT project_publication_policy_reason($1) AS reason', [
              legacy.projectId,
            ])
          ).rows[0].reason,
        ).toBe('module_not_publishable');
        await expect(
          pool.query('SELECT project_publication_publish($1,$2)', [principal, legacy.projectId]),
        ).rejects.toMatchObject({ code: 'P5P01' });
        await expect(
          pool.query('SELECT gallery_publish($1,$2)', [principal, legacy.projectId]),
        ).rejects.toMatchObject({ code: 'P5P01' });
        expect(
          (
            await pool.query('SELECT * FROM public_projects_read($1,NULL,NULL,1,0)', [
              legacy.publicationId,
            ])
          ).rows,
        ).toEqual([]);
        expect(
          (await pool.query('SELECT * FROM public_project_image($1,NULL)', [legacy.publicationId]))
            .rows,
        ).toEqual([]);
        await expect(
          pool.query('SELECT * FROM public_project_copy_source($1,$2,$3)', [
            principal,
            legacy.publicationId,
            legacy.revisionId,
          ]),
        ).rejects.toMatchObject({ code: 'P5P04' });
        expect(
          (await pool.query('SELECT * FROM gallery_work(NULL,$1)', [legacy.projectId])).rows,
        ).toEqual([]);
        expect(
          (await pool.query('SELECT * FROM gallery_snapshot($1)', [legacy.projectId])).rows,
        ).toEqual([]);
        expect(
          (
            await pool.query('SELECT gallery_copy_to_projects($1,$2,NULL) AS id', [
              principal,
              legacy.projectId,
            ])
          ).rows[0].id,
        ).toBeNull();
      }
      for (const module of ['three-d', 'electronics', 'blocks']) {
        const safe = await makePublication(1, module);
        expect(
          (
            await pool.query('SELECT project_publication_readable($1) AS readable', [
              safe.publicationId,
            ])
          ).rows[0].readable,
        ).toBe(true);
      }
    } finally {
      await pool?.end();
      if (created) await owner.query('DROP DATABASE "' + name + '"');
      await owner.end();
    }
  }, 240_000);
});
