import { useEffect, useState } from 'react';
import { api, type LearnerResult } from '../api';
import { useSchoolTime } from './school-time';
import './seat-results.css';

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
              </small>
            </span>
            <span className="seat-result-score">
              <b>{item.displayGrade}</b>
              <small>
                {item.points}/{item.maxPoints} · {item.percentage}%
              </small>
            </span>
            {item.feedback ? <p>{item.feedback}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
