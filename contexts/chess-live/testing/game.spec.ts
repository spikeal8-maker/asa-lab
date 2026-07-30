import { describe, expect, it } from 'vitest';
import {
  acceptLiveChessDraw,
  claimLiveChessTimeout,
  createLiveChessGame,
  declineLiveChessDraw,
  offerLiveChessDraw,
  resignLiveChessGame,
  submitLiveChessMove,
} from '../domain/game';
import type { LiveChessGame } from '../domain/model';

function game(overrides: Partial<LiveChessGame> = {}): LiveChessGame {
  const created = createLiveChessGame({
    id: 'game:1',
    tenantId: 'tenant:1',
    challengeId: 'challenge:1',
    whitePlayerId: 'user:white',
    blackPlayerId: 'user:black',
    timeControl: { initialMs: 60_000, incrementMs: 2_000 },
    rated: true,
    nowMs: 1_000,
  });
  if (!created.ok) throw new Error(created.message);
  return { ...created.value, ...overrides };
}

function context(
  actorId: string,
  commandId: string,
  nowMs: number,
  kind: 'submit_move' | 'offer_draw' | 'accept_draw' | 'decline_draw' | 'resign' | 'claim_timeout',
) {
  return { actorId, commandId, nowMs, kind } as const;
}

describe('server-authoritative live game aggregate', () => {
  it('starts with server clocks and no client-authored result', () => {
    expect(game()).toMatchObject({
      status: 'active',
      currentFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      clock: {
        whiteRemainingMs: 60_000,
        blackRemainingMs: 60_000,
        activeColor: 'white',
        turnStartedAtMs: 1_000,
      },
      result: '*',
      termination: 'ongoing',
      version: 1,
      sequence: 1,
    });
  });

  it('decrements the mover clock by server time and applies increment after a legal move', () => {
    const result = submitLiveChessMove(
      game(),
      context('user:white', 'command:move:1', 6_000, 'submit_move'),
      'e2e4',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.game).toMatchObject({
      version: 2,
      sequence: 2,
      currentFen: expect.stringContaining(' b KQkq e3 '),
      clock: {
        whiteRemainingMs: 57_000,
        blackRemainingMs: 60_000,
        activeColor: 'black',
        turnStartedAtMs: 6_000,
        lastServerNowMs: 6_000,
      },
      moves: [
        {
          ply: 1,
          playerId: 'user:white',
          color: 'white',
          uci: 'e2e4',
          san: 'e4',
          elapsedMs: 5_000,
          whiteRemainingMs: 57_000,
          blackRemainingMs: 60_000,
        },
      ],
    });
    expect(result.value.events).toEqual([
      expect.objectContaining({
        type: 'move_played',
        actorId: 'user:white',
        payload: expect.objectContaining({ uci: 'e2e4', san: 'e4', activeColor: 'black' }),
      }),
    ]);
  });

  it('rejects moves from a spectator, the wrong color and illegal notation', () => {
    expect(
      submitLiveChessMove(
        game(),
        context('user:spectator', 'command:1', 2_000, 'submit_move'),
        'e2e4',
      ),
    ).toMatchObject({ ok: false, code: 'forbidden' });
    expect(
      submitLiveChessMove(
        game(),
        context('user:black', 'command:2', 2_000, 'submit_move'),
        'e7e5',
      ),
    ).toMatchObject({ ok: false, code: 'not_your_turn' });
    expect(
      submitLiveChessMove(
        game(),
        context('user:white', 'command:3', 2_000, 'submit_move'),
        'e2e5',
      ),
    ).toMatchObject({ ok: false, code: 'illegal_move' });
    expect(
      submitLiveChessMove(
        game(),
        context('user:white', 'command:4', 2_000, 'submit_move'),
        'not-a-move',
      ),
    ).toMatchObject({ ok: false, code: 'validation_error' });
  });

  it('finishes on timeout before accepting a late move', () => {
    const result = submitLiveChessMove(
      game(),
      context('user:white', 'command:late', 61_000, 'submit_move'),
      'e2e4',
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        game: {
          status: 'finished',
          result: '0-1',
          termination: 'timeout',
          winnerId: 'user:black',
          moves: [],
          clock: { whiteRemainingMs: 0 },
        },
        events: [
          {
            type: 'game_finished',
            payload: expect.objectContaining({ termination: 'timeout' }),
          },
        ],
      },
    });
  });

  it('allows the opponent to claim a server-confirmed timeout only after expiry', () => {
    expect(
      claimLiveChessTimeout(
        game(),
        context('user:black', 'command:claim:early', 30_000, 'claim_timeout'),
      ),
    ).toEqual({
      ok: false,
      code: 'conflict',
      message: 'the active player still has time remaining',
    });
    expect(
      claimLiveChessTimeout(
        game(),
        context('user:black', 'command:claim:late', 61_000, 'claim_timeout'),
      ),
    ).toMatchObject({
      ok: true,
      value: {
        game: { result: '0-1', termination: 'timeout', winnerId: 'user:black' },
      },
    });
  });

  it('supports a draw offer that only the opponent can accept or decline', () => {
    const offered = offerLiveChessDraw(
      game(),
      context('user:white', 'command:offer', 2_000, 'offer_draw'),
    );
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;
    expect(offered.value.game.drawOffer).toEqual({ offeredBy: 'user:white', offeredAtMs: 2_000 });
    expect(
      acceptLiveChessDraw(
        offered.value.game,
        context('user:white', 'command:self-accept', 3_000, 'accept_draw'),
      ),
    ).toMatchObject({ ok: false, code: 'forbidden' });
    const declined = declineLiveChessDraw(
      offered.value.game,
      context('user:black', 'command:decline', 3_000, 'decline_draw'),
    );
    expect(declined).toMatchObject({ ok: true, value: { game: { drawOffer: null } } });

    const offeredAgain = offerLiveChessDraw(
      declined.ok ? declined.value.game : game(),
      context('user:black', 'command:offer:2', 4_000, 'offer_draw'),
    );
    expect(offeredAgain.ok).toBe(true);
    if (!offeredAgain.ok) return;
    expect(
      acceptLiveChessDraw(
        offeredAgain.value.game,
        context('user:white', 'command:accept', 5_000, 'accept_draw'),
      ),
    ).toMatchObject({
      ok: true,
      value: {
        game: {
          status: 'finished',
          result: '1/2-1/2',
          termination: 'draw_agreement',
          winnerId: null,
        },
      },
    });
  });

  it('finishes immediately when a participant resigns', () => {
    expect(
      resignLiveChessGame(
        game(),
        context('user:black', 'command:resign', 2_000, 'resign'),
      ),
    ).toMatchObject({
      ok: true,
      value: {
        game: {
          status: 'finished',
          result: '1-0',
          termination: 'resignation',
          winnerId: 'user:white',
        },
      },
    });
  });

  it('detects an automatic checkmate and emits move then finish events', () => {
    let current = game({
      currentFen: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3',
      clock: {
        whiteRemainingMs: 60_000,
        blackRemainingMs: 60_000,
        activeColor: 'white',
        turnStartedAtMs: 1_000,
        lastServerNowMs: 1_000,
      },
    });
    // The supplied FEN is already checkmate; finished games are normally closed by the previous move.
    // Use Fool's Mate from the start to prove automatic closure instead.
    for (const [actor, move, now] of [
      ['user:white', 'f2f3', 2_000],
      ['user:black', 'e7e5', 3_000],
      ['user:white', 'g2g4', 4_000],
      ['user:black', 'd8h4', 5_000],
    ] as const) {
      const result = submitLiveChessMove(
        current,
        context(actor, `command:${move}`, now, 'submit_move'),
        move,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      current = result.value.game;
      if (move === 'd8h4') {
        expect(result.value.events.map((event) => event.type)).toEqual([
          'move_played',
          'game_finished',
        ]);
      }
    }
    expect(current).toMatchObject({
      status: 'finished',
      result: '0-1',
      termination: 'checkmate',
      winnerId: 'user:black',
    });
  });
});
