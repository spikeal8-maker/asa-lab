import { describe, expect, it } from 'vitest';
import { CHESS_LIVE_PROTOCOL_VERSION, isChessLiveClientMessage } from '../domain/protocol';

describe('ASA Chess live transport protocol', () => {
  it('accepts hello, move, control and ping messages', () => {
    expect(
      isChessLiveClientMessage({
        type: 'client.hello',
        protocol: CHESS_LIVE_PROTOCOL_VERSION,
        gameId: 'game:1',
        lastSequence: 0,
        clientInstanceId: 'client:1',
      }),
    ).toBe(true);
    expect(
      isChessLiveClientMessage({
        type: 'game.move',
        gameId: 'game:1',
        commandId: 'command:1',
        expectedVersion: 1,
        uci: 'e2e4',
      }),
    ).toBe(true);
    expect(
      isChessLiveClientMessage({
        type: 'game.offer_draw',
        gameId: 'game:1',
        commandId: 'command:2',
        expectedVersion: 2,
      }),
    ).toBe(true);
    expect(isChessLiveClientMessage({ type: 'client.ping', sentAtMs: 123 })).toBe(true);
  });

  it.each([
    null,
    [],
    {},
    {
      type: 'client.hello',
      protocol: 'wrong',
      gameId: 'g',
      lastSequence: 0,
      clientInstanceId: 'c',
    },
    { type: 'game.move', gameId: 'g', commandId: 'c', expectedVersion: 0, uci: 'e2e4' },
    { type: 'game.move', gameId: 'g', commandId: 'c', expectedVersion: 1, uci: 'e2e9' },
    { type: 'game.resign', gameId: 'g', commandId: 'c', expectedVersion: 1, uci: 'e2e4' },
    { type: 'client.ping', sentAtMs: -1 },
    { type: 'unknown' },
  ])('rejects malformed message %#', (value) => {
    expect(isChessLiveClientMessage(value)).toBe(false);
  });
});
