export const CHECKERS_FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export const CHECKERS_RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

type CheckersFile = (typeof CHECKERS_FILES)[number];
type CheckersRank = (typeof CHECKERS_RANKS)[number];

export type CheckersSquare = `${CheckersFile}${CheckersRank}`;
export type CheckersSide = 'light' | 'dark';
export type CheckersPieceKind = 'man' | 'king';
export type CheckersRuleset = 'russian-64';
export type CheckersGameMode = 'game' | 'position' | 'lesson';
export type CheckersResult = '*' | '1-0' | '0-1' | '1/2-1/2';

export interface CheckersPiece {
  readonly id: string;
  readonly side: CheckersSide;
  readonly kind: CheckersPieceKind;
  readonly square: CheckersSquare;
}

export interface CheckersMoveRecord {
  readonly ply: number;
  readonly side: CheckersSide;
  readonly pieceId: string;
  readonly path: readonly CheckersSquare[];
  readonly capturedIds: readonly string[];
  readonly promoted: boolean;
}

export interface CheckersDocument {
  readonly schemaVersion: 1;
  readonly ruleset: CheckersRuleset;
  readonly mode: CheckersGameMode;
  readonly sideToMove: CheckersSide;
  readonly pieces: readonly CheckersPiece[];
  readonly moveHistory: readonly CheckersMoveRecord[];
  readonly result: CheckersResult;
}

export type CheckersDocumentResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

const DOCUMENT_KEYS = new Set([
  'schemaVersion',
  'ruleset',
  'mode',
  'sideToMove',
  'pieces',
  'moveHistory',
  'result',
]);
const PIECE_KEYS = new Set(['id', 'side', 'kind', 'square']);
const MOVE_KEYS = new Set(['ply', 'side', 'pieceId', 'path', 'capturedIds', 'promoted']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

function isSide(value: unknown): value is CheckersSide {
  return value === 'light' || value === 'dark';
}

function isPieceKind(value: unknown): value is CheckersPieceKind {
  return value === 'man' || value === 'king';
}

function isMode(value: unknown): value is CheckersGameMode {
  return value === 'game' || value === 'position' || value === 'lesson';
}

function isResult(value: unknown): value is CheckersResult {
  return value === '*' || value === '1-0' || value === '0-1' || value === '1/2-1/2';
}

export function isCheckersSquare(value: unknown): value is CheckersSquare {
  return typeof value === 'string' && /^[a-h][1-8]$/.test(value);
}

export function isDarkSquare(square: CheckersSquare): boolean {
  const file = CHECKERS_FILES.indexOf(square[0] as CheckersFile);
  const rank = Number(square[1]);
  return (file + rank) % 2 === 1;
}

function initialPieces(side: CheckersSide): readonly CheckersPiece[] {
  const ranks = side === 'light' ? CHECKERS_RANKS.slice(0, 3) : CHECKERS_RANKS.slice(5);
  const pieces: CheckersPiece[] = [];
  let ordinal = 1;

  for (const rank of ranks) {
    for (const file of CHECKERS_FILES) {
      const square = `${file}${rank}` as CheckersSquare;
      if (!isDarkSquare(square)) continue;
      pieces.push({
        id: `${side}-${String(ordinal).padStart(2, '0')}`,
        side,
        kind: 'man',
        square,
      });
      ordinal += 1;
    }
  }

  return pieces;
}

export function createInitialCheckersDocument(mode: CheckersGameMode = 'game'): CheckersDocument {
  return {
    schemaVersion: 1,
    ruleset: 'russian-64',
    mode,
    sideToMove: 'light',
    pieces: [...initialPieces('light'), ...initialPieces('dark')],
    moveHistory: [],
    result: '*',
  };
}

function validatePiece(value: unknown, index: number): CheckersDocumentResult<CheckersPiece> {
  if (!isRecord(value) || !hasExactKeys(value, PIECE_KEYS)) {
    return { ok: false, message: `pieces[${index}] has an invalid shape` };
  }
  if (typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.id)) {
    return { ok: false, message: `pieces[${index}].id is invalid` };
  }
  if (!isSide(value.side)) {
    return { ok: false, message: `pieces[${index}].side is invalid` };
  }
  if (!isPieceKind(value.kind)) {
    return { ok: false, message: `pieces[${index}].kind is invalid` };
  }
  if (!isCheckersSquare(value.square) || !isDarkSquare(value.square)) {
    return { ok: false, message: `pieces[${index}].square must be a playable dark square` };
  }
  return {
    ok: true,
    value: { id: value.id, side: value.side, kind: value.kind, square: value.square },
  };
}

