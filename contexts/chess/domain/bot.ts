import {
  applyMoveUnchecked,
  generateLegalMoves,
  getChessStatus,
  moveToUci,
  pieceAt,
  squareToIndex,
  type ChessMove,
  type ChessPosition,
  type Color,
  type PieceType,
} from './chess.js';
import type { BotLevel } from './document.js';

export interface ChessBotChoice {
  readonly move: ChessMove;
  readonly uci: string;
  /** Positive means White is better, negative means Black is better. */
  readonly scoreCp: number;
  readonly depth: number;
  readonly nodes: number;
}

const PIECE_VALUE: Readonly<Record<PieceType, number>> = {
  pawn: 100,
  knight: 320,
  bishop: 330,
  rook: 500,
  queen: 900,
  king: 0,
};
const MATE_SCORE = 100_000;
const PAWN_ADVANCE_WEIGHT = 4;
const CENTER_SQUARES = new Set(['d4', 'e4', 'd5', 'e5']);

function materialScore(position: ChessPosition): number {
  let score = 0;
  for (let index = 0; index < position.board.length; index += 1) {
    const piece = position.board[index];
    if (!piece) continue;
    const sign = piece.color === 'white' ? 1 : -1;
    score += sign * PIECE_VALUE[piece.type];
    if (piece.type === 'pawn') {
      const rank = Math.floor(index / 8);
      const progress = piece.color === 'white' ? rank : 7 - rank;
      score += sign * progress * PAWN_ADVANCE_WEIGHT;
    }
  }
  return score;
}

function positionalScore(position: ChessPosition): number {
  let score = materialScore(position);
  for (const square of CENTER_SQUARES) {
    const piece = pieceAt(position, square as 'd4' | 'e4' | 'd5' | 'e5');
    if (piece) score += piece.color === 'white' ? 18 : -18;
  }
  const currentMobility = generateLegalMoves(position).length;
  const flipped: ChessPosition = {
    ...position,
    turn: position.turn === 'white' ? 'black' : 'white',
  };
  const oppositeMobility = generateLegalMoves(flipped).length;
  const mobilityForWhite =
    position.turn === 'white'
      ? currentMobility - oppositeMobility
      : oppositeMobility - currentMobility;
  score += mobilityForWhite * 2;
  return score;
}

function terminalScore(position: ChessPosition, plyFromRoot: number): number | null {
  const status = getChessStatus(position);
  if (status.state === 'checkmate') {
    return status.winner === 'white' ? MATE_SCORE - plyFromRoot : -MATE_SCORE + plyFromRoot;
  }
  if (
    status.state === 'stalemate' ||
    status.state === 'draw_fifty_move' ||
    status.state === 'draw_insufficient_material' ||
    status.state === 'draw_threefold'
  ) {
    return 0;
  }
  return null;
}

function moveOrderScore(position: ChessPosition, move: ChessMove): number {
  let score = 0;
  if (move.promotion) score += PIECE_VALUE[move.promotion] + 1000;
  if (move.isCapture) {
    const victim = move.isEnPassant
      ? { type: 'pawn' as const }
      : position.board[squareToIndex(move.to)];
    const attacker = position.board[squareToIndex(move.from)];
    score +=
      500 +
      (victim ? PIECE_VALUE[victim.type] : 0) -
      (attacker ? PIECE_VALUE[attacker.type] / 10 : 0);
  }
  if (move.isCastleKingSide || move.isCastleQueenSide) score += 80;
  if (CENTER_SQUARES.has(move.to)) score += 20;
  return score;
}

function orderedMoves(position: ChessPosition): ChessMove[] {
  return [...generateLegalMoves(position)].sort((left, right) => {
    const scoreDifference = moveOrderScore(position, right) - moveOrderScore(position, left);
    return scoreDifference || moveToUci(left).localeCompare(moveToUci(right));
  });
}

interface SearchCounter {
  nodes: number;
}

function alphaBeta(
  position: ChessPosition,
  depth: number,
  alphaStart: number,
  betaStart: number,
  plyFromRoot: number,
  counter: SearchCounter,
): number {
  counter.nodes += 1;
  const terminal = terminalScore(position, plyFromRoot);
  if (terminal !== null) return terminal;
  if (depth === 0) return positionalScore(position);

  let alpha = alphaStart;
  let beta = betaStart;
  const maximizing = position.turn === 'white';
  if (maximizing) {
    let best = -Infinity;
    for (const move of orderedMoves(position)) {
      best = Math.max(
        best,
        alphaBeta(
          applyMoveUnchecked(position, move),
          depth - 1,
          alpha,
          beta,
          plyFromRoot + 1,
          counter,
        ),
      );
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }

  let best = Infinity;
  for (const move of orderedMoves(position)) {
    best = Math.min(
      best,
      alphaBeta(
        applyMoveUnchecked(position, move),
        depth - 1,
        alpha,
        beta,
        plyFromRoot + 1,
        counter,
      ),
    );
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

export function chooseChessBotMove(
  position: ChessPosition,
  level: BotLevel = 2,
): ChessBotChoice | null {
  const moves = orderedMoves(position);
  if (moves.length === 0) return null;
  const depth = level;
  const maximizing = position.turn === 'white';
  const counter: SearchCounter = { nodes: 0 };
  let bestMove = moves[0]!;
  let bestScore = maximizing ? -Infinity : Infinity;

  for (const move of moves) {
    const score = alphaBeta(
      applyMoveUnchecked(position, move),
      Math.max(0, depth - 1),
      -Infinity,
      Infinity,
      1,
      counter,
    );
    const better = maximizing ? score > bestScore : score < bestScore;
    const equalButEarlier = score === bestScore && moveToUci(move) < moveToUci(bestMove);
    if (better || equalButEarlier) {
      bestMove = move;
      bestScore = score;
    }
  }
  return {
    move: bestMove,
    uci: moveToUci(bestMove),
    scoreCp: Math.round(bestScore),
    depth,
    nodes: counter.nodes,
  };
}

export function evaluateChessPosition(position: ChessPosition): number {
  return terminalScore(position, 0) ?? Math.round(positionalScore(position));
}

export function botColorCanMove(position: ChessPosition, botColor: Color): boolean {
  return position.turn === botColor && generateLegalMoves(position).length > 0;
}
