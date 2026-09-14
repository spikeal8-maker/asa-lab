import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { expect, it } from 'vitest';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan } from '../migration/isolated-postgres-plan';
import { seedTeacher } from '../portal/helpers';

it('upgrades populated 0136: unchanged publications stay closed, changed/unpublished courses retain drafts and revisions/history', async () => {
  const source = process.env['TEST_DATABASE_URL'];
  if (!source || !new URL(source).pathname.endsWith('_test'))
    throw new Error('Isolated test database required');
  const name = 'asa_draft_upgrade_' + randomUUID().replaceAll('-', '') + '_test';
  const cluster = new pg.Client({ connectionString: source });
  await cluster.connect();
  await cluster.query('CREATE DATABASE "' + name + '"');
  const url = new URL(source);
  url.pathname = '/' + name;
  const pool = new pg.Pool({ connectionString: url.toString() });
  try {
    const planned = planMigrations('migrations');
    const pending = planned.filter((entry: { version: string }) => entry.version > '0136');
    expect(pending[0]?.version).toBe('0137');
    const client = await pool.connect();
    try {
      await applyIsolatedTestPlan(
        client,
        planned.filter((entry: { version: string }) => entry.version <= '0136'),
      );
    } finally {
      client.release();
    }
    const teacher = await seedTeacher(pool, 'draft-upgrade');
    const who = (
      await pool.query(
        'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
        [teacher.tenantId, teacher.teacherId],
      )
    ).rows[0];
    const ids: string[] = [];
    for (let index = 0; index < 5; index++) {
      const id = (
        await pool.query(
          "SELECT * FROM course_save_v2($1,$2,NULL,$3,NULL,NULL,'private',NULL,$4)",
          [who.principal_id, teacher.tenantId, 'Legacy ' + index, 'draft:upgrade:' + index],
        )
      ).rows[0].id;
      ids.push(id);
      const section = (
        await pool.query('SELECT * FROM course_outline_v3($1,$2,$3,$4)', [
          id,
          who.principal_id,
          who.account_id,
          teacher.tenantId,
        ])
      ).rows[0].section_id;
      await pool.query(
        "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Theory',NULL,'[]'::jsonb,'material',NULL,NULL,NULL)",
        [who.principal_id, id, section],
      );
      if (index >= 3) {
        if (index === 3)
          await pool.query(
            "UPDATE course_lessons SET content='Legacy paragraph',blocks=jsonb_build_array(jsonb_build_object('id','legacy-'||replace(id::text,'-',''),'type','paragraph','text','Legacy paragraph')) WHERE course_id=$1",
            [id],
          );
        const outline = (await pool.query('SELECT course_snapshot_build($1) AS snapshot', [id]))
          .rows[0].snapshot;
        for (const section of outline.sections)
          for (const lesson of section.lessons) {
            delete lesson.learningActivityVersionId;
            if (index === 3) {
              delete lesson.blocks;
            }
          }
        outline.schemaVersion = index === 3 ? 1 : 2;
        await pool.query(
          'INSERT INTO course_versions(tenant_id,course_id,version_number,title,outline,content_hash,published_by_principal_id) VALUES($1,$2,1,$3,$4::jsonb,md5(($4::jsonb)::text),$5)',
          [teacher.tenantId, id, 'Legacy ' + index, JSON.stringify(outline), who.principal_id],
        );
      }
      if (index < 2)
        await pool.query('SELECT * FROM course_publish($1,$2)', [who.principal_id, id]);
      if (index === 1)
        await pool.query("UPDATE courses SET title='Unpublished change' WHERE id=$1", [id]);
    }
    const before = (
      await pool.query(
        'SELECT id,draft_revision FROM courses WHERE id=ANY($1::uuid[]) ORDER BY id',
        [ids],
      )
    ).rows;
    const history = (
      await pool.query('SELECT row_to_json(v)::text AS bytes FROM course_versions v ORDER BY id')
    ).rows;
    const upgrade = await pool.connect();
    try {
      expect(await applyIsolatedTestPlan(upgrade, planned)).toBe(pending.length);
    } finally {
      upgrade.release();
    }
    expect(
      (
        await pool.query(
          'SELECT id,draft_revision FROM courses WHERE id=ANY($1::uuid[]) ORDER BY id',
          [ids],
        )
      ).rows,
    ).toEqual(before);
    expect(
      (await pool.query('SELECT row_to_json(v)::text AS bytes FROM course_versions v ORDER BY id'))
        .rows,
    ).toEqual(history);
    const states = (
      await pool.query(
        'SELECT id,draft_active,draft_base_version_id,draft_started_revision FROM courses WHERE id=ANY($1::uuid[])',
        [ids],
      )
    ).rows;
    expect(states.find((row) => row.id === ids[0])).toMatchObject({
      draft_active: false,
      draft_base_version_id: null,
      draft_started_revision: null,
    });
    expect(states.find((row) => row.id === ids[1])).toMatchObject({
      draft_active: true,
      draft_base_version_id: expect.any(String),
      draft_started_revision: expect.any(Number),
    });
    expect(states.find((row) => row.id === ids[2])).toMatchObject({
      draft_active: true,
      draft_base_version_id: null,
      draft_started_revision: expect.any(Number),
    });
    for (const id of ids.slice(3)) {
      expect(states.find((row) => row.id === id)).toMatchObject({
        draft_active: false,
        draft_base_version_id: null,
      });
      const version = (await pool.query('SELECT id FROM course_versions WHERE course_id=$1', [id]))
        .rows[0].id;
      const revision = (await pool.query('SELECT draft_revision FROM courses WHERE id=$1', [id]))
        .rows[0].draft_revision;
      expect(
        (
          await pool.query('SELECT * FROM course_draft_from_version($1,$2,$3,$4)', [
            who.principal_id,
            id,
            version,
            revision,
          ])
        ).rows[0].result_code,
      ).toBe('ok');
      expect(
        (await pool.query('SELECT * FROM course_publish($1,$2)', [who.principal_id, id])).rows[0],
      ).toMatchObject({ version_id: version, reused: true });
    }
  } finally {
    await pool.end();
    // Only this freshly generated fixture database; never the configured database.
    if (!/^asa_draft_upgrade_[a-f0-9]{32}_test$/.test(name)) throw new Error('Unsafe fixture name');
    await cluster.query('DROP DATABASE "' + name + '"');
    await cluster.end();
  }
}, 120000);
