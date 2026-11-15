import type { ChessNetworkMatch } from './chess-network.js';

/** Same casual invitation/clock envelope; the position remains Russian-64 owned. */
export interface CheckersNetworkPosition {
  schemaVersion: 1;
  ruleset: 'russian-64';
  mode: 'game' | 'position' | 'lesson';
  sideToMove: 'light' | 'dark';
  pieces: readonly { id: string; side: 'light' | 'dark'; kind: 'man' | 'king'; square: string }[];
  moveHistory: readonly {
    ply: number;
    side: 'light' | 'dark';
    pieceId: string;
    path: readonly string[];
    capturedIds: readonly string[];
    promoted: boolean;
  }[];
  result: '*' | '1-0' | '0-1' | '1/2-1/2';
}
export interface CheckersNetworkMatch extends Omit<ChessNetworkMatch, 'currentFen' | 'moves'> {
  position: CheckersNetworkPosition;
  moves: { path: readonly string[]; notation: string }[];
}
