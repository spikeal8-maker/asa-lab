import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

// Required by the ordinary Vitest include, against the isolated real PostgreSQL
// and restricted runtime role. No skip or in-memory substitute.
let admin: pg.Pool;
let app: pg.Pool;
let owner: SeededTeacher;
let teacherActor: string;
let teacherAccount: string;
let foreignActor: string;
beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  owner = await seedTeacher(admin, 'manual-journal');
  const foreign = await seedTeacher(admin, 'manual-journal-foreign');
  const actor = await admin.query(
    'SELECT principal_id,account_id FROM legacy_user_account_links WHERE user_id=$1',
    [owner.teacherId],
  );
  teacherActor = actor.rows[0].principal_id;
  teacherAccount = actor.rows[0].account_id;
  foreignActor = (
    await admin.query('SELECT principal_id FROM legacy_user_account_links WHERE user_id=$1', [
      foreign.teacherId,
    ])
  ).rows[0].principal_id;
});
afterAll(async () => {
  await app?.end();
  await admin?.end();
});
type Grade = {
  id: string;
  value: number | null;
  revision: number;
  seatId: string;
  authorId: string;
  supersedesId: string | null;
  reason: string | null;
};
async function write(
  classId: string,
  action: string,
  input: Record<string, unknown>,
  actor = teacherActor,
) {
  return (
    await app.query('SELECT classroom_journal_write($1,$2,$3,$4::jsonb) AS value', [
      actor,
      classId,
      action,
      JSON.stringify(input),
    ])
  ).rows[0].value;
}
async function read(classId: string, actor = teacherActor) {
  return (
    await app.query("SELECT classroom_journal_read($1,$2,'2026-10-01','2026-10-31') AS value", [
      actor,
      classId,
    ])
  ).rows[0].value;
}
async function results(actor: string): Promise<Grade[]> {
  return (
    await app.query("SELECT classroom_journal_results($1,'2026-10-01','2026-10-31') AS value", [
      actor,
    ])
  ).rows[0].value.items;
}
async function fixture() {
  const classId = (
    await admin.query(
      `INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by)
    VALUES($1,$2,$3,'Журнал без заданий',$4) RETURNING id`,
      [owner.tenantId, owner.schoolId, owner.periodId, owner.teacherId],
    )
  ).rows[0].id as string;
  await admin.query(
    `INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner')`,
    [owner.tenantId, classId, owner.teacherId, teacherAccount],
  );
  const pupils = [];
  for (const name of ['Алина', 'Борис']) {
    const handle = randomUUID().replaceAll('-', '').slice(0, 20);
    const seatId = (
      await admin.query(
        `INSERT INTO classroom_student_seats(tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by)
      VALUES($1,$2,$3,$4,$4,true,'active',$5) RETURNING id`,
        [owner.tenantId, classId, name, handle, owner.teacherId],
      )
    ).rows[0].id as string;
    const principalId = (
      await admin.query(`SELECT principal_id FROM student_seat_principal($1)`, [seatId])
    ).rows[0].principal_id as string;
    pupils.push({ seatId, principalId });
  }
  const column = await write(classId, 'column', {
    date: '2026-10-09',
    category: 'Работа на уроке',
    expectedRevision: 0,
    requestId: randomUUID(),
  });
  expect(column.id).toBeTypeOf('string');
  return { classId, columnId: column.id as string, a: pupils[0], b: pupils[1] };
}
function input(
  columnId: string,
  seatId: string,
  value: number | null,
  expectedRevision = 0,
  reason: string | null = null,
) {
  return { columnId, seatId, value, expectedRevision, reason, requestId: randomUUID() };
}

