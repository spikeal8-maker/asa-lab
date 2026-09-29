import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool;
let app: pg.Pool;
let author: SeededTeacher;
let outsider: SeededTeacher;
let principalId: string;
let accountId: string;
let outsiderPrincipalId: string;
let sequence = 0;

const policies = {
  attemptPolicy: { maxAttempts: 2 },
  resultSelectionPolicy: { mode: 'latest' },
  completionPolicy: { mode: 'submission' },
  latePolicy: { mode: 'allow_mark_late' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'after_review' },
};

async function identityFor(teacher: SeededTeacher) {
  const result = await admin.query(
    'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
    [teacher.tenantId, teacher.teacherId],
  );
  return result.rows[0] as { principal_id: string; account_id: string };
}
async function inTenant<T>(
  teacher: SeededTeacher,
  callback: (client: pg.PoolClient) => Promise<T>,
) {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [teacher.tenantId]);
    const value = await callback(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function publishActivity(
  teacher: SeededTeacher,
  ownerPrincipalId: string,
  moduleKey: string,
  sample?: Buffer,
  goal: string | null = null,
  taskBlocks?: unknown[],
) {
  sequence += 1;
  const created = await inTenant(teacher, (client) =>
    client.query(
      taskBlocks === undefined
        ? "SELECT * FROM learning_activity_create($1,$2,'school','private','project',$3,'D2 activity','completion',NULL,$4::jsonb,$5,NULL,NULL,NULL,$6,$7)"
        : "SELECT * FROM learning_activity_create($1,$2,'school','private','project',$3,'D2 activity','completion',NULL,$4::jsonb,$5,NULL,NULL,NULL,$6,$7::jsonb,$8::jsonb)",
      [
        ownerPrincipalId,
        teacher.tenantId,
        `D2 activity ${sequence}`,
        JSON.stringify(policies),
        moduleKey,
        `d2:create:${sequence}`,
        taskBlocks === undefined ? goal : goal === null ? null : JSON.stringify(goal),
        ...(taskBlocks === undefined ? [] : [JSON.stringify(taskBlocks)]),
      ],
    ),
  );
  expect(created.rows[0].result_code).toBe('ok');
  if (sample) {
    const uploaded = await inTenant(teacher, (client) =>
      client.query(`SELECT * FROM learning_activity_draft_sample_set($1,$2,$3,1,$4,'image/png')`, [
        ownerPrincipalId,
        teacher.tenantId,
        created.rows[0].activity_id,
        sample,
      ]),
    );
    expect(uploaded.rows[0]).toMatchObject({ result_code: 'ok', draft_revision: 2 });
  }
  const published = await inTenant(teacher, (client) =>
    client.query('SELECT * FROM learning_activity_publish($1,$2,$3,$4,$5)', [
      ownerPrincipalId,
      teacher.tenantId,
      created.rows[0].activity_id,
      sample ? 2 : 1,
      `d2:publish:${sequence}`,
    ]),
  );
  expect(published.rows[0].result_code).toBe('ok');
  return {
    activityId: created.rows[0].activity_id as string,
    versionId: published.rows[0].activity_version_id as string,
  };
}

async function historicalUnsupportedVersion(moduleKey: string) {
  const source = await publishActivity(author, principalId, 'electronics');
  // Emulate a pre-capability published version without updating immutable rows.
  const inserted = await admin.query(
    `INSERT INTO learning_activity_versions
     SELECT (jsonb_populate_record(NULL::learning_activity_versions,
       to_jsonb(version) || jsonb_build_object(
         'id',gen_random_uuid(),
         'version_number',version.version_number+1,
         'source_draft_revision',version.source_draft_revision+1,
         'publication_request_id',$2,
         'module_key',$3
       ))).*
       FROM learning_activity_versions version WHERE version.id=$1
     RETURNING id`,
    [source.versionId, `historical:unsupported:${randomUUID()}`, moduleKey],
  );
  return { activityId: source.activityId, versionId: inserted.rows[0].id as string };
}

async function newCourse(title: string) {
  sequence += 1;
  await admin.query(
    "INSERT INTO teacher_assignments(tenant_id,owner_principal_id,title,brief,module_key,visibility) VALUES($1,$2,$3,'anchor','electronics','private')",
    [author.tenantId, principalId, `${title} anchor ${sequence}`],
  );
  const created = await admin.query("SELECT course_save($1,NULL,$2,NULL,NULL,'private') AS id", [
    principalId,
    title,
  ]);
  const courseId = created.rows[0].id as string;
  const outline = await admin.query(
    'SELECT section_id FROM course_outline_v3($1,$2,$3,$4) LIMIT 1',
    [courseId, principalId, accountId, author.tenantId],
  );
  return { courseId, sectionId: outline.rows[0].section_id as string };
}

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  author = await seedTeacher(admin, 'course-activity-block-author');
  outsider = await seedTeacher(admin, 'course-activity-block-outsider');
  const authorIdentity = await identityFor(author);
  const outsiderIdentity = await identityFor(outsider);
  principalId = authorIdentity.principal_id;
  accountId = authorIdentity.account_id;
  outsiderPrincipalId = outsiderIdentity.principal_id;
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

async function authorized(blocks: unknown[]) {
  const result = await admin.query(
    'SELECT course_activity_blocks_authorized($1,$2,$3::jsonb) AS ok',
    [principalId, author.tenantId, JSON.stringify(blocks)],
  );
  return result.rows[0].ok as boolean;
}

async function classroomWithSeat(
  linkedAccountId: string | null = null,
  status: 'issued' | 'active' | 'suspended' | 'removed' = 'active',
) {
  sequence += 1;
  const classroom = (
    await admin.query(
      'INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [
        author.tenantId,
        author.schoolId,
        author.periodId,
        `D3b class ${sequence}`,
        author.teacherId,
      ],
    )
  ).rows[0].id as string;
  await admin.query(
    "INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner')",
    [author.tenantId, classroom, author.teacherId, accountId],
  );
  const seat = (
    await admin.query(
      `INSERT INTO classroom_student_seats
         (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
          safe_mode,status,created_by,account_id)
       VALUES($1,$2,'D3b learner',$3,$3,true,$4,$5,$6) RETURNING id`,
      [
        author.tenantId,
        classroom,
        `d3b-seat-${sequence}`,
        status,
        author.teacherId,
        linkedAccountId,
      ],
    )
  ).rows[0].id as string;
  return { classroom, seat };
}

async function assignCourseRun(
  courseId: string,
  classroomId: string,
  seatId: string,
  requestId: string,
) {
  return inTenant(
    author,
    async (client) =>
      (
        await client.query(
          "SELECT * FROM classroom_course_run_assign_v3($1,$2,$3,NULL,1,'named_learners',$4::uuid[],$5)",
          [principalId, classroomId, courseId, [seatId], requestId],
        )
      ).rows[0],
  );
}

