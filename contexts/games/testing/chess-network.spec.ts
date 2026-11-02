import { describe, expect, it } from 'vitest';
import {
  applyNetworkChess,
  createNetworkChess,
  expireNetworkChess,
  networkMatchView,
  type NetworkMatchRecord,
} from '../domain/chess-network';

function record(): NetworkMatchRecord {
  return {
    id: 'match',
    status: 'active',
    version: 1,
    sequence: 1,
    scope: 'platform',
    white: { playerId: 'white', displayAlias: 'White' },
    black: { playerId: 'black', displayAlias: 'Black' },
    state: createNetworkChess(60000, 2000, 1000),
    updatedAt: 1000,
    termination: '',
  };
}
describe('server-owned casual Chess runtime', () => {
  it('rejects illegal/out-of-turn moves and accepts a complete rules checkmate', () => {
    const game = record();
    expect(() => applyNetworkChess(game, 'black', 'move', 'e7e5', 1500)).toThrow('ход соперника');
    expect(() => applyNetworkChess(game, 'white', 'move', 'e2e5', 1500)).toThrow('невозможен');
    for (const [actor, uci] of [
      ['white', 'f2f3'],
      ['black', 'e7e5'],
      ['white', 'g2g4'],
      ['black', 'd8h4'],
    ])
      game.state = applyNetworkChess(game, actor!, 'move', uci, 2000);
    expect(game.state.document.result).toBe('0-1');
    expect(game.state.document.termination).toBe('checkmate');
  });
  it('projects authoritative clocks without rewinding and settles timeout exactly', () => {
    const game = record();
    const view = networkMatchView(game, 'white', 3500);
    expect(view.whiteRemainingMs).toBe(57500);
    expect(view.blackRemainingMs).toBe(60000);
    game.state = applyNetworkChess(game, 'white', 'move', 'e2e4', 3500);
    expect(game.state.document.clock?.whiteMs).toBe(59500);
    expect(networkMatchView(game, 'white', 2000).serverNowMs).toBe(3500);
    expect(expireNetworkChess(game.state, 63500).document).toMatchObject({
      result: '1-0',
      termination: 'timeout',
    });
  });
  it('never permits a player to accept their own draw offer', () => {
    const game = record();
    game.state = applyNetworkChess(game, 'white', 'draw-offer', undefined, 1200);
    expect(() => applyNetworkChess(game, 'white', 'draw-accept', undefined, 1300)).toThrow(
      'Нет предложения',
    );
    game.state = applyNetworkChess(game, 'black', 'draw-accept', undefined, 1400);
    expect(game.state.document.result).toBe('1/2-1/2');
  });
  it('supports each legal promotion choice through the shared rules engine', () => {
    for (const promotion of ['q', 'r', 'b', 'n']) {
      const game = record();
      game.state.document = {
        ...game.state.document,
        initialFen: '7k/P7/8/8/8/8/8/K7 w - - 0 1',
        currentFen: '7k/P7/8/8/8/8/8/K7 w - - 0 1',
      };
      const next = applyNetworkChess(game, 'white', 'move', `a7a8${promotion}`, 1500);
      expect(next.document.moves[0]?.uci).toBe(`a7a8${promotion}`);
    }
  });
});
