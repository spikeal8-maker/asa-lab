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
  feedbackReleasePolicy: { mode: 'after_close' },
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
  owner = await seedTeacher(admin, 'quiz-state-author');
  const learner = await seedTeacher(admin, 'quiz-state-linked-learner');
  const outsider = await seedTeacher(admin, 'quiz-state-outsider');
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

describe('Q2a exact canonical Quiz answer persistence', () => {
  it('concurrent Seat/Account Start, replay and reconnect retain one timer and one slot without academic results or keys', async () => {
    const f = await fixture();
    const before = await academicCounts(f.assignment);
    const [one, two] = await Promise.all([
      start(f.student.principal, f.part, 'q2:lost-receipt'),
      start(learnerPrincipal, f.part),
    ]);
    expect(one.result_code).toBe('ok');
    expect(two.result_code).toBe('ok');
    expect(one.attempt.attemptId).toBe(two.attempt.attemptId);
    expect(one.attempt.startedAt).toBe(two.attempt.startedAt);
    expect(one.attempt.expiresAt).toBe(two.attempt.expiresAt);
    expect(
      new Date(one.attempt.expiresAt).getTime() - new Date(one.attempt.startedAt).getTime(),
    ).toBe(600000);
    expect((await start(learnerPrincipal, f.part, 'q2:lost-receipt')).attempt.attemptId).toBe(
      one.attempt.attemptId,
    );
    expect((await read(learnerPrincipal, one.attempt.attemptId)).version).toBe(1);
    expect(JSON.stringify(one.attempt)).not.toContain('must-not-leak');
    expect(JSON.stringify(one.attempt)).not.toContain('answer_key');
    expect(one.attempt.questions[0].options).toEqual([
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]);
    expect(
      (
        await admin.query(
          'SELECT count(*) FROM learning_attempts WHERE activity_participation_id=$1',
          [f.part],
        )
      ).rows[0].count,
    ).toBe('1');
    expect(await academicCounts(f.assignment)).toEqual(before);
    expect(
      (
        await admin.query(
          "SELECT count(*) FROM audit_events WHERE entity_id=$1 AND action='participation.activated'",
          [f.part],
        )
      ).rows[0].count,
    ).toBe('1');
    await expect(app.query('SELECT * FROM quiz_attempt_states')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      app.query('SELECT learning_quiz_scope_internal($1,$2)', [f.student.principal, f.part]),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('one concurrent save wins, the other conflicts; confirmed answers survive read and invalid shapes never overwrite', async () => {
    const f = await fixture();
    const opened = await start(f.student.principal, f.part);
    const id = opened.attempt.attemptId;
    const responses = await Promise.all([
      save(f.student.principal, id, 1, { [f.question]: { value: 'a' } }),
      save(learnerPrincipal, id, 1, { [f.question]: { value: 'b' } }),
    ]);
    expect(responses.map((r) => r.result_code).sort()).toEqual(['ok', 'quiz_attempt_conflict']);
    const frozen = await read(f.student.principal, id);
    expect(frozen.version).toBe(2);
    for (const answers of [
      { [randomUUID()]: { value: 'a' } },
      { [f.question]: { value: 'foreign-option' } },
      { [f.question]: { value: true } },
      { [f.question]: { value: 'a', answer_key: 'b' } },
    ])
      expect((await save(learnerPrincipal, id, 2, answers)).result_code).toBe('invalid_answers');
    expect(await read(learnerPrincipal, id)).toMatchObject({ version: 2, answers: frozen.answers });
    expect(await academicCounts(f.assignment)).toEqual({
      submissions: '0',
      evaluations: '0',
      results: '0',
      grades: '0',
    });
  });
  it('foreign and revoked actors cannot read, start or save and cannot spend a slot', async () => {
    const f = await fixture();
    expect((await start(outsiderPrincipal, f.part)).result_code).toBe('forbidden');
    const opened = await start(f.student.principal, f.part);
    const id = opened.attempt.attemptId;
    expect(await read(outsiderPrincipal, id)).toBeNull();
    expect((await save(outsiderPrincipal, id, 1, {})).result_code).toBe('forbidden');
    await admin.query(
      "UPDATE learner_identity_links SET status='inactive',disabled_at=now() WHERE learner_identity_id=$1 AND link_kind='account'",
      [f.student.learner],
    );
    expect(await read(learnerPrincipal, id)).toBeNull();
    expect((await start(learnerPrincipal, f.part)).result_code).toBe('forbidden');
    expect((await save(learnerPrincipal, id, 1, {})).result_code).toBe('forbidden');
    expect((await read(f.student.principal, id)).version).toBe(1);
    await admin.query(
      "UPDATE learner_identity_links SET status='active',disabled_at=NULL WHERE learner_identity_id=$1 AND link_kind='account'",
      [f.student.learner],
    );
    await admin.query("UPDATE classroom_student_seats SET status='suspended' WHERE id=$1", [
      f.student.id,
    ]);
    expect(await read(f.student.principal, id)).toBeNull();
    expect((await save(f.student.principal, id, 1, {})).result_code).toBe('forbidden');
  });
  it('validates every currently supported frozen answer type without accepting aliases or duplicate options', async () => {
    const f = await fixture();
    const opened = await start(f.student.principal, f.part);
    const id = opened.attempt.attemptId;
    const answers = {
      [f.question]: { value: 'a' },
      [f.otherQuestions['multiple_choice']!]: { values: ['a', 'b'] },
      [f.otherQuestions['boolean']!]: { value: false },
      [f.otherQuestions['numeric']!]: { value: 0 },
      [f.otherQuestions['short_text']!]: { value: '' },
    };
    expect((await save(f.student.principal, id, 1, answers)).result_code).toBe('ok');
    for (const wrong of [
      { [f.otherQuestions['multiple_choice']!]: { values: ['a', 'a'] } },
      { [f.otherQuestions['multiple_choice']!]: { value: ['a'] } },
      { [f.otherQuestions['multiple_choice']!]: { values: ['unknown'] } },
      { [f.otherQuestions['boolean']!]: { value: 'false' } },
      { [f.otherQuestions['numeric']!]: { value: '42' } },
      { [f.otherQuestions['short_text']!]: { value: 'x'.repeat(12001) } },
    ])
      expect((await save(learnerPrincipal, id, 2, wrong)).result_code).toBe('invalid_answers');
    expect((await read(learnerPrincipal, id)).answers).toEqual(answers);
    await expect(
      admin.query(
        "UPDATE quiz_attempt_states SET selected_questions_jsonb='[]'::jsonb WHERE attempt_id=$1",
        [id],
      ),
    ).rejects.toThrow(/immutable/);
  });
  it('freezes canonical policy/content and resolves time seconds over run minutes over LAV, never legacy Quiz time', async () => {
    const f = await fixture({ seconds: 180, runMinutes: 5, overrideSeconds: 45 });
    const opened = await start(f.student.principal, f.part);
    const id = opened.attempt.attemptId;
    expect(
      new Date(opened.attempt.expiresAt).getTime() - new Date(opened.attempt.startedAt).getTime(),
    ).toBe(45000);
    const before = (
      await admin.query(
        'SELECT policy_snapshot,selected_questions_jsonb FROM quiz_attempt_states WHERE attempt_id=$1',
        [id],
      )
    ).rows[0];
    const edited = (
      await admin.query(
        "SELECT * FROM learning_activity_draft_put($1,$2,$3,1,'New policy',NULL,'graded',5,$4::jsonb,NULL,$5,NULL)",
        [ownerPrincipal, owner.tenantId, f.activity, JSON.stringify(policies(5, 900)), f.quiz],
      )
    ).rows[0];
    expect(edited.result_code).toBe('ok');
    expect(
      (
        await admin.query('SELECT * FROM learning_activity_publish($1,$2,$3,2,$4)', [
          ownerPrincipal,
          owner.tenantId,
          f.activity,
          'q2:new:publish:' + randomUUID(),
        ])
      ).rows[0].result_code,
    ).toBe('ok');
    await admin.query(
      'UPDATE activity_participations SET time_limit_override_seconds=90 WHERE id=$1',
      [f.part],
    );
    expect((await start(learnerPrincipal, f.part)).attempt.expiresAt).toBe(
      opened.attempt.expiresAt,
    );
    expect(
      (
        await admin.query(
          'SELECT policy_snapshot,selected_questions_jsonb FROM quiz_attempt_states WHERE attempt_id=$1',
          [id],
        )
      ).rows[0],
    ).toEqual(before);
    const runOnly = await fixture({ seconds: 180, runMinutes: 5 });
    const r = await start(runOnly.student.principal, runOnly.part);
    expect(new Date(r.attempt.expiresAt).getTime() - new Date(r.attempt.startedAt).getTime()).toBe(
      300000,
    );
    const unlimited = await fixture({ seconds: null });
    expect((await start(unlimited.student.principal, unlimited.part)).attempt.expiresAt).toBeNull();
  });
  it('uses effective windows, authored late policy and teacher unlock without raw-Run activation overrides', async () => {
    const future = await fixture({ runOpensAt: new Date(Date.now() + 3600000).toISOString() });
    expect((await start(future.student.principal, future.part)).result_code).toBe('not_available');
    expect(
      (await admin.query('SELECT status FROM activity_participations WHERE id=$1', [future.part]))
        .rows[0].status,
    ).toBe('assigned');
    expect(
      (
        await admin.query(
          "SELECT count(*) FROM audit_events WHERE entity_id=$1 AND action='participation.activated'",
          [future.part],
        )
      ).rows[0].count,
    ).toBe('0');
    await admin.query(
      "UPDATE activity_runs SET operational_overrides=jsonb_build_object('opensAt',now()-interval '1 minute') WHERE id=$1",
      [future.run],
    );
    expect((await start(future.student.principal, future.part)).result_code).toBe('ok');
    const late = await fixture({ runDueAt: new Date(Date.now() - 60000).toISOString() });
    expect((await start(late.student.principal, late.part)).result_code).toBe('ok');
    const blockedPolicy = { ...policies(), latePolicy: { mode: 'block_at_due' } };
    const blocked = await fixture({
      runDueAt: new Date(Date.now() - 60000).toISOString(),
      policy: blockedPolicy,
    });
    expect((await start(blocked.student.principal, blocked.part)).result_code).toBe(
      'not_available',
    );
    await admin.query('UPDATE activity_participations SET teacher_unlocked=true WHERE id=$1', [
      blocked.part,
    ]);
    expect((await start(blocked.student.principal, blocked.part)).result_code).toBe('ok');
    const closed = await fixture();
    await admin.query(
      "UPDATE activity_participations SET teacher_unlocked=true,operational_overrides=jsonb_build_object('closesAt',now()-interval '1 second') WHERE id=$1",
      [closed.part],
    );
    expect((await start(closed.student.principal, closed.part)).result_code).toBe('not_available');
    expect(
      (
        await admin.query(
          'SELECT count(*) FROM learning_attempts WHERE activity_participation_id=$1',
          [closed.part],
        )
      ).rows[0].count,
    ).toBe('0');
    expect(
      (await admin.query('SELECT status FROM activity_participations WHERE id=$1', [closed.part]))
        .rows[0].status,
    ).toBe('assigned');
  });
  it('requires an active Account while a genuine Seat remains independent of its linked Account status', async () => {
    const f = await fixture();
    await admin.query("UPDATE accounts SET status='suspended' WHERE id=$1", [learnerAccount]);
    try {
      expect((await start(learnerPrincipal, f.part)).result_code).toBe('forbidden');
      const seat = await start(f.student.principal, f.part);
      expect(seat.result_code).toBe('ok');
      expect(await read(learnerPrincipal, seat.attempt.attemptId)).toBeNull();
      expect((await save(learnerPrincipal, seat.attempt.attemptId, 1, {})).result_code).toBe(
        'forbidden',
      );
      expect((await read(f.student.principal, seat.attempt.attemptId)).version).toBe(1);
    } finally {
      await admin.query("UPDATE accounts SET status='active' WHERE id=$1", [learnerAccount]);
    }
  });
  it('rejects expired mutations and current closing windows while still returning owned history', async () => {
    const f = await fixture();
    const opened = await start(f.student.principal, f.part);
    const id = opened.attempt.attemptId;
    await admin.query(
      "UPDATE learning_attempts SET expires_at=now()-interval '1 second' WHERE id=$1",
      [id],
    );
    expect(
      (await save(f.student.principal, id, 1, { [f.question]: { value: 'a' } })).result_code,
    ).toBe('quiz_attempt_closed');
    expect((await read(learnerPrincipal, id)).version).toBe(1);
    const closed = await fixture();
    const active = await start(closed.student.principal, closed.part);
    await admin.query(
      "UPDATE activity_participations SET operational_overrides=jsonb_build_object('closesAt',now()-interval '1 second') WHERE id=$1",
      [closed.part],
    );
    expect(
      (await save(closed.student.principal, active.attempt.attemptId, 1, {})).result_code,
    ).toBe('quiz_attempt_closed');
    expect(await read(closed.student.principal, active.attempt.attemptId)).not.toBeNull();
  });
  it('re-entry preserves exact participation budget and closed request receipts instead of starting a new timer', async () => {
    const f = await fixture({ attempts: 1 });
    const opened = await start(f.student.principal, f.part, 'q2:remember:closed');
    await admin.query("UPDATE learning_attempts SET state='expired' WHERE id=$1", [
      opened.attempt.attemptId,
    ]);
    await admin.query(
      "UPDATE classroom_student_seats SET status='removed',account_id=NULL WHERE id=$1",
      [f.student.id],
    );
    const replacement = await f.seat();
    expect(replacement.learner).toBe(f.student.learner);
    const replay = await start(replacement.principal, f.part, 'q2:remember:closed');
    expect(replay.attempt.attemptId).toBe(opened.attempt.attemptId);
    expect(replay.attempt.startedAt).toBe(opened.attempt.startedAt);
    expect((await start(replacement.principal, f.part)).result_code).toBe('attempt_limit');
  });
  it('does not spend the exact participation budget on unrelated compatibility history or another class', async () => {
    const f = await fixture({ attempts: 1 });
    await admin.query(
      "INSERT INTO learning_attempts(tenant_id,classroom_id,classroom_assignment_id,learning_activity_version_id,seat_id,learner_identity_id,attempt_number,state) VALUES($1,$2,$3,$4,$5,$6,1,'expired')",
      [owner.tenantId, f.classroom, f.assignment, f.version, f.student.id, f.student.learner],
    );
    const opened = await start(f.student.principal, f.part);
    expect(opened.result_code).toBe('ok');
    expect(opened.attempt.attemptNumber).toBe(1);
    expect(
      (
        await admin.query('SELECT attempt_number FROM learning_attempts WHERE id=$1', [
          opened.attempt.attemptId,
        ])
      ).rows[0].attempt_number,
    ).toBe(2);
    const anotherClass = await fixture({ attempts: 1 });
    expect((await start(anotherClass.student.principal, anotherClass.part)).result_code).toBe('ok');
    expect((await start(f.student.principal, anotherClass.part)).result_code).toBe('forbidden');
  });
  it('increments the canonical ordinal after Seat replacement even when compatibility numbering restarts', async () => {
    const f = await fixture({ attempts: 2 });
    const first = await start(f.student.principal, f.part, 'q2:ordinal:first');
    expect(first.attempt.attemptNumber).toBe(1);
    await admin.query("UPDATE learning_attempts SET state='expired' WHERE id=$1", [
      first.attempt.attemptId,
    ]);
    await admin.query(
      "UPDATE classroom_student_seats SET status='removed',account_id=NULL WHERE id=$1",
      [f.student.id],
    );
    const replacement = await f.seat();
    expect(replacement.learner).toBe(f.student.learner);
    const second = await start(replacement.principal, f.part, 'q2:ordinal:second');
    expect(second.result_code).toBe('ok');
    expect(second.attempt.attemptNumber).toBe(2);
    expect(
      (
        await admin.query('SELECT attempt_number FROM learning_attempts WHERE id=$1', [
          second.attempt.attemptId,
        ])
      ).rows[0].attempt_number,
    ).toBe(1);
    expect(
      (await start(replacement.principal, f.part, 'q2:ordinal:first')).attempt.attemptNumber,
    ).toBe(1);
    await expect(
      admin.query(
        'UPDATE quiz_attempt_states SET participation_attempt_number=7 WHERE attempt_id=$1',
        [second.attempt.attemptId],
      ),
    ).rejects.toThrow(/immutable/);
    await admin.query("UPDATE learning_attempts SET state='expired' WHERE id=$1", [
      second.attempt.attemptId,
    ]);
    expect((await start(replacement.principal, f.part)).result_code).toBe('attempt_limit');
  });
  it('fails conflicting time units before activation, attempt creation or a result write', async () => {
    const contradictory = policies();
    contradictory.attemptPolicy = {
      ...contradictory.attemptPolicy,
      timeLimitMinutes: 2,
    } as typeof contradictory.attemptPolicy;
    const f = await fixture({ policy: contradictory });
    expect((await start(f.student.principal, f.part)).result_code).toBe('invalid_policy');
    expect(
      (
        await admin.query(
          'SELECT count(*) FROM learning_attempts WHERE activity_participation_id=$1',
          [f.part],
        )
      ).rows[0].count,
    ).toBe('0');
    expect(
      (await admin.query('SELECT status FROM activity_participations WHERE id=$1', [f.part]))
        .rows[0].status,
    ).toBe('assigned');
  });
  it('isolates actual shared-handout course siblings with independent slots, timers and saved answers', async () => {
    const f = await fixture({ attempts: 1, seconds: 120 });
    // Historical shared-handout shape is seeded through published schema/commands;
    // this is not a claim that the project-only Course Builder can author Quiz yet.
    const course = (
      await admin.query(
        "INSERT INTO courses(tenant_id,owner_principal_id,title) VALUES($1,$2,'Historical Quiz course') RETURNING id",
        [owner.tenantId, ownerPrincipal],
      )
    ).rows[0].id;
    const version = (
      await admin.query(
        "INSERT INTO course_versions(tenant_id,course_id,version_number,title,outline,content_hash,published_by_principal_id) VALUES($1,$2,1,'Historical Quiz course','{}'::jsonb,$3,$4) RETURNING id",
        [owner.tenantId, course, '0'.repeat(32), ownerPrincipal],
      )
    ).rows[0].id;
    const courseRun = (
      await admin.query(
        "INSERT INTO classroom_course_runs(tenant_id,classroom_id,course_id,course_version_id,title,version_number,assigned_by_principal_id) VALUES($1,$2,$3,$4,'Historical Quiz course',1,$5) RETURNING id",
        [owner.tenantId, f.classroom, course, version, ownerPrincipal],
      )
    ).rows[0].id;
    const handout = (
      await admin.query(
        "INSERT INTO classroom_assignments(tenant_id,classroom_id,course_run_id,status,created_by) VALUES($1,$2,$3,'open',$4) RETURNING id",
        [owner.tenantId, f.classroom, courseRun, owner.teacherId],
      )
    ).rows[0].id;
    const lesson = (
      await admin.query(
        "INSERT INTO classroom_course_run_lessons(tenant_id,run_id,source_section_id,source_lesson_id,section_title,section_position,title,kind,lesson_position,classroom_assignment_id,module_key) VALUES($1,$2,$3,$4,'Frozen',1,'Shared Quiz blocks','assignment',1,$5,'quiz') RETURNING id",
        [owner.tenantId, courseRun, randomUUID(), randomUUID(), handout],
      )
    ).rows[0].id;
    const enrollment = (
      await inTenant((client) =>
        client.query('SELECT * FROM course_enrollment_assign($1,$2,$3)', [
          ownerPrincipal,
          courseRun,
          f.student.learner,
        ]),
      )
    ).rows[0];
    expect(enrollment.result_code).toBe('ok');
    expect(
      (
        await inTenant((client) =>
          client.query('SELECT * FROM course_enrollment_activate($1,$2)', [
            f.student.principal,
            enrollment.enrollment_id,
          ]),
        )
      ).rows[0].result_code,
    ).toBe('ok');
    const parts: string[] = [];
    for (const block of ['first-quiz', 'second-quiz']) {
      const run = (
        await inTenant((client) =>
          client.query(
            "SELECT * FROM activity_run_create($1,$2,$3,'course',$4,$5,NULL,NULL,NULL,NULL,NULL,'{}'::jsonb,$6,$7)",
            [
              ownerPrincipal,
              handout,
              f.version,
              courseRun,
              lesson,
              'q2:sibling:' + randomUUID(),
              block,
            ],
          ),
        )
      ).rows[0];
      expect(run.result_code).toBe('ok');
      const part = (
        await inTenant((client) =>
          client.query('SELECT * FROM activity_participation_assign($1,$2,$3,$4)', [
            ownerPrincipal,
            run.activity_run_id,
            f.student.learner,
            enrollment.enrollment_id,
          ]),
        )
      ).rows[0];
      expect(part.result_code).toBe('ok');
      parts.push(part.participation_id);
    }
    const [first, second] = await Promise.all(
      parts.map((part) => start(f.student.principal, part)),
    );
    expect(first.result_code).toBe('ok');
    expect(second.result_code).toBe('ok');
    expect(first.attempt.attemptId).not.toBe(second.attempt.attemptId);
    expect([first.attempt.attemptNumber, second.attempt.attemptNumber]).toEqual([1, 1]);
    expect(
      (
        await admin.query(
          'SELECT attempt_number FROM learning_attempts WHERE classroom_assignment_id=$1 ORDER BY attempt_number',
          [handout],
        )
      ).rows.map((row) => row.attempt_number),
    ).toEqual([1, 2]);
    expect(
      (
        await save(f.student.principal, first.attempt.attemptId, 1, {
          [f.question]: { value: 'a' },
        })
      ).result_code,
    ).toBe('ok');
    expect((await read(learnerPrincipal, second.attempt.attemptId)).answers).toEqual({});
    expect(await academicCounts(handout)).toEqual({
      submissions: '0',
      evaluations: '0',
      results: '0',
      grades: '0',
    });
  });
});
