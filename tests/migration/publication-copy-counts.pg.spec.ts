import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { expect, it } from 'vitest';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan } from './isolated-postgres-plan';
import { seedTeacher } from '../portal/helpers';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';

it('backfills only provable successful copies from286 without rewriting projects or revisions', async () => {
  const source = process.env.TEST_DATABASE_URL,
    appSource = process.env.APP_TEST_DATABASE_URL;
  if (
    !source ||
    !appSource ||
    !new URL(source).pathname.endsWith('_test') ||
    new URL(source).pathname !== new URL(appSource).pathname
  )
    throw Error('Same isolated admin/app test database required');
  const database = 'asa_copy_count_' + randomUUID().replaceAll('-', '') + '_test';
  const owner = new pg.Client({ connectionString: source });
  let created = false;
  let admin: pg.Pool | undefined, runtime: pg.Pool | undefined;
  try {
    await owner.connect();
    await owner.query('CREATE DATABASE "' + database + '"');
    created = true;
    const target = new URL(source);
    target.pathname = '/' + database;
    const appTarget = new URL(appSource);
    appTarget.pathname = '/' + database;
    admin = new pg.Pool({ connectionString: target.href, max: 2 });
    runtime = new pg.Pool({ connectionString: appTarget.href, max: 2 });
    const migration = await admin.connect();
    try {
      const plan = planMigrations(),
        prefix = plan.filter((x) => Number(x.version) <= 286),
        complete = plan.filter((x) => Number(x.version) <= 287);
      await applyIsolatedTestPlan(migration, prefix);
      const teacher = await seedTeacher(admin, 'copy-count-upgrade');
      const identity = (
        await admin.query(
          'SELECT principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
          [teacher.tenantId, teacher.teacherId],
        )
      ).rows[0];
      const actor = { principalId: identity.principal_id as string, userId: teacher.teacherId };
      const repo = new PgProjectRepository(runtime);
      const base = {
        tenantId: teacher.tenantId,
        scope: 'personal' as const,
        classroomId: null,
        actor,
        moduleKey: 'electronics',
        title: 'Copy count source',
        idempotencyKey: randomUUID(),
        requestFingerprint: randomUUID().replaceAll('-', '').repeat(2),
        initialDocument: { schemaVersion: 1, components: [], connections: [] },
        initialPreview: null,
      };
      const project = await repo.createWithDraft(base);
      if (project.kind !== 'created') throw Error('Source fixture not created');
      await repo.saveSnapshot({
        tenantId: teacher.tenantId,
        actor,
        projectId: project.project.id,
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
          project.project.id,
          JSON.stringify({ license: 'public-domain' }),
        ])
      ).rows[0].value.publication;
      const revision = (
        await admin.query(
          'SELECT project_version_id FROM project_publication_revisions WHERE id=$1',
          [published.revisionId],
        )
      ).rows[0];
      const copyInput = {
        ...base,
        title: 'Actual old personal copy',
        idempotencyKey: randomUUID(),
        publicationCopyOrigin: {
          projectId: project.project.id,
          publicationId: published.publicationId,
          revisionId: published.revisionId,
          versionId: revision.project_version_id as string,
          title: base.title,
          author: 'Fixture author',
          license: 'public-domain' as const,
        },
      };
      const oldCopy = await repo.createWithDraft(copyInput);
      if (oldCopy.kind !== 'created') throw Error('Old copy fixture not created');
      const frozen = async () =>
        (
          await admin!.query(
            'SELECT to_jsonb(p) row FROM projects p WHERE id=ANY($1::uuid[]) ORDER BY id',
            [[project.project.id, oldCopy.project.id]],
          )
        ).rows;
      const before = await frozen();
      expect(await applyIsolatedTestPlan(migration, complete)).toBe(1);
      expect(await applyIsolatedTestPlan(migration, complete)).toBe(0);
      expect(await frozen()).toEqual(before);
      const total = async () =>
        Number(
          (
            await runtime!.query('SELECT public.publication_copy_count($1) n', [
              published.publicationId,
            ])
          ).rows[0].n,
        );
      expect(await total()).toBe(1);
      const newInput = { ...copyInput, idempotencyKey: randomUUID() };
      expect((await repo.createWithDraft(newInput)).kind).toBe('created');
      expect(await total()).toBe(2);
      expect((await repo.createWithDraft(newInput)).kind).toBe('existing');
      expect(await total()).toBe(2);
      expect(
        (
          await admin.query(
            'SELECT destination_project_id,publication_id FROM publication_copy_events WHERE destination_project_id=$1',
            [oldCopy.project.id],
          )
        ).rows,
      ).toEqual([
        { destination_project_id: oldCopy.project.id, publication_id: published.publicationId },
      ]);
      await expect(runtime.query('SELECT * FROM publication_copy_events')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      migration.release();
    }
  } finally {
    await runtime?.end();
    await admin?.end();
    if (created) await owner.query('DROP DATABASE "' + database + '"');
    await owner.end();
  }
}, 180_000);
