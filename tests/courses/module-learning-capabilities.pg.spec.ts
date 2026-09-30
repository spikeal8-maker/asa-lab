import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createApiModuleRegistry } from '../../apps/api/src/module-registry.js';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool;
let app: pg.Pool;
let owner: SeededTeacher;
let outsider: SeededTeacher;
let principalId: string;
let accountId: string;
let outsiderPrincipalId: string;

const policies = {
  attemptPolicy: { maxAttempts: 1 },
  resultSelectionPolicy: { mode: 'latest' },
  completionPolicy: { mode: 'submission' },
  latePolicy: { mode: 'allow_mark_late' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'after_review' },
};

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  owner = await seedTeacher(admin, 'module-learning-capability-owner');
  outsider = await seedTeacher(admin, 'module-learning-capability-outsider');
  const identity = await admin.query(
    'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
    [owner.tenantId, owner.teacherId],
  );
  principalId = identity.rows[0].principal_id as string;
  accountId = identity.rows[0].account_id as string;
  const foreign = await admin.query(
    'SELECT principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
    [outsider.tenantId, outsider.teacherId],
  );
  outsiderPrincipalId = foreign.rows[0].principal_id as string;
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('A3b module Learning capability SQL projection', () => {
  it('matches every API registry entry and denies direct app changes', async () => {
    const registry = createApiModuleRegistry();
    const expected = registry
      .list()
      .map((module) => ({
        module_key: module.moduleKey,
        creatable: module.creatable,
        assignable: module.learningCapabilities.assignable,
        editable_evidence: module.learningCapabilities.editableEvidence,
        submit_project_version: module.learningCapabilities.submitProjectVersion,
        preview: module.learningCapabilities.preview,
      }))
      .sort((left, right) => left.module_key.localeCompare(right.module_key));
    const projected = await admin.query(
      `SELECT module_key,creatable,assignable,editable_evidence,submit_project_version,preview
         FROM module_learning_capabilities ORDER BY module_key`,
    );
    expect(projected.rows).toEqual(expected);
    const dbAssignable = await admin.query(
      'SELECT module_key FROM module_learning_capabilities WHERE creatable AND assignable ORDER BY module_key',
    );
    expect(dbAssignable.rows.map((row) => row.module_key)).toEqual(
      registry
        .listLearningAssignable()
        .map((module) => module.moduleKey)
        .sort(),
    );
    expect(
      (await app.query("SELECT module_learning_assignable('electronics') AS allowed")).rows[0],
    ).toEqual({ allowed: true });
    expect(
      (await app.query("SELECT module_learning_assignable('blocks') AS allowed")).rows[0],
    ).toEqual({ allowed: false });
    expect(
      (await app.query("SELECT module_learning_assignable('missing-lab') AS allowed")).rows[0],
    ).toEqual({ allowed: false });
    await expect(app.query('SELECT * FROM module_learning_capabilities')).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      app.query(
        "UPDATE module_learning_capabilities SET assignable=true WHERE module_key='blocks'",
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('restricts direct Course publication to the validated v3 entrypoint', async () => {
    const privileges = await app.query(
      `SELECT current_user AS runtime_role,
         has_function_privilege('public.course_publish(uuid,uuid)'::regprocedure,'EXECUTE')
           AS legacy,
         has_function_privilege('public.course_publish_v2(uuid,uuid,integer,varchar)'::regprocedure,'EXECUTE')
           AS version_two,
         has_function_privilege('public.course_publish_v3(uuid,uuid,integer,varchar)'::regprocedure,'EXECUTE')
           AS version_three`,
    );
    expect(privileges.rows[0]).toEqual({
      runtime_role: 'asalab_app',
      legacy: false,
      version_two: false,
      version_three: true,
    });

    await admin.query(
      `INSERT INTO teacher_assignments
         (tenant_id,owner_principal_id,title,brief,module_key,visibility)
       VALUES ($1,$2,'A3b publish entrypoint anchor','Anchor','electronics','private')`,
      [owner.tenantId, principalId],
    );
    const created = await admin.query(
      "SELECT course_save($1,NULL,'A3b guarded publication',NULL,NULL,'private') AS id",
      [principalId],
    );
    const courseId = created.rows[0].id as string;
    const outline = await admin.query(
      'SELECT section_id FROM course_outline_v3($1,$2,$3,$4) LIMIT 1',
      [courseId, principalId, accountId, owner.tenantId],
    );
    const saved = await admin.query(
      `SELECT course_lesson_save_v3($1,$2,$3,NULL,'Guarded material',NULL,
         $4::jsonb,'material',NULL,20,NULL) AS id`,
      [
        principalId,
        courseId,
        outline.rows[0].section_id,
        JSON.stringify([{ id: 'intro', type: 'paragraph', text: 'Valid material' }]),
      ],
    );
    expect(saved.rows[0].id).toBeTruthy();
    const revision = Number(
      (await admin.query('SELECT draft_revision FROM courses WHERE id=$1', [courseId])).rows[0]
        .draft_revision,
    );

    await expect(
      app.query('SELECT * FROM course_publish($1,$2)', [principalId, courseId]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      app.query('SELECT * FROM course_publish_v2($1,$2,$3,$4)', [
        principalId,
        courseId,
        revision,
        'a3b:legacy:denied',
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    expect(
      Number(
        (await admin.query('SELECT count(*) FROM course_versions WHERE course_id=$1', [courseId]))
          .rows[0].count,
      ),
    ).toBe(0);

    const published = await app.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
      principalId,
      courseId,
      revision,
      'a3b:guarded:publish',
    ]);
    expect(published.rows[0]).toMatchObject({ result_code: 'ok', reused: false });
    const replay = await app.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
      principalId,
      courseId,
      revision,
      'a3b:guarded:publish',
    ]);
    expect(replay.rows[0]).toMatchObject({
      result_code: 'ok',
      version_id: published.rows[0].version_id,
      version_number: published.rows[0].version_number,
      published_at: published.rows[0].published_at,
      reused: true,
    });
    const outsider = await app.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
      outsiderPrincipalId,
      courseId,
      revision,
      'a3b:guarded:publish',
    ]);
    expect(outsider.rows[0].result_code).toBe('course_not_found');
  });

  it('onboards a future module without a Learning SQL branch and rejects stale new publication', async () => {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      // A future module changes its own manifest plus this protected projection.
      await client.query(
        `INSERT INTO module_learning_capabilities
           (module_key,creatable,assignable,editable_evidence,submit_project_version,preview)
         VALUES ('future-lab',true,true,true,true,'snapshot')`,
      );
      const activity = await client.query(
        `SELECT * FROM learning_activity_create(
           $1,$2,'school','private','project','Future laboratory','Future instructions',
           'completion',NULL,$3::jsonb,'future-lab',NULL,NULL,NULL,'a3b:future:create:1',NULL)`,
        [principalId, owner.tenantId, JSON.stringify(policies)],
      );
      expect(activity.rows[0].result_code).toBe('ok');
      const activityId = activity.rows[0].activity_id as string;
      const published = await client.query(
        "SELECT * FROM learning_activity_publish($1,$2,$3,1,'a3b:future:publish:1')",
        [principalId, owner.tenantId, activityId],
      );
      expect(published.rows[0]).toMatchObject({ result_code: 'ok', reused: false });
      const versionId = published.rows[0].activity_version_id as string;

      await client.query(
        `INSERT INTO teacher_assignments
           (tenant_id,owner_principal_id,title,brief,module_key,visibility)
         VALUES ($1,$2,'A3b course tenant anchor','Anchor','electronics','private')`,
        [owner.tenantId, principalId],
      );
      const makeCourse = async (title: string) => {
        const created = await client.query(
          "SELECT course_save($1,NULL,$2,NULL,NULL,'private') AS id",
          [principalId, title],
        );
        const courseId = created.rows[0].id as string;
        const outline = await client.query(
          'SELECT section_id FROM course_outline_v3($1,$2,$3,$4) LIMIT 1',
          [courseId, principalId, accountId, owner.tenantId],
        );
        return { courseId, sectionId: outline.rows[0].section_id as string };
      };
      const pinned = await makeCourse('A3b future pin');
      const pin = await client.query(
        `SELECT course_lesson_save_v3($1,$2,$3,NULL,'Future pin',NULL,
           '[]'::jsonb,'assignment',NULL,20,$4) AS id`,
        [principalId, pinned.courseId, pinned.sectionId, versionId],
      );
      expect(pin.rows[0].id).toBeTruthy();
      const blocked = await makeCourse('A3b future block');
      const blocks = [
        { id: 'future-work', type: 'activity', learningActivityVersionId: versionId },
      ];
      const material = await client.query(
        `SELECT course_lesson_save_v3($1,$2,$3,NULL,'Future block',NULL,
           $4::jsonb,'material',NULL,20,NULL) AS id`,
        [principalId, blocked.courseId, blocked.sectionId, JSON.stringify(blocks)],
      );
      expect(material.rows[0].id).toBeTruthy();
      for (const course of [pinned, blocked]) {
        const checked = await client.query(
          'SELECT * FROM course_prepublication_validation($1,$2)',
          [principalId, course.courseId],
        );
        expect(checked.rows[0].result_code).toBe('ok');
      }
      expect(
        (
          await client.query('SELECT course_activity_blocks_authorized($1,$2,$3::jsonb) AS ok', [
            outsiderPrincipalId,
            owner.tenantId,
            JSON.stringify(blocks),
          ])
        ).rows[0].ok,
      ).toBe(false);
      expect(
        (
          await client.query('SELECT course_activity_blocks_authorized($1,$2,$3::jsonb) AS ok', [
            principalId,
            outsider.tenantId,
            JSON.stringify(blocks),
          ])
        ).rows[0].ok,
      ).toBe(false);

      const revision = Number(
        (await client.query('SELECT draft_revision FROM courses WHERE id=$1', [blocked.courseId]))
          .rows[0].draft_revision,
      );
      const coursePublished = await client.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
        principalId,
        blocked.courseId,
        revision,
        'a3b:future:course:1',
      ]);
      expect(coursePublished.rows[0].result_code).toBe('ok');
      const frozenId = coursePublished.rows[0].version_id as string;

      await client.query(
        "UPDATE module_learning_capabilities SET assignable=false,editable_evidence=false,submit_project_version=false,preview='none' WHERE module_key='future-lab'",
      );
      expect(
        (await client.query("SELECT module_learning_assignable('future-lab') AS allowed")).rows[0]
          .allowed,
      ).toBe(false);
      for (const course of [pinned, blocked]) {
        const checked = await client.query(
          'SELECT * FROM course_prepublication_validation($1,$2)',
          [principalId, course.courseId],
        );
        expect(checked.rows[0]).toMatchObject({ result_code: 'prepublish_invalid' });
      }
      const oldSnapshot = await client.query('SELECT outline FROM course_versions WHERE id=$1', [
        frozenId,
      ]);
      expect(oldSnapshot.rows[0].outline.sections[0].lessons[0].blocks[0]).toMatchObject({
        learningActivityVersionId: versionId,
      });
      const courseReplay = await client.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
        principalId,
        blocked.courseId,
        revision,
        'a3b:future:course:1',
      ]);
      expect(courseReplay.rows[0]).toMatchObject({
        result_code: 'ok',
        version_id: frozenId,
        version_number: coursePublished.rows[0].version_number,
        published_at: coursePublished.rows[0].published_at,
        reused: true,
      });
      const mismatchedReplay = await client.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
        principalId,
        blocked.courseId,
        revision + 1,
        'a3b:future:course:1',
      ]);
      expect(mismatchedReplay.rows[0].result_code).toBe('idempotency_conflict');
      const outsiderReplay = await client.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
        outsiderPrincipalId,
        blocked.courseId,
        revision,
        'a3b:future:course:1',
      ]);
      expect(outsiderReplay.rows[0].result_code).toBe('course_not_found');
      const staleCourseRequest = await client.query(
        'SELECT * FROM course_publish_v3($1,$2,$3,$4)',
        [principalId, blocked.courseId, revision, 'a3b:future:course:2'],
      );
      expect(staleCourseRequest.rows[0].result_code).toBe('draft_conflict');
      const currentRevision = Number(
        (await client.query('SELECT draft_revision FROM courses WHERE id=$1', [blocked.courseId]))
          .rows[0].draft_revision,
      );
      expect(currentRevision).toBeGreaterThan(revision);
      const newCourseRequest = await client.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
        principalId,
        blocked.courseId,
        currentRevision,
        'a3b:future:course:3',
      ]);
      expect(newCourseRequest.rows[0].result_code).toBe('prepublish_invalid');
      const replay = await client.query(
        "SELECT * FROM learning_activity_publish($1,$2,$3,1,'a3b:future:publish:1')",
        [principalId, owner.tenantId, activityId],
      );
      expect(replay.rows[0]).toMatchObject({ result_code: 'ok', reused: true });
      const draft = await client.query(
        `SELECT * FROM learning_activity_draft_put($1,$2,$3,1,'Future v2','Future instructions',
          'completion',NULL,$4::jsonb,'future-lab',NULL,NULL,NULL::jsonb)`,
        [principalId, owner.tenantId, activityId, JSON.stringify(policies)],
      );
      expect(draft.rows[0].result_code).toBe('ok');
      const rejected = await client.query(
        "SELECT * FROM learning_activity_publish($1,$2,$3,2,'a3b:future:publish:2')",
        [principalId, owner.tenantId, activityId],
      );
      expect(rejected.rows[0].result_code).toBe('invalid_draft');
      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    expect(
      (await admin.query("SELECT module_learning_assignable('future-lab') AS allowed")).rows[0],
    ).toEqual({ allowed: false });
  });
});
