import { useEffect, useState } from 'react';
import { api, type LearnerResult } from '../api';
import { useSchoolTime } from './school-time';
import './seat-results.css';
import { canonicalLearningLabel } from '../learning/canonical-learning-presentation';

export function SeatResults({
  completedOnly = false,
}: {
  readonly completedOnly?: boolean;
}): JSX.Element {
  const [items, setItems] = useState<LearnerResult[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const time = useSchoolTime();
  useEffect(() => {
    let active = true;
    setFailed(false);
    void api
      .seatResults()
      .then((result) => {
        if (!active) return;
        if (result.ok) setItems(result.data.items);
        else setFailed(true);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [reload]);
  if (failed)
    return (
      <p role="alert">
        Не удалось загрузить результаты.{' '}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setReload((value) => value + 1)}
        >
          Повторить
        </button>
      </p>
    );
  if (!items) return <p role="status">Загружаем результаты…</p>;
  const visibleItems = items.filter(
    (item) => !completedOnly || item.canonicalState?.workflowState === 'completed',
  );
  if (!visibleItems.length)
    return (
      <p>
        {completedOnly ? 'Завершённых заданий пока нет.' : 'Опубликованных результатов пока нет.'}
      </p>
    );
  return (
    <section className="seat-results" aria-labelledby="seat-results-title">
      <div>
        <h2 id="seat-results-title">Мои результаты</h2>
        <span>{visibleItems.length}</span>
      </div>
      <ul>
        {visibleItems.map((item) => (
          <li key={item.assignmentId}>
            <span>
              <strong>{item.assignmentTitle}</strong>
              <small>
                {time.date(item.publishedAt)} · попытка {item.attemptNumber}
                {item.canonicalState ? ` · ${canonicalLearningLabel(item.canonicalState)}` : ''}
              </small>
            </span>
            <span className="seat-result-score">
              <b>{item.canonicalState?.selectedResult?.displayGrade ?? item.displayGrade}</b>
              {item.canonicalState?.selectedResult ? (
                item.canonicalState.selectedResult.rawPoints !== null &&
                item.canonicalState.selectedResult.maxPoints !== null ? (
                  <small>
                    {item.canonicalState.selectedResult.rawPoints}/
                    {item.canonicalState.selectedResult.maxPoints}
                    {item.canonicalState.selectedResult.percentageBasisPoints !== null
                      ? ` · ${item.canonicalState.selectedResult.percentageBasisPoints / 100}%`
                      : ''}
                  </small>
                ) : null
              ) : (
                <small>
                  {item.points}/{item.maxPoints} · {item.percentage}%
                </small>
              )}
            </span>
            {item.feedback ? <p>{item.feedback}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
