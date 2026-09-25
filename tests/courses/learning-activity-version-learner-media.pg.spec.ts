import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool;
let app: pg.Pool;
let owner: SeededTeacher;
let ownerPrincipalId: string;
let ownerAccountId: string;
let sequence = 0;

const policies = {
  attemptPolicy: { maxAttempts: 1 },
  resultSelectionPolicy: { mode: 'latest' },
  completionPolicy: { mode: 'submission' },
  latePolicy: { mode: 'allow_mark_late' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'after_review' },
};

async function inTenant<T>(callback: (client: pg.PoolClient) => Promise<T>) {
  const client = await app.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id',$1,true)`, [owner.tenantId]);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function classroom() {
  const created = await admin.query(
    `INSERT INTO classrooms (tenant_id,school_id,academic_period_id,title,created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [owner.tenantId, owner.schoolId, owner.periodId, `UX1A3 class ${++sequence}`, owner.teacherId],
  );
  await admin.query(
    `INSERT INTO classroom_memberships
       (tenant_id,classroom_id,user_id,account_id,member_role)
     VALUES ($1,$2,$3,$4,'owner')`,
    [owner.tenantId, created.rows[0].id, owner.teacherId, ownerAccountId],
  );
  return created.rows[0].id as string;
}

async function accountSeat(classroomId: string, label: string) {
  const account = await admin.query(
    `INSERT INTO accounts (email,password_hash,birth_date,country)
     VALUES ($1,'isolated-test-only',DATE '1990-01-01','RU') RETURNING id`,
    [`ux1a3-${++sequence}@test.local`],
  );
  await admin.query(`INSERT INTO principals (kind,account_id) VALUES ('account',$1)`, [
    account.rows[0].id,
  ]);
  const seat = await admin.query(
    `INSERT INTO classroom_student_seats
       (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
        safe_mode,status,created_by,account_id)
     VALUES ($1,$2,$3,$4,$4,true,'active',$5,$6) RETURNING id`,
    [
      owner.tenantId,
      classroomId,
      label,
      `ux1a3-${++sequence}`,
      owner.teacherId,
      account.rows[0].id,
    ],
  );
  return { accountId: account.rows[0].id as string, seatId: seat.rows[0].id as string };
}

async function studentSeat(classroomId: string, label: string) {
  const seat = await admin.query(
    `INSERT INTO classroom_student_seats
       (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
        safe_mode,status,created_by)
     VALUES ($1,$2,$3,$4,$4,true,'active',$5) RETURNING id`,
    [owner.tenantId, classroomId, label, `ux1a3-seat-${++sequence}`, owner.teacherId],
  );
  return seat.rows[0].id as string;
}

async function createActivity(title: string) {
  const created = await admin.query(
    `SELECT * FROM learning_activity_create(
       $1,$2,'school','private','project',$3,'Build the exact shown circuit',
       'completion',NULL,$4::jsonb,'electronics',NULL,NULL,NULL,$5
     )`,
    [
      ownerPrincipalId,
      owner.tenantId,
      title,
      JSON.stringify(policies),
      `ux1a3:create:${++sequence}:0001`,
    ],
  );
  expect(created.rows[0]).toMatchObject({ result_code: 'ok', draft_revision: 1 });
  return created.rows[0].activity_id as string;
}

async function publish(activityId: string, revision: number, requestId: string) {
  const result = await admin.query(`SELECT * FROM learning_activity_publish($1,$2,$3,$4,$5)`, [
    ownerPrincipalId,
    owner.tenantId,
    activityId,
    revision,
    requestId,
  ]);
  expect(result.rows[0].result_code).toBe('ok');
  return result.rows[0] as {
    activity_version_id: string;
    version_number: number;
    content_digest: string;
  };
}

async function assign(classroomId: string, versionId: string, seatIds: string[]) {
  return inTenant(async (client) => {
    const result = await client.query(
      `SELECT * FROM learning_direct_assignment_create(
       $1,$2,$3,$4,'2027-09-30T20:59:00Z','named_learners',$5::uuid[],$6)`,
      [
        ownerPrincipalId,
        owner.tenantId,
        classroomId,
        versionId,
        seatIds,
        `ux1a3:assign:${++sequence}:0001`,
      ],
    );
    expect(result.rows[0].result_code).toBe('ok');
    return result.rows[0].classroom_assignment_id as string;
  });
}

async function readerRow(seatId: string, assignmentId: string) {
  const result = await admin.query(
    `SELECT id,sample_image FROM classroom_assignments_for_seat($1) WHERE id=$2`,
    [seatId, assignmentId],
  );
  return result.rows[0] as { id: string; sample_image: string | null } | undefined;
}

async function viewerSample(input: {
  versionId: string;
  accountId?: string | null;
  seatId?: string | null;
}) {
  return inTenant((client) =>
    client.query(
      `SELECT sample_bytes,sample_content_type,content_hash
         FROM learning_activity_version_sample_for_viewer($1,$2,$3,$4)`,
      [input.versionId, owner.tenantId, input.accountId ?? null, input.seatId ?? null],
    ),
  );
}

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  owner = await seedTeacher(admin, 'ux1a3-version-learner-media');
  const identity = await admin.query(
    `SELECT account_id,principal_id
       FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [owner.tenantId, owner.teacherId],
  );
  ownerAccountId = identity.rows[0].account_id as string;
  ownerPrincipalId = identity.rows[0].principal_id as string;
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('UX1A3 learner exact published-version sample', () => {
  it('pins A to v1 and B to v2 for assigned learners while excluded viewers are denied', async () => {
    const legacyBefore = await admin.query(
      'SELECT count(*)::integer AS count FROM teacher_assignments WHERE tenant_id=$1',
      [owner.tenantId],
    );

    const activityId = await createActivity('Learner exact A/B');
    const imageA = Buffer.from('ux1a3-exact-image-A');
    const imageB = Buffer.from('ux1a3-exact-image-B');

    const uploadA = await admin.query(
      `SELECT * FROM learning_activity_draft_sample_set($1,$2,$3,1,$4,'image/png')`,
      [ownerPrincipalId, owner.tenantId, activityId, imageA],
    );
    expect(uploadA.rows[0]).toMatchObject({ result_code: 'ok', draft_revision: 2 });
    const v1 = await publish(activityId, 2, 'ux1a3:publish:v1:0001');

    const classV1 = await classroom();
    const assigned = await accountSeat(classV1, 'Assigned account learner');
    const excluded = await accountSeat(classV1, 'Excluded account learner');
    const assignmentV1 = await assign(classV1, v1.activity_version_id, [assigned.seatId]);

    const seatReaderV1 = await readerRow(assigned.seatId, assignmentV1);
    expect(seatReaderV1?.sample_image).toBe(
      `/api/assignments/activity-versions/${v1.activity_version_id}/sample`,
    );
    const accountReaderV1 = await admin.query(
      `SELECT id,sample_image
         FROM classroom_assignments_for_account($1)
        WHERE id=$2 AND seat_id=$3`,
      [assigned.accountId, assignmentV1, assigned.seatId],
    );
    expect(accountReaderV1.rows[0].sample_image).toBe(seatReaderV1?.sample_image);

    const seatBytesA = await viewerSample({
      versionId: v1.activity_version_id,
      seatId: assigned.seatId,
    });
    expect(seatBytesA.rows).toHaveLength(1);
    expect(Buffer.compare(seatBytesA.rows[0].sample_bytes as Buffer, imageA)).toBe(0);
    const accountBytesA = await viewerSample({
      versionId: v1.activity_version_id,
      accountId: assigned.accountId,
    });
    expect(accountBytesA.rows).toHaveLength(1);
    expect(Buffer.compare(accountBytesA.rows[0].sample_bytes as Buffer, imageA)).toBe(0);

    const excludedSeat = await viewerSample({
      versionId: v1.activity_version_id,
      seatId: excluded.seatId,
    });
    expect(excludedSeat.rows).toEqual([]);
    const foreignAccount = await viewerSample({
      versionId: v1.activity_version_id,
      accountId: excluded.accountId,
    });
    expect(foreignAccount.rows).toEqual([]);

    const uploadB = await admin.query(
      `SELECT * FROM learning_activity_draft_sample_set($1,$2,$3,2,$4,'image/webp')`,
      [ownerPrincipalId, owner.tenantId, activityId, imageB],
    );
    expect(uploadB.rows[0]).toMatchObject({ result_code: 'ok', draft_revision: 3 });
    const v2 = await publish(activityId, 3, 'ux1a3:publish:v2:0001');

    const v1AfterV2 = await viewerSample({
      versionId: v1.activity_version_id,
      accountId: assigned.accountId,
    });
    expect(v1AfterV2.rows).toHaveLength(1);
    expect(Buffer.compare(v1AfterV2.rows[0].sample_bytes as Buffer, imageA)).toBe(0);

    const classV2 = await classroom();
    const assignedV2 = await studentSeat(classV2, 'Assigned StudentSeat learner');
    const assignmentV2 = await assign(classV2, v2.activity_version_id, [assignedV2]);
    const seatReaderV2 = await readerRow(assignedV2, assignmentV2);
    expect(seatReaderV2?.sample_image).toBe(
      `/api/assignments/activity-versions/${v2.activity_version_id}/sample`,
    );
    const seatBytesB = await viewerSample({
      versionId: v2.activity_version_id,
      seatId: assignedV2,
    });
    expect(seatBytesB.rows).toHaveLength(1);
    expect(Buffer.compare(seatBytesB.rows[0].sample_bytes as Buffer, imageB)).toBe(0);

    const legacyAfter = await admin.query(
      'SELECT count(*)::integer AS count FROM teacher_assignments WHERE tenant_id=$1',
      [owner.tenantId],
    );
    expect(legacyAfter.rows[0].count).toBe(legacyBefore.rows[0].count);
  });

  it('keeps a published version without media as sampleImage null', async () => {
    const activityId = await createActivity('Learner no image');
    const version = await publish(activityId, 1, 'ux1a3:publish:none:0001');
    const classId = await classroom();
    const seatId = await studentSeat(classId, 'No-image learner');
    const assignmentId = await assign(classId, version.activity_version_id, [seatId]);

    const row = await readerRow(seatId, assignmentId);
    expect(row).toEqual({ id: assignmentId, sample_image: null });
    const bytes = await viewerSample({ versionId: version.activity_version_id, seatId });
    expect(bytes.rows).toEqual([]);
  });
});
