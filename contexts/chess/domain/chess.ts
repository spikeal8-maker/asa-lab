export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export const RANKS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export type File = (typeof FILES)[number];
export type Rank = (typeof RANKS)[number];
export type Square = `${File}${Rank}`;
export type Color = 'white' | 'black';
export type PieceType = 'king' | 'queen' | 'rook' | 'bishop' | 'knight' | 'pawn';
export type PromotionPiece = 'queen' | 'rook' | 'bishop' | 'knight';

export interface Piece {
  readonly color: Color;
  readonly type: PieceType;
}

export interface CastlingRights {
  readonly whiteKingSide: boolean;
  readonly whiteQueenSide: boolean;
  readonly blackKingSide: boolean;
  readonly blackQueenSide: boolean;
}

export interface ChessPosition {
  /** a1 = index 0, h8 = index 63. */
  readonly board: readonly (Piece | null)[];
  readonly turn: Color;
  readonly castling: CastlingRights;
  readonly enPassant: Square | null;
  readonly halfmoveClock: number;
  readonly fullmoveNumber: number;
}

export interface ChessMove {
  readonly from: Square;
  readonly to: Square;
  readonly promotion?: PromotionPiece;
  readonly isCapture: boolean;
  readonly isEnPassant: boolean;
  readonly isCastleKingSide: boolean;
  readonly isCastleQueenSide: boolean;
  readonly isDoublePawnPush: boolean;
}

export type GameState =
  | 'ongoing'
  | 'check'
  | 'checkmate'
  | 'stalemate'
  | 'draw_fifty_move'
  | 'draw_threefold'
  | 'draw_insufficient_material';

export interface ChessStatus {
  readonly state: GameState;
  readonly inCheck: boolean;
  readonly winner: Color | null;
  readonly result: '1-0' | '0-1' | '1/2-1/2' | '*';
  readonly legalMoveCount: number;
}