describe('E1-FIX-11D2 canonical Activity blocks', () => {
  it('accepts the Activity shape and rejects a malformed version UUID', async () => {
    const exact = await publishActivity(author, principalId, 'electronics');
    const valid = [
      { id: 'activity-a', type: 'activity', learningActivityVersionId: exact.versionId },
    ];
    const invalid = [
      { id: 'activity-b', type: 'activity', learningActivityVersionId: 'not-a-uuid' },
    ];
    expect(
      (
        await admin.query('SELECT course_lesson_blocks_valid($1::jsonb) AS valid', [
          JSON.stringify(valid),
        ])
      ).rows[0].valid,
    ).toBe(true);
    expect(
      (
        await admin.query('SELECT course_lesson_blocks_valid($1::jsonb) AS valid', [
          JSON.stringify(invalid),
        ])
      ).rows[0].valid,
    ).toBe(false);
  });

  it('accepts exact Electronics and 3D versions and rejects nonexistent, unsupported and foreign versions', async () => {
    const electronics = await publishActivity(author, principalId, 'electronics');
    const threeD = await publishActivity(author, principalId, 'three-d');
    const unsupported = await historicalUnsupportedVersion('chess');
    const foreign = await publishActivity(outsider, outsiderPrincipalId, 'electronics');
    const missingVersionId = randomUUID();

    expect(
      await authorized([
        { id: 'electronics', type: 'activity', learningActivityVersionId: electronics.versionId },
        { id: 'three-d', type: 'activity', learningActivityVersionId: threeD.versionId },
      ]),
    ).toBe(true);
    expect(
      await authorized([
        { id: 'missing', type: 'activity', learningActivityVersionId: missingVersionId },
      ]),
    ).toBe(false);
    expect(
      await authorized([
        { id: 'unsupported', type: 'activity', learningActivityVersionId: unsupported.versionId },
      ]),
    ).toBe(false);
    expect(
      await authorized([
        { id: 'foreign', type: 'activity', learningActivityVersionId: foreign.versionId },
      ]),
    ).toBe(false);
    expect(
      await authorized([
        {
          id: 'hidden-unsupported',
          type: 'activity',
          learningActivityVersionId: unsupported.versionId,
          hidden: true,
        },
      ]),
    ).toBe(false);
  });

  it('validates hidden Activity blocks, stores the draft and freezes only the visible exact pin', async () => {
    const electronics = await publishActivity(author, principalId, 'electronics');
    const threeD = await publishActivity(author, principalId, 'three-d');
    const unsupported = await historicalUnsupportedVersion('manual-lab');
    const { courseId, sectionId } = await newCourse('D2 activity blocks');
    const hiddenUnsupported = [
      {
        id: 'hidden-invalid',
        type: 'activity',
        learningActivityVersionId: unsupported.versionId,
        hidden: true,
      },
    ];
    await expect(
      admin.query(
        "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Hidden invalid',NULL,$4::jsonb,'material',NULL,15,NULL)",
        [principalId, courseId, sectionId, JSON.stringify(hiddenUnsupported)],
      ),
    ).rejects.toThrow(/activity block exact version is unavailable/);

    const blocks = [
      {
        id: 'visible-activity',
        type: 'activity',
        learningActivityVersionId: electronics.versionId,
      },
      {
        id: 'hidden-activity',
        type: 'activity',
        learningActivityVersionId: threeD.versionId,
        hidden: true,
      },
    ];
    const saved = await admin.query(
      "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Mixed Activity blocks',NULL,$4::jsonb,'material',NULL,15,NULL) AS id",
      [principalId, courseId, sectionId, JSON.stringify(blocks)],
    );
    const lessonId = saved.rows[0].id as string;
    expect(lessonId).toBeTruthy();
    const draft = await admin.query('SELECT blocks,content FROM course_lessons WHERE id=$1', [
      lessonId,
    ]);
    expect(draft.rows[0]).toEqual({ blocks, content: null });
    expect(
      (
        await admin.query('SELECT course_lesson_blocks_plain_text($1::jsonb) AS content', [
          JSON.stringify(blocks),
        ])
      ).rows[0].content,
    ).toBeNull();

    const revision = Number(
      (await admin.query('SELECT draft_revision FROM courses WHERE id=$1', [courseId])).rows[0]
        .draft_revision,
    );
    const published = await admin.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
      principalId,
      courseId,
      revision,
      `d2:course:publish:${++sequence}`,
    ]);
    expect(published.rows[0]).toMatchObject({ result_code: 'ok', version_number: 1 });

    const frozen = await admin.query(
      `SELECT outline ->> 'schemaVersion' AS schema_version,
              outline #> '{sections,0,lessons,0,blocks}' AS blocks
         FROM course_versions WHERE id=$1`,
      [published.rows[0].version_id],
    );
    expect(frozen.rows[0]).toEqual({
      schema_version: '3',
      blocks: [
        {
          id: 'visible-activity',
          type: 'activity',
          learningActivityVersionId: electronics.versionId,
        },
      ],
    });
  });

  it('preserves the legacy lesson-level exact LearningActivityVersion pin', async () => {
    const electronics = await publishActivity(author, principalId, 'electronics');
    const { courseId, sectionId } = await newCourse('D2 legacy lesson pin');
    const saved = await admin.query(
      "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Legacy exact pin',NULL,'[]'::jsonb,'assignment',NULL,20,$4) AS id",
      [principalId, courseId, sectionId, electronics.versionId],
    );
    const lessonId = saved.rows[0].id as string;
    expect(lessonId).toBeTruthy();
    expect(
      (
        await admin.query('SELECT learning_activity_version_id FROM course_lessons WHERE id=$1', [
          lessonId,
        ])
      ).rows[0].learning_activity_version_id,
    ).toBe(electronics.versionId);

    const revision = Number(
      (await admin.query('SELECT draft_revision FROM courses WHERE id=$1', [courseId])).rows[0]
        .draft_revision,
    );
    const published = await admin.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
      principalId,
      courseId,
      revision,
      `d2:legacy:publish:${++sequence}`,
    ]);
    expect(published.rows[0].result_code).toBe('ok');
    const frozen = await admin.query(
      `SELECT outline #>> '{sections,0,lessons,0,learningActivityVersionId}' AS version_id
         FROM course_versions WHERE id=$1`,
      [published.rows[0].version_id],
    );
    expect(frozen.rows[0].version_id).toBe(electronics.versionId);
  });
});

