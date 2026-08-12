import { describe, expect, it } from 'vitest';
import { applyMoveUnchecked, findLegalMoveByUci, parseFen, toFen } from '../domain/chess';
import {
  createEmptyChessDocument,
  playChessDocumentMove,
  type ChessDocument,
} from '../domain/document';
import { explainAsaMoveReview } from '../domain/review-explanation';
import { reviewChessDocument, type AsaGameReview } from '../domain/review';

function play(document: ChessDocument, uci: string): ChessDocument {
  const result = playChessDocumentMove(document, uci);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}

function reviewedBlunder(): AsaGameReview {
  let document = createEmptyChessDocument();
  for (const uci of ['e2e4', 'c7c6', 'f1b5', 'e7e5']) document = play(document, uci);
  return reviewChessDocument(document, 1);
}

describe('fact-only ASA review explanations', () => {
  it('explains a real reviewed blunder with canonical evaluation and capture facts', () => {
    const review = reviewedBlunder();
    const explanation = explainAsaMoveReview(review, 4);

    expect(explanation).toMatchObject({
      ok: true,
      value: {
        algorithm: 'asa-review-explanation-v1',
        evidenceLevel: 'verified-root',
        ply: 4,
        facts: [
          {
            kind: 'evaluation_loss',
            playedUci: 'e7e5',
            bestUci: 'c6b5',
            centipawnLoss: 302,
          },
          { kind: 'best_capture', bestUci: 'c6b5', capturedPiece: 'bishop' },
        ],
      },
    });
    if (!explanation.ok) return;
    expect(explanation.value.summary).toContain('немедленно забирал слона');
    expect(explanation.value.summary).not.toMatch(/вилка|связк|стратег|план/i);
  });

  it('describes a verified mate without presenting the private mate sentinel as cp', () => {
    const initialFen = '7k/5Q2/6K1/8/8/8/8/8 w - - 0 1';
    const document = play(
      { ...createEmptyChessDocument(), initialFen, currentFen: initialFen },
      'f7f1',
    );
    const review = reviewChessDocument(document, 1);
    const explanation = explainAsaMoveReview(review, 1);

    expect(explanation).toMatchObject({
      ok: true,
      value: { facts: [{ kind: 'best_check', checkmate: true }] },
    });
    if (!explanation.ok) return;
    expect(explanation.value.summary).toContain('ставил мат');
    expect(explanation.value.summary).not.toMatch(/cp|99048|100000/i);
    expect(explanation.value.facts.some((fact) => fact.kind === 'evaluation_loss')).toBe(false);
  });

  it('rejects a legal but forged best root that was not selected by ASA Review', () => {
    const review = reviewedBlunder();
    const reviewedMove = review.moves[3];
    if (!reviewedMove) throw new Error('expected ply four');
    const root = parseFen(reviewedMove.fenBefore);
    if (!root.ok) throw new Error(root.message);
    const forgedBest = findLegalMoveByUci(root.value, 'd7d5');
    if (!forgedBest) throw new Error('expected a legal alternative');
    const forgedBestFen = toFen(applyMoveUnchecked(root.value, forgedBest));
    const forgedReview: AsaGameReview = {
      ...review,
      moves: review.moves.map((move) =>
        move.ply === 4
          ? {
              ...move,
              bestUci: 'd7d5',
              bestRoot: {
                fenBefore: move.fenBefore,
                moveUci: 'd7d5',
                fenAfter: forgedBestFen,
              },
            }
          : move,
      ),
    };

    expect(explainAsaMoveReview(forgedReview, 4)).toEqual({
      ok: false,
      message: 'Review explanation does not match recalculated ASA Review.',
    });
  });

  it('rejects mismatched ply and altered evaluation evidence', () => {
    const review = reviewedBlunder();
    const reviewedMove = review.moves[3];
    if (!reviewedMove) throw new Error('expected ply four');
    const alteredReview: AsaGameReview = {
      ...review,
      moves: review.moves.map((move) =>
        move.ply === 4 ? { ...move, centipawnLoss: move.centipawnLoss + 1 } : move,
      ),
    };

    expect(explainAsaMoveReview(review, 99)).toEqual({
      ok: false,
      message: 'Review explanation ply does not match the ASA Review.',
    });
    expect(explainAsaMoveReview(alteredReview, 4)).toMatchObject({ ok: false });
  });
});