export type ChessParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const EMPTY_CASTLING: CastlingRights = {
  whiteKingSide: false,
  whiteQueenSide: false,
  blackKingSide: false,
  blackQueenSide: false,
};
const PROMOTIONS: readonly PromotionPiece[] = ['queen', 'rook', 'bishop', 'knight'];
const KNIGHT_STEPS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
] as const;
const KING_STEPS = [
  [1, 1],
  [1, 0],
  [1, -1],
  [0, 1],
  [0, -1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
] as const;
const ROOK_DIRECTIONS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const BISHOP_DIRECTIONS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;
const PIECE_FROM_FEN: Readonly<Record<string, PieceType>> = {
  k: 'king',
  q: 'queen',
  r: 'rook',
  b: 'bishop',
  n: 'knight',
  p: 'pawn',
};
const FEN_FROM_PIECE: Readonly<Record<PieceType, string>> = {
  king: 'k',
  queen: 'q',
  rook: 'r',
  bishop: 'b',
  knight: 'n',
  pawn: 'p',
};
const SAN_PIECE: Readonly<Record<Exclude<PieceType, 'pawn'>, string>> = {
  king: 'K',
  queen: 'Q',
  rook: 'R',
  bishop: 'B',
  knight: 'N',
};

function isIntegerInRange(value: number, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

export function opposite(color: Color): Color {
  return color === 'white' ? 'black' : 'white';
}

export function squareToIndex(square: Square): number {
  const file = FILES.indexOf(square[0] as File);
  const rank = Number(square[1]) - 1;
  if (file < 0 || !isIntegerInRange(rank, 0, 7)) {
    throw new Error(`invalid square: ${square}`);
  }
  return rank * 8 + file;
}

export function indexToSquare(index: number): Square {
  if (!isIntegerInRange(index, 0, 63)) throw new Error(`invalid board index: ${index}`);
  return `${FILES[index % 8]}${Math.floor(index / 8) + 1}` as Square;
}

export function fileOf(square: Square): File {
  return square[0] as File;
}

export function rankOf(square: Square): Rank {
  return Number(square[1]) as Rank;
}

function coordinates(index: number): readonly [file: number, rank: number] {
  return [index % 8, Math.floor(index / 8)];
}

function indexAt(file: number, rank: number): number | null {
  return isIntegerInRange(file, 0, 7) && isIntegerInRange(rank, 0, 7)
    ? rank * 8 + file
    : null;
}

export function pieceAt(position: ChessPosition, square: Square): Piece | null {
  return position.board[squareToIndex(square)] ?? null;
}

export function createStartPosition(): ChessPosition {
  const parsed = parseFen(START_FEN);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.value;
}

function parseBoardField(field: string): ChessParseResult<readonly (Piece | null)[]> {
  const rows = field.split('/');
  if (rows.length !== 8) return { ok: false, message: 'FEN must contain eight ranks.' };
  const board: (Piece | null)[] = Array.from({ length: 64 }, () => null);
  let whiteKings = 0;
  let blackKings = 0;
  for (let fenRow = 0; fenRow < 8; fenRow += 1) {
    const rank = 7 - fenRow;
    let file = 0;
    for (const token of rows[fenRow] ?? '') {
      if (/^[1-8]$/.test(token)) {
        file += Number(token);
        continue;
      }
      const pieceType = PIECE_FROM_FEN[token.toLowerCase()];
      if (!pieceType || file > 7) return { ok: false, message: `Invalid FEN piece token: ${token}.` };
      const color: Color = token === token.toUpperCase() ? 'white' : 'black';
      if (pieceType === 'pawn' && (rank === 0 || rank === 7)) {
        return { ok: false, message: 'Pawns cannot stand on the first or eighth rank.' };
      }
      board[rank * 8 + file] = { color, type: pieceType };
      if (pieceType === 'king') {
        if (color === 'white') whiteKings += 1;
        else blackKings += 1;
      }
      file += 1;
    }
    if (file !== 8) return { ok: false, message: `FEN rank ${8 - fenRow} does not contain eight squares.` };
  }
  if (whiteKings !== 1 || blackKings !== 1) {
    return { ok: false, message: 'A standard position must contain exactly one king of each color.' };
  }
  return { ok: true, value: board };
}

function parseCastling(field: string): ChessParseResult<CastlingRights> {
  if (field === '-') return { ok: true, value: EMPTY_CASTLING };
  if (!/^(?=.{1,4}$)K?Q?k?q?$/.test(field) || new Set(field).size !== field.length) {
    return { ok: false, message: 'Invalid FEN castling rights.' };
  }
  return {
    ok: true,
    value: {
      whiteKingSide: field.includes('K'),
      whiteQueenSide: field.includes('Q'),
      blackKingSide: field.includes('k'),
      blackQueenSide: field.includes('q'),
    },
  };
}

export function parseFen(fen: string): ChessParseResult<ChessPosition> {
  if (typeof fen !== 'string') return { ok: false, message: 'FEN must be a string.' };
  const fields = fen.trim().split(/\s+/);
  if (fields.length !== 6) return { ok: false, message: 'FEN must contain six fields.' };
  const board = parseBoardField(fields[0] ?? '');
  if (!board.ok) return board;
  const turn: Color | null = fields[1] === 'w' ? 'white' : fields[1] === 'b' ? 'black' : null;
  if (!turn) return { ok: false, message: 'FEN active color must be w or b.' };
  const castling = parseCastling(fields[2] ?? '');
  if (!castling.ok) return castling;
  const enPassantField = fields[3] ?? '';
  let enPassant: Square | null = null;
  if (enPassantField !== '-') {
    if (!/^[a-h][36]$/.test(enPassantField)) {
      return { ok: false, message: 'FEN en-passant target must be on rank 3 or 6.' };
    }
    enPassant = enPassantField as Square;
  }
  const halfmoveClock = Number(fields[4]);
  const fullmoveNumber = Number(fields[5]);
  if (!Number.isInteger(halfmoveClock) || halfmoveClock < 0) {
    return { ok: false, message: 'FEN halfmove clock must be a non-negative integer.' };
  }
  if (!Number.isInteger(fullmoveNumber) || fullmoveNumber < 1) {
    return { ok: false, message: 'FEN fullmove number must be a positive integer.' };
  }
  const position: ChessPosition = {
    board: board.value,
    turn,
    castling: castling.value,
    enPassant,
    halfmoveClock,
    fullmoveNumber,
  };
  const whiteKing = findKing(position, 'white');
  const blackKing = findKing(position, 'black');
  if (!whiteKing || !blackKing) return { ok: false, message: 'Both kings are required.' };
  const [wf, wr] = coordinates(squareToIndex(whiteKing));
  const [bf, br] = coordinates(squareToIndex(blackKing));
  if (Math.max(Math.abs(wf - bf), Math.abs(wr - br)) <= 1) {
    return { ok: false, message: 'Kings cannot occupy adjacent squares.' };
  }
  return { ok: true, value: position };
}

export function toFen(position: ChessPosition): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank -= 1) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 8; file += 1) {
      const piece = position.board[rank * 8 + file];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty > 0) {
        row += String(empty);
        empty = 0;
      }
      const letter = FEN_FROM_PIECE[piece.type];
      row += piece.color === 'white' ? letter.toUpperCase() : letter;
    }
    if (empty > 0) row += String(empty);
    rows.push(row);
  }
  const castling = [
    position.castling.whiteKingSide ? 'K' : '',
    position.castling.whiteQueenSide ? 'Q' : '',
    position.castling.blackKingSide ? 'k' : '',
    position.castling.blackQueenSide ? 'q' : '',
  ].join('');
  return `${rows.join('/')} ${position.turn === 'white' ? 'w' : 'b'} ${castling || '-'} ${position.enPassant ?? '-'} ${position.halfmoveClock} ${position.fullmoveNumber}`;
}

