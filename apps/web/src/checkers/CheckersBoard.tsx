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
  const files = orientation === 'light' ? FILES : [...FILES].reverse();
  const ranks = orientation === 'light' ? [...RANKS].reverse() : RANKS;
  const bySquare = new Map(pieces.map((piece) => [piece.square, piece] as const));
  const destinations = new Set(legalDestinations);

  return (
    <div
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
              disabled={disabled || !isPlayable}
              onClick={() => onSquareClick?.(square)}
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
