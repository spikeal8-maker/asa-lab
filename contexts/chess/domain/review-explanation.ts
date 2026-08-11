import {
  applyMoveUnchecked,
  findLegalMoveByUci,
  getChessStatus,
  parseFen,
  pieceAt,
  toFen,
  type ChessMove,
  type ChessPosition,
  type PieceType,
  type PromotionPiece,
} from './chess.js';
import type { AsaMoveReview } from './review.js';

export type AsaReviewExplanationFact =
  | {
      readonly kind: 'evaluation_loss';
      readonly playedUci: string;
      readonly bestUci: string;
      readonly centipawnLoss: number;
      readonly text: string;
    }
  | {
      readonly kind: 'best_capture';
      readonly bestUci: string;
      readonly capturedPiece: PieceType;
      readonly text: string;
    }
  | {
      readonly kind: 'best_check';
      readonly bestUci: string;
      readonly checkmate: boolean;
      readonly text: string;
    }
  | {
      readonly kind: 'best_castle';
      readonly bestUci: string;
      readonly side: 'king' | 'queen';
      readonly text: string;
    }
  | {
      readonly kind: 'best_promotion';
      readonly bestUci: string;
      readonly promotion: PromotionPiece;
      readonly text: string;
    };

export interface AsaReviewExplanation {
  readonly algorithm: 'asa-review-explanation-v1';
  readonly reviewAlgorithm: 'asa-review-v1';
  readonly evidenceLevel: 'verified-root';
  readonly ply: number;
  readonly fenBefore: string;
  readonly playedFenAfter: string;
  readonly bestFenAfter: string;
  readonly facts: readonly AsaReviewExplanationFact[];
  readonly summary: string;
}

export type AsaReviewExplanationResult =
  | { readonly ok: true; readonly value: AsaReviewExplanation }
  | { readonly ok: false; readonly message: string };

const PIECE_NAME: Readonly<Record<PieceType, string>> = {
  pawn: 'пешку',
  knight: 'коня',
  bishop: 'слона',
  rook: 'ладью',
  queen: 'ферзя',
  king: 'короля',
};

const PROMOTION_NAME: Readonly<Record<PromotionPiece, string>> = {
  queen: 'ферзя',
  rook: 'ладью',
  bishop: 'слона',
  knight: 'коня',
};

function capturedPieceType(move: ChessMove, position: ChessPosition): PieceType | null {
  if (move.isEnPassant) return 'pawn';
  return pieceAt(position, move.to)?.type ?? null;
}

function validateFiniteLoss(move: AsaMoveReview): boolean {
  return (
    Number.isFinite(move.centipawnLoss) &&
    Number.isInteger(move.centipawnLoss) &&
    move.centipawnLoss >= 0
  );
}

/**
 * Builds wording only from a canonical reviewed root and immediately verifiable
 * move properties. Strategic motifs are intentionally excluded until a separate
 * detector can attach equally strict evidence.
 */
export function explainAsaMoveReview(move: AsaMoveReview): AsaReviewExplanationResult {
  if (!validateFiniteLoss(move)) {
    return { ok: false, message: 'Review explanation requires a finite integer cp loss.' };
  }
  if (!move.bestUci || !move.bestRoot) {
    return { ok: false, message: 'Review explanation requires a verified best root.' };
  }
  if (move.bestRoot.fenBefore !== move.fenBefore || move.bestRoot.moveUci !== move.bestUci) {
    return { ok: false, message: 'Review explanation root metadata does not match the move.' };
  }

  const root = parseFen(move.fenBefore);
  if (!root.ok) return { ok: false, message: `Review explanation root: ${root.message}` };
  const played = findLegalMoveByUci(root.value, move.playedUci);
  const best = findLegalMoveByUci(root.value, move.bestUci);
  if (!played || !best) {
    return { ok: false, message: 'Played and best moves must both be legal at the review root.' };
  }

  const playedFenAfter = toFen(applyMoveUnchecked(root.value, played));
  const bestPosition = applyMoveUnchecked(root.value, best);
  const bestFenAfter = toFen(bestPosition);
  if (playedFenAfter !== move.fenAfter || bestFenAfter !== move.bestRoot.fenAfter) {
    return { ok: false, message: 'Review explanation evidence is not canonical.' };
  }

  const facts: AsaReviewExplanationFact[] = [
    {
      kind: 'evaluation_loss',
      playedUci: move.playedUci,
      bestUci: move.bestUci,
      centipawnLoss: move.centipawnLoss,
      text: `Сыграно ${move.playedUci} вместо ${move.bestUci}; потеря по ASA Review v1 — ${move.centipawnLoss} cp.`,
    },
  ];

  const captured = capturedPieceType(best, root.value);
  if (captured) {
    facts.push({
      kind: 'best_capture',
      bestUci: move.bestUci,
      capturedPiece: captured,
      text: `Проверенный лучший ход ${move.bestUci} немедленно забирал ${PIECE_NAME[captured]}.`,
    });
  }

  const bestStatus = getChessStatus(bestPosition);
  if (bestStatus.inCheck) {
    facts.push({
      kind: 'best_check',
      bestUci: move.bestUci,
      checkmate: bestStatus.state === 'checkmate',
      text:
        bestStatus.state === 'checkmate'
          ? `Проверенный лучший ход ${move.bestUci} ставил мат.`
          : `Проверенный лучший ход ${move.bestUci} объявлял шах.`,
    });
  }

  if (best.isCastleKingSide || best.isCastleQueenSide) {
    const side = best.isCastleKingSide ? 'king' : 'queen';
    facts.push({
      kind: 'best_castle',
      bestUci: move.bestUci,
      side,
      text: `Проверенный лучший ход ${move.bestUci} был рокировкой ${
        side === 'king' ? 'в короткую сторону' : 'в длинную сторону'
      }.`,
    });
  }

  if (best.promotion) {
    facts.push({
      kind: 'best_promotion',
      bestUci: move.bestUci,
      promotion: best.promotion,
      text: `Проверенный лучший ход ${move.bestUci} превращал пешку в ${PROMOTION_NAME[best.promotion]}.`,
    });
  }

  return {
    ok: true,
    value: {
      algorithm: 'asa-review-explanation-v1',
      reviewAlgorithm: 'asa-review-v1',
      evidenceLevel: 'verified-root',
      ply: move.ply,
      fenBefore: move.fenBefore,
      playedFenAfter,
      bestFenAfter,
      facts,
      summary: facts.map((fact) => fact.text).join(' '),
    },
  };
}
