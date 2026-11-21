import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { testAdminPool, testAppPool } from '../portal/helpers';
import { aiIdentity, aiClassFixture } from './ai-student-access.contract';
let admin: pg.Pool, runtime: pg.Pool;
beforeAll(() => {
  for (const key of ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL'])
    if (!process.env[key] || !new URL(process.env[key]!).pathname.endsWith('_test'))
      throw new Error('Isolated _test database required');
  admin = testAdminPool();
  runtime = testAppPool();
});
afterAll(async () => {
  await runtime?.end();
  await admin?.end();
});
async function fixture() {
  const actor = await aiIdentity(admin),
    target = await aiIdentity(admin),
    school = await aiClassFixture(admin, runtime);
  await admin.query(
    "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','test','admin')",
    [actor.account_id],
  );
  return { actor, target, school };
}
async function card(actor: string, kind: string, target: string, classroom: string | null = null) {
  return (
    await runtime.query('SELECT crm_card($1,$2,$3,$4,$5) AS value', [
      actor,
      kind,
      target,
      classroom,
      randomUUID(),
    ])
  ).rows[0].value;
}
async function update(
  actor: string,
  kind: string,
  target: string,
  version: string,
  name = 'Новое имя',
  birth: string | null = '1990-03-04',
) {
  return (
    await runtime.query(
      'SELECT crm_profile_update($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10) AS value',
      [
        actor,
        kind,
        target,
        version,
        name,
        birth,
        'RU',
        'Обновлённое описание',
        'Просьба пользователя',
        randomUUID(),
      ],
    )
  ).rows[0].value;
}
it('reads and edits canonical profiles with exact version, age policy and immutable before/after audit', async () => {
  const f = await fixture(),
    before = await card(f.actor.principal_id, 'account', f.target.account_id);
  const after = await update(f.actor.principal_id, 'account', f.target.account_id, before.version);
  expect(after).toMatchObject({
    name: 'Новое имя',
    bio: 'Обновлённое описание',
    birthDate: '1990-03-04',
    canEdit: true,
  });
  expect(after.version).not.toBe(before.version);
  expect(
    (
      await admin.query('SELECT display_name,bio FROM profiles WHERE account_id=$1', [
        f.target.account_id,
      ])
    ).rows[0],
  ).toEqual({ display_name: 'Новое имя', bio: 'Обновлённое описание' });
  await expect(
    update(
      f.actor.principal_id,
      'account',
      f.target.account_id,
      before.version,
      'Потерянная правка',
    ),
  ).rejects.toMatchObject({ code: '40001' });
  await expect(
    update(
      f.actor.principal_id,
      'account',
      f.target.account_id,
      after.version,
      'Ребёнок',
      '2020-01-01',
    ),
  ).rejects.toMatchObject({ code: '22023' });
  const event = (
    await admin.query(
      "SELECT * FROM administrative_audit_events WHERE target_id=$1 AND action='crm.profile.update'",
      [f.target.account_id],
    )
  ).rows[0];
  expect(event.actor_principal_id).toBe(f.actor.principal_id);
  expect(event.reason_text).toBe('Просьба пользователя');
  expect(event.metadata_json.before.name).toBe(before.name);
  expect(event.metadata_json.after.name).toBe('Новое имя');
  await expect(
    admin.query("UPDATE administrative_audit_events SET reason_text='tampered' WHERE id=$1", [
      event.id,
    ]),
  ).rejects.toThrow();
  expect(JSON.stringify(after)).not.toMatch(/password_hash|login_handle|token_hash/);
});
it('teacher sees only exact-class Seat data without linked personal Account authority and loses access immediately on revoke', async () => {
  const f = await fixture(),
    other = await aiClassFixture(admin, runtime);
  await admin.query('UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2', [
    f.target.account_id,
    f.school.seatId,
  ]);
  const teacher = await card(
    f.school.teacher.principal_id,
    'student',
    f.school.seatId,
    f.school.classroomId,
  );
  expect(teacher).toMatchObject({
    canEdit: false,
    canManageCapabilities: false,
    linkedIdentities: [],
    email: null,
  });
  expect((await card(f.actor.principal_id, 'student', f.school.seatId)).linkedIdentities).toEqual([
    { kind: 'account', id: f.target.account_id },
  ]);
  await expect(
    card(f.school.teacher.principal_id, 'account', f.target.account_id, f.school.classroomId),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    card(f.school.teacher.principal_id, 'student', other.seatId, f.school.classroomId),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(
    card(f.school.teacher.principal_id, 'student', f.school.seatId),
  ).rejects.toMatchObject({ code: '42501' });
  await admin.query('DELETE FROM classroom_memberships WHERE classroom_id=$1 AND account_id=$2', [
    f.school.classroomId,
    f.school.teacher.account_id,
  ]);
  await expect(
    card(f.school.teacher.principal_id, 'student', f.school.seatId, f.school.classroomId),
  ).rejects.toMatchObject({ code: '42501' });
});
it('preserves full actual transcript text past fifty messages with microsecond cursor and denies target/category/class reuse', async () => {
  const f = await fixture();
  const thread = (
    await admin.query(
      "INSERT INTO ai_assistant_threads(account_id,owner_principal_id,title) VALUES($1,$2,'История') RETURNING id",
      [f.target.account_id, f.target.principal_id],
    )
  ).rows[0].id;
  for (let index = 0; index < 57; index++)
    await admin.query(
      "INSERT INTO ai_assistant_messages(thread_id,account_id,owner_principal_id,request_id,role,content,created_at) VALUES($1,$2,$3,$4,'user',$5,'2026-10-25T10:00:00.000001Z')",
      [
        thread,
        f.target.account_id,
        f.target.principal_id,
        randomUUID(),
        `Вопрос №${index} <script>не выполнять</script>`,
      ],
    );
  const read = async (
    options: {
      actor?: string;
      target?: string;
      category?: string;
      cursor?: unknown;
      limit?: number;
    } = {},
  ) =>
    (
      await runtime.query('SELECT crm_content_page($1,$2,$3,$4,$5,$6,$7::jsonb,$8) AS value', [
        options.actor ?? f.actor.principal_id,
        'account',
        options.target ?? f.target.account_id,
        null,
        options.category ?? 'messages',
        options.limit ?? 13,
        options.cursor ? JSON.stringify(options.cursor) : null,
        randomUUID(),
      ])
    ).rows[0].value;
  const first = await read();
  expect(first.next.last.at).toContain('.000001');
  let cursor = null;
  const items = [];
  let pages = 0;
  do {
    const page = await read({ cursor });
    items.push(...page.items);
    cursor = page.next;
    expect(++pages).toBeLessThan(8);
  } while (cursor);
  expect(items).toHaveLength(57);
  expect(new Set(items.map((item) => item.id)).size).toBe(57);
  expect(items[0].text).toContain('<script>не выполнять</script>');
  for (const options of [
    { target: f.actor.account_id },
    { category: 'projects' },
    { cursor: { ...first.next, asOf: 'infinity' } },
    { limit: 51 },
  ])
    await expect(read({ cursor: first.next, ...options })).rejects.toMatchObject({ code: '22023' });
  await admin.query(
    "UPDATE capability_grants SET state='revoked' WHERE account_id=$1 AND capability='platform_admin'",
    [f.actor.account_id],
  );
  await expect(read({ cursor: first.next })).rejects.toMatchObject({ code: '42501' });
});
it('reads exact owned drafts and saved versions without mutations or foreign project access', async () => {
  const f = await fixture();
  const project = (
    await admin.query(
      "INSERT INTO projects(tenant_id,owner_principal_id,title,module_key,project_scope,status) VALUES($1,$2,'Схема','electronics','personal','archived') RETURNING id",
      [f.target.tenant_id, f.target.principal_id],
    )
  ).rows[0].id;
  await admin.query(
    'INSERT INTO project_drafts(project_id,tenant_id,document_json,revision,updated_by_principal_id) VALUES($1,$2,\'{"circuit":"full retained contents"}\',3,$3)',
    [project, f.target.tenant_id, f.target.principal_id],
  );
  const version = (
    await admin.query(
      'INSERT INTO project_versions(project_id,tenant_id,version_no,document_json,created_by_principal_id) VALUES($1,$2,1,\'{"circuit":"old version"}\',$3) RETURNING id',
      [project, f.target.tenant_id, f.target.principal_id],
    )
  ).rows[0].id;
  const read = async (target: string, versionId: string | null = null) =>
    (
      await runtime.query('SELECT crm_project_read($1,$2,$3,$4,$5,$6,$7) AS value', [
        f.actor.principal_id,
        'account',
        target,
        null,
        project,
        versionId,
        randomUUID(),
      ])
    ).rows[0].value;
  expect((await read(f.target.account_id)).document).toEqual({ circuit: 'full retained contents' });
  expect((await read(f.target.account_id, version)).document).toEqual({ circuit: 'old version' });
  await admin.query(
    "INSERT INTO projects(tenant_id,owner_principal_id,title,module_key,project_scope,status) SELECT $1,$2,'Страничный проект','electronics','personal','active' FROM generate_series(1,57)",
    [f.target.tenant_id, f.target.principal_id],
  );
  let cursor = null;
  let total = 0;
  let pages = 0;
  do {
    const page = (
      await runtime.query('SELECT crm_content_page($1,$2,$3,NULL,$4,13,$5::jsonb,$6) AS value', [
        f.actor.principal_id,
        'account',
        f.target.account_id,
        'projects',
        cursor ? JSON.stringify(cursor) : null,
        randomUUID(),
      ])
    ).rows[0].value;
    total += page.items.length;
    cursor = page.next;
    expect(++pages).toBeLessThan(8);
  } while (cursor);
  expect(total).toBe(58);
  await expect(read(f.actor.account_id)).rejects.toMatchObject({ code: '42501' });
  await expect(read(f.target.account_id, randomUUID())).rejects.toMatchObject({ code: '22023' });
  expect(
    (
      await admin.query('SELECT revision,document_json FROM project_drafts WHERE project_id=$1', [
        project,
      ])
    ).rows[0],
  ).toEqual({ revision: 3, document_json: { circuit: 'full retained contents' } });
});
it('serializes concurrent admin revoke/suspend before rechecking actor authority', async () => {
  const f = await fixture();
  await admin.query(
    "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','test','admin')",
    [f.target.account_id],
  );
  const a = await runtime.connect(),
    b = await runtime.connect();
  try {
    await a.query('BEGIN');
    await b.query('BEGIN');
    const bpid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await a.query('SELECT admin_set_platform_admin($1,$2,false,$3,$4)', [
      f.actor.principal_id,
      f.target.account_id,
      'Отзыв прав по обращению',
      randomUUID(),
    ]);
    const blocked = b
      .query("SELECT admin_set_account_status($1,$2,'suspended',$3,$4)", [
        f.target.principal_id,
        f.actor.account_id,
        'Конкурирующий отзыв',
        randomUUID(),
      ])
      .then(
        () => null,
        (failure: { code: string }) => failure.code,
      );
    await expect
      .poll(
        async () =>
          (
            await admin.query(
              "SELECT count(*)::int n FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted",
              [bpid],
            )
          ).rows[0].n,
        { timeout: 2000, interval: 10 },
      )
      .toBe(1);
    await a.query('COMMIT');
    expect(await blocked).toBe('42501');
    await b.query('ROLLBACK');
    expect(
      (await admin.query('SELECT status FROM accounts WHERE id=$1', [f.actor.account_id])).rows[0]
        .status,
    ).toBe('active');
  } finally {
    await a.query('ROLLBACK');
    await b.query('ROLLBACK');
    a.release();
    b.release();
  }
});
it('pages every retained Seat session and observed event without credentials or first-eight truncation', async () => {
  const f = await fixture();
  await admin.query(
    "INSERT INTO classroom_student_sessions(seat_id,token_hash,expires_at) SELECT $1,md5(random()::text),now()+interval '1 hour' FROM generate_series(1,57)",
    [f.school.seatId],
  );
  await admin.query(
    "INSERT INTO product_analytics_events(actor_kind,principal_id,seat_id,tenant_id,event_type,outcome,occurred_at,persisted_at) SELECT 'student',$1,$2,$3,'visit.observed','succeeded',clock_timestamp()-interval '1 day',clock_timestamp() FROM generate_series(1,57)",
    [f.school.principalId, f.school.seatId, f.school.context.tenant_id],
  );
  for (const category of ['sessions', 'events']) {
    let cursor = null;
    let count = 0;
    const ids = new Set();
    let pages = 0;
    do {
      const page = (
        await runtime.query('SELECT crm_content_page($1,$2,$3,$4,$5,$6,$7::jsonb,$8) AS value', [
          f.school.teacher.principal_id,
          'student',
          f.school.seatId,
          f.school.classroomId,
          category,
          13,
          cursor ? JSON.stringify(cursor) : null,
          randomUUID(),
        ])
      ).rows[0].value;
      expect(JSON.stringify(page)).not.toContain('token_hash');
      count += page.items.length;
      for (const item of page.items) ids.add(item.id);
      cursor = page.next;
      expect(++pages).toBeLessThan(8);
    } while (cursor);
    expect(count).toBe(57);
    expect(ids.size).toBe(57);
  }
});
it('edits optional Seat age and access without touching linked Account, revokes Seat sessions and audits explicit capabilities', async () => {
  const f = await fixture(),
    seat = await card(f.actor.principal_id, 'student', f.school.seatId);
  const updated = await update(
    f.actor.principal_id,
    'student',
    f.school.seatId,
    seat.version,
    'Ученик CRM',
    '2015-01-01',
  );
  expect(updated.age).toBeGreaterThan(0);
  expect(updated.birthDate).toBe('2015-01-01');
  await admin.query(
    "INSERT INTO classroom_student_sessions(seat_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",
    [f.school.seatId, randomUUID().replaceAll('-', '')],
  );
  const value = (
    await runtime.query('SELECT crm_student_status_update($1,$2,$3,$4,$5,$6) AS value', [
      f.actor.principal_id,
      f.school.seatId,
      updated.version,
      'suspended',
      'Обращение школы',
      randomUUID(),
    ])
  ).rows[0].value;
  expect(value.status).toBe('suspended');
  expect(
    (
      await admin.query('SELECT revoked_at FROM classroom_student_sessions WHERE seat_id=$1', [
        f.school.seatId,
      ])
    ).rows.every((row) => row.revoked_at),
  ).toBe(true);
  const target = await card(f.actor.principal_id, 'account', f.target.account_id);
  const grant = (
    await runtime.query('SELECT crm_capability_update($1,$2,$3,$4,$5,$6,$7) AS value', [
      f.actor.principal_id,
      f.target.account_id,
      target.version,
      'educator',
      'verified',
      'Назначение преподавателя',
      randomUUID(),
    ])
  ).rows[0].value;
  expect(grant.capabilities).toContainEqual({ capability: 'educator', state: 'verified' });
  await expect(
    runtime.query('SELECT crm_capability_update($1,$2,$3,$4,$5,$6,$7)', [
      f.actor.principal_id,
      f.actor.account_id,
      target.version,
      'platform_admin',
      'verified',
      'Нельзя подменить право',
      randomUUID(),
    ]),
  ).rejects.toMatchObject({ code: '22023' });
  await expect(runtime.query('SELECT * FROM crm_student_profiles')).rejects.toMatchObject({
    code: '42501',
  });
});
