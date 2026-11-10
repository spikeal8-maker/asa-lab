import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
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

const taskPdf = Buffer.from('%PDF-1.4\nEssay exact instruction file\n%%EOF');
const taskHash = createHash('sha256').update(taskPdf).digest('hex');
async function fixture(withMedia = false, kind: 'essay' | 'file' = 'essay') {
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
      `SELECT * FROM learning_activity_create($1,$2,'school','private',$8,$3,$4,
        'graded',10,$5::jsonb,NULL,NULL,NULL,NULL,$6,NULL::jsonb,$7::jsonb)`,
      [
        teacherPrincipal,
        teacher.tenantId,
        kind === 'file' ? 'Ответ файлом' : 'Письменный ответ',
        'Объясните своими словами.',
        JSON.stringify(policies),
        key('create'),
        null,
        kind,
      ],
    );
    expect(activity.rows[0].result_code).toBe('ok');
    let activityRevision = 1;
    if (withMedia) {
      const uploaded = await client.query(
        'SELECT * FROM learning_activity_draft_task_file_set($1,$2,$3,$4,$5,$6)',
        [
          teacherPrincipal,
          teacher.tenantId,
          activity.rows[0].activity_id,
          activityRevision,
          taskPdf,
          'Условия.pdf',
        ],
      );
      expect(uploaded.rows[0].result_code).toBe('ok');
      activityRevision = Number(uploaded.rows[0].draft_revision);
    }
    const published = await client.query(
      'SELECT * FROM learning_activity_publish($1,$2,$3,$4,$5)',
      [
        teacherPrincipal,
        teacher.tenantId,
        activity.rows[0].activity_id,
        activityRevision,
        key('publish'),
      ],
    );
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
    const runs: Array<{ id: string; course: string; assignment: string; lesson: string }> = [];
    for (let delivery = 0; delivery < 2; delivery++) {
      const assigned = await client.query(
        "SELECT * FROM classroom_course_run_assign_v3($1,$2,$3,NULL,1,'whole_class','{}'::uuid[],$4)",
        [teacherPrincipal, classroomId, courseId, key('assign')],
      );
      expect(assigned.rows[0].result_code).toBe('ok');
      const children = await client.query(
        'SELECT id,source_classroom_assignment_id,source_course_lesson_id FROM activity_runs WHERE source_course_run_id=$1 ORDER BY source_course_block_id',
        [assigned.rows[0].run_id],
      );
      expect(children.rows).toHaveLength(2);
      runs.push(
        ...children.rows.map((row) => ({
          id: String(row.id),
          course: String(assigned.rows[0].run_id),
          assignment: String(row.source_classroom_assignment_id),
          lesson: String(row.source_course_lesson_id),
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
    file?: { id: string; name: string; sizeBytes: number; sha256: string } | null;
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
    const completionFor = async (course: string) => {
      const result = await admin.query(
        `SELECT learning_course_completion_internal(enrollment.id) AS result
         FROM course_enrollments enrollment WHERE enrollment.course_run_id=$1
           AND enrollment.learner_identity_id=(SELECT learner_identity_id FROM activity_participations WHERE id=$2)`,
        [course, first.participationId],
      );
      return result.rows[0].result;
    };
    const marked = await app.query(
      'SELECT * FROM classroom_course_material_progress_set($1,$2,$3,true)',
      [data.seat.id, run.course, run.lesson],
    );
    expect(marked.rows[0].result_code).toBe('ok');
    expect((await completionFor(run.course)).completed).toBe(false);
    const second = data.runs[1]!;
    const secondAttempt = otherStarts[0]!.attempt!;
    await save(data.seat.principal, second.id, secondAttempt.id, 0, 'Второй обязательный ответ');
    await submit(data.seat.principal, second.id, secondAttempt.id, 1);
    const secondReview = await app.query(
      "SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,'accepted',9,NULL,NULL,NULL,$5)",
      [teacherAccount, teacherPrincipal, data.classroomId, secondAttempt.id, key('review-second')],
    );
    expect(secondReview.rows[0].result_code).toBe('ok');
    expect((await completionFor(run.course)).completed).toBe(true);
    expect((await completionFor(data.runs[2]!.course)).completed).toBe(false);
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
    const data = await fixture(true);
    const run = data.runs[0]!;
    const kind = (actor: string) =>
      app.query('SELECT learning_course_activity_kind_for_viewer($1,$2) AS kind', [actor, run.id]);
    expect((await kind(data.seat.principal)).rows[0].kind).toBe('essay');
    expect((await kind(randomUUID())).rows[0].kind).toBeNull();
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
    expect((await kind(accountPrincipal)).rows[0].kind).toBe('essay');
    const media = (actor: string) =>
      app.query("SELECT * FROM learning_essay_media_read($1,$2,'file',$3)", [
        actor,
        run.id,
        taskHash,
      ]);
    expect((await media(accountPrincipal)).rows[0].media_bytes).toEqual(taskPdf);
    await admin.query("UPDATE accounts SET status='suspended' WHERE id=$1", [accountId]);
    expect((await read(accountPrincipal, run.id)).resultCode).toBe('forbidden');
    expect((await media(accountPrincipal)).rows).toHaveLength(0);
    expect((await read(data.seat.principal, run.id)).attempt?.text).toBe('Личный ответ');
    expect((await media(data.seat.principal)).rows[0].media_bytes).toEqual(taskPdf);
    await admin.query("UPDATE accounts SET status='active' WHERE id=$1", [accountId]);
    await admin.query(
      "UPDATE learner_identity_links SET status='inactive',disabled_at=now() WHERE account_id=$1",
      [accountId],
    );
    expect((await read(accountPrincipal, run.id)).resultCode).toBe('forbidden');
    expect((await media(accountPrincipal)).rows).toHaveLength(0);
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

  it('redacts scheduled task content on exact reads and Course list metadata until effective opening, without hiding teacher evidence', async () => {
    const data = await fixture(true);
    const run = data.runs[0]!;
    await admin.query(
      "UPDATE activity_runs SET operational_overrides=jsonb_build_object('opensAt',now()+interval '1 day') WHERE id=$1",
      [run.id],
    );
    const scheduled = await read(data.seat.principal, run.id);
    expect(scheduled).toMatchObject({
      resultCode: 'ok',
      instructions: null,
      goal: null,
      blocks: null,
      canStart: false,
      canEdit: false,
      attempt: null,
    });
    expect((await start(data.seat.principal, run.id)).resultCode).toBe('not_available');
    expect(
      (
        await app.query("SELECT * FROM learning_essay_media_read($1,$2,'file',$3)", [
          data.seat.principal,
          run.id,
          taskHash,
        ])
      ).rows,
    ).toHaveLength(0);
    const metadata = await app.query(
      `SELECT learning_essay_attempt_read($1,occurrence.activity_run_id) AS essay_context
       FROM classroom_course_activity_occurrences_for_seat($2) occurrence WHERE occurrence.activity_run_id=$3`,
      [data.seat.principal, data.seat.id, run.id],
    );
    expect(metadata.rows[0].essay_context).toMatchObject({
      instructions: null,
      goal: null,
      blocks: null,
    });
    await admin.query(
      "UPDATE activity_runs SET operational_overrides=jsonb_build_object('opensAt',now()) WHERE id=$1",
      [run.id],
    );
    expect(await read(data.seat.principal, run.id)).toMatchObject({
      instructions: 'Объясните своими словами.',
      canStart: true,
    });
    const openMedia = await app.query("SELECT * FROM learning_essay_media_read($1,$2,'file',$3)", [
      data.seat.principal,
      run.id,
      taskHash,
    ]);
    expect(openMedia.rows[0].media_bytes).toEqual(taskPdf);
    const first = await start(data.seat.principal, run.id);
    await save(
      data.seat.principal,
      run.id,
      first.attempt!.id,
      0,
      'Сданный ответ до переноса открытия',
    );
    await submit(data.seat.principal, run.id, first.attempt!.id, 1);
    await admin.query(
      "UPDATE activity_runs SET operational_overrides=jsonb_build_object('opensAt',now()+interval '1 day') WHERE id=$1",
      [run.id],
    );
    expect(await read(data.seat.principal, run.id)).toMatchObject({
      instructions: null,
      goal: null,
      blocks: null,
      canEdit: false,
    });
    const teacherEvidence = await app.query(
      'SELECT * FROM learning_teacher_exact_essay_submission($1,$2,$3)',
      [teacherAccount, data.classroomId, first.attempt!.id],
    );
    expect(teacherEvidence.rows[0].response_text).toBe('Сданный ответ до переноса открытия');
  });
});

describe('immutable file answers in classes and Courses', () => {
  it('checks lineage, optimistic replacement, exact downloads, review and journal', async () => {
    const data = await fixture(false, 'file');
    const run = data.runs[0]!;
    const actor = data.seat.principal;
    const direct = await app.query(
      "SELECT * FROM learning_direct_assignment_create($1,$2,$3,$4,NULL,'whole_class','{}'::uuid[],$5)",
      [teacherPrincipal, teacher.tenantId, data.classroomId, data.version, key('direct')],
    );
    expect(direct.rows[0].result_code).toBe('ok');
    const classified = await app.query('SELECT learning_file_assignment_kind($1,$2) AS kind', [
      actor,
      direct.rows[0].classroom_assignment_id,
    ]);
    expect(classified.rows[0].kind).toBe('file');
    const directStart = await command('learning_file_attempt_start', [
      actor,
      direct.rows[0].activity_run_id,
      key('direct-start'),
    ]);
    expect(directStart.attempt?.id).toBeTruthy();

    const started = await command('learning_file_attempt_start', [
      actor,
      run.id,
      key('file-start'),
    ]);
    expect(started.attempt).toMatchObject({ state: 'in_progress', file: null, revision: 0 });
    const attempt = started.attempt!.id;
    expect(attempt).not.toBe(directStart.attempt?.id);
    const scope = (principal: string, id: string, revision: number, request: string) =>
      command('learning_file_upload_scope', [principal, run.id, id, revision, request]);
    const linkedAccount = await admin.query(
      "INSERT INTO accounts(email,password_hash,birth_date,country) VALUES($1,'test-only',DATE '2000-01-01','RU') RETURNING id",
      [key('file-account') + '@test.local'],
    );
    const accountId = linkedAccount.rows[0].id as string;
    const linkedPrincipal = await admin.query(
      "INSERT INTO principals(kind,account_id) VALUES('account',$1) RETURNING id",
      [accountId],
    );
    const accountActor = linkedPrincipal.rows[0].id as string;
    await admin.query('UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2', [
      accountId,
      data.seat.id,
    ]);
    await admin.query(
      "INSERT INTO learner_identity_links(id,tenant_id,school_id,learner_identity_id,link_kind,account_id) SELECT gen_random_uuid(),tenant_id,school_id,learner_identity_id,'account',$1 FROM activity_participations WHERE id=$2",
      [accountId, started.participationId],
    );
    expect((await command('learning_file_attempt_read', [accountActor, run.id])).attempt?.id).toBe(
      attempt,
    );

    const directRun = direct.rows[0].activity_run_id as string;
    const directAssignment = direct.rows[0].classroom_assignment_id as string;
    const directAttempt = directStart.attempt!.id;
    const directFile = await command('learning_file_draft_save', [
      actor,
      directRun,
      directAttempt,
      0,
      'Class.txt',
      8,
      'text/plain',
      '3'.repeat(64),
      key('direct-file'),
    ]);
    const submittedDirect = await command('learning_file_submission_create', [
      actor,
      directRun,
      directAttempt,
      1,
      key('direct-submit'),
    ]);
    expect(submittedDirect.attempt?.state).toBe('submitted');
    const directEvidence = async (viewer: string, source: 'seat' | 'account') => {
      const rows = (
        await app.query(
          source === 'seat'
            ? 'SELECT evidence FROM learning_canonical_evidence_for_seat($1)'
            : 'SELECT evidence FROM learning_canonical_evidence_for_account($1)',
          [viewer],
        )
      ).rows;
      return rows.find((row) => row.evidence.activityRunId === directRun)?.evidence;
    };
    const expectDirect = async (state: string, reviewDecision: string | null) => {
      for (const proof of [
        await directEvidence(data.seat.id, 'seat'),
        await directEvidence(accountId, 'account'),
      ]) {
        expect(proof).toMatchObject({
          kind: 'file',
          activityRunId: directRun,
          attempt: { id: directAttempt, state, reviewDecision },
        });
      }
    };
    await expectDirect('submitted', null);
    const reviewedDirect = await app.query(
      "SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,'changes_requested',NULL,'Return','Needs revision',NULL,$5)",
      [teacherAccount, teacherPrincipal, data.classroomId, directAttempt, key('return-direct')],
    );
    expect(reviewedDirect.rows[0].result_code).toBe('ok');
    await expectDirect('closed', 'changes_requested');
    const rework = await command('learning_file_attempt_start', [
      actor,
      directRun,
      key('direct-rework'),
    ]);
    expect(rework.attempt?.revisionOfAttemptId).toBe(directAttempt);
    const reworkDraft = await command('learning_file_draft_save', [
      actor,
      directRun,
      rework.attempt!.id,
      0,
      'Draft.txt',
      8,
      'text/plain',
      '4'.repeat(64),
      key('new-file'),
    ]);
    const closed = await app.query(
      "SELECT classroom_assignment_set_status($1,$2,$3,'closed') AS ok",
      [teacherAccount, data.classroomId, directAssignment],
    );
    expect(closed.rows[0].ok).toBe(true);
    await expectDirect('closed', 'changes_requested');
    for (const principal of [actor, accountActor]) {
      const exact = await command('learning_file_attempt_read', [principal, directRun]);
      expect(exact).toMatchObject({
        canEdit: false,
        canStart: false,
        attempt: { id: directAttempt },
      });
      const listing = await app.query('SELECT learning_file_assignment_view($1,$2) AS file', [
        principal,
        directAssignment,
      ]);
      expect(listing.rows[0].file).toMatchObject({
        activityRunId: directRun,
        submittedAt: expect.any(String),
      });
      const download = (id: string) =>
        app.query('SELECT * FROM learning_file_download($1,$2,$3)', [principal, directRun, id]);
      expect((await download(directFile.attempt!.file!.id)).rows).toHaveLength(1);
      expect((await download(reworkDraft.attempt!.file!.id)).rows).toEqual([]);
    }
    const seatAssignments = (id: string) =>
      app.query('SELECT * FROM classroom_assignments_for_seat($1) WHERE id=$2', [
        id,
        directAssignment,
      ]);
    const accountAssignments = () =>
      app.query('SELECT * FROM classroom_assignments_for_account($1) WHERE id=$2', [
        accountId,
        directAssignment,
      ]);
    expect((await seatAssignments(data.seat.id)).rows[0]).toMatchObject({
      status: 'closed',
      project_id: null,
    });
    expect((await seatAssignments(data.other.id)).rows).toEqual([]);
    expect((await accountAssignments()).rows[0]).toMatchObject({
      status: 'closed',
      project_id: null,
    });
    expect(
      (await command('learning_file_attempt_read', [data.other.principal, directRun])).resultCode,
    ).toBe('forbidden');
    await admin.query(
      "UPDATE learner_identity_links SET status='inactive',disabled_at=now() WHERE account_id=$1",
      [accountId],
    );
    expect((await accountAssignments()).rows).toEqual([]);
    await admin.query(
      "UPDATE learner_identity_links SET status='active',disabled_at=NULL WHERE account_id=$1",
      [accountId],
    );

    const firstRequest = key('file-upload');
    expect((await scope(actor, attempt, 0, firstRequest)).resultCode).toBe('ok');
    expect((await scope(data.other.principal, attempt, 0, firstRequest)).resultCode).toBe(
      'forbidden',
    );
    const saveFile = (revision: number, name: string, sha: string, request: string) =>
      command('learning_file_draft_save', [
        actor,
        run.id,
        attempt,
        revision,
        name,
        8,
        'text/plain',
        sha,
        request,
      ]);
    const first = await saveFile(0, 'Первый.txt', '1'.repeat(64), firstRequest);
    expect(first.attempt?.file).toMatchObject({
      name: 'Первый.txt',
      sizeBytes: 8,
      sha256: '1'.repeat(64),
    });
    expect(await saveFile(0, 'Первый.txt', '1'.repeat(64), firstRequest)).toEqual(first);
    expect((await saveFile(0, 'Другой.txt', '9'.repeat(64), firstRequest)).resultCode).toBe(
      'request_conflict',
    );
    expect((await saveFile(0, 'Старый.txt', '1'.repeat(64), key('stale-file'))).resultCode).toBe(
      'draft_revision_conflict',
    );
    const next = await saveFile(1, 'Итог.txt', '2'.repeat(64), key('replace'));
    const file = next.attempt!.file!;
    expect(file.id).not.toBe(first.attempt?.file?.id);
    const download = (principal: string, id: string) =>
      app.query('SELECT * FROM learning_file_download($1,$2,$3)', [principal, run.id, id]);
    expect((await download(actor, first.attempt!.file!.id)).rows).toEqual([]);
    expect((await download(data.other.principal, file.id)).rows).toEqual([]);
    expect((await download(accountActor, file.id)).rows).toHaveLength(1);
    await admin.query("UPDATE accounts SET status='suspended' WHERE id=$1", [accountId]);
    expect((await download(accountActor, file.id)).rows).toEqual([]);
    expect((await download(actor, file.id)).rows[0]).toMatchObject({
      tenant_id: teacher.tenantId,
      attempt_id: attempt,
      file_descriptor: file,
    });
    const teacherRead = (account = teacherAccount) =>
      app.query('SELECT * FROM learning_teacher_exact_file_submission($1,$2,$3)', [
        account,
        data.classroomId,
        attempt,
      ]);
    expect((await teacherRead()).rows).toEqual([]);
    const frozen = await command('learning_file_submission_create', [
      actor,
      run.id,
      attempt,
      2,
      key('file-submit'),
    ]);
    expect(frozen.attempt).toMatchObject({
      state: 'submitted',
      file,
      revision: 2,
      digest: file.sha256,
    });
    expect((await teacherRead()).rows[0]).toMatchObject({
      file_descriptor: file,
      payload_digest: file.sha256,
      draft_revision: 2,
    });
    expect((await teacherRead(randomUUID())).rows).toEqual([]);
    expect((await saveFile(2, 'Замена.txt', '3'.repeat(64), key('after-submit'))).resultCode).toBe(
      'not_available',
    );
    const reviewed = await app.query(
      "SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,'accepted',8,'Проверено',NULL,NULL,$5)",
      [teacherAccount, teacherPrincipal, data.classroomId, attempt, key('file-review')],
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
    ).toMatchObject({ attempt_id: attempt, raw_points: 8, max_points: 10, feedback: 'Проверено' });
    await expect(app.query('SELECT id FROM learning_file_versions')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      admin.query('UPDATE learning_file_versions SET name=$1 WHERE id=$2', [
        'replaced.txt',
        file.id,
      ]),
    ).rejects.toThrow();

    await admin.query("UPDATE accounts SET status='active' WHERE id=$1", [accountId]);
    // Move the account while the old Seat still holds the class membership.
    await admin.query('UPDATE classroom_student_seats SET account_id=NULL WHERE id=$1', [
      data.seat.id,
    ]);
    const replacementSeat = (
      await admin.query(
        "INSERT INTO classroom_student_seats(tenant_id,classroom_id,account_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by) VALUES($1,$2,$3,'Replacement',$4,$4,true,'active',$5) RETURNING id",
        [teacher.tenantId, data.classroomId, accountId, key('replacement'), teacher.teacherId],
      )
    ).rows[0].id as string;
    await admin.query("UPDATE classroom_student_seats SET status='removed' WHERE id=$1", [
      data.seat.id,
    ]);
    const replacementActor = (
      await admin.query('SELECT principal_id FROM student_seat_principal($1)', [replacementSeat])
    ).rows[0].principal_id as string;
    expect(
      (
        await admin.query('SELECT learning_audience_ensure_seat_identity($1) AS learner', [
          replacementSeat,
        ])
      ).rows[0].learner,
    ).toBe(
      (
        await admin.query('SELECT learner_identity_id FROM activity_participations WHERE id=$1', [
          directStart.participationId,
        ])
      ).rows[0].learner_identity_id,
    );
    for (const proof of [
      await directEvidence(replacementSeat, 'seat'),
      await directEvidence(accountId, 'account'),
    ]) {
      expect(proof).toMatchObject({
        seatId: replacementSeat,
        attempt: { id: directAttempt, state: 'closed', reviewDecision: 'changes_requested' },
      });
    }
    expect((await seatAssignments(replacementSeat)).rows[0]).toMatchObject({ status: 'closed' });
    expect((await seatAssignments(data.seat.id)).rows).toEqual([]);
    const downloadPreviousSeatFile = (principal: string) =>
      app.query('SELECT * FROM learning_file_download($1,$2,$3)', [
        principal,
        directRun,
        directFile.attempt!.file!.id,
      ]);
    for (const principal of [replacementActor, accountActor]) {
      expect((await downloadPreviousSeatFile(principal)).rows[0]).toMatchObject({
        attempt_id: directAttempt,
      });
    }
    for (const principal of [actor, data.other.principal]) {
      expect((await downloadPreviousSeatFile(principal)).rows).toEqual([]);
      expect((await command('learning_file_attempt_read', [principal, directRun])).resultCode).toBe(
        'forbidden',
      );
    }
  });
});
