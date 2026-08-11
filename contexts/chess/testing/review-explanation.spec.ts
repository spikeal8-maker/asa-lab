import { describe, expect, it } from 'vitest';
import {
  START_FEN,
  applyMoveUnchecked,
  findLegalMoveByUci,
  parseFen,
  toFen,
} from '../domain/chess';
import { createEmptyChessDocument, playChessDocumentMove } from '../domain/document';
import { explainAsaMoveReview } from '../domain/review-explanation';
import { reviewChessDocument, type AsaMoveReview } from '../domain/review';

function reviewedBlunder(): AsaMoveReview {
  let document = createEmptyChessDocument();
  for (const uci of ['e2e4', 'c7c6', 'f1b5', 'e7e5']) {
    const played = playChessDocumentMove(document, uci);
    if (!played.ok) throw new Error(played.message);
    document = played.value;
  }
  const move = reviewChessDocument(document, 1).moves.at(-1);
  if (!move) throw new Error('expected one reviewed move');
  return move;
}

function reviewFromRoot(input: {
  fen: string;
  playedUci: string;
  bestUci: string;
  centipawnLoss?: number;
}): AsaMoveReview {
  const root = parseFen(input.fen);
  if (!root.ok) throw new Error(root.message);
  const played = findLegalMoveByUci(root.value, input.playedUci);
  const best = findLegalMoveByUci(root.value, input.bestUci);
  if (!played || !best) throw new Error('test moves must be legal');
  const fenBefore = toFen(root.value);
  const fenAfter = toFen(applyMoveUnchecked(root.value, played));
  const bestFenAfter = toFen(applyMoveUnchecked(root.value, best));
  return {
    ply: 1,
    color: root.value.turn,
    playedUci: input.playedUci,
    playedSan: input.playedUci,
    fenBefore,
    fenAfter,
    bestUci: input.bestUci,
    bestRoot: { fenBefore, moveUci: input.bestUci, fenAfter: bestFenAfter },
    evaluationBeforeCp: 0,
    evaluationAfterCp: -180,
    bestEvaluationAfterCp: 40,
    centipawnLoss: input.centipawnLoss ?? 220,
    classification: 'mistake',
    asaQuality: 29,
  };
}

describe('fact-only ASA review explanations', () => {
  it('explains a real reviewed blunder with canonical evaluation and capture facts', () => {
    const move = reviewedBlunder();
    const explanation = explainAsaMoveReview(move);

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

  it('reports an immediately verified checking best move without adding a motif', () => {
    const move = reviewFromRoot({
      fen: '7k/8/8/8/8/8/6R1/K7 w - - 0 1',
      playedUci: 'g2g3',
      bestUci: 'g2g8',
    });
    const explanation = explainAsaMoveReview(move);

    expect(explanation).toMatchObject({
      ok: true,
      value: { facts: [{ kind: 'evaluation_loss' }, { kind: 'best_check', checkmate: false }] },
    });
  });

  it('reports castling and promotion only when encoded by the legal best root', () => {
    const castle = explainAsaMoveReview(
      reviewFromRoot({
        fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
        playedUci: 'a1a2',
        bestUci: 'e1g1',
      }),
    );
    const promotion = explainAsaMoveReview(
      reviewFromRoot({
        fen: '7k/P7/8/8/8/8/8/K7 w - - 0 1',
        playedUci: 'a7a8r',
        bestUci: 'a7a8q',
      }),
    );

    expect(castle).toMatchObject({
      ok: true,
      value: { facts: [{ kind: 'evaluation_loss' }, { kind: 'best_castle', side: 'king' }] },
    });
    expect(promotion).toMatchObject({
      ok: true,
      value: {
        facts: [
          { kind: 'evaluation_loss' },
          { kind: 'best_check', checkmate: false },
          { kind: 'best_promotion', promotion: 'queen' },
        ],
      },
    });
  });

  it('rejects non-canonical or malformed evidence instead of generating wording', () => {
    const move = reviewFromRoot({ fen: START_FEN, playedUci: 'e2e4', bestUci: 'd2d4' });

    expect(explainAsaMoveReview({ ...move, centipawnLoss: Number.NaN })).toMatchObject({
      ok: false,
    });
    expect(
      explainAsaMoveReview({
        ...move,
        bestRoot: move.bestRoot ? { ...move.bestRoot, fenAfter: move.fenAfter } : null,
      }),
    ).toEqual({ ok: false, message: 'Review explanation evidence is not canonical.' });
    expect(move.fenBefore).toBe(START_FEN);
  });
});
