import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  api,
  type ClassroomStudentSession,
  type LearnerResult,
  type SeatAssignment,
  type SeatCourseRun,
} from '../api';
import { SeatAssignments } from '../components/SeatAssignments';
import { SeatCourses } from '../components/SeatCourses';
import { SeatQuizzes } from '../components/SeatQuizzes';
import { SeatResults } from '../components/SeatResults';
import { AttendedClassesPage } from './AttendedClassesPage';
import { canonicalLearningLabel } from '../learning/canonical-learning-presentation';
import { useLearningDestination } from '../learning/use-learning-destination';
import { subscribeTelemetry, telemetryContext } from '../telemetry-context';
import './my-learning-workspace.css';

const sections = [
  ['overview', 'Обзор'],
  ['results', 'Результаты'],
  ['courses', 'Курсы'],
  ['assignments', 'Задания'],
  ['classes', 'Классы'],
  ['completed', 'Завершённое'],
  ['self', 'Самостоятельно'],
] as const;
type LearningSection = (typeof sections)[number][0];

export function hasCourseAssignment(runs: SeatCourseRun[], assignment: string): boolean {
  return runs.some((run) =>
    run.sections.some((section) =>
      section.lessons.some(
        (lesson) =>
          lesson.classroomAssignmentId === assignment ||
          lesson.activityOccurrences.some(
            (occurrence) => occurrence.classroomAssignmentId === assignment,
          ),
      ),
    ),
  );
}

export function learningSection(hash: string): LearningSection {
  const query = new URLSearchParams(hash.split('?')[1] ?? '');
  const explicit = sections.find(([id]) => id === query.get('view'));
  if (explicit) return explicit[0];
  if (query.has('journalColumn') || query.has('journalMonth')) return 'results';
  if (query.has('courseRun') || query.has('lesson')) return 'courses';
  if (query.has('assignment') || query.has('attempt')) return 'assignments';
  if (query.has('joinRequest') || query.has('learner')) return 'classes';
  return 'overview';
}

function sectionHref(section: LearningSection, assignment?: string): string {
  const query = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  // A section choice starts at that section, without the previous work's focus.
  for (const key of ['assignment', 'attempt', 'courseRun', 'lesson']) query.delete(key);
  query.set('view', section);
  if (assignment) query.set('assignment', assignment);
  return `#/learning?${query}`;
}

export function LearningPage({
  seat,
  onOpenProject,
}: {
  readonly seat: ClassroomStudentSession | null;
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
}): JSX.Element {
  const [hash, setHash] = useState(() => window.location.hash);
  // Continuity only fences UI work; the read APIs still prove all access.
  const continuity = useSyncExternalStore(
    subscribeTelemetry,
    () => telemetryContext().continuity,
    () => 0,
  );
  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  // A new destination or Seat lifetime gets fresh reads and retires pending work.
  return (
    <LearningWorkspace
      key={`${continuity}:${seat?.student.seatId ?? 'account'}:${seat?.expiresAt ?? ''}:${hash}`}
      seat={seat}
      onOpenProject={onOpenProject}
    />
  );
}

