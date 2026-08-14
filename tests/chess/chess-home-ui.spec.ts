import { describe, expect, it } from 'vitest';
import { buildChessHomeSummary } from '../../apps/web/src/chess/chess-home-ui';
import { createChessGameDocument } from '../../contexts/chess/index';

describe('ASA Chess home summary', () => {
  it('derives truthful dashboard values from the persisted chess document', () => {
    const summary = buildChessHomeSummary(createChessGameDocument({ mode: 'analysis' }));

    expect(summary).toMatchObject({
      solvedPuzzles: 0,
      totalPuzzles: 3,
      learningPercent: 0,
      puzzleRating: 400,
      halfMoves: 0,
      completedMoves: 0,
      recentMoves: [],
      botName: null,
    });
    expect(summary.nextPuzzleId).toBeTruthy();
  });
});
