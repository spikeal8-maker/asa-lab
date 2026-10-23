import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan } from './isolated-postgres-plan';
import { seedTeacher } from '../portal/helpers';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';

describe('0240 additive public-project reports on disposable PostgreSQL', () => {
  it('preserves prior migration history, enforces privileges and records exact reports', async () => {
    const source = process.env['TEST_DATABASE_URL'];
    if (!source || !new URL(source).pathname.endsWith('_test')) {
      throw new Error('Disposable TEST_DATABASE_URL required');
    }
    const name = 'asa_reports_' + randomUUID().replaceAll('-', '') + '_test';
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
      const prefix = plan.filter((migration) => Number(migration.version) <= 238);
      expect(prefix.at(-1)?.version).toBe('0238');
      expect(plan.at(-1)?.file).toBe('0240_project_publication_reports.sql');
      const admin = await pool.connect();
      try {
        await applyIsolatedTestPlan(admin, prefix);
        const beforeHistory = (
          await admin.query('SELECT version,name,checksum FROM schema_migrations ORDER BY version')
        ).rows;
        expect(await applyIsolatedTestPlan(admin, plan)).toBe(1);
        expect(await applyIsolatedTestPlan(admin, plan)).toBe(0);
        const history = await admin.query(
          "SELECT version,name,checksum FROM schema_migrations WHERE version<>'0240' ORDER BY version",
        );
        expect(history.rows).toEqual(beforeHistory);
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
      const other = await seedTeacher(pool, 'reports-other');
      const otherPrincipal = (
        await pool.query(
          'SELECT principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
          [other.tenantId, other.teacherId],
        )
      ).rows[0].principal_id as string;
      const repo = new PgProjectRepository(pool);
      async function makePublication(index: number) {
        const createdProject = await repo.createWithDraft({
          tenantId: teacher.tenantId,
          scope: 'personal',
          classroomId: null,
          actor: { userId: teacher.teacherId, principalId: principal },
          moduleKey: 'electronics',
          title: 'Report fixture ' + index,
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
            bytes: new Uint8Array(64).fill(17),
            contentType: 'image/png',
            width: 16,
            height: 16,
          },
        });
        const status = await pool!.query(
          'SELECT project_publication_publish($1,$2,$3::jsonb) AS result',
          [principal, createdProject.project.id, JSON.stringify({ title: 'Published ' + index })],
        );
        return status.rows[0].result.publication as {
          publicationId: string;
          revisionId: string;
        };
      }
      const publication = await makePublication(0);
      function report(
        actor: string,
        pub: { publicationId: string; revisionId: string },
        reason: string,
        key: string,
      ) {
        return pool!.query<{
          receipt: { reportId: string; status: string; duplicate: boolean };
        }>('SELECT project_publication_report_create($1,$2,$3,$4,$5,$6) AS receipt', [
          actor,
          pub.publicationId,
          pub.revisionId,
          reason,
          'Please review',
          key,
        ]);
      }

      const app = await pool.connect();
      try {
        await app.query('SET ROLE asalab_app');
        for (const sql of [
          'SELECT * FROM project_publication_reports',
          'DELETE FROM project_publication_reports',
          "INSERT INTO project_publication_reports(publication_id,revision_id,reporter_principal_id,reason,request_key) VALUES (gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'spam','direct')",
        ]) {
          await expect(app.query(sql)).rejects.toMatchObject({ code: '42501' });
        }
        const received = await app.query(
          'SELECT project_publication_report_create($1,$2,$3,$4,$5,$6) AS receipt',
          [
            principal,
            publication.publicationId,
            publication.revisionId,
            'spam',
            'Please review',
            'first-report',
          ],
        );
        expect(received.rows[0].receipt).toMatchObject({
          status: 'received',
          duplicate: false,
        });
      } finally {
        await app.query('RESET ROLE');
        app.release();
      }
      const stored = (await pool.query('SELECT * FROM project_publication_reports')).rows;
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        publication_id: publication.publicationId,
        revision_id: publication.revisionId,
        reporter_principal_id: principal,
        reason: 'spam',
        status: 'open',
      });
      expect(
        (
          await pool.query('SELECT state FROM project_publication_state WHERE id=$1', [
            publication.publicationId,
          ])
        ).rows[0].state,
      ).toBe('public');
      expect((await pool.query('SELECT * FROM project_publication_moderation')).rows).toEqual([]);

      expect(
        (await report(principal, publication, 'spam', 'first-report')).rows[0].receipt,
      ).toMatchObject({ reportId: stored[0].id as string, duplicate: true });
      expect(
        (await report(principal, publication, 'spam', 'another-key')).rows[0].receipt.duplicate,
      ).toBe(true);
      expect(
        (await report(otherPrincipal, publication, 'spam', 'other-author')).rows[0].receipt
          .duplicate,
      ).toBe(false);
      await expect(
        report(principal, publication, 'copyright', 'changed-reason'),
      ).rejects.toMatchObject({ code: 'P5R09' });
      await expect(
        pool.query('SELECT project_publication_report_create($1,$2,$3,$4,$5,$6)', [
          principal,
          publication.publicationId,
          randomUUID(),
          'spam',
          '',
          'stale-revision',
        ]),
      ).rejects.toMatchObject({ code: 'P5R09' });
      await expect(
        pool.query('SELECT project_publication_report_create($1,$2,$3,$4,$5,$6)', [
          principal,
          publication.publicationId,
          publication.revisionId,
          'not-a-reason',
          '',
          'bad',
        ]),
      ).rejects.toMatchObject({ code: '22023' });
      await expect(
        pool.query('SELECT project_publication_report_create($1,$2,$3,$4,$5,$6)', [
          principal,
          randomUUID(),
          publication.revisionId,
          'spam',
          '',
          'inaccessible',
        ]),
      ).rejects.toMatchObject({ code: 'P5P04' });

      await pool.query(
        "INSERT INTO project_publication_moderation(publication_id,hidden,reason,actor_principal_id) VALUES ($1,true,'Restricted',$2)",
        [publication.publicationId, principal],
      );
      await expect(report(principal, publication, 'spam', 'while-hidden')).rejects.toMatchObject({
        code: 'P5P04',
      });

      const second = await makePublication(1);
      const simultaneous = await Promise.all(
        Array.from({ length: 3 }, () => report(principal, second, 'spam', 'concurrent-request')),
      );
      expect(new Set(simultaneous.map((item) => item.rows[0].receipt.reportId)).size).toBe(1);
      expect(simultaneous.filter((item) => !item.rows[0].receipt.duplicate)).toHaveLength(1);

      // A new report is still allowed for the tenth distinct publication, not the eleventh.
      for (let index = 2; index <= 9; index++) {
        const next = await makePublication(index);
        expect(
          (await report(principal, next, 'spam', 'quota-' + index)).rows[0].receipt.duplicate,
        ).toBe(false);
      }
      const overQuota = await makePublication(10);
      await expect(report(principal, overQuota, 'spam', 'quota-11')).rejects.toMatchObject({
        code: 'P5R29',
      });
      expect(
        (
          await pool.query(
            'SELECT count(*)::integer AS n FROM project_publication_reports WHERE reporter_principal_id=$1',
            [principal],
          )
        ).rows[0].n,
      ).toBe(10);
      expect(
        (
          await pool.query(
            "SELECT has_table_privilege('asalab_app','public.project_publication_reports','SELECT') AS read, has_table_privilege('asalab_app','public.project_publication_reports','INSERT') AS write, has_function_privilege('asalab_app','public.project_publication_report_create(uuid,uuid,uuid,text,text,text)','EXECUTE') AS call",
          )
        ).rows[0],
      ).toEqual({ read: false, write: false, call: true });
    } finally {
      await pool?.end();
      if (created) await owner.query('DROP DATABASE "' + name + '"');
      await owner.end();
    }
  }, 240_000);
});
