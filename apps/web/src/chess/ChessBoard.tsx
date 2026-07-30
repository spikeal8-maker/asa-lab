import {
  FILES,
  RANKS,
  findKing,
  isInCheck,
  pieceAt,
  type BoardOrientation,
  type ChessMove,
  type ChessPosition,
  type Square,
} from '@asa-lab/chess';
import { PIECE_SYMBOL, squareAccessibleLabel } from './chess-ui';

interface ChessBoardProps {
  position: ChessPosition;
  orientation: BoardOrientation;
  selectedSquare: Square | null;
  legalMoves: readonly ChessMove[];
  lastMoveUci?: string | undefined;
  disabled?: boolean | undefined;
  onSquare(square: Square): void;
  onMove(from: Square, to: Square): void;
}

function squareName(file: string, rank: number): Square {
  return `${file}${rank}` as Square;
}

export function ChessBoard({
  position,
  orientation,
  selectedSquare,
  legalMoves,
  lastMoveUci,
  disabled = false,
  onSquare,
  onMove,
}: ChessBoardProps) {
  const files = orientation === 'white' ? FILES : [...FILES].reverse();
  const ranks = orientation === 'white' ? [...RANKS].reverse() : RANKS;
  const legalTargets = new Set(
    legalMoves.filter((move) => move.from === selectedSquare).map((move) => move.to),
  );
  const captureTargets = new Set(
    legalMoves
      .filter((move) => move.from === selectedSquare && move.isCapture)
      .map((move) => move.to),
  );
  const lastFrom = lastMoveUci?.slice(0, 2) as Square | undefined;
  const lastTo = lastMoveUci?.slice(2, 4) as Square | undefined;
  const checkedKing = isInCheck(position) ? findKing(position, position.turn) : null;

  return (
    <div
      className={`asa-chess-board orientation-${orientation}`}
      role="grid"
      aria-label={`Шахматная доска, ходят ${position.turn === 'white' ? 'белые' : 'чёрные'}`}
      data-testid="asa-chess-board"
    >
      {ranks.flatMap((rank, rankIndex) =>
        files.map((file, fileIndex) => {
          const square = squareName(file, rank);
          const piece = pieceAt(position, square);
          const dark = (FILES.indexOf(file) + rank) % 2 === 1;
          const legalTarget = legalTargets.has(square);
          const captureTarget = captureTargets.has(square);
          const selected = selectedSquare === square;
          const last = square === lastFrom || square === lastTo;
          const checked = square === checkedKing;
          const canDrag = !disabled && piece?.color === position.turn;
          const showFile = rankIndex === ranks.length - 1;
          const showRank = fileIndex === 0;
          return (
            <button
              key={square}
              type="button"
              role="gridcell"
              className={[
                'asa-chess-square',
                dark ? 'dark' : 'light',
                selected ? 'selected' : '',
                legalTarget ? 'legal-target' : '',
                captureTarget ? 'capture-target' : '',
                last ? 'last-move' : '',
                checked ? 'king-in-check' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-label={squareAccessibleLabel(square, piece)}
              aria-pressed={selected}
              data-square={square}
              data-piece={piece ? `${piece.color}-${piece.type}` : 'empty'}
              disabled={disabled}
              draggable={canDrag}
              onDragStart={(event) => {
                if (!canDrag) {
                  event.preventDefault();
                  return;
                }
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', square);
              }}
              onDragOver={(event) => {
                if (!disabled) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const from = event.dataTransfer.getData('text/plain');
                if (/^[a-h][1-8]$/.test(from)) onMove(from as Square, square);
              }}
              onClick={() => onSquare(square)}
            >
              {showRank && <span className="asa-chess-coordinate rank-coordinate">{rank}</span>}
              {showFile && <span className="asa-chess-coordinate file-coordinate">{file}</span>}
              {legalTarget && !captureTarget && <span className="asa-chess-move-dot" aria-hidden="true" />}
              {captureTarget && <span className="asa-chess-capture-ring" aria-hidden="true" />}
              {piece && (
                <span
                  className={`asa-chess-piece ${piece.color}`}
                  aria-hidden="true"
                  data-piece-type={piece.type}
                >
                  {PIECE_SYMBOL[piece.color][piece.type]}
                </span>
              )}
            </button>
          );
        }),
      )}
    </div>
  );
}
