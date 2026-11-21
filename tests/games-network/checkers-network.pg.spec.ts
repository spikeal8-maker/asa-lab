import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { planMigrations } from '../../tools/migrate.mjs';
import { applyIsolatedTestPlan } from '../migration/isolated-postgres-plan';
import { checkersNetworkStorageContract } from './checkers-storage-contract';

const enabled =
  process.env['CI'] === 'true' &&
  !!process.env['TEST_DATABASE_URL'] &&
  !!process.env['APP_TEST_DATABASE_URL'];
describe.skipIf(!enabled)(
  'Checkers network isolated real PostgreSQL, asalab_app and concurrent commands',
  () => {
    const name = `asa_checkers_network_${randomUUID().replaceAll('-', '')}_test`;
    let owner: pg.Pool;
    let admin: pg.Pool;
    let pool: pg.Pool;
    let created = false;
    beforeAll(async () => {
      const source = new URL(process.env['TEST_DATABASE_URL']!);
      const runtime = new URL(process.env['APP_TEST_DATABASE_URL']!);
      if (
        !source.pathname.endsWith('_test') ||
        source.host !== runtime.host ||
        source.pathname !== runtime.pathname ||
        !/^asa_checkers_network_[a-f0-9]{32}_test$/.test(name)
      )
        throw new Error('Isolated matching *_test URLs required');
      owner = new pg.Pool({ connectionString: source.toString(), max: 1 });
      await owner.query(`CREATE DATABASE "${name}"`);
      created = true;
      source.pathname = runtime.pathname = '/' + name;
      admin = new pg.Pool({ connectionString: source.toString(), max: 3 });
      const client = await admin.connect();
      try {
        await applyIsolatedTestPlan(client, planMigrations());
      } finally {
        client.release();
      }
      pool = new pg.Pool({ connectionString: runtime.toString(), max: 6 });
      expect((await pool.query('SELECT current_user role')).rows[0]?.role).toBe('asalab_app');
    }, 120000);
    afterAll(async () => {
      await Promise.all([admin?.end(), pool?.end()]);
      try {
        if (created) await owner.query(`DROP DATABASE "${name}"`);
      } finally {
        await owner?.end();
      }
    });
    const fixture = checkersNetworkStorageContract(() => ({ admin, pool }));
    it('concurrent directed accepts admit only one live duel for the recipient', async () => {
      const f = await fixture();
      const a = await f.seat('Direct A');
      const b = await f.seat('Direct B');
      const c = await f.seat('Direct C');
      await f.service.policy(
        f.source,
        f.classroomId,
        { enabled: true, scope: 'classroom', expectedVersion: 0 },
        randomUUID(),
      );
      for (const seat of [a, b, c]) await f.service.lobby(seat.source, 'classroom');
      const bid = (await f.service.access(b.source)).player.playerId;
      const input = {
        scope: 'classroom' as const,
        initialMs: 600000,
        incrementMs: 0,
        colorPreference: 'white' as const,
      };
      const first = await f.service.challenge(a.source, randomUUID(), bid, input);
      const second = await f.service.challenge(c.source, randomUUID(), bid, input);
      const results = await Promise.allSettled([
        f.service.accept(b.source, randomUUID(), first.invite!.code),
        f.service.accept(b.source, randomUUID(), second.invite!.code),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(
        (await f.service.history(b.source)).matches.filter((m) => m.status === 'active'),
      ).toHaveLength(1);
    }, 30000);
    it('concurrent invite redemption creates one match; competing moves do not overwrite', async () => {
      const f = await fixture();
      const a = await f.seat('A');
      const b = await f.seat('B');
      const c = await f.seat('C');
      await f.service.policy(
        f.source,
        f.classroomId,
        {
          enabled: true,
          scope: 'classroom',
          expectedVersion: 0,
        },
        randomUUID(),
      );
      const invite = await f.service.create(a.source, randomUUID(), {
        scope: 'classroom',
        initialMs: 600000,
        incrementMs: 0,
        colorPreference: 'white',
      });
      const accepted = await Promise.allSettled([
        f.service.accept(b.source, randomUUID(), invite.invite!.code),
        f.service.accept(c.source, randomUUID(), invite.invite!.code),
      ]);
      expect(accepted.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const game = accepted.find(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof f.service.accept>>> =>
          result.status === 'fulfilled',
      )!.value.match!;
      const moves = await Promise.allSettled([
        f.service.action(a.source, randomUUID(), game.id, game.version, 'move', ['a3', 'b4']),
        f.service.action(a.source, randomUUID(), game.id, game.version, 'move', ['c3', 'd4']),
      ]);
      expect(moves.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect((await f.service.getMatch(a.source, game.id)).match.moves).toHaveLength(1);
      expect(
        (
          await admin.query(
            'SELECT count(*)::int n FROM games.checkers_participants WHERE match_id=$1',
            [game.id],
          )
        ).rows[0]?.n,
      ).toBe(2);
    }, 60000);
    it('FORCE RLS and narrow grants deny raw private tables and absent Games context', async () => {
      await expect(pool.query('SELECT * FROM games.player_sources')).rejects.toThrow(
        /permission denied/,
      );
      expect(
        (await pool.query("SELECT games.checkers_read('history') data")).rows[0]?.data,
      ).toEqual({
        error: 'UNAUTHORIZED',
      });
      const protectedTables = await admin.query(
        "SELECT count(*)::int n FROM pg_class t JOIN pg_namespace s ON s.oid=t.relnamespace WHERE s.nspname='games' AND t.relkind='r' AND NOT(t.relrowsecurity AND t.relforcerowsecurity)",
      );
      expect(protectedTables.rows[0]?.n).toBe(0);
    });
  },
);
