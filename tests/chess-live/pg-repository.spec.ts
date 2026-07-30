import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { withTenantContext } from '../../packages/database/dist/index.js';
import { ChessLiveService } from '../../contexts/chess-live/application/service';
import type { LiveIdPort } from '../../contexts/chess-live/application/ports';
import { PgChessLiveRepository } from '../../contexts/chess-live/infrastructure/pg-repository';
import { MutableLiveClock } from '../../contexts/chess-live/testing/test-kit';
import {
  seedTeacher,
  testAdminPool,
  testAppPool,
  type SeededTeacher,
} from '../portal/helpers';

class UuidTestIds implements LiveIdPort {
  private counter = 0;
  private code = 0;

  nextId(): string {
    this.counter += 1;
    return `00000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`;
  }

  nextPublicCode(): string {
    this.code += 1;
    return `PG${String(this.code).padStart(10, '0')}`;
  }

  randomBit(): 0 | 1 {
    return 0;
  }
}

let admin: pg.Pool;
let runtime: pg.Pool;
let tenantA: SeededTeacher;
let tenantB: SeededTeacher;
let opponentA: { id: string; email: string };

async function insertSameTenantOpponent(seed: SeededTeacher) {
  const email = `chess-live-opponent-${Date.now()}@test.local`;
  const result = await admin.query(
    `INSERT INTO users (tenant_id, school_id, role, email, display_name, password_hash)
     SELECT tenant_id, school_id, 'teacher', $1, 'Шахматный соперник', password_hash
       FROM users
      WHERE id = $2
     RETURNING id`,
    [email, seed.teacherId],
  );
  return { id: result.rows[0].id as string, email };
}

function fixture(nowMs = 1_000) {
  const repository = new PgChessLiveRepository(runtime);
  const clock = new MutableLiveClock(nowMs);
  const ids = new UuidTestIds();
  const service = new ChessLiveService(repository, clock, ids);
  return { repository, clock, ids, service };
}

beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  tenantA = await seedTeacher(admin, 'chess-live-pg-a');
  tenantB = await seedTeacher(admin, 'chess-live-pg-b');
  opponentA = await insertSameTenantOpponent(tenantA);
});

afterAll(async () => {
  await admin.end();
  await runtime.end();
});

