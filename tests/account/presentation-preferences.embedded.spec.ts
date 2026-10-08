import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { applyPlan, planMigrations } from '../../tools/migrate.mjs';
const db = new PGlite();
const account = '20000000-0000-4000-8000-000000000001',
  other = '20000000-0000-4000-8000-000000000002';
const command = {
  motion: 'reduce',
  sidebar: 'collapsed',
  revision: 0,
  requestId: '30000000-0000-4000-8000-000000000001',
};
async function write(input: unknown, id = account) {
  return (
    await db.query<{ value: Record<string, unknown> }>(
      'SELECT account_presentation_write($1,$2::jsonb) AS value',
      [id, JSON.stringify(input)],
    )
  ).rows[0].value;
}
beforeAll(async () => {
  await applyPlan(
    {
      query: async (sql: string, params?: unknown[]) => {
        if (params?.length) return db.query(sql, params);
        const result = await db.exec(sql);
        return { rows: result.at(-1)?.rows ?? [] };
      },
    },
    planMigrations('migrations'),
  );
  await db.query(
    `INSERT INTO accounts(id,email,password_hash,birth_date,country) VALUES($1,'prefs-a@test','unused','1990-01-01','RU'),($2,'prefs-b@test','unused','1990-01-01','RU')`,
    [account, other],
  );
  await db.query(
    `INSERT INTO profiles(account_id,username,display_name,time_zone) VALUES($1,'prefs-a','A','Europe/Moscow'),($2,'prefs-b','B','UTC')`,
    [account, other],
  );
}, 30000);
afterAll(() => db.close());
describe('presentation additive persistence (embedded PostgreSQL)', () => {
  it('defaults old profiles, validates DB contract, preserves independent timezone and private receipts', async () => {
    const before = await db.query<{ value: unknown }>(
      'SELECT account_presentation_read($1) AS value',
      [account],
    );
    expect(before.rows[0].value).toEqual({ motion: 'system', sidebar: 'expanded', revision: 0 });
    for (const invalid of [
      { ...command, accountId: other },
      { ...command, motion: null },
      { ...command, sidebar: 2 },
      { ...command, revision: 0.5 },
    ])
      await expect(write(invalid)).rejects.toThrow('invalid presentation command');
    await db.exec('SET ROLE asalab_app');
    await expect(db.query('SELECT * FROM account_presentation_receipts')).rejects.toThrow(
      'permission denied',
    );
    expect(await write(command)).toEqual({
      code: 'ok',
      snapshot: { motion: 'reduce', sidebar: 'collapsed', revision: 1 },
    });
    await db.exec('RESET ROLE');
    expect(
      (
        await db.query<{ time_zone: string }>(
          'SELECT time_zone FROM profiles WHERE account_id=$1',
          [account],
        )
      ).rows[0].time_zone,
    ).toBe('Europe/Moscow');
  });
  it('handles identical retry, stale writes and conflicting request identity without silent overwrites', async () => {
    expect(await write(command)).toEqual({
      code: 'ok',
      snapshot: { motion: 'reduce', sidebar: 'collapsed', revision: 1 },
    });
    expect(await write({ ...command, motion: 'system' })).toEqual({ code: 'request_conflict' });
    expect(await write({ ...command, requestId: '30000000-0000-4000-8000-000000000002' })).toEqual({
      code: 'conflict',
    });
    expect(
      await write({
        ...command,
        revision: 1,
        motion: 'system',
        requestId: '30000000-0000-4000-8000-000000000003',
      }),
    ).toEqual({ code: 'ok', snapshot: { motion: 'system', sidebar: 'collapsed', revision: 2 } });
    // Lost-response retry after another successful writer must return CURRENT state.
    expect(await write(command)).toEqual({
      code: 'ok',
      snapshot: { motion: 'system', sidebar: 'collapsed', revision: 2 },
    });
    expect(
      (await db.query<{ value: unknown }>('SELECT account_presentation_read($1) AS value', [other]))
        .rows[0].value,
    ).toEqual({ motion: 'system', sidebar: 'expanded', revision: 0 });
    const numeric = await db.query<{ value: unknown }>(
      'SELECT account_presentation_write($1,$2::jsonb) AS value',
      [
        other,
        '{"motion":"reduce","sidebar":"expanded","revision":0.0,"requestId":"30000000-0000-4000-8000-000000000004"}',
      ],
    );
    expect(numeric.rows[0].value).toEqual({
      code: 'ok',
      snapshot: { motion: 'reduce', sidebar: 'expanded', revision: 1 },
    });
    expect(await write(command, '20000000-0000-4000-8000-000000000099')).toEqual({
      code: 'not_found',
    });
  });
});