describe('manual classroom journal: real restricted PostgreSQL', () => {
  it('reads canonical-only Account links, revokes either subject and never follows stale seat.account_id to another identity/class', async () => {
    const f = await fixture();
    const other = await fixture();
    const grade = await write(f.classId, 'grade', input(f.columnId, f.a.seatId, 0));
    const otherGrade = await write(
      other.classId,
      'grade',
      input(other.columnId, other.a.seatId, 3),
    );
    const accountSeed = await seedTeacher(admin, 'journal-canonical-only');
    const account = (
      await admin.query(
        'SELECT account_id,principal_id FROM legacy_user_account_links WHERE user_id=$1',
        [accountSeed.teacherId],
      )
    ).rows[0];
    await admin.query('UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2', [
      account.account_id,
      f.a.seatId,
    ]);
    await admin.query('SELECT learning_audience_ensure_seat_identity($1)', [f.a.seatId]);
    // Keep persisted school admission evidence on another ungraded Seat, while
    // the graded Seat's legacy field is stale. The immutable canonical links win.
    await admin.query('UPDATE classroom_student_seats SET account_id=NULL WHERE id=$1', [
      f.a.seatId,
    ]);
    await admin.query('UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2', [
      account.account_id,
      f.b.seatId,
    ]);
    await admin.query('UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2', [
      account.account_id,
      other.a.seatId,
    ]);
    expect(await results(account.principal_id)).toEqual(await results(f.a.principalId));
    expect((await results(account.principal_id)).map((g) => g.id)).toEqual([grade.id]);
    expect((await results(other.a.principalId)).map((g) => g.id)).toEqual([otherGrade.id]);
    const corrected = await write(
      f.classId,
      'grade',
      input(f.columnId, f.a.seatId, 5, 1, 'Canonical correction'),
    );
    const inbox = await app.query('SELECT * FROM learning_notifications_list($1)', [
      account.principal_id,
    ]);
    expect(inbox.rows.map((row) => row.item.journalRevisionId)).toContain(corrected.id);
    expect(inbox.rows.some((row) => row.item.classroomId === other.classId)).toBe(false);
    await admin.query(
      "UPDATE learner_identity_links SET status='inactive',disabled_at=now() WHERE account_id=$1 AND school_id=$2",
      [account.account_id, owner.schoolId],
    );
    expect(await results(account.principal_id)).toEqual([]);
    expect((await results(f.a.principalId)).map((g) => g.id)).toEqual([corrected.id]);
    expect(
      (await app.query('SELECT * FROM learning_notifications_list($1)', [account.principal_id]))
        .rows,
    ).toEqual([]);
    const afterUnlink = await write(
      f.classId,
      'grade',
      input(f.columnId, f.a.seatId, 4, 2, 'Account unlinked'),
    );
    expect(afterUnlink).toMatchObject({ revision: 3, value: 4 });
    expect(await results(account.principal_id)).toEqual([]); // no silent reactivation
    await admin.query(
      "UPDATE learner_identity_links SET status='inactive',disabled_at=now() WHERE seat_id=$1",
      [f.a.seatId],
    );
    expect(await results(f.a.principalId)).toEqual([]);
    expect(
      (await app.query('SELECT * FROM learning_notifications_list($1)', [f.a.principalId])).rows,
    ).toEqual([]);
    expect(
      await write(f.classId, 'grade', input(f.columnId, f.a.seatId, 5, 3, 'Revoked seat')),
    ).toEqual({ error: 'not_found' });
    expect((await read(f.classId)).grades.map((g: Grade) => g.id)).toEqual([afterUnlink.id]); // preserved teacher evidence
  });

  it('inactive historical identity never becomes the current pupil or another Seat revision', async () => {
    const f = await fixture();
    const grade = await write(f.classId, 'grade', input(f.columnId, f.a.seatId, 0));
    const second = await write(f.classId, 'grade', input(f.columnId, f.b.seatId, 3));
    const learner = (
      await admin.query('SELECT learner_identity_id FROM classroom_journal_revisions WHERE id=$1', [
        grade.id,
      ])
    ).rows[0].learner_identity_id;
    await admin.query("UPDATE learner_identities SET state='inactive' WHERE id=$1", [learner]);
    expect(await results(f.a.principalId)).toEqual([]);
    expect((await results(f.b.principalId)).map((g) => g.id)).toEqual([second.id]);
    expect(
      await write(f.classId, 'grade', input(f.columnId, f.a.seatId, 5, 1, 'Old identity')),
    ).toEqual({ error: 'not_found' });
    await expect(
      admin.query(
        `INSERT INTO classroom_journal_revisions(tenant_id,classroom_id,column_id,seat_id,learner_identity_id,revision,value,supersedes_id,reason,author_id)
      SELECT tenant_id,classroom_id,column_id,$2,learner_identity_id,2,5,id,'Reuse rejected',author_id FROM classroom_journal_revisions WHERE id=$1`,
        [grade.id, f.b.seatId],
      ),
    ).rejects.toThrow('lineage invalid');
    expect(
      (
        await app.query('SELECT classroom_journal_history($1,$2,$3,$4) AS value', [
          teacherActor,
          f.classId,
          f.columnId,
          f.a.seatId,
        ])
      ).rows[0].value.items.map((g: Grade) => g.id),
    ).toEqual([grade.id]);
  });

  it('notification insertion failure rolls back grade and receipt; the identical retry delivers once', async () => {
    const f = await fixture();
    const command = input(f.columnId, f.a.seatId, 0);
    const suffix = randomUUID().replaceAll('-', '');
    const name = `journal_fail_${suffix}`;
    await admin.query(`CREATE FUNCTION public.${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.classroom_id='${f.classId}'::uuid AND NEW.journal_revision_id IS NOT NULL THEN
      RAISE EXCEPTION 'injected journal emission failure'; END IF; RETURN NEW; END; $$`);
    await admin.query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON learning_notifications FOR EACH ROW EXECUTE FUNCTION public.${name}()`,
    );
    try {
      await expect(write(f.classId, 'grade', command)).rejects.toThrow(
        'injected journal emission failure',
      );
      expect((await read(f.classId)).grades).toEqual([]);
      expect(
        (
          await admin.query(
            'SELECT count(*)::int AS n FROM classroom_journal_receipts WHERE classroom_id=$1 AND request_id=$2',
            [f.classId, command.requestId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await admin.query(
            'SELECT count(*)::int AS n FROM learning_notifications WHERE classroom_id=$1',
            [f.classId],
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await admin.query(
            "SELECT count(*)::int AS n FROM audit_events WHERE entity_id=$1 AND action='classroom.journal.grade'",
            [f.classId],
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await admin.query(`DROP TRIGGER ${name} ON learning_notifications`);
      await admin.query(`DROP FUNCTION public.${name}()`);
    }
    const saved = await write(f.classId, 'grade', command);
    expect(saved).toMatchObject({ revision: 1, value: 0 });
    expect(await write(f.classId, 'grade', command)).toEqual(saved);
    expect((await read(f.classId)).grades).toEqual([saved]);
    expect(
      (
        await admin.query(
          'SELECT count(*)::int AS n FROM classroom_journal_receipts WHERE classroom_id=$1 AND request_id=$2',
          [f.classId, command.requestId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await app.query('SELECT * FROM learning_notifications_list($1)', [f.a.principalId])
      ).rows.map((row) => row.item.journalRevisionId),
    ).toEqual([saved.id]);
    expect(
      (
        await admin.query(
          'SELECT count(*)::int AS n FROM learning_notifications WHERE journal_revision_id=$1',
          [saved.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('preserves existing course/class/requester revocation rules alongside journal inbox events', async () => {
    const f = await fixture();
    const grade = await write(f.classId, 'grade', input(f.columnId, f.a.seatId, 0));
    const learner = (
      await admin.query('SELECT learner_identity_id FROM classroom_journal_revisions WHERE id=$1', [
        grade.id,
      ])
    ).rows[0].learner_identity_id;
    const course = (
      await admin.query(
        "INSERT INTO courses(tenant_id,owner_principal_id,title,visibility) VALUES($1,$2,'Inbox course','private') RETURNING id",
        [owner.tenantId, teacherActor],
      )
    ).rows[0].id;
    const version = (
      await admin.query(
        `INSERT INTO course_versions(tenant_id,course_id,version_number,title,outline,content_hash,published_by_principal_id)
      VALUES($1,$2,1,'Inbox course','{"sections":[]}'::jsonb,$3,$4) RETURNING id`,
        [owner.tenantId, course, randomUUID(), teacherActor],
      )
    ).rows[0].id;
    const run = (
      await admin.query(
        `INSERT INTO classroom_course_runs(tenant_id,classroom_id,course_id,course_version_id,title,version_number,assigned_by_principal_id)
      VALUES($1,$2,$3,$4,'Inbox course',1,$5) RETURNING id`,
        [owner.tenantId, f.classId, course, version, teacherActor],
      )
    ).rows[0].id;
    await admin.query(
      `INSERT INTO course_enrollments(tenant_id,school_id,course_run_id,learner_identity_id,assigned_by_principal_id) VALUES($1,$2,$3,$4,$5)`,
      [owner.tenantId, owner.schoolId, run, learner, teacherActor],
    );
    const event = (
      await admin.query(
        `INSERT INTO learning_notifications(tenant_id,recipient_principal_id,classroom_id,course_run_id,category,event_kind,event_key,recipient_kind,delivery_state)
      VALUES($1,$2,$3,$4,'NC01','NF15',$5,'learner','delivered') RETURNING id`,
        [owner.tenantId, f.a.principalId, f.classId, run, randomUUID()],
      )
    ).rows[0].id;
    const inbox = async (actor: string) =>
      (await app.query('SELECT * FROM learning_notifications_list($1)', [actor])).rows.map(
        (row) => row.item,
      );
    expect((await inbox(f.a.principalId)).map((item) => item.id)).toContain(event);
    expect(await inbox(f.b.principalId)).toEqual([]);
    await admin.query(
      `UPDATE course_enrollments SET status='withdrawn',withdrawn_at=now(),withdrawn_by_principal_id=$2,withdrawal_source='teacher_command' WHERE course_run_id=$1`,
      [run, teacherActor],
    );
    expect((await inbox(f.a.principalId)).map((item) => item.id)).not.toContain(event);
    expect((await inbox(f.a.principalId)).map((item) => item.journalRevisionId)).toContain(
      grade.id,
    );
    expect(
      (
        await app.query('SELECT learning_notifications_mark_read($1,$2::uuid[],now()) AS n', [
          f.a.principalId,
          [event],
        ])
      ).rows[0].n,
    ).toBe(0);
    const teacherEvent = (
      await admin.query(
        `INSERT INTO learning_notifications(tenant_id,recipient_principal_id,classroom_id,category,event_kind,event_key,recipient_kind,delivery_state)
      VALUES($1,$2,$3,'NC02','NF02',$4,'teacher','delivered') RETURNING id`,
        [owner.tenantId, teacherActor, f.classId, randomUUID()],
      )
    ).rows[0].id;
    expect((await inbox(teacherActor)).map((item) => item.id)).toContain(teacherEvent);
    await admin.query('DELETE FROM classroom_memberships WHERE classroom_id=$1 AND account_id=$2', [
      f.classId,
      teacherAccount,
    ]);
    expect((await inbox(teacherActor)).map((item) => item.id)).not.toContain(teacherEvent);
    await admin.query("UPDATE classroom_student_seats SET status='suspended' WHERE id=$1", [
      f.a.seatId,
    ]);
    expect(await inbox(f.a.principalId)).toEqual([]);
    const requesterSeed = await seedTeacher(admin, 'journal-inbox-requester');
    const requester = (
      await admin.query(
        'SELECT account_id,principal_id FROM legacy_user_account_links WHERE user_id=$1',
        [requesterSeed.teacherId],
      )
    ).rows[0];
    const join = (
      await admin.query(
        `INSERT INTO classroom_account_join_requests(classroom_id,tenant_id,account_id,status,code_hash) VALUES($1,$2,$3,'pending','isolated-test') RETURNING id`,
        [f.classId, owner.tenantId, requester.account_id],
      )
    ).rows[0].id;
    const decision = (
      await admin.query(
        `INSERT INTO learning_notifications(tenant_id,recipient_principal_id,classroom_id,join_request_id,category,event_kind,event_key,recipient_kind,delivery_state)
      VALUES($1,$2,$3,$4,'NC08','NF07',$5,'requester','delivered') RETURNING id`,
        [owner.tenantId, requester.principal_id, f.classId, join, randomUUID()],
      )
    ).rows[0].id;
    expect((await inbox(requester.principal_id)).map((item) => item.id)).toContain(decision);
    expect(await results(requester.principal_id)).toEqual([]);
    expect((await inbox(f.b.principalId)).map((item) => item.id)).not.toContain(decision);
  });

  it('enforces bounded dates/pages in SQL, serves prior months and cursor history, and freezes the class timezone', async () => {
    const f = await fixture();
    const previous = await write(f.classId, 'column', {
      date: '2026-09-30',
      category: 'Прошлый месяц',
      expectedRevision: 1,
      requestId: randomUUID(),
    });
    const olderGrade = await write(f.classId, 'grade', input(previous.id, f.a.seatId, 3));
    let revision = 0;
    for (const value of [0, 5, null, 0]) {
      const saved = await write(
        f.classId,
        'grade',
        input(f.columnId, f.a.seatId, value, revision, revision ? 'History page' : null),
      );
      expect(saved.revision).toBe(++revision);
    }
    const history = (
      await app.query('SELECT classroom_journal_history($1,$2,$3,$4,NULL,2) AS value', [
        teacherActor,
        f.classId,
        f.columnId,
        f.a.seatId,
      ])
    ).rows[0].value;
    expect(history.items.map((g: Grade) => g.value)).toEqual([0, null]);
    expect(history.nextBeforeRevision).toBe(3);
    const past = (
      await app.query('SELECT classroom_journal_history($1,$2,$3,$4,$5,2) AS value', [
        teacherActor,
        f.classId,
        f.columnId,
        f.a.seatId,
        history.nextBeforeRevision,
      ])
    ).rows[0].value;
    expect(past.items.map((g: Grade) => g.value)).toEqual([5, 0]);
    expect(past.nextBeforeRevision).toBeNull();
    const page = (
      await app.query(
        "SELECT classroom_journal_read($1,$2,'2026-09-01','2026-10-31',0,1) AS value",
        [teacherActor, f.classId],
      )
    ).rows[0].value;
    expect(page.columns.map((c: { id: string }) => c.id)).toEqual([previous.id]);
    expect(page.grades.map((g: Grade) => g.id)).toEqual([olderGrade.id]);
    expect(page.nextOffset).toBe(1);
    const next = (
      await app.query(
        "SELECT classroom_journal_read($1,$2,'2026-09-01','2026-10-31',1,1) AS value",
        [teacherActor, f.classId],
      )
    ).rows[0].value;
    expect(next.columns.map((c: { id: string }) => c.id)).toEqual([f.columnId]);
    expect(next.nextOffset).toBeNull();
    const learner = (
      await app.query(
        "SELECT classroom_journal_results($1,'2026-09-01','2026-10-31',0,1) AS value",
        [f.a.principalId],
      )
    ).rows[0].value;
    expect(learner.nextOffset).toBe(1);
    const learnerPast = (
      await app.query(
        "SELECT classroom_journal_results($1,'2026-09-01','2026-10-31',1,1) AS value",
        [f.a.principalId],
      )
    ).rows[0].value;
    expect(learnerPast.items.map((g: Grade) => g.id)).toEqual([olderGrade.id]);
    expect(learnerPast.nextOffset).toBeNull();
    const onlyMonth = (
      await app.query("SELECT classroom_journal_results($1,'2026-09-01','2026-09-30') AS value", [
        f.a.principalId,
      ])
    ).rows[0].value;
    expect(onlyMonth.items.map((g: Grade) => g.id)).toEqual([olderGrade.id]);
    await expect(
      app.query("SELECT classroom_journal_read($1,$2,'2026-01-01','2026-04-04')", [
        teacherActor,
        f.classId,
      ]),
    ).rejects.toThrow('invalid journal date range');
    await expect(
      app.query("SELECT classroom_journal_results($1,'2026-01-01','2026-04-04')", [
        f.a.principalId,
      ]),
    ).rejects.toThrow('invalid journal date range');
    await expect(
      app.query('SELECT classroom_journal_results($1,NULL,NULL,0,51)', [f.a.principalId]),
    ).rejects.toThrow('invalid journal results page');
    await expect(
      app.query('SELECT classroom_journal_read($1,$2,NULL,NULL,0,51)', [teacherActor, f.classId]),
    ).rejects.toThrow('invalid journal page');
    await expect(
      app.query('SELECT classroom_journal_history($1,$2,$3,$4,NULL,51)', [
        teacherActor,
        f.classId,
        f.columnId,
        f.a.seatId,
      ]),
    ).rejects.toThrow('invalid journal history page');
    const maxRange = (
      await app.query("SELECT classroom_journal_read($1,$2,'2026-01-01','2026-04-03') AS value", [
        teacherActor,
        f.classId,
      ])
    ).rows[0].value;
    expect(maxRange.range.to).toBe('2026-04-03');
    const initial = (
      await app.query('SELECT classroom_journal_read($1,$2) AS value', [teacherActor, f.classId])
    ).rows[0].value;
    expect(initial.range.from.slice(8)).toBe('01');
    expect(initial.range.from.slice(0, 7)).toBe(initial.range.today.slice(0, 7));
    const oldZone = initial.timeZone;
    const profile = (
      await admin.query('SELECT time_zone FROM profiles WHERE account_id=$1', [teacherAccount])
    ).rows[0];
    try {
      await admin.query("UPDATE profiles SET time_zone='Pacific/Kiritimati' WHERE account_id=$1", [
        teacherAccount,
      ]);
      await write(f.classId, 'scale', {
        preset: 'hundred',
        expectedRevision: 1,
        requestId: randomUUID(),
      });
      expect((await read(f.classId)).timeZone).toBe(oldZone);
      expect(
        (
          await app.query(
            "SELECT classroom_journal_results($1,'2026-10-01','2026-10-31') AS value",
            [f.a.principalId],
          )
        ).rows[0].value.items[0].timeZone,
      ).toBe(oldZone);
      const fresh = await fixture();
      expect((await read(fresh.classId)).timeZone).toBe('Pacific/Kiritimati');
      const today = (
        await admin.query("SELECT (now() AT TIME ZONE 'Pacific/Kiritimati')::date::text AS today")
      ).rows[0].today;
      expect(
        (
          await app.query('SELECT classroom_journal_read($1,$2) AS value', [
            teacherActor,
            fresh.classId,
          ])
        ).rows[0].value.range.today,
      ).toBe(today);
    } finally {
      await admin.query('UPDATE profiles SET time_zone=$1 WHERE account_id=$2', [
        profile.time_zone,
        teacherAccount,
      ]);
    }
  });

  it('includes unassigned pupils, distinguishes zero/empty, persists corrections and clear with authors', async () => {
    const f = await fixture();
    const empty = await read(f.classId);
    expect(empty.students.map((s: { name: string }) => s.name)).toEqual(['Алина', 'Борис']);
    expect(empty.grades).toEqual([]);
    const zeroInput = input(f.columnId, f.a.seatId, 0);
    const zero = await write(f.classId, 'grade', zeroInput);
    expect(zero).toMatchObject({
      value: 0,
      revision: 1,
      authorId: teacherActor,
      seatId: f.a.seatId,
    });
    expect(await write(f.classId, 'grade', zeroInput)).toEqual(zero);
    expect(await write(f.classId, 'grade', { ...zeroInput, value: 5 })).toEqual({
      error: 'idempotency_conflict',
    });
    const five = await write(
      f.classId,
      'grade',
      input(f.columnId, f.a.seatId, 5, 1, 'Исправлена опечатка'),
    );
    expect(five).toMatchObject({ value: 5, revision: 2, supersedesId: zero.id });
    expect(await write(f.classId, 'grade', zeroInput)).toEqual(zero); // receipt before stale revision
    expect(
      await write(f.classId, 'grade', input(f.columnId, f.a.seatId, 4, 1, 'Другой педагог')),
    ).toEqual({ error: 'revision_conflict' });
    expect(await write(f.classId, 'grade', input(f.columnId, f.a.seatId, 4, 2))).toEqual({
      error: 'reason_required',
    });
    const clear = await write(
      f.classId,
      'grade',
      input(f.columnId, f.a.seatId, null, 2, 'Оценка снята'),
    );
    expect(clear).toMatchObject({ value: null, revision: 3, supersedesId: five.id });
    expect((await read(f.classId)).grades).toEqual([clear]);
    const history = (
      await app.query('SELECT classroom_journal_history($1,$2,$3,$4) AS value', [
        teacherActor,
        f.classId,
        f.columnId,
        f.a.seatId,
      ])
    ).rows[0].value.items;
    expect(history.map((g: Grade) => g.value)).toEqual([null, 5, 0]);
    expect(history.every((g: Grade) => g.authorId === teacherActor)).toBe(true);
    expect((await results(f.a.principalId))[0]).toMatchObject({ id: clear.id, value: null });
    expect(await results(f.b.principalId)).toEqual([]);
    const count = (
      await admin.query(
        `SELECT count(*)::integer AS count FROM learning_notifications WHERE event_key=$1`,
        [`journal:${zero.id}`],
      )
    ).rows[0].count;
    expect(count).toBe(1);
    expect(
      (
        await admin.query(
          'SELECT count(*)::integer AS count FROM classroom_assignments WHERE classroom_id=$1',
          [f.classId],
        )
      ).rows[0].count,
    ).toBe(0);
    await expect(
      admin.query('UPDATE classroom_journal_revisions SET value=1 WHERE id=$1', [zero.id]),
    ).rejects.toThrow('append-only');
    await expect(
      admin.query('DELETE FROM classroom_journal_revisions WHERE id=$1', [zero.id]),
    ).rejects.toThrow('append-only');
  });

  it('pins all five presets, validates values/dates, and never reinterprets old columns', async () => {
    const f = await fixture();
    const original = await write(f.classId, 'grade', input(f.columnId, f.a.seatId, 5));
    const examples = [
      { preset: 'hundred', value: 100, bad: 101 },
      { preset: 'three_five', value: 3, bad: 2 },
      { preset: 'smileys', value: 1, bad: 0 },
      { preset: 'symbols', value: 5, bad: 0 },
      { preset: 'five', value: 0, bad: 6 },
    ];
    let version = 1;
    for (const example of examples) {
      const request = {
        preset: example.preset,
        expectedRevision: version,
        requestId: randomUUID(),
      };
      const scale = await write(f.classId, 'scale', request);
      expect(scale).toEqual({ preset: example.preset, version: ++version });
      expect(await write(f.classId, 'scale', request)).toEqual(scale);
      const c = {
        date: '2026-10-10',
        category: `Проверка ${example.preset}`,
        expectedRevision: version,
        requestId: randomUUID(),
      };
      const column = await write(f.classId, 'column', c);
      expect(await write(f.classId, 'column', c)).toEqual(column);
      expect(
        await write(f.classId, 'grade', input(column.id, f.a.seatId, example.value)),
      ).toMatchObject({ value: example.value });
      expect(await write(f.classId, 'grade', input(column.id, f.b.seatId, example.bad))).toEqual({
        error: 'invalid_grade',
      });
    }
    const snapshot = await read(f.classId);
    expect(snapshot.columns.find((c: { id: string }) => c.id === f.columnId)).toMatchObject({
      preset: 'five',
      scaleVersion: 1,
    });
    expect(snapshot.grades.find((g: Grade) => g.id === original.id)).toMatchObject({ value: 5 });
    expect(
      await write(f.classId, 'scale', {
        preset: 'five',
        expectedRevision: 0,
        requestId: randomUUID(),
      }),
    ).toEqual({ error: 'revision_conflict' });
    expect(
      await write(f.classId, 'column', {
        date: '2026-02-30',
        category: 'Тест',
        expectedRevision: version,
        requestId: randomUUID(),
      }),
    ).toEqual({ error: 'invalid_date' });
    expect(
      await write(f.classId, 'column', {
        date: '2026-10-09',
        category: ' ',
        expectedRevision: version,
        requestId: randomUUID(),
      }),
    ).toEqual({ error: 'invalid_column' });
  });

  it('isolates foreign teachers/classes/pupils and preserves archive read-only and revoked scope', async () => {
    const f = await fixture();
    const other = await fixture();
    expect(await read(f.classId, foreignActor)).toBeNull();
    expect(await write(f.classId, 'grade', input(f.columnId, f.a.seatId, 0), foreignActor)).toEqual(
      { error: 'forbidden' },
    );
    expect(await read(f.classId, f.a.principalId)).toBeNull();
    expect(await write(f.classId, 'grade', input(f.columnId, other.a.seatId, 0))).toEqual({
      error: 'not_found',
    });
    const request = input(f.columnId, f.a.seatId, 0);
    const grade = await write(f.classId, 'grade', request);
    await admin.query(`UPDATE classrooms SET status='archived',archived_at=now() WHERE id=$1`, [
      f.classId,
    ]);
    expect(
      await write(f.classId, 'grade', input(f.columnId, f.a.seatId, 5, 1, 'Исправление')),
    ).toEqual({ error: 'classroom_archived' });
    expect(await write(f.classId, 'grade', request)).toEqual(grade); // read-only receipt
    expect((await read(f.classId)).grades).toEqual([grade]);
    expect(await results(f.a.principalId)).toHaveLength(1);
    await admin.query(`UPDATE classroom_student_seats SET status='suspended' WHERE id=$1`, [
      f.a.seatId,
    ]);
    expect(await results(f.a.principalId)).toEqual([]);
    expect(
      (await app.query('SELECT * FROM learning_notifications_list($1)', [f.a.principalId])).rows,
    ).toEqual([]);
    await admin.query('DELETE FROM classroom_memberships WHERE classroom_id=$1 AND account_id=$2', [
      f.classId,
      teacherAccount,
    ]);
    expect(await write(f.classId, 'grade', request)).toEqual({ error: 'forbidden' });
    await expect(app.query('SELECT * FROM classroom_journal_revisions')).rejects.toThrow(
      'permission denied',
    );
    expect(
      (await app.query(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`))
        .rows[0],
    ).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('uses one history through Account linking, notifications off never hides results, pending applicant has none', async () => {
    const f = await fixture();
    const grade = await write(f.classId, 'grade', input(f.columnId, f.a.seatId, 0));
    const linked = await seedTeacher(admin, 'journal-linked-learner');
    const account = (
      await admin.query(
        'SELECT account_id,principal_id FROM legacy_user_account_links WHERE user_id=$1',
        [linked.teacherId],
      )
    ).rows[0];
    expect(await results(account.principal_id)).toEqual([]); // no approved Seat yet
    await admin.query(`UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2`, [
      account.account_id,
      f.a.seatId,
    ]);
    await admin.query('SELECT learning_audience_ensure_seat_identity($1)', [f.a.seatId]);
    const byAccount = await results(account.principal_id);
    const bySeat = await results(f.a.principalId);
    expect(byAccount).toEqual(bySeat);
    expect(byAccount).toHaveLength(1);
    expect(byAccount[0].id).toBe(grade.id);
    const preference = await app.query(
      `SELECT learning_notification_preferences_save($1,0,false,'{}','{}',$2) AS code`,
      [account.principal_id, randomUUID()],
    );
    expect(preference.rows[0].code).toBe('ok');
    const corrected = await write(
      f.classId,
      'grade',
      input(f.columnId, f.a.seatId, 5, 1, 'После проверки'),
    );
    expect(await results(account.principal_id)).toEqual(await results(f.a.principalId));
    expect((await results(account.principal_id))[0]).toMatchObject({ id: corrected.id, value: 5 });
    expect(
      (
        await admin.query(
          `SELECT delivery_state,journal_revision_id FROM learning_notifications WHERE recipient_principal_id=$1 AND event_key=$2`,
          [account.principal_id, `journal:${corrected.id}`],
        )
      ).rows,
    ).toEqual([{ delivery_state: 'suppressed', journal_revision_id: corrected.id }]);
    expect(
      (await app.query('SELECT * FROM learning_notifications_list($1)', [account.principal_id]))
        .rows,
    ).toEqual([]);
    const pending = await seedTeacher(admin, 'journal-pending');
    const pendingActor = (
      await admin.query(
        'SELECT account_id,principal_id FROM legacy_user_account_links WHERE user_id=$1',
        [pending.teacherId],
      )
    ).rows[0];
    await admin.query(
      `INSERT INTO classroom_account_join_requests(classroom_id,tenant_id,account_id,status,code_hash) VALUES($1,$2,$3,'pending','isolated-test-request')`,
      [f.classId, owner.tenantId, pendingActor.account_id],
    );
    expect(await results(pendingActor.principal_id)).toEqual([]);
    await admin.query(
      "UPDATE classroom_account_join_requests SET status='rejected' WHERE account_id=$1",
      [pendingActor.account_id],
    );
    expect(await results(pendingActor.principal_id)).toEqual([]);
  });

  it('serializes concurrent revisions and authorizes a scoped co-teacher', async () => {
    const f = await fixture();
    const colleague = await seedTeacher(admin, 'journal-colleague');
    const actor = (
      await admin.query(
        'SELECT account_id,principal_id FROM legacy_user_account_links WHERE user_id=$1',
        [colleague.teacherId],
      )
    ).rows[0];
    // Existing invitation path gives the colleague the exact class grant.
    const token = randomUUID();
    await admin.query(
      `SELECT * FROM classroom_teacher_invitation_create($1,$2,$3,now()+interval '1 day')`,
      [teacherAccount, f.classId, token],
    );
    await admin.query('SELECT * FROM classroom_teacher_invitation_accept($1,$2)', [
      actor.account_id,
      token,
    ]);
    expect(await read(f.classId, actor.principal_id)).not.toBeNull();
    const writes = await Promise.all([
      write(f.classId, 'grade', input(f.columnId, f.a.seatId, 0)),
      write(f.classId, 'grade', input(f.columnId, f.a.seatId, 5), actor.principal_id),
    ]);
    expect(writes.filter((r) => r.error === 'revision_conflict')).toHaveLength(1);
    expect(writes.filter((r) => r.revision === 1)).toHaveLength(1);
    const winning = writes.find((r) => r.revision === 1);
    const retry = input(f.columnId, f.a.seatId, 4, 1, 'Коллега исправил');
    const duplicate = await Promise.all([
      write(f.classId, 'grade', retry, actor.principal_id),
      write(f.classId, 'grade', retry, actor.principal_id),
    ]);
    expect(duplicate[0]).toEqual(duplicate[1]);
    expect(duplicate[0]).toMatchObject({
      revision: 2,
      authorId: actor.principal_id,
      supersedesId: winning.id,
    });
  });
});
