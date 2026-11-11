// Temporary CI #1093 diagnostic fixtures. Only call with the probe's guarded
// disposable-database clients. No credentials, SQL, IDs or payloads are logged.
import { createHash, randomUUID } from 'node:crypto';

export class FixtureError extends Error {
  constructor(code) {
    super(code);
    this.probeCode = code;
  }
}

function requireFixture(condition, code) {
  if (!condition) throw new FixtureError(code);
}

async function one(client, sql, args, code) {
  const result = await client.query(sql, args);
  requireFixture(result.rows.length === 1, code);
  return result.rows[0];
}

function commandOk(row, code) {
  requireFixture(row?.result_code === 'ok', code);
  return row;
}

function responseOk(row, code) {
  requireFixture(row?.value?.resultCode === 'ok', code);
  return row.value;
}

const request = () => `ci1093:${randomUUID()}`;

async function inTenant(admin, tenantId, operation) {
  await admin.query('BEGIN');
  try {
    await admin.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
    const result = await operation();
    await admin.query('COMMIT');
    return result;
  } catch (error) {
    await admin.query('ROLLBACK');
    throw error;
  }
}

async function account(admin, label, email = `ci1093-${label}-${randomUUID()}@example.test`) {
  const { id: accountId } = await one(
    admin,
    "INSERT INTO accounts(email,password_hash,birth_date,country) VALUES($1,'test-only',DATE '2000-01-01','RU') RETURNING id",
    [email],
    'fixture_account_create',
  );
  const { id: accountPrincipalId } = await one(
    admin,
    "INSERT INTO principals(kind,account_id) VALUES('account',$1) RETURNING id",
    [accountId],
    'fixture_account_principal_create',
  );
  return { accountId, accountPrincipalId };
}

// Mirrors tests/portal/helpers.ts seedTeacher/seedLegacyTeacherIdentity. The
// diagnostic never authenticates these synthetic accounts, so no password work
// is included in the measured reader or claimed to reproduce full-test setup.
async function schoolTeacher(admin, label) {
  const { id: tenantId } = await one(
    admin,
    'INSERT INTO tenants(title,workspace_slug) VALUES($1,$2) RETURNING id',
    [`CI1093 ${label}`, `ci1093-${label}-${randomUUID()}`],
    'fixture_tenant_create',
  );
  await admin.query("INSERT INTO tenant_placements(tenant_id,mode) VALUES($1,'DEDICATED_REGION')", [
    tenantId,
  ]);
  const { id: schoolId } = await one(
    admin,
    "INSERT INTO schools(tenant_id,title) VALUES($1,'Diagnostic school') RETURNING id",
    [tenantId],
    'fixture_school_create',
  );
  const { id: periodId } = await one(
    admin,
    "INSERT INTO academic_periods(tenant_id,school_id,title,starts_on,ends_on,is_active) VALUES($1,$2,'Diagnostic period',DATE '2026-09-01',DATE '2027-06-30',true) RETURNING id",
    [tenantId, schoolId],
    'fixture_period_create',
  );
  const email = `ci1093-${label}-teacher-${randomUUID()}@example.test`;
  const { id: teacherId } = await one(
    admin,
    "INSERT INTO users(tenant_id,school_id,role,email,display_name,password_hash) VALUES($1,$2,'teacher',$3,'Diagnostic teacher','test-only') RETURNING id",
    [tenantId, schoolId, email],
    'fixture_teacher_create',
  );
  const { id: workspaceId } = await one(
    admin,
    "INSERT INTO workspaces(tenant_id,kind,title) VALUES($1,'organization','Diagnostic workspace') RETURNING id",
    [tenantId],
    'fixture_workspace_create',
  );
  const { accountId: teacherAccountId, accountPrincipalId: teacherPrincipalId } = await account(
    admin,
    `${label}-teacher`,
    email,
  );
  await admin.query(
    "INSERT INTO profiles(account_id,username,display_name) VALUES($1,$2,'Diagnostic teacher')",
    [teacherAccountId, `ci1093-${randomUUID().replaceAll('-', '')}`],
  );
  await admin.query(
    "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'creator','verified','test','migration'),($1,'educator','verified','test','migration')",
    [teacherAccountId],
  );
  await admin.query(
    "INSERT INTO workspace_memberships(account_id,workspace_id,role) VALUES($1,$2,'educator')",
    [teacherAccountId, workspaceId],
  );
  await admin.query(
    'INSERT INTO legacy_user_account_links(tenant_id,user_id,account_id,principal_id) VALUES($1,$2,$3,$4)',
    [tenantId, teacherId, teacherAccountId, teacherPrincipalId],
  );
  return { tenantId, schoolId, periodId, teacherId, teacherAccountId, teacherPrincipalId };
}

