import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, type SeededTeacher } from '../portal/helpers';

const AS_OF = '2026-08-24T12:00:00.000Z';
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);

let admin: pg.Pool;
let teacher: SeededTeacher;
let accountId: string;
let teacherPrincipalId: string;
let classroomId: string;

async function createSeat(
  label: string,
  options: {
    accountId?: string;
    classroomId?: string;
    status?: 'issued' | 'active' | 'suspended' | 'removed';
  } = {},
): Promise<string> {
  const handle = `m006-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`;
  const seat = await admin.query(
    `INSERT INTO classroom_student_seats
       (tenant_id, classroom_id, display_label, login_handle,
        normalized_login_handle, safe_mode, status, created_by, account_id)
     VALUES ($1,$2,$3,$4,$4,true,$5,$6,$7) RETURNING id`,
    [
      teacher.tenantId,
      options.classroomId ?? classroomId,
      label,
      handle,
      options.status ?? 'active',
      teacher.teacherId,
      options.accountId ?? null,
    ],
  );
  return seat.rows[0].id as string;
}

async function createAssignment(title: string): Promise<string> {
  const task = await admin.query(
    `INSERT INTO teacher_assignments
       (tenant_id, owner_principal_id, title, brief, module_key, visibility)
     VALUES ($1,$2,$3,'Exact persisted task','electronics','private') RETURNING id`,
    [teacher.tenantId, teacherPrincipalId, title],
  );
  const assignment = await admin.query(
    `INSERT INTO classroom_assignments
       (tenant_id, classroom_id, assignment_id, due_at, status, created_by, created_at)
     VALUES ($1,$2,$3,'2026-08-24T11:00:00.000Z','open',$4,'2026-08-24T09:00:00.000Z')
     RETURNING id`,
    [teacher.tenantId, classroomId, task.rows[0].id, teacher.teacherId],
  );
  return assignment.rows[0].id as string;
}

async function createLegacyWork(input: {
  seatId: string;
  assignmentId: string;
  withExactVersion: boolean;
}): Promise<{ workId: string; projectId: string }> {
  const principal = await admin.query(`SELECT principal_id FROM student_seat_principal($1)`, [
    input.seatId,
  ]);
  const project = await admin.query(
    `INSERT INTO projects
       (tenant_id, project_scope, classroom_id, module_key, title,
        owner_principal_id)
     VALUES ($1,'classroom',$2,'electronics','Legacy exact project',$3) RETURNING id`,
    [teacher.tenantId, classroomId, principal.rows[0].principal_id],
  );
  const projectId = project.rows[0].id as string;
  if (input.withExactVersion) {
    await admin.query(
      `INSERT INTO project_versions
         (tenant_id, project_id, version_no, document_json, label,
          created_by_principal_id, created_at)
       VALUES ($1,$2,1,'{"schemaVersion":1,"components":[]}'::jsonb,
               'Exact legacy checkpoint',$3,'2026-08-24T10:30:00.000Z')`,
      [teacher.tenantId, projectId, principal.rows[0].principal_id],
    );
  }
  const work = await admin.query(
    `INSERT INTO classroom_assignment_work
       (tenant_id, assignment_id, seat_id, project_id, started_at, submitted_at)
     VALUES ($1,$2,$3,$4,'2026-08-24T10:00:00.000Z','2026-08-24T11:30:00.000Z')
     RETURNING id`,
    [teacher.tenantId, input.assignmentId, input.seatId, projectId],
  );
  return { workId: work.rows[0].id as string, projectId };
}

async function apply(batchKey: string, digest = DIGEST_A): Promise<Record<string, any>> {
  return applyForSchool(batchKey, teacher.schoolId, digest);
}

