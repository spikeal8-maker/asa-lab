import {
  applyMoveUnchecked,
  findLegalMoveByUci,
  parseFen,
  type ChessPosition,
  type Color,
} from './chess.js';
import { chooseChessBotMove, evaluateChessPosition } from './bot.js';
import type { ChessDocument } from './document.js';

export type AsaMoveClassification =
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder';

export interface AsaMoveReview {
  readonly ply: number;
  readonly color: Color;
  readonly playedUci: string;
  readonly playedSan: string;
  readonly bestUci: string | null;
  readonly evaluationBeforeCp: number;
  readonly evaluationAfterCp: number;
  readonly bestEvaluationAfterCp: number;
  readonly centipawnLoss: number;
  readonly classification: AsaMoveClassification;
  readonly asaQuality: number;
}

export interface AsaGameReview {
  readonly algorithm: 'asa-review-v1';
  readonly depth: 1 | 2 | 3;
  readonly moves: readonly AsaMoveReview[];
  readonly whiteQuality: number | null;
  readonly blackQuality: number | null;
  readonly overallQuality: number | null;
  readonly counts: Readonly<Record<AsaMoveClassification, number>>;
  readonly note: string;
}

function moverLoss(
  color: Color,
  bestEvaluationAfterCp: number,
  playedEvaluationAfterCp: number,
): number {
  const raw =
    color === 'white'
      ? bestEvaluationAfterCp - playedEvaluationAfterCp
      : playedEvaluationAfterCp - bestEvaluationAfterCp;
  return Math.max(0, Math.round(raw));
}

function classification(
  playedUci: string,
  bestUci: string | null,
  centipawnLoss: number,
): AsaMoveClassification {
  if (bestUci === playedUci) return 'best';
  if (centipawnLoss <= 20) return 'excellent';
  if (centipawnLoss <= 60) return 'good';
  if (centipawnLoss <= 120) return 'inaccuracy';
  if (centipawnLoss <= 250) return 'mistake';
  return 'blunder';
}

/** Original ASA quality score, intentionally not Chess.com Accuracy/CAPS. */
export function asaMoveQuality(centipawnLoss: number): number {
  if (!Number.isFinite(centipawnLoss) || centipawnLoss < 0) {
    throw new Error('centipawnLoss must be a non-negative finite number');
  }
  return Math.round((100 / (1 + centipawnLoss / 90)) * 10) / 10;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function countClassifications(
  moves: readonly AsaMoveReview[],
): Record<AsaMoveClassification, number> {
  const counts: Record<AsaMoveClassification, number> = {
    best: 0,
    excellent: 0,
    good: 0,
    inaccuracy: 0,
    mistake: 0,
    blunder: 0,
  };
  for (const move of moves) counts[move.classification] += 1;
  return counts;
}

export function reviewChessDocument(
  document: ChessDocument,
  depth: 1 | 2 | 3 = 1,
): AsaGameReview {
  const initial = parseFen(document.initialFen);
  if (!initial.ok) throw new Error(initial.message);
  let position: ChessPosition = initial.value;
  const moves: AsaMoveReview[] = [];

  for (const record of document.moves) {
    const color = position.turn;
    const played = findLegalMoveByUci(position, record.uci);
    if (!played) throw new Error(`document contains an illegal move at ply ${record.ply}`);
    const evaluationBeforeCp = evaluateChessPosition(position);
    const best = chooseChessBotMove(position, depth);
    const playedPosition = applyMoveUnchecked(position, played);
    const evaluationAfterCp = evaluateChessPosition(playedPosition);
    const bestEvaluationAfterCp = best
      ? evaluateChessPosition(applyMoveUnchecked(position, best.move))
      : evaluationAfterCp;
    const centipawnLoss = moverLoss(color, bestEvaluationAfterCp, evaluationAfterCp);
    moves.push({
      ply: record.ply,
      color,
      playedUci: record.uci,
      playedSan: record.san,
      bestUci: best?.uci ?? null,
      evaluationBeforeCp,
      evaluationAfterCp,
      bestEvaluationAfterCp,
      centipawnLoss,
      classification: classification(record.uci, best?.uci ?? null, centipawnLoss),
      asaQuality: asaMoveQuality(centipawnLoss),
    });
    position = playedPosition;
  }

  const white = moves.filter((move) => move.color === 'white').map((move) => move.asaQuality);
  const black = moves.filter((move) => move.color === 'black').map((move) => move.asaQuality);
  return {
    algorithm: 'asa-review-v1',
    depth,
    moves,
    whiteQuality: average(white),
    blackQuality: average(black),
    overallQuality: average(moves.map((move) => move.asaQuality)),
    counts: countClassifications(moves),
    note:
      'ASA Quality is an original transparent centipawn-loss score. It is not Chess.com Accuracy/CAPS and must not be presented as formula parity.',
  };
}