async function classroom(admin, teacher, label, linkedAccountId = null) {
  const { id: classId } = await one(
    admin,
    'INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',
    [teacher.tenantId, teacher.schoolId, teacher.periodId, `CI1093 ${label}`, teacher.teacherId],
    'fixture_class_create',
  );
  await admin.query(
    "INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner')",
    [teacher.tenantId, classId, teacher.teacherId, teacher.teacherAccountId],
  );
  const handle = randomUUID().replaceAll('-', '');
  const { id: seatId } = await one(
    admin,
    "INSERT INTO classroom_student_seats(tenant_id,classroom_id,account_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by) VALUES($1,$2,$3,'Diagnostic learner',$4,$4,true,'active',$5) RETURNING id",
    [teacher.tenantId, classId, linkedAccountId, handle, teacher.teacherId],
    'fixture_seat_create',
  );
  const { principal_id: principalId } = await one(
    admin,
    'SELECT principal_id FROM student_seat_principal($1)',
    [seatId],
    'fixture_seat_principal_create',
  );
  requireFixture(typeof principalId === 'string', 'fixture_seat_principal_missing');
  return { ...teacher, classId, seatId, principalId };
}

async function ensureLearner(admin, fixture) {
  const { id: learnerId } = await one(
    admin,
    'SELECT learning_audience_ensure_seat_identity($1) AS id',
    [fixture.seatId],
    'fixture_learner_create',
  );
  requireFixture(typeof learnerId === 'string', 'fixture_learner_missing');
  return { ...fixture, learnerId };
}

async function aiFixture(admin, runtime, phase) {
  const teacher = await phase('ai', 'teacher', async () => {
    const nonce = randomUUID().replaceAll('-', '');
    const registered = await one(
      admin,
      "SELECT * FROM auth_register_account($1,'test-only','Diagnostic teacher',$2,DATE '1990-01-01','RU','test',$3,1)",
      [
        `ci1093-ai-${nonce}@example.test`,
        `ci${nonce}`,
        createHash('sha256').update(randomUUID()).digest('hex'),
      ],
      'fixture_ai_teacher_register',
    );
    await admin.query(
      "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'educator','verified','test','admin')",
      [registered.account_id],
    );
    const context = await one(
      admin,
      'SELECT * FROM classroom_ensure_personal_teacher($1)',
      [registered.account_id],
      'fixture_ai_teacher_context',
    );
    return {
      tenantId: context.tenant_id,
      schoolId: context.school_id,
      periodId: context.academic_period_id,
      teacherId: context.user_id,
      teacherAccountId: registered.account_id,
      teacherPrincipalId: registered.principal_id,
    };
  });
  const fixture = await phase('ai', 'class_seat_identity', async () =>
    ensureLearner(admin, await classroom(admin, teacher, 'AI rating')),
  );
  await phase('ai', 'rating_policy', async () => {
    const { value } = await one(
      runtime,
      'SELECT ai_classroom_access_set($1,$2,$3::jsonb) AS value',
      [
        fixture.teacherPrincipalId,
        fixture.classId,
        JSON.stringify({
          kind: 'classroom',
          mode: 'rating',
          minimumRating: 0,
          expectedRevision: 0,
          requestId: randomUUID(),
        }),
      ],
      'fixture_ai_policy_set',
    );
    requireFixture(value?.saved === true && value.revision === 1, 'fixture_ai_policy_not_saved');
  });
  return fixture;
}

const quizPolicy = {
  attemptPolicy: { maxAttempts: 2, timeLimitSeconds: 600 },
  resultSelectionPolicy: { mode: 'best' },
  completionPolicy: { mode: 'submission' },
  latePolicy: { mode: 'allow_until_close' },
  assessmentPolicy: { mode: 'automatic' },
  feedbackReleasePolicy: { mode: 'after_close' },
};

