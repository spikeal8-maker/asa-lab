import {
  validateCheckersDocument,
  type CheckersDocument,
  type CheckersDocumentResult,
  type CheckersPiece,
  type CheckersPieceKind,
  type CheckersResult,
  type CheckersSide,
  type CheckersSquare,
} from './document.js';

const BOARD_SIZE = 8;
const DIAGONALS = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;

interface Coordinate {
  readonly file: number;
  readonly rank: number;
}

export interface CheckersLegalMove {
  readonly pieceId: string;
  readonly side: CheckersSide;
  readonly kindBefore: CheckersPieceKind;
  readonly kindAfter: CheckersPieceKind;
  readonly path: readonly CheckersSquare[];
  readonly capturedIds: readonly string[];
  readonly isCapture: boolean;
  readonly notation: string;
}

export interface CheckersMoveInput {
  readonly pieceId: string;
  readonly path: readonly CheckersSquare[];
}

export interface CheckersGameStatus {
  readonly state: 'ongoing' | 'win' | 'draw';
  readonly result: CheckersResult;
  readonly winner: CheckersSide | null;
  readonly reason: 'ongoing' | 'no-pieces' | 'no-legal-moves' | 'declared-draw';
  readonly legalMoveCount: number;
  readonly captureRequired: boolean;
}

interface CaptureState {
  readonly square: CheckersSquare;
  readonly kind: CheckersPieceKind;
  readonly path: readonly CheckersSquare[];
  readonly capturedIds: readonly string[];
}

function opposite(side: CheckersSide): CheckersSide {
  return side === 'light' ? 'dark' : 'light';
}

function coordinate(square: CheckersSquare): Coordinate {
  return {
    file: square.charCodeAt(0) - 97,
    rank: Number(square[1]) - 1,
  };
}

function squareAt(file: number, rank: number): CheckersSquare | null {
  if (file < 0 || file >= BOARD_SIZE || rank < 0 || rank >= BOARD_SIZE) return null;
  return `${String.fromCharCode(97 + file)}${rank + 1}` as CheckersSquare;
}

function promotionRank(side: CheckersSide): number {
  return side === 'light' ? BOARD_SIZE - 1 : 0;
}

function kindAfterLanding(
  kind: CheckersPieceKind,
  side: CheckersSide,
  square: CheckersSquare,
): CheckersPieceKind {
  if (kind === 'king') return 'king';
  return coordinate(square).rank === promotionRank(side) ? 'king' : 'man';
}

function occupiedBy(
  occupants: ReadonlyMap<CheckersSquare, CheckersPiece>,
  square: CheckersSquare,
): CheckersPiece | undefined {
  return occupants.get(square);
}

function makeMove(
  piece: CheckersPiece,
  kindAfter: CheckersPieceKind,
  path: readonly CheckersSquare[],
  capturedIds: readonly string[],
): CheckersLegalMove {
  const isCapture = capturedIds.length > 0;
  return {
    pieceId: piece.id,
    side: piece.side,
    kindBefore: piece.kind,
    kindAfter,
    path,
    capturedIds,
    isCapture,
    notation: path.join(isCapture ? ':' : '-'),
  };
}

function manCaptureSteps(
  side: CheckersSide,
  state: CaptureState,
  occupants: ReadonlyMap<CheckersSquare, CheckersPiece>,
): readonly { readonly landing: CheckersSquare; readonly captured: CheckersPiece }[] {
  const from = coordinate(state.square);
  const captured = new Set(state.capturedIds);
  const steps: { landing: CheckersSquare; captured: CheckersPiece }[] = [];

  for (const [fileDelta, rankDelta] of DIAGONALS) {
    const middle = squareAt(from.file + fileDelta, from.rank + rankDelta);
    const landing = squareAt(from.file + fileDelta * 2, from.rank + rankDelta * 2);
    if (!middle || !landing || occupiedBy(occupants, landing)) continue;
    const target = occupiedBy(occupants, middle);
    if (!target || target.side === side || captured.has(target.id)) continue;
    steps.push({ landing, captured: target });
  }

  return steps;
}

