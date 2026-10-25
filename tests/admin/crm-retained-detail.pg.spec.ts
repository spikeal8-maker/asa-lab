import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { testAdminPool, testAppPool } from '../portal/helpers';
import { aiClassFixture, aiIdentity } from './ai-student-access.contract';
let admin: pg.Pool, runtime: pg.Pool;
beforeAll(() => {
  for (const key of ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL'])
    if (
      !process.env[key] ||
      !decodeURIComponent(new URL(process.env[key]!).pathname).endsWith('_test')
    )
      throw new Error('Isolated _test database required');
  admin = testAdminPool();
  runtime = testAppPool();
});
afterAll(async () => {
  await runtime?.end();
  await admin?.end();
});
it('retains paginated immutable educational notes with reasons, concurrency checks and exact-class denial', async () => {
  const f = await aiClassFixture(admin, runtime),
    foreign = await aiClassFixture(admin, runtime);
  const read = async (cursor: unknown = null, actor = f.teacher.principal_id, seat = f.seatId) =>
    (
      await runtime.query('SELECT crm_seat_notes_page($1,$2,$3,2,$4::jsonb,$5) value', [
        actor,
        seat,
        f.classroomId,
        cursor ? JSON.stringify(cursor) : null,
        randomUUID(),
      ])
    ).rows[0].value;
  const add = async (version: string, text: string) =>
    (
      await runtime.query('SELECT crm_seat_note_add($1,$2,$3,$4,$5,$6,$7) value', [
        f.teacher.principal_id,
        f.seatId,
        f.classroomId,
        version,
        text,
        'Учебное наблюдение',
        randomUUID(),
      ])
    ).rows[0].value;
  const empty = await read();
  let version = empty.version;
  for (let n = 0; n < 5; n++) {
    version = (await add(version, `Заметка ${n} <script>literal</script>`)).version;
  }
  await expect(add(empty.version, 'Lost append')).rejects.toMatchObject({ code: '40001' });
  let cursor = null;
  const ids: string[] = [];
  do {
    const page = await read(cursor);
    ids.push(...page.items.map((x: { id: string }) => x.id));
    cursor = page.next;
  } while (cursor);
  expect(new Set(ids).size).toBe(5);
  await expect(
    runtime.query('UPDATE crm_seat_notes SET body=$1 WHERE id=$2', ['rewrite', ids[0]]),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(admin.query('DELETE FROM crm_seat_notes WHERE id=$1', [ids[0]])).rejects.toThrow();
  await expect(read(null, foreign.teacher.principal_id)).rejects.toMatchObject({ code: '42501' });
  await expect(read(null, f.teacher.principal_id, foreign.seatId)).rejects.toMatchObject({
    code: '42501',
  });
  const page = await read();
  await expect(read({ ...page.next, fingerprint: 'wrong' })).rejects.toMatchObject({
    code: '22023',
  });
  expect(
    (
      await admin.query(
        "SELECT count(*)::int n FROM administrative_audit_events WHERE target_id=$1 AND action='crm.notes.add' AND reason_text='Учебное наблюдение' AND metadata_json->'after'->>'noteId' IS NOT NULL",
        [f.seatId],
      )
    ).rows[0].n,
  ).toBe(5);
});
it('reads retained Seat versions, publications and exact AI receipts without linked Account history, and revocation closes continuation', async () => {
  const f = await aiClassFixture(admin, runtime),
    linked = await aiIdentity(admin);
  await admin.query('UPDATE classroom_student_seats SET account_id=$1 WHERE id=$2', [
    linked.account_id,
    f.seatId,
  ]);
  const project = (
    await admin.query(
      "INSERT INTO projects(tenant_id,owner_principal_id,title,module_key,project_scope,classroom_id,status) VALUES($1,$2,'Учебный проект','electronics','classroom',$3,'active') RETURNING id",
      [f.context.tenant_id, f.principalId, f.classroomId],
    )
  ).rows[0].id;
  const version = (
    await admin.query(
      'INSERT INTO project_versions(tenant_id,project_id,version_no,document_json,created_by_principal_id) VALUES($1,$2,1,\'{"private":"NO_DOCUMENT"}\',$3) RETURNING id',
      [f.context.tenant_id, project, f.principalId],
    )
  ).rows[0].id;
  const publication = (
    await admin.query(
      "INSERT INTO project_publication_state(tenant_id,project_id,owner_principal_id,created_by_principal_id,state) VALUES($1,$2,$3,$3,'revoked') RETURNING id",
      [f.context.tenant_id, project, f.principalId],
    )
  ).rows[0].id;
  await admin.query(
    "INSERT INTO project_publication_revisions(publication_id,tenant_id,project_id,revision_no,project_version_id,title,published_by_principal_id) VALUES($1,$2,$3,1,$4,'Публикация',$5)",
    [publication, f.context.tenant_id, project, version, f.principalId],
  );
  await admin.query(
    "INSERT INTO projects(tenant_id,owner_principal_id,title,module_key,project_scope,status) VALUES($1,$2,'ACCOUNT_PRIVATE','electronics','personal','active')",
    [linked.tenant_id, linked.principal_id],
  );
  await admin.query(
    "INSERT INTO ai_usage_journal(owner_principal_id,request_id,seat_id,status,input_tokens,output_tokens) VALUES($1,$2,$3,'admitted',NULL,0)",
    [f.principalId, randomUUID(), f.seatId],
  );
  await admin.query(
    "INSERT INTO ai_usage_journal(owner_principal_id,request_id,account_id,status) VALUES($1,$2,$3,'admitted')",
    [linked.principal_id, randomUUID(), linked.account_id],
  );
  const read = async (category: string, cursor: unknown = null) =>
    (
      await runtime.query('SELECT crm_seat_history($1,$2,$3,$4,1,$5::jsonb,$6) value', [
        f.teacher.principal_id,
        f.seatId,
        f.classroomId,
        category,
        cursor ? JSON.stringify(cursor) : null,
        randomUUID(),
      ])
    ).rows[0].value;
  const first = await read('projects'),
    second = await read('projects', first.next);
  expect([...first.items, ...second.items].map((x) => x.type).sort()).toEqual([
    'project',
    'version',
  ]);
  expect(JSON.stringify([first, second])).not.toMatch(/ACCOUNT_PRIVATE|NO_DOCUMENT/);
  expect((await read('publications')).items[0]).toMatchObject({
    type: 'publication',
    status: 'revoked',
  });
  expect((await read('ai')).items).toHaveLength(1);
  expect((await read('ai')).items[0]).toMatchObject({ inputTokens: null, outputTokens: '0' });
  await expect(read('ai', first.next)).rejects.toMatchObject({ code: '22023' });
  await admin.query('DELETE FROM classroom_memberships WHERE classroom_id=$1 AND account_id=$2', [
    f.classroomId,
    f.teacher.account_id,
  ]);
  await expect(read('projects', first.next)).rejects.toMatchObject({ code: '42501' });
});
it('uses explicit organization-class binding and current membership, never linked Account metadata', async () => {
  const f = await aiClassFixture(admin, runtime),
    manager = await aiIdentity(admin);
  const tenant = (
    await admin.query(
      "INSERT INTO tenants(title,workspace_slug) VALUES('Detail organization',$1) RETURNING id",
      [randomUUID()],
    )
  ).rows[0].id;
  const workspace = (
    await admin.query(
      "INSERT INTO workspaces(tenant_id,kind,title) VALUES($1,'organization','Detail school') RETURNING id",
      [tenant],
    )
  ).rows[0].id;
  await admin.query(
    "INSERT INTO workspace_memberships(account_id,workspace_id,role,state) VALUES($1,$2,'school_admin','active')",
    [manager.account_id, workspace],
  );
  const read = async () =>
    (
      await runtime.query("SELECT crm_seat_history($1,$2,$3,'projects',25,NULL,$4) value", [
        manager.principal_id,
        f.seatId,
        f.classroomId,
        randomUUID(),
      ])
    ).rows[0].value;
  await expect(read()).rejects.toMatchObject({ code: '42501' });
  await admin.query(
    'INSERT INTO crm_organization_classes(classroom_id,workspace_id,assigned_by) VALUES($1,$2,$3)',
    [f.classroomId, workspace, manager.principal_id],
  );
  expect((await read()).coverage).toBe('retained');
  await admin.query(
    "UPDATE workspace_memberships SET state='revoked' WHERE workspace_id=$1 AND account_id=$2",
    [workspace, manager.account_id],
  );
  await expect(read()).rejects.toMatchObject({ code: '42501' });
});
it('rolls back the append if its administrative audit fails', async () => {
  const f = await aiClassFixture(admin, runtime);
  const version = (
    await runtime.query('SELECT crm_seat_notes_page($1,$2,$3,25,NULL,$4) value', [
      f.teacher.principal_id,
      f.seatId,
      f.classroomId,
      randomUUID(),
    ])
  ).rows[0].value.version;
  const suffix = randomUUID().replaceAll('-', ''),
    fn = `crm_note_audit_fail_${suffix}`;
  await admin.query(
    `CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='crm.notes.add' AND NEW.target_id=TG_ARGV[0] THEN RAISE EXCEPTION 'isolated audit failure'; END IF; RETURN NEW; END; $$`,
  );
  try {
    await admin.query(
      `CREATE TRIGGER ${fn} BEFORE INSERT ON administrative_audit_events FOR EACH ROW EXECUTE FUNCTION public.${fn}('${f.seatId}')`,
    );
    await expect(
      runtime.query('SELECT crm_seat_note_add($1,$2,$3,$4,$5,$6,$7)', [
        f.teacher.principal_id,
        f.seatId,
        f.classroomId,
        version,
        'Should rollback',
        'Audit failure proof',
        randomUUID(),
      ]),
    ).rejects.toThrow('isolated audit failure');
    expect(
      (await admin.query('SELECT count(*)::int n FROM crm_seat_notes WHERE seat_id=$1', [f.seatId]))
        .rows[0].n,
    ).toBe(0);
  } finally {
    await admin.query(`DROP TRIGGER IF EXISTS ${fn} ON administrative_audit_events`);
    await admin.query(`DROP FUNCTION public.${fn}()`);
  }
});