async function quizFixture(admin, runtime, phase) {
  const fixture = await phase('quiz', 'teacher_class_linked_seat', async () => {
    const teacher = await schoolTeacher(admin, 'quiz');
    const linked = await account(admin, 'quiz-learner');
    return {
      ...(await ensureLearner(admin, await classroom(admin, teacher, 'Quiz', linked.accountId))),
      ...linked,
    };
  });
  Object.assign(
    fixture,
    await phase('quiz', 'publish_and_assign', async () => {
      const question = commandOk(
        await one(
          admin,
          `SELECT * FROM question_version_create($1,$2,'school','single_choice',
            '[{"type":"paragraph","text":"Choose an option"}]'::jsonb,
            '{"options":[{"id":"a","label":"A","secret":"ci1093-must-not-leak"},{"id":"b","label":"B"}],"answer_key":"ci1093-must-not-leak"}'::jsonb,
            '{"value":"b"}'::jsonb,1,NULL,NULL,ARRAY[]::text[])`,
          [fixture.teacherPrincipalId, fixture.tenantId],
          'fixture_quiz_question_create',
        ),
        'fixture_quiz_question_rejected',
      );
      const quiz = commandOk(
        await one(
          admin,
          "SELECT * FROM quiz_version_create($1,$2,'Diagnostic single question',NULL,$3::jsonb,1,1,6000,'immediate')",
          [
            fixture.teacherPrincipalId,
            fixture.tenantId,
            JSON.stringify([question.question_version_id]),
          ],
          'fixture_quiz_create',
        ),
        'fixture_quiz_rejected',
      );
      const activity = commandOk(
        await one(
          admin,
          "SELECT * FROM learning_activity_create($1,$2,'school','private','quiz','Diagnostic quiz',NULL,'graded',1,$3::jsonb,NULL,$4,NULL,NULL,$5)",
          [
            fixture.teacherPrincipalId,
            fixture.tenantId,
            JSON.stringify(quizPolicy),
            quiz.quiz_version_id,
            request(),
          ],
          'fixture_quiz_activity_create',
        ),
        'fixture_quiz_activity_rejected',
      );
      const published = commandOk(
        await one(
          admin,
          'SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)',
          [fixture.teacherPrincipalId, fixture.tenantId, activity.activity_id, request()],
          'fixture_quiz_publish',
        ),
        'fixture_quiz_publish_rejected',
      );
      const handout = commandOk(
        await one(
          admin,
          'SELECT * FROM classroom_quiz_assign($1,$2,$3,$4,NULL)',
          [
            fixture.teacherAccountId,
            fixture.teacherPrincipalId,
            fixture.classId,
            quiz.quiz_version_id,
          ],
          'fixture_quiz_assign',
        ),
        'fixture_quiz_assign_rejected',
      );
      const run = await inTenant(admin, fixture.tenantId, async () => {
        const created = commandOk(
          await one(
            admin,
            "SELECT * FROM activity_run_create($1,$2,$3,'direct',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'{}'::jsonb,$4)",
            [
              fixture.teacherPrincipalId,
              handout.classroom_assignment_id,
              published.activity_version_id,
              request(),
            ],
            'fixture_quiz_run_create',
          ),
          'fixture_quiz_run_rejected',
        );
        const participation = commandOk(
          await one(
            admin,
            'SELECT * FROM activity_participation_assign($1,$2,$3,NULL)',
            [fixture.teacherPrincipalId, created.activity_run_id, fixture.learnerId],
            'fixture_quiz_participation_assign',
          ),
          'fixture_quiz_participation_rejected',
        );
        return { runId: created.activity_run_id, participationId: participation.participation_id };
      });
      return {
        ...run,
        questionId: question.question_version_id,
        activityVersionId: published.activity_version_id,
        assignmentId: handout.classroom_assignment_id,
      };
    }),
  );
  fixture.attemptId = await phase('quiz', 'start_save_submit', async () => {
    const begun = commandOk(
      await one(
        runtime,
        'SELECT * FROM learning_quiz_attempt_start($1,$2,$3)',
        [fixture.principalId, fixture.participationId, request()],
        'fixture_quiz_start',
      ),
      'fixture_quiz_start_rejected',
    );
    const attemptId = begun.attempt?.attemptId;
    requireFixture(typeof attemptId === 'string', 'fixture_quiz_attempt_missing');
    commandOk(
      await one(
        runtime,
        'SELECT * FROM learning_quiz_attempt_save($1,$2,1,$3::jsonb)',
        [fixture.principalId, attemptId, JSON.stringify({ [fixture.questionId]: { value: 'b' } })],
        'fixture_quiz_save',
      ),
      'fixture_quiz_save_rejected',
    );
    const submitted = commandOk(
      await one(
        runtime,
        'SELECT * FROM learning_quiz_attempt_submit($1,$2,2,$3)',
        [fixture.principalId, attemptId, request()],
        'fixture_quiz_submit',
      ),
      'fixture_quiz_submit_rejected',
    );
    requireFixture(
      submitted.attempt &&
        !Object.hasOwn(submitted.attempt, 'result') &&
        !Object.hasOwn(submitted.attempt, 'feedback'),
      'fixture_quiz_submission_feedback_visible',
    );
    return attemptId;
  });
  return fixture;
}

