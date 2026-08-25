import { useEffect, useState } from 'react';
import { api, type LearnerResult } from '../api';
import { useSchoolTime } from './school-time';
import './seat-results.css';
import { canonicalLearningLabel } from '../learning/canonical-learning-presentation';

export function SeatResults(): JSX.Element | null {
  const [items, setItems] = useState<LearnerResult[] | null>(null);
  const time = useSchoolTime();
  useEffect(() => {
    void api.seatResults().then((result) => setItems(result.ok ? result.data.items : []));
  }, []);
  if (!items?.length) return null;
  return (
    <section className="seat-results" aria-labelledby="seat-results-title">
      <div>
        <h2 id="seat-results-title">Мои результаты</h2>
        <span>{items.length}</span>
      </div>
      <ul>
        {items.map((item) => (
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
