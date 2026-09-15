import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  seedTeacher,
  testAdminPool,
  testAppPool,
  type SeededTeacher,
} from '../portal/helpers';

let admin: pg.Pool;
let app: pg.Pool;
let owner: SeededTeacher;
let teacherAccount: string;
let sequence = 0;

async function createClass(): Promise<string> {
  const result = await admin.query(
    `INSERT INTO classrooms (tenant_id,school_id,academic_period_id,title,created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [
      owner.tenantId,
      owner.schoolId,
      owner.periodId,
      `A6 session ${++sequence}`,
      owner.teacherId,
    ],
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
  const seat = await admin.query(
    `INSERT INTO classroom_student_seats
       (tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,
        safe_mode,status,created_by)
     VALUES ($1,$2,$3,$4,$4,true,'active',$5) RETURNING id`,
    [
      owner.tenantId,
      classroomId,
      label,
      `a6-${++sequence}`,
      owner.teacherId,
    ],
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
  return {
    seatId: seat.rows[0].id as string,
    learnerId: learner.rows[0].id as string,
  };
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
  it(
    'creates one scheduled session, records canonical attendance and preserves completed history',
    async () => {
      const classroomId = await createClass();
      const learner = await createLearner(classroomId, 'Алина');
      const foreignClassroomId = await createClass();
      const foreignLearner = await createLearner(foreignClassroomId, 'Борис');
      const requestKey = `a6:session:${crypto.randomUUID()}`;

      const first = (
        await app.query(
          `SELECT * FROM class_session_create(
           $1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,$8
         )`,
          [
            teacherAccount,
            classroomId,
            'Последовательное соединение',
            'Теория, практика и проверка.',
            '2026-09-21T07:00:00Z',
            '2026-09-21T07:45:00Z',
            'Europe/Moscow',
            requestKey,
          ],
        )
      ).rows[0];
      expect(first).toMatchObject({ result_code: 'ok', reused: false });

      const repeated = (
        await app.query(
          `SELECT * FROM class_session_create(
           $1,$2,$3,$4,$5::timestamptz,$6::timestamptz,$7,$8
         )`,
          [
            teacherAccount,
            classroomId,
            'Последовательное соединение',
            'Теория, практика и проверка.',
            '2026-09-21T07:00:00Z',
            '2026-09-21T07:45:00Z',
            'Europe/Moscow',
            requestKey,
          ],
        )
      ).rows[0];
      expect(repeated).toMatchObject({
        result_code: 'ok',
        class_session_id: first.class_session_id,
        reused: true,
      });

      expect(
        (
          await app.query(`SELECT class_session_transition($1,$2,'live') AS code`, [
            teacherAccount,
            first.class_session_id,
          ])
        ).rows[0].code,
      ).toBe('ok');
      expect(
        (
          await app.query(
            `SELECT class_session_attendance_mark($1,$2,$3,'present','В классе') AS code`,
            [teacherAccount, first.class_session_id, learner.learnerId],
          )
        ).rows[0].code,
      ).toBe('ok');
      expect(
        (
          await app.query(
            `SELECT class_session_attendance_mark($1,$2,$3,'absent',NULL) AS code`,
            [teacherAccount, first.class_session_id, foreignLearner.learnerId],
          )
        ).rows[0].code,
      ).toBe('learner_not_in_class');

      expect(
        (
          await app.query(`SELECT class_session_transition($1,$2,'completed') AS code`, [
            teacherAccount,
            first.class_session_id,
          ])
        ).rows[0].code,
      ).toBe('ok');

      const history = await app.query(`SELECT * FROM class_sessions_for_teacher($1,$2)`, [
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
          learner_identity_id: learner.learnerId,
        },
      ]);
    },
  );

  it(
    'does not allow an unrelated educator to mutate another classroom session',
    async () => {
      const classroomId = await createClass();
      const session = (
        await app.query(
          `SELECT * FROM class_session_create(
           $1,$2,'Урок','План',$3::timestamptz,$4::timestamptz,'Europe/Moscow',$5
         )`,
          [
            teacherAccount,
            classroomId,
            '2026-09-22T07:00:00Z',
            '2026-09-22T07:45:00Z',
            `a6:session:${crypto.randomUUID()}`,
          ],
        )
      ).rows[0];
      const other = await seedTeacher(admin, 'learning-a6-foreign-teacher');
      const otherIdentity = await admin.query(
        `SELECT account_id FROM legacy_user_account_links
        WHERE tenant_id=$1 AND user_id=$2`,
        [other.tenantId, other.teacherId],
      );

      expect(
        (
          await app.query(`SELECT class_session_transition($1,$2,'live') AS code`, [
            otherIdentity.rows[0].account_id,
            session.class_session_id,
          ])
        ).rows[0].code,
      ).toBe('not_found');
    },
  );
});