const filePolicy = {
  attemptPolicy: { maxAttempts: 1 },
  resultSelectionPolicy: { mode: 'latest_accepted' },
  completionPolicy: { mode: 'accepted' },
  latePolicy: { mode: 'allow_mark_late' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'after_review' },
};

async function fileFixture(admin, runtime, phase) {
  const fixture = await phase('file', 'teacher_class_seat', async () =>
    classroom(admin, await schoolTeacher(admin, 'file'), 'File history'),
  );
  Object.assign(
    fixture,
    await phase('file', 'publish_and_direct_assign', async () => {
      const published = await inTenant(admin, fixture.tenantId, async () => {
        const activity = commandOk(
          await one(
            admin,
            "SELECT * FROM learning_activity_create($1,$2,'school','private','file','Diagnostic file','Submit a file.','graded',10,$3::jsonb,NULL,NULL,NULL,NULL,$4,NULL::jsonb,NULL::jsonb)",
            [fixture.teacherPrincipalId, fixture.tenantId, JSON.stringify(filePolicy), request()],
            'fixture_file_activity_create',
          ),
          'fixture_file_activity_rejected',
        );
        return commandOk(
          await one(
            admin,
            'SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)',
            [fixture.teacherPrincipalId, fixture.tenantId, activity.activity_id, request()],
            'fixture_file_publish',
          ),
          'fixture_file_publish_rejected',
        );
      });
      const assigned = commandOk(
        await one(
          runtime,
          "SELECT * FROM learning_direct_assignment_create($1,$2,$3,$4,NULL,'whole_class','{}'::uuid[],$5)",
          [
            fixture.teacherPrincipalId,
            fixture.tenantId,
            fixture.classId,
            published.activity_version_id,
            request(),
          ],
          'fixture_file_direct_assign',
        ),
        'fixture_file_direct_assign_rejected',
      );
      return {
        activityVersionId: published.activity_version_id,
        runId: assigned.activity_run_id,
        assignmentId: assigned.classroom_assignment_id,
      };
    }),
  );
  Object.assign(
    fixture,
    await phase('file', 'start_and_account_link', async () => {
      const begun = responseOk(
        await one(
          runtime,
          'SELECT learning_file_attempt_start($1,$2,$3) AS value',
          [fixture.principalId, fixture.runId, request()],
          'fixture_file_start',
        ),
        'fixture_file_start_rejected',
      );
      requireFixture(
        typeof begun.attempt?.id === 'string' && typeof begun.participationId === 'string',
        'fixture_file_attempt_missing',
      );
      const linked = await account(admin, 'file-learner');
      await admin.query('UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2', [
        linked.accountId,
        fixture.seatId,
      ]);
      await admin.query(
        "INSERT INTO learner_identity_links(id,tenant_id,school_id,learner_identity_id,link_kind,account_id) SELECT gen_random_uuid(),tenant_id,school_id,learner_identity_id,'account',$1 FROM activity_participations WHERE id=$2",
        [linked.accountId, begun.participationId],
      );
      const identity = await one(
        admin,
        'SELECT learner_identity_id AS id FROM activity_participations WHERE id=$1',
        [begun.participationId],
        'fixture_file_learner_missing',
      );
      return {
        ...linked,
        learnerId: identity.id,
        participationId: begun.participationId,
        attemptId: begun.attempt.id,
      };
    }),
  );
  fixture.submittedFileId = await phase('file', 'save_submit_review', async () => {
    const saved = responseOk(
      await one(
        runtime,
        "SELECT learning_file_draft_save($1,$2,$3,0,'Class.txt',8,'text/plain',$4,$5) AS value",
        [fixture.principalId, fixture.runId, fixture.attemptId, '3'.repeat(64), request()],
        'fixture_file_save',
      ),
      'fixture_file_save_rejected',
    );
    requireFixture(
      typeof saved.attempt?.file?.id === 'string' && saved.attempt.revision === 1,
      'fixture_file_saved_draft_missing',
    );
    const submitted = responseOk(
      await one(
        runtime,
        'SELECT learning_file_submission_create($1,$2,$3,1,$4) AS value',
        [fixture.principalId, fixture.runId, fixture.attemptId, request()],
        'fixture_file_submit',
      ),
      'fixture_file_submit_rejected',
    );
    requireFixture(submitted.attempt?.state === 'submitted', 'fixture_file_not_submitted');
    commandOk(
      await one(
        runtime,
        "SELECT * FROM learning_attempt_review_v2($1,$2,$3,$4,'changes_requested',NULL,'Return','Needs revision',NULL,$5)",
        [
          fixture.teacherAccountId,
          fixture.teacherPrincipalId,
          fixture.classId,
          fixture.attemptId,
          request(),
        ],
        'fixture_file_review',
      ),
      'fixture_file_review_rejected',
    );
    return saved.attempt.file.id;
  });
  Object.assign(
    fixture,
    await phase('file', 'unsubmitted_rework_and_close', async () => {
      const rework = responseOk(
        await one(
          runtime,
          'SELECT learning_file_attempt_start($1,$2,$3) AS value',
          [fixture.principalId, fixture.runId, request()],
          'fixture_file_rework_start',
        ),
        'fixture_file_rework_rejected',
      );
      requireFixture(
        typeof rework.attempt?.id === 'string' &&
          rework.attempt.id !== fixture.attemptId &&
          rework.attempt.revisionOfAttemptId === fixture.attemptId,
        'fixture_file_rework_lineage_missing',
      );
      const saved = responseOk(
        await one(
          runtime,
          "SELECT learning_file_draft_save($1,$2,$3,0,'Draft.txt',8,'text/plain',$4,$5) AS value",
          [fixture.principalId, fixture.runId, rework.attempt.id, '4'.repeat(64), request()],
          'fixture_file_rework_save',
        ),
        'fixture_file_rework_save_rejected',
      );
      requireFixture(
        typeof saved.attempt?.file?.id === 'string' && saved.attempt.state === 'in_progress',
        'fixture_file_rework_draft_missing',
      );
      const { ok } = await one(
        runtime,
        "SELECT classroom_assignment_set_status($1,$2,$3,'closed') AS ok",
        [fixture.teacherAccountId, fixture.classId, fixture.assignmentId],
        'fixture_file_assignment_close',
      );
      requireFixture(ok === true, 'fixture_file_assignment_not_closed');
      return { reworkAttemptId: rework.attempt.id, reworkFileId: saved.attempt.file.id };
    }),
  );
  return fixture;
}

