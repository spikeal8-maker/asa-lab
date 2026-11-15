import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { testAdminPool, testAppPool } from '../portal/helpers';
import { aiClassroomFixture, aiIdentity } from './ai-student-access.contract';
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
async function fixture() {
  const owner = await aiIdentity(admin),
    staff = await aiIdentity(admin),
    platform = await aiIdentity(admin);
  await admin.query(
    "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'platform_admin','verified','test','admin')",
    [platform.account_id],
  );
  await admin.query("UPDATE workspaces SET kind='organization' WHERE id=$1", [owner.workspace_id]);
  await admin.query(
    "INSERT INTO workspace_memberships(account_id,workspace_id,role,state) VALUES($1,$2,'member','active')",
    [staff.account_id, owner.workspace_id],
  );
  return { owner, staff, platform };
}
async function read(actor: string, kind: string, scope: string, target: string) {
  return (
    await runtime.query('SELECT crm_responsibility_read($1,$2,$3,$4) value', [
      actor,
      kind,
      scope,
      target,
    ])
  ).rows[0].value;
}
async function write(
  actor: string,
  kind: string,
  scope: string,
  target: string,
  version: string,
  role: string,
  state = 'active',
) {
  return (
    await runtime.query('SELECT crm_responsibility_update($1,$2,$3,$4,$5,$6,$7,$8,$9) value', [
      actor,
      kind,
      scope,
      target,
      version,
      role,
      state,
      'Explicit owner request',
      randomUUID(),
    ])
  ).rows[0].value;
}
it('limits organization authority and preserves last active owner with exact version/audit', async () => {
  const f = await fixture();
  const current = await read(
    f.owner.principal_id,
    'organization',
    f.owner.workspace_id,
    f.staff.account_id,
  );
  expect(current).not.toHaveProperty('email');
  const changed = await write(
    f.owner.principal_id,
    'organization',
    f.owner.workspace_id,
    f.staff.account_id,
    current.version,
    'school_admin',
  );
  await expect(
    write(
      f.owner.principal_id,
      'organization',
      f.owner.workspace_id,
      f.staff.account_id,
      current.version,
      'member',
    ),
  ).rejects.toMatchObject({ code: '40001' });
  const own = await read(
    f.platform.principal_id,
    'organization',
    f.owner.workspace_id,
    f.owner.account_id,
  );
  await expect(
    write(
      f.platform.principal_id,
      'organization',
      f.owner.workspace_id,
      f.owner.account_id,
      own.version,
      'member',
    ),
  ).rejects.toMatchObject({ code: '22023' });
  await expect(
    write(
      f.staff.principal_id,
      'organization',
      f.owner.workspace_id,
      f.owner.account_id,
      own.version,
      'member',
    ),
  ).rejects.toMatchObject({ code: '22023' });
  expect(changed.role).toBe('school_admin');
  expect(
    (
      await admin.query(
        "SELECT metadata_json FROM administrative_audit_events WHERE target_id=$1 AND action='crm.responsibility.update'",
        [f.staff.account_id],
      )
    ).rows[0].metadata_json.before.role,
  ).toBe('member');
});
it('allows platform owner management while excluding personal scope, legacy student and school-admin self change', async () => {
  const f = await fixture();
  await expect(
    read(f.platform.principal_id, 'organization', f.staff.workspace_id, f.staff.account_id),
  ).rejects.toMatchObject({ code: '42501' });
  let current = await read(
    f.platform.principal_id,
    'organization',
    f.owner.workspace_id,
    f.staff.account_id,
  );
  await write(
    f.platform.principal_id,
    'organization',
    f.owner.workspace_id,
    f.staff.account_id,
    current.version,
    'owner',
  );
  current = await read(
    f.owner.principal_id,
    'organization',
    f.owner.workspace_id,
    f.staff.account_id,
  );
  expect(current.allowedRoles).toEqual([]);
  await admin.query(
    "UPDATE workspace_memberships SET role='school_admin' WHERE workspace_id=$1 AND account_id=$2",
    [f.owner.workspace_id, f.staff.account_id],
  );
  current = await read(
    f.staff.principal_id,
    'organization',
    f.owner.workspace_id,
    f.staff.account_id,
  );
  expect(current.allowedRoles).toEqual([]);
  await admin.query(
    "UPDATE workspace_memberships SET role='student' WHERE workspace_id=$1 AND account_id=$2",
    [f.owner.workspace_id, f.staff.account_id],
  );
  current = await read(
    f.platform.principal_id,
    'organization',
    f.owner.workspace_id,
    f.staff.account_id,
  );
  expect(current.allowedRoles).toEqual([]);
});
it('creates canonical class co-teachers, rejects ineligible accounts and preserves primary ownership', async () => {
  const f = await fixture(),
    c = await aiClassroomFixture(admin);
  let current = await read(f.platform.principal_id, 'classroom', c.classroomId, f.staff.account_id);
  await expect(
    write(
      f.platform.principal_id,
      'classroom',
      c.classroomId,
      f.staff.account_id,
      current.version,
      'co_teacher',
    ),
  ).rejects.toMatchObject({ code: '22023' });
  await admin.query(
    "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'educator','provisional','test','admin')",
    [f.staff.account_id],
  );
  current = await write(
    f.platform.principal_id,
    'classroom',
    c.classroomId,
    f.staff.account_id,
    current.version,
    'co_teacher',
  );
  expect(current.role).toBe('co_teacher');
  const owner = await read(
    f.platform.principal_id,
    'classroom',
    c.classroomId,
    c.teacher.account_id,
  );
  expect(owner.allowedRoles).toEqual([]);
  await expect(
    read(c.teacher.principal_id, 'classroom', c.classroomId, f.staff.account_id),
  ).rejects.toMatchObject({ code: '42501' });
  await write(
    f.platform.principal_id,
    'classroom',
    c.classroomId,
    f.staff.account_id,
    current.version,
    'co_teacher',
    'revoked',
  );
  expect(
    (
      await admin.query(
        'SELECT member_role FROM classroom_memberships WHERE classroom_id=$1 AND account_id=$2',
        [c.classroomId, c.teacher.account_id],
      )
    ).rows[0].member_role,
  ).toBe('owner');
});
it('serializes concurrent owner revocations and enforces max five colleagues across canonical writes', async () => {
  const f = await fixture();
  let member = await read(
    f.platform.principal_id,
    'organization',
    f.owner.workspace_id,
    f.staff.account_id,
  );
  await write(
    f.platform.principal_id,
    'organization',
    f.owner.workspace_id,
    f.staff.account_id,
    member.version,
    'owner',
  );
  const a = await read(
      f.platform.principal_id,
      'organization',
      f.owner.workspace_id,
      f.owner.account_id,
    ),
    b = await read(
      f.platform.principal_id,
      'organization',
      f.owner.workspace_id,
      f.staff.account_id,
    );
  const results = await Promise.allSettled([
    write(
      f.platform.principal_id,
      'organization',
      f.owner.workspace_id,
      f.owner.account_id,
      a.version,
      'owner',
      'revoked',
    ),
    write(
      f.platform.principal_id,
      'organization',
      f.owner.workspace_id,
      f.staff.account_id,
      b.version,
      'owner',
      'revoked',
    ),
  ]);
  expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  const c = await aiClassroomFixture(admin);
  for (let n = 0; n < 6; n++) {
    const teacher = await aiIdentity(admin);
    await admin.query(
      "INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by) VALUES($1,'educator','verified','test','admin')",
      [teacher.account_id],
    );
    const before = await read(
      f.platform.principal_id,
      'classroom',
      c.classroomId,
      teacher.account_id,
    );
    const change = write(
      f.platform.principal_id,
      'classroom',
      c.classroomId,
      teacher.account_id,
      before.version,
      'co_teacher',
    );
    if (n === 5) await expect(change).rejects.toMatchObject({ code: '22023' });
    else await change;
  }
  expect(
    (
      await admin.query(
        "SELECT count(*)::int n FROM classroom_memberships WHERE classroom_id=$1 AND member_role='co_teacher'",
        [c.classroomId],
      )
    ).rows[0].n,
  ).toBe(5);
  await expect(
    read(f.owner.principal_id, 'organization', f.staff.workspace_id, f.staff.account_id),
  ).rejects.toMatchObject({ code: '42501' });
});