function LearningWorkspace({
  seat,
  onOpenProject,
}: {
  readonly seat: ClassroomStudentSession | null;
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
}): JSX.Element {
  const requestedTab = learningSection(window.location.hash);
  const destination = useLearningDestination();
  const explicitView = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('view');
  const hasExplicitView = sections.some(([id]) => id === explicitView);
  // Only an implicit assignment destination needs course discovery. An explicit
  // section remains authoritative even when a notification's focus is retained.
  const assignment =
    !hasExplicitView && requestedTab === 'assignments' ? destination.assignment : null;
  const [resolved, setResolved] = useState<{ key: string; course: boolean } | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [lookupRetry, setLookupRetry] = useState(0);
  const lookupKey = `${seat ? 'seat' : 'account'}:${assignment}`;
  const resolving = assignment !== null && resolved?.key !== lookupKey;
  const tab = !resolving && assignment && resolved?.course ? 'courses' : requestedTab;
  useEffect(() => {
    if (!assignment) return;
    let active = true;
    setLookupFailed(false);
    void (seat ? api.seatCourseRuns() : api.accountCourseRuns())
      .then((result) => {
        if (!active) return;
        if (result.ok)
          setResolved({
            key: lookupKey,
            course: hasCourseAssignment(result.data.items, assignment),
          });
        else setLookupFailed(true);
      })
      .catch(() => {
        if (active) setLookupFailed(true);
      });
    return () => {
      active = false;
    };
  }, [assignment, lookupKey, lookupRetry, seat]);
  const navigation = (
    <nav aria-label="Разделы моего обучения" className="learning-workspace-nav">
      {sections.map(([id, title]) => (
        <a key={id} href={sectionHref(id)} aria-current={tab === id ? 'page' : undefined}>
          {title}
        </a>
      ))}
    </nav>
  );

  return (
    <main id="main-content" className="portal-content learning-workspace" tabIndex={-1}>
      <header className="learning-workspace-heading">
        <div>
          <h1>Моё обучение</h1>
          <p>
            {seat
              ? `Класс «${seat.classroom.title}»`
              : 'Ваши занятия, работы и достижения в одном месте'}
          </p>
        </div>
        <a href={sectionHref('classes')}>{seat ? 'Мой класс' : 'Войти в класс'}</a>
      </header>
      {navigation}
      <div className="learning-workspace-body" key={`${seat ? 'seat' : 'account'}:${tab}`}>
        {resolving ? (
          lookupFailed ? (
            <p role="alert">
              Не удалось найти задание в курсах.{' '}
              <button
                className="btn-secondary"
                onClick={() => setLookupRetry((value) => value + 1)}
              >
                Повторить
              </button>
            </p>
          ) : (
            <p role="status">Загружаем задание…</p>
          )
        ) : tab === 'overview' ? (
          <LearningOverview seat={seat !== null} />
        ) : tab === 'self' ? (
          <section className="learning-empty" aria-label="Самостоятельное обучение">
            <h2>Учитесь в своём темпе</h2>
            <p>
              Выбирайте открытые материалы в «Знаниях». Личный прогресс самостоятельных курсов пока
              не поддерживается.
            </p>
            {!seat ? (
              <a className="btn-secondary" href="#/knowledge">
                Открыть знания
              </a>
            ) : (
              <p>Сейчас для вашего учебного профиля доступны занятия преподавателя.</p>
            )}
          </section>
        ) : !seat ? (
          <AttendedClassesPage
            onOpenProject={onOpenProject}
            mode="learning"
            embedded
            section={tab}
            completedOnly={tab === 'completed'}
          />
        ) : tab === 'results' ? (
          <SeatResults />
        ) : tab === 'courses' ? (
          <SeatCourses onOpenProject={onOpenProject} />
        ) : tab === 'assignments' ? (
          <SeatWorkSection onOpenProject={onOpenProject} />
        ) : tab === 'completed' ? (
          <>
            <SeatCourses onOpenProject={onOpenProject} completedOnly />
            <CompletedSeatResults />
          </>
        ) : (
          <section className="learning-empty" aria-label="Мой класс">
            <h2>{seat.classroom.title}</h2>
            <p>Вы вошли по учебному профилю этого класса.</p>
            <a className="btn-secondary" href={sectionHref('results')}>
              Мой рейтинг и заслуги
            </a>
          </section>
        )}
      </div>
    </main>
  );
}