describe('E1-FIX-11D3b Course Activity block materialization', () => {
  it('materializes two frozen Activity blocks into distinct runs, handouts and inherited participations', async () => {
    const blockA = await publishActivity(author, principalId, 'electronics');
    const blockB = await publishActivity(author, principalId, 'three-d');
    const { courseId, sectionId } = await newCourse('D3b block materialization');
    const blocks = [
      { id: 'activity-block-a', type: 'activity', learningActivityVersionId: blockA.versionId },
      { id: 'activity-block-b', type: 'activity', learningActivityVersionId: blockB.versionId },
    ];
    const lessonId = (
      await admin.query(
        "SELECT course_lesson_save_v3($1,$2,$3,NULL,'D3b blocks',NULL,$4::jsonb,'material',NULL,15,NULL) AS id",
        [principalId, courseId, sectionId, JSON.stringify(blocks)],
      )
    ).rows[0].id as string;
    const revision = Number(
      (await admin.query('SELECT draft_revision FROM courses WHERE id=$1', [courseId])).rows[0]
        .draft_revision,
    );
    const published = (
      await admin.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
        principalId,
        courseId,
        revision,
        `d3b:course:publish:${++sequence}`,
      ])
    ).rows[0];
    expect(published).toMatchObject({ result_code: 'ok', version_number: 1 });

    const { classroom, seat } = await classroomWithSeat();
    const requestId = `d3b:course:assign:${++sequence}`;
    const assigned = await assignCourseRun(courseId, classroom, seat, requestId);
    expect(assigned).toMatchObject({ result_code: 'ok', reused: false });

    const runLesson = (
      await admin.query(
        'SELECT id,source_lesson_id,blocks FROM classroom_course_run_lessons WHERE run_id=$1',
        [assigned.run_id],
      )
    ).rows[0];
    expect(runLesson.source_lesson_id).toBe(lessonId);
    expect(runLesson.blocks).toEqual(blocks);

    const materialized = (
      await admin.query(
        `SELECT run.id,run.source_course_lesson_id,run.source_course_block_id,
                run.learning_activity_version_id,run.source_classroom_assignment_id,
                assignment.assignment_id,assignment.course_run_id,assignment.status,
                count(part.id)::int AS participation_count
           FROM activity_runs run
           JOIN classroom_assignments assignment
             ON assignment.id=run.source_classroom_assignment_id
           LEFT JOIN activity_participations part ON part.activity_run_id=run.id
          WHERE run.source_course_run_id=$1
          GROUP BY run.id,assignment.id
          ORDER BY run.source_course_block_id`,
        [assigned.run_id],
      )
    ).rows;
    expect(materialized).toHaveLength(2);
    expect(materialized.map((row) => row.source_course_block_id)).toEqual([
      'activity-block-a',
      'activity-block-b',
    ]);
    expect(materialized.map((row) => row.learning_activity_version_id)).toEqual([
      blockA.versionId,
      blockB.versionId,
    ]);
    expect(materialized.every((row) => row.source_course_lesson_id === runLesson.id)).toBe(true);
    expect(new Set(materialized.map((row) => row.id)).size).toBe(2);
    expect(new Set(materialized.map((row) => row.source_classroom_assignment_id)).size).toBe(2);
    expect(
      materialized.every(
        (row) =>
          row.assignment_id === null &&
          row.course_run_id === assigned.run_id &&
          row.status === 'open' &&
          row.participation_count === 1,
      ),
    ).toBe(true);

    const retried = await assignCourseRun(courseId, classroom, seat, requestId);
    expect(retried).toMatchObject({
      result_code: 'ok',
      run_id: assigned.run_id,
      reused: true,
    });
    const retryCounts = (
      await admin.query(
        `SELECT
           (SELECT count(*)::int FROM activity_runs WHERE source_course_run_id=$1) AS activity_runs,
           (SELECT count(*)::int FROM classroom_assignments WHERE course_run_id=$1) AS handouts,
           (SELECT count(*)::int FROM activity_participations part
              JOIN activity_runs run ON run.id=part.activity_run_id
             WHERE run.source_course_run_id=$1) AS participations`,
        [assigned.run_id],
      )
    ).rows[0];
    expect(retryCounts).toEqual({ activity_runs: 2, handouts: 2, participations: 2 });
  });
  it('assigns inherited participation to an issued named learner before first login', async () => {
    const activity = await publishActivity(author, principalId, 'electronics');
    const { courseId, sectionId } = await newCourse('D5 issued seat participation');
    const blocks = [
      {
        id: 'issued-activity',
        type: 'activity',
        learningActivityVersionId: activity.versionId,
      },
    ];
    await admin.query(
      "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Issued learner activity',NULL,$4::jsonb,'material',NULL,15,NULL)",
      [principalId, courseId, sectionId, JSON.stringify(blocks)],
    );
    const revision = Number(
      (await admin.query('SELECT draft_revision FROM courses WHERE id=$1', [courseId])).rows[0]
        .draft_revision,
    );
    const published = await admin.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
      principalId,
      courseId,
      revision,
      `d5:issued:publish:${++sequence}`,
    ]);
    expect(published.rows[0].result_code).toBe('ok');

    const { classroom, seat } = await classroomWithSeat(null, 'issued');
    expect(
      (
        await admin.query('SELECT status,account_id FROM classroom_student_seats WHERE id=$1', [
          seat,
        ])
      ).rows[0],
    ).toEqual({ status: 'issued', account_id: null });

    const assigned = await assignCourseRun(
      courseId,
      classroom,
      seat,
      `d5:issued:assign:${++sequence}`,
    );
    expect(assigned).toMatchObject({ result_code: 'ok', reused: false });

    const enrollment = (
      await admin.query(
        `SELECT enrollment.id,enrollment.learner_identity_id,enrollment.status
           FROM course_enrollments enrollment
           JOIN learner_identity_links link
             ON link.tenant_id=enrollment.tenant_id
            AND link.school_id=enrollment.school_id
            AND link.learner_identity_id=enrollment.learner_identity_id
            AND link.link_kind='student_seat'
            AND link.status='active'
            AND link.seat_id=$2
          WHERE enrollment.course_run_id=$1`,
        [assigned.run_id, seat],
      )
    ).rows[0];
    expect(enrollment).toMatchObject({ status: 'assigned' });
    expect(enrollment.id).toBeTruthy();

    const participation = (
      await admin.query(
        `SELECT part.source_course_enrollment_id,part.learner_identity_id,part.status
           FROM activity_participations part
           JOIN activity_runs run ON run.id=part.activity_run_id
          WHERE run.source_course_run_id=$1
            AND part.learner_identity_id=$2`,
        [assigned.run_id, enrollment.learner_identity_id],
      )
    ).rows[0];
    expect(participation).toEqual({
      source_course_enrollment_id: enrollment.id,
      learner_identity_id: enrollment.learner_identity_id,
      status: 'assigned',
    });
  });

  it('preserves legacy lesson-level ActivityRun with a null block identity', async () => {
    const legacy = await publishActivity(author, principalId, 'electronics');
    const { courseId, sectionId } = await newCourse('D3b legacy runtime');
    await admin.query(
      "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Legacy runtime',NULL,'[]'::jsonb,'assignment',NULL,20,$4)",
      [principalId, courseId, sectionId, legacy.versionId],
    );
    const revision = Number(
      (await admin.query('SELECT draft_revision FROM courses WHERE id=$1', [courseId])).rows[0]
        .draft_revision,
    );
    await admin.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
      principalId,
      courseId,
      revision,
      `d3b:legacy:publish:${++sequence}`,
    ]);
    const { classroom, seat } = await classroomWithSeat();
    const assigned = await assignCourseRun(
      courseId,
      classroom,
      seat,
      `d3b:legacy:assign:${++sequence}`,
    );
    const runs = (
      await admin.query(
        `SELECT run.source_course_block_id,run.learning_activity_version_id,
                run.source_classroom_assignment_id,lesson.classroom_assignment_id
           FROM activity_runs run
           JOIN classroom_course_run_lessons lesson ON lesson.id=run.source_course_lesson_id
          WHERE run.source_course_run_id=$1`,
        [assigned.run_id],
      )
    ).rows;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      source_course_block_id: null,
      learning_activity_version_id: legacy.versionId,
    });
    expect(runs[0].source_classroom_assignment_id).toBe(runs[0].classroom_assignment_id);
  });
});