function exactEvidence(rows, fixture, kind) {
  requireFixture(rows.length === 1, 'fixture_canonical_row_count');
  const value = rows[0]?.evidence;
  requireFixture(
    value?.kind === kind &&
      value.activityRunId === fixture.runId &&
      value.classroomId === fixture.classId &&
      value.classroomAssignmentId === fixture.assignmentId &&
      value.seatId === fixture.seatId &&
      value.accountId === fixture.accountId &&
      value.principalId === fixture.principalId &&
      value.learnerId === fixture.learnerId &&
      value.identityResolution === 'learner_identity' &&
      value.attempt?.id === fixture.attemptId &&
      typeof value.attempt.submittedAt === 'string',
    'fixture_canonical_identity_or_history',
  );
  return value;
}

function noQuizKeys(value) {
  const text = JSON.stringify(value);
  requireFixture(!/answerKey|answer_key|ci1093-must-not-leak/.test(text), 'fixture_quiz_key_leak');
}

function quizEvidence(rows, fixture, teacher) {
  const value = exactEvidence(rows, fixture, 'quiz');
  requireFixture(value.assignmentStatus === 'open', 'fixture_quiz_assignment_not_open');
  const revision = value.selectedRevision;
  requireFixture(
    revision?.attemptId === fixture.attemptId && typeof revision.id === 'string',
    'fixture_quiz_selected_revision_missing',
  );
  noQuizKeys(value);
  if (teacher) {
    requireFixture(
      revision.rawPoints === 1 &&
        revision.maxPoints === 1 &&
        revision.percentageBasisPoints === 10000 &&
        revision.completionValue === true,
      'fixture_quiz_teacher_result_missing',
    );
  } else {
    for (const result of [revision, value.selectedResult].filter(Boolean)) {
      requireFixture(
        ['rawPoints', 'maxPoints', 'percentageBasisPoints', 'outcome', 'completionValue'].every(
          (key) => result[key] === null,
        ),
        'fixture_quiz_learner_feedback_visible',
      );
    }
  }
}

