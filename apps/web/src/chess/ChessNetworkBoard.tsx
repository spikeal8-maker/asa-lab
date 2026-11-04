import {
  generateLegalMoves,
  moveToUci,
  parseFen,
  pieceAt,
  type ChessMove,
  type Square,
} from '@asa-lab/chess';
import type { ChessNetworkMatch } from '@asa-lab/contracts';
import { useEffect, useMemo, useState } from 'react';
import { ChessBoard } from './ChessBoard';

export function ChessNetworkBoard({
  match,
  disabled,
  onMove,
}: {
  match: ChessNetworkMatch;
  disabled: boolean;
  onMove(move: string): void;
}) {
  const [selected, setSelected] = useState<Square | null>(null);
  const [promotion, setPromotion] = useState<ChessMove[]>([]);
  useEffect(() => {
    setSelected(null);
    setPromotion([]);
  }, [match.id, match.version]);
  const parsed = useMemo(() => parseFen(match.currentFen), [match.currentFen]);
  const position = parsed.ok ? parsed.value : null;
  const legal = useMemo(() => (position ? generateLegalMoves(position) : []), [position]);
  if (!position) return <p role="alert">Не удалось прочитать позицию партии. Обновите страницу.</p>;
  function play(move: ChessMove) {
    if (!disabled) {
      setPromotion([]);
      onMove(moveToUci(move));
    }
  }
  function choose(from: Square, to: Square) {
    const candidates = legal.filter((move) => move.from === from && move.to === to);
    if (candidates.length > 1) setPromotion(candidates);
    else if (candidates[0]) play(candidates[0]);
    return candidates.length > 0;
  }
  const names = { queen: 'Ферзь', rook: 'Ладья', bishop: 'Слон', knight: 'Конь' };
  return (
    <>
      <ChessBoard
        position={position}
        orientation={match.viewerColor}
        selectedSquare={selected}
        legalMoves={selected ? legal.filter((move) => move.from === selected) : []}
        lastMoveUci={match.moves.at(-1)?.uci}
        disabled={disabled || promotion.length > 0}
        onSquare={(target) => {
          if (!disabled && !(selected && choose(selected, target)))
            setSelected(pieceAt(position, target)?.color === match.viewerColor ? target : null);
        }}
        onMove={(from, to) => {
          if (!disabled) choose(from, to);
        }}
      />
      {promotion.length > 0 && (
        <section
          className="asa-network-promotion"
          role="dialog"
          aria-label="Выберите фигуру для превращения"
        >
          <strong>Превращение пешки</strong>
          {promotion.map((move) => (
            <button
              key={move.promotion}
              type="button"
              disabled={disabled}
              onClick={() => play(move)}
            >
              {names[move.promotion as keyof typeof names]}
            </button>
          ))}
          <button type="button" onClick={() => setPromotion([])}>
            Отмена
          </button>
        </section>
      )}
    </>
  );
}
