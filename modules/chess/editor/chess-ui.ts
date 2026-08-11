import type { Color, Piece, PieceType, Square } from '../index.js';

export const PIECE_SYMBOL: Readonly<Record<Color, Readonly<Record<PieceType, string>>>> = {
  white: {
    king: '♔',
    queen: '♕',
    rook: '♖',
    bishop: '♗',
    knight: '♘',
    pawn: '♙',
  },
  black: {
    king: '♚',
    queen: '♛',
    rook: '♜',
    bishop: '♝',
    knight: '♞',
    pawn: '♟',
  },
};

const COLOR_LABEL: Readonly<Record<Color, string>> = {
  white: 'белые',
  black: 'чёрные',
};

const PIECE_LABEL: Readonly<Record<PieceType, string>> = {
  king: 'король',
  queen: 'ферзь',
  rook: 'ладья',
  bishop: 'слон',
  knight: 'конь',
  pawn: 'пешка',
};

export function squareAccessibleLabel(square: Square, piece: Piece | null): string {
  if (!piece) return `${square}, пустое поле`;
  return `${square}, ${COLOR_LABEL[piece.color]} ${PIECE_LABEL[piece.type]}`;
}

export function formatChessClock(milliseconds: number): string {
  const safe = Math.max(0, Math.floor(milliseconds));
  const totalSeconds = Math.ceil(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function resultLabel(result: string, termination: string): string {
  if (result === '*') return 'Партия продолжается';
  const resultText =
    result === '1-0' ? 'Белые победили' : result === '0-1' ? 'Чёрные победили' : 'Ничья';
  const reason: Readonly<Record<string, string>> = {
    checkmate: 'мат',
    stalemate: 'пат',
    fifty_move: 'правило 50 ходов',
    threefold: 'троекратное повторение',
    insufficient_material: 'недостаточно материала',
    resignation: 'сдача',
    timeout: 'время истекло',
    draw_agreement: 'соглашение на ничью',
  };
  return `${resultText}${reason[termination] ? ` · ${reason[termination]}` : ''}`;
}

export function evaluationLabel(scoreCp: number): string {
  if (Math.abs(scoreCp) >= 90000) return scoreCp > 0 ? 'Мат за белых' : 'Мат за чёрных';
  const pawns = scoreCp / 100;
  return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(1)}`;
}
