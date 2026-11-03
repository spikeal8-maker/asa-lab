import { describe, expect, it } from 'vitest';
import { createInitialCheckersDocument, generateLegalCheckersMoves } from '@asa-lab/checkers';
import {
  applyNetworkCheckers,
  checkersNetworkMatchView,
  createNetworkCheckers,
  expireNetworkCheckers,
  type NetworkCheckersRecord,
} from '../domain/checkers-network';

function record(): NetworkCheckersRecord {
  return {
    id: 'game',
    status: 'active',
    version: 1,
    sequence: 1,
    scope: 'platform',
    white: { playerId: 'a', displayAlias: 'A' },
    black: { playerId: 'b', displayAlias: 'B' },
    state: createNetworkCheckers(60000, 2000, 1000),
    updatedAt: 1000,
    termination: '',
  };
}
describe('authoritative Russian-64 network adapter', () => {
  it('uses the current engine, enforces turns and does not accept supplied pieces or illegal paths', () => {
    const game = record();
    expect(game.state.document).toEqual(createInitialCheckersDocument('game'));
    expect(() => applyNetworkCheckers(game, 'b', 'move', ['b6', 'a5'], 2000)).toThrow();
    expect(() => applyNetworkCheckers(game, 'foreign', 'move', ['a3', 'b4'], 2000)).toThrow();
    expect(() => applyNetworkCheckers(game, 'a', 'move', ['a3', 'd6'], 2000)).toThrow();
    const moved = applyNetworkCheckers(game, 'a', 'move', ['a3', 'b4'], 2000);
    expect(moved.document.moveHistory).toHaveLength(1);
    expect(moved.clock.whiteMs).toBe(61000);
    expect(moved.document.sideToMove).toBe('dark');
    expect(game.state.document.moveHistory).toEqual([]);
  });
  it('requires the complete capture route, handles promotion and finishes a rules win', () => {
    const game = record();
    game.state.document = {
      schemaVersion: 1,
      ruleset: 'russian-64',
      mode: 'position',
      sideToMove: 'light',
      result: '*',
      moveHistory: [],
      pieces: [
        { id: 'w', side: 'light', kind: 'man', square: 'b6' },
        { id: 'b1', side: 'dark', kind: 'man', square: 'c7' },
        { id: 'b2', side: 'dark', kind: 'man', square: 'f6' },
      ],
    };
    const legal = generateLegalCheckersMoves(game.state.document);
    expect(legal.every((move) => move.isCapture)).toBe(true);
    expect(legal.some((move) => move.kindAfter === 'king')).toBe(true);
    expect(() => applyNetworkCheckers(game, 'a', 'move', ['b6', 'a7'], 1100)).toThrow();
    expect(() => applyNetworkCheckers(game, 'a', 'move', ['b6', 'd8'], 1100)).toThrow();
    const route = legal.find((move) => move.capturedIds.length === 2)!;
    expect(route).toBeDefined();
    const won = applyNetworkCheckers(game, 'a', 'move', route.path, 1100);
    expect(won.document.result).toBe('1-0');
    expect(won.document.pieces).toHaveLength(1);
    expect(won.document.pieces[0]!.kind).toBe('king');
  });
  it('applies timeout, draw agreement and resignation without inventing results on revocation', () => {
    const game = record();
    expect(expireNetworkCheckers(game.state, 61000)).toMatchObject({
      document: { result: '0-1' },
      termination: 'timeout',
      clock: { whiteMs: 0 },
    });
    const offered = applyNetworkCheckers(game, 'a', 'draw-offer', undefined, 2000);
    expect(() =>
      applyNetworkCheckers({ ...game, state: offered }, 'a', 'draw-accept', undefined, 2100),
    ).toThrow();
    const draw = applyNetworkCheckers(
      { ...game, state: offered },
      'b',
      'draw-accept',
      undefined,
      2100,
    );
    expect(draw).toMatchObject({
      document: { result: '1/2-1/2' },
      termination: 'agreement',
      drawOfferedBy: null,
    });
    expect(applyNetworkCheckers(game, 'b', 'resign', undefined, 2000).document.result).toBe('1-0');
    expect(
      checkersNetworkMatchView(
        { ...game, status: 'aborted', termination: 'security_abort' },
        'a',
        2000,
      ),
    ).toMatchObject({ status: 'aborted', result: '*', termination: 'security_abort' });
  });
  it('keeps displayed clocks finite and monotonic when server time goes backwards', () => {
    const game = record();
    const moved = applyNetworkCheckers(game, 'a', 'move', ['a3', 'b4'], 3000);
    const view = checkersNetworkMatchView({ ...game, state: moved }, 'b', 1000);
    expect(view.serverNowMs).toBe(3000);
    expect(view.blackRemainingMs).toBe(60000);
    expect(() => createNetworkCheckers(NaN, 0, 1000)).toThrow();
    expect(() => createNetworkCheckers(60000, 0, Infinity)).toThrow();
  });
  it('freezes a revoked game at the abort time without refunding time or ticking after reload', () => {
    const game = record();
    const before = checkersNetworkMatchView(game, 'a', 31000);
    const aborted = {
      ...game,
      status: 'aborted' as const,
      updatedAt: 31000,
      termination: 'security_abort',
    };
    expect(before.whiteRemainingMs).toBe(30000);
    expect(checkersNetworkMatchView(aborted, 'a', 31000).whiteRemainingMs).toBe(30000);
    expect(checkersNetworkMatchView(aborted, 'b', 91000).whiteRemainingMs).toBe(30000);
    expect(checkersNetworkMatchView(aborted, 'b', 91000).blackRemainingMs).toBe(60000);
    expect(checkersNetworkMatchView(aborted, 'b', 91000).result).toBe('*');
  });
});
