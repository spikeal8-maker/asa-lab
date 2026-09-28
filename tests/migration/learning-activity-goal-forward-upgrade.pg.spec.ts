import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { planMigrations } from '../../tools/migrate.mjs';
import { seedTeacher } from '../portal/helpers';
import { applyIsolatedTestPlan } from './isolated-postgres-plan';

describe('Learning Activity goal forward upgrade', () => {
  it('reuses a real pre-0168 teacher-source receipt with the new omitted-goal entry point', async () => {
    const source = process.env['TEST_DATABASE_URL'];
    if (!source || !new URL(source).pathname.endsWith('_test'))
      throw new Error('Isolated TEST_DATABASE_URL required');
    const name = 'asa_learning_goal_' + randomUUID().replaceAll('-', '') + '_test';
    if (!/^asa_learning_goal_[a-f0-9]{32}_test$/.test(name))
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
      const beforeGoal = plan.filter((item) => Number(item.version) <= 167);
      const goalUpgrade = plan.filter((item) => item.version === '0168');
      expect(goalUpgrade).toHaveLength(1);
      const bootstrap = await pool.connect();
      try {
        expect(await applyIsolatedTestPlan(bootstrap, beforeGoal)).toBeGreaterThan(0);
      } finally {
        bootstrap.release();
      }

      const teacher = await seedTeacher(pool, 'learning-goal-forward');
      const identity = (
        await pool.query(
          'SELECT principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
          [teacher.tenantId, teacher.teacherId],
        )
      ).rows[0];
      const principalId = identity.principal_id as string;
      const sourceId = (
        await pool.query(
          `INSERT INTO teacher_assignments
             (tenant_id,owner_principal_id,title,brief,goal,module_key,visibility)
           VALUES ($1,$2,'Teacher source','Build the circuit','Inherited teacher goal',
                   'electronics','private') RETURNING id`,
          [teacher.tenantId, principalId],
        )
      ).rows[0].id as string;
      const policies = {
        attemptPolicy: { maxAttempts: 1 },
        resultSelectionPolicy: { mode: 'latest' },
        completionPolicy: { mode: 'submission' },
        latePolicy: { mode: 'allow_mark_late' },
        assessmentPolicy: { mode: 'manual' },
        feedbackReleasePolicy: { mode: 'after_review' },
      };
      const requestId = 'goal:forward:' + randomUUID();
      const args = [
        principalId,
        teacher.tenantId,
        'Teacher source',
        'Build the circuit',
        JSON.stringify(policies),
        sourceId,
        requestId,
      ];
      const legacy = (
        await pool.query(
          `SELECT * FROM learning_activity_create(
            $1,$2,'school','private','project',$3,$4,'completion',NULL,
            $5::jsonb,'electronics',NULL,NULL,$6,$7
          )`,
          args,
        )
      ).rows[0];
      expect(legacy.result_code).toBe('ok');
      const prior = (
        await pool.query(
          `SELECT id,creation_request_digest,draft_payload
             FROM learning_activities WHERE id=$1`,
          [legacy.activity_id],
        )
      ).rows[0];
      expect(prior.draft_payload).not.toHaveProperty('goal');
      const publishedBeforeUpgrade = (
        await pool.query('SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)', [
          principalId,
          teacher.tenantId,
          legacy.activity_id,
          'goal:forward:pre-upgrade-publish',
        ])
      ).rows[0];
      expect(publishedBeforeUpgrade.result_code).toBe('ok');
      const legacyContentDigest = publishedBeforeUpgrade.content_digest as string;

      const upgrade = await pool.connect();
      try {
        expect(await applyIsolatedTestPlan(upgrade, goalUpgrade)).toBe(1);
        expect(await applyIsolatedTestPlan(upgrade, goalUpgrade)).toBe(0);
      } finally {
        upgrade.release();
      }
      const publishedAfterUpgrade = (
        await pool.query(
          `SELECT content_digest, goal, goal_snapshot_present
             FROM learning_activity_versions WHERE id=$1`,
          [publishedBeforeUpgrade.activity_version_id],
        )
      ).rows[0];
      expect(publishedAfterUpgrade).toMatchObject({
        content_digest: legacyContentDigest,
        goal: null,
        goal_snapshot_present: false,
      });
      const retry = (
        await pool.query(
          `SELECT * FROM learning_activity_create(
            $1,$2,'school','private','project',$3,$4,'completion',NULL,
            $5::jsonb,'electronics',NULL,NULL,$6,$7,NULL::jsonb
          )`,
          args,
        )
      ).rows[0];
      expect(retry).toMatchObject({ result_code: 'ok', activity_id: legacy.activity_id });
      const sourceRetry = (
        await pool.query(
          `SELECT * FROM learning_activity_create(
            $1,$2,'school','private','project',$3,$4,'completion',NULL,
            $5::jsonb,'electronics',NULL,NULL,$6,$7,NULL::jsonb
          )`,
          [...args.slice(0, 6), 'goal:source:' + randomUUID()],
        )
      ).rows[0];
      expect(sourceRetry).toMatchObject({ result_code: 'ok', activity_id: legacy.activity_id });
      const after = (
        await pool.query(
          `SELECT id,creation_request_digest,draft_payload
             FROM learning_activities WHERE source_teacher_assignment_id=$1`,
          [sourceId],
        )
      ).rows;
      expect(after).toEqual([prior]);
      const preview = (
        await pool.query(
          `SELECT result_code,goal FROM learning_activity_preview_with_goal_as_author(
            $1,$2,$3,'draft',NULL,1
          )`,
          [principalId, teacher.tenantId, legacy.activity_id],
        )
      ).rows[0];
      expect(preview).toMatchObject({ result_code: 'ok', goal: 'Inherited teacher goal' });
    } finally {
      await pool?.end();
      if (databaseCreated) await owner.query('DROP DATABASE "' + name + '"');
      await owner.end();
    }
  }, 60_000);
});
