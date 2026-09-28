import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool;
let app: pg.Pool;
let owner: SeededTeacher;
let principalId: string;
let accountId: string;
let sequence = 0;

const policies = {
  attemptPolicy: { maxAttempts: 1 },
  resultSelectionPolicy: { mode: 'latest' },
  completionPolicy: { mode: 'submission' },
  latePolicy: { mode: 'allow_mark_late' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'after_review' },
};

async function asApp<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [owner.tenantId]);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createActivity() {
  const created = await admin.query(
    `SELECT * FROM learning_activity_create(
       $1,$2,'school','private','project',$3,'Build the exact circuit',
       'completion',NULL,$4::jsonb,'electronics',NULL,NULL,NULL,$5)`,
    [
      principalId,
      owner.tenantId,
      `Image task ${++sequence}`,
      JSON.stringify(policies),
      `a2d:create:${sequence}:0001`,
    ],
  );
  expect(created.rows[0]).toMatchObject({ result_code: 'ok', draft_revision: 1 });
  return created.rows[0].activity_id as string;
}

async function upload(activityId: string, revision: number, bytes: Buffer) {
  const result = await admin.query(
    "SELECT * FROM learning_activity_draft_task_image_set($1,$2,$3,$4,$5,'image/png')",
    [principalId, owner.tenantId, activityId, revision, bytes],
  );
  expect(result.rows[0]).toMatchObject({ result_code: 'ok', draft_revision: revision + 1 });
  return result.rows[0].content_hash as string;
}

async function publish(activityId: string, revision: number) {
  const result = await admin.query('SELECT * FROM learning_activity_publish($1,$2,$3,$4,$5)', [
    principalId,
    owner.tenantId,
    activityId,
    revision,
    `a2d:publish:${++sequence}:0001`,
  ]);
  expect(result.rows[0]).toMatchObject({ result_code: 'ok', reused: false });
  return result.rows[0] as {
    activity_version_id: string;
    content_digest: string;
    version_number: number;
  };
}

async function classroom() {
  const result = await admin.query(
    `INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by)
     VALUES($1,$2,$3,$4,$5) RETURNING id`,
    [owner.tenantId, owner.schoolId, owner.periodId, `A2d class ${++sequence}`, owner.teacherId],
  );
  const id = result.rows[0].id as string;
  await admin.query(
    "INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner')",
    [owner.tenantId, id, owner.teacherId, accountId],
  );
  return id;
}

async function seat(classroomId: string) {
  const account = await admin.query(
    `INSERT INTO accounts(email,password_hash,birth_date,country)
     VALUES($1,'isolated-test-only',DATE '1990-01-01','RU') RETURNING id`,
    [`a2d-${++sequence}@test.local`],
  );
  const learnerAccountId = account.rows[0].id as string;
  const created = await admin.query(
    `INSERT INTO classroom_student_seats
       (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
        safe_mode,status,created_by,account_id)
     VALUES($1,$2,'A2d learner',$3,$3,true,'active',$4,$5) RETURNING id`,
    [owner.tenantId, classroomId, `a2d-seat-${++sequence}`, owner.teacherId, learnerAccountId],
  );
  return { id: created.rows[0].id as string, accountId: learnerAccountId };
}