function fileEvidence(rows, fixture) {
  const value = exactEvidence(rows, fixture, 'file');
  requireFixture(
    value.assignmentStatus === 'closed' &&
      value.attempt.state === 'closed' &&
      value.attempt.reviewDecision === 'changes_requested' &&
      !JSON.stringify(value).includes(fixture.reworkAttemptId),
    'fixture_file_submitted_history_replaced',
  );
}

export function probeCases(fixtures) {
  const { ai, quiz, file } = fixtures;
  const cases = [
    {
      label: 'ai_metrics',
      role: 'admin',
      sql: 'SELECT item FROM classroom_participant_metrics($1)',
      args: [ai.classId],
      validate(rows) {
        requireFixture(
          rows.length === 1 &&
            rows[0]?.item?.seatId === ai.seatId &&
            rows[0].item.score === 0 &&
            rows[0].item.rank === 1 &&
            rows[0].item.totalWorks === 0 &&
            Object.values(rows[0].item.sources ?? {}).length === 5 &&
            Object.values(rows[0].item.sources).every((count) => count === 0),
          'fixture_ai_metrics_not_zero',
        );
      },
    },
    {
      label: 'ai_access',
      role: 'runtime',
      sql: 'SELECT ai_access_status($1) AS value',
      args: [ai.principalId],
      validate(rows) {
        const value = rows[0]?.value;
        requireFixture(
          rows.length === 1 &&
            value?.canGenerate === true &&
            value.reason === null &&
            value.rating === 0 &&
            value.minimumRating === 0,
          'fixture_ai_equality_admission_denied',
        );
      },
    },
    {
      label: 'quiz_seat',
      role: 'runtime',
      sql: 'SELECT evidence FROM learning_canonical_evidence_for_seat($1)',
      args: [quiz.seatId],
      validate: (rows) => quizEvidence(rows, quiz, false),
    },
    {
      label: 'quiz_account',
      role: 'runtime',
      sql: 'SELECT evidence FROM learning_canonical_evidence_for_account($1)',
      args: [quiz.accountId],
      validate: (rows) => quizEvidence(rows, quiz, false),
    },
    {
      label: 'quiz_teacher',
      role: 'runtime',
      sql: 'SELECT evidence FROM learning_canonical_evidence_for_teacher($1,$2)',
      args: [quiz.teacherAccountId, quiz.classId],
      validate: (rows) => quizEvidence(rows, quiz, true),
    },
    {
      label: 'file_seat',
      role: 'runtime',
      sql: 'SELECT evidence FROM learning_canonical_evidence_for_seat($1)',
      args: [file.seatId],
      validate: (rows) => fileEvidence(rows, file),
    },
    {
      label: 'file_account',
      role: 'runtime',
      sql: 'SELECT evidence FROM learning_canonical_evidence_for_account($1)',
      args: [file.accountId],
      validate: (rows) => fileEvidence(rows, file),
    },
  ];
  return Object.freeze(
    cases.map((probe) =>
      Object.freeze({
        ...probe,
        args: Object.freeze(probe.args),
        itemCount: (rows) => rows.length,
      }),
    ),
  );
}

async function verifyLink(admin, fixture) {
  const { verified } = await one(
    admin,
    `SELECT EXISTS(
    SELECT 1 FROM classroom_student_seats seat
    JOIN accounts account ON account.id=seat.account_id AND account.status='active'
    JOIN principals actor ON actor.account_id=account.id AND actor.kind='account'
    JOIN learner_identity_links seat_link ON seat_link.seat_id=seat.id AND seat_link.link_kind='student_seat'
      AND seat_link.status='active' AND seat_link.disabled_at IS NULL
    JOIN learner_identity_links account_link ON account_link.account_id=account.id AND account_link.link_kind='account'
      AND account_link.tenant_id=seat_link.tenant_id AND account_link.school_id=seat_link.school_id
      AND account_link.learner_identity_id=seat_link.learner_identity_id
      AND account_link.status='active' AND account_link.disabled_at IS NULL
    JOIN learner_identities learner ON learner.id=seat_link.learner_identity_id AND learner.state='active'
    WHERE seat.id=$1 AND seat.classroom_id=$2 AND account.id=$3 AND actor.id=$4
      AND learner.id=$5) AS verified`,
    [
      fixture.seatId,
      fixture.classId,
      fixture.accountId,
      fixture.accountPrincipalId,
      fixture.learnerId,
    ],
    'fixture_link_check',
  );
  requireFixture(verified === true, 'fixture_account_link_unverified');
}

