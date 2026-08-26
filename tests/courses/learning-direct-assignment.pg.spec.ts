import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

const policies = {
  attemptPolicy: { maxAttempts: 1 },
  resultSelectionPolicy: { mode: 'latest' },
  completionPolicy: { mode: 'submission' },
  latePolicy: { mode: 'allow_mark_late' },
  assessmentPolicy: { mode: 'manual' },
  feedbackReleasePolicy: { mode: 'after_review' },
};

let admin: pg.Pool;
let app: pg.Pool;
let owner: SeededTeacher;
let principal: string;
let account: string;
let sequence = 0;

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
    [owner.tenantId, owner.schoolId, owner.periodId, `VS class ${++sequence}`, owner.teacherId],
  );
  await admin.query(
    `INSERT INTO classroom_memberships
       (tenant_id,classroom_id,user_id,account_id,member_role)
     VALUES ($1,$2,$3,$4,'owner')`,
    [owner.tenantId, created.rows[0].id, owner.teacherId, account],
  );
  return created.rows[0].id as string;
}

async function seat(classroomId: string, label: string) {
  const handle = `vs-${++sequence}`;
  return (
    await admin.query(
      `INSERT INTO classroom_student_seats
         (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
          safe_mode,status,created_by)
       VALUES ($1,$2,$3,$4,$4,true,'issued',$5) RETURNING id`,
      [owner.tenantId, classroomId, label, handle, owner.teacherId],
    )
  ).rows[0].id as string;
}

async function activity(title: string) {
  const authored = await admin.query(
    `INSERT INTO teacher_assignments
       (tenant_id,owner_principal_id,title,brief,module_key,visibility)
     VALUES ($1,$2,$3,'Соберите цепь.','electronics','private') RETURNING id`,
    [owner.tenantId, principal, title],
  );
  const created = await inTenant((client) =>
    client.query(
      `SELECT * FROM learning_activity_create(
       $1,$2,'school','private','project',$3,'ignored','completion',NULL,
       $4::jsonb,'electronics',NULL,NULL,$5,$6)`,
      [
        principal,
        owner.tenantId,
        title,
        JSON.stringify(policies),
        authored.rows[0].id,
        `vs:create:${++sequence}`,
      ],
    ),
  );
  const published = await inTenant((client) =>
    client.query(`SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)`, [
      principal,
      owner.tenantId,
      created.rows[0].activity_id,
      `vs:publish:${++sequence}`,
    ]),
  );
  return published.rows[0].activity_version_id as string;
}

async function assign(input: {
  classroomId: string;
  versionId: string;
  audience: 'whole_class' | 'named_learners';
  seats?: string[];
  request?: string;
}) {
  return inTenant(async (client) => {
    const result = await client.query(
      `SELECT * FROM learning_direct_assignment_create(
       $1,$2,$3,$4,'2026-09-30T20:59:00Z',$5,$6::uuid[],$7)`,
      [
        principal,
        owner.tenantId,
        input.classroomId,
        input.versionId,
        input.audience,
        input.seats ?? [],
        input.request ?? `vs:assign:${++sequence}`,
      ],
    );
    return result.rows[0] as Record<string, unknown>;
  });
}

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  owner = await seedTeacher(admin, 'learning-vs-001');
  const identity = await admin.query(
    `SELECT account_id,principal_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [owner.tenantId, owner.teacherId],
  );
  account = identity.rows[0].account_id as string;
  principal = identity.rows[0].principal_id as string;
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('LRN-VS-001 canonical direct assignment', () => {
  it('assigns one published activity to the whole class and exposes every eligible seat', async () => {
    const classId = await classroom();
    const seats = await Promise.all([
      seat(classId, 'Анна'),
      seat(classId, 'Борис'),
      seat(classId, 'Вера'),
    ]);
    const version = await activity('Светодиод и резистор');
    const request = `vs:whole:${++sequence}`;
    const first = await assign({
      classroomId: classId,
      versionId: version,
      audience: 'whole_class',
      request,
    });
    const retry = await assign({
      classroomId: classId,
      versionId: version,
      audience: 'whole_class',
      request,
    });
    expect(first).toMatchObject({ result_code: 'ok', assigned_count: 3, reused: false });
    expect(retry).toMatchObject({
      result_code: 'ok',
      classroom_assignment_id: first.classroom_assignment_id,
      reused: true,
    });
    for (const seatId of seats) {
      const visibility = await inTenant((client) =>
        client.query(`SELECT * FROM learning_direct_assignment_visibility_for_seat($1)`, [seatId]),
      );
      expect(visibility.rows).toEqual([
        { classroom_assignment_id: first.classroom_assignment_id, visible: true },
      ]);
    }
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM activity_runs
            WHERE source_classroom_assignment_id=$1`,
          [first.classroom_assignment_id],
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it('assigns to exactly two named learners and hides the assignment from the third', async () => {
    const classId = await classroom();
    const first = await seat(classId, 'Галя');
    const second = await seat(classId, 'Дима');
    const third = await seat(classId, 'Егор');
    const version = await activity('Точная цепь');
    const result = await assign({
      classroomId: classId,
      versionId: version,
      audience: 'named_learners',
      seats: [first, second],
    });
    expect(result).toMatchObject({ result_code: 'ok', assigned_count: 2 });
    const visible = async (seatId: string) =>
      (
        await inTenant((client) =>
          client.query(`SELECT visible FROM learning_direct_assignment_visibility_for_seat($1)`, [
            seatId,
          ]),
        )
      ).rows[0].visible as boolean;
    await expect(visible(first)).resolves.toBe(true);
    await expect(visible(second)).resolves.toBe(true);
    await expect(visible(third)).resolves.toBe(false);
  });

  it('rejects a seat from another class atomically and denies runtime table CRUD', async () => {
    const classId = await classroom();
    const otherClass = await classroom();
    const foreignSeat = await seat(otherClass, 'Чужой ученик');
    const version = await activity('Безопасная цепь');
    const rejected = await assign({
      classroomId: classId,
      versionId: version,
      audience: 'named_learners',
      seats: [foreignSeat],
    });
    expect(rejected.result_code).toBe('named_learner_ineligible');
    expect(
      (
        await admin.query(
          `SELECT count(*)::int AS count FROM classroom_assignments WHERE classroom_id=$1`,
          [classId],
        )
      ).rows[0].count,
    ).toBe(0);
    await expect(
      inTenant((client) => client.query(`SELECT * FROM activity_runs LIMIT 1`)),
    ).rejects.toThrow(/permission denied/);
  });
});