async function viewerImage(hash: string, learnerAccountId: string | null, seatId: string | null) {
  return asApp((client) =>
    client.query('SELECT * FROM learning_task_image_for_viewer($1,$2,$3,$4)', [
      hash,
      owner.tenantId,
      learnerAccountId,
      seatId,
    ]),
  );
}

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  owner = await seedTeacher(admin, 'a2d-task-image');
  const identity = await admin.query(
    'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
    [owner.tenantId, owner.teacherId],
  );
  principalId = identity.rows[0].principal_id as string;
  accountId = identity.rows[0].account_id as string;
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('A2d immutable ordered task image', () => {
  it('pins bytes and digest across replacement, removal, retry, and direct learner reads', async () => {
    const activityId = await createActivity();
    const imageA = Buffer.from('first-class-task-image-A');
    const imageB = Buffer.from('first-class-task-image-B');
    const hashA = await upload(activityId, 1, imageA);
    const draft = await admin.query(
      "SELECT * FROM learning_activity_blocks_preview_as_author($1,$2,$3,'draft',NULL,2)",
      [principalId, owner.tenantId, activityId],
    );
    expect(draft.rows[0].blocks).toEqual([
      { type: 'paragraph', text: 'Build the exact circuit' },
      { type: 'image', alt: 'Изображение задания', contentHash: hashA },
    ]);
    const v1 = await publish(activityId, 2);
    const retry = await admin.query('SELECT * FROM learning_activity_publish($1,$2,$3,2,$4)', [
      principalId,
      owner.tenantId,
      activityId,
      'a2d:publish:retry:0001',
    ]);
    expect(retry.rows[0]).toMatchObject({
      activity_version_id: v1.activity_version_id,
      content_digest: v1.content_digest,
      reused: true,
    });

    const classId = await classroom();
    const assigned = await seat(classId);
    const excluded = await seat(classId);
    const assignment = await asApp((client) =>
      client.query(
        `SELECT * FROM learning_direct_assignment_create(
           $1,$2,$3,$4,'2027-09-30T20:59:00Z','named_learners',$5::uuid[],$6)`,
        [
          principalId,
          owner.tenantId,
          classId,
          v1.activity_version_id,
          [assigned.id],
          `a2d:direct:${++sequence}:0001`,
        ],
      ),
    );
    expect(assignment.rows[0].result_code).toBe('ok');
    const assignmentId = assignment.rows[0].classroom_assignment_id as string;
    const visible = await admin.query('SELECT learning_activity_blocks_for_seat($1,$2) AS task', [
      assigned.id,
      assignmentId,
    ]);
    expect(visible.rows[0].task.blocks[1].contentHash).toBe(hashA);
    const bytesSeat = await viewerImage(hashA, null, assigned.id);
    expect(Buffer.compare(bytesSeat.rows[0].image_bytes as Buffer, imageA)).toBe(0);
    const bytesAccount = await viewerImage(hashA, assigned.accountId, null);
    expect(Buffer.compare(bytesAccount.rows[0].image_bytes as Buffer, imageA)).toBe(0);
    expect((await viewerImage(hashA, null, excluded.id)).rows).toEqual([]);
    expect((await viewerImage('f'.repeat(64), assigned.accountId, null)).rows).toEqual([]);

    const hashB = await upload(activityId, 2, imageB);
    const staleImage = await admin.query(
      `SELECT * FROM learning_activity_draft_put(
         $1,$2,$3,3,'Stale image','Build the exact circuit',
         'completion',NULL,$4::jsonb,'electronics',NULL,NULL,$5::jsonb,$6::jsonb)`,
      [
        principalId,
        owner.tenantId,
        activityId,
        JSON.stringify(policies),
        JSON.stringify(null),
        JSON.stringify([{ type: 'image', alt: 'Stale', contentHash: hashA }]),
      ],
    );
    expect(staleImage.rows[0].result_code).toBe('invalid_draft');
    const v2 = await publish(activityId, 3);
    expect(v2.content_digest).not.toBe(v1.content_digest);
    expect((await viewerImage(hashB, assigned.accountId, null)).rows).toEqual([]);
    const pinned = await admin.query(
      "SELECT content_hash,bytes FROM learning_activity_version_media WHERE activity_version_id=$1 AND role='task-image'",
      [v1.activity_version_id],
    );
    expect(pinned.rows[0].content_hash).toBe(hashA);
    expect(Buffer.compare(pinned.rows[0].bytes as Buffer, imageA)).toBe(0);
    const foreignAuthor = await admin.query(
      'SELECT * FROM learning_activity_version_task_image_get(gen_random_uuid(),$1,$2,$3)',
      [owner.tenantId, activityId, v1.activity_version_id],
    );
    expect(foreignAuthor.rows[0].result_code).toBe('activity_not_found');
    await expect(
      admin.query(
        "DELETE FROM learning_activity_version_media WHERE activity_version_id=$1 AND role='task-image'",
        [v1.activity_version_id],
      ),
    ).rejects.toThrow(/immutable/);

    const removed = await admin.query(
      `SELECT * FROM learning_activity_draft_put(
         $1,$2,$3,3,'Image task without block','Build the exact circuit',
         'completion',NULL,$4::jsonb,'electronics',NULL,NULL,NULL,'[]'::jsonb)`,
      [principalId, owner.tenantId, activityId, JSON.stringify(policies)],
    );
    expect(removed.rows[0]).toMatchObject({ result_code: 'ok', draft_revision: 4 });
    expect(
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM learning_activity_draft_media WHERE activity_id=$1 AND role='task-image'",
          [activityId],
        )
      ).rows[0].n,
    ).toBe(0);
    const v3 = await publish(activityId, 4);
    expect(v3.content_digest).not.toBe(v2.content_digest);
    expect(
      (
        await admin.query(
          "SELECT count(*)::int AS n FROM learning_activity_version_media WHERE activity_version_id=$1 AND role='task-image'",
          [v3.activity_version_id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      Buffer.compare(
        (await viewerImage(hashA, null, assigned.id)).rows[0].image_bytes as Buffer,
        imageA,
      ),
    ).toBe(0);
    expect(
      (
        await admin.query('SELECT content_digest FROM learning_activity_versions WHERE id=$1', [
          v1.activity_version_id,
        ])
      ).rows[0].content_digest,
    ).toBe(v1.content_digest);
    const restored = await admin.query(
      'SELECT * FROM learning_activity_draft_from_version($1,$2,$3,$4,4)',
      [principalId, owner.tenantId, activityId, v1.activity_version_id],
    );
    expect(restored.rows[0]).toMatchObject({ result_code: 'ok', draft_revision: 5 });
    const restoredImage = await admin.query(
      "SELECT bytes,content_hash FROM learning_activity_draft_media WHERE activity_id=$1 AND role='task-image'",
      [activityId],
    );
    expect(restoredImage.rows[0].content_hash).toBe(hashA);
    expect(Buffer.compare(restoredImage.rows[0].bytes as Buffer, imageA)).toBe(0);
    const v4 = await publish(activityId, 5);
    expect(v4.version_number).toBe(4);
  });

  it('serves a Course Activity only through its exact visible occurrence', async () => {
    const activityId = await createActivity();
    const bytes = Buffer.from('course-first-class-image');
    const hash = await upload(activityId, 1, bytes);
    const version = await publish(activityId, 2);
    await admin.query(
      `INSERT INTO teacher_assignments(tenant_id,owner_principal_id,title,brief,module_key,visibility)
       VALUES($1,$2,$3,'anchor','electronics','private')`,
      [owner.tenantId, principalId, `A2d anchor ${++sequence}`],
    );
    const course = await admin.query("SELECT course_save($1,NULL,$2,NULL,NULL,'private') AS id", [
      principalId,
      `A2d course ${++sequence}`,
    ]);
    const courseId = course.rows[0].id as string;
    const outline = await admin.query(
      'SELECT section_id FROM course_outline_v3($1,$2,$3,$4) LIMIT 1',
      [courseId, principalId, accountId, owner.tenantId],
    );
    const blocks = [
      {
        id: 'image-activity',
        type: 'activity',
        learningActivityVersionId: version.activity_version_id,
      },
    ];
    await admin.query(
      "SELECT course_lesson_save_v3($1,$2,$3,NULL,'Image activity',NULL,$4::jsonb,'material',NULL,15,NULL)",
      [principalId, courseId, outline.rows[0].section_id, JSON.stringify(blocks)],
    );
    const revision = await admin.query('SELECT draft_revision FROM courses WHERE id=$1', [
      courseId,
    ]);
    const published = await admin.query('SELECT * FROM course_publish_v3($1,$2,$3,$4)', [
      principalId,
      courseId,
      Number(revision.rows[0].draft_revision),
      `a2d:course:publish:${++sequence}`,
    ]);
    expect(published.rows[0].result_code).toBe('ok');

    const classId = await classroom();
    const assigned = await seat(classId);
    const excluded = await seat(classId);
    const run = await asApp((client) =>
      client.query(
        "SELECT * FROM classroom_course_run_assign_v3($1,$2,$3,NULL,1,'named_learners',$4::uuid[],$5)",
        [principalId, classId, courseId, [assigned.id], `a2d:course:assign:${++sequence}`],
      ),
    );
    expect(run.rows[0].result_code).toBe('ok');
    const occurrence = await admin.query(
      'SELECT activity_run_id,classroom_assignment_id FROM classroom_course_activity_occurrences_for_seat($1)',
      [assigned.id],
    );
    expect(occurrence.rows).toHaveLength(1);
    const task = await admin.query('SELECT learning_activity_blocks_for_seat($1,$2,$3) AS value', [
      assigned.id,
      occurrence.rows[0].classroom_assignment_id,
      occurrence.rows[0].activity_run_id,
    ]);
    expect(task.rows[0].value.blocks[1].contentHash).toBe(hash);
    expect(
      Buffer.compare(
        (await viewerImage(hash, assigned.accountId, null)).rows[0].image_bytes as Buffer,
        bytes,
      ),
    ).toBe(0);
    expect((await viewerImage(hash, null, excluded.id)).rows).toEqual([]);
  });
});