function makeMove(
  fromIndex: number,
  toIndex: number,
  options: Partial<Omit<ChessMove, 'from' | 'to'>> = {},
): ChessMove {
  return {
    from: indexToSquare(fromIndex),
    to: indexToSquare(toIndex),
    isCapture: false,
    isEnPassant: false,
    isCastleKingSide: false,
    isCastleQueenSide: false,
    isDoublePawnPush: false,
    ...options,
  };
}

function addPawnMove(
  moves: ChessMove[],
  fromIndex: number,
  toIndex: number,
  options: Partial<Omit<ChessMove, 'from' | 'to'>>,
  promotionRank: number,
): void {
  const [, targetRank] = coordinates(toIndex);
  if (targetRank === promotionRank) {
    for (const promotion of PROMOTIONS) {
      moves.push(makeMove(fromIndex, toIndex, { ...options, promotion }));
    }
  } else {
    moves.push(makeMove(fromIndex, toIndex, options));
  }
}

function addSlidingMoves(
  position: ChessPosition,
  fromIndex: number,
  color: Color,
  directions: readonly (readonly [number, number])[],
  moves: ChessMove[],
): void {
  const [fromFile, fromRank] = coordinates(fromIndex);
  for (const [fileStep, rankStep] of directions) {
    let file = fromFile + fileStep;
    let rank = fromRank + rankStep;
    while (true) {
      const toIndex = indexAt(file, rank);
      if (toIndex === null) break;
      const target = position.board[toIndex];
      if (!target) {
        moves.push(makeMove(fromIndex, toIndex));
      } else {
        if (target.color !== color && target.type !== 'king') {
          moves.push(makeMove(fromIndex, toIndex, { isCapture: true }));
        }
        break;
      }
      file += fileStep;
      rank += rankStep;
    }
  }
}

