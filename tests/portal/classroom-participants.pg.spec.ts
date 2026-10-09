import { randomUUID } from 'node:crypto';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { seedTeacher, testAdminPool, testAppPool } from './helpers';

let admin: pg.Pool;
let runtime: pg.Pool;
beforeAll(() => {
  admin = testAdminPool();
  runtime = testAppPool();
});
afterAll(async () => {
  await Promise.all([admin?.end(), runtime?.end()]);
});
type Metric = {
  seatId: string;
  totalWorks: number;
  archivedWorks: number;
  score: number | null;
  rank: number | null;
  sources: { grades: number; projects: number; days: number; logins: number; time: number };
};
async function read<T>(fn: string, args: unknown[]): Promise<T> {
  const r = await runtime.query(
    `SELECT ${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) data`,
    args,
  );
  return r.rows[0]?.data as T;
}
async function fixture() {
  const teacher = await seedTeacher(admin, `participants-${randomUUID().slice(0, 8)}`);
  const identity = (
    await admin.query(
      `SELECT account_id,principal_id FROM legacy_user_account_links WHERE user_id=$1`,
      [teacher.teacherId],
    )
  ).rows[0];
  const actor = identity.principal_id as string;
  const account = identity.account_id as string;
  async function createClass(title: string) {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO classrooms(id,tenant_id,school_id,academic_period_id,title,created_by) VALUES($1,$2,$3,$4,$5,$6)`,
      [id, teacher.tenantId, teacher.schoolId, teacher.periodId, title, teacher.teacherId],
    );
    await admin.query(
      `INSERT INTO classroom_memberships(tenant_id,classroom_id,user_id,account_id,member_role) VALUES($1,$2,$3,$4,'owner')`,
      [teacher.tenantId, id, teacher.teacherId, account],
    );
    return id;
  }
  const classId = await createClass('Участники');
  async function seat(name: string, accountId: string | null = null, targetClass = classId) {
    const id = (
      await admin.query(`SELECT id FROM classroom_management_add_seat($1,$2,$3,$4,true)`, [
        account,
        targetClass,
        name,
        randomUUID().replaceAll('-', '').slice(0, 8),
      ])
    ).rows[0].id as string;
    await admin.query(
      `UPDATE classroom_student_seats SET status='active',account_id=$2 WHERE id=$1`,
      [id, accountId],
    );
    await read('classroom_participant_prepare', [actor, [targetClass]]);
    const principal = (await admin.query(`SELECT id FROM principals WHERE seat_id=$1`, [id]))
      .rows[0].id as string;
    return { id, principal };
  }
  async function learner() {
    const id = randomUUID();
    const principal = randomUUID();
    await admin.query(
      `INSERT INTO accounts(id,email,password_hash,birth_date,country) VALUES($1,$2,'test','2000-01-01','RU')`,
      [id, `${id}@test.local`],
    );
    await admin.query(
      `INSERT INTO profiles(account_id,username,display_name) VALUES($1,$2,'Личный аккаунт')`,
      [id, `p-${id.slice(0, 8)}`],
    );
    await admin.query(`INSERT INTO principals(id,kind,account_id) VALUES($1,'account',$2)`, [
      principal,
      id,
    ]);
    return { id, principal };
  }
  async function project(
    principal: string,
    module = 'three-d',
    status = 'active',
    targetClass: string | null = null,
  ) {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO projects(id,tenant_id,classroom_id,project_scope,module_key,title,status,owner_principal_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        teacher.tenantId,
        targetClass,
        targetClass ? 'classroom' : 'personal',
        module,
        `Work ${module}`,
        status,
        principal,
      ],
    );
    await admin.query(
      `INSERT INTO project_drafts(project_id,tenant_id,document_json,updated_by_principal_id) VALUES($1,$2,'{"value":0}',$3)`,
      [id, teacher.tenantId, principal],
    );
    return id;
  }
  async function write(
    action: string,
    input: Record<string, unknown>,
    asActor = actor,
    requestId = randomUUID(),
  ) {
    return read<Record<string, unknown>>('classroom_participant_write', [
      asActor,
      classId,
      action,
      JSON.stringify({ ...input, requestId }),
    ]);
  }
  async function roster() {
    return read<{
      items: Metric[];
      settings: { revision: number; periodDays: number; factors: Record<string, boolean> };
    }>('classroom_participant_roster', [actor, classId]);
  }
  async function settings(enabled: string[], periodDays = 30) {
    const current = await roster();
    return write('settings', {
      expectedRevision: current.settings.revision,
      periodDays,
      factors: Object.fromEntries(
        ['projects', 'logins', 'days', 'time', 'grades'].map((key) => [key, enabled.includes(key)]),
      ),
    });
  }
  return {
    teacher,
    actor,
    account,
    classId,
    createClass,
    seat,
    learner,
    project,
    write,
    roster,
    settings,
  };
}
describe('participants with real PostgreSQL and the runtime role', () => {
  it('counts Account-only, Seat-only and linked ownership once, including archive but excluding games and trash', async () => {
    const f = await fixture();
    const account = await f.learner();
    const linked = await f.seat('Связанный', account.id);
    const seatOnly = await f.seat('Без аккаунта');
    const accountOnly = await f.learner();
    const accountSeat = await f.seat('Аккаунт', accountOnly.id);
    const empty = await f.seat('Пустой');
    await f.project(account.principal);
    await f.project(linked.principal, 'electronics', 'archived');
    await f.project(linked.principal, 'three-d', 'trashed');
    await f.project(account.principal, 'chess');
    await f.project(seatOnly.principal, 'blocks');
    await f.project(accountOnly.principal);
    const items = (await f.roster()).items;
    expect(items.find((m) => m.seatId === linked.id)).toMatchObject({
      totalWorks: 2,
      archivedWorks: 1,
    });
    expect(items.find((m) => m.seatId === seatOnly.id)?.totalWorks).toBe(1);
    expect(items.find((m) => m.seatId === accountSeat.id)?.totalWorks).toBe(1);
    expect(items.find((m) => m.seatId === empty.id)?.totalWorks).toBe(0);
    const fromAccount = await read<{ metrics: Metric }>('classroom_participant_profile', [
      account.principal,
      f.classId,
      linked.id,
    ]);
    const fromSeat = await read<{ metrics: Metric }>('classroom_participant_profile', [
      linked.principal,
      f.classId,
      linked.id,
    ]);
    expect(fromAccount.metrics.totalWorks).toBe(fromSeat.metrics.totalWorks);
    expect(fromAccount.metrics.totalWorks).toBe(2);
  });
  it('deduplicates one Account project across classes and refuses a foreign class in a summary', async () => {
    const f = await fixture();
    const account = await f.learner();
    await f.seat('Первый', account.id);
    const secondClass = await f.createClass('Второй');
    await f.seat('Второй', account.id, secondClass);
    await f.project(account.principal);
    const summary = await read<{ totalWorks: number }>('classroom_participant_summary', [
      f.actor,
      [f.classId, secondClass],
    ]);
    expect(summary.totalWorks).toBe(1);
    expect(
      await read('classroom_participant_summary', [f.actor, [f.classId, randomUUID()]]),
    ).toBeNull();
  });
  it('returns real filtered pages without disclosing private Account metadata or previews', async () => {
    const f = await fixture();
    const account = await f.learner();
    const seat = await f.seat('Личный', account.id);
    const hidden = await f.project(account.principal);
    const page = await read<{ totalWorks: number; visibleWorks: number; items: unknown[] }>(
      'classroom_participant_works',
      [f.actor, f.classId, seat.id, null, true, false, 0],
    );
    expect(page.totalWorks).toBe(1);
    expect(page.visibleWorks).toBe(0);
    expect(page.items).toEqual([]);
    expect(JSON.stringify(page)).not.toContain(hidden);
    await admin.query(
      "INSERT INTO classroom_activity_events(tenant_id,classroom_id,seat_id,actor_principal_id,action,project_id,project_title) VALUES($1,$2,$3,$4,'project.saved',$5,'Private title')",
      [f.teacher.tenantId, f.classId, seat.id, account.principal, hidden],
    );
    const profile = await read<{ activity: unknown[] }>('classroom_participant_profile', [
      f.actor,
      f.classId,
      seat.id,
    ]);
    expect(profile.activity).toEqual([]);
    expect(JSON.stringify(profile)).not.toContain('Private title');
    const s = await f.seat('Seat');
    for (let i = 0; i < 32; i++) await f.project(s.principal, i === 0 ? 'blocks' : 'electronics');
    const all = await read<{ items: Array<{ id: string }>; hasMore: boolean }>(
      'classroom_participant_works',
      [f.actor, f.classId, s.id, null, false, false, 0],
    );
    expect(all.items).toHaveLength(30);
    expect(all.hasMore).toBe(true);
    const next = await read<{ items: Array<{ id: string }> }>('classroom_participant_works', [
      f.actor,
      f.classId,
      s.id,
      null,
      false,
      false,
      30,
    ]);
    expect(next.items).toHaveLength(2);
    expect(new Set([...all.items, ...next.items].map((p) => p.id)).size).toBe(32);
    const blocks = await read<{ items: Array<{ moduleKey: string }>; filteredWorks: number }>(
      'classroom_participant_works',
      [f.actor, f.classId, s.id, 'blocks', true, false, 0],
    );
    expect(blocks.filteredWorks).toBe(1);
    expect(blocks.items.map((p) => p.moduleKey)).toEqual(['blocks']);
  });
  it('persists factors and period, changes scores, preserves zero, stable ties and disabled ratings', async () => {
    const f = await fixture();
    const b = await f.seat('Борис');
    const a = await f.seat('Анна');
    await f.project(b.principal);
    expect(await f.settings(['projects'], 7)).toMatchObject({ periodDays: 7 });
    let data = await f.roster();
    expect(data.items.find((i) => i.seatId === b.id)?.score).toBe(20);
    expect(data.items.find((i) => i.seatId === a.id)?.score).toBe(0);
    await f.settings(['projects'], 30);
    data = await f.roster();
    expect(data.items.find((i) => i.seatId === b.id)?.score).toBe(4);
    expect(data.settings.periodDays).toBe(30);
    await admin.query(
      "UPDATE projects SET created_at=now()-interval '91 days' WHERE owner_principal_id=$1",
      [b.principal],
    );
    await f.settings(['projects'], 90);
    expect((await f.roster()).items.find((i) => i.seatId === b.id)).toMatchObject({
      totalWorks: 1,
      score: 0,
    });
    await f.settings(['days']);
    data = await f.roster();
    expect(data.items.map((i) => [i.seatId, i.score, i.rank])).toEqual([
      [a.id, 0, 1],
      [b.id, 0, 1],
    ]);
    await f.settings([]);
    data = await f.roster();
    expect(data.items.every((i) => i.score === null && i.rank === null)).toBe(true);
    expect(
      await f.write('settings', {
        expectedRevision: 0,
        periodDays: 7,
        factors: data.settings.factors,
      }),
    ).toMatchObject({ error: 'revision_conflict' });
  });
  it('counts only latest manual revisions on the pinned scale, including a zero and a retraction', async () => {
    const f = await fixture();
    const seat = await f.seat('Оценки');
    await f.settings(['grades']);
    const journalWrite = (action: string, input: Record<string, unknown>) =>
      read<Record<string, unknown>>('classroom_journal_write', [
        f.actor,
        f.classId,
        action,
        JSON.stringify({ ...input, requestId: randomUUID() }),
      ]);
    const col = await journalWrite('column', {
      expectedRevision: 0,
      date: new Date().toISOString().slice(0, 10),
      category: 'Практика',
    });
    await journalWrite('grade', {
      columnId: col.id,
      seatId: seat.id,
      expectedRevision: 0,
      value: 0,
    });
    let metrics = (await f.roster()).items[0]!;
    expect(metrics.score).toBe(0);
    expect(metrics.sources.grades).toBe(1);
    await journalWrite('scale', { expectedRevision: 1, preset: 'hundred' });
    await journalWrite('grade', {
      columnId: col.id,
      seatId: seat.id,
      expectedRevision: 1,
      value: 5,
      reason: 'Исправление',
    });
    metrics = (await f.roster()).items[0]!;
    expect(metrics.score).toBe(100);
    expect(metrics.sources.grades).toBe(1);
    const history = await read<{ items: unknown[] }>('classroom_journal_history', [
      f.actor,
      f.classId,
      col.id,
      seat.id,
    ]);
    expect(history.items).toHaveLength(2);
    await journalWrite('grade', {
      columnId: col.id,
      seatId: seat.id,
      expectedRevision: 2,
      value: null,
      reason: 'Отзыв',
    });
    metrics = (await f.roster()).items[0]!;
    expect(metrics.score).toBe(0);
    expect(metrics.sources.grades).toBe(0);
    expect(
      (
        await read<{ items: unknown[] }>('classroom_journal_history', [
          f.actor,
          f.classId,
          col.id,
          seat.id,
        ])
      ).items,
    ).toHaveLength(3);
  });
  it('does not score an idle tab, repeated login clicks or simultaneous activity intervals twice', async () => {
    const f = await fixture();
    const seat = await f.seat('Время');
    const project = await f.project(seat.principal);
    await f.settings(['time']);
    const session1 = randomUUID();
    const session2 = randomUUID();
    for (const id of [session1, session2]) {
      await admin.query(
        `INSERT INTO product_module_sessions(id,actor_kind,principal_id,seat_id,tenant_id,project_id,module_key,network_kind,started_at,last_seen_at) VALUES($1,'student',$2,$3,$4,$5,'three-d','unknown',now()-interval '60 seconds',now())`,
        [id, seat.principal, seat.id, f.teacher.tenantId, project],
      );
      await admin.query(
        `INSERT INTO product_module_activity_slices(session_id,started_at,ended_at,active_seconds) VALUES($1,now()-interval '60 seconds',now(),60)`,
        [id],
      );
    }
    expect((await f.roster()).items[0]?.sources.time).toBe(0);
    await admin.query(`UPDATE project_drafts SET document_json='{"value":1}' WHERE project_id=$1`, [
      project,
    ]);
    const metric = (await f.roster()).items[0]!;
    expect(metric.sources.time).toBeGreaterThanOrEqual(59);
    expect(metric.sources.time).toBeLessThan(61);
    expect(metric.sources.days).toBe(1);
    await admin.query(`UPDATE project_drafts SET revision=revision+1 WHERE project_id=$1`, [
      project,
    ]);
    expect(
      (
        await admin.query(
          `SELECT count(*)::int count FROM classroom_participant_project_edits WHERE project_id=$1`,
          [project],
        )
      ).rows[0].count,
    ).toBe(1);
    for (let i = 0; i < 4; i++)
      await admin.query(
        `INSERT INTO product_analytics_events(actor_kind,principal_id,seat_id,tenant_id,event_type,outcome) VALUES('student',$1,$2,$3,'auth.class_join','succeeded')`,
        [seat.principal, seat.id, f.teacher.tenantId],
      );
    expect((await f.roster()).items[0]?.sources.logins).toBe(1);
  });
  it('uses the selected canonical result once after correction and retains both revisions in history', async () => {
    const f = await fixture();
    const seat = await f.seat('Результат');
    await f.settings(['grades']);
    async function command(sql: string, args: unknown[]) {
      const client = await runtime.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id',$1,true)", [f.teacher.tenantId]);
        const result = await client.query(sql, args);
        await client.query('COMMIT');
        return result.rows[0];
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    const policies = {
      attemptPolicy: { maxAttempts: 2 },
      resultSelectionPolicy: { mode: 'latest_accepted' },
      completionPolicy: { mode: 'accepted' },
      latePolicy: { mode: 'allow_until_close' },
      assessmentPolicy: { mode: 'manual' },
      feedbackReleasePolicy: { mode: 'immediate' },
    };
    const activity = await command(
      "SELECT * FROM learning_activity_create($1,$2,'school','private','project','Rating result','Work','graded',20,$3::jsonb,'electronics',NULL,NULL,NULL,$4)",
      [f.actor, f.teacher.tenantId, JSON.stringify(policies), randomUUID()],
    );
    expect(activity.result_code).toBe('ok');
    const published = await command('SELECT * FROM learning_activity_publish($1,$2,$3,1,$4)', [
      f.actor,
      f.teacher.tenantId,
      activity.activity_id,
      randomUUID(),
    ]);
    expect(published.result_code).toBe('ok');
    const task = (
      await admin.query(
        "INSERT INTO teacher_assignments(tenant_id,owner_principal_id,title,brief,module_key,visibility) VALUES($1,$2,'Rating','Work','electronics','private') RETURNING id",
        [f.teacher.tenantId, f.actor],
      )
    ).rows[0].id;
    const handout = (
      await admin.query(
        "INSERT INTO classroom_assignments(tenant_id,classroom_id,assignment_id,status,created_by) VALUES($1,$2,$3,'open',$4) RETURNING id",
        [f.teacher.tenantId, f.classId, task, f.teacher.teacherId],
      )
    ).rows[0].id as string;
    const run = await command(
      "SELECT * FROM activity_run_create($1,$2,$3,'direct',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'{}'::jsonb,$4)",
      [f.actor, handout, published.activity_version_id, randomUUID()],
    );
    expect(run.result_code).toBe('ok');
    const learner = (
      await admin.query(
        "SELECT learner_identity_id FROM learner_identity_links WHERE seat_id=$1 AND status='active'",
        [seat.id],
      )
    ).rows[0].learner_identity_id;
    const participation = await command(
      'SELECT * FROM activity_participation_assign($1,$2,$3,NULL)',
      [f.actor, run.activity_run_id, learner],
    );
    expect(participation.result_code).toBe('ok');
    const attempt = (
      await admin.query(
        `INSERT INTO learning_attempts(tenant_id,classroom_id,classroom_assignment_id,learning_activity_version_id,seat_id,learner_identity_id,activity_participation_id,attempt_number,state,evaluated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,1,'closed',now()) RETURNING id`,
        [
          f.teacher.tenantId,
          f.classId,
          handout,
          published.activity_version_id,
          seat.id,
          learner,
          participation.participation_id,
        ],
      )
    ).rows[0].id;
    const first = (
      await admin.query(
        `INSERT INTO assessment_results(tenant_id,attempt_id,raw_points,max_points,percentage_basis_points,outcome,review_decision,completion_value,evaluator_principal_id,manual_points,correction_reason)
      VALUES($1,$2,20,20,10000,'passed','accepted',true,$3,20,'Initial') RETURNING id`,
        [f.teacher.tenantId, attempt, f.actor],
      )
    ).rows[0].id;
    expect((await f.roster()).items[0]).toMatchObject({ score: 100, sources: { grades: 1 } });
    await admin.query(
      `INSERT INTO assessment_results(tenant_id,attempt_id,raw_points,max_points,percentage_basis_points,outcome,review_decision,completion_value,evaluator_principal_id,manual_points,revision_number,supersedes_result_id,correction_reason)
      VALUES($1,$2,0,20,0,'failed','accepted',true,$3,0,2,$4,'Correction')`,
      [f.teacher.tenantId, attempt, f.actor, first],
    );
    expect((await f.roster()).items[0]).toMatchObject({ score: 0, sources: { grades: 1 } });
    const history = await read<{ items: Array<{ revision: number; raw_points: number }> }>(
      'classroom_participant_result_history',
      [f.actor, f.classId, seat.id, handout, 0],
    );
    expect(history.items).toHaveLength(2);
    expect(history.items.map((r) => r.revision).sort()).toEqual([1, 2]);
    expect(
      await read('classroom_participant_result_history', [
        seat.principal,
        f.classId,
        seat.id,
        handout,
        0,
      ]),
    ).toBeNull();
  });
  it('keeps the eight built-in awards and scopes secret avatars to the entitled learner and class', async () => {
    const f = await fixture();
    const seat = await f.seat('Награды');
    const other = await f.seat('Другой');
    const image = new PNG({ width: 32, height: 32 });
    image.data.fill(255);
    const avatar = await f.write('avatar', {
      title: 'Первая работа',
      dataUrl: `data:image/png;base64,${PNG.sync.write(image).toString('base64')}`,
      secret: true,
      builtinAward: 'first-model',
    });
    for (const awardKey of [
      'first-model',
      'bright-idea',
      'careful-work',
      'precision',
      'perseverance',
      'helper',
      'explorer',
      'editors-choice',
    ])
      expect(
        await f.write('builtin_grant', {
          seatId: seat.id,
          awardKey,
          note: 'За работу',
          granted: true,
        }),
      ).toHaveProperty('items');
    expect(
      (
        await read<{ items: unknown[] }>('classroom_participant_builtin_awards', [
          seat.principal,
          f.classId,
          seat.id,
        ])
      ).items,
    ).toHaveLength(8);
    expect(
      await read('classroom_participant_avatar_read', [
        seat.principal,
        f.classId,
        seat.id,
        avatar.id,
      ]),
    ).toMatch(/^data:image\/png/);
    expect(
      await read('classroom_participant_avatar_read', [
        other.principal,
        f.classId,
        other.id,
        avatar.id,
      ]),
    ).toBeNull();
    const foreignClass = await f.createClass('Другой класс');
    const foreignSeat = await f.seat('Иной', null, foreignClass);
    expect(
      await read('classroom_participant_avatar_read', [
        f.actor,
        foreignClass,
        foreignSeat.id,
        avatar.id,
      ]),
    ).toBeNull();
    expect(
      await f.write('avatar_grant', { seatId: foreignSeat.id, id: avatar.id, granted: true }),
    ).toMatchObject({ error: 'forbidden' });
    await f.write('builtin_grant', {
      seatId: seat.id,
      awardKey: 'first-model',
      note: null,
      granted: false,
    });
    expect(
      await read('classroom_participant_avatar_read', [
        seat.principal,
        f.classId,
        seat.id,
        avatar.id,
      ]),
    ).toBeNull();
    expect(
      (
        await read<{ items: unknown[] }>('classroom_participant_builtin_awards', [
          seat.principal,
          f.classId,
          seat.id,
        ])
      ).items,
    ).toHaveLength(7);
  });
  it('persists custom merit grants, secret avatar availability and choice, then hides a revoked secret', async () => {
    const f = await fixture();
    const learner = await f.learner();
    const seat = await f.seat('Аватар', learner.id);
    const merit = await f.write('merit', { title: 'Мастер', description: 'За аккуратность' });
    const image = new PNG({ width: 32, height: 32 });
    image.data.fill(255);
    const personal = `data:image/png;base64,${PNG.sync.write(image).toString('base64')}`;
    await admin.query('UPDATE profiles SET avatar_data_url=$2 WHERE account_id=$1', [
      learner.id,
      personal,
    ]);
    const avatar = await f.write('avatar', {
      title: 'Секрет',
      dataUrl: `data:image/png;base64,${PNG.sync.write(image).toString('base64')}`,
      secret: true,
      meritId: merit.id,
      builtinAward: null,
    });
    const own = () =>
      read<{ avatars: unknown[]; merits: unknown[]; metrics: { avatarUrl: string | null } }>(
        'classroom_participant_profile',
        [seat.principal, f.classId, seat.id],
      );
    expect((await own()).avatars).toEqual([]);
    expect(
      await f.write('avatar_choose', { seatId: seat.id, id: avatar.id }, seat.principal),
    ).toMatchObject({ error: 'forbidden' });
    await f.write('merit_grant', { seatId: seat.id, id: merit.id, granted: true });
    expect((await own()).avatars).toHaveLength(1);
    expect((await own()).merits).toHaveLength(1);
    await f.write('avatar_choose', { seatId: seat.id, id: avatar.id }, seat.principal);
    expect((await own()).metrics.avatarUrl).toContain('/api/class-join/participants/avatars/');
    expect(
      await read('classroom_participant_avatar_read', [
        seat.principal,
        f.classId,
        seat.id,
        avatar.id,
      ]),
    ).toMatch(/^data:image\/png/);
    const original = (
      await admin.query(`SELECT avatar_data_url FROM profiles WHERE account_id=$1`, [learner.id])
    ).rows[0].avatar_data_url;
    expect(original).toBe(personal);
    await f.write('merit_grant', { seatId: seat.id, id: merit.id, granted: false });
    expect((await own()).avatars).toEqual([]);
    expect((await own()).metrics.avatarUrl).toBeNull();
    expect(
      await read('classroom_participant_avatar_read', [
        seat.principal,
        f.classId,
        seat.id,
        avatar.id,
      ]),
    ).toBeNull();
    await f.write('avatar_grant', { seatId: seat.id, id: avatar.id, granted: true });
    expect((await own()).avatars).toHaveLength(1);
    await f.write('avatar_grant', { seatId: seat.id, id: avatar.id, granted: false });
    expect((await own()).avatars).toEqual([]);
  });
  it('pages all dated manual grades and revision history without leaking another Seat', async () => {
    const f = await fixture();
    const seat = await f.seat('История');
    const other = await f.seat('Не показывать');
    const write = (action: string, input: Record<string, unknown>) =>
      read<Record<string, unknown>>('classroom_journal_write', [
        f.actor,
        f.classId,
        action,
        JSON.stringify({ ...input, requestId: randomUUID() }),
      ]);
    let firstColumn: unknown;
    for (let i = 0; i < 32; i++) {
      const column = await write('column', {
        expectedRevision: i ? 1 : 0,
        date: '2025-01-01',
        category: `Практика ${i}`,
      });
      expect(column).toHaveProperty('id');
      if (!i) firstColumn = column.id;
      await write('grade', { columnId: column.id, seatId: seat.id, expectedRevision: 0, value: 0 });
      await write('grade', {
        columnId: column.id,
        seatId: other.id,
        expectedRevision: 0,
        value: 5,
      });
    }
    type Grades = {
      journal: { columns: unknown[]; grades: Array<{ seatId: string }>; nextOffset: number | null };
    };
    const first = await read<Grades>('classroom_participant_grades', [
      f.actor,
      f.classId,
      seat.id,
      0,
      0,
    ]);
    expect(first.journal.columns).toHaveLength(30);
    expect(first.journal.nextOffset).toBe(30);
    expect(first.journal.grades.every((g) => g.seatId === seat.id)).toBe(true);
    const next = await read<Grades>('classroom_participant_grades', [
      f.actor,
      f.classId,
      seat.id,
      30,
      0,
    ]);
    expect(next.journal.columns).toHaveLength(2);
    expect(next.journal.nextOffset).toBeNull();
    for (let revision = 1; revision <= 21; revision++)
      await write('grade', {
        columnId: firstColumn,
        seatId: seat.id,
        expectedRevision: revision,
        value: revision % 6,
        reason: 'Исправление',
      });
    const history = await read<{ items: Array<{ revision: number }>; nextBeforeRevision: number }>(
      'classroom_journal_history',
      [f.actor, f.classId, firstColumn, seat.id],
    );
    expect(history.items).toHaveLength(20);
    expect(history.nextBeforeRevision).toBe(3);
    const prior = await read<{ items: Array<{ revision: number }> }>('classroom_journal_history', [
      f.actor,
      f.classId,
      firstColumn,
      seat.id,
      history.nextBeforeRevision,
    ]);
    expect(prior.items.map((r) => r.revision)).toEqual([2, 1]);
    expect(
      await read('classroom_participant_grades', [seat.principal, f.classId, seat.id, 0, 0]),
    ).toBeNull();
  });
  it('enforces bounded custom content and idempotency without duplicate awards', async () => {
    const f = await fixture();
    await f.seat('Пределы');
    expect(await f.write('merit', { title: '<script>', description: '' })).toMatchObject({
      error: 'invalid_title',
    });
    expect(await f.write('merit', { title: 'x'.repeat(61), description: '' })).toMatchObject({
      error: 'invalid_title',
    });
    const id = randomUUID();
    const first = await f.write('merit', { title: 'Первая', description: '' }, f.actor, id);
    expect(await f.write('merit', { title: 'Первая', description: '' }, f.actor, id)).toEqual(
      first,
    );
    expect(await f.write('merit', { title: 'Другая', description: '' }, f.actor, id)).toMatchObject(
      { error: 'idempotency_conflict' },
    );
    for (let i = 1; i < 24; i++) await f.write('merit', { title: `Заслуга ${i}`, description: '' });
    expect(await f.write('merit', { title: 'Лишняя', description: '' })).toMatchObject({
      error: 'limit_reached',
    });
    expect(
      (
        await admin.query(
          `SELECT count(*)::int count FROM classroom_custom_merits WHERE classroom_id=$1`,
          [f.classId],
        )
      ).rows[0].count,
    ).toBe(24);
  });
  it('uses current staff scopes, hides unrelated classes and does not grant managers teacher APIs', async () => {
    const f = await fixture();
    const second = await f.createClass('Второй доступный');
    const manager = await f.learner();
    const workspace = (
      await admin.query('SELECT id FROM workspaces WHERE tenant_id=$1', [f.teacher.tenantId])
    ).rows[0].id;
    await admin.query(
      "INSERT INTO workspace_memberships(account_id,workspace_id,role) VALUES($1,$2,'school_admin')",
      [manager.id, workspace],
    );
    const profile = await read<{ classes: Array<{ id: string; role: string }>; grades?: unknown }>(
      'classroom_participant_staff',
      [f.actor, f.classId, manager.id],
    );
    expect(profile.classes.map((c) => c.id).sort()).toEqual([f.classId, second].sort());
    expect(profile.classes.every((c) => c.role === 'school_admin')).toBe(true);
    expect(profile.grades).toBeUndefined();
    expect(await read('classroom_participant_roster', [manager.principal, f.classId])).toBeNull();
    const staff = await read<{ classes: Array<{ id: string; role: string }> }>(
      'classroom_participant_staff',
      [f.actor, f.classId, f.account],
    );
    expect(staff.classes).toContainEqual({ id: f.classId, title: 'Участники', role: 'owner' });
    await admin.query('DELETE FROM classroom_memberships WHERE classroom_id=$1 AND account_id=$2', [
      second,
      f.account,
    ]);
    expect(
      (
        await read<{ classes: Array<{ id: string }> }>('classroom_participant_staff', [
          f.actor,
          f.classId,
          manager.id,
        ])
      ).classes.map((c) => c.id),
    ).toEqual([f.classId]);
    await admin.query(
      "UPDATE workspace_memberships SET state='revoked' WHERE account_id=$1 AND workspace_id=$2",
      [manager.id, workspace],
    );
    expect(await read('classroom_participant_staff', [f.actor, f.classId, manager.id])).toBeNull();
    expect(await read('classroom_participant_managers', [f.actor, f.classId])).toEqual([]);
  });
  it('revokes Account link access without borrowing the neighbouring Seat identity or helper powers', async () => {
    const f = await fixture();
    const account = await f.learner();
    const seat = await f.seat('Связь', account.id);
    await f.project(account.principal);
    await f.project(seat.principal);
    await f.write('role', { seatId: seat.id, role: 'helper' });
    expect(await read('classroom_participant_roster', [account.principal, f.classId])).toBeNull();
    expect(await f.write('settings', {}, account.principal)).toMatchObject({ error: 'forbidden' });
    await admin.query(
      "UPDATE learner_identity_links SET status='inactive',disabled_at=now() WHERE account_id=$1",
      [account.id],
    );
    await read('classroom_participant_prepare', [f.actor, [f.classId]]);
    expect(
      await read('classroom_participant_profile', [account.principal, f.classId, seat.id]),
    ).toBeNull();
    expect((await f.roster()).items[0]?.totalWorks).toBe(1);
    expect(
      (
        await read<{ metrics: Metric }>('classroom_participant_profile', [
          seat.principal,
          f.classId,
          seat.id,
        ])
      ).metrics.totalWorks,
    ).toBe(1);
    await admin.query('DELETE FROM classroom_memberships WHERE classroom_id=$1 AND account_id=$2', [
      f.classId,
      f.account,
    ]);
    expect(await read('classroom_participant_roster', [f.actor, f.classId])).toBeNull();
    expect(await f.write('merit', { title: 'Нет', description: '' })).toMatchObject({
      error: 'forbidden',
    });
  });
  it('denies outsiders, helper privilege escalation, revoked canonical links and archive mutations', async () => {
    const f = await fixture();
    const seat = await f.seat('Помощник');
    const foreign = await f.learner();
    await f.project(seat.principal);
    await f.write('role', { seatId: seat.id, role: 'helper' });
    expect(await read('classroom_participant_roster', [seat.principal, f.classId])).toBeNull();
    expect(
      await read('classroom_participant_profile', [foreign.principal, f.classId, seat.id]),
    ).toBeNull();
    expect(await f.write('role', { seatId: seat.id, role: 'co_teacher' })).toMatchObject({
      error: 'invalid_role',
    });
    expect(await f.write('merit', { title: 'Нет', description: '' }, seat.principal)).toMatchObject(
      { error: 'forbidden' },
    );
    await admin.query(
      `UPDATE learner_identity_links SET status='inactive',disabled_at=now() WHERE seat_id=$1`,
      [seat.id],
    );
    await read('classroom_participant_prepare', [f.actor, [f.classId]]);
    expect(await read('classroom_participant_profile', [f.actor, f.classId, seat.id])).toBeNull();
    expect(
      await read('classroom_participant_works', [
        f.actor,
        f.classId,
        seat.id,
        null,
        true,
        false,
        0,
      ]),
    ).toBeNull();
    expect(await f.write('role', { seatId: seat.id, role: 'student' })).toMatchObject({
      error: 'forbidden',
    });
    await admin.query(`UPDATE classrooms SET status='archived' WHERE id=$1`, [f.classId]);
    expect(await f.settings([])).toMatchObject({ error: 'classroom_archived' });
    await expect(runtime.query(`SELECT * FROM classroom_custom_avatars`)).rejects.toMatchObject({
      code: '42501',
    });
    await expect(
      runtime.query(`SELECT * FROM classroom_participant_project_edits`),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
