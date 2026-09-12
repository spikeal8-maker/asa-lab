import { describe, expect, it } from 'vitest';
import { type CheckersDocument, type CheckersPiece } from '../domain/document';
import { applyCheckersMove, getCheckersGameStatus } from '../domain/rules';

function terminalCapturePosition(
  sideToMove: 'light' | 'dark',
  pieces: readonly CheckersPiece[],
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

describe('Checkers winner-side regression', () => {
  it.each([
    ['light', 'light-c3', 'c3', 'dark-d4', 'd4', 'e5', '1-0'],
    ['dark', 'dark-e5', 'e5', 'light-d4', 'd4', 'c3', '0-1'],
  ] as const)(
    'records a %s win with the correct result token',
    (side, pieceId, from, opponentId, opponentSquare, to, result) => {
      const document = terminalCapturePosition(side, [
        { id: pieceId, side, kind: 'man', square: from },
        {
          id: opponentId,
          side: side === 'light' ? 'dark' : 'light',
          kind: 'man',
          square: opponentSquare,
        },
      ]);
      const applied = applyCheckersMove(document, { pieceId, path: [from, to] });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(applied.value.result).toBe(result);
      expect(getCheckersGameStatus(applied.value)).toMatchObject({ state: 'win', winner: side });
    },
  );
});