describe('PgChessLiveRepository', () => {
  it('has no rows without a verified tenant context', async () => {
    for (const table of [
      'chess_live_challenges',
      'chess_live_games',
      'chess_live_events',
      'chess_live_command_receipts',
      'chess_matchmaking_tickets',
      'chess_ratings',
      'chess_rating_ledger',
    ]) {
      const result = await runtime.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect(result.rows[0].n).toBe(0);
    }
  });

  it('persists a direct challenge, accepted game, moves and reconnect across repository instances', async () => {
    const first = fixture();
    const creator = { tenantId: tenantA.tenantId, userId: tenantA.teacherId };
    const opponent = { tenantId: tenantA.tenantId, userId: opponentA.id };
    const created = await first.service.createChallenge(creator, {
      commandId: 'pg:create:challenge',
      colorPreference: 'white',
      timeControl: { initialMs: 60_000, incrementMs: 2_000 },
      rated: false,
      expiresInMs: 120_000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const accepted = await first.service.acceptChallenge(
      opponent,
      created.value.challenge.publicCode,
      'pg:accept:challenge',
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.value.game).toMatchObject({
      whitePlayerId: tenantA.teacherId,
      blackPlayerId: opponentA.id,
      version: 1,
      sequence: 2,
    });

    first.clock.set(6_000);
    const e4 = await first.service.submitMove(creator, {
      gameId: accepted.value.game.gameId,
      commandId: 'pg:move:e4',
      expectedVersion: 1,
      uci: 'e2e4',
    });
    expect(e4.ok).toBe(true);
    if (!e4.ok) return;
    first.clock.set(8_000);
    const e5 = await first.service.submitMove(opponent, {
      gameId: accepted.value.game.gameId,
      commandId: 'pg:move:e5',
      expectedVersion: e4.value.game.version,
      uci: 'e7e5',
    });
    expect(e5.ok).toBe(true);
    if (!e5.ok) return;

    const restarted = new ChessLiveService(
      new PgChessLiveRepository(runtime),
      first.clock,
      new UuidTestIds(),
    );
    const reconnect = await restarted.reconnect(
      creator,
      accepted.value.game.gameId,
      2,
    );
    expect(reconnect).toMatchObject({
      ok: true,
      value: {
        snapshot: {
          version: 3,
          sequence: 4,
          moves: [{ uci: 'e2e4' }, { uci: 'e7e5' }],
        },
        events: [
          { sequence: 3, type: 'move_played' },
          { sequence: 4, type: 'move_played' },
        ],
        nextSequence: 4,
      },
    });
  });

  it('isolates challenge codes, games and events across tenants at PostgreSQL RLS', async () => {
    const value = fixture();
    const creator = { tenantId: tenantA.tenantId, userId: tenantA.teacherId };
    const created = await value.service.createChallenge(creator, {
      commandId: 'pg:rls:create',
      colorPreference: 'random',
      timeControl: { initialMs: 300_000, incrementMs: 0 },
      rated: false,
      expiresInMs: 120_000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const foreign = { tenantId: tenantB.tenantId, userId: tenantB.teacherId };
    expect(
      await value.service.getChallenge(foreign, created.value.challenge.publicCode),
    ).toEqual({ ok: false, code: 'not_found', message: 'challenge not found' });

    const visibleA = await withTenantContext(runtime, tenantA.tenantId, async (client) =>
      client.query(
        `SELECT count(*)::int AS n FROM chess_live_challenges WHERE id = $1`,
        [created.value.challenge.id],
      ),
    );
    const visibleB = await withTenantContext(runtime, tenantB.tenantId, async (client) =>
      client.query(
        `SELECT count(*)::int AS n FROM chess_live_challenges WHERE id = $1`,
        [created.value.challenge.id],
      ),
    );
    expect(visibleA.rows[0].n).toBe(1);
    expect(visibleB.rows[0].n).toBe(0);
  });

  it('makes expected-version races deterministic and preserves only one accepted move', async () => {
    const value = fixture();
    const creator = { tenantId: tenantA.tenantId, userId: tenantA.teacherId };
    const opponent = { tenantId: tenantA.tenantId, userId: opponentA.id };
    const challenge = await value.service.createChallenge(creator, {
      commandId: 'pg:race:create',
      colorPreference: 'white',
      timeControl: { initialMs: 60_000, incrementMs: 0 },
      rated: false,
      expiresInMs: 120_000,
    });
    expect(challenge.ok).toBe(true);
    if (!challenge.ok) return;
    const accepted = await value.service.acceptChallenge(
      opponent,
      challenge.value.challenge.publicCode,
      'pg:race:accept',
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    value.clock.set(2_000);
    const [first, second] = await Promise.all([
      value.service.submitMove(creator, {
        gameId: accepted.value.game.gameId,
        commandId: 'pg:race:e4',
        expectedVersion: 1,
        uci: 'e2e4',
      }),
      value.service.submitMove(creator, {
        gameId: accepted.value.game.gameId,
        commandId: 'pg:race:d4',
        expectedVersion: 1,
        uci: 'd2d4',
      }),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect([first, second].find((result) => !result.ok)).toMatchObject({
      ok: false,
      code: 'conflict',
    });
    const stored = await value.service.getGame(creator, accepted.value.game.gameId);
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.value.moves).toHaveLength(1);
  });

  it('writes a rated result and immutable ledger exactly once', async () => {
    const value = fixture();
    const creator = { tenantId: tenantA.tenantId, userId: tenantA.teacherId };
    const opponent = { tenantId: tenantA.tenantId, userId: opponentA.id };
    const challenge = await value.service.createChallenge(creator, {
      commandId: 'pg:rating:create',
      colorPreference: 'white',
      timeControl: { initialMs: 600_000, incrementMs: 5_000 },
      rated: true,
      expiresInMs: 120_000,
    });
    expect(challenge.ok).toBe(true);
    if (!challenge.ok) return;
    const accepted = await value.service.acceptChallenge(
      opponent,
      challenge.value.challenge.publicCode,
      'pg:rating:accept',
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const resigned = await value.service.resign(opponent, {
      gameId: accepted.value.game.gameId,
      commandId: 'pg:rating:resign',
      expectedVersion: 1,
    });
    expect(resigned).toMatchObject({
      ok: true,
      value: { game: { result: '1-0', termination: 'resignation' } },
    });
    expect(
      await value.service.resign(opponent, {
        gameId: accepted.value.game.gameId,
        commandId: 'pg:rating:resign',
        expectedVersion: 1,
      }),
    ).toMatchObject({ ok: true, value: { replayed: true } });

    const white = await value.service.getRating(creator, 'rapid');
    const black = await value.service.getRating(opponent, 'rapid');
    expect(white).toMatchObject({
      ok: true,
      value: { rating: { rating: 1224, games: 1 }, ledger: [{ delta: 24 }] },
    });
    expect(black).toMatchObject({
      ok: true,
      value: { rating: { rating: 1176, games: 1 }, ledger: [{ delta: -24 }] },
    });
    const ledgerCount = await withTenantContext(runtime, tenantA.tenantId, (client) =>
      client.query(
        `SELECT count(*)::int AS n FROM chess_rating_ledger WHERE game_id = $1`,
        [accepted.value.game.gameId],
      ),
    );
    expect(ledgerCount.rows[0].n).toBe(2);
  });

  it('keeps events and rating ledger append-only for the runtime role', async () => {
    const event = await withTenantContext(runtime, tenantA.tenantId, (client) =>
      client.query(`SELECT id FROM chess_live_events LIMIT 1`),
    );
    const ledger = await withTenantContext(runtime, tenantA.tenantId, (client) =>
      client.query(`SELECT id FROM chess_rating_ledger LIMIT 1`),
    );
    expect(event.rowCount).toBeGreaterThan(0);
    expect(ledger.rowCount).toBeGreaterThan(0);
    await expect(
      withTenantContext(runtime, tenantA.tenantId, (client) =>
        client.query(`UPDATE chess_live_events SET event_type = 'forged' WHERE id = $1`, [
          event.rows[0].id,
        ]),
      ),
    ).rejects.toThrow(/append-only/);
    await expect(
      withTenantContext(runtime, tenantA.tenantId, (client) =>
        client.query(`DELETE FROM chess_rating_ledger WHERE id = $1`, [ledger.rows[0].id]),
      ),
    ).rejects.toThrow(/append-only/);
  });
});
