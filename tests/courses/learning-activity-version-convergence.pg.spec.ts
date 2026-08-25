import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool;
let app: pg.Pool;
let owner: SeededTeacher;
let outsider: SeededTeacher;
let ownerPrincipalId: string;
let ownerAccountId: string;
let peerPrincipalId: string;
let outsiderPrincipalId: string;
let classroomId: string;
let seatId: string;

const basePolicies = {
  attemptPolicy: { maxAttempts: 1 },
  resultSelectionPolicy: { mode: 'latest' },
  completionPolicy: { mode: 'submission' },
  latePolicy: { mode: 'allow_mark_late' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'after_review' },
};
let createRequestSequence = 0;

async function createActivity(input: {
  kind: 'quiz' | 'project' | 'essay' | 'file' | 'manual';
  title: string;
  resultMode: 'ungraded' | 'completion' | 'graded';
  maxPoints?: number | null;
  moduleKey?: string | null;
  quizVersionId?: string | null;
  sourceTeacherAssignmentId?: string | null;
  policies?: Record<string, unknown>;
  requestId?: string;
}) {
  const requestId = input.requestId ?? `learning:m1:create:${++createRequestSequence}`;
  const result = await admin.query(
    `SELECT * FROM learning_activity_create(
       $1,$2,'school','private',$3,$4,$5,$6,$7,$8::jsonb,$9,$10,NULL,$11,$12
     )`,
    [
      ownerPrincipalId,
      owner.tenantId,
      input.kind,
      input.title,
      `${input.title} instructions`,
      input.resultMode,
      input.maxPoints ?? null,
      JSON.stringify(input.policies ?? basePolicies),
      input.moduleKey ?? null,
      input.quizVersionId ?? null,
      input.sourceTeacherAssignmentId ?? null,
      requestId,
    ],
  );
  return result.rows[0] as {
    result_code: string;
    activity_id: string | null;
    draft_revision: number | null;
  };
}

