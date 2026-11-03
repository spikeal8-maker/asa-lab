import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool;
let app: pg.Pool;
let owner: SeededTeacher;
let ownerPrincipal: string;
let ownerAccount: string;
let learnerAccount: string;
let learnerPrincipal: string;
let outsiderPrincipal: string;
const policies = (attempts = 2, seconds: number | null = 600) => ({
  attemptPolicy: { maxAttempts: attempts, timeLimitSeconds: seconds },
  resultSelectionPolicy: { mode: 'best' },
  completionPolicy: { mode: 'submission' },
  latePolicy: { mode: 'allow_until_close' },
  assessmentPolicy: { mode: 'automatic' },
  feedbackReleasePolicy: { mode: 'immediate' },
});
async function inTenant<T>(work: (client: pg.PoolClient) => Promise<T>) {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id',$1,true)", [owner.tenantId]);
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  owner = await seedTeacher(admin, 'quiz-complete-author');
  const learner = await seedTeacher(admin, 'quiz-complete-linked-learner');
  const outsider = await seedTeacher(admin, 'quiz-complete-outsider');
  async function identity(teacher: SeededTeacher) {
    return (
      await admin.query(
        'SELECT principal_id,account_id FROM legacy_user_account_links WHERE tenant_id=$1 AND user_id=$2',
        [teacher.tenantId, teacher.teacherId],
      )
    ).rows[0];
  }
  const author = await identity(owner);
  ownerPrincipal = author.principal_id;
  ownerAccount = author.account_id;
  const linked = await identity(learner);
  learnerAccount = linked.account_id;
  learnerPrincipal = linked.principal_id;
  outsiderPrincipal = (await identity(outsider)).principal_id;
});
afterAll(async () => {
  await app.end();
  await admin.end();
});

