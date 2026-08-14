import { describe, expect, it } from 'vitest';
import {
  applyCheckersMove,
  generateLegalCheckersMoves,
  getCheckersGameStatus,
} from '../domain/rules';
import {
  createInitialCheckersDocument,
  type CheckersDocument,
  type CheckersPiece,
  type CheckersSide,
} from '../domain/document';

function position(
  pieces: readonly CheckersPiece[],
  sideToMove: CheckersSide = 'light',
): CheckersDocument {
  return {
    schemaVersion: 1,
    ruleset: 'russian-64',
    mode: 'position',
    sideToMove,
    pieces,
    moveHistory: [],
    result: '*',
  };
}

const lightMan = (id: string, square: CheckersPiece['square']): CheckersPiece => ({
  id,
  side: 'light',
  kind: 'man',
  square,
});
const darkMan = (id: string, square: CheckersPiece['square']): CheckersPiece => ({
  id,
  side: 'dark',
  kind: 'man',
  square,
});
const lightKing = (id: string, square: CheckersPiece['square']): CheckersPiece => ({
  id,
  side: 'light',
  kind: 'king',
  square,
});

describe('official Russian draughts move generation', () => {
  it('starts with the canonical seven quiet moves for light', () => {
    const moves = generateLegalCheckersMoves(createInitialCheckersDocument());

    expect(moves).toHaveLength(7);
    expect(moves.every((move) => !move.isCapture)).toBe(true);
    expect(moves.map((move) => move.notation)).toEqual([
      'a3-b4',
      'c3-b4',
      'c3-d4',
      'e3-d4',
      'e3-f4',
      'g3-f4',
      'g3-h4',
    ]);
  });

  it('enforces capture globally and lets men capture backwards', () => {
    const forward = generateLegalCheckersMoves(
      position([lightMan('light-c3', 'c3'), lightMan('light-g1', 'g1'), darkMan('dark-d4', 'd4')]),
    );
    expect(forward.map((move) => move.notation)).toEqual(['c3:e5']);

    const backward = generateLegalCheckersMoves(
      position([lightMan('light-e5', 'e5'), darkMan('dark-d4', 'd4')]),
    );
    expect(backward.map((move) => move.notation)).toEqual(['e5:c3']);
  });

  it('offers every complete capture route without a maximum-capture rule', () => {
    const moves = generateLegalCheckersMoves(
      position([
        lightMan('light-c3', 'c3'),
        lightMan('light-h2', 'h2'),
        darkMan('dark-d4', 'd4'),
        darkMan('dark-f6', 'f6'),
        darkMan('dark-g3', 'g3'),
      ]),
    );

    expect(moves.map((move) => [move.notation, move.capturedIds])).toEqual([
      ['c3:e5:g7', ['dark-d4', 'dark-f6']],
      ['h2:f4', ['dark-g3']],
    ]);
  });

  it('gives flying kings every empty landing beyond the captured piece', () => {
    const quiet = generateLegalCheckersMoves(position([lightKing('light-king', 'd4')]));
    expect(quiet).toHaveLength(13);

    const captures = generateLegalCheckersMoves(
      position([lightKing('light-king', 'b2'), darkMan('dark-d4', 'd4')]),
    );
    expect(captures.map((move) => move.notation)).toEqual(['b2:e5', 'b2:f6', 'b2:g7', 'b2:h8']);
  });

  it('promotes during a capture and continues the same move as a flying king', () => {
    const moves = generateLegalCheckersMoves(
      position([lightMan('light-b6', 'b6'), darkMan('dark-c7', 'c7'), darkMan('dark-f6', 'f6')]),
    );

    expect(moves.map((move) => [move.notation, move.kindAfter, move.capturedIds])).toEqual([
      ['b6:d8:g5', 'king', ['dark-c7', 'dark-f6']],
      ['b6:d8:h4', 'king', ['dark-c7', 'dark-f6']],
    ]);
  });

  it('keeps captured pieces as blockers until a multi-capture is complete', () => {
    const moves = generateLegalCheckersMoves(
      position([lightKing('light-king', 'c3'), darkMan('dark-d4', 'd4'), darkMan('dark-b2', 'b2')]),
    );

    expect(moves.every((move) => new Set(move.capturedIds).size === move.capturedIds.length)).toBe(
      true,
    );
    expect(moves.every((move) => move.capturedIds.length === 1)).toBe(true);
  });
});

describe('Russian draughts move application and terminal state', () => {
  it('applies the engine-selected evidence and promotes deterministically', () => {
    const document = position([
      lightMan('light-b6', 'b6'),
      darkMan('dark-c7', 'c7'),
      darkMan('dark-f6', 'f6'),
      darkMan('dark-a7', 'a7'),
    ]);

    const applied = applyCheckersMove(document, {
      pieceId: 'light-b6',
      path: ['b6', 'd8', 'g5'],
    });

    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value).toMatchObject({ sideToMove: 'dark', result: '*' });
    expect(applied.value.pieces).toEqual([
      { id: 'light-b6', side: 'light', kind: 'king', square: 'g5' },
      { id: 'dark-a7', side: 'dark', kind: 'man', square: 'a7' },
    ]);
    expect(applied.value.moveHistory).toEqual([
      {
        ply: 1,
        side: 'light',
        pieceId: 'light-b6',
        path: ['b6', 'd8', 'g5'],
        capturedIds: ['dark-c7', 'dark-f6'],
        promoted: true,
      },
    ]);
  });

  it('rejects partial capture paths and finishes when the opponent has no pieces', () => {
    const document = position([lightMan('light-c3', 'c3'), darkMan('dark-d4', 'd4')]);

    expect(applyCheckersMove(document, { pieceId: 'light-c3', path: ['c3', 'd4'] })).toEqual({
      ok: false,
      message: 'the requested move is not legal in this position',
    });

    const applied = applyCheckersMove(document, {
      pieceId: 'light-c3',
      path: ['c3', 'e5'],
    });
    expect(applied.ok && applied.value.result).toBe('1-0');
    if (!applied.ok) return;
    expect(getCheckersGameStatus(applied.value)).toMatchObject({
      state: 'win',
      winner: 'light',
      reason: 'no-pieces',
    });
  });

  it('declares a loss when the side to move is blocked', () => {
    const blocked = position(
      [darkMan('dark-a1', 'a1'), lightMan('light-b2', 'b2'), lightMan('light-c3', 'c3')],
      'dark',
    );

    expect(getCheckersGameStatus(blocked)).toEqual({
      state: 'win',
      result: '1-0',
      winner: 'light',
      reason: 'no-legal-moves',
      legalMoveCount: 0,
      captureRequired: false,
    });
  });
});