describe('E1-FIX-11D4b learner Activity-block runtime projection', () => {
  it('pins blocks and opening to the exact Course run when siblings share a handout', async () => {
    const aBlocks = [{ type: 'paragraph', text: 'Only sibling A blocks' }];
    const bBlocks = [{ type: 'paragraph', text: 'Only sibling B blocks' }];
    const aVersion = await publishActivity(
      author,
      principalId,
      'electronics',
      undefined,
      'Only sibling A goal',
      aBlocks,
    );
    const bVersion = await publishActivity(
      author,
      principalId,
      'electronics',
      undefined,
      'Only sibling B goal',
      bBlocks,
    );
    const { courseId, sectionId } = await newCourse('A2c shared handout');
    await admin.query(
      "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Shared handout',NULL,$4::jsonb,'material',NULL,15,NULL)",
      [
        principalId,
        courseId,
        sectionId,
        JSON.stringify([
          { id: 'sibling-a', type: 'activity', learningActivityVersionId: aVersion.versionId },
        ]),
      ],
    );
    const revision = Number(
      (await admin.query('SELECT draft_revision FROM courses WHERE id=$1', [courseId])).rows[0]
        .draft_revision,
    );
    expect(
      (
        await admin.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
          principalId,
          courseId,
          revision,
          `a2c:shared:publish:${++sequence}`,
        ])
      ).rows[0].result_code,
    ).toBe('ok');
    const { classroom, seat } = await classroomWithSeat(accountId);
    expect(
      (await assignCourseRun(courseId, classroom, seat, `a2c:shared:assign:${++sequence}`))
        .result_code,
    ).toBe('ok');
    const occurrence = (
      await inTenant(author, (client) =>
        client.query('SELECT * FROM classroom_course_activity_occurrences_for_seat($1)', [seat]),
      )
    ).rows[0];
    const accountOccurrence = (
      await inTenant(author, (client) =>
        client.query(
          'SELECT * FROM classroom_course_activity_occurrences_for_account($1) WHERE seat_id=$2 AND block_id=$3',
          [accountId, seat, 'sibling-a'],
        ),
      )
    ).rows[0];
    expect(accountOccurrence).toMatchObject({
      seat_id: seat,
      activity_run_id: occurrence.activity_run_id,
      classroom_assignment_id: occurrence.classroom_assignment_id,
    });
    const source = (
      await admin.query(
        `SELECT runtime.source_course_run_id,runtime.source_course_lesson_id,
                part.learner_identity_id,part.source_course_enrollment_id
           FROM activity_runs runtime
           JOIN activity_participations part ON part.activity_run_id=runtime.id
          WHERE runtime.id=$1`,
        [occurrence.activity_run_id],
      )
    ).rows[0];
    // The public creation contract allows another block run on this handout.
    // Its identity is distinct even though assignment_work cannot name it.
    const sibling = (
      await inTenant(author, (client) =>
        client.query(
          `SELECT * FROM activity_run_create($1,$2,$3,'course',$4,$5,NULL,NULL,NULL,
             NULL,NULL,'{}'::jsonb,$6,'sibling-b')`,
          [
            principalId,
            occurrence.classroom_assignment_id,
            bVersion.versionId,
            source.source_course_run_id,
            source.source_course_lesson_id,
            `a2c:shared:sibling:${++sequence}`,
          ],
        ),
      )
    ).rows[0];
    expect(sibling.result_code).toBe('ok');
    expect(sibling.activity_run_id).not.toBe(occurrence.activity_run_id);
    expect(
      (
        await inTenant(author, (client) =>
          client.query('SELECT * FROM activity_participation_assign($1,$2,$3,$4)', [
            principalId,
            sibling.activity_run_id,
            source.learner_identity_id,
            source.source_course_enrollment_id,
          ]),
        )
      ).rows[0].result_code,
    ).toBe('ok');
    // Simulate an older shared-handout snapshot that 0155/0157 permit. The
    // normal 0158 writer gives each block a separate handout today.
    await admin.query(
      `UPDATE classroom_course_run_lessons
          SET blocks=blocks || jsonb_build_array(jsonb_build_object(
            'id','sibling-b','type','activity','learningActivityVersionId',$2::text))
        WHERE id=$1`,
      [source.source_course_lesson_id, bVersion.versionId],
    );

    const pinned = (
      await admin.query(
        'SELECT id,blocks FROM learning_activity_versions WHERE id=ANY($1::uuid[])',
        [[aVersion.versionId, bVersion.versionId]],
      )
    ).rows;
    const pinnedA = pinned.find((row) => row.id === aVersion.versionId)?.blocks;
    const pinnedB = pinned.find((row) => row.id === bVersion.versionId)?.blocks;
    expect(pinnedA).toBeTruthy();
    expect(pinnedB).toBeTruthy();
    expect(pinnedA).not.toEqual(pinnedB);
    const read = async (runId: string) =>
      (
        await inTenant(author, (client) =>
          client.query('SELECT learning_activity_blocks_for_seat($1,$2,$3) AS value', [
            seat,
            occurrence.classroom_assignment_id,
            runId,
          ]),
        )
      ).rows[0].value as { present: boolean; blocks: unknown[] | null } | null;
    const readOccurrences = async (asAccount: boolean) =>
      (
        await inTenant(author, (client) =>
          client.query(
            `SELECT occurrence.block_id,occurrence.activity_run_id,
                    learning_activity_blocks_for_seat(
                      occurrence.seat_id,occurrence.classroom_assignment_id,
                      occurrence.activity_run_id) AS task_blocks
               FROM ${
                 asAccount
                   ? 'classroom_course_activity_occurrences_for_account($1)'
                   : 'classroom_course_activity_occurrences_for_seat($1)'
               } occurrence
              WHERE occurrence.seat_id=$2
                AND occurrence.classroom_assignment_id=$3
              ORDER BY occurrence.block_id`,
            [asAccount ? accountId : seat, seat, occurrence.classroom_assignment_id],
          ),
        )
      ).rows;
    const readGoals = async (asAccount: boolean) =>
      (
        await inTenant(author, (client) =>
          client.query(
            `SELECT block_id,goal FROM ${
              asAccount
                ? 'classroom_course_activity_occurrences_for_account($1)'
                : 'classroom_course_activity_occurrences_for_seat($1)'
            } WHERE seat_id=$2 AND classroom_assignment_id=$3 ORDER BY block_id`,
            [asAccount ? accountId : seat, seat, occurrence.classroom_assignment_id],
          ),
        )
      ).rows;
    const readSharedWork = async (asAccount: boolean) =>
      (
        await inTenant(author, (client) =>
          client.query(
            `SELECT block_id,project_id,submitted_at,snapshot_revision,work_updated_at,
                    learning_course_activity_assignment_is_shared(classroom_assignment_id) AS shared_assignment
               FROM ${
                 asAccount
                   ? 'classroom_course_activity_occurrences_for_account($1)'
                   : 'classroom_course_activity_occurrences_for_seat($1)'
               }
              WHERE seat_id=$2 AND classroom_assignment_id=$3 ORDER BY block_id`,
            [asAccount ? accountId : seat, seat, occurrence.classroom_assignment_id],
          ),
        )
      ).rows;
    const expectUnattributedWork = async () => {
      for (const asAccount of [false, true]) {
        expect(await readSharedWork(asAccount)).toEqual([
          {
            block_id: 'sibling-a',
            project_id: null,
            submitted_at: null,
            snapshot_revision: null,
            work_updated_at: null,
            shared_assignment: true,
          },
          {
            block_id: 'sibling-b',
            project_id: null,
            submitted_at: null,
            snapshot_revision: null,
            work_updated_at: null,
            shared_assignment: true,
          },
        ]);
      }
    };
    expect(await read(occurrence.activity_run_id)).toEqual({ present: true, blocks: pinnedA });
    expect(await read(sibling.activity_run_id)).toEqual({ present: true, blocks: pinnedB });
    await expectUnattributedWork();
    for (const asAccount of [false, true]) {
      expect(await readGoals(asAccount)).toEqual([
        { block_id: 'sibling-a', goal: 'Only sibling A goal' },
        { block_id: 'sibling-b', goal: 'Only sibling B goal' },
      ]);
      expect(await readOccurrences(asAccount)).toEqual([
        {
          block_id: 'sibling-a',
          activity_run_id: occurrence.activity_run_id,
          task_blocks: { present: true, blocks: pinnedA },
        },
        {
          block_id: 'sibling-b',
          activity_run_id: sibling.activity_run_id,
          task_blocks: { present: true, blocks: pinnedB },
        },
      ]);
    }
    const changedGoal = await inTenant(author, (client) =>
      client.query(
        "SELECT * FROM learning_activity_draft_put($1,$2,$3,1,'Changed sibling goal','D2 activity','completion',NULL,$4::jsonb,'electronics',NULL,NULL,$5)",
        [
          principalId,
          author.tenantId,
          bVersion.activityId,
          JSON.stringify(policies),
          'Future revision must not replace pinned goal',
        ],
      ),
    );
    expect(changedGoal.rows[0]).toMatchObject({ result_code: 'ok', draft_revision: 2 });
    const futureVersion = await inTenant(author, (client) =>
      client.query('SELECT * FROM learning_activity_publish($1,$2,$3,2,$4)', [
        principalId,
        author.tenantId,
        bVersion.activityId,
        `goal:isolation:v2:${++sequence}`,
      ]),
    );
    expect(futureVersion.rows[0].result_code).toBe('ok');
    expect(futureVersion.rows[0].activity_version_id).not.toBe(bVersion.versionId);
    expect(
      (
        await admin.query('SELECT goal FROM learning_activity_versions WHERE id=$1', [
          futureVersion.rows[0].activity_version_id,
        ])
      ).rows[0].goal,
    ).toBe('Future revision must not replace pinned goal');
    for (const asAccount of [false, true]) {
      expect(await readGoals(asAccount)).toEqual([
        { block_id: 'sibling-a', goal: 'Only sibling A goal' },
        { block_id: 'sibling-b', goal: 'Only sibling B goal' },
      ]);
    }
    expect(
      (
        await inTenant(author, (client) =>
          client.query('SELECT learning_activity_blocks_for_seat($1,$2) AS value', [
            seat,
            occurrence.classroom_assignment_id,
          ]),
        )
      ).rows[0].value,
    ).toBeNull();

    await admin.query(
      `UPDATE activity_runs SET operational_overrides=jsonb_build_object('opensAt',
         to_jsonb(now()+interval '1 day')) WHERE id=$1`,
      [sibling.activity_run_id],
    );
    expect(await read(sibling.activity_run_id)).toEqual({ present: true, blocks: null });
    for (const asAccount of [false, true]) {
      expect(await readGoals(asAccount)).toEqual([
        { block_id: 'sibling-a', goal: 'Only sibling A goal' },
        { block_id: 'sibling-b', goal: null },
      ]);
    }
    const projectId = (
      await admin.query(
        `INSERT INTO projects(tenant_id,project_scope,module_key,title,owner_principal_id)
         VALUES($1,'personal','electronics',$2,$3) RETURNING id`,
        [author.tenantId, `A2c shared work ${++sequence}`, principalId],
      )
    ).rows[0].id as string;
    await admin.query(
      `INSERT INTO project_drafts
         (tenant_id,project_id,document_json,revision,updated_by_principal_id)
       VALUES($1,$2,'{"schemaVersion":1,"components":[]}'::jsonb,1,$3)`,
      [author.tenantId, projectId, principalId],
    );
    await admin.query(
      `INSERT INTO project_snapshots
         (tenant_id,project_id,image,content_type,width,height,source_revision,captured_by_principal_id)
       VALUES($1,$2,$3,'image/png',16,16,1,$4)`,
      [author.tenantId, projectId, Buffer.alloc(64), principalId],
    );
    expect(
      (
        await inTenant(author, (client) =>
          client.query('SELECT * FROM classroom_assignment_work_start($1,$2,$3)', [
            seat,
            occurrence.classroom_assignment_id,
            projectId,
          ]),
        )
      ).rows[0].project_id,
    ).toBe(projectId);
    await expectUnattributedWork();
    expect(await read(sibling.activity_run_id)).toEqual({ present: true, blocks: null });
    expect(await read(occurrence.activity_run_id)).toEqual({ present: true, blocks: pinnedA });
    for (const asAccount of [false, true]) {
      // Shared assignment work has no ActivityRun key; it cannot open a future sibling.
      expect(await readGoals(asAccount)).toEqual([
        { block_id: 'sibling-a', goal: 'Only sibling A goal' },
        { block_id: 'sibling-b', goal: null },
      ]);
      expect((await readOccurrences(asAccount)).map((row) => row.task_blocks)).toEqual([
        { present: true, blocks: pinnedA },
        { present: true, blocks: null },
      ]);
    }
    const workContext = (
      await inTenant(author, (client) =>
        client.query('SELECT context FROM learning_work_context_for_project($1,$2)', [
          principalId,
          projectId,
        ]),
      )
    ).rows;
    expect(workContext).toHaveLength(2);
    expect(
      workContext.every(
        (row) =>
          row.context.blocks === null &&
          row.context.blocksSnapshotPresent === false &&
          row.context.goal === null,
      ),
    ).toBe(true);
    await admin.query("UPDATE activity_runs SET operational_overrides='{}'::jsonb WHERE id=$1", [
      sibling.activity_run_id,
    ]);
    await expectUnattributedWork();
    expect(await read(sibling.activity_run_id)).toEqual({ present: true, blocks: pinnedB });
    for (const asAccount of [false, true]) {
      expect(await readGoals(asAccount)).toEqual([
        { block_id: 'sibling-a', goal: 'Only sibling A goal' },
        { block_id: 'sibling-b', goal: 'Only sibling B goal' },
      ]);
    }
    const siblingParticipationId = (
      await admin.query(
        `SELECT id FROM activity_participations
          WHERE activity_run_id=$1 AND learner_identity_id=$2`,
        [sibling.activity_run_id, source.learner_identity_id],
      )
    ).rows[0].id as string;
    expect(
      (
        await inTenant(author, (client) =>
          client.query('SELECT * FROM activity_participation_withdraw($1,$2)', [
            principalId,
            siblingParticipationId,
          ]),
        )
      ).rows[0].result_code,
    ).toBe('ok');
    for (const asAccount of [false, true]) {
      expect(await readGoals(asAccount)).toEqual([
        { block_id: 'sibling-a', goal: 'Only sibling A goal' },
        { block_id: 'sibling-b', goal: null },
      ]);
    }
    await admin.query(
      'UPDATE classroom_assignment_work SET submitted_at=now() WHERE assignment_id=$1 AND seat_id=$2',
      [occurrence.classroom_assignment_id, seat],
    );
    await expectUnattributedWork();
  });

  it('projects exact block occurrences for seat and account without changing legacy lesson runtime', async () => {
    const blockA = await publishActivity(
      author,
      principalId,
      'electronics',
      undefined,
      'Собрать цепь A',
    );
    const blockB = await publishActivity(
      author,
      principalId,
      'three-d',
      undefined,
      'Собрать модель B',
    );
    const { courseId, sectionId } = await newCourse('D4b learner projection');
    const blocks = [
      { id: 'activity-a', type: 'activity', learningActivityVersionId: blockA.versionId },
      { id: 'activity-b', type: 'activity', learningActivityVersionId: blockB.versionId },
    ];
    const activityLessonId = (
      await admin.query(
        "SELECT course_lesson_save_v3($1,$2,$3,NULL,'D4b activities',NULL,$4::jsonb,'material',NULL,15,NULL) AS id",
        [principalId, courseId, sectionId, JSON.stringify(blocks)],
      )
    ).rows[0].id as string;
    const materialLessonId = (
      await admin.query(
        "SELECT course_lesson_save_v3($1,$2,$3,NULL,'D4b material',NULL,$4::jsonb,'material',NULL,10,NULL) AS id",
        [
          principalId,
          courseId,
          sectionId,
          JSON.stringify([{ id: 'paragraph', type: 'paragraph', text: 'Material only' }]),
        ],
      )
    ).rows[0].id as string;
    const legacyLessonId = (
      await admin.query(
        "SELECT course_lesson_save_v3($1,$2,$3,NULL,'D4b legacy',NULL,'[]'::jsonb,'assignment',NULL,20,$4) AS id",
        [principalId, courseId, sectionId, blockA.versionId],
      )
    ).rows[0].id as string;
    const revision = Number(
      (await admin.query('SELECT draft_revision FROM courses WHERE id=$1', [courseId])).rows[0]
        .draft_revision,
    );
    await admin.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
      principalId,
      courseId,
      revision,
      `d4b:publish:${++sequence}`,
    ]);

    const { classroom, seat } = await classroomWithSeat(accountId);
    const assigned = await assignCourseRun(courseId, classroom, seat, `d4b:assign:${++sequence}`);
    expect(assigned).toMatchObject({ result_code: 'ok', reused: false });

    const readSeat = async () =>
      (
        await inTenant(author, (client) =>
          client.query(
            'SELECT * FROM classroom_course_activity_occurrences_for_seat($1) ORDER BY block_id',
            [seat],
          ),
        )
      ).rows;
    const readAccount = async () =>
      (
        await inTenant(author, (client) =>
          client.query(
            'SELECT * FROM classroom_course_activity_occurrences_for_account($1) WHERE seat_id=$2 ORDER BY block_id',
            [accountId, seat],
          ),
        )
      ).rows;

    const initialSeat = await readSeat();
    const initialAccount = await readAccount();
    for (const rows of [initialSeat, initialAccount]) {
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.block_id)).toEqual(['activity-a', 'activity-b']);
      expect(new Set(rows.map((row) => row.activity_run_id)).size).toBe(2);
      expect(new Set(rows.map((row) => row.classroom_assignment_id)).size).toBe(2);
      expect(rows.map((row) => row.learning_activity_version_id)).toEqual([
        blockA.versionId,
        blockB.versionId,
      ]);
      expect(rows.map((row) => row.goal)).toEqual(['Собрать цепь A', 'Собрать модель B']);
      expect(rows.map((row) => row.module_key)).toEqual(['electronics', 'three-d']);
      expect(rows.every((row) => row.project_id === null)).toBe(true);
    }

    const a = initialSeat.find((row) => row.block_id === 'activity-a');
    if (!a) throw new Error('activity A occurrence missing');
    await admin.query(
      `UPDATE activity_runs
          SET operational_overrides=jsonb_build_object('opensAt',to_jsonb(now()+interval '1 day'))
        WHERE id=$1`,
      [a.activity_run_id],
    );
    expect((await readSeat()).find((row) => row.block_id === 'activity-a')?.goal).toBeNull();
    expect((await readAccount()).find((row) => row.block_id === 'activity-a')?.goal).toBeNull();
    await admin.query("UPDATE activity_runs SET operational_overrides='{}'::jsonb WHERE id=$1", [
      a.activity_run_id,
    ]);

    const revised = await inTenant(author, (client) =>
      client.query(
        "SELECT * FROM learning_activity_draft_put($1,$2,$3,1,'D4b revised','D2 activity','completion',NULL,$4::jsonb,'electronics',NULL,NULL,$5)",
        [
          principalId,
          author.tenantId,
          blockA.activityId,
          JSON.stringify(policies),
          'Цель версии B',
        ],
      ),
    );
    expect(revised.rows[0]).toMatchObject({ result_code: 'ok', draft_revision: 2 });
    const v2 = await inTenant(author, (client) =>
      client.query('SELECT * FROM learning_activity_publish($1,$2,$3,2,$4)', [
        principalId,
        author.tenantId,
        blockA.activityId,
        `d4b:goal:v2:${++sequence}`,
      ]),
    );
    expect(v2.rows[0].result_code).toBe('ok');
    expect(v2.rows[0].activity_version_id).not.toBe(blockA.versionId);
    expect((await readSeat()).find((row) => row.block_id === 'activity-a')?.goal).toBe(
      'Собрать цепь A',
    );
    expect((await readAccount()).find((row) => row.block_id === 'activity-a')?.goal).toBe(
      'Собрать цепь A',
    );
    const projectId = (
      await admin.query(
        `INSERT INTO projects
           (tenant_id,project_scope,module_key,title,owner_principal_id)
         VALUES($1,'personal','electronics',$2,$3) RETURNING id`,
        [author.tenantId, `D4b learner work ${++sequence}`, principalId],
      )
    ).rows[0].id as string;
    await admin.query(
      `INSERT INTO project_drafts
         (tenant_id,project_id,document_json,revision,updated_by_principal_id)
       VALUES($1,$2,'{"schemaVersion":1,"components":[]}'::jsonb,7,$3)`,
      [author.tenantId, projectId, principalId],
    );
    await inTenant(author, (client) =>
      client.query('SELECT * FROM classroom_assignment_work_start($1,$2,$3)', [
        seat,
        a.classroom_assignment_id,
        projectId,
      ]),
    );

    const afterSeat = await readSeat();
    const afterAccount = await readAccount();
    const exactContext = await inTenant(author, (client) =>
      client.query('SELECT context FROM learning_work_context_for_project($1,$2)', [
        principalId,
        projectId,
      ]),
    );
    expect(exactContext.rows).toHaveLength(1);
    expect(exactContext.rows[0].context).toMatchObject({
      projectId,
      seatId: seat,
      learningActivityVersionId: blockA.versionId,
      sourceKind: 'course',
      courseBlockId: 'activity-a',
      courseLessonId: a.lesson_id,
      goal: 'Собрать цепь A',
      sampleImage: null,
    });
    expect(exactContext.rows[0].context.activityRunId).toBe(a.activity_run_id);
    expect(
      (
        await inTenant(author, (client) =>
          client.query('SELECT context FROM learning_work_context_for_project($1,$2)', [
            outsiderPrincipalId,
            projectId,
          ]),
        )
      ).rows,
    ).toEqual([]);
    for (const rows of [afterSeat, afterAccount]) {
      const projectedA = rows.find((row) => row.block_id === 'activity-a');
      const projectedB = rows.find((row) => row.block_id === 'activity-b');
      expect(projectedA).toMatchObject({
        project_id: projectId,
        classroom_assignment_id: a.classroom_assignment_id,
        learning_activity_version_id: blockA.versionId,
        module_key: 'electronics',
      });
      expect(
        (
          await inTenant(author, (client) =>
            client.query('SELECT learning_course_activity_assignment_is_shared($1) AS shared', [
              a.classroom_assignment_id,
            ]),
          )
        ).rows[0].shared,
      ).toBe(false);
      expect(projectedA?.work_updated_at).toBeTruthy();
      expect(projectedB).toMatchObject({
        project_id: null,
        learning_activity_version_id: blockB.versionId,
        module_key: 'three-d',
      });
    }
    await admin.query(
      `UPDATE activity_runs SET operational_overrides=jsonb_build_object('opensAt',
         to_jsonb(now()+interval '1 day')) WHERE id=$1`,
      [a.activity_run_id],
    );
    expect((await readSeat()).find((row) => row.block_id === 'activity-a')?.goal).toBe(
      'Собрать цепь A',
    );
    expect((await readAccount()).find((row) => row.block_id === 'activity-a')?.goal).toBe(
      'Собрать цепь A',
    );
    await admin.query("UPDATE activity_runs SET operational_overrides='{}'::jsonb WHERE id=$1", [
      a.activity_run_id,
    ]);

    const evidence = (
      await inTenant(author, (client) =>
        client.query(
          `SELECT evidence
             FROM learning_canonical_evidence_for_seat($1)
            WHERE evidence ->> 'classroomAssignmentId' = ANY($2::text[])`,
          [seat, afterSeat.map((row) => row.classroom_assignment_id)],
        ),
      )
    ).rows.map((row) => row.evidence);
    expect(evidence).toHaveLength(2);
    for (const occurrence of afterSeat) {
      const state = evidence.find(
        (row) => row.classroomAssignmentId === occurrence.classroom_assignment_id,
      );
      expect(state?.activityRunId).toBe(occurrence.activity_run_id);
    }
    expect(
      evidence.find((row) => row.classroomAssignmentId === a.classroom_assignment_id)?.legacyWork
        ?.projectId,
    ).toBe(projectId);

    const legacyRows = (
      await inTenant(author, (client) =>
        client.query(
          `SELECT lesson_id,source_lesson_id,classroom_assignment_id
             FROM classroom_course_runs_for_seat_v2($1)
            WHERE run_id=$2`,
          [seat, assigned.run_id],
        ),
      )
    ).rows;
    expect(legacyRows.map((row) => row.source_lesson_id)).toEqual(
      expect.arrayContaining([activityLessonId, materialLessonId, legacyLessonId]),
    );
    const legacyRuntimeLesson = legacyRows.find((row) => row.source_lesson_id === legacyLessonId);
    expect(legacyRuntimeLesson?.classroom_assignment_id).toBeTruthy();
    expect(afterSeat.every((row) => row.lesson_id !== legacyRuntimeLesson?.lesson_id)).toBe(true);

    const legacyProjectId = (
      await admin.query(
        `INSERT INTO projects
           (tenant_id,project_scope,module_key,title,owner_principal_id)
         VALUES($1,'personal','electronics',$2,$3) RETURNING id`,
        [author.tenantId, `D4b legacy lesson work ${++sequence}`, principalId],
      )
    ).rows[0].id as string;
    await admin.query(
      `INSERT INTO project_drafts
         (tenant_id,project_id,document_json,revision,updated_by_principal_id)
       VALUES($1,$2,'{"schemaVersion":1,"components":[]}'::jsonb,1,$3)`,
      [author.tenantId, legacyProjectId, principalId],
    );
    await inTenant(author, (client) =>
      client.query('SELECT * FROM classroom_assignment_work_start($1,$2,$3)', [
        seat,
        legacyRuntimeLesson!.classroom_assignment_id,
        legacyProjectId,
      ]),
    );
    const legacyContext = await inTenant(author, (client) =>
      client.query('SELECT context FROM learning_work_context_for_project($1,$2)', [
        principalId,
        legacyProjectId,
      ]),
    );
    expect(legacyContext.rows).toHaveLength(1);
    expect(legacyContext.rows[0].context).toMatchObject({
      projectId: legacyProjectId,
      learningActivityVersionId: blockA.versionId,
      sourceKind: 'course',
      courseBlockId: null,
      courseLessonId: legacyRuntimeLesson!.lesson_id,
    });

    await admin.query("UPDATE classrooms SET status='archived',archived_at=now() WHERE id=$1", [
      classroom,
    ]);
    for (const rows of [await readSeat(), await readAccount()]) {
      expect(rows.find((row) => row.block_id === 'activity-a')).toMatchObject({
        project_id: projectId,
        goal: 'Собрать цепь A',
      });
      expect(rows.find((row) => row.block_id === 'activity-b')).toMatchObject({
        project_id: null,
        goal: null,
      });
    }
  });
});

