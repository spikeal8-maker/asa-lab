import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { expect, it, vi } from 'vitest';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan } from '../migration/isolated-postgres-plan';
import { budgetFixture } from './ai-token-budgets.fixture';

// CI only: a fresh, uniquely owned database avoids rewriting another suite's
// pending history to manufacture budget room. Never changes a working DB.
it('serializes actual global and principal admissions on independent PostgreSQL connections, retains unknowns and pins late settlement', async () => {
  if (process.env.CI !== 'true' || process.env.GITHUB_ACTIONS !== 'true')
    throw new Error(
      'Fresh budget concurrency database is GitHub CI only; no local database operations.',
    );
  const sources = ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL'].map((key) => {
    const value = process.env[key];
    if (!value) throw new Error(key + ' must explicitly name an isolated _test database');
    const url = new URL(value);
    if (!decodeURIComponent(url.pathname).endsWith('_test'))
      throw new Error('Only isolated _test database allowed');
    return url;
  });
  if (sources[0]!.host !== sources[1]!.host || sources[0]!.pathname !== sources[1]!.pathname)
    throw new Error('Both roles must target the same isolated test DB');
  const name = 'asa_ai_budget_' + randomUUID().replaceAll('-', '') + '_test';
  if (!/^asa_ai_budget_[a-f0-9]{32}_test$/.test(name)) throw new Error('Unsafe fixture DB name');
  const cluster = new pg.Client({ connectionString: sources[0]!.href });
  let created = false,
    admin: pg.Pool | undefined,
    runtime: pg.Pool | undefined;
  try {
    await cluster.connect();
    await cluster.query('CREATE DATABASE "' + name + '"');
    created = true;
    const urls = sources.map((url) => {
      const target = new URL(url);
      target.pathname = '/' + name;
      return target.href;
    });
    admin = new pg.Pool({ connectionString: urls[0], max: 3 });
    runtime = new pg.Pool({ connectionString: urls[1], max: 4 });
    const client = await admin.connect();
    try {
      await applyIsolatedTestPlan(client, planMigrations('migrations'));
    } finally {
      client.release();
    }
    const upstream = vi.fn<typeof fetch>(async () => {
      throw new Error('SQL admission tests must never dispatch upstream');
    });
    const f = await budgetFixture(admin, runtime, upstream);
    // Each tiny global budget has exactly one remaining token. Two real owners
    // on two independent backends cannot both reserve it.
    await f.limits('1', null);
    const t1 = await f.service.createThread(f.owner),
      t2 = await f.service.createThread(f.other);
    const r1 = randomUUID(),
      r2 = randomUUID();
    const global = await Promise.allSettled([
      f.begin(f.owner, t1.id, r1),
      f.begin(f.other, t2.id, r2),
    ]);
    expect(global.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
    expect(global.filter((v) => v.status === 'rejected')).toHaveLength(1);
    const index = global.findIndex((v) => v.status === 'fulfilled');
    const who = index === 0 ? f.owner : f.other,
      thread = index === 0 ? t1.id : t2.id,
      request = index === 0 ? r1 : r2;
    await f.running(who, thread, request);
    await f.finish(who, thread, request, 7, 5);
    expect((await f.begin(who, thread, request)).rows[0].admitted).toBe(false);
    await expect(f.begin(who, thread, randomUUID())).rejects.toThrow('AI_BUDGET_EXHAUSTED');
    expect(
      (await f.store.admin(f.actor)).models.find((m) => m.model === 'ollama-local'),
    ).toMatchObject({ used: '12', held: '0' });
    // Same principal, different threads: user cap is independent of global room.
    await f.limits(null, '1');
    const user = index === 0 ? f.other : f.owner;
    const u1 = await f.service.createThread(user),
      u2 = await f.service.createThread(user);
    const ur1 = randomUUID(),
      ur2 = randomUUID();
    const principal = await Promise.allSettled([
      f.begin(user, u1.id, ur1),
      f.begin(user, u2.id, ur2),
    ]);
    expect(principal.filter((v) => v.status === 'fulfilled')).toHaveLength(1);
    const ui = principal.findIndex((v) => v.status === 'fulfilled'),
      ut = ui === 0 ? u1.id : u2.id,
      ur = ui === 0 ? ur1 : ur2;
    await f.running(user, ut, ur);
    await f.finish(user, ut, ur, null, null);
    expect((await f.store.own(user)).models[0]).toMatchObject({
      held: '1',
      reason: 'ai_budget_pending',
    });
    await f.service.deleteThread(user, ut);
    expect((await f.store.own(user)).models[0]).toMatchObject({
      held: '1',
      reason: 'ai_budget_pending',
    });
    await expect(
      runtime.query('SELECT ai_generation_begin_before_budgets($1,$2,$3,$4::jsonb,$5,$6,$7)', [
        user,
        u2.id,
        randomUUID(),
        '{}',
        'ollama-local',
        1,
        1,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
    // Explicit test-only calendar fixture: only this suite's owned reservation
    // moves, never another database/suite's journal. Its late result is old-month.
    await f.limits(null, null);
    const lateThread = await f.service.createThread(f.actor),
      late = randomUUID();
    await f.begin(f.actor, lateThread.id, late);
    await f.running(f.actor, lateThread.id, late);
    await admin.query(
      "UPDATE ai_token_budget_reservations SET month_start=(date_trunc('month',statement_timestamp() AT TIME ZONE 'UTC')-interval '1 month') AT TIME ZONE 'UTC' WHERE owner_principal_id=$1 AND request_id=$2",
      [f.actor, late],
    );
    await f.finish(f.actor, lateThread.id, late, 50, 60);
    expect((await f.store.own(f.actor)).models[0]).toMatchObject({ used: '0', held: '0' });
    expect(upstream).not.toHaveBeenCalled();
  } finally {
    try {
      await runtime?.end();
    } finally {
      try {
        await admin?.end();
      } finally {
        try {
          if (created) await cluster.query('DROP DATABASE "' + name + '"');
        } finally {
          await cluster.end();
        }
      }
    }
  }
}, 60000);
