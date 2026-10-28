import { withLocalFixtureAdmissions } from './ai-model-policy.fixture';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { testAdminPool, testAppPool } from '../portal/helpers';
import { aiIdentity, aiClassFixture } from './ai-student-access.contract';
let admin: pg.Pool, runtime: pg.Pool;
beforeAll(() => {
  for (const name of ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL'])
    if (
      !process.env[name] ||
      !decodeURIComponent(new URL(process.env[name]!).pathname).endsWith('_test')
    )
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
    foreign = await aiIdentity(admin);
  await admin.query(
    "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','test','admin')",
    [actor.account_id],
  );
  const ids = Array.from({ length: 57 }, () => randomUUID());
  for (const id of ids) {
    await admin.query(
      "INSERT INTO projects(id,tenant_id,owner_principal_id,title,module_key,project_scope,status,created_at) VALUES($1,$2,$3,'Исторический проект','electronics','personal','active','2026-10-24T12:00:00.000001Z')",
      [id, target.tenant_id, target.principal_id],
    );
    const version = (
      await admin.query(
        'INSERT INTO project_versions(tenant_id,project_id,version_no,document_json,created_by_principal_id,created_at) VALUES($1,$2,1,\'{"private":"NEVER_EXPOSE_DOCUMENT"}\',$3,\'2026-10-24T12:00:00.000002Z\') RETURNING id',
        [target.tenant_id, id, target.principal_id],
      )
    ).rows[0].id;
    const publication = (
      await admin.query(
        "INSERT INTO project_publication_state(tenant_id,project_id,owner_principal_id,created_by_principal_id,state) VALUES($1,$2,$3,$3,'revoked') RETURNING id",
        [target.tenant_id, id, target.principal_id],
      )
    ).rows[0].id;
    await admin.query(
      "INSERT INTO project_publication_revisions(publication_id,tenant_id,project_id,revision_no,project_version_id,title,published_by_principal_id,published_at) VALUES($1,$2,$3,1,$4,'Публикация',$5,'2026-10-24T12:00:00.000003Z')",
      [publication, target.tenant_id, id, version, target.principal_id],
    );
    await admin.query(
      "INSERT INTO ai_usage_journal(owner_principal_id,request_id,account_id,admitted_at,status,input_tokens,output_tokens) VALUES($1,$2,$3,'2026-10-24T12:00:00.000004Z','admitted',NULL,0)",
      [target.principal_id, id, target.account_id],
    );
  }
  const call = async (options: Record<string, unknown> = {}) =>
    (
      await ((options.connection as Pick<pg.Pool, 'query'> | undefined) ?? runtime).query(
        'SELECT admin_user_history($1,$2,$3,$4,$5,$6,$7,$8::jsonb) AS value',
        [
          options.actor ?? actor.principal_id,
          options.scope ?? 'platform',
          options.scopeId ?? null,
          options.kind ?? 'account',
          options.target ?? target.account_id,
          options.category ?? 'projects',
          options.limit ?? 13,
          options.cursor ? JSON.stringify(options.cursor) : null,
        ],
      )
    ).rows[0].value;
  return { actor, target, foreign, ids, call };
}
it('pages every retained project/version, publication and AI request beyond fifty without gaps or duplicates and preserves microseconds', async () => {
  const f = await fixture();
  for (const [category, total] of [
    ['projects', 114],
    ['publications', 57],
    ['ai', 57],
  ] as const) {
    const items: any[] = [];
    let cursor = null;
    let n = 0;
    do {
      const page = await f.call({ category, cursor });
      items.push(...page.items);
      cursor = page.next;
      expect(++n).toBeLessThan(15);
    } while (cursor);
    expect(items).toHaveLength(total);
    expect(new Set(items.map((x) => x.key)).size).toBe(total);
    expect(JSON.stringify(items)).not.toContain('NEVER_EXPOSE_DOCUMENT');
    if (category === 'projects') expect(items[0].occurredAt).toContain('.000002');
    if (category === 'publications') expect(items.every((x) => x.status === 'revoked')).toBe(true);
    if (category === 'ai') {
      expect(items[0].inputTokens).toBeNull();
      expect(items[0].outputTokens).toBe('0');
    }
  }
});
it('includes retained pre-journal AI admissions without duplicating journaled requests or inventing tokens/results', async () => {
  const f = await fixture();
  const request = randomUUID();
  await withLocalFixtureAdmissions(
    admin,
    f.actor.principal_id,
    f.target.principal_id,
    [request],
    async (client) => {
      expect((await f.call({ category: 'ai', limit: 100, connection: client })).items).toHaveLength(
        58,
      );
      // Simulate a retained pre-0244 admission in this isolated test's own rows.
      await client.query(
        'DELETE FROM ai_usage_journal WHERE owner_principal_id=$1 AND request_id=$2',
        [f.target.principal_id, request],
      );
      const page = await f.call({ category: 'ai', limit: 100, connection: client });
      expect(page.items).toHaveLength(58);
      const old = page.items.find((item: { id: string }) => item.id === request);
      expect(old).toMatchObject({
        status: 'legacy_unknown',
        title: 'Сохранённый запрос без подробных сведений',
      });
      expect(old.inputTokens ?? null).toBeNull();
      expect(old.model ?? null).toBeNull();
    },
  );
});
it('retains separately labelled legacy gallery records even when new publication revisions exist', async () => {
  const f = await fixture();
  await admin.query(
    "INSERT INTO project_publications(project_id,tenant_id,owner_principal_id,published_by_principal_id,title,module_key,author_label,snapshot_revision,published_at) VALUES($1,$2,$3,$3,'Старая публикация','electronics','Участник',1,'2026-10-23T12:00:00Z')",
    [f.ids[0], f.target.tenant_id, f.target.principal_id],
  );
  const page = await f.call({ category: 'publications', limit: 100 });
  expect(page.items).toHaveLength(58);
  expect(
    page.items.filter((item: { type: string }) => item.type === 'legacy_publication'),
  ).toHaveLength(1);
});
it('rejects target/category/actor cursor reuse, oversize pages, malformed cursor and live privilege revocation', async () => {
  const f = await fixture(),
    first = await f.call();
  for (const options of [
    { target: f.foreign.account_id },
    { category: 'ai' },
    { cursor: { ...first.next, asOf: 'infinity' } },
    { limit: 101 },
  ])
    await expect(f.call({ cursor: first.next, ...options })).rejects.toMatchObject({
      code: '22023',
    });
  await expect(f.call({ actor: f.foreign.principal_id })).rejects.toMatchObject({ code: '42501' });
  await admin.query(
    "UPDATE capability_grants SET state='revoked' WHERE account_id=$1 AND capability='platform_admin'",
    [f.actor.account_id],
  );
  await expect(f.call({ cursor: first.next })).rejects.toMatchObject({ code: '42501' });
});
it('does not expose personal history to an organization admin, or infer authority from shared tenant/membership', async () => {
  const f = await fixture();
  const tenant = (
    await admin.query(
      "INSERT INTO tenants(title,workspace_slug) VALUES('История',$1) RETURNING id",
      [randomUUID()],
    )
  ).rows[0].id;
  const workspace = (
    await admin.query(
      "INSERT INTO workspaces(tenant_id,kind,title) VALUES($1,'organization','История') RETURNING id",
      [tenant],
    )
  ).rows[0].id;
  await admin.query(
    "INSERT INTO workspace_memberships(account_id,workspace_id,role,state) VALUES($1,$3,'school_admin','active'),($2,$3,'member','active')",
    [f.foreign.account_id, f.target.account_id, workspace],
  );
  expect(
    await f.call({ actor: f.foreign.principal_id, scope: 'organization', scopeId: workspace }),
  ).toMatchObject({ coverage: 'unavailable_scope', items: [], next: null });
  await expect(
    f.call({
      actor: f.foreign.principal_id,
      scope: 'organization',
      scopeId: workspace,
      target: f.actor.account_id,
    }),
  ).rejects.toMatchObject({ code: '42501' });
  await expect(runtime.query('SELECT * FROM ai_usage_journal LIMIT 1')).rejects.toMatchObject({
    code: '42501',
  });
});
it('keeps Account and Seat histories distinct even with identical UUID and never follows their link implicitly', async () => {
  const f = await fixture(),
    seat = await aiClassFixture(admin, runtime);
  // Account and StudentSeat are different identity spaces, even with the same UUID.
  await admin.query(
    "INSERT INTO accounts(id,email,password_hash,birth_date,country,status) VALUES($1,$2,'fixture',DATE '1990-01-01','RU','active')",
    [seat.seatId, `same-${randomUUID()}@example.test`],
  );
  const accountPrincipal = randomUUID();
  await admin.query("INSERT INTO principals(id,kind,account_id) VALUES($1,'account',$2)", [
    accountPrincipal,
    seat.seatId,
  ]);
  await admin.query('UPDATE classroom_student_seats SET account_id=$1 WHERE id=$1', [seat.seatId]);
  const request = randomUUID();
  await admin.query(
    'INSERT INTO ai_usage_journal(owner_principal_id,request_id,seat_id,admitted_at) VALUES($1,$2,$3,now())',
    [seat.principalId, request, seat.seatId],
  );
  const studentPage = await f.call({ kind: 'student', target: seat.seatId, category: 'ai' });
  expect(studentPage.items.map((x: any) => x.id)).toEqual([request]);
  expect((await f.call({ kind: 'account', target: seat.seatId, category: 'ai' })).items).toEqual(
    [],
  );
  await expect(
    f.call({
      kind: 'student',
      target: seat.seatId,
      category: 'ai',
      cursor: (await f.call({ category: 'ai' })).next,
    }),
  ).rejects.toMatchObject({ code: '22023' });
});
