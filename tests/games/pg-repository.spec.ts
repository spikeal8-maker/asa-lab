import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createGamesCommandFingerprint, type GameMatchV1 } from '../../contexts/games/index';
import { PgGamesRepository } from '../../contexts/games/infrastructure/pg-repository';
import { testAdminPool, testAppPool } from '../portal/helpers';

let admin: pg.Pool;
let runtime: pg.Pool;
let playerA: string;
let playerB: string;
let playerC: string;

async function seedPlayer(alias: string): Promise<string> {
  const result = await admin.query(
    `INSERT INTO games.game_players (display_alias)
     VALUES ($1)
     RETURNING id`,
    [alias],
  );
  return result.rows[0].id as string;
}

function match(id: string): GameMatchV1 {
  const now = new Date().toISOString();
  return {
    id,
    gameKey: 'checkers-russian-64',
    gameVersion: '1.0.0',
    rulesVersion: 'russian-64-v1',
    stateSchemaVersion: 1,
    protocolVersion: 'games-command-v1',
    ratingPolicyVersion: null,
    admissionKind: 'invite',
    competitionKind: 'casual',
    scopeKind: 'private',
    runtimeKind: 'command',
    topology: 'duel',
    status: 'waiting',
    lifecycleVersion: 1,
    gameConfigRef: null,
    admissionRef: null,
    createdAt: now,
    updatedAt: now,
  };
}

function receipt(actorKey: string, commandId: string, matchId: string, expectedVersion: number | null) {
  return {
    actorKey,
    commandId,
    commandKind: expectedVersion === null ? 'match.create' : 'match.lifecycle',
    fingerprint: createGamesCommandFingerprint({
      commandKind: expectedVersion === null ? 'match.create' : 'match.lifecycle',
      targetRef: matchId,
      expectedVersion,
      payload: expectedVersion === null ? { gameKey: 'checkers-russian-64' } : { status: 'ready' },
    }),
    resourceType: 'match',
    resourceId: matchId,
    outcomeKind: 'applied' as const,
    resultRef: null,
    createdAt: new Date().toISOString(),
  };
}

beforeAll(async () => {
  admin = testAdminPool();
  runtime = testAppPool();
  [playerA, playerB, playerC] = await Promise.all([
    seedPlayer(`games-a-${randomUUID().slice(0, 8)}`),
    seedPlayer(`games-b-${randomUUID().slice(0, 8)}`),
    seedPlayer(`games-c-${randomUUID().slice(0, 8)}`),
  ]);
});

afterAll(async () => {
  await admin.end();
  await runtime.end();
});