function pseudoMovesForPiece(position: ChessPosition, fromIndex: number): ChessMove[] {
  const piece = position.board[fromIndex];
  if (!piece || piece.color !== position.turn) return [];
  const moves: ChessMove[] = [];
  const [file, rank] = coordinates(fromIndex);

  if (piece.type === 'pawn') {
    const direction = piece.color === 'white' ? 1 : -1;
    const startRank = piece.color === 'white' ? 1 : 6;
    const promotionRank = piece.color === 'white' ? 7 : 0;
    const one = indexAt(file, rank + direction);
    if (one !== null && !position.board[one]) {
      addPawnMove(moves, fromIndex, one, {}, promotionRank);
      const two = indexAt(file, rank + direction * 2);
      if (rank === startRank && two !== null && !position.board[two]) {
        moves.push(makeMove(fromIndex, two, { isDoublePawnPush: true }));
      }
    }
    for (const fileStep of [-1, 1]) {
      const targetIndex = indexAt(file + fileStep, rank + direction);
      if (targetIndex === null) continue;
      const target = position.board[targetIndex];
      if (target && target.color !== piece.color && target.type !== 'king') {
        addPawnMove(moves, fromIndex, targetIndex, { isCapture: true }, promotionRank);
      } else if (position.enPassant && squareToIndex(position.enPassant) === targetIndex) {
        const capturedIndex = indexAt(file + fileStep, rank);
        const captured = capturedIndex === null ? null : position.board[capturedIndex];
        if (captured?.color === opposite(piece.color) && captured.type === 'pawn') {
          moves.push(
            makeMove(fromIndex, targetIndex, { isCapture: true, isEnPassant: true }),
          );
        }
      }
    }
    return moves;
  }

  if (piece.type === 'knight') {
    for (const [fileStep, rankStep] of KNIGHT_STEPS) {
      const toIndex = indexAt(file + fileStep, rank + rankStep);
      if (toIndex === null) continue;
      const target = position.board[toIndex];
      if (!target) moves.push(makeMove(fromIndex, toIndex));
      else if (target.color !== piece.color && target.type !== 'king') {
        moves.push(makeMove(fromIndex, toIndex, { isCapture: true }));
      }
    }
    return moves;
  }

  if (piece.type === 'bishop') {
    addSlidingMoves(position, fromIndex, piece.color, BISHOP_DIRECTIONS, moves);
    return moves;
  }
  if (piece.type === 'rook') {
    addSlidingMoves(position, fromIndex, piece.color, ROOK_DIRECTIONS, moves);
    return moves;
  }
  if (piece.type === 'queen') {
    addSlidingMoves(
      position,
      fromIndex,
      piece.color,
      [...ROOK_DIRECTIONS, ...BISHOP_DIRECTIONS],
      moves,
    );
    return moves;
  }

  for (const [fileStep, rankStep] of KING_STEPS) {
    const toIndex = indexAt(file + fileStep, rank + rankStep);
    if (toIndex === null) continue;
    const target = position.board[toIndex];
    if (!target) moves.push(makeMove(fromIndex, toIndex));
    else if (target.color !== piece.color && target.type !== 'king') {
      moves.push(makeMove(fromIndex, toIndex, { isCapture: true }));
    }
  }

  const enemy = opposite(piece.color);
  if (piece.color === 'white' && fromIndex === squareToIndex('e1')) {
    if (
      position.castling.whiteKingSide &&
      position.board[squareToIndex('h1')]?.color === 'white' &&
      position.board[squareToIndex('h1')]?.type === 'rook' &&
      !position.board[squareToIndex('f1')] &&
      !position.board[squareToIndex('g1')] &&
      !isSquareAttacked(position, 'e1', enemy) &&
      !isSquareAttacked(position, 'f1', enemy) &&
      !isSquareAttacked(position, 'g1', enemy)
    ) {
      moves.push(makeMove(fromIndex, squareToIndex('g1'), { isCastleKingSide: true }));
    }
    if (
      position.castling.whiteQueenSide &&
      position.board[squareToIndex('a1')]?.color === 'white' &&
      position.board[squareToIndex('a1')]?.type === 'rook' &&
      !position.board[squareToIndex('b1')] &&
      !position.board[squareToIndex('c1')] &&
      !position.board[squareToIndex('d1')] &&
      !isSquareAttacked(position, 'e1', enemy) &&
      !isSquareAttacked(position, 'd1', enemy) &&
      !isSquareAttacked(position, 'c1', enemy)
    ) {
      moves.push(makeMove(fromIndex, squareToIndex('c1'), { isCastleQueenSide: true }));
    }
  }
  if (piece.color === 'black' && fromIndex === squareToIndex('e8')) {
    if (
      position.castling.blackKingSide &&
      position.board[squareToIndex('h8')]?.color === 'black' &&
      position.board[squareToIndex('h8')]?.type === 'rook' &&
      !position.board[squareToIndex('f8')] &&
      !position.board[squareToIndex('g8')] &&
      !isSquareAttacked(position, 'e8', enemy) &&
      !isSquareAttacked(position, 'f8', enemy) &&
      !isSquareAttacked(position, 'g8', enemy)
    ) {
      moves.push(makeMove(fromIndex, squareToIndex('g8'), { isCastleKingSide: true }));
    }
    if (
      position.castling.blackQueenSide &&
      position.board[squareToIndex('a8')]?.color === 'black' &&
      position.board[squareToIndex('a8')]?.type === 'rook' &&
      !position.board[squareToIndex('b8')] &&
      !position.board[squareToIndex('c8')] &&
      !position.board[squareToIndex('d8')] &&
      !isSquareAttacked(position, 'e8', enemy) &&
      !isSquareAttacked(position, 'd8', enemy) &&
      !isSquareAttacked(position, 'c8', enemy)
    ) {
      moves.push(makeMove(fromIndex, squareToIndex('c8'), { isCastleQueenSide: true }));
    }
  }
  return moves;
}

