import type { Color, PieceType } from './chess.js';

/**
 * Standard Unicode chess symbols. Product renderers may replace them with an
 * original ASA piece set without changing the game document or rules engine.
 */
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