async function semanticChecks(admin, runtime, fixtures) {
  const { ai, quiz, file } = fixtures;
  const { valid: aiValid } = await one(
    admin,
    `SELECT EXISTS(
    SELECT 1 FROM classroom_student_seats seat
    JOIN classrooms room ON room.id=seat.classroom_id AND room.status='active'
    JOIN learner_identity_links link ON link.seat_id=seat.id AND link.status='active'
    JOIN ai_classroom_policies policy ON policy.classroom_id=room.id AND policy.mode='rating' AND policy.minimum_rating=0
    WHERE seat.id=$1 AND room.id=$2 AND seat.status='active' AND link.learner_identity_id=$3
      AND NOT EXISTS(SELECT 1 FROM classroom_assignments WHERE classroom_id=room.id)) AS valid`,
    [ai.seatId, ai.classId, ai.learnerId],
    'fixture_ai_state_check',
  );
  requireFixture(aiValid === true, 'fixture_ai_state_invalid');
  await verifyLink(admin, quiz);
  await verifyLink(admin, file);
  const { valid: quizValid } = await one(
    admin,
    `SELECT EXISTS(
    SELECT 1 FROM learning_attempts attempt
    JOIN learning_submissions submission ON submission.attempt_id=attempt.id
    JOIN assessment_results result ON result.attempt_id=attempt.id
    JOIN classroom_assignments handout ON handout.id=attempt.classroom_assignment_id
    JOIN learning_activity_versions version ON version.id=attempt.learning_activity_version_id
    WHERE attempt.id=$1 AND handout.id=$2 AND handout.status='open' AND attempt.state='closed'
      AND version.published_at IS NOT NULL AND version.publication_request_id IS NOT NULL
      AND version.policy_snapshot#>>'{feedbackReleasePolicy,mode}'='after_close'
      AND submission.payload_manifest->>'kind'='quiz'
      AND submission.payload_manifest#>>ARRAY['answers',$3,'value']='b'
      AND jsonb_array_length(submission.payload_manifest->'questions')=1
      AND submission.payload_manifest#>>'{scoring,0,correct}'='true'
      AND result.raw_points=1 AND result.max_points=1) AS valid`,
    [quiz.attemptId, quiz.assignmentId, quiz.questionId],
    'fixture_quiz_state_check',
  );
  requireFixture(quizValid === true, 'fixture_quiz_state_invalid');
  const { value: quizRead } = await one(
    runtime,
    'SELECT learning_quiz_attempt_read($1,$2) AS value',
    [quiz.principalId, quiz.attemptId],
    'fixture_quiz_read_check',
  );
  requireFixture(
    quizRead && !Object.hasOwn(quizRead, 'result') && !Object.hasOwn(quizRead, 'feedback'),
    'fixture_quiz_feedback_not_hidden',
  );
  noQuizKeys(quizRead);
  const { valid: fileValid } = await one(
    admin,
    `SELECT EXISTS(
    SELECT 1 FROM learning_attempts original
    JOIN learning_submissions submission ON submission.attempt_id=original.id
    JOIN assessment_results review ON review.attempt_id=original.id AND review.review_decision='changes_requested'
    JOIN learning_attempts rework ON rework.revision_of_attempt_id=original.id
    JOIN learning_file_drafts draft ON draft.attempt_id=rework.id AND draft.revision=1
    JOIN classroom_assignments handout ON handout.id=original.classroom_assignment_id
    WHERE original.id=$1 AND rework.id=$2 AND handout.id=$3 AND handout.status='closed'
      AND original.state='closed' AND original.submitted_at IS NOT NULL
      AND submission.payload_manifest->>'kind'='file' AND submission.payload_manifest#>>'{file,id}'=$4
      AND rework.state='in_progress' AND rework.submitted_at IS NULL AND draft.file_id=$5
      AND rework.attempt_number>original.attempt_number
      AND NOT EXISTS(SELECT 1 FROM learning_submissions later WHERE later.attempt_id=rework.id)) AS valid`,
    [
      file.attemptId,
      file.reworkAttemptId,
      file.assignmentId,
      file.submittedFileId,
      file.reworkFileId,
    ],
    'fixture_file_state_check',
  );
  requireFixture(fileValid === true, 'fixture_file_state_invalid');
  for (const principalId of [file.principalId, file.accountPrincipalId]) {
    const exact = responseOk(
      await one(
        runtime,
        'SELECT learning_file_attempt_read($1,$2) AS value',
        [principalId, file.runId],
        'fixture_file_exact_read_check',
      ),
      'fixture_file_exact_read_rejected',
    );
    requireFixture(
      exact.canStart === false &&
        exact.canEdit === false &&
        exact.attempt?.id === file.attemptId &&
        exact.attempt.file?.id === file.submittedFileId,
      'fixture_file_exact_read_not_historical',
    );
  }
  for (const probe of probeCases(fixtures)) {
    const { rows } = await (probe.role === 'admin' ? admin : runtime).query(probe.sql, probe.args);
    probe.validate(rows);
  }
  return {
    aiActiveCanonicalSeatWithoutAssignments: true,
    aiZeroRatingEqualityAllowed: true,
    quizVerifiedAccountLink: true,
    quizPublishedCorrectSubmission: true,
    quizOpenAssignmentStudentFeedbackHidden: true,
    quizTeacherResultPresent: true,
    fileVerifiedAccountLink: true,
    fileSubmittedHistoryAndUnsubmittedRework: true,
    fileClosedHistoryVisibleForSeatAndAccount: true,
    allSevenReadSemanticsChecked: true,
  };
}

