import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type GradebookEntry, type LearningReviewContext } from '../api';
import { ProjectPreviewFigure } from '../modules/ProjectPreviewFigure';
import { LearningConditions } from './LearningConditions';
import { ClassroomGradingScheme } from './ClassroomGradingScheme';
import { LegacyLearningReview } from './LegacyLearningReview';
import { useLearningDestination } from '../learning/use-learning-destination';
import type { ModulePreviewDescriptor } from '@asa-lab/module-sdk';
import './classroom-gradebook.css';

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
function score(item: GradebookEntry) {
  if (item.displayGrade) return item.displayGrade;
  if (item.points !== null && item.maxPoints !== null) return `${item.points}/${item.maxPoints}`;
  if (item.canonicalState?.selectedResult?.completionValue === true) return 'Выполнено';
  return null;
}
type Frozen = {
  submissionId: string;
  projectVersionId: string;
  sourceRevision: number | null;
  digest: string;
  moduleKey: string;
  document: unknown;
  preview: ModulePreviewDescriptor | null;
};

function ReviewDetail({
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
  const [context, setContext] = useState<LearningReviewContext | null>(null);
  const destination = useLearningDestination();
  const [attemptId, setAttemptId] = useState<string | null>(
    destination.assignment === item.assignmentId && destination.seat === item.seatId
      ? destination.attempt
      : null,
  );
  const [frozen, setFrozen] = useState<Frozen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [points, setPoints] = useState('');
  const [feedback, setFeedback] = useState('');
  const [reason, setReason] = useState('');
  const request = useRef<{ payload: string; id: string } | null>(null);
  const load = useCallback(async () => {
    const result = await api.learningReviewContext(classroomId, item.assignmentId, item.seatId);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setContext(result.data);
    setAttemptId((current) => current ?? result.data.attempts[0]?.id ?? null);
  }, [classroomId, item.assignmentId, item.seatId]);
  useEffect(() => {
    void load();
  }, [load]);
  const attempt = context?.attempts.find((entry) => entry.id === attemptId);
  const latest = attempt?.results[0] ?? null;
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
      if (result.ok) setFrozen(result.data);
      else setError(result.error.message);
    });
    return () => {
      active = false;
    };
  }, [classroomId, attemptId, attempt?.submissionId, latest?.id, latest?.feedback, latest?.points]);
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
    if (request.current?.payload !== payload)
      request.current = { payload, id: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    const result = await api.reviewLearningAttempt(classroomId, attempt.id, {
      ...input,
      requestId: request.current.id,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    await load();
    await onChanged();
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
        <button className="btn-secondary" onClick={onClose}>
          Закрыть проверку
        </button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {!context && !error ? <p>Загружаем историю…</p> : null}
      {context ? (
        <>
          <p>{context.instructions}</p>
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
            <select value={attemptId ?? ''} onChange={(event) => setAttemptId(event.target.value)}>
              {context.attempts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.number} · {LABELS[a.state] ?? a.state}
                  {a.revisionOfAttemptId ? ' · доработка' : ''}
                </option>
              ))}
            </select>
          </label>
          {!attempt ? <p>Ученик ещё не начал работу.</p> : null}
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
                    disabled={busy}
                  />
                </label>
              ) : null}
              <label>
                Отзыв
                <textarea
                  maxLength={8000}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label>
                Причина возврата или исправления
                <input
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={busy}
                />
              </label>
              <div className="gradebook-review-actions">
                {!latest ? (
                  <button
                    className="btn-secondary"
                    disabled={busy || !reason.trim()}
                    onClick={() => void review('changes_requested')}
                  >
                    Вернуть на доработку
                  </button>
                ) : null}
                <button
                  className="btn-primary"
                  disabled={
                    busy ||
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
              disabled={busy || !reason.trim()}
              onClick={async () => {
                setBusy(true);
                const result = await api.selectLearningAttempt(
                  classroomId,
                  context.participationId,
                  {
                    attemptId: attempt.id,
                    expectedAttemptId: context.teacherSelectedAttemptId,
                    reason: reason.trim(),
                    requestId: crypto.randomUUID(),
                  },
                );
                setBusy(false);
                if (!result.ok) setError(result.error.message);
                else {
                  await load();
                  await onChanged();
                }
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

export function ClassroomGradebook({ classroomId }: { classroomId: string }): JSX.Element {
  const [items, setItems] = useState<GradebookEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<GradebookEntry | null>(null);
  const [detailEpoch, setDetailEpoch] = useState(0);
  const [search, setSearch] = useState('');
  const [course, setCourse] = useState('');
  const destination = useLearningDestination();
  const openedDestination = useRef('');
  useEffect(() => {
    const key = `${destination.assignment}:${destination.seat}:${destination.attempt}`;
    if (openedDestination.current === key || !destination.assignment || !items) return;
    const match = items.find(
      (item) => item.assignmentId === destination.assignment && item.seatId === destination.seat,
    );
    if (match) {
      setOpened(match);
      setDetailEpoch((value) => value + 1);
      openedDestination.current = key;
    }
  }, [items, destination.assignment, destination.seat, destination.attempt]);
  const reload = useCallback(async () => {
    const result = await api.classroomGradebook(classroomId);
    if (result.ok) {
      setItems(result.data.items);
      setError(null);
    } else setError(result.error.message);
  }, [classroomId]);
  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 15000);
    const focus = () => void reload();
    window.addEventListener('focus', focus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [reload]);
  const courses = useMemo(
    () => [
      ...new Map(
        (items ?? [])
          .filter((item) => item.courseRunId)
          .map((item) => [item.courseRunId!, item.courseTitle ?? 'Курс']),
      ).entries(),
    ],
    [items],
  );
  const columns = useMemo(
    () => [
      ...new Map(
        (items ?? [])
          .filter(
            (item) =>
              !course || (course === 'direct' ? !item.courseRunId : item.courseRunId === course),
          )
          .map((item) => [item.assignmentId, item.assignmentTitle]),
      ).entries(),
    ],
    [items, course],
  );
  const rows = useMemo(
    () =>
      [...new Map((items ?? []).map((item) => [item.seatId, item.displayLabel])).entries()].filter(
        ([, label]) => label.toLowerCase().includes(search.toLowerCase()),
      ),
    [items, search],
  );
  const cells = useMemo(
    () => new Map((items ?? []).map((item) => [`${item.seatId}:${item.assignmentId}`, item])),
    [items],
  );
  const awaiting = (items ?? []).filter((item) =>
    ['submitted', 'waiting_review', 'evaluating'].includes(item.state),
  ).length;
  return (
    <section className="classroom-tab-panel gradebook-panel">
      <header className="gradebook-heading">
        <div>
          <h2>Журнал</h2>
          <p>Строки — ученики, столбцы — назначенные работы.</p>
        </div>
        <span>Ждут проверки: {awaiting}</span>
      </header>
      <ClassroomGradingScheme classroomId={classroomId} />
      {error ? (
        <p role="alert">
          {error}
          <button onClick={() => void reload()}>Повторить</button>
        </p>
      ) : null}
      <label>
        Найти ученика{' '}
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <label>
        Курс в журнале{' '}
        <select value={course} onChange={(e) => setCourse(e.target.value)}>
          <option value="">Все работы</option>
          <option value="direct">Отдельные задания</option>
          {courses.map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
      </label>
      {!items ? (
        <p>Загружаем журнал…</p>
      ) : !items.length ? (
        <p>Добавьте учеников и назначьте работу.</p>
      ) : (
        <div
          className="gradebook-matrix-scroll"
          tabIndex={0}
          role="region"
          aria-label="Прокрутка журнала"
        >
          <table className="gradebook-matrix">
            <caption>Журнал работ класса</caption>
            <thead>
              <tr>
                <th scope="col">Ученик</th>
                {columns.map(([id, title]) => (
                  <th scope="col" key={id}>
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([seat, label]) => (
                <tr key={seat}>
                  <th scope="row">{label}</th>
                  {columns.map(([assignment, title]) => {
                    const item = cells.get(`${seat}:${assignment}`);
                    return (
                      <td key={assignment}>
                        {item ? (
                          <button
                            className="gradebook-cell"
                            aria-label={`${label} · ${title} · ${LABELS[item.state]}`}
                            disabled={item.state === 'not_applicable'}
                            onClick={() => {
                              setOpened(item);
                              setDetailEpoch((value) => value + 1);
                              void reload();
                            }}
                          >
                            <strong>
                              {score(item) ??
                                (item.state === 'accepted' || item.state === 'completed'
                                  ? 'Без оценки'
                                  : '—')}
                            </strong>
                            <span>{LABELS[item.state]}</span>
                            {item.attemptNumber ? (
                              <small>Попытка {item.attemptNumber}</small>
                            ) : null}
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {opened ? (
        opened.canonicalState?.activityRunId ? (
          <ReviewDetail
            key={`${opened.seatId}:${opened.assignmentId}:${detailEpoch}`}
            classroomId={classroomId}
            item={opened}
            onChanged={reload}
            onClose={() => setOpened(null)}
          />
        ) : (
          <LegacyLearningReview
            key={`${opened.seatId}:${opened.assignmentId}:${detailEpoch}`}
            classroomId={classroomId}
            item={opened}
            onChanged={reload}
            onClose={() => setOpened(null)}
          />
        )
      ) : null}
    </section>
  );
}
