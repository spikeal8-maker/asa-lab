import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { expect, it } from 'vitest';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan } from './isolated-postgres-plan';
import { seedTeacher } from '../portal/helpers';

it('upgrades 0322 to 0323 without inventing historical origin or copy receipts', async () => {
  const source = process.env.TEST_DATABASE_URL;
  const appSource = process.env.APP_TEST_DATABASE_URL;
  if (
    !source ||
    !appSource ||
    !new URL(source).pathname.endsWith('_test') ||
    new URL(source).pathname !== new URL(appSource).pathname
  ) {
    throw new Error('Same isolated admin/app TEST_DATABASE_URL required');
  }
  const name = 'asa_c3_origin_' + randomUUID().replaceAll('-', '') + '_test';
  const owner = new pg.Client({ connectionString: source });
  let created = false;
  let admin: pg.Pool | undefined;
  let runtime: pg.Pool | undefined;
  try {
    await owner.connect();
    await owner.query('CREATE DATABASE "' + name + '"');
    created = true;
    const adminUrl = new URL(source);
    const appUrl = new URL(appSource);
    adminUrl.pathname = '/' + name;
    appUrl.pathname = '/' + name;
    admin = new pg.Pool({ connectionString: adminUrl.href, max: 3 });
    runtime = new pg.Pool({ connectionString: appUrl.href, max: 3 });

    const migrations = planMigrations();
    const prefix = migrations.filter((migration) => Number(migration.version) <= 322);
    const c3Plan = migrations.filter((migration) => Number(migration.version) <= 323);
    expect(prefix.at(-1)?.file).toBe('0322_student_group_rating.sql');
    expect(c3Plan.at(-1)?.file).toBe('0323_project_duplicate_origin.sql');
    expect(migrations.at(-1)?.file).toBe('0324_classroom_merit_history.sql');

    const migrationClient = await admin.connect();
    try {
      await applyIsolatedTestPlan(migrationClient, prefix);
      const teacher = await seedTeacher(admin, 'c3-historical-prefix');
      const legacy = (
        await admin.query(
          'SELECT principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
          [teacher.tenantId, teacher.teacherId],
        )
      ).rows[0];
      const actor = { principalId: legacy.principal_id as string, userId: teacher.teacherId };
      const repository = new PgProjectRepository(runtime);
      const rootId = randomUUID();
      const copyId = randomUUID();
      const document = { schemaVersion: 1, components: [], connections: [] };

      // Simulate the released 0322 SQL writer in its historical prefix.
      // The current repository's new private writer requires 0323.
      await admin.query(
        `INSERT INTO projects
          (id,tenant_id,project_scope,module_key,title,created_by,owner_principal_id,
           idempotency_key,request_fingerprint,license)
         VALUES ($1,$2,'personal','electronics','Historical independent root',$3,$4,$5,$6,'reserved')`,
        [
          rootId,
          teacher.tenantId,
          actor.userId,
          actor.principalId,
          randomUUID(),
          randomUUID().replaceAll('-', '').repeat(2),
        ],
      );
      await admin.query(
        `INSERT INTO project_drafts
          (project_id,tenant_id,document_json,updated_by,updated_by_principal_id)
         VALUES ($1,$2,$3::jsonb,$4,$5)`,
        [rootId, teacher.tenantId, JSON.stringify(document), actor.userId, actor.principalId],
      );
      await repository.saveSnapshot({
        tenantId: teacher.tenantId,
        actor,
        projectId: rootId,
        sourceRevision: 1,
        image: {
          bytes: new Uint8Array(64).fill(17),
          contentType: 'image/png',
          width: 16,
          height: 16,
        },
      });
      const published = (
        await runtime.query('SELECT project_publication_publish($1,$2,$3::jsonb) value', [
          actor.principalId,
          rootId,
          JSON.stringify({ license: 'public-domain' }),
        ])
      ).rows[0].value.publication as { publicationId: string; revisionId: string };
      const versionId = (
        await admin.query<{ project_version_id: string }>(
          'SELECT project_version_id FROM project_publication_revisions WHERE id=$1',
          [published.revisionId],
        )
      ).rows[0].project_version_id;

      const exactCopiedAt = '2026-11-14 11:22:33.123456+00';
      await admin.query(
        `INSERT INTO projects
          (id,tenant_id,project_scope,module_key,title,created_by,owner_principal_id,
           copied_from_project_id,copied_from_author,copied_from_title,copied_at,
           copied_from_publication_id,copied_from_revision_id,copied_from_version_id,
           copied_from_license,license)
         VALUES ($1,$2,'personal','electronics','Historical public copy',$3,$4,
                 $5,'Legacy author','Legacy title',$6::timestamptz,
                 $7,$8,$9,'public-domain','public-domain')`,
        [
          copyId,
          teacher.tenantId,
          actor.userId,
          actor.principalId,
          rootId,
          exactCopiedAt,
          published.publicationId,
          published.revisionId,
          versionId,
        ],
      );
      await admin.query(
        `INSERT INTO project_drafts
          (project_id,tenant_id,document_json,updated_by,updated_by_principal_id)
         VALUES ($1,$2,$3::jsonb,$4,$5)`,
        [copyId, teacher.tenantId, JSON.stringify(document), actor.userId, actor.principalId],
      );

      const receipts = async () =>
        (
          await admin!.query(
            'SELECT destination_project_id,publication_id,created_at FROM publication_copy_events ORDER BY destination_project_id',
          )
        ).rows;
      const beforeReceipts = await receipts();
      expect(beforeReceipts).toHaveLength(1);
      expect(beforeReceipts[0].destination_project_id).toBe(copyId);
      const beforeSource = (
        await admin.query(
          "SELECT to_jsonb(p) - 'writer_lineage_coverage' - 'writer_operation' as project FROM projects p WHERE id=ANY($1::uuid[]) ORDER BY id",
          [[rootId, copyId]],
        )
      ).rows;
      const originalHistory = (
        await admin.query('SELECT version,name,checksum FROM schema_migrations ORDER BY version')
      ).rows;
      expect(originalHistory.at(-1)?.version).toBe('0322');
      expect(await applyIsolatedTestPlan(migrationClient, c3Plan)).toBe(1);
      expect(await applyIsolatedTestPlan(migrationClient, c3Plan)).toBe(0);
      expect(
        (
          await admin.query(
            "SELECT version,name,checksum FROM schema_migrations WHERE version<>'0323' ORDER BY version",
          )
        ).rows,
      ).toEqual(originalHistory);
      expect(await receipts()).toEqual(beforeReceipts);
      expect(
        (
          await admin.query(
            "SELECT to_jsonb(p) - 'writer_lineage_coverage' - 'writer_operation' as project FROM projects p WHERE id=ANY($1::uuid[]) ORDER BY id",
            [[rootId, copyId]],
          )
        ).rows,
      ).toEqual(beforeSource);
      expect(
        (
          await admin.query(
            "SELECT COALESCE(e.writer_lineage_coverage,'unknown') AS writer_lineage_coverage FROM projects p LEFT JOIN project_writer_evidence e ON e.project_id=p.id WHERE p.id=ANY($1::uuid[]) ORDER BY p.id",
            [[rootId, copyId]],
          )
        ).rows,
      ).toEqual([{ writer_lineage_coverage: 'unknown' }, { writer_lineage_coverage: 'unknown' }]);

      expect(
        (
          await admin.query(
            "SELECT COALESCE(e.writer_operation,'unknown') AS writer_operation FROM projects p LEFT JOIN project_writer_evidence e ON e.project_id=p.id WHERE p.id=ANY($1::uuid[]) ORDER BY p.id",
            [[rootId, copyId]],
          )
        ).rows,
      ).toEqual([{ writer_operation: 'unknown' }, { writer_operation: 'unknown' }]);
      const readExact = async (id: string) =>
        (
          await admin!.query(
            `SELECT copied_from_project_id,copied_from_author,copied_from_title,
                  copied_at::text AS copied_at,copied_from_publication_id,
                  copied_from_revision_id,copied_from_version_id,copied_from_license,
                  COALESCE(e.writer_lineage_coverage,'unknown') AS writer_lineage_coverage
             FROM projects p LEFT JOIN project_writer_evidence e ON e.project_id=p.id
             WHERE p.id=$1`,
            [id],
          )
        ).rows[0];
      const original = await readExact(copyId);
      expect(original.copied_at).toContain('123456');
      const input = {
        tenantId: teacher.tenantId,
        projectId: copyId,
        actor,
        title: 'Inherited exact provenance',
        idempotencyKey: randomUUID(),
        requestFingerprint: randomUUID().replaceAll('-', '').repeat(2),
      };
      const first = await repository.duplicateWithDraft(input);
      expect(first.kind).toBe('created');
      if (first.kind !== 'created') throw Error('C3 ordinary duplicate was not created');
      expect(await readExact(first.project.id)).toEqual(original);
      expect(
        (
          await admin.query(
            "SELECT COALESCE(e.writer_operation,'unknown') AS writer_operation FROM project_writer_evidence e WHERE e.project_id=$1",
            [first.project.id],
          )
        ).rows[0].writer_operation,
      ).toBe('ordinary_duplicate');
      const replay = await repository.duplicateWithDraft(input);
      expect(replay.kind).toBe('existing');
      if (replay.kind !== 'existing') throw Error('C3 idempotent duplicate not returned');
      expect(replay.project.id).toBe(first.project.id);
      expect(await receipts()).toEqual(beforeReceipts);

      const child = await repository.duplicateWithDraft({
        ...input,
        projectId: first.project.id,
        idempotencyKey: randomUUID(),
      });
      expect(child.kind).toBe('created');
      if (child.kind !== 'created') throw Error('C3 chained ordinary duplicate not created');
      expect(await readExact(child.project.id)).toEqual(original);
      expect(await receipts()).toEqual(beforeReceipts);

      await admin.query(
        "UPDATE project_publication_state SET state='revoked',revoked_at=now() WHERE id=$1",
        [published.publicationId],
      );
      const revokedOriginChild = await repository.duplicateWithDraft({
        ...input,
        projectId: child.project.id,
        idempotencyKey: randomUUID(),
      });
      expect(revokedOriginChild.kind).toBe('created');
      if (revokedOriginChild.kind !== 'created') throw Error('Duplicate after revoke failed');
      expect(await readExact(revokedOriginChild.project.id)).toEqual(original);
      expect(await receipts()).toEqual(beforeReceipts);

      // Legacy Gallery origin has only the four old immutable fields.
      // Ordinary duplication must retain that exact proof without fabricating
      // a publication tuple or emitting a new copy receipt.
      const galleryId = randomUUID();
      await admin.query(
        `INSERT INTO projects
          (id,tenant_id,project_scope,module_key,title,created_by,owner_principal_id,
           copied_from_project_id,copied_from_author,copied_from_title,copied_at)
         VALUES ($1,$2,'personal','electronics','Known Gallery copy',$3,$4,
                 $5,'Gallery author','Gallery source',
                 '2026-11-14 15:16:17.654321+00'::timestamptz)`,
        [galleryId, teacher.tenantId, actor.userId, actor.principalId, rootId],
      );
      await admin.query(
        `INSERT INTO project_drafts
          (project_id,tenant_id,document_json,updated_by,updated_by_principal_id)
         VALUES ($1,$2,$3::jsonb,$4,$5)`,
        [galleryId, teacher.tenantId, JSON.stringify(document), actor.userId, actor.principalId],
      );
      const galleryOriginal = await readExact(galleryId);
      expect(galleryOriginal.copied_from_project_id).toBe(rootId);
      expect(galleryOriginal.copied_at).toContain('654321');
      expect(galleryOriginal.copied_from_publication_id).toBeNull();
      const galleryDuplicate = await repository.duplicateWithDraft({
        ...input,
        projectId: galleryId,
        idempotencyKey: randomUUID(),
      });
      expect(galleryDuplicate.kind).toBe('created');
      if (galleryDuplicate.kind !== 'created') throw Error('Gallery origin duplicate denied');
      expect(await readExact(galleryDuplicate.project.id)).toEqual(galleryOriginal);
      expect(await receipts()).toEqual(beforeReceipts);

      // Old writers and direct INSERTs do not claim new platform evidence.
      const directId = randomUUID();
      await admin.query(
        `INSERT INTO projects
          (id,tenant_id,project_scope,module_key,title,created_by,owner_principal_id)
          VALUES ($1,$2,'personal','electronics','Unknown historical writer',$3,$4)`,
        [directId, teacher.tenantId, actor.userId, actor.principalId],
      );
      expect(
        (
          await admin.query(
            "SELECT COALESCE(e.writer_lineage_coverage,'unknown') AS writer_lineage_coverage, COALESCE(e.writer_operation,'unknown') AS writer_operation FROM projects p LEFT JOIN project_writer_evidence e ON e.project_id=p.id WHERE p.id=$1",
            [directId],
          )
        ).rows[0],
      ).toEqual({ writer_lineage_coverage: 'unknown', writer_operation: 'unknown' });
      // A supported old/direct writer cannot be retroactively promoted by
      // calling the private helper in another transaction.
      const retroactive = await runtime.connect();
      try {
        await retroactive.query('BEGIN');
        await retroactive.query("SELECT set_config('app.tenant_id',$1,true)", [teacher.tenantId]);
        await expect(
          retroactive.query(
            'SELECT public.record_project_writer_evidence($1::uuid,$2::uuid,$3::varchar,$4::uuid)',
            [actor.principalId, directId, 'native', null],
          ),
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await retroactive.query('ROLLBACK');
        retroactive.release();
      }
      // Regression: updating title changes xmin, not the creation transaction.
      // Both an upgraded 0322 row and a newer direct-SQL row must stay unknown.
      for (const historicalProjectId of [rootId, directId]) {
        const sameTransaction = await runtime.connect();
        try {
          await sameTransaction.query('BEGIN');
          await sameTransaction.query("SELECT set_config('app.tenant_id',$1,true)", [
            teacher.tenantId,
          ]);
          const touched = await sameTransaction.query(
            'UPDATE projects SET title=title WHERE id=$1 RETURNING id',
            [historicalProjectId],
          );
          expect(touched.rows).toHaveLength(1);
          await expect(
            sameTransaction.query(
              'SELECT public.record_project_writer_evidence($1::uuid,$2::uuid,$3::varchar,$4::uuid)',
              [actor.principalId, historicalProjectId, 'native', null],
            ),
          ).rejects.toMatchObject({ code: '42501' });
        } finally {
          await sameTransaction.query('ROLLBACK');
          sameTransaction.release();
        }
      }
      const native = await repository.createWithDraft({
        tenantId: teacher.tenantId,
        scope: 'personal',
        classroomId: null,
        actor,
        moduleKey: 'electronics',
        title: 'New platform-native Project',
        idempotencyKey: randomUUID(),
        requestFingerprint: randomUUID().replaceAll('-', '').repeat(2),
        initialDocument: document,
        initialPreview: null,
      });
      expect(native.kind).toBe('created');
      if (native.kind !== 'created') throw Error('Native Project creation failed');
      expect(
        (
          await admin.query(
            "SELECT COALESCE(e.writer_lineage_coverage,'unknown') AS writer_lineage_coverage, COALESCE(e.writer_operation,'unknown') AS writer_operation FROM projects p LEFT JOIN project_writer_evidence e ON e.project_id=p.id WHERE p.id=$1",
            [native.project.id],
          )
        ).rows[0],
      ).toEqual({ writer_lineage_coverage: 'v1', writer_operation: 'native' });
      await expect(
        admin.query(
          "UPDATE project_writer_evidence SET writer_operation='public_acquisition' WHERE project_id=$1",
          [native.project.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      // The 0322 project predates writer-evidence records. An UPDATE against
      // its missing row is a no-op, not an immutability-trigger invocation.
      expect(
        (
          await admin.query('SELECT project_id FROM project_writer_evidence WHERE project_id=$1', [
            copyId,
          ])
        ).rows,
      ).toEqual([]);
      const ordinaryEvidence = async () =>
        (
          await admin.query(
            'SELECT writer_lineage_coverage, writer_operation FROM project_writer_evidence WHERE project_id=$1',
            [first.project.id],
          )
        ).rows;
      expect(await ordinaryEvidence()).toEqual([
        { writer_lineage_coverage: 'unknown', writer_operation: 'ordinary_duplicate' },
      ]);
      await expect(
        admin.query(
          "UPDATE project_writer_evidence SET writer_lineage_coverage='v1' WHERE project_id=$1",
          [first.project.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      expect(await ordinaryEvidence()).toEqual([
        { writer_lineage_coverage: 'unknown', writer_operation: 'ordinary_duplicate' },
      ]);
      await expect(runtime.query('SELECT * FROM project_writer_evidence')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(
        runtime.query('SELECT * FROM project_writer_insert_witness'),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(runtime.query('SELECT * FROM publication_copy_events')).rejects.toMatchObject({
        code: '42501',
      });
      await expect(
        runtime.query('SELECT public.record_publication_copy_created()'),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        runtime.query('SELECT public.record_publication_copy_acquisition($1,$2,$3,$4)', [
          randomUUID(),
          copyId,
          published.publicationId,
          published.revisionId,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      migrationClient.release();
    }
  } finally {
    await runtime?.end();
    await admin?.end();
    if (created) await owner.query('DROP DATABASE "' + name + '"');
    await owner.end();
  }
}, 180_000);
