import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type GradebookEntry } from '../api';
import { LegacyLearningReview } from './LegacyLearningReview';
import { useLearningDestination } from '../learning/use-learning-destination';
import './classroom-gradebook.css';
import { ClassroomLearningReview } from './ClassroomLearningReview';
import { ClassroomReviewStream } from './ClassroomReviewStream';
import { ManualClassroomJournal } from './ManualClassroomJournal';

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
function stateLabel(item: GradebookEntry) {
  return item.canonicalState?.flags.includes('legacy_unresolved') ? 'Сдано' : LABELS[item.state];
}
function score(item: GradebookEntry) {
  if (item.displayGrade) return item.displayGrade;
  if (item.points !== null && item.maxPoints !== null) return `${item.points}/${item.maxPoints}`;
  if (item.canonicalState?.selectedResult?.completionValue === true) return 'Выполнено';
  return null;
}
type GradebookStudentNavigation = {
  classroomId: string;
  onNavigationBlocked?: (blocked: boolean) => void;
  onOpenStudent?: ((seatId: string) => void) | undefined;
};

export function ClassroomGradebook({
  classroomId,
  onOpenStudent,
  onNavigationBlocked,
}: GradebookStudentNavigation): JSX.Element {
  return (
    <JournalModes
      key={classroomId}
      classroomId={classroomId}
      onOpenStudent={onOpenStudent}
      {...(onNavigationBlocked ? { onNavigationBlocked } : {})}
    />
  );
}

function JournalModes({
  classroomId,
  onOpenStudent,
  onNavigationBlocked,
}: GradebookStudentNavigation): JSX.Element {
  const [navigationBlocked, setNavigationBlocked] = useState(false);
  const registerBlocked = useCallback(
    (value: boolean) => {
      setNavigationBlocked(value);
      onNavigationBlocked?.(value);
    },
    [onNavigationBlocked],
  );
  const destination = useLearningDestination();
  const [mode, setMode] = useState<'manual' | 'assignments'>(() =>
    destination.assignment ? 'assignments' : 'manual',
  );
  useEffect(() => {
    if (destination.assignment) setMode('assignments');
  }, [destination.assignment, destination.attempt, destination.seat]);
  const controls = (
    <nav className="manual-journal-modes" aria-label="Режим журнала">
      <button
        className="btn-secondary"
        aria-pressed={mode === 'manual'}
        disabled={navigationBlocked}
        onClick={() => setMode('manual')}
      >
        По датам
      </button>{' '}
      <button
        className="btn-secondary"
        aria-pressed={mode === 'assignments'}
        disabled={navigationBlocked}
        onClick={() => setMode('assignments')}
      >
        Задания
      </button>
    </nav>
  );
  return (
    <div className="classroom-tab-panel">
      {mode === 'assignments' ? controls : null}
      {mode === 'manual' ? (
        <ManualClassroomJournal
          classroomId={classroomId}
          modeControl={controls}
          onOpenStudent={onOpenStudent}
        />
      ) : (
        <AssignedClassroomGradebook
          classroomId={classroomId}
          onOpenStudent={onOpenStudent}
          onNavigationBlocked={registerBlocked}
        />
      )}
    </div>
  );
}

function AssignedClassroomGradebook({
  classroomId,
  onOpenStudent,
  onNavigationBlocked,
}: GradebookStudentNavigation): JSX.Element {
  const destination = useLearningDestination();
  const [items, setItems] = useState<GradebookEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<GradebookEntry | null>(null);
  const [detailEpoch, setDetailEpoch] = useState(0);
  const [stream, setStream] = useState<string | null>(() =>
    destination.reviewStream ? destination.assignment : null,
  );
  const previousStreamHint = useRef(destination.reviewStream);
  useEffect(() => {
    if (destination.reviewStream && destination.assignment) setStream(destination.assignment);
    else if (previousStreamHint.current) setStream(null);
    previousStreamHint.current = destination.reviewStream;
  }, [destination.reviewStream, destination.assignment]);
  const [search, setSearch] = useState('');
  const [course, setCourse] = useState('');
  const openedDestination = useRef('');
  useEffect(() => {
    const key = `${destination.assignment}:${destination.seat}:${destination.attempt}`;
    if (
      destination.reviewStream ||
      openedDestination.current === key ||
      !destination.assignment ||
      !items
    )
      return;
    const match = items.find(
      (item) => item.assignmentId === destination.assignment && item.seatId === destination.seat,
    );
    if (match) {
      setOpened(match);
      setDetailEpoch((value) => value + 1);
      openedDestination.current = key;
    }
  }, [
    items,
    destination.assignment,
    destination.seat,
    destination.attempt,
    destination.reviewStream,
  ]);
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
  const awaiting = (items ?? []).filter(
    (item) =>
      !item.canonicalState?.flags.includes('legacy_unresolved') &&
      ['submitted', 'waiting_review', 'evaluating'].includes(item.state),
  ).length;
  if (stream)
    return (
      <ClassroomReviewStream
        key={classroomId + ':' + stream}
        classroomId={classroomId}
        assignmentId={stream}
        onClose={() => setStream(null)}
        onChanged={reload}
        {...(onNavigationBlocked ? { onNavigationBlocked } : {})}
      />
    );
  return (
    <section className="classroom-tab-panel gradebook-panel">
      <header className="gradebook-heading">
        <div>
          <h2>Журнал</h2>
          <p>Строки — ученики, столбцы — назначенные работы.</p>
        </div>
        <span>Ждут проверки: {awaiting}</span>
      </header>
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
                  <th scope="col" key={id} data-assignment-id={id} aria-label={title}>
                    <span>{title}</span>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={opened !== null}
                      onClick={() => setStream(id)}
                      aria-label={`Проверить по очереди: ${title}`}
                    >
                      Проверить по очереди
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([seat, label]) => (
                <tr key={seat}>
                  <th scope="row">
                    {onOpenStudent ? (
                      <button
                        type="button"
                        className="classroom-journal-student-link"
                        onClick={() => onOpenStudent(seat)}
                        aria-label={'Открыть профиль ученика: ' + label}
                      >
                        {label}
                      </button>
                    ) : (
                      label
                    )}
                  </th>
                  {columns.map(([assignment, title]) => {
                    const item = cells.get(`${seat}:${assignment}`);
                    return (
                      <td key={assignment}>
                        {item ? (
                          <button
                            className="gradebook-cell"
                            aria-label={`${label} · ${title} · ${stateLabel(item)}`}
                            disabled={item.state === 'not_applicable'}
                            onClick={() => {
                              setOpened(item);
                              setDetailEpoch((value) => value + 1);
                              void reload();
                            }}
                          >
                            <strong>
                              {score(item) ?? (item.state === 'completed' ? 'Без оценки' : '—')}
                            </strong>
                            <span>{stateLabel(item)}</span>
                            {item.canonicalState?.flags.includes('legacy_unresolved') ? (
                              <small>
                                Историческая сдача: точное immutable evidence не восстановлено
                              </small>
                            ) : null}
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
          <ClassroomLearningReview
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