describe('PgGamesRepository R1A2 foundation', () => {
  it('fails closed without a transaction-local game player context', async () => {
    const matches = await runtime.query(`SELECT count(*)::int AS n FROM games.matches`);
    const players = await runtime.query(`SELECT count(*)::int AS n FROM games.game_players`);
    expect(matches.rows[0].n).toBe(0);
    expect(players.rows[0].n).toBe(0);
  });

  it('creates one private duel atomically and replays the same command idempotently', async () => {
    const repository = new PgGamesRepository(runtime);
    const matchId = randomUUID();
    const source = match(matchId);
    const command = receipt(playerA, `create:${randomUUID()}`, matchId, null);
    const input = {
      match: source,
      participants: [
        {
          id: randomUUID(),
          matchId,
          participantKind: 'player' as const,
          gamePlayerId: playerA,
          botKey: null,
          seatKey: 'light',
          teamId: null,
        },
        {
          id: randomUUID(),
          matchId,
          participantKind: 'player' as const,
          gamePlayerId: playerB,
          botKey: null,
          seatKey: 'dark',
          teamId: null,
        },
      ],
      teams: [],
      receipt: command,
    };

    const first = await repository.withRequestContext(
      { gamePlayerId: playerA, auditId: `test:${randomUUID()}` },
      (tx) => tx.createMatchFoundation(input),
    );
    expect(first).toEqual({ ok: true, replayed: false });

    const replay = await repository.withRequestContext(
      { gamePlayerId: playerA, auditId: `test:${randomUUID()}` },
      (tx) => tx.createMatchFoundation(input),
    );
    expect(replay).toEqual({ ok: true, replayed: true });

    const creatorView = await repository.withRequestContext(
      { gamePlayerId: playerA, auditId: `test:${randomUUID()}` },
      async (tx) => ({
        match: await tx.getMatch(matchId),
        participants: await tx.listParticipants(matchId),
        teams: await tx.listTeams(matchId),
      }),
    );
    expect(creatorView.match?.id).toBe(matchId);
    expect(creatorView.participants.map((participant) => participant.seatKey)).toEqual([
      'dark',
      'light',
    ]);
    expect(creatorView.teams).toEqual([]);

    const stored = await admin.query(
      `SELECT count(*)::int AS n FROM games.command_receipts
        WHERE actor_game_player_id = $1 AND command_id = $2`,
      [playerA, command.commandId],
    );
    expect(stored.rows[0].n).toBe(1);
  });

  it('keeps a private match invisible until server-side admission grants access', async () => {
    const repository = new PgGamesRepository(runtime);
    const matchId = randomUUID();
    const source = match(matchId);
    const command = receipt(playerA, `create:${randomUUID()}`, matchId, null);

    await repository.withRequestContext(
      { gamePlayerId: playerA, auditId: `test:${randomUUID()}` },
      (tx) =>
        tx.createMatchFoundation({
          match: source,
          participants: [
            {
              id: randomUUID(),
              matchId,
              participantKind: 'player',
              gamePlayerId: playerA,
              botKey: null,
              seatKey: 'light',
              teamId: null,
            },
            {
              id: randomUUID(),
              matchId,
              participantKind: 'player',
              gamePlayerId: playerB,
              botKey: null,
              seatKey: 'dark',
              teamId: null,
            },
          ],
          teams: [],
          receipt: command,
        }),
    );

    const hiddenFromB = await repository.withRequestContext(
      { gamePlayerId: playerB, auditId: `test:${randomUUID()}` },
      (tx) => tx.getMatch(matchId),
    );
    const hiddenFromC = await repository.withRequestContext(
      { gamePlayerId: playerC, auditId: `test:${randomUUID()}` },
      (tx) => tx.getMatch(matchId),
    );
    expect(hiddenFromB).toBeNull();
    expect(hiddenFromC).toBeNull();

    await admin.query(
      `INSERT INTO games.match_access (match_id, game_player_id)
       VALUES ($1, $2)`,
      [matchId, playerB],
    );

    const admittedView = await repository.withRequestContext(
      { gamePlayerId: playerB, auditId: `test:${randomUUID()}` },
      async (tx) => ({
        match: await tx.getMatch(matchId),
        participants: await tx.listParticipants(matchId),
      }),
    );
    expect(admittedView.match?.id).toBe(matchId);
    expect(admittedView.participants).toHaveLength(2);

    await expect(
      repository.withRequestContext(
        { gamePlayerId: playerB, auditId: `test:${randomUUID()}` },
        async () => runtime.query(`INSERT INTO games.match_access (match_id, game_player_id) VALUES ($1, $2)`, [matchId, playerB]),
      ),
    ).rejects.toThrow();
  });

  it('uses optimistic lifecycle versions and does not receipt a stale mutation', async () => {
    const repository = new PgGamesRepository(runtime);
    const matchId = randomUUID();
    const source = match(matchId);
    await repository.withRequestContext(
      { gamePlayerId: playerA, auditId: `test:${randomUUID()}` },
      (tx) =>
        tx.createMatchFoundation({
          match: source,
          participants: [
            {
              id: randomUUID(),
              matchId,
              participantKind: 'player',
              gamePlayerId: playerA,
              botKey: null,
              seatKey: 'light',
              teamId: null,
            },
            {
              id: randomUUID(),
              matchId,
              participantKind: 'player',
              gamePlayerId: playerB,
              botKey: null,
              seatKey: 'dark',
              teamId: null,
            },
          ],
          teams: [],
          receipt: receipt(playerA, `create:${randomUUID()}`, matchId, null),
        }),
    );

    const ready: GameMatchV1 = {
      ...source,
      status: 'ready',
      lifecycleVersion: 2,
      updatedAt: new Date(Date.now() + 1_000).toISOString(),
    };
    const readyReceipt = receipt(playerA, `lifecycle:${randomUUID()}`, matchId, 1);
    const applied = await repository.withRequestContext(
      { gamePlayerId: playerA, auditId: `test:${randomUUID()}` },
      (tx) =>
        tx.saveMatchLifecycle({
          match: ready,
          expectedLifecycleVersion: 1,
          receipt: readyReceipt,
        }),
    );
    expect(applied).toEqual({ ok: true, replayed: false });

    const staleReceipt = receipt(playerA, `lifecycle:${randomUUID()}`, matchId, 1);
    const stale = await repository.withRequestContext(
      { gamePlayerId: playerA, auditId: `test:${randomUUID()}` },
      (tx) =>
        tx.saveMatchLifecycle({
          match: ready,
          expectedLifecycleVersion: 1,
          receipt: staleReceipt,
        }),
    );
    expect(stale).toEqual({ ok: false, reason: 'conflict' });

    const storedStale = await admin.query(
      `SELECT count(*)::int AS n FROM games.command_receipts
        WHERE actor_game_player_id = $1 AND command_id = $2`,
      [playerA, staleReceipt.commandId],
    );
    expect(storedStale.rows[0].n).toBe(0);
  });

  it('does not grant runtime access to identity source bindings', async () => {
    await expect(runtime.query(`SELECT * FROM games.game_player_account_sources`)).rejects.toThrow(
      /permission denied/i,
    );
    await expect(runtime.query(`SELECT * FROM games.game_player_seat_sources`)).rejects.toThrow(
      /permission denied/i,
    );
  });
});