function validateMove(value: unknown, index: number): CheckersDocumentResult<CheckersMoveRecord> {
  if (!isRecord(value) || !hasExactKeys(value, MOVE_KEYS)) {
    return { ok: false, message: `moveHistory[${index}] has an invalid shape` };
  }
  if (typeof value.ply !== 'number' || !Number.isInteger(value.ply) || value.ply !== index + 1) {
    return { ok: false, message: `moveHistory[${index}].ply must equal ${index + 1}` };
  }
  if (!isSide(value.side)) {
    return { ok: false, message: `moveHistory[${index}].side is invalid` };
  }
  if (typeof value.pieceId !== 'string' || value.pieceId.length === 0) {
    return { ok: false, message: `moveHistory[${index}].pieceId is invalid` };
  }
  if (
    !Array.isArray(value.path) ||
    value.path.length < 2 ||
    value.path.some((square) => !isCheckersSquare(square) || !isDarkSquare(square))
  ) {
    return { ok: false, message: `moveHistory[${index}].path is invalid` };
  }
  if (
    !Array.isArray(value.capturedIds) ||
    value.capturedIds.some((id) => typeof id !== 'string' || id.length === 0) ||
    new Set(value.capturedIds).size !== value.capturedIds.length
  ) {
    return { ok: false, message: `moveHistory[${index}].capturedIds is invalid` };
  }
  if (typeof value.promoted !== 'boolean') {
    return { ok: false, message: `moveHistory[${index}].promoted is invalid` };
  }
  return {
    ok: true,
    value: {
      ply: value.ply,
      side: value.side,
      pieceId: value.pieceId,
      path: value.path as CheckersSquare[],
      capturedIds: value.capturedIds as string[],
      promoted: value.promoted,
    },
  };
}

export function validateCheckersDocument(value: unknown): CheckersDocumentResult<CheckersDocument> {
  if (!isRecord(value) || !hasExactKeys(value, DOCUMENT_KEYS)) {
    return { ok: false, message: 'checkers document has an invalid shape' };
  }
  if (value.schemaVersion !== 1) {
    return { ok: false, message: 'schemaVersion must be 1' };
  }
  if (value.ruleset !== 'russian-64') {
    return { ok: false, message: 'ruleset must be russian-64' };
  }
  if (!isMode(value.mode)) {
    return { ok: false, message: 'mode is invalid' };
  }
  if (!isSide(value.sideToMove)) {
    return { ok: false, message: 'sideToMove is invalid' };
  }
  if (!isResult(value.result)) {
    return { ok: false, message: 'result is invalid' };
  }
  if (!Array.isArray(value.pieces) || value.pieces.length > 24) {
    return { ok: false, message: 'pieces must contain at most 24 entries' };
  }

  const pieces: CheckersPiece[] = [];
  for (const [index, candidate] of value.pieces.entries()) {
    const parsed = validatePiece(candidate, index);
    if (!parsed.ok) return parsed;
    pieces.push(parsed.value);
  }
  if (new Set(pieces.map((piece) => piece.id)).size !== pieces.length) {
    return { ok: false, message: 'piece ids must be unique' };
  }
  if (new Set(pieces.map((piece) => piece.square)).size !== pieces.length) {
    return { ok: false, message: 'piece squares must be unique' };
  }

  if (!Array.isArray(value.moveHistory)) {
    return { ok: false, message: 'moveHistory must be an array' };
  }
  const moveHistory: CheckersMoveRecord[] = [];
  for (const [index, candidate] of value.moveHistory.entries()) {
    const parsed = validateMove(candidate, index);
    if (!parsed.ok) return parsed;
    moveHistory.push(parsed.value);
  }

  return {
    ok: true,
    value: {
      schemaVersion: 1,
      ruleset: 'russian-64',
      mode: value.mode,
      sideToMove: value.sideToMove,
      pieces,
      moveHistory,
      result: value.result,
    },
  };
}
