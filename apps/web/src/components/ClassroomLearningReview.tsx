import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type GradebookEntry, type LearningReviewContext } from '../api';
import { ProjectPreviewFigure } from '../modules/ProjectPreviewFigure';
import { LearningConditions } from './LearningConditions';
import { useLearningDestination } from '../learning/use-learning-destination';
import type { ModulePreviewDescriptor } from '@asa-lab/module-sdk';
const LABELS: Record<string, string> = {
  not_applicable: 'Не назначено',
  not_started: 'Не начато',
  in_progress: 'В работе',
  submitted: 'Ждёт проверки',
  evaluating: 'Ждёт проверки',
  waiting_review: 'Ждёт проверки',
  accepted: 'Принято',
  changes_requested: 'На доработке',
  incomplete: 'Не завершено',
  excused: 'Освобождён',
  invalidated: 'Аннулировано',
  completed: 'Проверено',
};
const POLICIES: Record<string, string> = {
  first: 'первая завершённая',
  latest: 'последняя завершённая',
  best: 'лучший результат',
  latest_accepted: 'последняя принятая',
  teacher_selected: 'выбор преподавателя',
};
type Frozen = {
  submissionId: string;
  projectVersionId: string;
  sourceRevision: number | null;
  digest: string;
  moduleKey: string;
  document: unknown;
  preview: ModulePreviewDescriptor | null;
};