async function entityCounts(admin, fixtures) {
  const classIds = [fixtures.ai.classId, fixtures.quiz.classId, fixtures.file.classId];
  const counts = await one(
    admin,
    `SELECT
    (SELECT count(*)::int FROM classrooms WHERE id=ANY($1::uuid[])) AS classrooms,
    (SELECT count(*)::int FROM classroom_student_seats WHERE classroom_id=ANY($1::uuid[])) AS seats,
    (SELECT count(*)::int FROM classroom_assignments WHERE classroom_id=ANY($1::uuid[])) AS assignments,
    (SELECT count(*)::int FROM activity_runs WHERE classroom_id=ANY($1::uuid[])) AS "activityRuns",
    (SELECT count(*)::int FROM activity_participations part JOIN activity_runs run ON run.id=part.activity_run_id WHERE run.classroom_id=ANY($1::uuid[])) AS participations,
    (SELECT count(*)::int FROM learning_attempts WHERE classroom_id=ANY($1::uuid[])) AS attempts,
    (SELECT count(*)::int FROM learning_submissions sub JOIN learning_attempts attempt ON attempt.id=sub.attempt_id WHERE attempt.classroom_id=ANY($1::uuid[])) AS submissions,
    (SELECT count(*)::int FROM assessment_results result JOIN learning_attempts attempt ON attempt.id=result.attempt_id WHERE attempt.classroom_id=ANY($1::uuid[])) AS results,
    (SELECT count(*)::int FROM learning_file_versions file JOIN learning_attempts attempt ON attempt.id=file.attempt_id WHERE attempt.classroom_id=ANY($1::uuid[])) AS "fileVersions",
    (SELECT count(*)::int FROM classroom_student_seats WHERE classroom_id=ANY($1::uuid[]) AND account_id IS NOT NULL) AS "linkedAccounts"`,
    [classIds],
    'fixture_population_count',
  );
  const expected = {
    classrooms: 3,
    seats: 3,
    assignments: 2,
    activityRuns: 2,
    participations: 2,
    attempts: 3,
    submissions: 2,
    results: 2,
    fileVersions: 2,
    linkedAccounts: 2,
  };
  requireFixture(
    Object.entries(expected).every(([key, value]) => counts[key] === value),
    'fixture_population_unexpected',
  );
  return counts;
}

export async function seedFixtures({ admin, runtime, phase }) {
  const fixtures = {
    ai: await aiFixture(admin, runtime, phase),
    quiz: await quizFixture(admin, runtime, phase),
    file: await fileFixture(admin, runtime, phase),
  };
  // No fixture data changes after this point. The probe opens new read-only
  // connections only after all setup and semantic checks have completed.
  fixtures.semanticChecks = await phase('all', 'semantic_checks', () =>
    semanticChecks(admin, runtime, fixtures),
  );
  fixtures.counts = await phase('all', 'entity_counts', () => entityCounts(admin, fixtures));
  return fixtures;
}
