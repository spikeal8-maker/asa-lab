import type { CheckersDocument, CheckersPiece, CheckersSide } from './document.js';

export type CheckersAutomaticDrawReason =
  | 'threefold-repetition'
  | 'king-only-15-moves'
  | 'three-kings-vs-one-15-moves'
  | 'four-or-five-piece-30-moves'
  | 'six-or-seven-piece-60-moves'
  | 'regulation-ending-5-moves';

export interface CheckersPositionOccurrence {
  readonly key: string;
  readonly count: number;
}

export interface CheckersDrawTracker {
  readonly positionOccurrences: readonly CheckersPositionOccurrence[];
  readonly kingOnlyQuietPlies: number;
  readonly materialStablePlies: number;
  readonly threeKingsSignature: string | null;
  readonly threeKingsPlies: number;
  readonly regulationSignature: string | null;
  readonly regulationPlies: number;
}

const LONG_DIAGONAL = new Set(['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8']);

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function checkersPositionKey(
  position: Pick<CheckersDocument, 'pieces' | 'sideToMove'>,
): string {
  const pieces = position.pieces
    .map((piece) => `${piece.side[0]}${piece.kind[0]}:${piece.square}`)
    .sort(compareText)
    .join(',');
  return `${position.sideToMove}|${pieces}`;
}

function piecesFor(document: CheckersDocument, side: CheckersSide): readonly CheckersPiece[] {
  return document.pieces.filter((piece) => piece.side === side);
}

function loneKing(pieces: readonly CheckersPiece[]): CheckersPiece | null {
  return pieces.length === 1 && pieces[0]?.kind === 'king' ? pieces[0] : null;
}

function threeKingsSignature(document: CheckersDocument): string | null {
  for (const advantagedSide of ['light', 'dark'] as const) {
    const defendingSide = advantagedSide === 'light' ? 'dark' : 'light';
    const advantaged = piecesFor(document, advantagedSide);
    const defender = loneKing(piecesFor(document, defendingSide));
    if (advantaged.length >= 3 && advantaged.every((piece) => piece.kind === 'king') && defender) {
      return `${advantagedSide}:${advantaged.length}k-vs-${defendingSide}:1k`;
    }
  }
  return null;
}

function regulationSignature(document: CheckersDocument): string | null {
  for (const advantagedSide of ['light', 'dark'] as const) {
    const defendingSide = advantagedSide === 'light' ? 'dark' : 'light';
    const advantaged = piecesFor(document, advantagedSide);
    const defender = loneKing(piecesFor(document, defendingSide));
    if (!defender) continue;

    const kings = advantaged.filter((piece) => piece.kind === 'king').length;
    const men = advantaged.length - kings;
    const defenderOnLongDiagonal = LONG_DIAGONAL.has(defender.square);
    const article86 =
      defenderOnLongDiagonal &&
      ((kings === 3 && men === 0) || (kings === 2 && men === 1) || (kings === 1 && men === 2));
    const article87 =
      (kings === 2 && men === 0) || (kings === 1 && men === 1) || (kings === 1 && men === 0);
    if (article86 || article87) {
      return `${advantagedSide}:${kings}k${men}m-vs-${defendingSide}:1k@${
        defenderOnLongDiagonal ? 'long' : 'other'
      }`;
    }
  }
  return null;
}

function incrementSignature(
  previousSignature: string | null,
  previousPlies: number,
  nextSignature: string | null,
): number {
  if (nextSignature === null) return 0;
  return nextSignature === previousSignature ? previousPlies + 1 : 1;
}

export function createCheckersDrawTracker(document: CheckersDocument): CheckersDrawTracker {
  return {
    positionOccurrences: [{ key: checkersPositionKey(document), count: 1 }],
    kingOnlyQuietPlies: 0,
    materialStablePlies: 0,
    threeKingsSignature: threeKingsSignature(document),
    threeKingsPlies: 0,
    regulationSignature: regulationSignature(document),
    regulationPlies: 0,
  };
}

export function advanceCheckersDrawTracker(
  tracker: CheckersDrawTracker,
  before: CheckersDocument,
  after: CheckersDocument,
): CheckersDrawTracker {
  const move = after.moveHistory.at(-1);
  const movedPiece = move ? before.pieces.find((piece) => piece.id === move.pieceId) : undefined;
  const quietKingMove =
    movedPiece?.kind === 'king' && move?.capturedIds.length === 0 && move.promoted === false;
  const materialStable = move?.capturedIds.length === 0 && move.promoted === false;

  const key = checkersPositionKey(after);
  const occurrences = new Map(tracker.positionOccurrences.map((entry) => [entry.key, entry.count]));
  occurrences.set(key, (occurrences.get(key) ?? 0) + 1);

  const nextThreeKings = threeKingsSignature(after);
  const nextRegulation = regulationSignature(after);
  return {
    positionOccurrences: [...occurrences.entries()]
      .map(([positionKey, count]) => ({ key: positionKey, count }))
      .sort((left, right) => compareText(left.key, right.key)),
    kingOnlyQuietPlies: quietKingMove ? tracker.kingOnlyQuietPlies + 1 : 0,
    materialStablePlies: materialStable ? tracker.materialStablePlies + 1 : 0,
    threeKingsSignature: nextThreeKings,
    threeKingsPlies: incrementSignature(
      tracker.threeKingsSignature,
      tracker.threeKingsPlies,
      nextThreeKings,
    ),
    regulationSignature: nextRegulation,
    regulationPlies: incrementSignature(
      tracker.regulationSignature,
      tracker.regulationPlies,
      nextRegulation,
    ),
  };
}

export function getCheckersAutomaticDrawReason(
  tracker: CheckersDrawTracker,
  document: CheckersDocument,
): CheckersAutomaticDrawReason | null {
  const currentKey = checkersPositionKey(document);
  if ((tracker.positionOccurrences.find((entry) => entry.key === currentKey)?.count ?? 0) >= 3) {
    return 'threefold-repetition';
  }
  if (tracker.regulationSignature !== null && tracker.regulationPlies >= 10) {
    return 'regulation-ending-5-moves';
  }
  if (tracker.threeKingsSignature !== null && tracker.threeKingsPlies >= 30) {
    return 'three-kings-vs-one-15-moves';
  }
  if (tracker.kingOnlyQuietPlies >= 30) return 'king-only-15-moves';

  const bothHaveKings = (['light', 'dark'] as const).every((side) =>
    piecesFor(document, side).some((piece) => piece.kind === 'king'),
  );
  if (bothHaveKings && document.pieces.length >= 4 && document.pieces.length <= 5) {
    if (tracker.materialStablePlies >= 60) return 'four-or-five-piece-30-moves';
  }
  if (bothHaveKings && document.pieces.length >= 6 && document.pieces.length <= 7) {
    if (tracker.materialStablePlies >= 120) return 'six-or-seven-piece-60-moves';
  }
  return null;
}
