import { useEffect, useState } from 'react';
import { api, type GradebookEntry } from '../api';

export function LegacyLearningReview({
  classroomId,
  item,
  onChanged,
  onClose,
}: {
  classroomId: string;
  item: GradebookEntry;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [context, setContext] = useState<{
    attemptId: string;
    state: string;
    maxPoints: number;
    submission: unknown;
    feedback: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null),
    [points, setPoints] = useState(''),
    [feedback, setFeedback] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void api.legacyLearningReview(classroomId, item.assignmentId, item.seatId).then((r) => {
      if (!active) return;
      if (r.ok) {
        setContext(r.data);
        setFeedback(r.data.feedback ?? '');
      } else setError(r.error.message);
    });
    return () => {
      active = false;
    };
  }, [classroomId, item.assignmentId, item.seatId]);
  async function review(decision: 'accepted' | 'changes_requested') {
    if (!context || busy) return;
    setBusy(true);
    setError(null);
    const r = await api.reviewLearningAttempt(classroomId, context.attemptId, {
      decision,
      points: decision === 'accepted' ? Number(points) : null,
      feedback,
      reason: decision === 'changes_requested' ? feedback : null,
    });
    setBusy(false);
    if (!r.ok) setError(r.error.message);
    else {
      await onChanged();
      onClose();
    }
  }
  return (
    <section className="gradebook-detail" aria-label="Историческая проверка">
      <header>
        <h3>
          {item.displayLabel} · {item.assignmentTitle}
        </h3>
        <button onClick={onClose}>Закрыть проверку</button>
      </header>
      <p>
        Существующая система проверки. Исторические отклики на проекты не превращаются в школьные
        оценки.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {context ? (
        <>
          <details>
            <summary>Сохранённое основание сдачи</summary>
            <pre>{JSON.stringify(context.submission, null, 2)}</pre>
          </details>
          {context.state === 'evaluating' ? (
            <>
              <label>
                Баллы из {context.maxPoints}
                <input
                  type="number"
                  min="0"
                  max={context.maxPoints}
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                />
              </label>
              <label>
                Отзыв
                <input
                  maxLength={8000}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                />
              </label>
              <button
                disabled={busy || !feedback.trim()}
                onClick={() => void review('changes_requested')}
              >
                Вернуть
              </button>
              <button
                disabled={
                  busy ||
                  points === '' ||
                  !Number.isInteger(Number(points)) ||
                  Number(points) < 0 ||
                  Number(points) > context.maxPoints
                }
                onClick={() => void review('accepted')}
              >
                Принять и оценить
              </button>
            </>
          ) : (
            <p>{context.feedback ?? 'Сейчас нет работы, ожидающей ручной проверки.'}</p>
          )}
        </>
      ) : null}
    </section>
  );
}