async function publish(activityId: string, revision: number, requestId: string) {
  const result = await admin.query(`SELECT * FROM learning_activity_publish($1,$2,$3,$4,$5)`, [
    ownerPrincipalId,
    owner.tenantId,
    activityId,
    revision,
    requestId,
  ]);
  return result.rows[0] as {
    result_code: string;
    activity_version_id: string | null;
    version_number: number | null;
    content_digest: string | null;
    reused: boolean;
  };
}

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  owner = await seedTeacher(admin, 'learning-m1-001-owner');
  outsider = await seedTeacher(admin, 'learning-m1-001-outsider');
  const ownerIdentity = await admin.query(
    `SELECT principal_id,account_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [owner.tenantId, owner.teacherId],
  );
  ownerPrincipalId = ownerIdentity.rows[0].principal_id as string;
  ownerAccountId = ownerIdentity.rows[0].account_id as string;
  const ownerWorkspace = await admin.query(
    `SELECT id FROM workspaces WHERE tenant_id=$1 ORDER BY created_at LIMIT 1`,
    [owner.tenantId],
  );
  const peerAccount = await admin.query(
    `INSERT INTO accounts (email,password_hash,birth_date,country)
     VALUES ('learning-m1-peer-' || gen_random_uuid()::text || '@test.local',
             'isolated-test-only',DATE '1990-01-01','RU') RETURNING id`,
  );
  const peerPrincipal = await admin.query(
    `INSERT INTO principals (kind,account_id) VALUES ('account',$1) RETURNING id`,
    [peerAccount.rows[0].id],
  );
  peerPrincipalId = peerPrincipal.rows[0].id as string;
  await admin.query(
    `INSERT INTO workspace_memberships (account_id,workspace_id,role)
     VALUES ($1,$2,'educator')`,
    [peerAccount.rows[0].id, ownerWorkspace.rows[0].id],
  );
  const outsiderIdentity = await admin.query(
    `SELECT principal_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [outsider.tenantId, outsider.teacherId],
  );
  outsiderPrincipalId = outsiderIdentity.rows[0].principal_id as string;
  const classroom = await admin.query(
    `INSERT INTO classrooms (tenant_id,school_id,academic_period_id,title,created_by)
     VALUES ($1,$2,$3,'M1 activity convergence',$4) RETURNING id`,
    [owner.tenantId, owner.schoolId, owner.periodId, owner.teacherId],
  );
  classroomId = classroom.rows[0].id as string;
  await admin.query(
    `INSERT INTO classroom_memberships
       (tenant_id,classroom_id,user_id,account_id,member_role)
     VALUES ($1,$2,$3,$4,'owner')`,
    [owner.tenantId, classroomId, owner.teacherId, ownerAccountId],
  );
  const seat = await admin.query(
    `INSERT INTO classroom_student_seats
       (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
        safe_mode,status,created_by)
     VALUES ($1,$2,'Learner','m1-001-learner','m1-001-learner',true,'active',$3)
     RETURNING id`,
    [owner.tenantId, classroomId, owner.teacherId],
  );
  seatId = seat.rows[0].id as string;
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('LRN-M1-001 canonical activity/version convergence', () => {
  it('publishes project v1/v2 immutably while direct runtime references remain on v1', async () => {
    const task = await admin.query(
      `INSERT INTO teacher_assignments
         (tenant_id,owner_principal_id,title,brief,module_key,visibility)
       VALUES ($1,$2,'Project v1','Build the first circuit','electronics','private')
       RETURNING id`,
      [owner.tenantId, ownerPrincipalId],
    );
    const assignment = await admin.query(
      `INSERT INTO classroom_assignments
         (tenant_id,classroom_id,assignment_id,status,created_by)
       VALUES ($1,$2,$3,'open',$4) RETURNING id`,
      [owner.tenantId, classroomId, task.rows[0].id, owner.teacherId],
    );
    const created = await createActivity({
      kind: 'project',
      title: 'ignored in favor of exact source',
      resultMode: 'graded',
      maxPoints: 20,
      moduleKey: 'electronics',
      sourceTeacherAssignmentId: task.rows[0].id,
    });
    expect(created).toMatchObject({ result_code: 'ok', draft_revision: 1 });
    const v1 = await publish(created.activity_id!, 1, 'project:publish:v1');
    expect(v1).toMatchObject({ result_code: 'ok', version_number: 1, reused: false });

    await admin.query(
      `INSERT INTO classroom_activity_versions
         (tenant_id,classroom_assignment_id,learning_activity_version_id)
       VALUES ($1,$2,$3)`,
      [owner.tenantId, assignment.rows[0].id, v1.activity_version_id],
    );
    const attempt = await admin.query(
      `INSERT INTO learning_attempts
         (tenant_id,classroom_id,classroom_assignment_id,
          learning_activity_version_id,seat_id,attempt_number,state)
       VALUES ($1,$2,$3,$4,$5,1,'in_progress') RETURNING id`,
      [owner.tenantId, classroomId, assignment.rows[0].id, v1.activity_version_id, seatId],
    );
    const submission = await admin.query(
      `INSERT INTO learning_submissions
         (tenant_id,attempt_id,payload_manifest,payload_digest,client_request_id)
       VALUES ($1,$2,'{"kind":"quiz"}'::jsonb,$3,'m1:old:submission:0001')
       RETURNING id`,
      [owner.tenantId, attempt.rows[0].id, 'a'.repeat(64)],
    );

    await admin.query(
      `UPDATE teacher_assignments SET title='Project v2',brief='Build and explain'
        WHERE id=$1`,
      [task.rows[0].id],
    );
    const draft = await admin.query(
      `SELECT * FROM learning_activity_draft_put(
         $1,$2,$3,1,'ignored','ignored','graded',20,$4::jsonb,'electronics',NULL,NULL
       )`,
      [ownerPrincipalId, owner.tenantId, created.activity_id, JSON.stringify(basePolicies)],
    );
    expect(draft.rows[0]).toMatchObject({ result_code: 'ok', draft_revision: 2 });
    const reusedForDifferentRevision = await publish(created.activity_id!, 2, 'project:publish:v1');
    expect(reusedForDifferentRevision.result_code).toBe('idempotency_conflict');
    const v2 = await publish(created.activity_id!, 2, 'project:publish:v2');
    expect(v2).toMatchObject({ result_code: 'ok', version_number: 2, reused: false });
    expect(v2.activity_version_id).not.toBe(v1.activity_version_id);

    const versions = await admin.query(
      `SELECT id,version_number,title,content_digest FROM learning_activity_versions
        WHERE activity_id=$1 ORDER BY version_number`,
      [created.activity_id],
    );
    expect(versions.rows).toEqual([
      expect.objectContaining({
        id: v1.activity_version_id,
        version_number: 1,
        title: 'Project v1',
      }),
      expect.objectContaining({
        id: v2.activity_version_id,
        version_number: 2,
        title: 'Project v2',
      }),
    ]);
    expect(versions.rows[0].content_digest).not.toBe(versions.rows[1].content_digest);
    const oldRefs = await admin.query(
      `SELECT mapping.learning_activity_version_id,attempt.learning_activity_version_id,
              submission.id AS submission_id
         FROM classroom_activity_versions mapping
         JOIN learning_attempts attempt
           ON attempt.classroom_assignment_id=mapping.classroom_assignment_id
         JOIN learning_submissions submission ON submission.attempt_id=attempt.id
        WHERE mapping.classroom_assignment_id=$1`,
      [assignment.rows[0].id],
    );
    expect(oldRefs.rows[0]).toMatchObject({
      learning_activity_version_id: v1.activity_version_id,
      submission_id: submission.rows[0].id,
    });
  });

  it('pins exact QuizVersion content while LAV owns future policy defaults', async () => {
    const question = await admin.query(
      `SELECT * FROM question_version_create(
         $1,$2,'school','boolean','[{"type":"paragraph","text":"Ready?"}]'::jsonb,
         '{}'::jsonb,'{"value":true}'::jsonb,3,'Science','10-12',ARRAY['m1'])`,
      [ownerPrincipalId, owner.tenantId],
    );
    const quiz = await admin.query(
      `SELECT * FROM quiz_version_create(
         $1,$2,'Canonical quiz source','Exact questions',$3::jsonb,2,15,7500,'after_close')`,
      [ownerPrincipalId, owner.tenantId, JSON.stringify([question.rows[0].question_version_id])],
    );
    const before = await admin.query(
      `SELECT attempt_limit,time_limit_minutes,pass_threshold_basis_points,
              feedback_release_policy,learning_activity_version_id
         FROM quiz_versions WHERE id=$1`,
      [quiz.rows[0].quiz_version_id],
    );
    const created = await createActivity({
      kind: 'quiz',
      title: 'Canonical quiz wrapper',
      resultMode: 'graded',
      maxPoints: 999,
      quizVersionId: quiz.rows[0].quiz_version_id,
    });
    const published = await publish(created.activity_id!, 1, 'quiz:publish:0001');
    const version = await admin.query(
      `SELECT canonical_kind,result_mode,max_points,quiz_version_id,policy_snapshot
         FROM learning_activity_versions WHERE id=$1`,
      [published.activity_version_id],
    );
    expect(version.rows[0]).toMatchObject({
      canonical_kind: 'quiz',
      result_mode: 'graded',
      max_points: 3,
      quiz_version_id: quiz.rows[0].quiz_version_id,
      policy_snapshot: {
        attemptPolicy: { maxAttempts: 2, timeLimitMinutes: 15 },
        assessmentPolicy: { mode: 'automatic', passThresholdBasisPoints: 7500 },
        feedbackReleasePolicy: { mode: 'after_close' },
      },
    });
    const after = await admin.query(
      `SELECT attempt_limit,time_limit_minutes,pass_threshold_basis_points,
              feedback_release_policy,learning_activity_version_id
         FROM quiz_versions WHERE id=$1`,
      [quiz.rows[0].quiz_version_id],
    );
    expect(after.rows).toEqual(before.rows);

    const quizAssignment = await admin.query(
      `SELECT * FROM classroom_quiz_assign($1,$2,$3,$4,NULL)`,
      [ownerAccountId, ownerPrincipalId, classroomId, quiz.rows[0].quiz_version_id],
    );
    const exact = await admin.query(
      `SELECT quiz_version_id FROM classroom_assignments WHERE id=$1`,
      [quizAssignment.rows[0].classroom_assignment_id],
    );
    expect(exact.rows[0].quiz_version_id).toBe(quiz.rows[0].quiz_version_id);

    const batch = await admin.query(
      `INSERT INTO learning_migration_batches
         (id,tenant_id,school_id,batch_key,operation_kind,mode,state,
          source_snapshot_digest,as_of)
       VALUES (gen_random_uuid(),$1,$2,'m1-001-compatibility-proof',
               'm0_identity_activity_convergence','manual','active',$3,now())
       RETURNING id`,
      [owner.tenantId, owner.schoolId, 'd'.repeat(64)],
    );
    const compatibilityMapping = await admin.query(
      `SELECT learning_activity_version_id
         FROM classroom_activity_versions
        WHERE classroom_assignment_id=$1`,
      [quizAssignment.rows[0].classroom_assignment_id],
    );
    expect(compatibilityMapping.rows[0].learning_activity_version_id).toBe(
      quiz.rows[0].learning_activity_version_id,
    );
    await admin.query(
      `INSERT INTO learning_migration_compatibility_activity_versions
         (tenant_id,classroom_assignment_id,learning_activity_version_id,
          source_batch_id,grading_semantics,reusable_authored_content)
       VALUES ($1,$2,$3,$4,'unknown',false)`,
      [
        owner.tenantId,
        quizAssignment.rows[0].classroom_assignment_id,
        quiz.rows[0].learning_activity_version_id,
        batch.rows[0].id,
      ],
    );
    const compatibilityRootPublish = await admin.query(
      `SELECT * FROM learning_activity_publish($1,$2,$3,1,'compatibility:publish:0001')`,
      [ownerPrincipalId, owner.tenantId, quiz.rows[0].activity_id],
    );
    expect(compatibilityRootPublish.rows[0].result_code).toBe('activity_not_found');
    const reusableList = await admin.query(`SELECT * FROM learning_activity_list($1,$2)`, [
      ownerPrincipalId,
      owner.tenantId,
    ]);
    expect(reusableList.rows.some((row) => row.activity_id === quiz.rows[0].activity_id)).toBe(
      false,
    );

    const independentlyProvenanced = await createActivity({
      kind: 'quiz',
      title: 'Independent exact QuizVersion lineage',
      resultMode: 'graded',
      maxPoints: 3,
      quizVersionId: quiz.rows[0].quiz_version_id,
    });
    expect(independentlyProvenanced.result_code).toBe('ok');
    const canonicalFromQuiz = await publish(
      independentlyProvenanced.activity_id!,
      1,
      'quiz:independent:0001',
    );
    expect(canonicalFromQuiz.activity_version_id).not.toBe(
      quiz.rows[0].learning_activity_version_id,
    );
  });

  it('enforces result modes, five-kind domain support, immutability and compatibility isolation', async () => {
    const ungraded = await createActivity({
      kind: 'essay',
      title: 'Reflection',
      resultMode: 'ungraded',
    });
    const completion = await createActivity({
      kind: 'file',
      title: 'Upload',
      resultMode: 'completion',
    });
    const graded = await createActivity({
      kind: 'manual',
      title: 'Demonstration',
      resultMode: 'graded',
      maxPoints: 7,
    });
    const invalid = await admin.query(
      `SELECT * FROM learning_activity_create(
         $1,$2,'school','private','manual','Invalid',NULL,'graded',NULL,$3::jsonb,
         NULL,NULL,NULL,NULL,'invalid:create:0001'
       )`,
      [ownerPrincipalId, owner.tenantId, JSON.stringify(basePolicies)],
    );
    expect(invalid.rows[0].result_code).toBe('invalid_result_mode');
    const published = await Promise.all([
      publish(ungraded.activity_id!, 1, 'essay:publish:0001'),
      publish(completion.activity_id!, 1, 'file:publish:0001'),
      publish(graded.activity_id!, 1, 'manual:publish:0001'),
    ]);
    const rows = await admin.query(
      `SELECT canonical_kind,result_mode,max_points FROM learning_activity_versions
        WHERE id=ANY($1::uuid[]) ORDER BY canonical_kind`,
      [published.map((entry) => entry.activity_version_id)],
    );
    expect(rows.rows).toEqual([
      { canonical_kind: 'essay', result_mode: 'ungraded', max_points: null },
      { canonical_kind: 'file', result_mode: 'completion', max_points: null },
      { canonical_kind: 'manual', result_mode: 'graded', max_points: 7 },
    ]);
    await expect(
      admin.query(`UPDATE learning_activity_versions SET title='mutated' WHERE id=$1`, [
        published[0].activity_version_id,
      ]),
    ).rejects.toThrow(/immutable/);

    const legacyRoot = await admin.query(
      `INSERT INTO learning_activities
         (tenant_id,owner_principal_id,scope_kind,activity_type,title)
       VALUES ($1,$2,'school','open_response','Legacy response') RETURNING id`,
      [owner.tenantId, ownerPrincipalId],
    );
    await admin.query(
      `INSERT INTO learning_activity_versions
         (tenant_id,activity_id,version_number,title,activity_type,max_points,
          scoring_policy,content_digest)
       VALUES ($1,$2,1,'Legacy response','open_response',1,
               '{"kind":"manual"}'::jsonb,$3)`,
      [owner.tenantId, legacyRoot.rows[0].id, 'b'.repeat(64)],
    );
    const list = await admin.query(`SELECT * FROM learning_activity_list($1,$2)`, [
      ownerPrincipalId,
      owner.tenantId,
    ]);
    expect(list.rows.some((row) => row.activity_id === legacyRoot.rows[0].id)).toBe(false);
    expect(list.rows.map((row) => row.kind)).toEqual(
      expect.arrayContaining(['essay', 'file', 'manual']),
    );
  });

  it('makes publish retry/concurrency single-row and denies cross-owner/cross-school mutation', async () => {
    const created = await createActivity({
      kind: 'manual',
      title: 'Concurrent publication',
      resultMode: 'completion',
      requestId: 'concurrent:create:0001',
    });
    const createRetry = await createActivity({
      kind: 'manual',
      title: 'Concurrent publication',
      resultMode: 'completion',
      requestId: 'concurrent:create:0001',
    });
    expect(createRetry.activity_id).toBe(created.activity_id);
    const createConflict = await createActivity({
      kind: 'manual',
      title: 'Different payload',
      resultMode: 'completion',
      requestId: 'concurrent:create:0001',
    });
    expect(createConflict.result_code).toBe('idempotency_conflict');
    const [left, right] = await Promise.all([
      publish(created.activity_id!, 1, 'concurrent:publish:a'),
      publish(created.activity_id!, 1, 'concurrent:publish:b'),
    ]);
    expect(left.activity_version_id).toBe(right.activity_version_id);
    expect([left.reused, right.reused].filter(Boolean)).toHaveLength(1);
    const retry = await publish(created.activity_id!, 1, 'concurrent:publish:a');
    expect(retry).toMatchObject({ activity_version_id: left.activity_version_id, reused: true });
    const count = await admin.query(
      `SELECT count(*)::integer AS count FROM learning_activity_versions
        WHERE activity_id=$1 AND source_draft_revision=1`,
      [created.activity_id],
    );
    expect(count.rows[0].count).toBe(1);

    const forbidden = await admin.query(
      `SELECT * FROM learning_activity_draft_put(
         $1,$2,$3,1,'Attack',NULL,'completion',NULL,$4::jsonb,NULL,NULL,NULL
       )`,
      [peerPrincipalId, owner.tenantId, created.activity_id, JSON.stringify(basePolicies)],
    );
    expect(forbidden.rows[0].result_code).toBe('activity_not_found');
    const unpublished = await createActivity({
      kind: 'manual',
      title: 'Unpublished owner draft',
      resultMode: 'ungraded',
    });
    const peerDraftRead = await admin.query(`SELECT * FROM learning_activity_get($1,$2,$3)`, [
      peerPrincipalId,
      owner.tenantId,
      unpublished.activity_id,
    ]);
    expect(peerDraftRead.rows).toEqual([]);
    const outsiderWorkspace = await admin.query(
      `SELECT id FROM workspaces WHERE tenant_id=$1 ORDER BY created_at LIMIT 1`,
      [outsider.tenantId],
    );
    await admin.query(
      `INSERT INTO workspace_memberships (account_id,workspace_id,role)
       VALUES ($1,$2,'educator') ON CONFLICT DO NOTHING`,
      [ownerAccountId, outsiderWorkspace.rows[0].id],
    );
    const wrongActiveTenantRead = await admin.query(
      `SELECT * FROM learning_activity_get($1,$2,$3)`,
      [ownerPrincipalId, outsider.tenantId, unpublished.activity_id],
    );
    expect(wrongActiveTenantRead.rows).toEqual([]);
    const wrongActiveTenantVersions = await admin.query(
      `SELECT * FROM learning_activity_version_list($1,$2,$3)`,
      [ownerPrincipalId, outsider.tenantId, created.activity_id],
    );
    expect(wrongActiveTenantVersions.rows).toEqual([]);
    const wrongActiveTenantDraft = await admin.query(
      `SELECT * FROM learning_activity_draft_put(
         $1,$2,$3,1,'Wrong tenant',NULL,'ungraded',NULL,$4::jsonb,NULL,NULL,NULL
       )`,
      [ownerPrincipalId, outsider.tenantId, unpublished.activity_id, JSON.stringify(basePolicies)],
    );
    expect(wrongActiveTenantDraft.rows[0].result_code).toBe('activity_not_found');
    const wrongActiveTenantPublish = await admin.query(
      `SELECT * FROM learning_activity_publish($1,$2,$3,1,'wrong-tenant:publish:0001')`,
      [ownerPrincipalId, outsider.tenantId, unpublished.activity_id],
    );
    expect(wrongActiveTenantPublish.rows[0].result_code).toBe('activity_not_found');
    const unpublishedVersions = await admin.query(
      `SELECT * FROM learning_activity_version_list($1,$2,$3)`,
      [ownerPrincipalId, owner.tenantId, unpublished.activity_id],
    );
    expect(unpublishedVersions.rows).toEqual([]);
    const crossSchool = await admin.query(
      `SELECT * FROM learning_activity_create(
         $1,$2,'school','private','manual','Cross school',NULL,'completion',NULL,
         $3::jsonb,NULL,NULL,NULL,NULL,'cross:create:0001'
       )`,
      [outsiderPrincipalId, owner.tenantId, JSON.stringify(basePolicies)],
    );
    expect(crossSchool.rows[0].result_code).toBe('tenant_forbidden');
    const starter = await admin.query(
      `SELECT * FROM learning_activity_create(
         $1,$2,'school','private','project','Starter attack',NULL,'completion',NULL,
         $3::jsonb,'electronics',NULL,$4,NULL,'starter:create:0001'
       )`,
      [
        ownerPrincipalId,
        owner.tenantId,
        JSON.stringify(basePolicies),
        '123e4567-e89b-42d3-a456-426614174099',
      ],
    );
    expect(starter.rows[0].result_code).toBe('starter_project_unprovenanced');

    const invalidPolicy = await admin.query(
      `SELECT * FROM learning_activity_create(
         $1,$2,'school','private','manual','Invalid policy',NULL,'completion',NULL,
         $3::jsonb,NULL,NULL,NULL,NULL,'invalid-policy:create:0001'
       )`,
      [ownerPrincipalId, owner.tenantId, JSON.stringify({ ...basePolicies, attemptPolicy: 7 })],
    );
    expect(invalidPolicy.rows[0].result_code).toBe('invalid_draft');

    await expect(app.query(`SELECT * FROM learning_activities LIMIT 1`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.query(`SELECT * FROM learning_activity_versions LIMIT 1`)).rejects.toThrow(
      /permission denied/,
    );
    const runtimeRead = await app.query(`SELECT * FROM learning_activity_list($1,$2)`, [
      ownerPrincipalId,
      owner.tenantId,
    ]);
    expect(runtimeRead.rows.some((row) => row.activity_id === created.activity_id)).toBe(true);
  });

  it('leaves direct, course-generated, quiz and Attempt/Submission source references unchanged', async () => {
    const task = await admin.query(
      `INSERT INTO teacher_assignments
         (tenant_id,owner_principal_id,title,brief,module_key,visibility)
       VALUES ($1,$2,'Reference task','Reference','electronics','private') RETURNING id`,
      [owner.tenantId, ownerPrincipalId],
    );
    const direct = await admin.query(
      `INSERT INTO classroom_assignments
         (tenant_id,classroom_id,assignment_id,status,created_by)
       VALUES ($1,$2,$3,'open',$4) RETURNING id,assignment_id,course_run_id,quiz_version_id`,
      [owner.tenantId, classroomId, task.rows[0].id, owner.teacherId],
    );
    const course = await admin.query(
      `INSERT INTO courses (tenant_id,owner_principal_id,title,visibility)
       VALUES ($1,$2,'Reference course','private') RETURNING id`,
      [owner.tenantId, ownerPrincipalId],
    );
    const courseVersion = await admin.query(
      `INSERT INTO course_versions
         (tenant_id,course_id,version_number,title,outline,content_hash,
          published_by_principal_id)
       VALUES ($1,$2,1,'Reference course','{"sections":[]}'::jsonb,$3,$4) RETURNING id`,
      [owner.tenantId, course.rows[0].id, 'c'.repeat(32), ownerPrincipalId],
    );
    const courseRun = await admin.query(
      `INSERT INTO classroom_course_runs
         (tenant_id,classroom_id,course_id,course_version_id,title,version_number,
          assigned_by_principal_id)
       VALUES ($1,$2,$3,$4,'Reference run',1,$5) RETURNING id`,
      [owner.tenantId, classroomId, course.rows[0].id, courseVersion.rows[0].id, ownerPrincipalId],
    );
    const courseAssignment = await admin.query(
      `INSERT INTO classroom_assignments
         (tenant_id,classroom_id,course_run_id,status,created_by)
       VALUES ($1,$2,$3,'open',$4) RETURNING id,assignment_id,course_run_id,quiz_version_id`,
      [owner.tenantId, classroomId, courseRun.rows[0].id, owner.teacherId],
    );
    const before = [direct.rows[0], courseAssignment.rows[0]];
    const activity = await createActivity({
      kind: 'project',
      title: 'Future canonical project',
      resultMode: 'completion',
      moduleKey: 'electronics',
    });
    await publish(activity.activity_id!, 1, 'reference:publish:0001');
    const after = await admin.query(
      `SELECT id,assignment_id,course_run_id,quiz_version_id
         FROM classroom_assignments WHERE id=ANY($1::uuid[]) ORDER BY id`,
      [[direct.rows[0].id, courseAssignment.rows[0].id].sort()],
    );
    expect(after.rows).toEqual(
      before
        .map((row) => ({
          id: row.id,
          assignment_id: row.assignment_id,
          course_run_id: row.course_run_id,
          quiz_version_id: row.quiz_version_id,
        }))
        .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    );
  });
});