export function findKing(position: ChessPosition, color: Color): Square | null {
  const index = position.board.findIndex((piece) => piece?.color === color && piece.type === 'king');
  return index < 0 ? null : indexToSquare(index);
}

export function isSquareAttacked(
  position: ChessPosition,
  square: Square,
  byColor: Color,
): boolean {
  const targetIndex = squareToIndex(square);
  const [targetFile, targetRank] = coordinates(targetIndex);

  for (let index = 0; index < 64; index += 1) {
    const piece = position.board[index];
    if (!piece || piece.color !== byColor) continue;
    const [file, rank] = coordinates(index);
    const fileDifference = targetFile - file;
    const rankDifference = targetRank - rank;

    if (piece.type === 'pawn') {
      const direction = piece.color === 'white' ? 1 : -1;
      if (rankDifference === direction && Math.abs(fileDifference) === 1) return true;
      continue;
    }
    if (piece.type === 'knight') {
      if (
        (Math.abs(fileDifference) === 1 && Math.abs(rankDifference) === 2) ||
        (Math.abs(fileDifference) === 2 && Math.abs(rankDifference) === 1)
      ) {
        return true;
      }
      continue;
    }
    if (piece.type === 'king') {
      if (Math.max(Math.abs(fileDifference), Math.abs(rankDifference)) === 1) return true;
      continue;
    }

    const diagonal = Math.abs(fileDifference) === Math.abs(rankDifference) && fileDifference !== 0;
    const orthogonal =
      (fileDifference === 0 && rankDifference !== 0) ||
      (rankDifference === 0 && fileDifference !== 0);
    const canSlide =
      piece.type === 'queen' ||
      (piece.type === 'bishop' && diagonal) ||
      (piece.type === 'rook' && orthogonal);
    if (!canSlide || (!diagonal && !orthogonal)) continue;
    const fileStep = Math.sign(fileDifference);
    const rankStep = Math.sign(rankDifference);
    let scanFile = file + fileStep;
    let scanRank = rank + rankStep;
    let blocked = false;
    while (scanFile !== targetFile || scanRank !== targetRank) {
      const scanIndex = indexAt(scanFile, scanRank);
      if (scanIndex === null || position.board[scanIndex]) {
        blocked = true;
        break;
      }
      scanFile += fileStep;
      scanRank += rankStep;
    }
    if (!blocked) return true;
  }
  return false;
}

function updateCastlingForSquare(
  rights: CastlingRights,
  square: Square,
): CastlingRights {
  if (square === 'a1') return { ...rights, whiteQueenSide: false };
  if (square === 'h1') return { ...rights, whiteKingSide: false };
  if (square === 'a8') return { ...rights, blackQueenSide: false };
  if (square === 'h8') return { ...rights, blackKingSide: false };
  return rights;
}

