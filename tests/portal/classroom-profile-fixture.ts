import { randomUUID } from 'node:crypto';
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
  classroomId?: string,
) {
  const actor = await profileTeacherIdentity(admin, teacher);
  const target = classroomId
    ? (
        await admin.query<{ tenant_id: string; kind: string }>(
          `SELECT c.tenant_id,w.kind FROM classrooms c
      JOIN workspaces w ON w.tenant_id=c.tenant_id
      JOIN classroom_memberships member ON member.classroom_id=c.id AND member.tenant_id=c.tenant_id
      WHERE c.id=$1 AND member.account_id=$2 AND member.member_role IN ('owner','co_teacher')`,
          [classroomId, actor.account_id],
        )
      ).rows[0]
    : { tenant_id: teacher.tenantId, kind: 'organization' };
  if (!target) throw new Error('activity target classroom is not owned by its author');
  const scope = target.kind === 'personal' ? 'personal' : 'school';
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [target.tenant_id]);
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
        `SELECT * FROM learning_activity_create($1,$2,$3,'private','project',$4,'Создай модель.','completion',NULL,$5::jsonb,'three-d',NULL,NULL,NULL,$6)`,
        [
          actor.principal_id,
          target.tenant_id,
          scope,
          title,
          JSON.stringify(policies),
          randomUUID(),
        ],
      )
    ).rows[0];
    if (created.result_code !== 'ok') throw new Error(`activity: ${created.result_code}`);
    const published = (
      await client.query('SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)', [
        actor.principal_id,
        target.tenant_id,
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
  const sourceCourseId = randomUUID();
  const sourceLesson = randomUUID(),
    sourceSection = randomUUID();
  const title = 'Теория курса без проекта';
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [teacher.tenantId]);
    const classroom = (
      await client.query<{ tenant_id: string }>('SELECT tenant_id FROM classrooms WHERE id=$1', [
        classId,
      ])
    ).rows[0];
    if (!classroom) throw new Error('theory classroom not found');
    // Authored source belongs to the organization. Runtime snapshots and the
    // named audience must be created by the normal command in the class tenant.
    await client.query(
      "INSERT INTO courses(id,tenant_id,owner_principal_id,title,visibility) VALUES($1,$2,$3,$4,'private')",
      [sourceCourseId, teacher.tenantId, actor.principal_id, title],
    );
    await client.query(
      "INSERT INTO course_sections(id,tenant_id,course_id,title,position) VALUES($1,$2,$3,'Введение',0)",
      [sourceSection, teacher.tenantId, sourceCourseId],
    );
    await client.query(
      // Published outlines derive content from blocks, not the legacy content column.
      `INSERT INTO course_lessons(id,tenant_id,course_id,section_id,title,kind,position,content,blocks)
      VALUES($1,$2,$3,$4,$5,'material',0,'Прочитай материал.',$6::jsonb)`,
      [
        sourceLesson,
        teacher.tenantId,
        sourceCourseId,
        sourceSection,
        title,
        JSON.stringify([{ id: randomUUID(), type: 'paragraph', text: 'Прочитай материал.' }]),
      ],
    );
    const sourceVersion = (
      await client.query('SELECT * FROM course_publish($1,$2)', [
        actor.principal_id,
        sourceCourseId,
      ])
    ).rows[0];
    if (sourceVersion.result_code !== 'ok')
      throw new Error(`source publication: ${sourceVersion.result_code}`);

    let courseId = sourceCourseId;
    let version = sourceVersion;
    if (classroom.tenant_id !== teacher.tenantId) {
      courseId = (
        await client.query<{ id: string }>('SELECT course_take_with_outline($1,$2,$3,$4) id', [
          actor.principal_id,
          sourceCourseId,
          actor.account_id,
          teacher.tenantId,
        ])
      ).rows[0]!.id;
      const copy = (
        await client.query<{ tenant_id: string }>('SELECT tenant_id FROM courses WHERE id=$1', [
          courseId,
        ])
      ).rows[0];
      if (copy?.tenant_id !== classroom.tenant_id)
        throw new Error('theory copy must belong to the personal classroom tenant');
      version = (
        await client.query('SELECT * FROM course_publish($1,$2)', [actor.principal_id, courseId])
      ).rows[0];
      if (version.result_code !== 'ok') throw new Error(`copy publication: ${version.result_code}`);
    }
    // v3 creates the pinned lessons, audience and enrollments together; no
    // fixture-only memberships or cross-tenant learner links are invented.
    const assigned = (
      await client.query(
        "SELECT * FROM classroom_course_run_assign_v3($1,$2,$3,NULL,$4,'named_learners',$5::uuid[],$6)",
        [actor.principal_id, classId, courseId, version.version_number, seatIds, randomUUID()],
      )
    ).rows[0];
    if (assigned.result_code !== 'ok')
      throw new Error(`course assignment: ${assigned.result_code}`);
    const lessons = await client.query<{ id: string; source_lesson_id: string }>(
      "SELECT id,source_lesson_id FROM classroom_course_run_lessons WHERE run_id=$1 AND kind='material'",
      [assigned.run_id],
    );
    if (lessons.rows.length !== 1) throw new Error('theory must materialize exactly one lesson');
    await client.query('COMMIT');
    return {
      courseRunId: assigned.run_id as string,
      lessonId: lessons.rows[0]!.id,
      sourceLessonId: lessons.rows[0]!.source_lesson_id,
      sourceCourseId,
      sourceVersionId: sourceVersion.version_id as string,
      courseId,
      versionId: version.version_id as string,
      title,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