describe('A2c exact Course Activity task blocks', () => {
  it('shows pinned ordered blocks for Seat and Account after opening and keeps v1 after a future draft', async () => {
    const blocksV1 = [
      { type: 'heading', text: 'Course activity v1' },
      { type: 'list', items: ['Measure', 'Explain'] },
      { type: 'link', text: 'Read more', href: 'https://example.org/course' },
    ];
    const visibleBlocksV1 = [{ type: 'paragraph', text: 'D2 activity' }, ...blocksV1];
    const activity = await publishActivity(
      author,
      principalId,
      'electronics',
      undefined,
      null,
      blocksV1,
    );
    const { courseId, sectionId } = await newCourse('A2c exact blocks');
    await admin.query(
      "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Block lesson',NULL,$4::jsonb,'material',NULL,15,NULL)",
      [
        principalId,
        courseId,
        sectionId,
        JSON.stringify([
          { id: 'a2c-activity', type: 'activity', learningActivityVersionId: activity.versionId },
        ]),
      ],
    );
    const revision = Number(
      (await admin.query('SELECT draft_revision FROM courses WHERE id=$1', [courseId])).rows[0]
        .draft_revision,
    );
    expect(
      (
        await admin.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
          principalId,
          courseId,
          revision,
          `a2c:course:publish:${++sequence}`,
        ])
      ).rows[0].result_code,
    ).toBe('ok');
    const { classroom, seat } = await classroomWithSeat(accountId);
    expect(
      (await assignCourseRun(courseId, classroom, seat, `a2c:assign:${++sequence}`)).result_code,
    ).toBe('ok');
    const occurrence = (
      await inTenant(author, (client) =>
        client.query('SELECT * FROM classroom_course_activity_occurrences_for_seat($1)', [seat]),
      )
    ).rows[0];
    expect(occurrence.learning_activity_version_id).toBe(activity.versionId);
    const read = async () =>
      (
        await inTenant(author, (client) =>
          client.query('SELECT learning_activity_blocks_for_seat($1,$2,$3) AS value', [
            seat,
            occurrence.classroom_assignment_id,
            occurrence.activity_run_id,
          ]),
        )
      ).rows[0].value as { present: boolean; blocks: unknown[] | null };
    expect(await read()).toEqual({ present: true, blocks: visibleBlocksV1 });
    const accountOccurrences = (
      await inTenant(author, (client) =>
        client.query(
          `SELECT * FROM classroom_course_activity_occurrences_for_account($1)
            WHERE seat_id=$2 AND classroom_assignment_id=$3 AND activity_run_id=$4`,
          [accountId, seat, occurrence.classroom_assignment_id, occurrence.activity_run_id],
        ),
      )
    ).rows;
    expect(accountOccurrences).toHaveLength(1);
    expect(accountOccurrences[0]).toMatchObject({
      seat_id: seat,
      learning_activity_version_id: activity.versionId,
    });
    expect(await read()).toEqual({ present: true, blocks: visibleBlocksV1 });
    await admin.query(
      `UPDATE activity_runs SET operational_overrides=jsonb_build_object('opensAt',to_jsonb(now()+interval '1 day')) WHERE id=$1`,
      [occurrence.activity_run_id],
    );
    expect(await read()).toEqual({ present: true, blocks: null });
    await admin.query("UPDATE activity_runs SET operational_overrides='{}'::jsonb WHERE id=$1", [
      occurrence.activity_run_id,
    ]);
    expect(await read()).toEqual({ present: true, blocks: visibleBlocksV1 });
    const revised = (
      await inTenant(author, (client) =>
        client.query(
          `SELECT * FROM learning_activity_draft_put($1,$2,$3,1,'A2c future draft','Future instructions',
         'completion',NULL,$4::jsonb,'electronics',NULL,NULL,NULL::jsonb,$5::jsonb)`,
          [
            principalId,
            author.tenantId,
            activity.activityId,
            JSON.stringify(policies),
            JSON.stringify([{ type: 'paragraph', text: 'Future blocks v2' }]),
          ],
        ),
      )
    ).rows[0];
    expect(revised.result_code).toBe('ok');
    expect(
      (
        await inTenant(author, (client) =>
          client.query('SELECT * FROM learning_activity_publish($1,$2,$3,2,$4)', [
            principalId,
            author.tenantId,
            activity.activityId,
            `a2c:publish:v2:${++sequence}`,
          ]),
        )
      ).rows[0].result_code,
    ).toBe('ok');
    expect(await read()).toEqual({ present: true, blocks: visibleBlocksV1 });
    const participation = (
      await admin.query(
        `SELECT participation.id FROM activity_participations participation
           JOIN learner_identity_links link
             ON link.learner_identity_id=participation.learner_identity_id
          WHERE participation.activity_run_id=$1 AND link.seat_id=$2 AND link.status='active'`,
        [occurrence.activity_run_id, seat],
      )
    ).rows[0].id as string;
    expect(
      (
        await inTenant(author, (client) =>
          client.query('SELECT * FROM activity_participation_withdraw($1,$2)', [
            principalId,
            participation,
          ]),
        )
      ).rows[0].result_code,
    ).toBe('ok');
    expect(await read()).toEqual({ present: true, blocks: null });
  });
});

