import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, type SeededTeacher } from '../portal/helpers';

interface Identity {
  principalId: string;
  accountId: string;
}

let admin: pg.Pool;
let author: SeededTeacher;
let colleague: SeededTeacher;
let authorIdentity: Identity;
let colleagueIdentity: Identity;

async function identityFor(teacher: SeededTeacher): Promise<Identity> {
  const result = await admin.query(
    `SELECT principal_id, account_id
       FROM legacy_user_account_links
      WHERE tenant_id = $1 AND user_id = $2`,
    [teacher.tenantId, teacher.teacherId],
  );
  return {
    principalId: result.rows[0].principal_id as string,
    accountId: result.rows[0].account_id as string,
  };
}

beforeAll(async () => {
  admin = testAdminPool();
  author = await seedTeacher(admin, 'course-outline-author');
  colleague = await seedTeacher(admin, 'course-outline-colleague');
  authorIdentity = await identityFor(author);
  colleagueIdentity = await identityFor(colleague);
});

afterAll(async () => {
  await admin.end();
});

describe('course outline persistence', () => {
  it('creates a sectioned course, keeps the compatibility index and copies the outline', async () => {
    const assignment = await admin.query(
      `INSERT INTO teacher_assignments
         (tenant_id, owner_principal_id, title, brief, goal, module_key, visibility,
          sample_bytes, sample_content_type)
       VALUES ($1, $2, 'Светодиод и резистор', 'Соберите схему',
               'Понять роль сопротивления', 'electronics', 'private',
               decode(repeat('ab', 64), 'hex'), 'image/png')
       RETURNING id`,
      [author.tenantId, authorIdentity.principalId],
    );
    const assignmentId = assignment.rows[0].id as string;

    const created = await admin.query(
      `SELECT course_save($1, NULL, $2, $3, NULL, 'public') AS id`,
      [authorIdentity.principalId, 'Электроника, первый год', 'Первый маршрут от детали к схеме'],
    );
    const courseId = created.rows[0].id as string;
    const initial = await admin.query(`SELECT section_id FROM course_outline($1, $2, $3, $4)`, [
      courseId,
      authorIdentity.principalId,
      authorIdentity.accountId,
      author.tenantId,
    ]);
    expect(initial.rows).toHaveLength(1);
    const sectionId = initial.rows[0].section_id as string;

    const material = await admin.query(
      `SELECT course_lesson_save(
          $1, $2, $3, NULL, 'Что такое электрическая цепь', NULL,
          'Короткое объяснение перед практикой.', 'material', NULL, 10
       ) AS id`,
      [authorIdentity.principalId, courseId, sectionId],
    );
    expect(material.rows[0].id).toBeTruthy();
    const practice = await admin.query(
      `SELECT course_lesson_save(
          $1, $2, $3, NULL, 'Соберите первую схему', 'Практика', NULL,
          'assignment', $4, 25
       ) AS id`,
      [authorIdentity.principalId, courseId, sectionId, assignmentId],
    );
    expect(practice.rows[0].id).toBeTruthy();

    const source = await admin.query(
      `SELECT lesson_kind, lesson_assignment_id, lesson_position
         FROM course_outline($1, $2, $3, $4)
        WHERE lesson_id IS NOT NULL
        ORDER BY section_position, lesson_position`,
      [courseId, authorIdentity.principalId, authorIdentity.accountId, author.tenantId],
    );
    expect(source.rows).toMatchObject([
      { lesson_kind: 'material', lesson_assignment_id: null, lesson_position: 1 },
      { lesson_kind: 'assignment', lesson_assignment_id: assignmentId, lesson_position: 2 },
    ]);
    const compatibility = await admin.query(
      `SELECT assignment_id, position FROM course_items WHERE course_id = $1`,
      [courseId],
    );
    expect(compatibility.rows).toEqual([{ assignment_id: assignmentId, position: 1 }]);

    // Publishing freezes both the outline and uploaded assignment media.
    const firstPublish = await admin.query(`SELECT * FROM course_publish($1, $2)`, [
      authorIdentity.principalId,
      courseId,
    ]);
    expect(firstPublish.rows[0]).toMatchObject({
      result_code: 'ok',
      version_number: 1,
      reused: false,
    });
    const versionOneId = firstPublish.rows[0].version_id as string;
    const frozenOne = await admin.query(
      `SELECT outline #>> '{sections,0,lessons,0,title}' AS lesson_title,
              outline #>> '{sections,0,lessons,1,assignment,goal}' AS assignment_goal
         FROM course_versions WHERE id = $1`,
      [versionOneId],
    );
    expect(frozenOne.rows[0]).toEqual({
      lesson_title: 'Что такое электрическая цепь',
      assignment_goal: 'Понять роль сопротивления',
    });
    const mediaOne = await admin.query(
      `SELECT content_hash FROM course_version_media WHERE version_id = $1`,
      [versionOneId],
    );
    expect(mediaOne.rows).toHaveLength(1);

    // Editing the draft never rewrites version 1 and is visible as an honest
    // "changed" state even when the edit happened in the assignment bank.
    await admin.query(
      `SELECT course_lesson_save(
          $1, $2, $3, $4, 'Цепь и электрический ток', NULL,
          'Обновлённое объяснение.', 'material', NULL, 12
       )`,
      [authorIdentity.principalId, courseId, sectionId, material.rows[0].id],
    );
    await admin.query(
      `UPDATE teacher_assignments
          SET goal = 'Обновлённая цель',
              sample_bytes = decode(repeat('cd', 64), 'hex'),
              updated_at = now()
        WHERE id = $1`,
      [assignmentId],
    );
    const changed = await admin.query(
      `SELECT publication_state, published_version FROM course_library_list($1)
        WHERE id = $2`,
      [authorIdentity.principalId, courseId],
    );
    expect(changed.rows[0]).toEqual({ publication_state: 'changed', published_version: 1 });
    const stillFrozen = await admin.query(
      `SELECT outline #>> '{sections,0,lessons,0,title}' AS lesson_title,
              outline #>> '{sections,0,lessons,1,assignment,goal}' AS assignment_goal
         FROM course_versions WHERE id = $1`,
      [versionOneId],
    );
    expect(stillFrozen.rows[0]).toEqual(frozenOne.rows[0]);

    const secondPublish = await admin.query(`SELECT * FROM course_publish($1, $2)`, [
      authorIdentity.principalId,
      courseId,
    ]);
    expect(secondPublish.rows[0]).toMatchObject({
      result_code: 'ok',
      version_number: 2,
      reused: false,
    });
    const versionTwoId = secondPublish.rows[0].version_id as string;
    const published = await admin.query(
      `SELECT publication_state, published_version FROM course_library_list($1)
        WHERE id = $2`,
      [authorIdentity.principalId, courseId],
    );
    expect(published.rows[0]).toEqual({
      publication_state: 'published',
      published_version: 2,
    });
    const mediaTwo = await admin.query(
      `SELECT content_hash FROM course_version_media WHERE version_id = $1`,
      [versionTwoId],
    );
    expect(mediaTwo.rows[0].content_hash).not.toBe(mediaOne.rows[0].content_hash);

    const reused = await admin.query(`SELECT * FROM course_publish($1, $2)`, [
      authorIdentity.principalId,
      courseId,
    ]);
    expect(reused.rows[0]).toMatchObject({ version_number: 2, reused: true });
    const versionCount = await admin.query(
      `SELECT count(*)::integer AS count FROM course_versions WHERE course_id = $1`,
      [courseId],
    );
    expect(versionCount.rows[0].count).toBe(2);

    // A class receives version 2 as a CourseRun. Assignment lessons become
    // ordinary handouts for the existing work/submission/review pipeline, but
    // they do not point back at the editable assignment-bank row.
    const classroom = await admin.query(
      `INSERT INTO classrooms
         (tenant_id, school_id, academic_period_id, title, created_by)
       VALUES ($1, $2, $3, '7А Электроника', $4)
       RETURNING id`,
      [author.tenantId, author.schoolId, author.periodId, author.teacherId],
    );
    const classroomId = classroom.rows[0].id as string;
    await admin.query(
      `INSERT INTO classroom_memberships
         (tenant_id, classroom_id, user_id, account_id, member_role)
       VALUES ($1, $2, $3, $4, 'owner')`,
      [author.tenantId, classroomId, author.teacherId, authorIdentity.accountId],
    );
    const seat = await admin.query(
      `INSERT INTO classroom_student_seats
         (tenant_id, classroom_id, display_label, login_handle,
          normalized_login_handle, safe_mode, status, created_by)
       VALUES ($1, $2, 'Алина', 'alina', 'alina', true, 'active', $3)
       RETURNING id`,
      [author.tenantId, classroomId, author.teacherId],
    );
    const seatId = seat.rows[0].id as string;
    const assigned = await admin.query(
      `SELECT * FROM classroom_course_run_assign($1, $2, $3, NULL)`,
      [authorIdentity.principalId, classroomId, courseId],
    );
    expect(assigned.rows[0]).toMatchObject({
      result_code: 'ok',
      version_number: 2,
      reused: false,
    });
    const runId = assigned.rows[0].run_id as string;

    const teacherRun = await admin.query(
      `SELECT lesson_kind, lesson_title, assignment_goal, classroom_assignment_id
         FROM classroom_course_runs_for_teacher($1, $2)
        ORDER BY section_position, lesson_position`,
      [authorIdentity.accountId, classroomId],
    );
    expect(teacherRun.rows).toMatchObject([
      {
        lesson_kind: 'material',
        lesson_title: 'Цепь и электрический ток',
        classroom_assignment_id: null,
      },
      {
        lesson_kind: 'assignment',
        assignment_goal: 'Обновлённая цель',
      },
    ]);
    const handoutId = teacherRun.rows[1].classroom_assignment_id as string;
    const handout = await admin.query(
      `SELECT assignment_id, course_run_id FROM classroom_assignments WHERE id = $1`,
      [handoutId],
    );
    expect(handout.rows[0]).toEqual({ assignment_id: null, course_run_id: runId });

    const learnerRun = await admin.query(
      `SELECT lesson_id, version_number, lesson_kind, lesson_title, assignment_goal,
              sample_image, completed_at
         FROM classroom_course_runs_for_seat($1)
        ORDER BY section_position, lesson_position`,
      [seatId],
    );
    expect(learnerRun.rows).toHaveLength(2);
    expect(learnerRun.rows[0]).toMatchObject({
      version_number: 2,
      lesson_title: 'Цепь и электрический ток',
      completed_at: null,
    });
    expect(learnerRun.rows[1].sample_image).toContain(`/course-runs/${runId}/lessons/`);
    const media = await admin.query(
      `SELECT encode(sample_bytes, 'hex') AS bytes, content_type
         FROM classroom_course_run_media($1, $2, $3, NULL)`,
      [runId, practice.rows[0].id, seatId],
    );
    expect(media.rows[0]).toEqual({ bytes: 'cd'.repeat(64), content_type: 'image/png' });

    // Reading progress is server-side and scoped to this seat/run/material.
    // Closing a started run keeps the whole immutable course readable.
    const materialRunLessonId = learnerRun.rows[0].lesson_id as string;
    const completed = await admin.query(
      `SELECT * FROM classroom_course_material_progress_set($1, $2, $3, true)`,
      [seatId, runId, materialRunLessonId],
    );
    expect(completed.rows[0]).toMatchObject({ result_code: 'ok' });
    expect(completed.rows[0].completed_at).toBeTruthy();
    const teacherProgress = await admin.query(
      `SELECT lesson_completed_count
         FROM classroom_course_runs_for_teacher($1, $2)
        WHERE lesson_id = $3`,
      [authorIdentity.accountId, classroomId, materialRunLessonId],
    );
    expect(teacherProgress.rows[0].lesson_completed_count).toBe(1);
    await admin.query(`SELECT classroom_course_run_set_status($1, $2, $3, 'closed')`, [
      authorIdentity.principalId,
      classroomId,
      runId,
    ]);
    const closedButStarted = await admin.query(
      `SELECT completed_at FROM classroom_course_runs_for_seat($1)
        WHERE lesson_id = $2`,
      [seatId, materialRunLessonId],
    );
    expect(closedButStarted.rows[0].completed_at).toBeTruthy();
    const closedChange = await admin.query(
      `SELECT * FROM classroom_course_material_progress_set($1, $2, $3, false)`,
      [seatId, runId, materialRunLessonId],
    );
    expect(closedChange.rows[0]).toEqual({ result_code: 'course_closed', completed_at: null });

    // Publishing version 3 later does not upgrade the active class behind the
    // teacher's back: its run and frozen lesson remain on version 2.
    await admin.query(
      `SELECT course_lesson_save(
          $1, $2, $3, $4, 'Цепь, ток и напряжение', NULL,
          'Материал для следующего запуска.', 'material', NULL, 15
       )`,
      [authorIdentity.principalId, courseId, sectionId, material.rows[0].id],
    );
    const thirdPublish = await admin.query(`SELECT * FROM course_publish($1, $2)`, [
      authorIdentity.principalId,
      courseId,
    ]);
    expect(thirdPublish.rows[0]).toMatchObject({ version_number: 3, reused: false });
    const stillVersionTwo = await admin.query(
      `SELECT version_number, lesson_title
         FROM classroom_course_runs_for_seat($1)
        WHERE lesson_kind = 'material'`,
      [seatId],
    );
    expect(stillVersionTwo.rows[0]).toEqual({
      version_number: 2,
      lesson_title: 'Цепь и электрический ток',
    });

    const copied = await admin.query(`SELECT course_take_with_outline($1, $2, $3, $4) AS id`, [
      colleagueIdentity.principalId,
      courseId,
      colleagueIdentity.accountId,
      colleague.tenantId,
    ]);
    const copiedCourseId = copied.rows[0].id as string;
    expect(copiedCourseId).toBeTruthy();
    const copiedOutline = await admin.query(
      `SELECT lesson_kind, lesson_assignment_id
         FROM course_outline($1, $2, $3, $4)
        WHERE lesson_id IS NOT NULL
        ORDER BY section_position, lesson_position`,
      [
        copiedCourseId,
        colleagueIdentity.principalId,
        colleagueIdentity.accountId,
        colleague.tenantId,
      ],
    );
    expect(copiedOutline.rows).toHaveLength(2);
    expect(copiedOutline.rows[0]).toEqual({
      lesson_kind: 'material',
      lesson_assignment_id: null,
    });
    expect(copiedOutline.rows[1].lesson_kind).toBe('assignment');
    expect(copiedOutline.rows[1].lesson_assignment_id).not.toBe(assignmentId);
  });
});
