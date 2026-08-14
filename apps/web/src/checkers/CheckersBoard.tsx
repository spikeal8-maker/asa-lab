const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

export type CheckersBoardSquare = `${(typeof FILES)[number]}${(typeof RANKS)[number]}`;

export interface CheckersBoardPiece {
  readonly id: string;
  readonly side: 'light' | 'dark';
  readonly kind: 'man' | 'king';
  readonly square: CheckersBoardSquare;
}

export function CheckersBoard({
  pieces,
  orientation = 'light',
  selectedPieceId,
  legalDestinations = [],
  disabled = false,
  onSquareClick,
}: {
  pieces: readonly CheckersBoardPiece[];
  orientation?: 'light' | 'dark';
  selectedPieceId?: string | null;
  legalDestinations?: readonly CheckersBoardSquare[];
  disabled?: boolean;
  onSquareClick?: (square: CheckersBoardSquare) => void;
}): JSX.Element {
  const boardRef = useRef<HTMLDivElement>(null);
  const files = orientation === 'light' ? FILES : [...FILES].reverse();
  const ranks = orientation === 'light' ? [...RANKS].reverse() : RANKS;
  const bySquare = new Map(pieces.map((piece) => [piece.square, piece] as const));
  const destinations = new Set(legalDestinations);
  const playableSquares = ranks.flatMap((rank) =>
    files
      .map((file) => `${file}${rank}` as CheckersBoardSquare)
      .filter(
        (square) =>
          (FILES.indexOf(square[0] as (typeof FILES)[number]) + Number(square[1])) % 2 === 1,
      ),
  );
  const selectedSquare = pieces.find((piece) => piece.id === selectedPieceId)?.square;

  const moveKeyboardFocus = (square: CheckersBoardSquare, key: string): void => {
    const current = playableSquares.indexOf(square);
    const delta = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -4 : 4;
    const nextIndex =
      key === 'Home' ? 0 : key === 'End' ? playableSquares.length - 1 : current + delta;
    const next = playableSquares[Math.min(playableSquares.length - 1, Math.max(0, nextIndex))];
    boardRef.current?.querySelector<HTMLButtonElement>(`[data-square="${next}"]`)?.focus();
  };

  return (
    <div
      ref={boardRef}
      className="checkers-board"
      role="grid"
      aria-label="Доска для русских шашек, 8 на 8"
      data-orientation={orientation}
    >
      {ranks.flatMap((rank, rankIndex) =>
        files.map((file, fileIndex) => {
          const square = `${file}${rank}` as CheckersBoardSquare;
          const sourceFileIndex = FILES.indexOf(file);
          const isPlayable = (sourceFileIndex + Number(rank)) % 2 === 1;
          const piece = bySquare.get(square);
          const selected = piece?.id === selectedPieceId;
          const destination = destinations.has(square);
          const label = piece
            ? `${square}: ${piece.side === 'light' ? 'светлая' : 'тёмная'} ${
                piece.kind === 'king' ? 'дамка' : 'шашка'
              }`
            : `${square}: ${destination ? 'допустимое поле хода' : 'пустое поле'}`;

          return (
            <button
              key={square}
              type="button"
              role="gridcell"
              className={`checkers-square ${isPlayable ? 'dark' : 'light'}${
                selected ? ' selected' : ''
              }${destination ? ' destination' : ''}`}
              data-square={square}
              aria-label={label}
              aria-selected={selected}
              tabIndex={
                selectedSquare === square || (!selectedSquare && playableSquares[0] === square)
                  ? 0
                  : -1
              }
              disabled={disabled || !isPlayable}
              onClick={() => onSquareClick?.(square)}
              onKeyDown={(event) => {
                if (
                  event.key === 'ArrowLeft' ||
                  event.key === 'ArrowRight' ||
                  event.key === 'ArrowUp' ||
                  event.key === 'ArrowDown' ||
                  event.key === 'Home' ||
                  event.key === 'End'
                ) {
                  event.preventDefault();
                  moveKeyboardFocus(square, event.key);
                }
              }}
            >
              {fileIndex === 0 ? <span className="checkers-rank-label">{rank}</span> : null}
              {rankIndex === 7 ? <span className="checkers-file-label">{file}</span> : null}
              {destination ? (
                <span className="checkers-destination-dot" aria-hidden="true" />
              ) : null}
              {piece ? (
                <span className={`checkers-piece ${piece.side} ${piece.kind}`} aria-hidden="true">
                  {piece.kind === 'king' ? <span className="checkers-crown">◆</span> : null}
                </span>
              ) : null}
            </button>
          );
        }),
      )}
    </div>
  );
}
import { useRef } from 'react';