describe('A2a exact Course Activity sample delivery', () => {
  it('keeps sibling samples and the pinned v1 bytes distinct, then revokes unstarted closed work', async () => {
    const imageA = Buffer.from('a2a-pinned-v1-sample');
    const imageB = Buffer.from('a2a-sibling-sample');
    const imageV2 = Buffer.from('a2a-new-draft-v2-sample');
    const activityA = await publishActivity(author, principalId, 'electronics', imageA);
    const activityB = await publishActivity(author, principalId, 'three-d', imageB);
    const activityWithoutSample = await publishActivity(author, principalId, 'electronics');
    const { courseId, sectionId } = await newCourse('A2a exact media');
    const blocks = [
      { id: 'sample-a', type: 'activity', learningActivityVersionId: activityA.versionId },
      { id: 'sample-b', type: 'activity', learningActivityVersionId: activityB.versionId },
      {
        id: 'sample-none',
        type: 'activity',
        learningActivityVersionId: activityWithoutSample.versionId,
      },
    ];
    await admin.query(
      "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Two samples',NULL,$4::jsonb,'material',NULL,15,NULL)",
      [principalId, courseId, sectionId, JSON.stringify(blocks)],
    );
    const revision = Number(
      (await admin.query('SELECT draft_revision FROM courses WHERE id=$1', [courseId])).rows[0]
        .draft_revision,
    );
    const published = await admin.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
      principalId,
      courseId,
      revision,
      `a2a:course:publish:${++sequence}`,
    ]);
    expect(published.rows[0].result_code).toBe('ok');
    const { classroom, seat } = await classroomWithSeat(accountId);
    const excluded = (
      await admin.query(
        `INSERT INTO classroom_student_seats
           (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
            safe_mode,status,created_by)
         VALUES($1,$2,'Excluded A2a',$3,$3,true,'active',$4) RETURNING id`,
        [author.tenantId, classroom, `a2a-excluded-${++sequence}`, author.teacherId],
      )
    ).rows[0].id as string;
    const assigned = await assignCourseRun(courseId, classroom, seat, `a2a:assign:${++sequence}`);
    expect(assigned.result_code).toBe('ok');
    const occurrences = (
      await inTenant(author, (client) =>
        client.query(
          'SELECT * FROM classroom_course_activity_occurrences_for_seat($1) ORDER BY block_id',
          [seat],
        ),
      )
    ).rows;
    expect(occurrences.map((row) => row.block_id)).toEqual(['sample-a', 'sample-b', 'sample-none']);
    const [a, b, withoutSample] = occurrences;
    const url = async (runId: string, account: string | null, seatId: string | null) =>
      (
        await inTenant(author, (client) =>
          client.query('SELECT learning_course_activity_sample_url_for_viewer($1,$2,$3) AS url', [
            runId,
            account,
            seatId,
          ]),
        )
      ).rows[0].url as string | null;
    const bytes = async (runId: string, account: string | null, seatId: string | null) =>
      (
        await inTenant(author, (client) =>
          client.query('SELECT * FROM learning_course_activity_sample_for_viewer($1,$2,$3)', [
            runId,
            account,
            seatId,
          ]),
        )
      ).rows;
    expect(await url(a.activity_run_id, null, seat)).toBe(
      `/api/class-join/course-activities/${a.activity_run_id}/sample`,
    );
    expect(await url(b.activity_run_id, accountId, null)).toBe(
      `/api/class-join/course-activities/${b.activity_run_id}/sample`,
    );
    expect(
      Buffer.compare((await bytes(a.activity_run_id, null, seat))[0].sample_bytes, imageA),
    ).toBe(0);
    expect(
      Buffer.compare((await bytes(b.activity_run_id, accountId, null))[0].sample_bytes, imageB),
    ).toBe(0);
    expect(await url(a.activity_run_id, null, excluded)).toBeNull();
    expect(await bytes(a.activity_run_id, null, excluded)).toEqual([]);
    expect(await url(withoutSample.activity_run_id, null, seat)).toBeNull();
    expect(await bytes(withoutSample.activity_run_id, null, seat)).toEqual([]);
    expect(await url(a.activity_run_id, null, null)).toBeNull();
    expect(await url(a.activity_run_id, accountId, seat)).toBeNull();

    const viewers: Array<[string | null, string | null]> = [
      [null, seat],
      [accountId, null],
    ];
    const expectUnstartedDenied = async (runId: string) => {
      for (const [account, seatId] of viewers) {
        expect(await url(runId, account, seatId)).toBeNull();
        // The direct GET calls this same byte function with the viewer actor.
        expect(await bytes(runId, account, seatId)).toEqual([]);
      }
    };
    const expectUnstartedAllowed = async (runId: string, image: Buffer) => {
      for (const [account, seatId] of viewers) {
        expect(await url(runId, account, seatId)).toBeTruthy();
        expect(Buffer.compare((await bytes(runId, account, seatId))[0].sample_bytes, image)).toBe(
          0,
        );
      }
    };
    const participationId = (
      await admin.query(
        `SELECT participation.id
           FROM activity_participations participation
           JOIN learner_identity_links link
             ON link.learner_identity_id=participation.learner_identity_id
            AND link.seat_id=$2 AND link.status='active'
          WHERE participation.activity_run_id=$1`,
        [a.activity_run_id, seat],
      )
    ).rows[0].id as string;

    // Run pins are immutable; a future operational run opensAt gates bytes.
    await admin.query(
      `UPDATE activity_runs
          SET operational_overrides=jsonb_build_object('opensAt',to_jsonb(now()+interval '1 day'))
        WHERE id=$1`,
      [a.activity_run_id],
    );
    await expectUnstartedDenied(a.activity_run_id);
    await expectUnstartedAllowed(b.activity_run_id, imageB);
    await admin.query("UPDATE activity_runs SET operational_overrides='{}'::jsonb WHERE id=$1", [
      a.activity_run_id,
    ]);

    // Individual overrides belong to this exact ActivityParticipation; a
    // withdrawn participation cannot inherit its active CourseEnrollment.
    await admin.query(
      "UPDATE activity_participations SET opens_at_override=now()+interval '1 day' WHERE id=$1",
      [participationId],
    );
    await expectUnstartedDenied(a.activity_run_id);
    await admin.query('UPDATE activity_participations SET opens_at_override=NULL WHERE id=$1', [
      participationId,
    ]);
    await admin.query(
      `UPDATE activity_participations
          SET operational_overrides=jsonb_build_object('opensAt',to_jsonb(now()+interval '1 day'))
        WHERE id=$1`,
      [participationId],
    );
    await expectUnstartedDenied(a.activity_run_id);
    await admin.query(
      "UPDATE activity_participations SET operational_overrides='{}'::jsonb WHERE id=$1",
      [participationId],
    );
    await expectUnstartedAllowed(a.activity_run_id, imageA);

    const bParticipationId = (
      await admin.query('SELECT id FROM activity_participations WHERE activity_run_id=$1', [
        b.activity_run_id,
      ])
    ).rows[0].id as string;
    const withdrawn = await inTenant(author, (client) =>
      client.query('SELECT * FROM activity_participation_withdraw($1,$2)', [
        principalId,
        bParticipationId,
      ]),
    );
    expect(withdrawn.rows[0].result_code).toBe('ok');
    expect(
      (
        await admin.query(
          'SELECT status FROM course_enrollments WHERE course_run_id=$1 AND learner_identity_id=(SELECT learner_identity_id FROM activity_participations WHERE id=$2)',
          [assigned.run_id, bParticipationId],
        )
      ).rows[0].status,
    ).toMatch(/^(assigned|active)$/);
    await expectUnstartedDenied(b.activity_run_id);

    const uploadedV2 = await inTenant(author, (client) =>
      client.query(`SELECT * FROM learning_activity_draft_sample_set($1,$2,$3,2,$4,'image/png')`, [
        principalId,
        author.tenantId,
        activityA.activityId,
        imageV2,
      ]),
    );
    expect(uploadedV2.rows[0].result_code).toBe('ok');
    const v2 = await inTenant(author, (client) =>
      client.query('SELECT * FROM learning_activity_publish($1,$2,$3,3,$4)', [
        principalId,
        author.tenantId,
        activityA.activityId,
        `a2a:activity:v2:${++sequence}`,
      ]),
    );
    expect(v2.rows[0].result_code).toBe('ok');
    expect(v2.rows[0].activity_version_id).not.toBe(activityA.versionId);
    expect(
      Buffer.compare((await bytes(a.activity_run_id, null, seat))[0].sample_bytes, imageA),
    ).toBe(0);

    const projectId = (
      await admin.query(
        `INSERT INTO projects(tenant_id,project_scope,module_key,title,owner_principal_id)
         VALUES($1,'personal','electronics','A2a historical work',$2) RETURNING id`,
        [author.tenantId, principalId],
      )
    ).rows[0].id as string;
    await admin.query(
      `INSERT INTO project_drafts
         (tenant_id,project_id,document_json,revision,updated_by_principal_id)
       VALUES($1,$2,'{"schemaVersion":1,"components":[]}'::jsonb,1,$3)`,
      [author.tenantId, projectId, principalId],
    );
    await inTenant(author, (client) =>
      client.query('SELECT * FROM classroom_assignment_work_start($1,$2,$3)', [
        seat,
        a.classroom_assignment_id,
        projectId,
      ]),
    );
    await admin.query("UPDATE classroom_course_runs SET status='closed' WHERE id=$1", [
      assigned.run_id,
    ]);
    await admin.query("UPDATE classroom_assignments SET status='closed' WHERE id=$1", [
      a.classroom_assignment_id,
    ]);
    expect(await url(a.activity_run_id, null, seat)).toBeTruthy();
    expect(await url(b.activity_run_id, null, seat)).toBeNull();
    await admin.query(
      `UPDATE course_enrollments
          SET status='withdrawn', withdrawn_at=now(),
              withdrawn_by_principal_id=$2, withdrawal_source='teacher_command'
        WHERE course_run_id=$1`,
      [assigned.run_id, principalId],
    );
    expect(
      (
        await admin.query('SELECT status FROM activity_participations WHERE id=$1', [
          participationId,
        ])
      ).rows[0].status,
    ).toBe('withdrawn');
    expect(await url(a.activity_run_id, null, seat)).toBeTruthy();
    expect(await url(b.activity_run_id, null, seat)).toBeNull();
    await admin.query("UPDATE classrooms SET status='archived',archived_at=now() WHERE id=$1", [
      classroom,
    ]);
    expect(await url(a.activity_run_id, null, seat)).toBeTruthy();
    expect(await url(b.activity_run_id, null, seat)).toBeNull();
    await admin.query(
      "UPDATE activity_runs SET lifecycle_status='closed',closed_at=now() WHERE id=$1",
      [a.activity_run_id],
    );
    await admin.query(
      "UPDATE activity_runs SET lifecycle_status='archived',archived_at=now() WHERE id=$1",
      [a.activity_run_id],
    );
    expect(await url(a.activity_run_id, null, seat)).toBeTruthy();
    await admin.query("UPDATE classroom_student_seats SET status='suspended' WHERE id=$1", [seat]);
    expect(await bytes(a.activity_run_id, null, seat)).toEqual([]);
  }, 30_000);
});