async function fixture(
  input: {
    manual?: boolean;
    attempts?: number;
    seconds?: number | null;
    runMinutes?: number;
    overrideSeconds?: number;
    policy?: Record<string, unknown>;
    runOpensAt?: string;
    runDueAt?: string;
  } = {},
) {
  const classroom = (
    await admin.query(
      "INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,'Quiz persistence',$4) RETURNING id",
      [owner.tenantId, owner.schoolId, owner.periodId, owner.teacherId],
    )
  ).rows[0].id as string;
  await admin.query(
    "INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner')",
    [owner.tenantId, classroom, owner.teacherId, ownerAccount],
  );
  async function seat() {
    // Keep the full UUID entropy within both varchar(32) login fields.
    const loginHandle = randomUUID().replaceAll('-', '');
    const id = (
      await admin.query(
        "INSERT INTO classroom_student_seats(tenant_id,classroom_id,account_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by) VALUES($1,$2,$3,'Learner',$4,$4,true,'active',$5) RETURNING id",
        [owner.tenantId, classroom, learnerAccount, loginHandle, owner.teacherId],
      )
    ).rows[0].id as string;
    const principal = (
      await admin.query('SELECT principal_id FROM student_seat_principal($1)', [id])
    ).rows[0].principal_id as string;
    const learner = (
      await admin.query('SELECT learning_audience_ensure_seat_identity($1) AS id', [id])
    ).rows[0].id as string;
    return { id, principal, learner };
  }
  const student = await seat();
  const question = (
    await admin.query(
      `SELECT * FROM question_version_create($1,$2,'school','single_choice',
    '[{"type":"paragraph","text":"Choose an option"}]'::jsonb,
    '{"options":[{"id":"a","label":"A","secret":"must-not-leak"},{"id":"b","label":"B"}],"answer_key":"must-not-leak"}'::jsonb,
    '{"value":"b"}'::jsonb,1,NULL,NULL,ARRAY[]::text[])`,
      [ownerPrincipal, owner.tenantId],
    )
  ).rows[0];
  expect(question.result_code).toBe('ok');
  const otherQuestions: Record<string, string> = {};
  for (const [type, schema, key] of [
    [
      'multiple_choice',
      {
        options: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
      },
      { values: ['a'] },
    ],
    ['boolean', {}, { value: true }],
    ['numeric', {}, { value: 42 }],
    ['short_text', {}, { accepted: ['answer'] }],
    [
      'matching',
      {
        left: [
          { id: 'l1', label: 'L1' },
          { id: 'l2', label: 'L2' },
        ],
        right: [
          { id: 'r1', label: 'R1' },
          { id: 'r2', label: 'R2' },
        ],
      },
      { values: ['l1:r1', 'l2:r2'] },
    ],
    [
      'ordering',
      {
        options: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
      },
      { values: ['b', 'a'] },
    ],
    ...(input.manual === false ? [] : [['long_text_manual', {}, {}]]),
  ] as const) {
    const created = (
      await admin.query(
        'SELECT * FROM question_version_create($1,$2,\'school\',$3,\'[{"type":"paragraph","text":"Frozen prompt"}]\'::jsonb,$4::jsonb,$5::jsonb,1,NULL,NULL,ARRAY[]::text[])',
        [ownerPrincipal, owner.tenantId, type, JSON.stringify(schema), JSON.stringify(key)],
      )
    ).rows[0];
    expect(created.result_code).toBe('ok');
    otherQuestions[type] = created.question_version_id;
  }
  const quiz = (
    await admin.query(
      "SELECT * FROM quiz_version_create($1,$2,'Frozen questions',NULL,$3::jsonb,1,1,6000,'immediate')",
      [
        ownerPrincipal,
        owner.tenantId,
        JSON.stringify([question.question_version_id, ...Object.values(otherQuestions)]),
      ],
    )
  ).rows[0];
  expect(quiz.result_code).toBe('ok');
  const policy =
    input.policy ??
    policies(input.attempts ?? 2, input.seconds === undefined ? 600 : input.seconds);
  const draft = (
    await admin.query(
      "SELECT * FROM learning_activity_create($1,$2,'school','private','quiz','Canonical rules',NULL,'graded',1,$3::jsonb,NULL,$4,NULL,NULL,$5)",
      [
        ownerPrincipal,
        owner.tenantId,
        JSON.stringify(policy),
        quiz.quiz_version_id,
        'q2:create:' + randomUUID(),
      ],
    )
  ).rows[0];
  expect(draft.result_code).toBe('ok');
  const version = (
    await admin.query('SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)', [
      ownerPrincipal,
      owner.tenantId,
      draft.activity_id,
      'q2:publish:' + randomUUID(),
    ])
  ).rows[0];
  expect(version.result_code).toBe('ok');
  const handout = (
    await admin.query('SELECT * FROM classroom_quiz_assign($1,$2,$3,$4,NULL)', [
      ownerAccount,
      ownerPrincipal,
      classroom,
      quiz.quiz_version_id,
    ])
  ).rows[0];
  expect(handout.result_code).toBe('ok');
  const run = (
    await inTenant((client) =>
      client.query(
        "SELECT * FROM activity_run_create($1,$2,$3,'direct',NULL,NULL,$6,$7,NULL,NULL,NULL,$4::jsonb,$5)",
        [
          ownerPrincipal,
          handout.classroom_assignment_id,
          version.activity_version_id,
          JSON.stringify(input.runMinutes ? { timeLimitMinutes: input.runMinutes } : {}),
          'q2:run:' + randomUUID(),
          input.runOpensAt ?? null,
          input.runDueAt ?? null,
        ],
      ),
    )
  ).rows[0];
  expect(run.result_code).toBe('ok');
  const part = (
    await inTenant((client) =>
      client.query('SELECT * FROM activity_participation_assign($1,$2,$3,NULL)', [
        ownerPrincipal,
        run.activity_run_id,
        student.learner,
      ]),
    )
  ).rows[0];
  expect(part.result_code).toBe('ok');
  if (input.overrideSeconds)
    await admin.query(
      'UPDATE activity_participations SET time_limit_override_seconds=$1 WHERE id=$2',
      [input.overrideSeconds, part.participation_id],
    );
  return {
    classroom,
    student,
    question: question.question_version_id as string,
    otherQuestions,
    quiz: quiz.quiz_version_id as string,
    version: version.activity_version_id as string,
    activity: draft.activity_id as string,
    assignment: handout.classroom_assignment_id as string,
    run: run.activity_run_id as string,
    part: part.participation_id as string,
    seat,
  };
}
async function start(actor: string, part: string, request = 'q2:start:' + randomUUID()) {
  return (
    await app.query('SELECT * FROM learning_quiz_attempt_start($1,$2,$3)', [actor, part, request])
  ).rows[0];
}
async function read(actor: string, attempt: string) {
  return (await app.query('SELECT learning_quiz_attempt_read($1,$2) AS value', [actor, attempt]))
    .rows[0].value;
}
async function save(
  actor: string,
  attempt: string,
  version: number,
  answers: Record<string, unknown>,
) {
  return (
    await app.query('SELECT * FROM learning_quiz_attempt_save($1,$2,$3,$4::jsonb)', [
      actor,
      attempt,
      version,
      JSON.stringify(answers),
    ])
  ).rows[0];
}
async function academicCounts(assignment: string) {
  return (
    await admin.query(
      `SELECT
  (SELECT count(*) FROM learning_submissions s JOIN learning_attempts a ON a.id=s.attempt_id WHERE a.classroom_assignment_id=$1) AS submissions,
  (SELECT count(*) FROM learning_evaluations e JOIN learning_attempts a ON a.id=e.attempt_id WHERE a.classroom_assignment_id=$1) AS evaluations,
  (SELECT count(*) FROM assessment_results r JOIN learning_attempts a ON a.id=r.attempt_id WHERE a.classroom_assignment_id=$1) AS results,
  (SELECT count(*) FROM gradebook_entries WHERE classroom_assignment_id=$1) AS grades`,
      [assignment],
    )
  ).rows[0];
}

