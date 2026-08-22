import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type GradebookEntry } from '../api';
import './classroom-gradebook.css';

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: GradebookEntry[]; scheme: { title: string } | null };

const STATE_LABELS: Record<GradebookEntry['state'], string> = {
  not_started: 'Не начинал',
  in_progress: 'В работе',
  submitted: 'Сдано',
  evaluating: 'Ждёт проверки',
  accepted: 'Проверено',
  changes_requested: 'На доработке',
  incomplete: 'Не завершено',
  excused: 'Освобождён',
  invalidated: 'Аннулировано',
};

function ReviewForm({
  busy,
  onReview,
}: {
  busy: boolean;
  onReview: (
    decision: 'accepted' | 'changes_requested',
    points: number | null,
    feedback: string,
  ) => Promise<void>;
}) {
  const [points, setPoints] = useState('');
  const [feedback, setFeedback] = useState('');
  const numericPoints = points === '' ? null : Number(points);
  return (
    <div className="gradebook-review">
      <label>
        <span>Баллы из 100</span>
        <input
          type="number"
          min="0"
          max="100"
          step="1"
          inputMode="numeric"
          value={points}
          disabled={busy}
          onChange={(event) => setPoints(event.target.value)}
        />
      </label>
      <label className="gradebook-review-feedback">
        <span>Короткий отзыв</span>
        <input
          maxLength={8000}
          value={feedback}
          disabled={busy}
          placeholder="Что получилось и что улучшить"
          onChange={(event) => setFeedback(event.target.value)}
        />
      </label>
      <div className="gradebook-review-actions">
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => void onReview('changes_requested', null, feedback)}
        >
          Вернуть
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={
            busy || numericPoints === null || !Number.isInteger(numericPoints) || numericPoints < 0
          }
          onClick={() => void onReview('accepted', numericPoints, feedback)}
        >
          Принять и оценить
        </button>
      </div>
    </div>
  );
}

export function ClassroomGradebook({ classroomId }: { classroomId: string }): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busyAttempt, setBusyAttempt] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const result = await api.classroomGradebook(classroomId);
    setState(
      result.ok
        ? { kind: 'ready', items: result.data.items, scheme: result.data.scheme }
        : { kind: 'error', message: result.error.message || 'Не удалось открыть журнал.' },
    );
  }, [classroomId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const awaiting = useMemo(
    () =>
      state.kind === 'ready' ? state.items.filter((item) => item.state === 'evaluating').length : 0,
    [state],
  );

  if (state.kind === 'loading') return <p className="gradebook-state">Загружаем журнал…</p>;
  if (state.kind === 'error') {
    return (
      <div className="gradebook-state" role="alert">
        <p>{state.message}</p>
        <button type="button" className="btn-secondary" onClick={() => void reload()}>
          Повторить
        </button>
      </div>
    );
  }

  return (
    <section className="classroom-tab-panel gradebook-panel">
      <div className="gradebook-heading">
        <div>
          <h2>Журнал работ</h2>
          <p>Попытки, проверка и итоговый балл читаются из одной истории.</p>
        </div>
        <span className={awaiting > 0 ? 'needs-review' : undefined}>
          {awaiting > 0 ? `Ждут проверки: ${awaiting}` : 'Всё проверено'}
        </span>
      </div>
      <div className="gradebook-scale">
        <span>Шкала: {state.scheme?.title ?? 'зачёт / незачёт'}</span>
        <button
          type="button"
          className="btn-secondary"
          onClick={async () => {
            const result = await api.publishGradingScheme(classroomId, 'Пятибалльная', [
              { minBasisPoints: 0, label: '2' },
              { minBasisPoints: 5000, label: '3' },
              { minBasisPoints: 7000, label: '4' },
              { minBasisPoints: 8500, label: '5' },
            ]);
            if (result.ok) await reload();
          }}
        >
          Пятибалльная
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={async () => {
            const result = await api.publishGradingScheme(classroomId, 'Зачётная', [
              { minBasisPoints: 0, label: 'Не зачтено' },
              { minBasisPoints: 6000, label: 'Зачёт' },
            ]);
            if (result.ok) await reload();
          }}
        >
          Зачётная
        </button>
      </div>
      {state.items.length === 0 ? (
        <div className="gradebook-empty">
          <strong>В журнале пока нет строк</strong>
          <span>Они появятся после назначения задания и добавления учеников.</span>
        </div>
      ) : (
        <div className="gradebook-table" role="table" aria-label="Журнал работ класса">
          <div className="gradebook-row gradebook-header" role="row">
            <span role="columnheader">Ученик</span>
            <span role="columnheader">Работа</span>
            <span role="columnheader">Состояние</span>
            <span role="columnheader">Результат</span>
          </div>
          {state.items.map((item) => (
            <div className="gradebook-row" role="row" key={`${item.assignmentId}:${item.seatId}`}>
              <strong role="cell">{item.displayLabel}</strong>
              <span role="cell">
                {item.assignmentTitle}
                {item.attemptNumber ? <small>Попытка {item.attemptNumber}</small> : null}
              </span>
              <span role="cell">
                <em data-state={item.state}>{STATE_LABELS[item.state]}</em>
              </span>
              <div role="cell" className="gradebook-result">
                {item.state === 'evaluating' && item.attemptId ? (
                  <ReviewForm
                    busy={busyAttempt === item.attemptId}
                    onReview={async (decision, points, feedback) => {
                      if (!item.attemptId) return;
                      setBusyAttempt(item.attemptId);
                      const result = await api.reviewLearningAttempt(classroomId, item.attemptId, {
                        decision,
                        points,
                        feedback: feedback.trim() || null,
                      });
                      setBusyAttempt(null);
                      if (!result.ok) {
                        setState({ kind: 'error', message: result.error.message });
                        return;
                      }
                      await reload();
                    }}
                  />
                ) : item.points !== null && item.maxPoints !== null ? (
                  <span className="gradebook-score">
                    {item.displayGrade ? <b>{item.displayGrade}</b> : null}
                    <strong>{item.points}</strong>/{item.maxPoints}
                    {item.percentage !== null ? <small>{item.percentage}%</small> : null}
                  </span>
                ) : (
                  <span className="gradebook-no-score">—</span>
                )}
                {item.feedback ? (
                  <small className="gradebook-feedback">{item.feedback}</small>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
