import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { CheckersBoardPiece, CheckersBoardSquare } from './CheckersBoard';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

export type CheckersBoardTheme = 'classic' | 'light' | 'dark';

interface CaptureGhost {
  readonly key: string;
  readonly piece: CheckersBoardPiece;
  readonly orientation: 'light' | 'dark';
  readonly delayMs: number;
}

function isPlayableSquare(square: CheckersBoardSquare): boolean {
  return (FILES.indexOf(square[0] as (typeof FILES)[number]) + Number(square[1])) % 2 === 1;
}

function squarePosition(square: CheckersBoardSquare, orientation: 'light' | 'dark'): CSSProperties {
  const file = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rank = Number(square[1]);
  const x = orientation === 'light' ? file : 7 - file;
  const y = orientation === 'light' ? 8 - rank : rank - 1;
  return { '--checkers-x': `${x * 100}%`, '--checkers-y': `${y * 100}%` } as CSSProperties;
}

function squareTransform(square: CheckersBoardSquare, orientation: 'light' | 'dark'): string {
  const file = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rank = Number(square[1]);
  const x = orientation === 'light' ? file : 7 - file;
  const y = orientation === 'light' ? 8 - rank : rank - 1;
  return `translate(${x * 100}%, ${y * 100}%)`;
}

function squarePoint(
  square: CheckersBoardSquare,
  orientation: 'light' | 'dark',
): { x: number; y: number } {
  const file = FILES.indexOf(square[0] as (typeof FILES)[number]);
  const rank = Number(square[1]);
  return {
    x: (orientation === 'light' ? file : 7 - file) + 0.5,
    y: (orientation === 'light' ? 8 - rank : rank - 1) + 0.5,
  };
}

function KingMark(): JSX.Element {
  return (
    <svg className="checkers-v2-crown" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.25 8.25 8.1 11.7 12 5.4l3.9 6.3 3.85-3.45-1.45 8.15H5.7L4.25 8.25Z" />
      <path d="M6.25 18.6h11.5" fill="none" />
    </svg>
  );
}

function pieceLabel(piece: CheckersBoardPiece, movable: boolean, forcedCapture: boolean): string {
  return `${piece.square}: ${piece.side === 'light' ? 'светлая' : 'тёмная'} ${
    piece.kind === 'king' ? 'дамка' : 'шашка'
  }${forcedCapture ? ', обязательное взятие' : movable ? ', доступна для хода' : ''}`;
}