const req = () => 'complete:' + randomUUID();
async function submit(actor: string, id: string, revision: number, request = req()) {
  return (
    await app.query('SELECT * FROM learning_quiz_attempt_submit($1,$2,$3,$4)', [
      actor,
      id,
      revision,
      request,
    ])
  ).rows[0];
}
function allAnswers(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    [f.question]: { value: 'b' },
    [f.otherQuestions['multiple_choice']!]: { values: ['a'] },
    [f.otherQuestions['boolean']!]: { value: true },
    [f.otherQuestions['numeric']!]: { value: 42 },
    [f.otherQuestions['short_text']!]: { value: ' ANSWER ' },
    [f.otherQuestions['matching']!]: { values: ['l2:r2', 'l1:r1'] },
    [f.otherQuestions['ordering']!]: { values: ['b', 'a'] },
    ...(f.otherQuestions['long_text_manual']
      ? { [f.otherQuestions['long_text_manual']]: { value: 'Written explanation' } }
      : {}),
  };
}
describe('Complete canonical Quiz Course vertical', () => {
  it('persists incomplete bank/Quiz drafts and publishes one exact reference through existing Activity', async () => {
    async function write(
      kind: string,
      action: string,
      id: string | null,
      revision: number | null,
      payload: unknown,
      head: string | null = null,
    ) {
      return (
        await app.query(
          'SELECT learning_content_author_write($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) AS value',
          [
            ownerPrincipal,
            owner.tenantId,
            kind,
            action,
            id,
            revision,
            req(),
            JSON.stringify(payload),
            head,
          ],
        )
      ).rows[0].value;
    }
    const question = await write('question', 'create', null, null, {});
    expect(question.code).toBe('ok');
    const reopened = (
      await app.query("SELECT learning_content_author_read($1,$2,'question',$3) AS value", [
        ownerPrincipal,
        owner.tenantId,
        question.id,
      ])
    ).rows[0].value;
    expect(reopened.draft.promptBlocks).toEqual([]);
    expect((await write('question', 'publish', question.id, 1, null)).code).toBe(
      'invalid_question',
    );
    expect(
      (
        await app.query("SELECT learning_content_author_read($1,$2,'question',$3) AS value", [
          outsiderPrincipal,
          owner.tenantId,
          question.id,
        ])
      ).rows[0].value,
    ).toBeNull();
    const saved = await write('question', 'save', question.id, 1, {
      questionType: 'boolean',
      promptBlocks: [{ type: 'text', text: 'Ready?' }],
      responseSchema: {},
      answerKey: { value: true },
      maxPoints: 2,
    });
    expect(saved.code).toBe('ok');
    const quiz = await write('quiz', 'create', null, null, {
      title: 'Inline quiz',
      questions: [{ questionId: question.id, questionDraftRevision: 2, required: true }],
    });
    expect(quiz.code).toBe('ok');
    const activity = (
      await app.query(
        `SELECT * FROM learning_activity_quiz_create($1,$2,'personal','private','quiz','Quiz task',NULL,'graded',NULL,$3::jsonb,NULL,NULL,NULL,NULL,$4,NULL,NULL,$5,1)`,
        [ownerPrincipal, owner.tenantId, JSON.stringify(policies()), req(), quiz.id],
      )
    ).rows[0];
    expect(activity.result_code).toBe('ok');
    const published = (
      await app.query('SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)', [
        ownerPrincipal,
        owner.tenantId,
        activity.activity_id,
        req(),
      ])
    ).rows[0];
    expect(published.result_code).toBe('ok');
    const version = (
      await admin.query(
        'SELECT quiz_version_id,max_points FROM learning_activity_versions WHERE id=$1',
        [published.activity_version_id],
      )
    ).rows[0];
    expect(version.max_points).toBe(2);
    expect(version.quiz_version_id).toBeTruthy();
  });
  it('freezes eight types, submits exact confirmed Attempt once and keeps auto points provisional until existing teacher review', async () => {
    const f = await fixture();
    const begun = await start(f.student.principal, f.part);
    expect(begun.result_code).toBe('ok');
    const id = begun.attempt.attemptId;
    expect(begun.attempt.questions).toHaveLength(8);
    expect(JSON.stringify(begun.attempt)).not.toContain('must-not-leak');
    const persisted = await save(f.student.principal, id, 1, allAnswers(f));
    expect(persisted.result_code).toBe('ok');
    expect((await read(learnerPrincipal, id)).answers).toEqual(allAnswers(f));
    expect((await submit(f.student.principal, id, 1)).result_code).toBe('quiz_attempt_conflict');
    const request = req();
    const [one, two] = await Promise.all([
      submit(f.student.principal, id, 2, request),
      submit(learnerPrincipal, id, 2, request),
    ]);
    expect(one.result_code).toBe('ok');
    expect(two.result_code).toBe('ok');
    expect(one.attempt.state).toBe('evaluating');
    expect(one.attempt.result).toMatchObject({ points: 7, maxPoints: 8, provisional: true });
    expect(await academicCounts(f.assignment)).toMatchObject({
      submissions: '1',
      results: '0',
      grades: '0',
    });
    expect((await save(f.student.principal, id, 2, {})).result_code).toBe('quiz_attempt_closed');
    expect(
      (
        await app.query('SELECT learning_teacher_exact_quiz_submission($1,$2,$3) AS value', [
          ownerAccount,
          f.classroom,
          id,
        ])
      ).rows[0].value,
    ).toMatchObject({ kind: 'quiz', manualPending: 1, autoPoints: 7 });
    const review = (
      await app.query(
        `SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,'accepted',8,'Complete',NULL,NULL,$5)`,
        [ownerAccount, ownerPrincipal, f.classroom, id, req()],
      )
    ).rows[0];
    expect(review.result_code).toBe('ok');
    expect(await academicCounts(f.assignment)).toMatchObject({ results: '1', grades: '1' });
    expect((await read(f.student.principal, id)).result).toMatchObject({
      points: 8,
      provisional: false,
    });
  });
  it('grades existing five rules plus matching/ordering automatically without creating a second Attempt', async () => {
    const f = await fixture({ manual: false });
    const begun = await start(f.student.principal, f.part);
    const id = begun.attempt.attemptId;
    expect((await save(f.student.principal, id, 1, allAnswers(f))).result_code).toBe('ok');
    const done = await submit(f.student.principal, id, 2);
    expect(done.result_code).toBe('ok');
    expect(done.attempt.result).toMatchObject({
      points: 7,
      maxPoints: 7,
      outcome: 'passed',
      provisional: false,
    });
    expect(await academicCounts(f.assignment)).toMatchObject({
      submissions: '1',
      results: '1',
      grades: '1',
    });
    expect(
      (
        await admin.query(
          'SELECT count(*) AS n FROM learning_attempts WHERE activity_participation_id=$1',
          [f.part],
        )
      ).rows[0].n,
    ).toBe('1');
  });
  it('expiry finalizes saved server answers, and expire_without_submission creates no result', async () => {
    for (const expirationPolicy of ['auto_submit', 'expire_without_submission']) {
      const policy = policies();
      Object.assign(policy.attemptPolicy, { expirationPolicy });
      const f = await fixture({ manual: false, policy });
      const begun = await start(f.student.principal, f.part);
      const id = begun.attempt.attemptId;
      expect((await save(f.student.principal, id, 1, allAnswers(f))).result_code).toBe('ok');
      await admin.query(
        "UPDATE learning_attempts SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [id],
      );
      expect((await save(f.student.principal, id, 2, {})).result_code).toBe('quiz_attempt_closed');
      await app.query('SELECT learning_quiz_expiry_sweep()');
      await app.query('SELECT learning_quiz_expiry_sweep()');
      expect((await read(f.student.principal, id)).state).toBe('closed');
      const count = expirationPolicy === 'auto_submit' ? '1' : '0';
      expect(await academicCounts(f.assignment)).toMatchObject({
        submissions: count,
        results: count,
        grades: count,
      });
    }
  });
});
