import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan } from './isolated-postgres-plan';
import { seedTeacher } from '../portal/helpers';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';

describe('0259 additive public-project reports on disposable PostgreSQL', () => {
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
      const plan = planMigrations().filter((migration) => Number(migration.version) <= 259);
      const prefix = plan.filter((migration) => Number(migration.version) <= 258);
      expect(prefix.at(-1)?.version).toBe('0258');
      expect(plan.at(-1)?.file).toBe('0259_project_publication_reports.sql');
      const admin = await pool.connect();
      try {
        await applyIsolatedTestPlan(admin, prefix);
        const beforeHistory = (
          await admin.query('SELECT version,name,checksum FROM schema_migrations ORDER BY version')
        ).rows;
        expect(await applyIsolatedTestPlan(admin, plan)).toBe(1);
        expect(await applyIsolatedTestPlan(admin, plan)).toBe(0);
        const history = await admin.query(
          "SELECT version,name,checksum FROM schema_migrations WHERE version<>'0259' ORDER BY version",
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
      const publication = await makePublication(0);
      // The incoming report must not rewrite any author-owned Project data.
      const coreSql = [
        'SELECT to_jsonb(p) AS data FROM public.projects p WHERE p.id=$1',
        'SELECT to_jsonb(d) AS data FROM public.project_drafts d WHERE d.project_id=$1',
        'SELECT to_jsonb(s) AS data FROM public.project_snapshots s WHERE s.project_id=$1',
      ];
      const coreBefore = await Promise.all(
        coreSql.map((sql) => pool!.query(sql, [publication.projectId])),
      );
      function report(
        actor: string,
        pub: { publicationId: string; revisionId: string },
        reason: string,
        key: string,
        comment = 'Please review',
      ) {
        return pool!.query<{
          receipt: { reportId: string; status: string; duplicate: boolean };
        }>('SELECT project_publication_report_create($1,$2,$3,$4,$5,$6) AS receipt', [
          actor,
          pub.publicationId,
          pub.revisionId,
          reason,
          comment,
          key,
        ]);
      }

      const app = await pool.connect();
      try {
        await app.query('SET ROLE asalab_app');
        for (const sql of [
          'SELECT * FROM project_publication_reports',
          'DELETE FROM project_publication_reports',
          "UPDATE project_publication_reports SET status='resolved'",
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
      const coreAfter = await Promise.all(
        coreSql.map((sql) => pool!.query(sql, [publication.projectId])),
      );
      expect(coreAfter.map((result) => result.rows)).toEqual(
        coreBefore.map((result) => result.rows),
      );

      expect(
        (await report(principal, publication, 'spam', 'first-report')).rows[0].receipt,
      ).toMatchObject({ reportId: stored[0].id as string, duplicate: true });
      await expect(report(principal, publication, 'spam', 'another-key')).rejects.toMatchObject({
        code: 'P5R09',
      });
      expect(
        (await report(otherPrincipal, publication, 'spam', 'other-author')).rows[0].receipt
          .duplicate,
      ).toBe(false);
      await expect(
        report(principal, publication, 'copyright', 'changed-reason'),
      ).rejects.toMatchObject({ code: 'P5R09' });
      await expect(report(principal, publication, 'abuse', 'first-report')).rejects.toMatchObject({
        code: 'P5R09',
      });
      await expect(
        report(randomUUID(), publication, 'spam', 'forged-principal'),
      ).rejects.toMatchObject({ code: '42501' });
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
      await expect(report(principal, second, 'spam', 'first-report')).rejects.toMatchObject({
        code: 'P5R09',
      });

      // A new report is still allowed for the tenth distinct publication, not the eleventh.
      for (let index = 2; index <= 8; index++) {
        const next = await makePublication(index);
        expect(
          (await report(principal, next, 'spam', 'quota-' + index)).rows[0].receipt.duplicate,
        ).toBe(false);
      }
      const lastSlots = await Promise.all([makePublication(9), makePublication(19)]);
      const quotaRace = await Promise.allSettled(
        lastSlots.map((pub, index) => report(principal, pub, 'spam', 'quota-race-' + index)),
      );
      expect(quotaRace.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = quotaRace.find((result) => result.status === 'rejected');
      expect(rejected).toMatchObject({ status: 'rejected', reason: { code: 'P5R29' } });
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
      const unlisted = await makePublication(11);
      expect(
        (
          await pool.query("SELECT project_visibility_set($1,$2,'link') AS ok", [
            principal,
            unlisted.projectId,
          ])
        ).rows[0].ok,
      ).toBe(true);
      await expect(report(otherPrincipal, unlisted, 'spam', 'unlisted')).rejects.toMatchObject({
        code: 'P5P04',
      });

      const revoked = await makePublication(12);
      expect(
        (
          await pool.query('SELECT project_publication_revoke($1,$2) AS ok', [
            principal,
            revoked.projectId,
          ])
        ).rows[0].ok,
      ).toBe(true);
      await expect(report(otherPrincipal, revoked, 'spam', 'revoked')).rejects.toMatchObject({
        code: 'P5P04',
      });

      const privatePublication = await makePublication(20);
      await pool.query("SELECT project_visibility_set($1,$2,'private')", [
        principal,
        privatePublication.projectId,
      ]);
      await expect(
        report(otherPrincipal, privatePublication, 'spam', 'private'),
      ).rejects.toMatchObject({ code: 'P5P04' });
      const protectedPublication = await makePublication(21);
      await pool.query(
        `INSERT INTO learning_legacy_project_origins(project_id,project_tenant_id,school_tenant_id,source_work_id,claimed_at) VALUES ($1,$2,$2,$3,now())`,
        [protectedPublication.projectId, teacher.tenantId, randomUUID()],
      );
      await expect(
        report(otherPrincipal, protectedPublication, 'spam', 'learning'),
      ).rejects.toMatchObject({ code: 'P5P04' });
      const revised = await makePublication(22);
      const oldRevision = (
        await pool.query(
          'SELECT to_jsonb(r) AS data FROM project_publication_revisions r WHERE id=$1',
          [revised.revisionId],
        )
      ).rows;
      await pool.query('SELECT project_publication_publish($1,$2,$3::jsonb)', [
        principal,
        revised.projectId,
        JSON.stringify({ title: 'New immutable title' }),
      ]);
      await expect(
        report(otherPrincipal, revised, 'spam', 'old-actual-revision'),
      ).rejects.toMatchObject({ code: 'P5R09' });
      expect(
        (
          await pool.query(
            'SELECT to_jsonb(r) AS data FROM project_publication_revisions r WHERE id=$1',
            [revised.revisionId],
          )
        ).rows,
      ).toEqual(oldRevision);
      await pool.query(
        "UPDATE accounts SET status='suspended' WHERE id=(SELECT account_id FROM principals WHERE id=$1)",
        [otherPrincipal],
      );
      await expect(report(otherPrincipal, revised, 'spam', 'blocked-stale')).rejects.toMatchObject({
        code: 'P5R09',
      });
      // SQL independently rejects a disabled principal even if transport resolution is bypassed.
      await expect(report(otherPrincipal, second, 'spam', 'blocked')).rejects.toMatchObject({
        code: '42501',
      });
      await pool.query(
        "UPDATE accounts SET status='active' WHERE id=(SELECT account_id FROM principals WHERE id=$1)",
        [otherPrincipal],
      );

      const malicious = await makePublication(13);
      const sqlText = "'); DROP TABLE public.project_publication_reports; --";
      expect(
        (await report(otherPrincipal, malicious, 'other', 'literal-data', sqlText)).rows[0].receipt,
      ).toMatchObject({ status: 'received', duplicate: false });
      expect(
        (
          await pool.query('SELECT comment FROM project_publication_reports WHERE request_key=$1', [
            'literal-data',
          ])
        ).rows[0].comment,
      ).toBe(sqlText);

      // SQL uses the same ASCII-space normalization as transport; tabs and Unicode
      // whitespace remain meaningful, including at the 500-code-point boundary.
      for (const [index, whitespace] of ['\t', '\n', '\u00a0', '\u2003', '\ufeff'].entries()) {
        const boundary = await makePublication(30 + index);
        await expect(
          report(
            otherPrincipal,
            boundary,
            'spam',
            'boundary-over-' + index,
            whitespace + 'x'.repeat(500),
          ),
        ).rejects.toMatchObject({ code: '22023' });
        const text = whitespace + 'x'.repeat(499);
        await report(otherPrincipal, boundary, 'spam', 'boundary-' + index, ' ' + text + ' ');
        const storedComment = await pool.query(
          'SELECT comment FROM project_publication_reports WHERE request_key=$1',
          ['boundary-' + index],
        );
        expect(storedComment.rows[0].comment).toBe(text);
      }
      const unicode = await makePublication(14);
      expect(
        (await report(otherPrincipal, unicode, 'spam', 'unicode-500', '🚀'.repeat(500))).rows[0]
          .receipt,
      ).toMatchObject({ status: 'received', duplicate: false });
      expect(
        (
          await pool.query(
            'SELECT char_length(comment)::integer AS n FROM project_publication_reports WHERE request_key=$1',
            ['unicode-500'],
          )
        ).rows[0].n,
      ).toBe(500);
      await expect(
        report(otherPrincipal, unicode, 'spam', 'unicode-501', '🚀'.repeat(501)),
      ).rejects.toMatchObject({ code: '22023' });
      expect(
        (
          await pool.query(
            "SELECT to_regclass('public.project_publication_reports') IS NOT NULL AS intact",
          )
        ).rows[0].intact,
      ).toBe(true);
      expect(
        (
          await pool.query('SELECT state FROM project_publication_state WHERE id=$1', [
            malicious.publicationId,
          ])
        ).rows[0].state,
      ).toBe('public');

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
