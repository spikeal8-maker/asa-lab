import { describe, expect, it } from 'vitest';
import { findLegalMoveByUci, parseFen, toFen } from '../domain/chess';
import { createEmptyChessDocument, playChessDocumentMove } from '../domain/document';
import { asaMoveQuality, reviewChessDocument } from '../domain/review';

describe('ASA post-game review', () => {
  it('uses a transparent monotonic quality formula', () => {
    expect(asaMoveQuality(0)).toBe(100);
    expect(asaMoveQuality(20)).toBeGreaterThan(asaMoveQuality(60));
    expect(asaMoveQuality(60)).toBeGreaterThan(asaMoveQuality(250));
    expect(asaMoveQuality(900)).toBeLessThan(10);
    expect(() => asaMoveQuality(-1)).toThrow(/non-negative finite/);
  });

  it('reviews every replayed move with a legal best-move comparison', () => {
    let document = createEmptyChessDocument('analysis');
    for (const move of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']) {
      const next = playChessDocumentMove(document, move);
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      document = next.value;
    }
    const review = reviewChessDocument(document, 1);
    expect(review).toMatchObject({
      algorithm: 'asa-review-v1',
      depth: 1,
      moves: expect.any(Array),
      whiteQuality: expect.any(Number),
      blackQuality: expect.any(Number),
      overallQuality: expect.any(Number),
    });
    expect(review.moves).toHaveLength(document.moves.length);
    for (const [index, move] of review.moves.entries()) {
      expect(move.ply).toBe(index + 1);
      expect(move.playedUci).toBe(document.moves[index]?.uci);
      expect(move.fenBefore).toBe(document.moves[index]?.fenBefore);
      expect(move.fenAfter).toBe(document.moves[index]?.fenAfter);
      expect(move.bestUci).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
      const root = parseFen(move.fenBefore);
      expect(root.ok).toBe(true);
      if (!root.ok || !move.bestUci) continue;
      expect(findLegalMoveByUci(root.value, move.bestUci)).not.toBeNull();
      expect(move.bestRoot).toMatchObject({
        fenBefore: toFen(root.value),
        moveUci: move.bestUci,
        fenAfter: expect.any(String),
      });
      expect(move.centipawnLoss).toBeGreaterThanOrEqual(0);
      expect(move.asaQuality).toBeGreaterThanOrEqual(0);
      expect(move.asaQuality).toBeLessThanOrEqual(100);
    }
    expect(Object.values(review.counts).reduce((sum, value) => sum + value, 0)).toBe(
      document.moves.length,
    );
    expect(review.note).toContain('not Chess.com Accuracy/CAPS');
  });

  it('returns an empty but valid review for a new analysis board', () => {
    expect(reviewChessDocument(createEmptyChessDocument('analysis'))).toEqual({
      algorithm: 'asa-review-v1',
      depth: 1,
      moves: [],
      whiteQuality: null,
      blackQuality: null,
      overallQuality: null,
      counts: {
        best: 0,
        excellent: 0,
        good: 0,
        inaccuracy: 0,
        mistake: 0,
        blunder: 0,
      },
      note: 'ASA Quality is an original transparent centipawn-loss score. It is not Chess.com Accuracy/CAPS and must not be presented as formula parity.',
    });
  });
});
