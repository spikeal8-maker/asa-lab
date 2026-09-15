import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

type SessionRow = {
  result_code: string;
  class_session_id: string;
  reused: boolean;
};

let admin: pg.Pool;
let app: pg.Pool;
let owner: SeededTeacher;
let teacherAccount: string;
let sequence = 0;

async function createClass(): Promise<string> {
  const result = await admin.query(
    `INSERT INTO classrooms (tenant_id,school_id,academic_period_id,title,created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [owner.tenantId, owner.schoolId, owner.periodId, `A6 session ${++sequence}`, owner.teacherId],
  );
  const classroomId = result.rows[0].id as string;
  await admin.query(
    `INSERT INTO classroom_memberships
       (tenant_id,classroom_id,user_id,account_id,member_role)
     VALUES ($1,$2,$3,$4,'owner')`,
    [owner.tenantId, classroomId, owner.teacherId, teacherAccount],
  );
  return classroomId;
}

async function createLearner(classroomId: string, label: string) {
  const login = `a6-${++sequence}`;
  const seat = await admin.query(
    `INSERT INTO classroom_student_seats
       (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
        safe_mode,status,created_by)
     VALUES ($1,$2,$3,$4,$4,true,'active',$5) RETURNING id`,
    [owner.tenantId, classroomId, label, login, owner.teacherId],
  );
  const learner = await admin.query(
    `INSERT INTO learner_identities(id,tenant_id,school_id)
     VALUES(gen_random_uuid(),$1,$2) RETURNING id`,
    [owner.tenantId, owner.schoolId],
  );
  await admin.query(
    `INSERT INTO learner_identity_links(
       id,tenant_id,school_id,learner_identity_id,link_kind,seat_id,status
     ) VALUES(gen_random_uuid(),$1,$2,$3,'student_seat',$4,'active')`,
    [owner.tenantId, owner.schoolId, learner.rows[0].id, seat.rows[0].id],
  );
  return learner.rows[0].id as string;
}

async function createSession(
  classroomId: string,
  requestKey: string,
  topic = 'Последовательное соединение',
): Promise<SessionRow> {
  const result = await app.query(
    `SELECT * FROM class_session_create(
       $1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,$8
     )`,
    [
      teacherAccount,
      classroomId,
      topic,
      'Теория, практика и проверка.',
      '2026-09-21T07:00:00Z',
      '2026-09-21T07:45:00Z',
      'Europe/Moscow',
      requestKey,
    ],
  );
  return result.rows[0] as SessionRow;
}

async function transition(sessionId: string, status: 'live' | 'completed') {
  const result = await app.query('SELECT class_session_transition($1,$2,$3) AS code', [
    teacherAccount,
    sessionId,
    status,
  ]);
  return result.rows[0].code as string;
}

async function markAttendance(
  sessionId: string,
  learnerId: string,
  state: 'present' | 'absent',
  note: string | null,
) {
  const result = await app.query('SELECT class_session_attendance_mark($1,$2,$3,$4,$5) AS code', [
    teacherAccount,
    sessionId,
    learnerId,
    state,
    note,
  ]);
  return result.rows[0].code as string;
}

beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  owner = await seedTeacher(admin, 'learning-a6-session');
  const identity = await admin.query(
    `SELECT account_id FROM legacy_user_account_links
      WHERE tenant_id=$1 AND user_id=$2`,
    [owner.tenantId, owner.teacherId],
  );
  teacherAccount = identity.rows[0].account_id as string;
});

afterAll(async () => {
  await Promise.all([admin.end(), app.end()]);
});

describe('LRN-A6-01 class session and attendance foundation', () => {
  it('records attendance and preserves completed session history', async () => {
    const classroomId = await createClass();
    const learnerId = await createLearner(classroomId, 'Алина');
    const foreignClassroomId = await createClass();
    const foreignId = await createLearner(foreignClassroomId, 'Борис');
    const requestKey = `a6:session:${crypto.randomUUID()}`;

    const first = await createSession(classroomId, requestKey);
    expect(first).toMatchObject({ result_code: 'ok', reused: false });

    const repeated = await createSession(classroomId, requestKey);
    expect(repeated).toMatchObject({
      result_code: 'ok',
      class_session_id: first.class_session_id,
      reused: true,
    });

    expect(await transition(first.class_session_id, 'live')).toBe('ok');
    expect(await markAttendance(first.class_session_id, learnerId, 'present', 'В классе')).toBe(
      'ok',
    );
    expect(await markAttendance(first.class_session_id, foreignId, 'absent', null)).toBe(
      'learner_not_in_class',
    );
    expect(await transition(first.class_session_id, 'completed')).toBe('ok');

    const history = await app.query('SELECT * FROM class_sessions_for_teacher($1,$2)', [
      teacherAccount,
      classroomId,
    ]);
    expect(history.rows).toContainEqual(
      expect.objectContaining({
        id: first.class_session_id,
        topic: 'Последовательное соединение',
        school_timezone: 'Europe/Moscow',
        status: 'completed',
      }),
    );

    const attendance = await admin.query(
      `SELECT attendance_state,note,learner_identity_id
         FROM class_session_attendance
        WHERE class_session_id=$1`,
      [first.class_session_id],
    );
    expect(attendance.rows).toEqual([
      {
        attendance_state: 'present',
        note: 'В классе',
        learner_identity_id: learnerId,
      },
    ]);
  });

  it('rejects mutation by an unrelated educator', async () => {
    const classroomId = await createClass();
    const key = `a6:session:${crypto.randomUUID()}`;
    const session = await createSession(classroomId, key, 'Урок');
    const other = await seedTeacher(admin, 'learning-a6-foreign-teacher');
    const identity = await admin.query(
      `SELECT account_id FROM legacy_user_account_links
        WHERE tenant_id=$1 AND user_id=$2`,
      [other.tenantId, other.teacherId],
    );
    const otherAccount = identity.rows[0].account_id as string;
    const result = await app.query(`SELECT class_session_transition($1,$2,'live') AS code`, [
      otherAccount,
      session.class_session_id,
    ]);
    expect(result.rows[0].code).toBe('not_found');
  });
});
