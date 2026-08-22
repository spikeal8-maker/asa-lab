import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool;
let teacher: SeededTeacher;
let outsider: SeededTeacher;
let principalId: string;
let accountId: string;

beforeAll(async () => {
  admin = testAdminPool();
  teacher = await seedTeacher(admin, 'quiz-engine-owner');
  outsider = await seedTeacher(admin, 'quiz-engine-outsider');
  const identity = await admin.query(
    `SELECT principal_id, account_id FROM legacy_user_account_links
      WHERE tenant_id = $1 AND user_id = $2`,
    [teacher.tenantId, teacher.teacherId],
  );
  principalId = identity.rows[0].principal_id as string;
  accountId = identity.rows[0].account_id as string;
});

afterAll(async () => {
  await admin.end();
});

describe('versioned quiz engine', () => {
  it('keeps keys private, grades deterministically and publishes to the class gradebook', async () => {
    const classroom = await admin.query(
      `INSERT INTO classrooms (tenant_id, school_id, academic_period_id, title, created_by)
       VALUES ($1, $2, $3, '8Б — тесты', $4) RETURNING id`,
      [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
    );
    const classroomId = classroom.rows[0].id as string;
    await admin.query(
      `INSERT INTO classroom_memberships
         (tenant_id, classroom_id, user_id, account_id, member_role)
       VALUES ($1, $2, $3, $4, 'owner')`,
      [teacher.tenantId, classroomId, teacher.teacherId, accountId],
    );
    const seat = await admin.query(
      `INSERT INTO classroom_student_seats
         (tenant_id, classroom_id, display_label, login_handle,
          normalized_login_handle, safe_mode, status, created_by)
       VALUES ($1, $2, 'Лев', 'lev-quiz-engine', 'lev-quiz-engine', true, 'active', $3)
       RETURNING id`,
      [teacher.tenantId, classroomId, teacher.teacherId],
    );
    const seatId = seat.rows[0].id as string;

    const first = await admin.query(
      `SELECT * FROM question_version_create(
         $1, $2, 'school', 'single_choice',
         '[{"type":"paragraph","text":"Сколько будет 2 + 2?"}]'::jsonb,
         '{"options":[{"id":"a","label":"3"},{"id":"b","label":"4"}]}'::jsonb,
         '{"value":"b"}'::jsonb, 2, 'Математика', '9-10', ARRAY['счёт'])`,
      [principalId, teacher.tenantId],
    );
    const second = await admin.query(
      `SELECT * FROM question_version_create(
         $1, $2, 'school', 'boolean',
         '[{"type":"paragraph","text":"У квадрата четыре стороны?"}]'::jsonb,
         '{}'::jsonb, '{"value":true}'::jsonb, 1,
         'Математика', '9-10', ARRAY['геометрия'])`,
      [principalId, teacher.tenantId],
    );
    expect(first.rows[0].result_code).toBe('ok');
    expect(second.rows[0].result_code).toBe('ok');

    const quiz = await admin.query(
      `SELECT * FROM quiz_version_create(
         $1, $2, 'Входной тест', 'Ответьте на два вопроса', $3::jsonb,
         1, NULL, 6000, 'immediate')`,
      [
        principalId,
        teacher.tenantId,
        JSON.stringify([first.rows[0].question_version_id, second.rows[0].question_version_id]),
      ],
    );
    expect(quiz.rows[0]).toMatchObject({ result_code: 'ok', total_points: 3 });

    const assigned = await admin.query(
      `SELECT * FROM classroom_quiz_assign($1, $2, $3, $4, NULL)`,
      [accountId, principalId, classroomId, quiz.rows[0].quiz_version_id],
    );
    expect(assigned.rows[0]).toMatchObject({ result_code: 'ok', reused: false });
    const assignmentId = assigned.rows[0].classroom_assignment_id as string;

    const visible = await admin.query(`SELECT * FROM quiz_assignments_for_seat($1)`, [seatId]);
    expect(visible.rows).toHaveLength(2);
    expect(JSON.stringify(visible.rows)).not.toContain('answer_key');
    expect(JSON.stringify(visible.rows)).not.toContain('"value":"b"');

    const submission = await admin.query(
      `SELECT * FROM quiz_submission_create($1, $2, $3::jsonb, $4)`,
      [
        seatId,
        assignmentId,
        JSON.stringify([
          { questionVersionId: first.rows[0].question_version_id, answer: { value: 'b' } },
          { questionVersionId: second.rows[0].question_version_id, answer: { value: false } },
        ]),
        'quiz:engine:attempt:0001',
      ],
    );
    expect(submission.rows[0]).toMatchObject({
      result_code: 'ok',
      attempt_number: 1,
      raw_points: 2,
      max_points: 3,
      percentage_basis_points: 6666,
      outcome: 'passed',
      reused: false,
    });
    expect(submission.rows[0].question_results).toEqual([
      expect.objectContaining({ correct: true, points: 2 }),
      expect.objectContaining({ correct: false, points: 0 }),
    ]);

    const retry = await admin.query(`SELECT * FROM quiz_submission_create($1, $2, $3::jsonb, $4)`, [
      seatId,
      assignmentId,
      '[]',
      'quiz:engine:attempt:0001',
    ]);
    expect(retry.rows[0]).toMatchObject({
      attempt_id: submission.rows[0].attempt_id,
      raw_points: 2,
      reused: true,
    });
    const limited = await admin.query(
      `SELECT * FROM quiz_submission_create($1, $2, '[]'::jsonb, $3)`,
      [seatId, assignmentId, 'quiz:engine:attempt:0002'],
    );
    expect(limited.rows[0].result_code).toBe('attempt_limit_reached');

    const gradebook = await admin.query(`SELECT * FROM classroom_gradebook_list($1, $2)`, [
      accountId,
      classroomId,
    ]);
    expect(gradebook.rows).toEqual([
      expect.objectContaining({
        assignment_id: assignmentId,
        assignment_title: 'Входной тест',
        attempt_id: submission.rows[0].attempt_id,
        raw_points: 2,
        max_points: 3,
        percentage_basis_points: 6666,
        outcome: 'passed',
      }),
    ]);
    await expect(
      admin.query(`UPDATE attempt_answers SET awarded_points = 0 WHERE attempt_id = $1`, [
        submission.rows[0].attempt_id,
      ]),
    ).rejects.toThrow(/immutable/);

    const outsiderPrincipal = await admin.query(
      `SELECT principal_id FROM legacy_user_account_links
        WHERE tenant_id = $1 AND user_id = $2`,
      [outsider.tenantId, outsider.teacherId],
    );
    const forbidden = await admin.query(`SELECT * FROM question_bank_list($1, $2)`, [
      outsiderPrincipal.rows[0].principal_id,
      teacher.tenantId,
    ]);
    expect(forbidden.rows).toEqual([]);
  });
});