export function ClassroomLearningReview({
  classroomId,
  item,
  onChanged,
  onClose,
  exactRunId,
  initialAttemptId,
  onNavigationBlocked,
}: {
  classroomId: string;
  item: Pick<GradebookEntry, 'seatId' | 'assignmentId' | 'displayLabel' | 'assignmentTitle'>;
  exactRunId?: string;
  initialAttemptId?: string | null;
  onNavigationBlocked?: (blocked: boolean) => void;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [context, setContext] = useState<LearningReviewContext | null>(null);
  const destination = useLearningDestination();
  const [attemptId, setAttemptId] = useState<string | null>(
    exactRunId
      ? (initialAttemptId ?? null)
      : destination.assignment === item.assignmentId && destination.seat === item.seatId
        ? destination.attempt
        : null,
  );
  const [frozen, setFrozen] = useState<Frozen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [points, setPoints] = useState('');
  const [feedback, setFeedback] = useState('');
  const [reason, setReason] = useState('');
  const request = useRef<{ payload: string; id: string } | null>(null);
  const contextRequest = useRef(0);
  const load = useCallback(async () => {
    const token = ++contextRequest.current;
    const result = await api.learningReviewContext(
      classroomId,
      item.assignmentId,
      item.seatId,
      exactRunId,
    );
    if (contextRequest.current !== token) return false;
    if (!result.ok) {
      setError(result.error.message);
      return false;
    }
    if (exactRunId && result.data.activityRunId !== exactRunId) {
      setError('Контекст практики изменился. Обновите очередь.');
      return false;
    }
    setError(null);
    setContext(result.data);
    setAttemptId(
      (current) =>
        current ??
        (exactRunId ? (initialAttemptId ?? null) : (result.data.attempts[0]?.id ?? null)),
    );
    return true;
  }, [classroomId, item.assignmentId, item.seatId, exactRunId, initialAttemptId]);
  useEffect(() => {
    void load();
    return () => {
      contextRequest.current++;
    };
  }, [load]);
  const attempt = context?.attempts.find((entry) => entry.id === attemptId);
  const latest = attempt?.results[0] ?? null;
  const dirty =
    feedback !== (latest?.feedback ?? '') ||
    points !== (latest?.points == null ? '' : String(latest.points)) ||
    !!reason.trim();
  useEffect(() => {
    onNavigationBlocked?.(busy || uncertain || dirty);
  }, [busy, uncertain, dirty, onNavigationBlocked]);
  useEffect(() => {
    if (!exactRunId || (!dirty && !busy && !uncertain)) return;
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [exactRunId, dirty, busy, uncertain]);
  useEffect(() => {
    setFrozen(null);
    setError(null);
    setFeedback(latest?.feedback ?? '');
    setPoints(latest?.points == null ? '' : String(latest.points));
    setReason('');
    if (!attempt?.submissionId || !attemptId) return;
    let active = true;
    void api.exactLearningSubmission(classroomId, attemptId).then((result) => {
      if (!active) return;
      if (
        result.ok &&
        exactRunId &&
        (result.data.submissionId !== attempt.submissionId ||
          result.data.projectVersionId !== attempt.projectVersionId)
      ) {
        setError('Снимок не совпадает с выбранной сдачей. Обновите историю.');
      } else if (result.ok) setFrozen(result.data);
      else setError(result.error.message);
    });
    return () => {
      active = false;
    };
  }, [
    classroomId,
    attemptId,
    attempt?.submissionId,
    attempt?.projectVersionId,
    latest?.id,
    latest?.feedback,
    latest?.points,
    exactRunId,
  ]);
  async function review(decision: 'accepted' | 'changes_requested' | 'incomplete' | 'excused') {
    if (!attempt || !context || !frozen || busy) return;
    const input = {
      decision,
      points: decision === 'accepted' && context.resultMode === 'graded' ? Number(points) : null,
      feedback: feedback.trim() || null,
      reason: reason.trim() || null,
      expectedResultId: latest?.id ?? null,
    };
    const payload = JSON.stringify({ attemptId: attempt.id, ...input });
    if (uncertain && request.current?.payload !== payload) return;
    if (request.current?.payload !== payload)
      request.current = { payload, id: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    const result = await api.reviewLearningAttempt(classroomId, attempt.id, {
      ...input,
      requestId: request.current.id,
    });
    if (!result.ok) {
      setBusy(false);
      setUncertain(true);
      setError(result.error.message);
      return;
    }
    setUncertain(false);
    setReason('');
    await load();
    await onChanged();
    setBusy(false);
  }
  const terminal =
    attempt?.state === 'closed' && latest !== null && latest.decision !== 'changes_requested';
  const canReview = attempt && (['submitted', 'evaluating'].includes(attempt.state) || terminal);
  const numeric = Number(points);
  return (
    <section className="gradebook-detail" aria-label="Проверка сдачи">
      <header>
        <div>
          <h3>
            {item.displayLabel} · {item.assignmentTitle}
          </h3>
          <p>Официальная проверка точной сдачи. Значки проекта не являются оценками.</p>
        </div>
        <button
          className="btn-secondary"
          disabled={busy || (exactRunId !== undefined && (dirty || uncertain))}
          onClick={onClose}
        >
          Закрыть проверку
        </button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {error && exactRunId ? (
        <button
          className="btn-secondary"
          disabled={busy}
          onClick={async () => {
            if (
              (dirty || uncertain) &&
              !window.confirm('Обновить историю и проверить последнее решение сервера?')
            )
              return;
            if (await load()) {
              setUncertain(false);
              request.current = null;
            }
          }}
        >
          Обновить историю проверки
        </button>
      ) : null}
      {uncertain ? (
        <p role="status">
          Ответ проверки не подтверждён. Повторите ту же команду или обновите страницу; очередь не
          переключается автоматически.
        </p>
      ) : null}
      {!context && !error ? <p>Загружаем историю…</p> : null}
      {context ? (
        <>
          <p>{context.instructions}</p>
          {!exactRunId ? (
            <>
              <LearningConditions
                classroomId={classroomId}
                assignmentId={item.assignmentId}
                onChanged={() => void onChanged()}
              />
              <LearningConditions
                classroomId={classroomId}
                assignmentId={item.assignmentId}
                seatId={item.seatId}
                onChanged={() => void onChanged()}
              />
            </>
          ) : null}
          <p>
            {context.resultMode === 'graded'
              ? `Баллы: максимум ${context.maxPoints}`
              : context.resultMode === 'completion'
                ? 'Выполнение без баллов'
                : 'Без числовой оценки'}{' '}
            · Выбор результата: {POLICIES[context.selectionPolicy] ?? context.selectionPolicy}
          </p>
          {context.resultMode === 'graded' ? (
            <p>
              {context.gradingScheme
                ? `Шкала «${context.gradingScheme.title}», версия ${context.gradingScheme.version}, закреплена при назначении.`
                : 'Шкала не задана: в журнале будут исходные баллы, без скрытого перевода в оценки.'}
            </p>
          ) : null}
          <label>
            Попытка{' '}
            <select
              aria-label="Попытка"
              value={attemptId ?? ''}
              disabled={busy || (exactRunId !== undefined && (dirty || uncertain))}
              onChange={(event) => setAttemptId(event.target.value)}
            >
              {exactRunId ? <option value="">Выберите сохранённую попытку</option> : null}
              {context.attempts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.number} · {LABELS[a.state] ?? a.state}
                  {a.revisionOfAttemptId ? ' · доработка' : ''}
                </option>
              ))}
            </select>
          </label>
          {!attempt ? (
            <p>
              {attemptId
                ? 'Выбранная попытка недоступна. Обновите историю проверки.'
                : 'Ученик ещё не начал работу.'}
            </p>
          ) : null}
          {attempt && !attempt.submissionId ? (
            <p>Попытка в работе. Оценивать несданный черновик нельзя.</p>
          ) : null}
          {frozen ? (
            <div className="gradebook-exact">
              <p>
                <strong>Сданная версия</strong> · ревизия сохранения{' '}
                {frozen.sourceRevision ?? 'не записана в legacy'} · попытка {attempt?.number}
              </p>
              <code data-testid="submission-version-id">{frozen.projectVersionId}</code>
              {frozen.preview?.figure ? (
                <ProjectPreviewFigure
                  figure={frozen.preview.figure}
                  label="Точный снимок сданной работы"
                />
              ) : (
                <p>Визуальный предпросмотр для этого снимка недоступен.</p>
              )}
              <details>
                <summary>Содержимое и контрольная сумма сдачи</summary>
                <p>{frozen.digest}</p>
                <pre>{JSON.stringify(frozen.document, null, 2)}</pre>
              </details>
            </div>
          ) : null}
          {canReview && frozen ? (
            <div className="gradebook-review">
              {context.resultMode === 'graded' ? (
                <label>
                  Баллы из {context.maxPoints}
                  <input
                    aria-label={`Баллы из ${context.maxPoints}`}
                    type="number"
                    min="0"
                    max={context.maxPoints ?? undefined}
                    step="1"
                    value={points}
                    onChange={(e) => setPoints(e.target.value)}
                    disabled={busy || uncertain}
                  />
                </label>
              ) : null}
              <label>
                Отзыв
                <textarea
                  aria-label="Отзыв"
                  maxLength={8000}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  disabled={busy || uncertain}
                />
              </label>
              <label>
                Причина возврата или исправления
                <input
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={busy || uncertain}
                />
              </label>
              <div className="gradebook-review-actions">
                {!latest ||
                (latest.decision === 'accepted' && context.attempts[0]?.id === attempt.id) ? (
                  <button
                    className="btn-secondary"
                    disabled={
                      busy ||
                      !reason.trim() ||
                      (uncertain &&
                        !request.current?.payload.includes('"decision":"changes_requested"'))
                    }
                    onClick={() => void review('changes_requested')}
                  >
                    Вернуть на доработку
                  </button>
                ) : null}
                <button
                  className="btn-primary"
                  disabled={
                    busy ||
                    (uncertain && !request.current?.payload.includes('"decision":"accepted"')) ||
                    (!!latest && !reason.trim()) ||
                    (context.resultMode === 'graded' &&
                      (points === '' ||
                        !Number.isInteger(numeric) ||
                        numeric < 0 ||
                        numeric > (context.maxPoints ?? 0)))
                  }
                  onClick={() => void review('accepted')}
                >
                  {latest
                    ? 'Исправить результат'
                    : context.resultMode === 'graded'
                      ? 'Принять и оценить'
                      : 'Принять выполнение'}
                </button>
              </div>
            </div>
          ) : null}
          {attempt && terminal && context.selectionPolicy === 'teacher_selected' ? (
            <button
              className="btn-secondary"
              disabled={
                busy ||
                !reason.trim() ||
                (uncertain && !request.current?.payload.includes('"selection":'))
              }
              onClick={async () => {
                const input = {
                  attemptId: attempt.id,
                  expectedAttemptId: context.teacherSelectedAttemptId,
                  reason: reason.trim(),
                };
                const payload = JSON.stringify({ selection: context.participationId, ...input });
                if (uncertain && request.current?.payload !== payload) return;
                if (request.current?.payload !== payload)
                  request.current = { payload, id: crypto.randomUUID() };
                setBusy(true);
                setError(null);
                const result = await api.selectLearningAttempt(
                  classroomId,
                  context.participationId,
                  {
                    ...input,
                    requestId: request.current.id,
                  },
                );
                if (!result.ok) {
                  setUncertain(true);
                  setError(result.error.message);
                } else {
                  setUncertain(false);
                  setReason('');
                  await load();
                  await onChanged();
                }
                setBusy(false);
              }}
            >
              Выбрать эту попытку для журнала
            </button>
          ) : null}
          {attempt?.results.length ? (
            <details open>
              <summary>История официальных решений</summary>
              <ol>
                {attempt.results.map((r) => (
                  <li key={r.id}>
                    <strong>
                      Ревизия {r.revision} · {LABELS[r.decision ?? ''] ?? r.decision}
                    </strong>
                    {r.points !== null ? (
                      <span>
                        {' '}
                        · {r.points}/{r.maxPoints}
                      </span>
                    ) : null}
                    <p>{r.feedback}</p>
                    <small>
                      {r.reason} · {new Date(r.publishedAt).toLocaleString()}
                    </small>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