function LearningOverview({ seat }: { readonly seat: boolean }): JSX.Element {
  const [data, setData] = useState<{
    assignments: SeatAssignment[] | null;
    courses: SeatCourseRun[] | null;
    results: LearnerResult[] | null;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    void Promise.allSettled([
      seat ? api.seatAssignments() : api.attendedAssignments(),
      seat ? api.seatCourseRuns() : api.accountCourseRuns(),
      seat ? api.seatResults() : api.accountResults(),
    ]).then(([assignments, courses, results]) => {
      if (!active) return;
      setData({
        assignments:
          assignments.status === 'fulfilled' && assignments.value.ok
            ? assignments.value.data.items
            : null,
        courses:
          courses.status === 'fulfilled' && courses.value.ok ? courses.value.data.items : null,
        results:
          results.status === 'fulfilled' && results.value.ok ? results.value.data.items : null,
      });
    });
    return () => {
      active = false;
    };
  }, [seat, retry]);
  return (
    <>
      {!data ? <p role="status">Загружаем обзор обучения…</p> : null}
      {data && Object.values(data).some((items) => items === null) ? (
        <p role="alert">
          Часть обзора недоступна.{' '}
          <button className="btn-secondary" onClick={() => setRetry((value) => value + 1)}>
            Повторить
          </button>
        </p>
      ) : null}
      <div className="learning-overview-metrics">
        {(
          [
            ['assignments', 'Выдано заданий', data?.assignments],
            ['courses', 'Курсы', data?.courses],
            ['results', 'Опубликовано результатов', data?.results],
          ] as const
        ).map(([id, title, items]) => (
          <a key={id} href={sectionHref(id)}>
            <span>{title}</span>
            <strong>{items ? items.length : '—'}</strong>
            <small>Открыть раздел →</small>
          </a>
        ))}
      </div>
      <div className="learning-overview-columns">
        <section className="learning-overview-panel" aria-labelledby="learning-overview-work">
          <header>
            <h2 id="learning-overview-work">Ваши задания</h2>
            <a href={sectionHref('assignments')}>Все задания →</a>
          </header>
          {data?.assignments?.length === 0 ? (
            <p>Заданий пока нет. Преподаватель выдаст их в вашем классе.</p>
          ) : null}
          {data?.assignments === null ? <p>Не удалось загрузить задания.</p> : null}
          <ul>
            {data?.assignments?.slice(0, 3).map((item) => (
              <li key={item.id}>
                <a href={sectionHref('assignments', item.id)}>{item.title}</a>
                {'classroomTitle' in item ? <small>{String(item.classroomTitle)}</small> : null}
                <span>
                  {canonicalLearningLabel(item.canonicalState) ??
                    (item.submittedAt ? 'Сдано' : item.projectId ? 'В работе' : 'Не начато')}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="learning-overview-panel" aria-labelledby="learning-overview-results">
          <header>
            <h2 id="learning-overview-results">Опубликованные результаты</h2>
            <a href={sectionHref('results')}>Все результаты →</a>
          </header>
          {data?.results?.length === 0 ? (
            <p>Результаты появятся после публикации преподавателем.</p>
          ) : null}
          {data?.results === null ? <p>Не удалось загрузить результаты.</p> : null}
          <ul>
            {data?.results?.slice(0, 3).map((item) => (
              <li key={item.assignmentId}>
                <strong>{item.assignmentTitle}</strong>
                <small>
                  {item.classroomTitle} · попытка {item.attemptNumber}
                </small>
                <span>
                  {(item.canonicalState
                    ? item.canonicalState.selectedResult?.displayGrade
                    : item.displayGrade) ?? 'Без оценки'}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

/** Each work component reports its actual visible read to the shared retry boundary. */
function SeatWorkSection({
  onOpenProject,
}: {
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
}): JSX.Element {
  const [counts, setCounts] = useState<
    readonly [number | null | undefined, number | null | undefined]
  >([undefined, undefined]);
  const [retry, setRetry] = useState(0);
  const workLoaded = useCallback((count: number | null | undefined) => {
    setCounts((current) => [count, current[1]]);
  }, []);
  const quizzesLoaded = useCallback((count: number | null | undefined) => {
    setCounts((current) => [current[0], count]);
  }, []);
  return (
    <>
      {counts.some((count) => count === undefined) ? (
        <p role="status">Загружаем задания и тесты…</p>
      ) : null}
      {counts.some((count) => count === null) ? (
        <p role="alert">
          Часть заданий недоступна.{' '}
          <button className="btn-secondary" onClick={() => setRetry((value) => value + 1)}>
            Повторить
          </button>
        </p>
      ) : null}
      {counts.every((count) => count === 0) ? (
        <p>Заданий и тестов пока нет. Преподаватель выдаст их в вашем классе.</p>
      ) : null}
      <SeatAssignments onOpenProject={onOpenProject} reloadSignal={retry} onLoad={workLoaded} />
      <SeatQuizzes reloadSignal={retry} onLoad={quizzesLoaded} />
    </>
  );
}

function CompletedSeatResults(): JSX.Element {
  const [items, setItems] = useState<LearnerResult[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    setItems(null);
    void api
      .seatResults()
      .then((result) => {
        if (!active) return;
        if (result.ok)
          setItems(
            result.data.items.filter((item) => item.canonicalState?.workflowState === 'completed'),
          );
        else setFailed(true);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [retry]);
  return (
    <section className="learning-overview-panel" aria-labelledby="learning-completed-results">
      <header>
        <h2 id="learning-completed-results">Завершённые задания</h2>
        <a href={sectionHref('results')}>Все результаты →</a>
      </header>
      {failed ? (
        <p role="alert">
          Не удалось загрузить завершённые задания.{' '}
          <button className="btn-secondary" onClick={() => setRetry((value) => value + 1)}>
            Повторить
          </button>
        </p>
      ) : items === null ? (
        <p role="status">Загружаем завершённые задания…</p>
      ) : items.length === 0 ? (
        <p>
          Завершённых заданий пока нет. Сданная работа, ожидающая проверки, ещё не считается
          завершённой.
        </p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.assignmentId}>
              <a href={sectionHref('assignments', item.assignmentId)}>{item.assignmentTitle}</a>
              <small>
                {item.classroomTitle} · попытка {item.attemptNumber}
              </small>
              <strong>{item.canonicalState?.selectedResult?.displayGrade ?? 'Без оценки'}</strong>
              {item.feedback ? <p>{item.feedback}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
