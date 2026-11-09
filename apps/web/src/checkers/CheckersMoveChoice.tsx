import type { CheckersSquare } from '@asa-lab/checkers';
import './checkers-parity.css';

export function CheckersMoveChoice<T extends { path: readonly CheckersSquare[] }>({
  moves,
  disabled,
  onChoose,
  onCancel,
}: {
  moves: readonly T[];
  disabled: boolean;
  onChoose(move: T): void;
  onCancel(): void;
}) {
  return (
    <section className="checkers-route-choice" role="dialog" aria-label="Выберите путь взятия">
      <strong>К этому полю ведут разные серии. Выберите путь:</strong>
      <div>
        {moves.map((move) => (
          <button
            type="button"
            key={move.path.join('-')}
            disabled={disabled}
            onClick={() => onChoose(move)}
          >
            {move.path.join(' × ')}
          </button>
        ))}
      </div>
      <button type="button" onClick={onCancel}>
        Отмена
      </button>
    </section>
  );
}
