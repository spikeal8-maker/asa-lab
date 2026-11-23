import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await applyPlan(
    {
      query: async (sql: string, params?: unknown[]) =>
        params?.length ? db.query(sql, params) : { rows: (await db.exec(sql)).at(-1)?.rows ?? [] },
    },
    planMigrations('migrations'),
  );
}, 120_000);
afterAll(async () => db?.close());

async function identity() {
  const unique = randomUUID().replaceAll('-', '');
  return (
    await db.query<{
      account_id: string;
      principal_id: string;
      tenant_id: string;
      workspace_id: string;
    }>(
      `SELECT * FROM auth_register_account($1,'test-only','Участник',$2,DATE '1990-01-01','RU','test',$3,1)`,
      [`site-${unique}@example.test`, `site${unique}`, unique.repeat(2)],
    )
  ).rows[0]!;
}

async function asApp<T>(run: () => Promise<T>): Promise<T> {
  await db.exec('SET ROLE asalab_app');
  try {
    return await run();
  } finally {
    await db.exec('RESET ROLE');
  }
}

it('unions repeated browser batches and overlapping module evidence without broadening admin access', async () => {
  const account = await identity();
  const stranger = await identity();
  await db.query(
    `INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by)
      VALUES($1,'platform_admin','verified','admin-stage-a-2026-08','admin')`,
    [account.account_id],
  );
  const now = Math.floor(Date.now() / 1000) * 1000;
  const time = (offset: number) => new Date(now + offset * 1000).toISOString();
  const intervals = [{ from: time(-75), to: time(-45) }];
  const write = (principal = account.principal_id, batch = intervals) =>
    asApp(() =>
      db.query(
        `SELECT analytics_ingest_site_activity($1,'account',$2,$3,NULL,$4,NULL,$5::jsonb,$6) AS payload`,
        [
          randomUUID(),
          account.account_id,
          principal,
          account.workspace_id,
          JSON.stringify(batch),
          time(0),
        ],
      ),
    );
  expect((await write()).rows[0]).toMatchObject({
    payload: { operation: 'site.activity', state: 'persisted' },
  });
  await write();
  await write(account.principal_id, [{ from: time(-60), to: time(-30) }]);
  await expect(write(stranger.principal_id)).rejects.toMatchObject({ code: '42501' });
  await expect(
    write(account.principal_id, [{ from: time(-300), to: time(-295) }]),
  ).rejects.toMatchObject({ code: '22023' });

  const project = randomUUID();
  const session = randomUUID();
  await db.query(
    `INSERT INTO projects(id,tenant_id,module_key,title,status,owner_principal_id,project_scope)
      VALUES($1,$2,'electronics','Site overlap','active',$3,'personal')`,
    [project, account.tenant_id, account.principal_id],
  );
  await db.query(
    `INSERT INTO product_module_sessions
      (id,actor_kind,account_id,principal_id,workspace_id,tenant_id,project_id,module_key,network_kind,started_at,last_seen_at)
      VALUES($1,'account',$2,$3,$4,$5,$6,'electronics','unknown',$7,$8)`,
    [
      session,
      account.account_id,
      account.principal_id,
      account.workspace_id,
      account.tenant_id,
      project,
      time(-45),
      time(-15),
    ],
  );
  await db.query(
    'INSERT INTO product_module_activity_slices(session_id,started_at,ended_at,active_seconds) VALUES($1,$2,$3,30)',
    [session, time(-45), time(-15)],
  );
  const dashboard = (actor: string, from = time(-90), to = time(0)) =>
    asApp(() =>
      db.query<{
        payload: {
          measuredFrom: string;
          points: { accountSeconds: number | null; studentSeconds: number | null }[];
        };
      }>(`SELECT admin_get_site_activity_overview($1,'platform',NULL,$2,$3,300) AS payload`, [
        actor,
        from,
        to,
      ]),
    );
  const summary = (await dashboard(account.principal_id)).rows[0]!.payload;
  expect(Date.parse(summary.measuredFrom)).toBe(Date.parse(time(-75)));
  expect(summary.points.reduce((sum, point) => sum + (point.accountSeconds ?? 0), 0)).toBe(60);
  expect(summary.points.every((point) => point.studentSeconds === null)).toBe(true);
  expect(
    (await dashboard(account.principal_id, time(-300), time(-100))).rows[0]?.payload.points,
  ).toEqual([]);
  await expect(dashboard(stranger.principal_id)).rejects.toMatchObject({ code: '42501' });
  await expect(
    asApp(() => db.query('SELECT * FROM product_site_activity_days')),
  ).rejects.toMatchObject({ code: '42501' });
});

it('binds StudentSeat samples to the active seat and class at the SQL boundary', async () => {
  const teacher = await identity();
  await db.query(
    `INSERT INTO capability_grants(account_id,capability,state,policy_version,granted_by)
      VALUES($1,'educator','verified','site-test','admin')`,
    [teacher.account_id],
  );
  const context = (
    await db.query<{
      tenant_id: string;
      school_id: string;
      academic_period_id: string;
      user_id: string;
    }>('SELECT * FROM classroom_ensure_personal_teacher($1)', [teacher.account_id])
  ).rows[0]!;
  const classId = (
    await db.query<{ id: string }>(
      `INSERT INTO classrooms(tenant_id,school_id,academic_period_id,title,created_by)
      VALUES($1,$2,$3,'Site activity class',$4) RETURNING id`,
      [context.tenant_id, context.school_id, context.academic_period_id, context.user_id],
    )
  ).rows[0]!.id;
  const seat = (
    await db.query<{ id: string }>(
      `INSERT INTO classroom_student_seats(tenant_id,classroom_id,display_label,login_handle,normalized_login_handle,status,created_by)
      VALUES($1,$2,'Test label','site-seat','site-seat','active',$3) RETURNING id`,
      [context.tenant_id, classId, context.user_id],
    )
  ).rows[0]!.id;
  const principal = (
    await asApp(() =>
      db.query<{ principal_id: string }>('SELECT * FROM student_seat_principal($1)', [seat]),
    )
  ).rows[0]!.principal_id;
  const received = Date.now();
  const at = (offset: number) => new Date(received + offset * 1000).toISOString();
  const write = (room: string) =>
    asApp(() =>
      db.query(
        `SELECT analytics_ingest_site_activity($1,'student',NULL,$2,$3,NULL,$4,$5::jsonb,$6) AS payload`,
        [
          randomUUID(),
          principal,
          seat,
          room,
          JSON.stringify([{ from: at(-25), to: at(-10) }]),
          at(0),
        ],
      ),
    );
  expect((await write(classId)).rows[0]).toMatchObject({ payload: { operation: 'site.activity' } });
  await expect(write(randomUUID())).rejects.toMatchObject({ code: '42501' });
  await db.query(`UPDATE classroom_student_seats SET status='removed' WHERE id=$1`, [seat]);
  await expect(write(classId)).rejects.toMatchObject({ code: '42501' });
});