function kingCaptureSteps(
  side: CheckersSide,
  state: CaptureState,
  occupants: ReadonlyMap<CheckersSquare, CheckersPiece>,
): readonly { readonly landing: CheckersSquare; readonly captured: CheckersPiece }[] {
  const from = coordinate(state.square);
  const alreadyCaptured = new Set(state.capturedIds);
  const steps: { landing: CheckersSquare; captured: CheckersPiece }[] = [];

  for (const [fileDelta, rankDelta] of DIAGONALS) {
    let distance = 1;
    let target: CheckersPiece | null = null;

    while (true) {
      const square = squareAt(from.file + fileDelta * distance, from.rank + rankDelta * distance);
      if (!square) break;
      const occupant = occupiedBy(occupants, square);

      if (!target) {
        if (!occupant) {
          distance += 1;
          continue;
        }
        if (occupant.side === side || alreadyCaptured.has(occupant.id)) break;
        target = occupant;
        distance += 1;
        continue;
      }

      if (occupant) break;
      steps.push({ landing: square, captured: target });
      distance += 1;
    }
  }

  return steps;
}

function captureSequences(
  piece: CheckersPiece,
  state: CaptureState,
  occupants: ReadonlyMap<CheckersSquare, CheckersPiece>,
): readonly CheckersLegalMove[] {
  const steps =
    state.kind === 'man'
      ? manCaptureSteps(piece.side, state, occupants)
      : kingCaptureSteps(piece.side, state, occupants);

  if (steps.length === 0) {
    return state.capturedIds.length === 0
      ? []
      : [makeMove(piece, state.kind, state.path, state.capturedIds)];
  }

  return steps.flatMap((step) => {
    const nextKind = kindAfterLanding(state.kind, piece.side, step.landing);
    return captureSequences(
      piece,
      {
        square: step.landing,
        kind: nextKind,
        path: [...state.path, step.landing],
        capturedIds: [...state.capturedIds, step.captured.id],
      },
      occupants,
    );
  });
}

