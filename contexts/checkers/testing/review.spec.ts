import { describe, expect, it } from 'vitest';
import { createInitialCheckersDocument, type CheckersDocument } from '../domain/document';
import { analyzeCheckersGameReview, replayCheckersGame } from '../domain/review';
import { applyCheckersMove, generateLegalCheckersMoves } from '../domain/rules';

describe('evidence-based Checkers post-game review', () => {
  it('replays a standard game without changing the original record', () => {
    const initial = createInitialCheckersDocument();
    const firstMove = generateLegalCheckersMoves(initial)[0]!;
    const afterFirst = applyCheckersMove(initial, firstMove);
    expect(afterFirst.ok).toBe(true);
    if (!afterFirst.ok) return;
    const secondMove = generateLegalCheckersMoves(afterFirst.value)[0]!;
    const afterSecond = applyCheckersMove(afterFirst.value, secondMove);
    expect(afterSecond.ok).toBe(true);
    if (!afterSecond.ok) return;

    const replay = replayCheckersGame(afterSecond.value, 1);
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.moveHistory).toEqual([afterSecond.value.moveHistory[0]]);
    expect(afterSecond.value.moveHistory).toHaveLength(2);
  });

  it('reports verified capture safety, tactical loss and the largest turning point', () => {
    const document: CheckersDocument = {
      ...createInitialCheckersDocument(),
      moveHistory: [
        {
          ply: 1,
          side: 'light',
          pieceId: 'light-01',
          path: ['a3', 'c5', 'e7'],
          capturedIds: ['dark-01', 'dark-02'],
          promoted: true,
        },
      ],
      result: '1-0',
    };
    const review = analyzeCheckersGameReview(document);
    expect(review.map((item) => item.theme)).toEqual([
      'mandatory-capture',
      'tactical-loss',
      'turning-point',
      'promotion',
      'result',
    ]);
    expect(review.find((item) => item.theme === 'turning-point')).toMatchObject({
      ply: 1,
      explanation: expect.stringContaining('самое крупное взятие (2)'),
    });
  });
});
