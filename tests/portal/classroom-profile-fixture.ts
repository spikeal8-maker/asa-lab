import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { SeededTeacher } from './helpers';

export async function profileTeacherIdentity(admin: pg.Pool, teacher: SeededTeacher) {
  return (
    await admin.query<{ account_id: string; principal_id: string }>(
      'SELECT account_id,principal_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
      [teacher.tenantId, teacher.teacherId],
    )
  ).rows[0]!;
}
export async function seedProfileProjectActivity(
  admin: pg.Pool,
  teacher: SeededTeacher,
  title: string,
) {
  const actor = await profileTeacherIdentity(admin, teacher);
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [teacher.tenantId]);
    const policies = {
      attemptPolicy: { maxAttempts: 3 },
      resultSelectionPolicy: { mode: 'latest' },
      completionPolicy: { mode: 'submission' },
      latePolicy: { mode: 'allow_mark_late' },
      assessmentPolicy: { mode: 'manual' },
      feedbackReleasePolicy: { mode: 'after_review' },
    };
    const created = (
      await client.query(
        `SELECT * FROM learning_activity_create($1,$2,'school','private','project',$3,'Создай модель.','completion',NULL,$4::jsonb,'three-d',NULL,NULL,NULL,$5)`,
        [actor.principal_id, teacher.tenantId, title, JSON.stringify(policies), randomUUID()],
      )
    ).rows[0];
    if (created.result_code !== 'ok') throw new Error(`activity: ${created.result_code}`);
    const published = (
      await client.query('SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)', [
        actor.principal_id,
        teacher.tenantId,
        created.activity_id,
        randomUUID(),
      ])
    ).rows[0];
    if (published.result_code !== 'ok') throw new Error(`publish: ${published.result_code}`);
    await client.query('COMMIT');
    return published.activity_version_id as string;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function seedProfileTheory(
  admin: pg.Pool,
  teacher: SeededTeacher,
  classId: string,
  seatIds: string[],
) {
  const actor = await profileTeacherIdentity(admin, teacher);
  const courseId = randomUUID(),
    versionId = randomUUID(),
    courseRunId = randomUUID(),
    lessonId = randomUUID();
  const sourceLesson = randomUUID(),
    sourceSection = randomUUID();
  const title = 'Теория курса без проекта';
  await admin.query(
    "INSERT INTO courses(id,tenant_id,owner_principal_id,title,visibility) VALUES($1,$2,$3,$4,'private')",
    [courseId, teacher.tenantId, actor.principal_id, title],
  );
  const outline = {
    sections: [
      {
        sourceSectionId: sourceSection,
        title: 'Введение',
        position: 0,
        lessons: [
          {
            sourceLessonId: sourceLesson,
            title,
            position: 0,
            kind: 'material',
            blocks: [],
            content: 'Прочитай материал.',
          },
        ],
      },
    ],
  };
  await admin.query(
    `INSERT INTO course_versions(id,tenant_id,course_id,version_number,title,outline,content_hash,published_by_principal_id)
    VALUES($1,$2,$3,1,$4,$5::jsonb,$6,$7)`,
    [
      versionId,
      teacher.tenantId,
      courseId,
      title,
      JSON.stringify(outline),
      createHash('sha256').update(JSON.stringify(outline)).digest('hex'),
      actor.principal_id,
    ],
  );
  await admin.query(
    `INSERT INTO classroom_course_runs(id,tenant_id,classroom_id,course_id,course_version_id,title,version_number,assigned_by_principal_id,creation_request_id,creation_request_digest)
    VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,$9)`,
    [
      courseRunId,
      teacher.tenantId,
      classId,
      courseId,
      versionId,
      title,
      actor.principal_id,
      randomUUID(),
      createHash('sha256').update(courseRunId).digest('hex'),
    ],
  );
  await admin.query(
    `INSERT INTO classroom_course_run_lessons(id,tenant_id,run_id,source_section_id,source_lesson_id,section_title,section_position,title,kind,lesson_position,content)
    VALUES($1,$2,$3,$4,$5,'Введение',0,$6,'material',0,'Прочитай материал.')`,
    [lessonId, teacher.tenantId, courseRunId, sourceSection, sourceLesson, title],
  );
  for (const seatId of seatIds) {
    const learner = (
      await admin.query(
        `SELECT learner_identity_id FROM learner_identity_links
      WHERE seat_id=$1 AND link_kind='student_seat' AND status='active' AND disabled_at IS NULL`,
        [seatId],
      )
    ).rows[0];
    const enrolled = (
      await admin.query('SELECT * FROM course_enrollment_assign($1,$2,$3)', [
        actor.principal_id,
        courseRunId,
        learner.learner_identity_id,
      ])
    ).rows[0];
    if (enrolled.result_code !== 'ok') throw new Error(`enrollment: ${enrolled.result_code}`);
  }
  return { courseRunId, lessonId, title };
}
