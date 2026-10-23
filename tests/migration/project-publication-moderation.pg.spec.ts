import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan } from './isolated-postgres-plan';
import { seedTeacher } from '../portal/helpers';
import { PgProjectRepository } from '../../contexts/projects/infrastructure/pg-project.repository';

describe('0236 additive publication moderation upgrade', () => {
  it('preserves all 0235 publication/original bytes and restricts runtime privileges', async () => {
    const source = process.env['TEST_DATABASE_URL'];
    if (!source || !new URL(source).pathname.endsWith('_test'))
      throw new Error('Isolated TEST_DATABASE_URL required');
    const name = 'asa_moderation_' + randomUUID().replaceAll('-', '') + '_test';
    if (!/^asa_moderation_[a-f0-9]{32}_test$/.test(name))
      throw new Error('Unsafe test database name');
    const owner = new pg.Client({ connectionString: source });
    let pool: pg.Pool | undefined;
    let createdDatabase = false;
    try {
      await owner.connect();
      await owner.query('CREATE DATABASE "' + name + '"');
      createdDatabase = true;
      const url = new URL(source);
      url.pathname = '/' + name;
      pool = new pg.Pool({ connectionString: url.href, max: 2 });
      const plan = planMigrations();
      const client = await pool.connect();
      try {
        const prefix = plan.filter((item) => Number(item.version) <= 235);
        expect(prefix.at(-1)?.version).toBe('0235');
        await applyIsolatedTestPlan(client, prefix);
      } finally {
        client.release();
      }
      const teacher = await seedTeacher(pool, 'moderation-upgrade');
      const identity = (
        await pool.query(
          'SELECT principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
          [teacher.tenantId, teacher.teacherId],
        )
      ).rows[0];
      const actor = { userId: teacher.teacherId, principalId: identity.principal_id as string };
      const repo = new PgProjectRepository(pool);
      const created = await repo.createWithDraft({
        tenantId: teacher.tenantId,
        scope: 'personal',
        classroomId: null,
        actor,
        moduleKey: 'electronics',
        title: 'Preserve private original',
        idempotencyKey: randomUUID(),
        requestFingerprint: randomUUID().replaceAll('-', '').repeat(2),
        initialDocument: {
          schemaVersion: 1,
          components: [],
          connections: [],
          privateMarker: randomUUID(),
        },
        initialPreview: null,
      });
      if (created.kind !== 'created') throw new Error('Fixture not created');
      const projectId = created.project.id;
      await repo.saveSnapshot({
        tenantId: teacher.tenantId,
        actor,
        projectId,
        sourceRevision: 1,
        image: {
          bytes: new Uint8Array(64).fill(17),
          contentType: 'image/png',
          width: 16,
          height: 16,
        },
      });
      const publication = (
        await pool.query('SELECT project_publication_publish($1,$2,$3::jsonb) AS result', [
          actor.principalId,
          projectId,
          JSON.stringify({ title: 'Frozen legacy 0235 publication' }),
        ])
      ).rows[0].result.publication;
      const tables = [
        'projects',
        'project_drafts',
        'project_versions',
        'project_snapshots',
        'project_publications',
        'project_publication_state',
        'project_publication_revisions',
        'administrative_audit_events',
        'schema_migrations',
      ];
      const snapshot = async () => {
        const result: Record<string, unknown> = {};
        for (const table of tables)
          result[table] = (
            await pool!.query(
              `SELECT to_jsonb(t) AS item FROM public.${table} t ORDER BY to_jsonb(t)::text`,
            )
          ).rows;
        return result;
      };
      const before = await snapshot();
      const moderationPlan = plan.filter((item) => Number(item.version) <= 236);
      const upgrade = await pool.connect();
      try {
        expect(
          moderationPlan.filter((item) => Number(item.version) > 235).map((item) => item.version),
        ).toEqual(['0236']);
        expect(await applyIsolatedTestPlan(upgrade, moderationPlan)).toBe(1);
        expect(await applyIsolatedTestPlan(upgrade, moderationPlan)).toBe(0);
      } finally {
        upgrade.release();
      }
      const after = await snapshot();
      for (const table of tables.filter((table) => table !== 'schema_migrations'))
        expect(after[table]).toEqual(before[table]);
      expect(
        (
          await pool.query(
            "SELECT to_jsonb(t) AS item FROM schema_migrations t WHERE version<>'0236' ORDER BY to_jsonb(t)::text",
          )
        ).rows,
      ).toEqual(before['schema_migrations']);
      expect((await pool.query('SELECT * FROM project_publication_moderation')).rows).toEqual([]);
      expect(
        (
          await pool.query('SELECT * FROM public_project_image($1,NULL)', [
            publication.publicationId,
          ])
        ).rows[0].image,
      ).toEqual(Buffer.alloc(64, 17));
      const restricted = await pool.connect();
      try {
        await restricted.query('SET ROLE asalab_app');
        for (const statement of [
          'SELECT * FROM project_publication_moderation',
          'DELETE FROM project_publication_moderation',
          'UPDATE project_publication_moderation SET hidden=false',
        ]) {
          await expect(restricted.query(statement)).rejects.toMatchObject({ code: '42501' });
        }
        await expect(
          restricted.query('SELECT admin_publications_list(NULL,0,25)'),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          restricted.query('SELECT project_publication_readable($1)', [publication.publicationId]),
        ).rejects.toMatchObject({ code: '42501' });
      } finally {
        await restricted.query('RESET ROLE');
        restricted.release();
      }
      expect(
        (
          await pool.query(`SELECT has_table_privilege('asalab_app','public.project_publication_moderation','SELECT') AS read,
        has_table_privilege('asalab_app','public.project_publication_moderation','INSERT') AS write,
        has_function_privilege('asalab_app','public.admin_publications_list(uuid,integer,integer)','EXECUTE') AS call`)
        ).rows[0],
      ).toEqual({ read: false, write: false, call: true });
    } finally {
      await pool?.end();
      if (createdDatabase) await owner.query('DROP DATABASE "' + name + '"');
      await owner.end();
    }
  }, 180_000);
});
