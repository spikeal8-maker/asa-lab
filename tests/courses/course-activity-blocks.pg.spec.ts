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
) {
  sequence += 1;
  const created = await inTenant(teacher, (client) =>
    client.query(
      "SELECT * FROM learning_activity_create($1,$2,'school','private','project',$3,'D2 activity','completion',NULL,$4::jsonb,$5,NULL,NULL,NULL,$6)",
      [
        ownerPrincipalId,
        teacher.tenantId,
        `D2 activity ${sequence}`,
        JSON.stringify(policies),
        moduleKey,
        `d2:create:${sequence}`,
      ],
    ),
  );
  expect(created.rows[0].result_code).toBe('ok');
  const published = await inTenant(teacher, (client) =>
    client.query('SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)', [
      ownerPrincipalId,
      teacher.tenantId,
      created.rows[0].activity_id,
      `d2:publish:${sequence}`,
    ]),
  );
  expect(published.rows[0].result_code).toBe('ok');
  return {
    activityId: created.rows[0].activity_id as string,
    versionId: published.rows[0].activity_version_id as string,
  };
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
    const unsupported = await publishActivity(author, principalId, 'chess');
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
    const unsupported = await publishActivity(author, principalId, 'manual-lab');
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
  it('projects exact block occurrences for seat and account without changing legacy lesson runtime', async () => {
    const blockA = await publishActivity(author, principalId, 'electronics');
    const blockB = await publishActivity(author, principalId, 'three-d');
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
            'SELECT * FROM classroom_course_activity_occurrences_for_account($1) ORDER BY block_id',
            [accountId],
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
      expect(rows.map((row) => row.module_key)).toEqual(['electronics', 'three-d']);
      expect(rows.every((row) => row.project_id === null)).toBe(true);
    }

    const a = initialSeat.find((row) => row.block_id === 'activity-a');
    if (!a) throw new Error('activity A occurrence missing');
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
    for (const rows of [afterSeat, afterAccount]) {
      const projectedA = rows.find((row) => row.block_id === 'activity-a');
      const projectedB = rows.find((row) => row.block_id === 'activity-b');
      expect(projectedA).toMatchObject({
        project_id: projectId,
        classroom_assignment_id: a.classroom_assignment_id,
        learning_activity_version_id: blockA.versionId,
        module_key: 'electronics',
      });
      expect(projectedA?.work_updated_at).toBeTruthy();
      expect(projectedB).toMatchObject({
        project_id: null,
        learning_activity_version_id: blockB.versionId,
        module_key: 'three-d',
      });
    }

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
  });
});