export function applyMoveUnchecked(position: ChessPosition, move: ChessMove): ChessPosition {
  const fromIndex = squareToIndex(move.from);
  const toIndex = squareToIndex(move.to);
  const piece = position.board[fromIndex];
  if (!piece) throw new Error(`No piece on ${move.from}.`);
  const board = [...position.board];
  const targetBeforeMove = board[toIndex];
  board[fromIndex] = null;

  if (move.isEnPassant) {
    const [toFile, toRank] = coordinates(toIndex);
    const capturedIndex = indexAt(toFile, toRank + (piece.color === 'white' ? -1 : 1));
    if (capturedIndex === null) throw new Error('Invalid en-passant capture.');
    board[capturedIndex] = null;
  }

  board[toIndex] = move.promotion ? { color: piece.color, type: move.promotion } : piece;
  if (move.isCastleKingSide || move.isCastleQueenSide) {
    const white = piece.color === 'white';
    const rookFrom = move.isCastleKingSide
      ? white
        ? 'h1'
        : 'h8'
      : white
        ? 'a1'
        : 'a8';
    const rookTo = move.isCastleKingSide
      ? white
        ? 'f1'
        : 'f8'
      : white
        ? 'd1'
        : 'd8';
    const rook = board[squareToIndex(rookFrom)];
    board[squareToIndex(rookFrom)] = null;
    board[squareToIndex(rookTo)] = rook;
  }

  let castling = position.castling;
  if (piece.type === 'king') {
    castling =
      piece.color === 'white'
        ? { ...castling, whiteKingSide: false, whiteQueenSide: false }
        : { ...castling, blackKingSide: false, blackQueenSide: false };
  }
  if (piece.type === 'rook') castling = updateCastlingForSquare(castling, move.from);
  if (targetBeforeMove?.type === 'rook') castling = updateCastlingForSquare(castling, move.to);

  let enPassant: Square | null = null;
  if (move.isDoublePawnPush) {
    const [fromFile, fromRank] = coordinates(fromIndex);
    const [, toRank] = coordinates(toIndex);
    enPassant = indexToSquare((Math.floor((fromRank + toRank) / 2) * 8) + fromFile);
  }

  const isPawnMove = piece.type === 'pawn';
  const isCapture = move.isCapture || targetBeforeMove !== null;
  return {
    board,
    turn: opposite(position.turn),
    castling,
    enPassant,
    halfmoveClock: isPawnMove || isCapture ? 0 : position.halfmoveClock + 1,
    fullmoveNumber: position.fullmoveNumber + (position.turn === 'black' ? 1 : 0),
  };
}

export function generatePseudoLegalMoves(position: ChessPosition): readonly ChessMove[] {
  const moves: ChessMove[] = [];
  for (let index = 0; index < 64; index += 1) {
    const piece = position.board[index];
    if (piece?.color === position.turn) moves.push(...pseudoMovesForPiece(position, index));
  }
  return moves;
}

export function generateLegalMoves(position: ChessPosition): readonly ChessMove[] {
  const movingColor = position.turn;
  return generatePseudoLegalMoves(position).filter((move) => {
    const next = applyMoveUnchecked(position, move);
    const king = findKing(next, movingColor);
    return king !== null && !isSquareAttacked(next, king, opposite(movingColor));
  });
}

export function isInCheck(position: ChessPosition, color: Color = position.turn): boolean {
  const king = findKing(position, color);
  return king !== null && isSquareAttacked(position, king, opposite(color));
}

export function moveToUci(move: ChessMove): string {
  const promotion = move.promotion ? FEN_FROM_PIECE[move.promotion] : '';
  return `${move.from}${move.to}${promotion}`;
}

export function findLegalMoveByUci(position: ChessPosition, uci: string): ChessMove | null {
  const normalized = uci.trim().toLowerCase();
  return generateLegalMoves(position).find((move) => moveToUci(move) === normalized) ?? null;
}

function sanDisambiguation(position: ChessPosition, move: ChessMove, piece: Piece): string {
  const alternatives = generateLegalMoves(position).filter((candidate) => {
    if (candidate.from === move.from || candidate.to !== move.to) return false;
    const other = pieceAt(position, candidate.from);
    return other?.color === piece.color && other.type === piece.type;
  });
  if (alternatives.length === 0) return '';
  const sameFile = alternatives.some((candidate) => fileOf(candidate.from) === fileOf(move.from));
  const sameRank = alternatives.some((candidate) => rankOf(candidate.from) === rankOf(move.from));
  if (!sameFile) return fileOf(move.from);
  if (!sameRank) return String(rankOf(move.from));
  return move.from;
}

export function moveToSan(position: ChessPosition, move: ChessMove): string {
  const piece = pieceAt(position, move.from);
  if (!piece) throw new Error(`Cannot create SAN: ${move.from} is empty.`);
  let san: string;
  if (move.isCastleKingSide) san = 'O-O';
  else if (move.isCastleQueenSide) san = 'O-O-O';
  else {
    const capture = move.isCapture ? 'x' : '';
    const destination = move.to;
    const promotion = move.promotion ? `=${SAN_PIECE[move.promotion]}` : '';
    if (piece.type === 'pawn') {
      san = `${move.isCapture ? fileOf(move.from) : ''}${capture}${destination}${promotion}`;
    } else {
      san = `${SAN_PIECE[piece.type]}${sanDisambiguation(position, move, piece)}${capture}${destination}${promotion}`;
    }
  }
  const next = applyMoveUnchecked(position, move);
  if (isInCheck(next)) {
    san += generateLegalMoves(next).length === 0 ? '#' : '+';
  }
  return san;
}

