import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { planMigrations } from '../../tools/migrate.mjs';
import { seedTeacher } from '../portal/helpers';
import { applyIsolatedTestPlan } from './isolated-postgres-plan';

describe('Course Builder structure forward upgrade', () => {
  it('keeps existing draft, version and run data unchanged while defaulting hidden=false', async () => {
    const source = process.env['TEST_DATABASE_URL'];
    if (!source || !new URL(source).pathname.endsWith('_test'))
      throw new Error('Isolated TEST_DATABASE_URL required');
    const name = 'asa_course_structure_' + randomUUID().replaceAll('-', '') + '_test';
    if (!/^asa_course_structure_[a-f0-9]{32}_test$/.test(name))
      throw new Error('Unsafe generated test database name');
    const owner = new pg.Client({ connectionString: source });
    let databaseCreated = false;
    let pool: pg.Pool | undefined;
    try {
      await owner.connect();
      await owner.query('CREATE DATABASE "' + name + '"');
      databaseCreated = true;
      const target = new URL(source);
      target.pathname = '/' + name;
      pool = new pg.Pool({ connectionString: target.toString(), max: 3 });
      const plan = planMigrations();
      const pre153 = plan.filter((item) => Number(item.version) <= 152);
      const bootstrap = await pool.connect();
      try {
        expect(await applyIsolatedTestPlan(bootstrap, pre153)).toBeGreaterThan(0);
      } finally {
        bootstrap.release();
      }

      const teacher = await seedTeacher(pool, 'course-structure-forward');
      const identity = await pool.query(
        'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
        [teacher.tenantId, teacher.teacherId],
      );
      const principal = identity.rows[0].principal_id as string;
      const account = identity.rows[0].account_id as string;
      const activity = (
        await pool.query(
          "SELECT * FROM learning_activity_save_v2($1,$2,NULL,'project',$3,'Keep exact pin',$4,'completion',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)",
          [principal, teacher.tenantId, 'Pinned forward material', 'electronics'],
        )
      ).rows[0];
      const publishedActivity = (
        await pool.query('SELECT * FROM learning_activity_publish_v2($1,$2,$3,$4)', [
          principal,
          activity.activity_id,
          activity.draft_revision,
          'course-structure-forward-activity',
        ])
      ).rows[0];
      const courseId = (
        await pool.query(
          "SELECT course_save($1,NULL,'Forward structure course','Preserve history',NULL,'private') AS id",
          [principal],
        )
      ).rows[0].id as string;
      const sectionId = (
        await pool.query('SELECT section_id FROM course_outline_v3($1,$2,$3,$4) LIMIT 1', [
          courseId,
          principal,
          account,
          teacher.tenantId,
        ])
      ).rows[0].section_id as string;
      const blocks = [
        { id: 'pinned-title', type: 'heading', level: 2, text: 'Pinned block' },
        { id: 'pinned-code', type: 'code', language: 'text', text: '<safe>' },
      ];
      const lessonId = (
        await pool.query(
          "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Pinned lesson',NULL,$4::jsonb,'assignment',NULL,15,$5) AS id",
          [principal, courseId, sectionId, JSON.stringify(blocks), publishedActivity.version_id],
        )
      ).rows[0].id as string;
      const published = (await pool.query('SELECT * FROM course_publish($1,$2)', [principal, courseId])).rows[0];
      const versionId = published.version_id as string;

      const classroom = (
        await pool.query(
          "INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,'Forward structure class',$4) RETURNING id",
          [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
        )
      ).rows[0].id as string;
      await pool.query(
        "INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner')",
        [teacher.tenantId, classroom, teacher.teacherId, account],
      );
      const assigned = (
        await pool.query(
          "SELECT * FROM classroom_course_run_assign_v3($1,$2,$3,NULL,1,'whole_class','{}'::uuid[],$4)",
          [principal, classroom, courseId, 'course-structure-forward-run'],
        )
      ).rows[0];
      const runId = assigned.run_id as string;

      const draftBefore = (
        await pool.query(
          'SELECT section.id AS section_id,lesson.id AS lesson_id,lesson.blocks,lesson.learning_activity_version_id FROM course_sections section JOIN course_lessons lesson ON lesson.section_id=section.id WHERE section.id=$1 AND lesson.id=$2',
          [sectionId, lessonId],
        )
      ).rows[0];
      const versionBefore = (
        await pool.query('SELECT id,outline,content_hash FROM course_versions WHERE id=$1', [versionId])
      ).rows[0];
      const runBefore = (
        await pool.query(
          'SELECT id,source_section_id,source_lesson_id,blocks FROM classroom_course_run_lessons WHERE run_id=$1 ORDER BY id',
          [runId],
        )
      ).rows;
      const activityRunsBefore = (
        await pool.query(
          'SELECT source_lesson_id,learning_activity_version_id FROM activity_runs WHERE source_course_run_id=$1 ORDER BY source_lesson_id',
          [runId],
        )
      ).rows;

      const upgrade = await pool.connect();
      try {
        expect(await applyIsolatedTestPlan(upgrade, plan)).toBe(1);
        expect(await applyIsolatedTestPlan(upgrade, plan)).toBe(0);
      } finally {
        upgrade.release();
      }

      const draftAfter = (
        await pool.query(
          'SELECT section.id AS section_id,section.hidden AS section_hidden,lesson.id AS lesson_id,lesson.hidden AS lesson_hidden,lesson.blocks,lesson.learning_activity_version_id FROM course_sections section JOIN course_lessons lesson ON lesson.section_id=section.id WHERE section.id=$1 AND lesson.id=$2',
          [sectionId, lessonId],
        )
      ).rows[0];
      expect(draftAfter).toEqual({ ...draftBefore, section_hidden: false, lesson_hidden: false });
      expect((await pool.query('SELECT id,outline,content_hash FROM course_versions WHERE id=$1', [versionId])).rows[0]).toEqual(versionBefore);
      expect((await pool.query('SELECT id,source_section_id,source_lesson_id,blocks FROM classroom_course_run_lessons WHERE run_id=$1 ORDER BY id', [runId])).rows).toEqual(runBefore);
      expect((await pool.query('SELECT source_lesson_id,learning_activity_version_id FROM activity_runs WHERE source_course_run_id=$1 ORDER BY source_lesson_id', [runId])).rows).toEqual(activityRunsBefore);
    } finally {
      await pool?.end();
      if (databaseCreated) await owner.query('DROP DATABASE "' + name + '"');
      await owner.end();
    }
  }, 30_000);
});
