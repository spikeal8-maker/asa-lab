import { describe, expect, it } from 'vitest';
import { ChessLiveService } from '../application/chess-live.service';
import { MemoryChessLiveRepository } from '../infrastructure/memory-repository';
import { DeterministicLiveIds, MutableLiveClock } from './test-kit';

function setup(nowMs = 1_000) {
  const repository = new MemoryChessLiveRepository();
  const clock = new MutableLiveClock(nowMs);
  const ids = new DeterministicLiveIds();
  const service = new ChessLiveService(repository, clock, ids);
  return { repository, clock, ids, service };
}

const tenant = 'tenant:school';
const creator = { tenantId: tenant, userId: 'user:creator' };
const opponent = { tenantId: tenant, userId: 'user:opponent' };
const spectator = { tenantId: tenant, userId: 'user:spectator' };

async function acceptedGame(
  rated = false,
  colorPreference: 'white' | 'black' | 'random' = 'white',
) {
  const fixture = setup();
  const created = await fixture.service.createChallenge(creator, {
    commandId: 'command:create',
    colorPreference,
    timeControl: { initialMs: 60_000, incrementMs: 2_000 },
    rated,
    expiresInMs: 120_000,
  });
  if (!created.ok) throw new Error(created.message);
  const accepted = await fixture.service.acceptChallenge(
    opponent,
    created.value.challenge.publicCode,
    'command:accept',
  );
  if (!accepted.ok) throw new Error(accepted.message);
  return { ...fixture, challenge: accepted.value.challenge, game: accepted.value.game };
}