export function CheckersBoardV2({
  pieces,
  orientation = 'light',
  theme = 'classic',
  showCoordinates = true,
  selectedPieceId,
  legalDestinations = [],
  captureDestinations = [],
  capturePaths = [],
  movablePieceIds = [],
  forcedCapturePieceIds = [],
  lastMovePath = [],
  lastMoveCapturedIds = [],
  disabled = false,
  onSquareClick,
}: {
  pieces: readonly CheckersBoardPiece[];
  orientation?: 'light' | 'dark';
  theme?: CheckersBoardTheme;
  showCoordinates?: boolean;
  selectedPieceId?: string | null;
  legalDestinations?: readonly CheckersBoardSquare[];
  captureDestinations?: readonly CheckersBoardSquare[];
  capturePaths?: readonly (readonly CheckersBoardSquare[])[];
  movablePieceIds?: readonly string[];
  forcedCapturePieceIds?: readonly string[];
  lastMovePath?: readonly CheckersBoardSquare[];
  lastMoveCapturedIds?: readonly string[];
  disabled?: boolean;
  onSquareClick?: (square: CheckersBoardSquare) => void;
}): JSX.Element {
  const boardRef = useRef<HTMLDivElement>(null);
  const previousPiecesRef = useRef<readonly CheckersBoardPiece[]>(pieces);
  const previousOrientationRef = useRef(orientation);
  const captureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const promotionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [captureGhosts, setCaptureGhosts] = useState<readonly CaptureGhost[]>([]);
  const [promotedPieceIds, setPromotedPieceIds] = useState<readonly string[]>([]);

  const files = orientation === 'light' ? FILES : [...FILES].reverse();
  const ranks = orientation === 'light' ? [...RANKS].reverse() : RANKS;
  const bySquare = useMemo(
    () => new Map(pieces.map((piece) => [piece.square, piece] as const)),
    [pieces],
  );
  const destinations = useMemo(() => new Set(legalDestinations), [legalDestinations]);
  const captureTargets = useMemo(() => new Set(captureDestinations), [captureDestinations]);
  const movablePieces = useMemo(() => new Set(movablePieceIds), [movablePieceIds]);
  const forcedPieces = useMemo(() => new Set(forcedCapturePieceIds), [forcedCapturePieceIds]);
  const selectedSquare = pieces.find((piece) => piece.id === selectedPieceId)?.square;
  const playableSquares = ranks.flatMap((rank) =>
    files.map((file) => `${file}${rank}` as CheckersBoardSquare).filter(isPlayableSquare),
  );

  useEffect(() => {
    const previousPieces = previousPiecesRef.current;
    const currentById = new Map(pieces.map((piece) => [piece.id, piece] as const));
    const captured = previousPieces.filter((piece) => !currentById.has(piece.id));
    const moved = pieces.find((piece) => {
      const previous = previousPieces.find((candidate) => candidate.id === piece.id);
      return previous !== undefined && previous.square !== piece.square;
    });
    const promoted = pieces.filter((piece) => {
      const previous = previousPieces.find((candidate) => candidate.id === piece.id);
      return previous?.kind === 'man' && piece.kind === 'king';
    });

    if (captureTimerRef.current) clearTimeout(captureTimerRef.current);
    if (captured.length > 0) {
      const captureOrder = new Map(lastMoveCapturedIds.map((id, index) => [id, index] as const));
      setCaptureGhosts(
        captured.map((piece, fallbackIndex) => ({
          key: `${piece.id}-${piece.square}-${Date.now()}`,
          piece,
          orientation: previousOrientationRef.current,
          delayMs: (captureOrder.get(piece.id) ?? fallbackIndex) * 230 + 120,
        })),
      );
      captureTimerRef.current = setTimeout(() => setCaptureGhosts([]), captured.length * 230 + 420);
    }

    const previousMoved = moved
      ? previousPieces.find((candidate) => candidate.id === moved.id)
      : undefined;
    const reduceMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (
      !reduceMotion &&
      moved &&
      previousMoved &&
      lastMovePath.length >= 2 &&
      lastMovePath[0] === previousMoved.square &&
      lastMovePath.at(-1) === moved.square
    ) {
      const element = boardRef.current?.querySelector<HTMLElement>(`[data-piece-id="${moved.id}"]`);
      const face = element?.querySelector<HTMLElement>('.checkers-v2-piece');
      const segments = lastMovePath.length - 1;
      const duration = Math.max(300, segments * 290);
      element?.animate(
        lastMovePath.map((square, index) => ({
          transform: squareTransform(square, orientation),
          offset: index / segments,
          easing: 'cubic-bezier(0.22, 0.72, 0.24, 1)',
        })),
        { duration, easing: 'linear' },
      );
      const bounceFrames: Keyframe[] = [{ transform: 'translateY(-3%) scale(1)', offset: 0 }];
      for (let index = 1; index <= segments; index += 1) {
        bounceFrames.push(
          {
            transform: 'translateY(-18%) scale(1.055)',
            offset: (index - 0.5) / segments,
          },
          { transform: 'translateY(-3%) scale(1)', offset: index / segments },
        );
      }
      face?.animate(bounceFrames, { duration, easing: 'linear' });
    }

    if (promotionTimerRef.current) clearTimeout(promotionTimerRef.current);
    if (promoted.length > 0) {
      setPromotedPieceIds(promoted.map((piece) => piece.id));
      promotionTimerRef.current = setTimeout(() => setPromotedPieceIds([]), 420);
    }

    previousPiecesRef.current = pieces;
    previousOrientationRef.current = orientation;
  }, [lastMoveCapturedIds, lastMovePath, orientation, pieces]);

  useEffect(
    () => () => {
      if (captureTimerRef.current) clearTimeout(captureTimerRef.current);
      if (promotionTimerRef.current) clearTimeout(promotionTimerRef.current);
    },
    [],
  );

  const moveKeyboardFocus = (square: CheckersBoardSquare, key: string): void => {
    const current = playableSquares.indexOf(square);
    const delta = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -4 : 4;
    const nextIndex =
      key === 'Home' ? 0 : key === 'End' ? playableSquares.length - 1 : current + delta;
    const next = playableSquares[Math.min(playableSquares.length - 1, Math.max(0, nextIndex))];
    boardRef.current?.querySelector<HTMLButtonElement>(`[data-square="${next}"]`)?.focus();
  };

  const orderedSquares = ranks.flatMap((rank) =>
    files.map((file) => `${file}${rank}` as CheckersBoardSquare),
  );
  const lastMoveDestination = lastMovePath.at(-1);
  const lastMovePieceId = lastMoveDestination ? bySquare.get(lastMoveDestination)?.id : undefined;

  return (
    <div
      ref={boardRef}
      className="checkers-board-v2"
      role="grid"
      aria-label="Доска для русских шашек, 8 на 8"
      data-orientation={orientation}
      data-theme={theme}
      data-renderer="v2"
      data-animation="transform"
    >
      <div className="checkers-board-v2-grid" aria-hidden="true">
        {orderedSquares.map((square) => (
          <span key={square} className={isPlayableSquare(square) ? 'dark' : 'light'} />
        ))}
      </div>

      <div className="checkers-board-v2-hints" aria-hidden="true">
        {capturePaths.length > 0 ? (
          <svg className="checkers-v2-capture-routes" viewBox="0 0 8 8" preserveAspectRatio="none">
            <defs>
              <marker
                id="checkers-capture-arrow"
                markerWidth="0.7"
                markerHeight="0.7"
                refX="0.5"
                refY="0.35"
                orient="auto"
              >
                <path d="M0,0 L0.7,0.35 L0,0.7 Z" />
              </marker>
            </defs>
            {capturePaths.flatMap((path, pathIndex) =>
              path.slice(1).map((square, stepIndex) => {
                const from = squarePoint(path[stepIndex]!, orientation);
                const to = squarePoint(square, orientation);
                return (
                  <line
                    key={`route-${pathIndex}-${stepIndex}-${square}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    markerEnd="url(#checkers-capture-arrow)"
                  />
                );
              }),
            )}
          </svg>
        ) : null}
        {capturePaths.flatMap((path, pathIndex) =>
          path.slice(1).map((square, stepIndex) => (
            <span
              key={`capture-step-${pathIndex}-${stepIndex}-${square}`}
              className="checkers-v2-capture-step"
              style={squarePosition(square, orientation)}
            >
              {stepIndex + 1}
            </span>
          )),
        )}
        {lastMovePath.map((square, index) => (
          <span
            key={`last-${square}-${index}`}
            className={`checkers-v2-overlay-cell last-move${
              index === 0 ? ' start' : index === lastMovePath.length - 1 ? ' end' : ''
            }`}
            style={squarePosition(square, orientation)}
          />
        ))}
        {selectedSquare ? (
          <span
            className="checkers-v2-overlay-cell selected"
            style={squarePosition(selectedSquare, orientation)}
          />
        ) : null}
        {legalDestinations.map((square) => (
          <span
            key={`destination-${square}`}
            className={`checkers-v2-overlay-cell destination${
              captureTargets.has(square) ? ' capture' : ''
            }`}
            style={squarePosition(square, orientation)}
          >
            <span />
          </span>
        ))}
      </div>

      <div className="checkers-board-v2-pieces" aria-hidden="true">
        {pieces.map((piece) => {
          const selected = piece.id === selectedPieceId;
          const movable = movablePieces.has(piece.id);
          const forcedCapture = forcedPieces.has(piece.id);
          const promoted = promotedPieceIds.includes(piece.id);
          return (
            <span
              key={`${piece.id}:${orientation}`}
              className={`checkers-v2-piece-slot${selected ? ' selected' : ''}${
                movable ? ' movable' : ''
              }${forcedCapture ? ' forced-capture' : ''}`}
              style={squarePosition(piece.square, orientation)}
              data-piece-id={piece.id}
              data-piece-square={piece.square}
              data-last-move-piece={piece.id === lastMovePieceId ? 'true' : undefined}
              data-motion-steps={
                piece.id === lastMovePieceId ? Math.max(0, lastMovePath.length - 1) : undefined
              }
            >
              <span
                className={`checkers-v2-piece ${piece.side} ${piece.kind}${
                  promoted ? ' promoted' : ''
                }`}
              >
                {piece.kind === 'king' ? <KingMark /> : null}
              </span>
            </span>
          );
        })}
        {captureGhosts.map((ghost) => (
          <span
            key={ghost.key}
            className="checkers-v2-piece-slot capture-ghost"
            style={
              {
                ...squarePosition(ghost.piece.square, ghost.orientation),
                '--checkers-capture-delay': `${ghost.delayMs}ms`,
              } as CSSProperties
            }
          >
            <span className={`checkers-v2-piece ${ghost.piece.side} ${ghost.piece.kind}`}>
              {ghost.piece.kind === 'king' ? <KingMark /> : null}
            </span>
          </span>
        ))}
      </div>

      {showCoordinates ? (
        <div className="checkers-board-v2-coordinates" aria-hidden="true">
          {files.map((file, index) => (
            <span
              key={`file-${file}`}
              className="file"
              style={{ left: `${(index + 0.5) * 12.5}%` }}
            >
              {file}
            </span>
          ))}
          {ranks.map((rank, index) => (
            <span key={`rank-${rank}`} className="rank" style={{ top: `${(index + 0.5) * 12.5}%` }}>
              {rank}
            </span>
          ))}
        </div>
      ) : null}

      <div className="checkers-board-v2-interactions">
        {orderedSquares.map((square) => {
          const playable = isPlayableSquare(square);
          const piece = bySquare.get(square);
          const selected = piece?.id === selectedPieceId;
          const destination = destinations.has(square);
          const movable = piece ? movablePieces.has(piece.id) : false;
          const forcedCapture = piece ? forcedPieces.has(piece.id) : false;
          const label = piece
            ? pieceLabel(piece, movable, forcedCapture)
            : `${square}: ${destination ? 'допустимое поле хода' : 'пустое поле'}`;

          return (
            <button
              key={square}
              type="button"
              role="gridcell"
              className={`checkers-v2-cell${playable ? ' playable' : ''}${
                selected ? ' selected' : ''
              }${destination ? ' destination' : ''}${movable ? ' movable' : ''}${
                forcedCapture ? ' forced-capture' : ''
              }`}
              data-square={square}
              data-movable={movable ? 'true' : undefined}
              data-last-move={lastMovePath.includes(square) ? 'true' : undefined}
              aria-label={label}
              aria-selected={selected}
              tabIndex={
                selectedSquare === square || (!selectedSquare && playableSquares[0] === square)
                  ? 0
                  : -1
              }
              disabled={disabled || !playable}
              draggable={!disabled && movable}
              onClick={() => onSquareClick?.(square)}
              onDragStart={(event) => {
                if (!movable || disabled) {
                  event.preventDefault();
                  return;
                }
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', square);
                onSquareClick?.(square);
              }}
              onDragOver={(event) => {
                if (destination && !disabled) event.preventDefault();
              }}
              onDrop={(event) => {
                if (!destination || disabled) return;
                event.preventDefault();
                onSquareClick?.(square);
              }}
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
            />
          );
        })}
      </div>
    </div>
  );
}
