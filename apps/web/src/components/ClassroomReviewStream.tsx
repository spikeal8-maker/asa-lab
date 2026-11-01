import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type TeacherReviewQueue, type TeacherReviewQueueItem } from '../api';
import { ClassroomLearningReview } from './ClassroomLearningReview';
import { useLearningDestination } from '../learning/use-learning-destination';

const FILTERS = [
  ['all', 'Все ученики'],
  ['waiting_review', 'Ждут проверки'],
  ['changes_requested', 'На доработке'],
  ['completed', 'Проверены'],
  ['in_progress', 'В работе'],
  ['not_started', 'Не начали'],
  ['unavailable', 'Нет достоверного состояния'],
] as const;

export function ClassroomReviewStream({
  classroomId,
  assignmentId,
  onClose,
  onChanged,
  onNavigationBlocked,
}: {
  classroomId: string;
  assignmentId: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onNavigationBlocked?: (blocked: boolean) => void;
}) {
  const destination = useLearningDestination();
  const [runId, setRunId] = useState(
    destination.assignment === assignmentId ? (destination.reviewRun ?? '') : '',
  );
  const [filter, setFilter] = useState('all');
  const [data, setData] = useState<TeacherReviewQueue | null>(null);
  const [selected, setSelected] = useState<TeacherReviewQueueItem | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<{ after?: string; before?: string; edge: 'first' | 'last' }>({
    edge: 'first',
  });
  const [selectionEpoch, setSelectionEpoch] = useState(0);
  const sequence = useRef(0);
  const initialFocus = useRef(
    destination.reviewStream && destination.assignment === assignmentId
      ? { seat: destination.seat, attempt: destination.attempt }
      : null,
  );
  const updateFocus = useCallback(
    (run: string | null, item: TeacherReviewQueueItem | null, exit = false) => {
      const [base, raw] = window.location.hash.split('?');
      const params = new URLSearchParams(raw ?? '');
      params.set('assignment', assignmentId);
      for (const name of ['review', 'activityRun', 'learner', 'attempt']) params.delete(name);
      if (!exit) {
        params.set('review', 'stream');
        if (run) params.set('activityRun', run);
        if (item) {
          params.set('learner', item.seatId);
          if (item.workflowAttemptId) params.set('attempt', item.workflowAttemptId);
        }
      }
      const hash = base + '?' + params;
      if (hash === window.location.hash) return;
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search + hash,
      );
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    },
    [assignmentId],
  );
  const load = useCallback(
    async (scope: { after?: string; before?: string; edge: 'first' | 'last' }) => {
      const token = ++sequence.current;
      setLoading(true);
      const response = await api.teacherReviewQueue(classroomId, assignmentId, {
        ...(runId ? { activityRunId: runId } : {}),
        state: filter,
        ...(scope.after ? { after: scope.after } : {}),
        ...(scope.before ? { before: scope.before } : {}),
        ...(!scope.after && !scope.before && initialFocus.current?.seat
          ? { focus: initialFocus.current.seat }
          : {}),
      });
      if (sequence.current !== token) return;
      setLoading(false);
      if (!response.ok) {
        setError(response.error.message);
        return;
      }
      setError(null);
      setData(response.data);
      const available = response.data.practices.filter((run) => run.originAvailable);
      if (!runId && available.length === 1) {
        setRunId(available[0]!.id);
        return;
      }
      // A confirmed result may remove this learner from the filter. Keep its
      // immutable review mounted until the teacher explicitly navigates.
      const focus = initialFocus.current;
      const focused = response.data.items.find((item) => item.seatId === focus?.seat);
      initialFocus.current = null;
      setSelected(
        (current) =>
          current ??
          (focused
            ? { ...focused, workflowAttemptId: focus?.attempt ?? focused.workflowAttemptId }
            : null) ??
          (scope.edge === 'last'
            ? (response.data.items.at(-1) ?? null)
            : (response.data.items[0] ?? null)),
      );
    },
    [classroomId, assignmentId, runId, filter],
  );
  useEffect(() => {
    void load(page);
    return () => {
      sequence.current++;
    };
  }, [load, page]);
  const reload = useCallback(async () => {
    await load(page);
    await onChanged();
  }, [load, page, onChanged]);
  const changeSelection = (item: TeacherReviewQueueItem) => {
    if (blocked || loading || item.activityRunId !== runId || item.assignmentId !== assignmentId)
      return;
    setBlocked(false);
    setSelected(item);
    setSelectionEpoch((value) => value + 1);
  };
  const next = data?.items.find((item) => selected && item.seatId > selected.seatId);
  const previous = [...(data?.items ?? [])]
    .reverse()
    .find((item) => selected && item.seatId < selected.seatId);
  const switchPage = (direction: 'next' | 'previous', anchor?: string) => {
    if (blocked || loading) return;
    const value = anchor ?? (direction === 'next' ? data?.nextCursor : data?.previousCursor);
    if (!value) return;
    setSelected(null);
    setData((current) =>
      current ? { ...current, items: [], nextCursor: null, previousCursor: null } : null,
    );
    setSelectionEpoch((epoch) => epoch + 1);
    setPage(
      direction === 'next' ? { after: value, edge: 'first' } : { before: value, edge: 'last' },
    );
  };
  const move = (direction: 'next' | 'previous') => {
    if (blocked || loading) return;
    const item = direction === 'next' ? next : previous;
    if (item) changeSelection(item);
    else switchPage(direction, selected?.seatId);
  };
  const exit = () => {
    if (!blocked && !loading) {
      updateFocus(null, null, true);
      onClose();
    }
  };
  useEffect(() => {
    onNavigationBlocked?.(blocked || loading);
  }, [blocked, loading, onNavigationBlocked]);
  useEffect(() => () => onNavigationBlocked?.(false), [onNavigationBlocked]);
  useEffect(() => {
    if (!blocked && !loading && data) updateFocus(runId || null, selected);
  }, [runId, selected, blocked, loading, data, updateFocus]);
  return (
    <section className="review-stream" aria-label="Очередь проверки практики">
      <header className="review-stream-heading">
        <h2>Проверка по очереди</h2>
        <button className="btn-secondary" disabled={blocked || loading} onClick={exit}>
          Вернуться к журналу
        </button>
      </header>
      <div className="review-stream-controls">
        <label>
          Практика
          <select
            aria-label="Практика в очереди"
            value={runId}
            disabled={blocked || loading}
            onChange={(event) => {
              initialFocus.current = null;
              setRunId(event.target.value);
              setSelected(null);
              setData((current) =>
                current ? { ...current, items: [], nextCursor: null, previousCursor: null } : null,
              );
              setPage({ edge: 'first' });
            }}
          >
            <option value="">Выберите точную практику</option>
            {data?.practices.map((run) => (
              <option key={run.id} value={run.id} disabled={!run.originAvailable}>
                {run.title} · {run.originLabel}
              </option>
            ))}
          </select>
        </label>
        <label>
          Состояние
          <select
            aria-label="Состояние в очереди"
            value={filter}
            disabled={blocked || loading}
            onChange={(event) => {
              initialFocus.current = null;
              setFilter(event.target.value);
              setData((current) =>
                current ? { ...current, items: [], nextCursor: null, previousCursor: null } : null,
              );
              setPage({ edge: 'first' });
            }}
          >
            {FILTERS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn-secondary"
          disabled={blocked || loading}
          onClick={() => void load(page)}
        >
          Обновить очередь
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {loading ? <p role="status">Загружаем очередь…</p> : null}
      {!loading && data && !data.practices.length ? (
        <p>Пока нет доступных учебных практик для этой раздатки.</p>
      ) : null}
      {blocked ? (
        <p role="status">
          Сначала подтвердите решение или очистите несохранённые изменения. Переходы временно
          недоступны.
        </p>
      ) : null}
      {runId ? (
        <div className="review-stream-workspace">
          <aside aria-label="Ученики в очереди">
            <p>По фильтру: {data?.total ?? 0}</p>
            {!loading && !data?.items.length ? <p>Нет учеников в этом состоянии.</p> : null}
            <ul>
              {data?.items.map((item) => (
                <li key={item.seatId}>
                  <button
                    className="btn-secondary"
                    disabled={blocked || loading}
                    aria-current={item.seatId === selected?.seatId ? 'true' : undefined}
                    onClick={() => changeSelection(item)}
                  >
                    {item.displayLabel}
                  </button>
                </li>
              ))}
            </ul>
            <nav aria-label="Страницы очереди">
              <button
                className="btn-secondary"
                disabled={blocked || loading || !data?.previousCursor}
                onClick={() => switchPage('previous')}
              >
                Предыдущая страница
              </button>
              <button
                className="btn-secondary"
                disabled={blocked || loading || !data?.nextCursor}
                onClick={() => switchPage('next')}
              >
                Следующая страница
              </button>
            </nav>
          </aside>
          <div className="review-stream-main">
            <nav aria-label="Переход между учениками">
              <button
                className="btn-secondary"
                disabled={blocked || loading || (!previous && !data?.previousCursor)}
                onClick={() => void move('previous')}
              >
                Предыдущий ученик
              </button>
              <button
                className="btn-primary"
                disabled={blocked || loading || (!next && !data?.nextCursor)}
                onClick={() => void move('next')}
              >
                Следующий ученик
              </button>
            </nav>
            {selected?.canonicalState ? (
              <ClassroomLearningReview
                key={selected.seatId + ':' + selected.activityRunId + ':' + selectionEpoch}
                classroomId={classroomId}
                item={selected}
                exactRunId={selected.activityRunId}
                initialAttemptId={selected.workflowAttemptId}
                onNavigationBlocked={setBlocked}
                onChanged={reload}
                onClose={exit}
              />
            ) : (
              <p>
                {selected
                  ? 'Достоверное состояние этой практики недоступно. Оценивание заблокировано.'
                  : 'Выберите ученика для проверки.'}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
