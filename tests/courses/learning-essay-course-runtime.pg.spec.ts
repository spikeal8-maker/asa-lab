import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool;
let app: pg.Pool;
let teacher: SeededTeacher;
let teacherPrincipal: string;
let teacherAccount: string;
let serial = 0;
const key = (operation: string) => `essay:pg:${operation}:${++serial}`;
const policies = {
  attemptPolicy: { maxAttempts: 1 },
  resultSelectionPolicy: { mode: 'latest_accepted' },
  completionPolicy: { mode: 'accepted' },
  latePolicy: { mode: 'allow_mark_late' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'after_review' },
};

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  teacher = await seedTeacher(admin, 'essay-course-vertical');
  const identity = await admin.query(
    'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
    [teacher.tenantId, teacher.teacherId],
  );
  teacherPrincipal = identity.rows[0].principal_id as string;
  teacherAccount = identity.rows[0].account_id as string;
});
afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

async function fixture() {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [teacher.tenantId]);
    const classroom = await client.query(
      `INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by)
       VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [teacher.tenantId, teacher.schoolId, teacher.periodId, key('class'), teacher.teacherId],
    );
    const classroomId = classroom.rows[0].id as string;
    await client.query(
      `INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role)
       VALUES($1,$2,$3,$4,'owner')`,
      [teacher.tenantId, classroomId, teacher.teacherId, teacherAccount],
    );
    const seats = [] as Array<{ id: string; principal: string }>;
    for (const label of ['Ученик', 'Другой ученик']) {
      const handle = key('seat');
      const seat = await client.query(
        `INSERT INTO classroom_student_seats(tenant_id,classroom_id,display_label,login_handle,
           normalized_login_handle,safe_mode,status,created_by)
         VALUES($1,$2,$3,$4,$4,true,'active',$5) RETURNING id`,
        [teacher.tenantId, classroomId, label, handle, teacher.teacherId],
      );
      const id = seat.rows[0].id as string;
      const principal = await client.query('SELECT principal_id FROM student_seat_principal($1)', [
        id,
      ]);
      seats.push({ id, principal: principal.rows[0].principal_id as string });
    }
    const activity = await client.query(
      `SELECT * FROM learning_activity_create($1,$2,'school','private','essay',$3,$4,
        'graded',10,$5::jsonb,NULL,NULL,NULL,NULL,$6)`,
      [
        teacherPrincipal,
        teacher.tenantId,
        'Письменный ответ',
        'Объясните своими словами.',
        JSON.stringify(policies),
        key('create'),
      ],
    );
    expect(activity.rows[0].result_code).toBe('ok');
    const published = await client.query('SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)', [
      teacherPrincipal,
      teacher.tenantId,
      activity.rows[0].activity_id,
      key('publish'),
    ]);
    expect(published.rows[0].result_code).toBe('ok');
    const version = published.rows[0].activity_version_id as string;
    const course = await client.query(
      "SELECT * FROM course_save_v2($1,$2,NULL,$3,NULL,NULL,'private',NULL,$4)",
      [teacherPrincipal, teacher.tenantId, 'Курс с письменным ответом', key('course')],
    );
    expect(course.rows[0].result_code).toBe('ok');
    const courseId = course.rows[0].id as string;
    const outline = await client.query(
      'SELECT section_id FROM course_outline_v3($1,$2,$3,$4) LIMIT 1',
      [courseId, teacherPrincipal, teacherAccount, teacher.tenantId],
    );
    const blocks = [
      { id: 'essay-one', type: 'activity', learningActivityVersionId: version },
      { id: 'essay-two', type: 'activity', learningActivityVersionId: version },
    ];
    const lesson = await client.query(
      "SELECT course_lesson_save_v3($1,$2,$3,NULL,$4,NULL,$5::jsonb,'material',NULL,10,NULL) AS id",
      [
        teacherPrincipal,
        courseId,
        outline.rows[0].section_id,
        'Два независимых ответа',
        JSON.stringify(blocks),
      ],
    );
    expect(lesson.rows[0].id).toBeTruthy();
    const revision = await client.query('SELECT course_draft_revision($1,$2) AS revision', [
      teacherPrincipal,
      courseId,
    ]);
    const release = await client.query('SELECT * FROM course_publish_v4($1,$2,$3,$4)', [
      teacherPrincipal,
      courseId,
      revision.rows[0].revision,
      key('course-publish'),
    ]);
    expect(release.rows[0].result_code).toBe('ok');
    const runs: Array<{ id: string; course: string; assignment: string }> = [];
    for (let delivery = 0; delivery < 2; delivery++) {
      const assigned = await client.query(
        "SELECT * FROM classroom_course_run_assign_v3($1,$2,$3,NULL,1,'whole_class','{}'::uuid[],$4)",
        [teacherPrincipal, classroomId, courseId, key('assign')],
      );
      expect(assigned.rows[0].result_code).toBe('ok');
      const children = await client.query(
        'SELECT id,source_classroom_assignment_id FROM activity_runs WHERE source_course_run_id=$1 ORDER BY source_course_block_id',
        [assigned.rows[0].run_id],
      );
      expect(children.rows).toHaveLength(2);
      runs.push(
        ...children.rows.map((row) => ({
          id: String(row.id),
          course: String(assigned.rows[0].run_id),
          assignment: String(row.source_classroom_assignment_id),
        })),
      );
    }
    await client.query('COMMIT');
    return { classroomId, courseId, version, runs, seat: seats[0]!, other: seats[1]! };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

type Essay = {
  resultCode: string;
  participationId: string;
  canStart: boolean;
  canEdit: boolean;
  attempt: {
    id: string;
    number: number;
    revision: number;
    text: string;
    state: string;
    digest: string | null;
    submissionId: string | null;
    revisionOfAttemptId: string | null;
  } | null;
};
async function command(functionName: string, values: unknown[]): Promise<Essay> {
  // Only test-owned constant function names reach this helper.
  const placeholders = values.map((_, index) => '$' + (index + 1)).join(',');
  const result = await app.query(`SELECT ${functionName}(${placeholders}) AS result`, values);
  return result.rows[0].result as Essay;
}
const start = (actor: string, run: string, request = key('start')) =>
  command('learning_essay_attempt_start', [actor, run, request]);
const read = (actor: string, run: string) => command('learning_essay_attempt_read', [actor, run]);
const save = (
  actor: string,
  run: string,
  attempt: string,
  revision: number,
  text: string,
  request = key('save'),
) => command('learning_essay_draft_save', [actor, run, attempt, revision, text, request]);
const submit = (
  actor: string,
  run: string,
  attempt: string,
  revision: number,
  request = key('submit'),
) => command('learning_essay_submission_create', [actor, run, attempt, revision, request]);

describe('written-response exact Course academic chain', () => {
  it('separates repeated version occurrences and concurrent Start, freezes exact text, reviews and projects the actual journal', async () => {
    const data = await fixture();
    const run = data.runs[0]!;
    const [first, simultaneous] = await Promise.all([
      start(data.seat.principal, run.id),
      start(data.seat.principal, run.id),
    ]);
    expect(first.resultCode).toBe('ok');
    expect(simultaneous.attempt?.id).toBe(first.attempt?.id);
    expect(first.attempt).toMatchObject({ number: 1, revision: 0, text: '', state: 'in_progress' });
    const otherStarts = await Promise.all(
      data.runs.slice(1).map((item) => start(data.seat.principal, item.id)),
    );
    expect(otherStarts.map((item) => item.attempt?.number)).toEqual([1, 1, 1]);
    expect(
      new Set([first.participationId, ...otherStarts.map((item) => item.participationId)]).size,
    ).toBe(4);
    const text = '  Мой ответ\nС объяснением и русскими символами.  ';
    const saveRequest = key('save-replay');
    const saved = await save(data.seat.principal, run.id, first.attempt!.id, 0, text, saveRequest);
    expect(saved.attempt).toMatchObject({ revision: 1, text });
    expect(
      await save(data.seat.principal, run.id, first.attempt!.id, 0, text, saveRequest),
    ).toEqual(saved);
    expect(
      (await save(data.seat.principal, run.id, first.attempt!.id, 0, 'stale')).resultCode,
    ).toBe('draft_revision_conflict');
    expect((await read(data.seat.principal, run.id)).attempt?.text).toBe(text);
    const submitRequest = key('submit-replay');
    const frozen = await submit(data.seat.principal, run.id, first.attempt!.id, 1, submitRequest);
    expect(frozen.attempt).toMatchObject({ state: 'submitted', text, revision: 1 });
    expect(frozen.attempt?.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(await submit(data.seat.principal, run.id, first.attempt!.id, 1, submitRequest)).toEqual(
      frozen,
    );
    expect(
      (await save(data.seat.principal, run.id, first.attempt!.id, 1, 'later')).resultCode,
    ).toBe('not_available');
    const teacherRead = await app.query(
      'SELECT * FROM learning_teacher_exact_essay_submission($1,$2,$3)',
      [teacherAccount, data.classroomId, first.attempt!.id],
    );
    expect(teacherRead.rows[0]).toMatchObject({
      response_text: text,
      payload_digest: frozen.attempt!.digest,
      draft_revision: 1,
    });
    const reviewed = await app.query(
      "SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,'accepted',8,'Хорошо',NULL,NULL,$5)",
      [teacherAccount, teacherPrincipal, data.classroomId, first.attempt!.id, key('review')],
    );
    expect(reviewed.rows[0].result_code).toBe('ok');
    const journal = await app.query('SELECT * FROM classroom_gradebook_list($1,$2)', [
      teacherAccount,
      data.classroomId,
    ]);
    expect(
      journal.rows.find(
        (row) => row.assignment_id === run.assignment && row.seat_id === data.seat.id,
      ),
    ).toMatchObject({
      assignment_title: 'Письменный ответ',
      attempt_id: first.attempt!.id,
      raw_points: 8,
      max_points: 10,
      feedback: 'Хорошо',
    });
    const selected = await admin.query('SELECT * FROM learning_selected_result_internal($1)', [
      first.participationId,
    ]);
    expect(selected.rows[0].attempt_id).toBe(first.attempt!.id);
    const state = await read(data.seat.principal, run.id);
    expect(state.canStart).toBe(false);
    const projects = await admin.query(
      'SELECT count(*)::int AS count FROM learning_project_origins WHERE activity_run_id=ANY($1::uuid[])',
      [data.runs.map((item) => item.id)],
    );
    expect(projects.rows[0].count).toBe(0);
  });

  it('returns for revision with a new linked attempt and preserves frozen text and all result history', async () => {
    const data = await fixture();
    const run = data.runs[0]!;
    const first = await start(data.seat.principal, run.id);
    await save(data.seat.principal, run.id, first.attempt!.id, 0, 'Первый ответ');
    await submit(data.seat.principal, run.id, first.attempt!.id, 1);
    const returned = await app.query(
      "SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,'changes_requested',NULL,'Дополните объяснение','Нужно пояснение',NULL,$5)",
      [teacherAccount, teacherPrincipal, data.classroomId, first.attempt!.id, key('return')],
    );
    expect(returned.rows[0].result_code).toBe('ok');
    const revision = await start(data.seat.principal, run.id);
    expect(revision.attempt).toMatchObject({
      number: 2,
      revision: 0,
      text: 'Первый ответ',
      revisionOfAttemptId: first.attempt!.id,
    });
    await save(data.seat.principal, run.id, revision.attempt!.id, 0, 'Доработанный ответ');
    await submit(data.seat.principal, run.id, revision.attempt!.id, 1);
    const accepted = await app.query(
      "SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,'accepted',10,'Теперь верно',NULL,NULL,$5)",
      [
        teacherAccount,
        teacherPrincipal,
        data.classroomId,
        revision.attempt!.id,
        key('accept-revision'),
      ],
    );
    expect(accepted.rows[0].result_code).toBe('ok');
    const previous = await app.query(
      'SELECT * FROM learning_teacher_exact_essay_submission($1,$2,$3)',
      [teacherAccount, data.classroomId, first.attempt!.id],
    );
    expect(previous.rows[0].response_text).toBe('Первый ответ');
    const history = await app.query(
      'SELECT detail FROM learning_teacher_review_context($1,$2,$3,$4)',
      [teacherAccount, data.classroomId, data.seat.id, run.assignment],
    );
    expect(history.rows[0].detail.attempts).toHaveLength(2);
    expect(history.rows[0].detail.attempts[0].results[0]).toMatchObject({
      decision: 'accepted',
      points: 10,
    });
    expect(history.rows[0].detail.attempts[1].results[0].decision).toBe('changes_requested');
    const enrollment = await admin.query(
      'SELECT id FROM course_enrollments WHERE course_run_id=$1 AND learner_identity_id=(SELECT learner_identity_id FROM activity_participations WHERE id=$2)',
      [run.course, revision.participationId],
    );
    const completion = await admin.query(
      'SELECT learning_course_completion_internal($1) AS result',
      [enrollment.rows[0].id],
    );
    expect(completion.rows[0].result.completed).toBe(false); // The other required essay has no result.
  });

  it('enforces Seat/Account stable links, current access and teacher scope before every answer or receipt', async () => {
    const data = await fixture();
    const run = data.runs[0]!;
    const first = await start(data.seat.principal, run.id);
    const saveRequest = key('private-save');
    await save(data.seat.principal, run.id, first.attempt!.id, 0, 'Личный ответ', saveRequest);
    expect(
      (await save(data.other.principal, run.id, first.attempt!.id, 0, 'Подмена')).resultCode,
    ).toBe('forbidden');
    expect((await read(teacherPrincipal, run.id)).resultCode).toBe('forbidden');
    const account = await admin.query(
      "INSERT INTO accounts(email,password_hash,birth_date,country) VALUES($1,'test-only',DATE '2000-01-01','RU') RETURNING id",
      [key('account') + '@test.local'],
    );
    const accountId = account.rows[0].id as string;
    const principal = await admin.query(
      "INSERT INTO principals(kind,account_id) VALUES('account',$1) RETURNING id",
      [accountId],
    );
    const accountPrincipal = principal.rows[0].id as string;
    await admin.query('UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2', [
      accountId,
      data.seat.id,
    ]);
    await admin.query(
      "INSERT INTO learner_identity_links(id,tenant_id,school_id,learner_identity_id,link_kind,account_id) SELECT gen_random_uuid(),tenant_id,school_id,learner_identity_id,'account',$1 FROM activity_participations WHERE id=$2",
      [accountId, first.participationId],
    );
    expect((await read(accountPrincipal, run.id)).attempt?.text).toBe('Личный ответ');
    await admin.query("UPDATE accounts SET status='suspended' WHERE id=$1", [accountId]);
    expect((await read(accountPrincipal, run.id)).resultCode).toBe('forbidden');
    expect((await read(data.seat.principal, run.id)).attempt?.text).toBe('Личный ответ');
    await admin.query("UPDATE accounts SET status='active' WHERE id=$1", [accountId]);
    await admin.query(
      "UPDATE learner_identity_links SET status='inactive',disabled_at=now() WHERE account_id=$1",
      [accountId],
    );
    expect((await read(accountPrincipal, run.id)).resultCode).toBe('forbidden');
    expect((await read(data.seat.principal, run.id)).attempt?.text).toBe('Личный ответ');
    await admin.query("UPDATE classroom_student_seats SET status='suspended' WHERE id=$1", [
      data.seat.id,
    ]);
    expect(
      (await save(data.seat.principal, run.id, first.attempt!.id, 0, 'Личный ответ', saveRequest))
        .resultCode,
    ).toBe('forbidden');
    await expect(
      app.query('SELECT response_text FROM learning_essay_drafts'),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