function normalizedSan(value: string): string {
  return value
    .trim()
    .replace(/^0-0-0/, 'O-O-O')
    .replace(/^0-0/, 'O-O')
    .replace(/[!?]+/g, '')
    .replace(/[+#]+$/g, '')
    .replace(/e\.p\.$/i, '')
    .trim();
}

export function findLegalMoveBySan(position: ChessPosition, san: string): ChessMove | null {
  const normalized = normalizedSan(san);
  const matches = generateLegalMoves(position).filter(
    (move) => normalizedSan(moveToSan(position, move)) === normalized,
  );
  return matches.length === 1 ? matches[0] ?? null : null;
}

export function applyLegalMove(
  position: ChessPosition,
  moveOrNotation: ChessMove | string,
): ChessParseResult<{ readonly position: ChessPosition; readonly move: ChessMove; readonly san: string }> {
  const move =
    typeof moveOrNotation === 'string'
      ? findLegalMoveByUci(position, moveOrNotation) ?? findLegalMoveBySan(position, moveOrNotation)
      : generateLegalMoves(position).find(
          (candidate) => moveToUci(candidate) === moveToUci(moveOrNotation),
        ) ?? null;
  if (!move) return { ok: false, message: 'Illegal or ambiguous chess move.' };
  const san = moveToSan(position, move);
  return { ok: true, value: { position: applyMoveUnchecked(position, move), move, san } };
}

export function positionKey(position: ChessPosition): string {
  return toFen(position).split(' ').slice(0, 4).join(' ');
}

export function hasInsufficientMaterial(position: ChessPosition): boolean {
  const nonKings = position.board
    .map((piece, index) => ({ piece, index }))
    .filter((entry): entry is { piece: Piece; index: number } => entry.piece !== null && entry.piece.type !== 'king');
  if (nonKings.length === 0) return true;
  if (
    nonKings.length === 1 &&
    (nonKings[0]?.piece.type === 'bishop' || nonKings[0]?.piece.type === 'knight')
  ) {
    return true;
  }
  if (nonKings.every((entry) => entry.piece.type === 'bishop')) {
    const squareColors = new Set(
      nonKings.map(({ index }) => {
        const [file, rank] = coordinates(index);
        return (file + rank) % 2;
      }),
    );
    return squareColors.size === 1;
  }
  return false;
}

export function getChessStatus(
  position: ChessPosition,
  repetitionKeys: readonly string[] = [],
): ChessStatus {
  const legalMoves = generateLegalMoves(position);
  const inCheck = isInCheck(position);
  if (legalMoves.length === 0) {
    if (inCheck) {
      const winner = opposite(position.turn);
      return {
        state: 'checkmate',
        inCheck: true,
        winner,
        result: winner === 'white' ? '1-0' : '0-1',
        legalMoveCount: 0,
      };
    }
    return {
      state: 'stalemate',
      inCheck: false,
      winner: null,
      result: '1/2-1/2',
      legalMoveCount: 0,
    };
  }
  if (position.halfmoveClock >= 100) {
    return {
      state: 'draw_fifty_move',
      inCheck,
      winner: null,
      result: '1/2-1/2',
      legalMoveCount: legalMoves.length,
    };
  }
  const currentKey = positionKey(position);
  if (repetitionKeys.filter((key) => key === currentKey).length >= 3) {
    return {
      state: 'draw_threefold',
      inCheck,
      winner: null,
      result: '1/2-1/2',
      legalMoveCount: legalMoves.length,
    };
  }
  if (hasInsufficientMaterial(position)) {
    return {
      state: 'draw_insufficient_material',
      inCheck,
      winner: null,
      result: '1/2-1/2',
      legalMoveCount: legalMoves.length,
    };
  }
  return {
    state: inCheck ? 'check' : 'ongoing',
    inCheck,
    winner: null,
    result: '*',
    legalMoveCount: legalMoves.length,
  };
}

export function perft(position: ChessPosition, depth: number): number {
  if (!Number.isInteger(depth) || depth < 0) throw new Error('Perft depth must be a non-negative integer.');
  if (depth === 0) return 1;
  let nodes = 0;
  for (const move of generateLegalMoves(position)) {
    nodes += perft(applyMoveUnchecked(position, move), depth - 1);
  }
  return nodes;
}
