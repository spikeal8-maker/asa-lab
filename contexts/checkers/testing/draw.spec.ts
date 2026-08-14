import { describe, expect, it } from 'vitest';
import type { CheckersDocument, CheckersPiece } from '../domain/document';
import {
  advanceCheckersDrawTracker,
  checkersPositionKey,
  createCheckersDrawTracker,
  getCheckersAutomaticDrawReason,
} from '../domain/draw';
import { applyCheckersMove } from '../domain/rules';

function document(pieces: readonly CheckersPiece[]): CheckersDocument {
  return {
    schemaVersion: 1,
    ruleset: 'russian-64',
    mode: 'game',
    sideToMove: 'light',
    pieces,
    moveHistory: [],
    result: '*',
  };
}

describe('official Russian draughts automatic draw tracking', () => {
  it('fingerprints position and side without depending on piece ids or order', () => {
    const first = document([
      { id: 'white-a', side: 'light', kind: 'king', square: 'd4' },
      { id: 'black-a', side: 'dark', kind: 'king', square: 'h8' },
    ]);
    const second = document([
      { id: 'black-renamed', side: 'dark', kind: 'king', square: 'h8' },
      { id: 'white-renamed', side: 'light', kind: 'king', square: 'd4' },
    ]);
    expect(checkersPositionKey(first)).toBe(checkersPositionKey(second));
    expect(checkersPositionKey({ ...second, sideToMove: 'dark' })).not.toBe(
      checkersPositionKey(first),
    );
  });

  it('detects the third occurrence of the same position with the same side to move', () => {
    let game = document([
      { id: 'light-king', side: 'light', kind: 'king', square: 'd2' },
      { id: 'dark-king', side: 'dark', kind: 'king', square: 'h8' },
    ]);
    let tracker = createCheckersDrawTracker(game);
    const cycle = [
      { pieceId: 'light-king', path: ['d2', 'e3'] as const },
      { pieceId: 'dark-king', path: ['h8', 'g7'] as const },
      { pieceId: 'light-king', path: ['e3', 'd2'] as const },
      { pieceId: 'dark-king', path: ['g7', 'h8'] as const },
    ];

    for (const move of [...cycle, ...cycle]) {
      const before = game;
      const applied = applyCheckersMove(game, move);
      if (!applied.ok) throw new Error(applied.message);
      game = applied.value;
      tracker = advanceCheckersDrawTracker(tracker, before, game);
    }
    expect(getCheckersAutomaticDrawReason(tracker, game)).toBe('threefold-repetition');
  });

  it('tracks the official 15-move king-only and stable-material limits in plies', () => {
    const kings = document([
      { id: 'light-king-1', side: 'light', kind: 'king', square: 'a1' },
      { id: 'light-king-2', side: 'light', kind: 'king', square: 'c1' },
      { id: 'dark-king-1', side: 'dark', kind: 'king', square: 'h8' },
      { id: 'dark-king-2', side: 'dark', kind: 'king', square: 'f8' },
    ]);
    const base = createCheckersDrawTracker(kings);
    expect(getCheckersAutomaticDrawReason({ ...base, kingOnlyQuietPlies: 30 }, kings)).toBe(
      'king-only-15-moves',
    );
    expect(
      getCheckersAutomaticDrawReason(
        { ...base, kingOnlyQuietPlies: 0, materialStablePlies: 60 },
        kings,
      ),
    ).toBe('four-or-five-piece-30-moves');
  });

  it('applies the five-move regulation ending only while its material signature holds', () => {
    const ending = document([
      { id: 'light-king-1', side: 'light', kind: 'king', square: 'a1' },
      { id: 'light-king-2', side: 'light', kind: 'king', square: 'c1' },
      { id: 'dark-king', side: 'dark', kind: 'king', square: 'h8' },
    ]);
    const tracker = createCheckersDrawTracker(ending);
    expect(tracker.regulationSignature).not.toBeNull();
    expect(getCheckersAutomaticDrawReason({ ...tracker, regulationPlies: 10 }, ending)).toBe(
      'regulation-ending-5-moves',
    );

    const changed = document([
      ...ending.pieces,
      { id: 'dark-man', side: 'dark', kind: 'man', square: 'b6' },
    ]);
    expect(createCheckersDrawTracker(changed).regulationSignature).toBeNull();
  });
});