describe('ChessLiveService', () => {
  it('creates a challenge idempotently and rejects command reuse with another payload', async () => {
    const { service } = setup();
    const command = {
      commandId: 'command:create',
      colorPreference: 'white' as const,
      timeControl: { initialMs: 600_000, incrementMs: 5_000 },
      rated: false,
      expiresInMs: 120_000,
    };
    const first = await service.createChallenge(creator, command);
    const replay = await service.createChallenge(creator, command);
    expect(first).toMatchObject({ ok: true, value: { replayed: false } });
    expect(replay).toMatchObject({
      ok: true,
      value: {
        replayed: true,
        challenge: { id: first.ok ? first.value.challenge.id : '' },
      },
    });
    expect(await service.createChallenge(creator, { ...command, rated: true })).toMatchObject({
      ok: false,
      code: 'idempotency_conflict',
    });
  });

  it('derives tenant and actor from the principal and isolates challenge codes', async () => {
    const { service } = setup();
    const created = await service.createChallenge(creator, {
      commandId: 'command:create',
      colorPreference: 'white',
      timeControl: { initialMs: 60_000, incrementMs: 0 },
      rated: false,
      expiresInMs: 120_000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.challenge).toMatchObject({
      tenantId: tenant,
      creatorId: creator.userId,
    });
    expect(
      await service.getChallenge(
        { tenantId: 'tenant:other', userId: 'user:other' },
        created.value.challenge.publicCode,
      ),
    ).toEqual({ ok: false, code: 'not_found', message: 'challenge not found' });
  });

  it('accepts once, assigns requested colors and replays the same accept command', async () => {
    const fixture = setup();
    const created = await fixture.service.createChallenge(creator, {
      commandId: 'command:create',
      colorPreference: 'black',
      timeControl: { initialMs: 60_000, incrementMs: 2_000 },
      rated: false,
      expiresInMs: 120_000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const accepted = await fixture.service.acceptChallenge(
      opponent,
      created.value.challenge.publicCode,
      'command:accept',
    );
    expect(accepted).toMatchObject({
      ok: true,
      value: {
        replayed: false,
        game: {
          whitePlayerId: opponent.userId,
          blackPlayerId: creator.userId,
          viewerColor: 'white',
          version: 1,
          sequence: 2,
        },
      },
    });
    const replay = await fixture.service.acceptChallenge(
      opponent,
      created.value.challenge.publicCode,
      'command:accept',
    );
    expect(replay).toMatchObject({ ok: true, value: { replayed: true } });
    expect(
      await fixture.service.acceptChallenge(
        spectator,
        created.value.challenge.publicCode,
        'command:accept:second',
      ),
    ).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('enforces expected version and idempotent move commands', async () => {
    const fixture = await acceptedGame();
    fixture.clock.set(6_000);
    const command = {
      gameId: fixture.game.gameId,
      commandId: 'command:move:e4',
      expectedVersion: fixture.game.version,
      uci: 'e2e4',
    };
    const moved = await fixture.service.submitMove(creator, command);
    expect(moved).toMatchObject({
      ok: true,
      value: {
        replayed: false,
        game: {
          version: 2,
          sequence: 3,
          whiteRemainingMs: 57_000,
          activeColor: 'black',
          moves: [{ uci: 'e2e4', san: 'e4' }],
        },
        event: { type: 'move_played', sequence: 3 },
      },
    });
    const replay = await fixture.service.submitMove(creator, command);
    expect(replay).toMatchObject({
      ok: true,
      value: { replayed: true, game: { version: 2, moves: [{ uci: 'e2e4' }] } },
    });
    expect(
      await fixture.service.submitMove(opponent, {
        gameId: fixture.game.gameId,
        commandId: 'command:move:e5',
        expectedVersion: 1,
        uci: 'e7e5',
      }),
    ).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('returns a reconnect snapshot plus every event after the acknowledged sequence', async () => {
    const fixture = await acceptedGame();
    fixture.clock.set(2_000);
    const first = await fixture.service.submitMove(creator, {
      gameId: fixture.game.gameId,
      commandId: 'command:e4',
      expectedVersion: 1,
      uci: 'e2e4',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    fixture.clock.set(3_000);
    const second = await fixture.service.submitMove(opponent, {
      gameId: fixture.game.gameId,
      commandId: 'command:e5',
      expectedVersion: first.value.game.version,
      uci: 'e7e5',
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const reconnect = await fixture.service.reconnect(creator, fixture.game.gameId, 2);
    expect(reconnect).toMatchObject({
      ok: true,
      value: {
        snapshot: { version: 3, sequence: 4, moves: [{ uci: 'e2e4' }, { uci: 'e7e5' }] },
        events: [
          { sequence: 3, type: 'move_played' },
          { sequence: 4, type: 'move_played' },
        ],
        nextSequence: 4,
      },
    });
  });

  it('delays spectator events while participants receive them immediately', async () => {
    const fixture = await acceptedGame();
    fixture.clock.set(20_000);
    const moved = await fixture.service.submitMove(creator, {
      gameId: fixture.game.gameId,
      commandId: 'command:e4',
      expectedVersion: 1,
      uci: 'e2e4',
    });
    expect(moved.ok).toBe(true);
    const participantEvents = await fixture.service.spectatorEvents(
      creator,
      fixture.game.gameId,
      2,
    );
    expect(participantEvents).toMatchObject({
      ok: true,
      value: [{ sequence: 3, type: 'move_played' }],
    });
    const hidden = await fixture.service.spectatorEvents(spectator, fixture.game.gameId, 2);
    expect(hidden).toEqual({ ok: true, value: [] });
    fixture.clock.advance(15_000);
    const visible = await fixture.service.spectatorEvents(spectator, fixture.game.gameId, 2);
    expect(visible).toMatchObject({
      ok: true,
      value: [{ sequence: 3, type: 'move_played' }],
    });
  });

  it('pairs compatible matchmaking tickets and creates one authoritative game', async () => {
    const fixture = setup();
    const first = await fixture.service.joinMatchmaking(creator, {
      commandId: 'command:queue:1',
      timeControl: { initialMs: 600_000, incrementMs: 5_000 },
      rated: true,
      colorPreference: 'white',
      expiresInMs: 300_000,
    });
    expect(first).toMatchObject({
      ok: true,
      value: { ticket: { status: 'queued' }, game: null, replayed: false },
    });
    const second = await fixture.service.joinMatchmaking(opponent, {
      commandId: 'command:queue:2',
      timeControl: { initialMs: 600_000, incrementMs: 5_000 },
      rated: true,
      colorPreference: 'black',
      expiresInMs: 300_000,
    });
    expect(second).toMatchObject({
      ok: true,
      value: {
        ticket: { status: 'paired', pairedGameId: expect.any(String) },
        game: {
          whitePlayerId: creator.userId,
          blackPlayerId: opponent.userId,
          rated: true,
        },
      },
    });
    expect(fixture.repository.dump().games).toHaveLength(1);
  });

  it('updates the transparent rating ledger exactly once when a rated game finishes', async () => {
    const fixture = await acceptedGame(true);
    fixture.clock.set(2_000);
    const resigned = await fixture.service.resign(opponent, {
      gameId: fixture.game.gameId,
      commandId: 'command:resign',
      expectedVersion: 1,
    });
    expect(resigned).toMatchObject({
      ok: true,
      value: { game: { result: '1-0', termination: 'resignation' } },
    });
    const whiteRating = await fixture.service.getRating(creator, 'bullet');
    const blackRating = await fixture.service.getRating(opponent, 'bullet');
    expect(whiteRating).toMatchObject({
      ok: true,
      value: { rating: { rating: 1224, games: 1 }, ledger: [{ delta: 24 }] },
    });
    expect(blackRating).toMatchObject({
      ok: true,
      value: { rating: { rating: 1176, games: 1 }, ledger: [{ delta: -24 }] },
    });
    const replay = await fixture.service.resign(opponent, {
      gameId: fixture.game.gameId,
      commandId: 'command:resign',
      expectedVersion: 1,
    });
    expect(replay).toMatchObject({ ok: true, value: { replayed: true } });
    expect(fixture.repository.dump().ratings).toHaveLength(2);
  });
});
