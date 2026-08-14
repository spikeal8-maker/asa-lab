import type { AsaMoveReview } from '@asa-lab/chess';
import { evaluationLabel } from './chess-ui';

export function reviewEvaluationPercent(scoreCp: number): number {
  if (!Number.isFinite(scoreCp)) return scoreCp > 0 ? 96 : scoreCp < 0 ? 4 : 50;
  return Math.min(96, Math.max(4, 50 + Math.tanh(scoreCp / 600) * 46));
}

function horizontalPercent(index: number, total: number): number {
  if (total <= 1) return 50;
  return (index / (total - 1)) * 100;
}

export function ChessReviewTimeline({
  moves,
  selectedPly,
  onSelect,
}: {
  readonly moves: readonly AsaMoveReview[];
  readonly selectedPly: number | null;
  readonly onSelect: (ply: number) => void;
}): JSX.Element | null {
  if (moves.length === 0) return null;
  const points = moves
    .map((move, index) => {
      const x = horizontalPercent(index, moves.length);
      const y = 100 - reviewEvaluationPercent(move.evaluationAfterCp);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <section className="asa-review-timeline" aria-label="График оценки по полуходам">
      <header>
        <strong>Оценка позиции</strong>
        <small>Выберите точку, чтобы открыть позицию после хода</small>
      </header>
      <div className="asa-review-timeline-track">
        <span className="asa-review-timeline-midline" aria-hidden="true" />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline points={points} />
        </svg>
        {moves.map((move, index) => (
          <button
            key={move.ply}
            type="button"
            className="asa-review-timeline-point"
            data-review-timeline-point={move.ply}
            aria-label={`Полуход ${move.ply}: ${move.playedSan}, оценка ${evaluationLabel(move.evaluationAfterCp)}`}
            aria-pressed={selectedPly === move.ply}
            style={{
              left: `${horizontalPercent(index, moves.length)}%`,
              bottom: `${reviewEvaluationPercent(move.evaluationAfterCp)}%`,
            }}
            onClick={() => onSelect(move.ply)}
          />
        ))}
      </div>
    </section>
  );
}
