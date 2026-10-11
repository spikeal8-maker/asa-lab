import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool, type SeededTeacher } from '../portal/helpers';

let admin: pg.Pool, app: pg.Pool, owner: SeededTeacher, actor: string, account: string;
let coTeacher: SeededTeacher, coActor: string, coAccount: string, foreignActor: string;
beforeAll(async () => {
  admin = testAdminPool();
  app = testAppPool();
  owner = await seedTeacher(admin, 'quick-journal');
  coTeacher = await seedTeacher(admin, 'quick-journal-co');
  const foreign = await seedTeacher(admin, 'quick-journal-foreign');
  for (const [teacher, assign] of [
    [
      owner,
      (r: { principal_id: string; account_id: string }) => {
        actor = r.principal_id;
        account = r.account_id;
      },
    ],
    [
      coTeacher,
      (r: { principal_id: string; account_id: string }) => {
        coActor = r.principal_id;
        coAccount = r.account_id;
      },
    ],
    [
      foreign,
      (r: { principal_id: string; account_id: string }) => {
        foreignActor = r.principal_id;
      },
    ],
  ] as const)
    assign(
      (
        await admin.query(
          'SELECT principal_id,account_id FROM legacy_user_account_links WHERE user_id=$1',
          [teacher.teacherId],
        )
      ).rows[0],
    );
});
afterAll(async () => {
  await app?.end();
  await admin?.end();
});
async function fixture(personal = false) {
  const context = personal
    ? (await admin.query('SELECT * FROM classroom_ensure_personal_teacher($1)', [account])).rows[0]
    : null;
  const scope = context
    ? {
        tenantId: context.tenant_id,
        schoolId: context.school_id,
        periodId: context.academic_period_id,
        teacherId: context.user_id,
      }
    : owner;
  const classId = (
    await admin.query(
      `INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,'Быстрый журнал',$4) RETURNING id`,
      [scope.tenantId, scope.schoolId, scope.periodId, scope.teacherId],
    )
  ).rows[0].id as string;
  const coUser = (
    await admin.query(
      `INSERT INTO users(tenant_id,school_id,role,email,display_name,password_hash) SELECT $1,$2,'teacher',$3,'Второй педагог',password_hash FROM users WHERE id=$4 RETURNING id`,
      [scope.tenantId, scope.schoolId, `co-${randomUUID()}@test.local`, coTeacher.teacherId],
    )
  ).rows[0].id;
  await admin.query(
    `INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner'),($1,$2,$5,$6,'co_teacher')`,
    [scope.tenantId, classId, scope.teacherId, account, coUser, coAccount],
  );
  const handle = randomUUID().replaceAll('-', '').slice(0, 20);
  const seatId = (
    await admin.query(
      `INSERT INTO classroom_student_seats(tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,safe_mode,status,created_by) VALUES($1,$2,'1Иван',$3,$3,true,'active',$4) RETURNING id`,
      [scope.tenantId, classId, handle, scope.teacherId],
    )
  ).rows[0].id as string;
  const principal = (
    await admin.query('SELECT principal_id FROM student_seat_principal($1)', [seatId])
  ).rows[0].principal_id as string;
  return { classId, seatId, principal };
}
function input(seatId?: string) {
  return {
    slotKey: '2026-10:1',
    date: '2026-10-11',
    category: 'Работа 1',
    expectedScaleVersion: 0,
    expectedHeaderRevision: 0,
    requestId: randomUUID(),
    ...(seatId ? { seatId, value: 0, expectedRevision: 0, reason: null } : {}),
  };
}
async function quick(classId: string, body: Record<string, unknown>, who = actor) {
  return (
    await app.query('SELECT classroom_journal_quick_write($1,$2,$3::jsonb) AS value', [
      who,
      classId,
      JSON.stringify(body),
    ])
  ).rows[0].value;
}
async function read(classId: string, from = '2026-10-01', to = '2026-10-31') {
  return (
    await app.query('SELECT classroom_journal_quick_read($1,$2,$3,$4) AS value', [
      actor,
      classId,
      from,
      to,
    ])
  ).rows[0].value;
}
async function counts(classId: string) {
  return (
    await admin.query(
      `SELECT
    (SELECT count(*) FROM classroom_journal_columns WHERE classroom_id=$1)::int AS columns,
    (SELECT count(*) FROM classroom_journal_revisions WHERE classroom_id=$1)::int AS grades,
    (SELECT count(*) FROM learning_notifications WHERE classroom_id=$1)::int AS notifications,
    (SELECT count(*) FROM classroom_journal_receipts WHERE classroom_id=$1)::int AS receipts,
    (SELECT count(*) FROM audit_events WHERE entity_id=$1 AND action LIKE 'classroom.journal.%')::int AS audit`,
      [classId],
    )
  ).rows[0];
}
describe('quick journal: real restricted PostgreSQL', () => {
  it('derives a personal class tenant from the class while keeping Account and Seat isolation', async () => {
    const f = await fixture(true),
      saved = await quick(f.classId, input(f.seatId));
    expect(saved.grade).toMatchObject({ value: 0, authorId: actor });
    expect((await read(f.classId)).grades).toHaveLength(1);
    expect(await quick(f.classId, input(), foreignActor)).toEqual({ error: 'forbidden' });
    expect(await quick(f.classId, input(), f.principal)).toEqual({ error: 'forbidden' });
  });
  it('GETs are pure; first zero, exact replay, reload and pinned presets are durable', async () => {
    const f = await fixture(),
      before = await counts(f.classId);
    for (let i = 0; i < 3; i++) expect((await read(f.classId)).columns).toEqual([]);
    expect(await counts(f.classId)).toEqual(before);
    const body = input(f.seatId),
      saved = await quick(f.classId, body);
    expect(saved.grade).toMatchObject({ value: 0, revision: 1, seatId: f.seatId, authorId: actor });
    expect(saved.column).toMatchObject({
      slotKey: '2026-10:1',
      preset: 'five',
      scaleVersion: 1,
      headerRevision: 0,
    });
    const committed = await counts(f.classId);
    expect(committed).toMatchObject({ columns: 1, grades: 1, notifications: 1 });
    expect(await quick(f.classId, body)).toEqual(saved);
    expect(await counts(f.classId)).toEqual(committed);
    expect(await quick(f.classId, { ...body, value: 5 })).toEqual({
      error: 'idempotency_conflict',
    });
    expect(await counts(f.classId)).toEqual(committed);
    expect((await read(f.classId)).grades).toEqual([saved.grade]);
    await app.query('SELECT classroom_journal_write($1,$2,$3,$4::jsonb)', [
      actor,
      f.classId,
      'scale',
      JSON.stringify({ preset: 'hundred', expectedRevision: 1, requestId: randomUUID() }),
    ]);
    expect((await read(f.classId)).columns[0]).toMatchObject({ preset: 'five', scaleVersion: 1 });
    expect(await quick(f.classId, { ...input(), slotKey: '2026-10:2' })).toEqual({
      error: 'revision_conflict',
    });
    expect((await counts(f.classId)).columns).toBe(1);
  });
  it('invalid first grade rolls back column, implicit scale, receipts, events and audit', async () => {
    const f = await fixture(),
      before = await counts(f.classId);
    expect(await quick(f.classId, { ...input(f.seatId), value: 99 })).toEqual({
      error: 'invalid_grade',
    });
    expect(await counts(f.classId)).toEqual(before);
    expect((await read(f.classId)).scale.version).toBe(0);
    expect(await quick(f.classId, { ...input(f.seatId), seatId: randomUUID() })).toEqual({
      error: 'not_found',
    });
    expect(await counts(f.classId)).toEqual(before);
  });
  it('two teachers converge to one slot; stale edit returns conflict without duplicate events', async () => {
    const f = await fixture();
    const results = await Promise.all([
      quick(f.classId, input(f.seatId)),
      quick(f.classId, input(f.seatId), coActor),
    ]);
    expect(results.filter((r) => r.error === 'revision_conflict')).toHaveLength(1);
    expect(results.filter((r) => r.grade?.value === 0)).toHaveLength(1);
    expect(await counts(f.classId)).toMatchObject({ columns: 1, grades: 1, notifications: 1 });
    const column = (await read(f.classId)).columns[0];
    const header = {
      columnId: column.id,
      date: '2026-09-30',
      category: 'Контрольная',
      expectedHeaderRevision: 0,
      expectedScaleVersion: 1,
      requestId: randomUUID(),
    };
    const edits = await Promise.all([
      quick(f.classId, header),
      quick(
        f.classId,
        { ...header, category: 'Другой заголовок', requestId: randomUUID() },
        coActor,
      ),
    ]);
    expect(edits.filter((r) => r.error === 'revision_conflict')).toHaveLength(1);
    expect((await read(f.classId)).columns).toHaveLength(0);
    expect((await read(f.classId)).reservedSlotKeys).toContain('2026-10:1');
    const beforeTargetReads = await counts(f.classId);
    for (const [id, slot] of [
      [column.id, null],
      [null, '2026-10:1'],
    ]) {
      const targeted = (
        await app.query(
          "SELECT classroom_journal_quick_read($1,$2,'2026-10-01','2026-10-31',0,50,$3,$4) AS value",
          [actor, f.classId, id, slot],
        )
      ).rows[0].value;
      expect(targeted.columns[0]).toMatchObject({
        id: column.id,
        date: '2026-09-30',
        headerRevision: 1,
      });
    }
    expect(await counts(f.classId)).toEqual(beforeTargetReads);
    expect((await read(f.classId, '2026-09-01', '2026-09-30')).columns[0]).toMatchObject({
      id: column.id,
      headerRevision: 1,
      preset: 'five',
    });
    const learner = (
      await app.query("SELECT classroom_journal_results($1,'2026-09-01','2026-09-30') AS value", [
        f.principal,
      ])
    ).rows[0].value;
    expect(learner.items[0]).toMatchObject({
      columnId: column.id,
      date: '2026-09-30',
      value: 0,
      preset: 'five',
    });
    const inbox = (
      await app.query('SELECT item FROM learning_notifications_list($1)', [f.principal])
    ).rows;
    expect(inbox[0].item.journalDate).toBe('2026-09-30');
    expect(
      (await admin.query('SELECT category FROM classroom_journal_columns WHERE id=$1', [column.id]))
        .rows[0].category,
    ).toBe('Работа 1');
  });
  it('correction and null clear retain required reasons and immutable history', async () => {
    const f = await fixture(),
      saved = await quick(f.classId, input(f.seatId));
    const correction = {
      columnId: saved.column.id,
      date: saved.column.date,
      category: saved.column.category,
      expectedHeaderRevision: 0,
      expectedScaleVersion: 1,
      seatId: f.seatId,
      expectedRevision: 1,
      value: 5,
      reason: null,
      requestId: randomUUID(),
    };
    expect(await quick(f.classId, correction)).toEqual({ error: 'reason_required' });
    const changed = await quick(f.classId, {
      ...correction,
      reason: 'Исправлена опечатка',
      requestId: randomUUID(),
    });
    expect(changed.grade).toMatchObject({ revision: 2, value: 5, supersedesId: saved.grade.id });
    const cleared = await quick(f.classId, {
      ...correction,
      value: null,
      expectedRevision: 2,
      reason: 'Оценка снята',
      requestId: randomUUID(),
    });
    expect(cleared.grade).toMatchObject({
      revision: 3,
      value: null,
      supersedesId: changed.grade.id,
    });
    const history = (
      await app.query('SELECT classroom_journal_history($1,$2,$3,$4) AS value', [
        actor,
        f.classId,
        saved.column.id,
        f.seatId,
      ])
    ).rows[0].value;
    expect(history.items.map((r: { value: number | null }) => r.value)).toEqual([null, 5, 0]);
  });
  it('foreign teachers, Seat principals, cross-class IDs and archived classes cannot write', async () => {
    const f = await fixture(),
      other = await fixture(),
      before = await counts(f.classId);
    expect(await quick(f.classId, input(f.seatId), foreignActor)).toEqual({ error: 'forbidden' });
    expect(await quick(f.classId, input(f.seatId), f.principal)).toEqual({ error: 'forbidden' });
    expect(await quick(f.classId, input(other.seatId))).toEqual({ error: 'not_found' });
    expect(await counts(f.classId)).toEqual(before);
    const otherColumn = (await quick(other.classId, input())).column.id;
    const header = {
      date: '2026-10-11',
      category: 'Работа 1',
      expectedScaleVersion: 0,
      expectedHeaderRevision: 0,
      requestId: randomUUID(),
    };
    expect(await quick(f.classId, { ...header, columnId: otherColumn })).toEqual({
      error: 'not_found',
    });
    await admin.query("UPDATE classrooms SET status='archived' WHERE id=$1", [f.classId]);
    expect(await quick(f.classId, input(f.seatId))).toEqual({ error: 'classroom_archived' });
    expect((await read(f.classId)).status).toBe('archived');
    expect(await counts(f.classId)).toEqual(before);
  });
});
