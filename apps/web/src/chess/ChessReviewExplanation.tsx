import { explainAsaMoveReview, type AsaMoveReview } from '@asa-lab/chess';

export function ChessReviewExplanation({
  move,
}: {
  readonly move: AsaMoveReview;
}): JSX.Element | null {
  if (!move.bestUci || move.bestUci === move.playedUci) return null;
  const explanation = explainAsaMoveReview(move);
  if (!explanation.ok) return null;

  return (
    <section className="asa-review-explanation" aria-label="Проверенные факты разбора">
      <header>
        <div>
          <span>Почему это важно</span>
          <h2>Только проверяемые факты</h2>
        </div>
        <small>ASA Review explanation v1</small>
      </header>
      <ul>
        {explanation.value.facts.map((fact) => (
          <li key={fact.kind} data-review-fact={fact.kind}>
            {fact.text}
          </li>
        ))}
      </ul>
      <p>
        Здесь нет догадок о стратегии или мотиве: каждый пункт проверен на точной позиции до хода.
      </p>
    </section>
  );
}