function quietMoves(
  piece: CheckersPiece,
  occupants: ReadonlyMap<CheckersSquare, CheckersPiece>,
): readonly CheckersLegalMove[] {
  const from = coordinate(piece.square);
  const moves: CheckersLegalMove[] = [];

  if (piece.kind === 'man') {
    const rankDelta = piece.side === 'light' ? 1 : -1;
    for (const fileDelta of [-1, 1] as const) {
      const landing = squareAt(from.file + fileDelta, from.rank + rankDelta);
      if (!landing || occupiedBy(occupants, landing)) continue;
      moves.push(
        makeMove(
          piece,
          kindAfterLanding(piece.kind, piece.side, landing),
          [piece.square, landing],
          [],
        ),
      );
    }
    return moves;
  }

  for (const [fileDelta, rankDelta] of DIAGONALS) {
    let distance = 1;
    while (true) {
      const landing = squareAt(from.file + fileDelta * distance, from.rank + rankDelta * distance);
      if (!landing || occupiedBy(occupants, landing)) break;
      moves.push(makeMove(piece, 'king', [piece.square, landing], []));
      distance += 1;
    }
  }
  return moves;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareMoves(left: CheckersLegalMove, right: CheckersLegalMove): number {
  return (
    compareText(left.pieceId, right.pieceId) ||
    compareText(left.notation, right.notation) ||
    compareText(left.capturedIds.join(','), right.capturedIds.join(','))
  );
}

export function generateLegalCheckersMoves(
  position: Pick<CheckersDocument, 'pieces' | 'sideToMove'>,
): readonly CheckersLegalMove[] {
  const pieces = position.pieces.filter((piece) => piece.side === position.sideToMove);
  const captures = pieces.flatMap((piece) => {
    const occupants = new Map(
      position.pieces
        .filter((candidate) => candidate.id !== piece.id)
        .map((candidate) => [candidate.square, candidate] as const),
    );
    return captureSequences(
      piece,
      {
        square: piece.square,
        kind: piece.kind,
        path: [piece.square],
        capturedIds: [],
      },
      occupants,
    );
  });

  if (captures.length > 0) return captures.sort(compareMoves);

  const occupants = new Map(position.pieces.map((piece) => [piece.square, piece] as const));
  return pieces.flatMap((piece) => quietMoves(piece, occupants)).sort(compareMoves);
}

function resultForWinner(winner: CheckersSide): CheckersResult {
  return winner === 'light' ? '1-0' : '0-1';
}

function winnerFromResult(result: CheckersResult): CheckersSide | null {
  if (result === '1-0') return 'light';
  if (result === '0-1') return 'dark';
  return null;
}

export function getCheckersGameStatus(document: CheckersDocument): CheckersGameStatus {
  if (document.result === '1/2-1/2') {
    return {
      state: 'draw',
      result: document.result,
      winner: null,
      reason: 'declared-draw',
      legalMoveCount: 0,
      captureRequired: false,
    };
  }
  if (document.result !== '*') {
    return {
      state: 'win',
      result: document.result,
      winner: winnerFromResult(document.result),
      reason: document.pieces.some((piece) => piece.side === document.sideToMove)
        ? 'no-legal-moves'
        : 'no-pieces',
      legalMoveCount: 0,
      captureRequired: false,
    };
  }

  const sideHasPieces = document.pieces.some((piece) => piece.side === document.sideToMove);
  const legalMoves = sideHasPieces ? generateLegalCheckersMoves(document) : [];
  if (legalMoves.length === 0) {
    const winner = opposite(document.sideToMove);
    return {
      state: 'win',
      result: resultForWinner(winner),
      winner,
      reason: sideHasPieces ? 'no-legal-moves' : 'no-pieces',
      legalMoveCount: 0,
      captureRequired: false,
    };
  }

  return {
    state: 'ongoing',
    result: '*',
    winner: null,
    reason: 'ongoing',
    legalMoveCount: legalMoves.length,
    captureRequired: legalMoves[0]?.isCapture ?? false,
  };
}

function samePath(left: readonly CheckersSquare[], right: readonly CheckersSquare[]): boolean {
  return left.length === right.length && left.every((square, index) => square === right[index]);
}

export function applyCheckersMove(
  document: CheckersDocument,
  input: CheckersMoveInput,
): CheckersDocumentResult<CheckersDocument> {
  const parsed = validateCheckersDocument(document);
  if (!parsed.ok) return parsed;
  if (document.result !== '*') {
    return { ok: false, message: 'the game is already finished' };
  }

  const legalMove = generateLegalCheckersMoves(document).find(
    (candidate) => candidate.pieceId === input.pieceId && samePath(candidate.path, input.path),
  );
  if (!legalMove) {
    return { ok: false, message: 'the requested move is not legal in this position' };
  }

  const destination = legalMove.path.at(-1)!;
  const captured = new Set(legalMove.capturedIds);
  const pieces = document.pieces
    .filter((piece) => !captured.has(piece.id))
    .map((piece) =>
      piece.id === legalMove.pieceId
        ? { ...piece, square: destination, kind: legalMove.kindAfter }
        : piece,
    );
  const nextSide = opposite(document.sideToMove);
  const provisional: CheckersDocument = {
    ...document,
    sideToMove: nextSide,
    pieces,
    moveHistory: [
      ...document.moveHistory,
      {
        ply: document.moveHistory.length + 1,
        side: document.sideToMove,
        pieceId: legalMove.pieceId,
        path: legalMove.path,
        capturedIds: legalMove.capturedIds,
        promoted: legalMove.kindBefore === 'man' && legalMove.kindAfter === 'king',
      },
    ],
  };
  const status = getCheckersGameStatus(provisional);
  return {
    ok: true,
    value: status.state === 'ongoing' ? provisional : { ...provisional, result: status.result },
  };
}