async function applyForSchool(
  batchKey: string,
  schoolId: string,
  digest = DIGEST_A,
): Promise<Record<string, any>> {
  const client = await admin.connect();
  try {
    await client.query(
      `SELECT set_config('app.learning_m0_006_environment', 'isolated_test', false)`,
    );
    const result = await client.query(
      `SELECT learning_m0_convergence_apply($1,$2,$3,$4) AS result`,
      [batchKey, schoolId, digest, AS_OF],
    );
    return result.rows[0].result as Record<string, any>;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  admin = testAdminPool();
  teacher = await seedTeacher(admin, 'learning-m0-006');
  const identity = await admin.query(
    `SELECT principal_id, account_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [teacher.tenantId, teacher.teacherId],
  );
  teacherPrincipalId = identity.rows[0].principal_id as string;
  accountId = identity.rows[0].account_id as string;
  const classroom = await admin.query(
    `INSERT INTO classrooms
       (tenant_id, school_id, academic_period_id, title, created_by)
     VALUES ($1,$2,$3,'LRN M0-006',$4) RETURNING id`,
    [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
  );
  classroomId = classroom.rows[0].id as string;
});

afterAll(async () => {
  await admin.end();
});

describe('LRN-M0-006 additive learner convergence', () => {
  it('seeds email-free identity, preserves it after Account linking, and merges classes only within one school', async () => {
    const firstSeat = await createSeat('Email free learner');
    const first = await apply('lrm0-006-identity-seed');
    expect(first.created.learnerIdentities).toBeGreaterThan(0);
    const before = await admin.query(
      `SELECT learner_identity_id FROM learner_identity_links WHERE seat_id=$1`,
      [firstSeat],
    );

    await admin.query(`UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2`, [
      accountId,
      firstSeat,
    ]);
    const secondClass = await admin.query(
      `INSERT INTO classrooms
         (tenant_id, school_id, academic_period_id, title, created_by)
       VALUES ($1,$2,$3,'LRN M0-006 second class',$4) RETURNING id`,
      [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
    );
    const secondSeat = await admin.query(
      `INSERT INTO classroom_student_seats
         (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
          safe_mode,status,created_by,account_id)
       VALUES ($1,$2,'Same account','same-account-m0-006','same-account-m0-006',
               true,'active',$3,$4) RETURNING id`,
      [teacher.tenantId, secondClass.rows[0].id, teacher.teacherId, accountId],
    );
    await apply('lrm0-006-account-link', DIGEST_B);
    const links = await admin.query(
      `SELECT learner_identity_id FROM learner_identity_links
        WHERE seat_id IN ($1,$2) ORDER BY seat_id`,
      [firstSeat, secondSeat.rows[0].id],
    );
    expect(new Set(links.rows.map((row) => row.learner_identity_id)).size).toBe(1);
    expect(links.rows[0].learner_identity_id).toBe(before.rows[0].learner_identity_id);
  });

  it('keeps the same Account split across schools and preserves suspended/removed seat mappings', async () => {
    const other = await seedTeacher(admin, 'learning-m0-006-other-school');
    const otherClass = await admin.query(
      `INSERT INTO classrooms
         (tenant_id,school_id,academic_period_id,title,created_by)
       VALUES ($1,$2,$3,'Other school',$4) RETURNING id`,
      [other.tenantId, other.schoolId, other.periodId, other.teacherId],
    );
    const crossSeat = await admin.query(
      `INSERT INTO classroom_student_seats
         (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
          safe_mode,status,created_by,account_id)
       VALUES ($1,$2,'Cross school','cross-school-m0-006','cross-school-m0-006',
               true,'active',$3,$4) RETURNING id`,
      [other.tenantId, otherClass.rows[0].id, other.teacherId, accountId],
    );
    await applyForSchool('lrm0-006-cross-school', other.schoolId);
    const identities = await admin.query(
      `SELECT school_id,learner_identity_id FROM learner_identity_links
        WHERE account_id=$1 ORDER BY school_id`,
      [accountId],
    );
    expect(identities.rows).toHaveLength(2);
    expect(new Set(identities.rows.map((row) => row.learner_identity_id)).size).toBe(2);
    expect(crossSeat.rows[0].id).toBeTruthy();

    const suspended = await createSeat('Suspended learner', { status: 'suspended' });
    const removed = await createSeat('Removed learner', { status: 'removed' });
    await apply('lrm0-006-lifecycle', 'c'.repeat(64));
    const lifecycleLinks = await admin.query(
      `SELECT seat_id,status FROM learner_identity_links WHERE seat_id IN ($1,$2)`,
      [suspended, removed],
    );
    expect(lifecycleLinks.rows).toHaveLength(2);
    expect(lifecycleLinks.rows.every((row) => row.status === 'active')).toBe(true);
  });

  it('marks generated versions as ungraded migration compatibility content', async () => {
    const assignment = await createAssignment('Compatibility snapshot');
    await apply('lrm0-006-compatibility-content', '8'.repeat(64));
    const version = await admin.query(
      `SELECT activity.max_points, activity.scoring_policy,
              compatibility.grading_semantics,
              compatibility.reusable_authored_content
         FROM classroom_activity_versions mapping
         JOIN learning_activity_versions activity
           ON activity.id=mapping.learning_activity_version_id
         JOIN learning_migration_compatibility_activity_versions compatibility
           ON compatibility.classroom_assignment_id=mapping.classroom_assignment_id
        WHERE mapping.classroom_assignment_id=$1`,
      [assignment],
    );
    expect(version.rows).toHaveLength(1);
    expect(version.rows[0]).toMatchObject({
      max_points: 1,
      grading_semantics: 'unknown',
      reusable_authored_content: false,
    });
    expect(version.rows[0].scoring_policy).toEqual({
      kind: 'migration_compatibility',
      gradingSemantics: 'unknown',
      reusableAuthoredContent: false,
    });
    expect(version.rows[0].scoring_policy).not.toHaveProperty('passThreshold');
  });

  it('rejects direct convergence calls without isolated-test attestation', async () => {
    const client = await admin.connect();
    try {
      await client.query(`RESET app.learning_m0_006_environment`);
      await expect(
        client.query(`SELECT learning_m0_convergence_apply($1,$2,$3,$4)`, [
          'lrm0-006-no-attestation',
          teacher.schoolId,
          '7'.repeat(64),
          AS_OF,
        ]),
      ).rejects.toThrow(/attested isolated test database/);
    } finally {
      client.release();
    }
  });

  it('does not infer submission linkage from ProjectVersion timestamps', async () => {
    const exactSeat = await createSeat('Exact evidence learner');
    const exactAssignment = await createAssignment('Exact backfill assignment');
    const exact = await createLegacyWork({
      seatId: exactSeat,
      assignmentId: exactAssignment,
      withExactVersion: true,
    });
    const unresolvedSeat = await createSeat('Unresolved evidence learner');
    const unresolvedAssignment = await createAssignment('Unresolved assignment');
    const unresolved = await createLegacyWork({
      seatId: unresolvedSeat,
      assignmentId: unresolvedAssignment,
      withExactVersion: false,
    });
    await admin.query(
      `INSERT INTO project_feedback
         (tenant_id,project_id,seat_id,author_principal_id,badge,comment)
       VALUES ($1,$2,$3,$4,'good','Legacy metadata only')`,
      [teacher.tenantId, unresolved.projectId, unresolvedSeat, teacherPrincipalId],
    );

    const first = await apply('lrm0-006-exact-backfill', 'd'.repeat(64));
    expect(first.created.attempts).toBe(0);
    expect(first.created.submissions).toBe(0);
    expect(first.classified.gradeConversions).toBe(0);
    const exactRows = await admin.query(
      `SELECT attempt.state,attempt.learner_identity_id,submission.project_version_id,
              submission.submitted_at,work.submitted_at AS legacy_submitted_at
         FROM learning_attempts attempt
         JOIN learning_submissions submission ON submission.attempt_id=attempt.id
         JOIN classroom_assignment_work work
           ON work.assignment_id=attempt.classroom_assignment_id AND work.seat_id=attempt.seat_id
        WHERE work.id=$1`,
      [exact.workId],
    );
    expect(exactRows.rows).toHaveLength(0);
    const unresolvedRows = await admin.query(
      `SELECT count(*)::integer AS attempts FROM learning_attempts attempt
        WHERE attempt.classroom_assignment_id=$1 AND attempt.seat_id=$2`,
      [unresolvedAssignment, unresolvedSeat],
    );
    expect(unresolvedRows.rows[0].attempts).toBe(0);
    const exactDiagnostic = await admin.query(
      `SELECT source_evidence FROM learning_migration_artifacts
        WHERE source_table='classroom_assignment_work' AND source_id=$1
          AND artifact_kind='legacy_unresolved'`,
      [exact.workId],
    );
    expect(exactDiagnostic.rows).toHaveLength(1);
    const diagnostic = await admin.query(
      `SELECT source_evidence FROM learning_migration_artifacts
        WHERE source_table='classroom_assignment_work' AND source_id=$1
          AND artifact_kind='legacy_unresolved'`,
      [unresolved.workId],
    );
    expect(diagnostic.rows).toHaveLength(1);
    const grades = await admin.query(
      `SELECT count(*)::integer AS results FROM assessment_results result
        JOIN learning_attempts attempt ON attempt.id=result.attempt_id
       WHERE attempt.classroom_assignment_id IN ($1,$2)`,
      [exactAssignment, unresolvedAssignment],
    );
    expect(grades.rows[0].results).toBe(0);
  });

  it('does not infer cross-tenant submission linkage from a timestamped ProjectVersion', async () => {
    const remote = await seedTeacher(admin, 'learning-m0-006-cross-tenant-evidence');
    const remoteClass = await admin.query(
      `INSERT INTO classrooms
         (tenant_id,school_id,academic_period_id,title,created_by)
       VALUES ($1,$2,$3,'Cross tenant evidence class',$4) RETURNING id`,
      [remote.tenantId, remote.schoolId, remote.periodId, remote.teacherId],
    );
    const seat = await admin.query(
      `INSERT INTO classroom_student_seats
         (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
          safe_mode,status,created_by,account_id)
       VALUES ($1,$2,'Account learner','cross-tenant-evidence','cross-tenant-evidence',
               true,'active',$3,$4) RETURNING id`,
      [remote.tenantId, remoteClass.rows[0].id, remote.teacherId, accountId],
    );
    const remoteTeacherPrincipal = await admin.query(
      `SELECT principal_id FROM legacy_user_account_links WHERE user_id=$1`,
      [remote.teacherId],
    );
    const task = await admin.query(
      `INSERT INTO teacher_assignments
         (tenant_id,owner_principal_id,title,brief,module_key,visibility)
       VALUES ($1,$2,'Cross tenant exact','Exact persisted task','electronics','private')
       RETURNING id`,
      [remote.tenantId, remoteTeacherPrincipal.rows[0].principal_id],
    );
    const assignment = await admin.query(
      `INSERT INTO classroom_assignments
         (tenant_id,classroom_id,assignment_id,due_at,status,created_by,created_at)
       VALUES ($1,$2,$3,'2026-08-24T11:00:00.000Z','open',$4,
               '2026-08-24T09:00:00.000Z') RETURNING id`,
      [remote.tenantId, remoteClass.rows[0].id, task.rows[0].id, remote.teacherId],
    );
    const accountPrincipal = await admin.query(
      `SELECT id FROM principals WHERE account_id=$1 AND kind='account' ORDER BY created_at LIMIT 1`,
      [accountId],
    );
    const project = await admin.query(
      `INSERT INTO projects
         (tenant_id,project_scope,module_key,title,owner_principal_id)
       VALUES ($1,'personal','electronics','Home tenant evidence',$2) RETURNING id`,
      [teacher.tenantId, accountPrincipal.rows[0].id],
    );
    const version = await admin.query(
      `INSERT INTO project_versions
         (tenant_id,project_id,version_no,document_json,label,
          created_by_principal_id,created_at)
       VALUES ($1,$2,1,'{"schemaVersion":1,"components":[]}'::jsonb,
               'Cross tenant exact checkpoint',$3,'2026-08-24T10:30:00.000Z')
       RETURNING id`,
      [teacher.tenantId, project.rows[0].id, accountPrincipal.rows[0].id],
    );
    await admin.query(
      `INSERT INTO classroom_assignment_work
         (tenant_id,assignment_id,seat_id,project_id,started_at,submitted_at)
       VALUES ($1,$2,$3,$4,'2026-08-24T10:00:00.000Z','2026-08-24T11:30:00.000Z')`,
      [remote.tenantId, assignment.rows[0].id, seat.rows[0].id, project.rows[0].id],
    );

    const result = await applyForSchool(
      'lrm0-006-cross-tenant-exact',
      remote.schoolId,
      '9'.repeat(64),
    );
    expect(result.created.attempts).toBe(0);
    expect(result.created.submissions).toBe(0);
    const submission = await admin.query(
      `SELECT submission.tenant_id,submission.project_tenant_id,
              submission.project_id,submission.project_version_id
         FROM learning_submissions submission
         JOIN learning_attempts attempt ON attempt.id=submission.attempt_id
        WHERE attempt.classroom_assignment_id=$1 AND attempt.seat_id=$2`,
      [assignment.rows[0].id, seat.rows[0].id],
    );
    expect(submission.rows).toHaveLength(0);
    const diagnostic = await admin.query(
      `SELECT source_evidence FROM learning_migration_artifacts
        WHERE source_table='classroom_assignment_work'
          AND source_id=(SELECT id FROM classroom_assignment_work
                          WHERE assignment_id=$1 AND seat_id=$2)
          AND artifact_kind='legacy_unresolved'`,
      [assignment.rows[0].id, seat.rows[0].id],
    );
    expect(diagnostic.rows).toHaveLength(1);
    expect(version.rows[0].id).toBeTruthy();
  });

  it('is idempotent and concurrent-safe, rolls back only batch authority, and reruns deterministically', async () => {
    const seat = await createSeat('Rollback learner');
    const assignment = await createAssignment('Rollback assignment');
    const first = await apply('lrm0-006-rollback', 'e'.repeat(64));
    const firstLearner = await admin.query(
      `SELECT learner_identity_id FROM learner_identity_links WHERE seat_id=$1`,
      [seat],
    );
    const second = await apply('lrm0-006-rollback', 'e'.repeat(64));
    expect(Object.values(second.created).every((value) => value === 0)).toBe(true);

    const concurrentKey = 'lrm0-006-concurrent';
    const [left, right] = await Promise.all([
      apply(concurrentKey, 'f'.repeat(64)),
      apply(concurrentKey, 'f'.repeat(64)),
    ]);
    const concurrentCreates = [left, right].map((result) =>
      Object.values(result.created as Record<string, number>).reduce(
        (sum, value) => sum + value,
        0,
      ),
    );
    expect(concurrentCreates.filter((count) => count === 0).length).toBeGreaterThanOrEqual(1);

    const rollback = await admin.query(`SELECT learning_m0_convergence_rollback($1) AS result`, [
      first.batchId,
    ]);
    expect(rollback.rows[0].result.immutableAttemptsDeleted).toBe(0);
    expect(rollback.rows[0].result.immutableSubmissionsDeleted).toBe(0);
    const legacyStillThere = await admin.query(
      `SELECT count(*)::integer AS assignments FROM classroom_assignments WHERE id=$1`,
      [assignment],
    );
    expect(legacyStillThere.rows[0].assignments).toBe(1);

    await apply('lrm0-006-rollback', 'e'.repeat(64));
    const rerunLearner = await admin.query(
      `SELECT learner_identity_id FROM learner_identity_links WHERE seat_id=$1`,
      [seat],
    );
    expect(rerunLearner.rows[0].learner_identity_id).toBe(firstLearner.rows[0].learner_identity_id);
  });

  it('does not guess an Account merge when existing seat identities conflict', async () => {
    const ambiguousClasses = await admin.query(
      `INSERT INTO classrooms
         (tenant_id,school_id,academic_period_id,title,created_by)
       VALUES ($1,$2,$3,'Ambiguous class A',$4),
              ($1,$2,$3,'Ambiguous class B',$4) RETURNING id`,
      [teacher.tenantId, teacher.schoolId, teacher.periodId, teacher.teacherId],
    );
    const first = await createSeat('Ambiguous A', {
      classroomId: ambiguousClasses.rows[0].id,
    });
    const second = await createSeat('Ambiguous B', {
      classroomId: ambiguousClasses.rows[1].id,
    });
    await apply('lrm0-006-ambiguous-seed', '1'.repeat(64));
    await admin.query(`UPDATE classroom_student_seats SET account_id=$1 WHERE id IN ($2,$3)`, [
      accountId,
      first,
      second,
    ]);
    await apply('lrm0-006-ambiguous-link', '2'.repeat(64));
    const seatLinks = await admin.query(
      `SELECT learner_identity_id FROM learner_identity_links WHERE seat_id IN ($1,$2)`,
      [first, second],
    );
    expect(new Set(seatLinks.rows.map((row) => row.learner_identity_id)).size).toBe(2);
    const accountLinks = await admin.query(
      `SELECT count(*)::integer AS links FROM learner_identity_links
        WHERE school_id=$1 AND account_id=$2`,
      [teacher.schoolId, accountId],
    );
    // A previously proven Account link may exist from the non-ambiguous fixture;
    // the conflicting seat identities are not rewritten to it.
    expect(accountLinks.rows[0].links).toBeLessThanOrEqual(1);
  });
});
