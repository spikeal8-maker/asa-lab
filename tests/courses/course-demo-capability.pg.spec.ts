import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool } from '../portal/helpers';

let admin: pg.Pool;
let app: pg.Pool;
let owner: { tenantId: string; principalId: string };
let other: { tenantId: string; principalId: string };

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  const first = await seedTeacher(admin, 'course-demo-capability-owner');
  const second = await seedTeacher(admin, 'course-demo-capability-other');
  const identities = await Promise.all(
    [first, second].map(async (teacher) => {
      const result = await admin.query(
        'SELECT principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
        [teacher.tenantId, teacher.teacherId],
      );
      return { tenantId: teacher.tenantId, principalId: result.rows[0].principal_id as string };
    }),
  );
  [owner, other] = identities as [typeof owner, typeof other];
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('Three-D demo Course capability entrypoint', () => {
  it('leaves only the guarded demo function callable by the app role', async () => {
    const privileges = await app.query(
      `SELECT current_user AS runtime_role,
         has_function_privilege('public.course_demo_ensure(uuid)'::regprocedure,'EXECUTE') AS guarded,
         has_function_privilege('public.course_demo_ensure_unchecked(uuid)'::regprocedure,'EXECUTE') AS unchecked`,
    );
    expect(privileges.rows[0]).toEqual({
      runtime_role: 'asalab_app',
      guarded: true,
      unchecked: false,
    });
    await expect(
      app.query('SELECT * FROM course_demo_ensure_unchecked($1)', [owner.principalId]),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('creates under the app role, then allows only the existing owner replay when disabled', async () => {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE asalab_app');
      const first = await client.query('SELECT * FROM course_demo_ensure($1)', [owner.principalId]);
      expect(first.rows[0]).toMatchObject({ created: true, published_version: 1 });
      const courseId = first.rows[0].course_id as string;
      await client.query('SET LOCAL ROLE NONE');

      const course = await client.query(
        'SELECT tenant_id,owner_principal_id,template_key FROM courses WHERE id=$1',
        [courseId],
      );
      expect(course.rows[0]).toEqual({
        tenant_id: owner.tenantId,
        owner_principal_id: owner.principalId,
        template_key: 'three-d-foundations-v1',
      });
      const versionsBefore = await client.query(
        'SELECT id FROM course_versions WHERE course_id=$1 ORDER BY version_number',
        [courseId],
      );
      expect(versionsBefore.rows).toHaveLength(1);

      await client.query(
        `UPDATE module_learning_capabilities
            SET assignable=false,editable_evidence=false,
                submit_project_version=false,preview='none'
          WHERE module_key='three-d'`,
      );
      await client.query('SET LOCAL ROLE asalab_app');
      const replay = await client.query('SELECT * FROM course_demo_ensure($1)', [
        owner.principalId,
      ]);
      expect(replay.rows[0]).toEqual({
        course_id: courseId,
        created: false,
        published_version: 1,
      });
      await client.query('SET LOCAL ROLE NONE');

      await client.query('SAVEPOINT denied_new_demo');
      await client.query('SET LOCAL ROLE asalab_app');
      await expect(
        client.query('SELECT * FROM course_demo_ensure($1)', [other.principalId]),
      ).rejects.toMatchObject({ code: 'PZ001', message: 'course_demo_capability_unavailable' });
      await client.query('ROLLBACK TO SAVEPOINT denied_new_demo');

      const absent = await client.query(
        `SELECT count(*)::integer AS courses FROM courses
          WHERE owner_principal_id=$1 AND template_key='three-d-foundations-v1'`,
        [other.principalId],
      );
      expect(absent.rows[0].courses).toBe(0);
      const noTasks = await client.query(
        'SELECT count(*)::integer AS tasks FROM teacher_assignments WHERE owner_principal_id=$1 AND demo_key IS NOT NULL',
        [other.principalId],
      );
      expect(noTasks.rows[0].tasks).toBe(0);
      const versionsAfter = await client.query(
        'SELECT id FROM course_versions WHERE course_id=$1 ORDER BY version_number',
        [courseId],
      );
      expect(versionsAfter.rows).toEqual(versionsBefore.rows);
      await client.query('ROLLBACK');
    } catch (cause) {
      await client.query('ROLLBACK');
      throw cause;
    } finally {
      client.release();
    }

    expect(
      (await admin.query("SELECT module_learning_assignable('three-d') AS allowed")).rows[0],
    ).toEqual({ allowed: true });
  });
});
