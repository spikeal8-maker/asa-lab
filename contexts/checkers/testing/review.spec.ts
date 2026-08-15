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

  it('does not call a capture a mistake without a verified alternative', () => {
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
      'forced-exchange',
      'turning-point',
      'promotion',
      'result',
    ]);
    expect(review.find((item) => item.theme === 'turning-point')).toMatchObject({
      ply: 1,
      explanation: expect.stringContaining('самое крупное взятие (2)'),
    });
  });

  it('reports a tactical loss only when another legal move reduces the immediate capture', () => {
    const position: CheckersDocument = {
      schemaVersion: 1,
      ruleset: 'russian-64',
      mode: 'game',
      sideToMove: 'light',
      pieces: [
        { id: 'light-c3', side: 'light', kind: 'man', square: 'c3' },
        { id: 'light-g1', side: 'light', kind: 'man', square: 'g1' },
        { id: 'dark-e5', side: 'dark', kind: 'man', square: 'e5' },
        { id: 'dark-h8', side: 'dark', kind: 'man', square: 'h8' },
      ],
      moveHistory: [],
      result: '*',
    };
    const afterBadMove = applyCheckersMove(position, { pieceId: 'light-c3', path: ['c3', 'd4'] });
    expect(afterBadMove.ok).toBe(true);
    if (!afterBadMove.ok) return;
    const afterCapture = applyCheckersMove(afterBadMove.value, {
      pieceId: 'dark-e5',
      path: ['e5', 'c3'],
    });
    expect(afterCapture.ok).toBe(true);
    if (!afterCapture.ok) return;

    const review = analyzeCheckersGameReview(afterCapture.value);
    expect(review.find((item) => item.theme === 'tactical-loss')).toMatchObject({
      ply: 1,
      title: expect.stringContaining('c3-d4'),
      explanation: expect.stringContaining('уменьшал ближайшую потерю'),
    });
  });
});
