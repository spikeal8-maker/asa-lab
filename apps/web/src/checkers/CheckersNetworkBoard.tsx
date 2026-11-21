import { CheckersMoveChoice } from './CheckersMoveChoice';
import {
  generateLegalCheckersMoves,
  validateCheckersDocument,
  type CheckersLegalMove,
} from '@asa-lab/checkers';
import type { CheckersNetworkMatch } from '@asa-lab/contracts';
import { useEffect, useMemo, useState } from 'react';
import { CheckersBoardV2 } from './CheckersBoardV2';
import type { CheckersBoardSquare } from './CheckersBoard';
import './checkers.css';
import './checkers-parity.css';

export function CheckersNetworkBoard({
  match,
  disabled,
  onMove,
}: {
  match: CheckersNetworkMatch;
  disabled: boolean;
  onMove(path: readonly string[]): void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [choices, setChoices] = useState<CheckersLegalMove[]>([]);
  useEffect(() => {
    setSelected(null);
    setChoices([]);
  }, [match.id, match.version]);
  const parsed = useMemo(() => validateCheckersDocument(match.position), [match.position]);
  const document = parsed.ok ? parsed.value : null;
  const legal = useMemo(() => (document ? generateLegalCheckersMoves(document) : []), [document]);
  if (!document) return <p role="alert">Не удалось прочитать позицию партии. Обновите страницу.</p>;
  const selectedMoves = legal.filter((move) => move.pieceId === selected);
  function play(move: CheckersLegalMove) {
    if (!disabled) {
      onMove(move.path);
      setChoices([]);
    }
  }
  function square(target: CheckersBoardSquare) {
    if (disabled) return;
    const routes = selectedMoves.filter((move) => move.path.at(-1) === target);
    if (routes.length > 1) {
      setChoices(routes);
      return;
    }
    if (routes[0]) {
      play(routes[0]);
      return;
    }
    const piece = document!.pieces.find(
      (piece) => piece.square === target && legal.some((move) => move.pieceId === piece.id),
    );
    setSelected(piece?.id ?? null);
    setChoices([]);
  }
  const last = document.moveHistory.at(-1);
  return (
    <div className="checkers-network-board">
      <CheckersBoardV2
        pieces={document.pieces}
        orientation={match.viewerColor === 'white' ? 'light' : 'dark'}
        selectedPieceId={selected}
        movablePieceIds={legal.map((move) => move.pieceId)}
        legalDestinations={selectedMoves.map((move) => move.path.at(-1)!)}
        captureDestinations={selectedMoves
          .filter((move) => move.isCapture)
          .map((move) => move.path.at(-1)!)}
        capturePaths={selectedMoves.filter((move) => move.isCapture).map((move) => move.path)}
        forcedCapturePieceIds={legal.filter((move) => move.isCapture).map((move) => move.pieceId)}
        lastMovePath={last?.path ?? []}
        lastMoveCapturedIds={last?.capturedIds ?? []}
        disabled={disabled || choices.length > 0}
        onSquareClick={square}
      />
      {!disabled && (
        <p className="checkers-network-hint">
          {legal.some((move) => move.isCapture)
            ? 'Взятие обязательно. Выберите шашку и конечное поле всей серии.'
            : 'Выберите шашку и поле хода.'}
        </p>
      )}
      {choices.length > 0 && (
        <CheckersMoveChoice
          moves={choices}
          disabled={disabled}
          onChoose={play}
          onCancel={() => setChoices([])}
        />
      )}
    </div>
  );
}
