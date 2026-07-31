import { describe, expect, it } from 'vitest';
import {
  START_FEN,
  applyLegalMove,
  createStartPosition,
  findLegalMoveBySan,
  findLegalMoveByUci,
  generateLegalMoves,
  getChessStatus,
  hasInsufficientMaterial,
  moveToSan,
  moveToUci,
  parseFen,
  perft,
  pieceAt,
  positionKey,
  toFen,
} from '../domain/chess';

function position(fen: string) {
  const parsed = parseFen(fen);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

describe('standard chess rules', () => {
  it('round-trips the standard initial position', () => {
    expect(toFen(createStartPosition())).toBe(START_FEN);
  });

  it('matches reference perft counts from the initial position', () => {
    const start = createStartPosition();
    expect(perft(start, 0)).toBe(1);
    expect(perft(start, 1)).toBe(20);
    expect(perft(start, 2)).toBe(400);
    expect(perft(start, 3)).toBe(8902);
  });

  it('generates only legal moves when the king is pinned or in check', () => {
    const pinned = position('4r1k1/8/8/8/8/8/4R3/4K3 w - - 0 1');
    const moves = generateLegalMoves(pinned).map(moveToUci);
    expect(moves).not.toContain('e2d2');
    expect(moves).not.toContain('e2f2');
    expect(moves).toContain('e2e8');
  });

  it('allows legal castling on both sides', () => {
    const castling = position('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const moves = generateLegalMoves(castling).map(moveToUci);
    expect(moves).toContain('e1g1');
    expect(moves).toContain('e1c1');
    expect(moveToSan(castling, findLegalMoveByUci(castling, 'e1g1')!)).toBe('O-O');
    expect(moveToSan(castling, findLegalMoveByUci(castling, 'e1c1')!)).toBe('O-O-O');
  });

  it('denies castling through an attacked transit square', () => {
    const attacked = position('r3kr1r/8/8/8/8/8/8/R3K2R w KQ - 0 1');
    const moves = generateLegalMoves(attacked).map(moveToUci);
    expect(moves).not.toContain('e1g1');
    expect(moves).toContain('e1c1');
  });

  it('performs en passant only on the immediate target square', () => {
    const enPassant = position('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2');
    const move = findLegalMoveByUci(enPassant, 'e5d6');
    expect(move).toMatchObject({ isEnPassant: true, isCapture: true });
    const applied = applyLegalMove(enPassant, 'e5d6');
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(pieceAt(applied.value.position, 'd6')).toMatchObject({ color: 'white', type: 'pawn' });
    expect(pieceAt(applied.value.position, 'd5')).toBeNull();
    expect(applied.value.position.enPassant).toBeNull();
  });

  it('creates all four promotion choices and SAN', () => {
    const promotion = position('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    const moves = generateLegalMoves(promotion)
      .filter((move) => move.from === 'a7' && move.to === 'a8')
      .map(moveToUci)
      .sort();
    expect(moves).toEqual(['a7a8b', 'a7a8n', 'a7a8q', 'a7a8r']);
    const queen = findLegalMoveByUci(promotion, 'a7a8q')!;
    expect(moveToSan(promotion, queen)).toBe('a8=Q+');
  });

  it('recognizes checkmate and stalemate', () => {
    const mate = position('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    expect(getChessStatus(mate)).toEqual({
      state: 'checkmate',
      inCheck: true,
      winner: 'black',
      result: '0-1',
      legalMoveCount: 0,
    });

    const stalemate = position('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(getChessStatus(stalemate)).toEqual({
      state: 'stalemate',
      inCheck: false,
      winner: null,
      result: '1/2-1/2',
      legalMoveCount: 0,
    });
  });

  it('detects fifty-move, repetition and insufficient-material draws', () => {
    const fifty = position('8/8/8/8/8/5k2/7R/6K1 w - - 100 80');
    expect(getChessStatus(fifty).state).toBe('draw_fifty_move');

    const kings = position('8/8/8/8/8/5k2/8/6K1 w - - 0 1');
    expect(hasInsufficientMaterial(kings)).toBe(true);
    expect(getChessStatus(kings).state).toBe('draw_insufficient_material');

    const rook = position('8/8/8/8/8/5k2/7R/6K1 w - - 0 1');
    const key = positionKey(rook);
    expect(getChessStatus(rook, [key, key, key]).state).toBe('draw_threefold');
  });

  it('produces and parses SAN including disambiguation and check', () => {
    const ambiguous = position('4k3/8/8/8/8/8/3N3N/4K3 w - - 0 1');
    const move = findLegalMoveByUci(ambiguous, 'd2f3')!;
    expect(moveToSan(ambiguous, move)).toBe('Ndf3');
    expect(findLegalMoveBySan(ambiguous, 'Ndf3')).toEqual(move);

    const check = position('4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1');
    const queen = findLegalMoveByUci(check, 'e2e7')!;
    expect(moveToSan(check, queen)).toBe('Qe7+');
    expect(findLegalMoveBySan(check, 'Qe7+')).toEqual(queen);
  });

  it('rejects malformed FEN and illegal notation', () => {
    expect(parseFen('8/8/8/8/8/8/8/8 w - - 0 1')).toEqual({
      ok: false,
      message: 'A standard position must contain exactly one king of each color.',
    });
    expect(applyLegalMove(createStartPosition(), 'e2e5')).toEqual({
      ok: false,
      message: 'Illegal or ambiguous chess move.',
    });
  });
});
