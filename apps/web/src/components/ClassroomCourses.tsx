import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type ClassroomCourseActivityOccurrence,
  type GradebookEntry,
  type ClassroomCourseRun,
  type ClassroomCourseRunLesson,
  type Course,
} from '../api';
import { LessonBlocks } from './LessonBlocks';
import { LearningAudience } from './LearningAudience';
import { CanonicalGradebookReviewDetail } from './ClassroomGradebook';
import {
  canInspectCoursePractice,
  exactCoursePracticeQueue,
  filterCoursePracticeQueue,
  type CoursePracticeFilter,
} from '../learning/course-practice-queue';
import { useSchoolTime } from './school-time';
import { assignmentDateTime } from '../learning/assignment-date-time';
import { useLearningDestination } from '../learning/use-learning-destination';
import './classroom-courses.css';
import {
  canonicalLearningClass,
  canonicalLearningLabel,
} from '../learning/canonical-learning-presentation';

function CoursePracticeCard({
  occurrence,
  onOpen,
}: {
  occurrence: ClassroomCourseActivityOccurrence | undefined;
  onOpen: () => void;
}) {
  const counts = occurrence?.canonicalCounts;
  const unavailable = !occurrence
    ? 'Не удалось подтвердить назначение этой практики. Точная очередь недоступна.'
    : !occurrence.assignmentScopeExact
      ? 'Историческое назначение связано с несколькими практиками. Точная очередь недоступна.'
      : !counts
        ? 'Состояние практики недоступно. Обновите данные курса.'
        : null;
  return (
    <section
      className="course-practice-card"
      data-testid="course-practice"
      data-practice-block={occurrence?.blockId ?? 'lesson'}
      data-activity-run={occurrence?.activityRunId}
    >
      <h4>{occurrence?.title ?? 'Практика'}</h4>
      {occurrence?.goal ? <p>{occurrence.goal}</p> : null}
      {unavailable ? (
        <p role="status">{unavailable}</p>
      ) : counts ? (
        <>
          <p>
            Назначено: {occurrence?.assignedCount} · Не назначено: {occurrence?.notAssignedCount}
          </p>
          <dl className="course-practice-counts" aria-label="Состояние практики">
            <div>
              <dt>Не начали</dt>
              <dd>{counts.notStarted}</dd>
            </div>
            <div>
              <dt>В работе</dt>
              <dd>{counts.inProgress}</dd>
            </div>
            <div>
              <dt>Сдано без результата</dt>
              <dd>{counts.submitted}</dd>
            </div>
            <div>
              <dt>Ждут проверки</dt>
              <dd>{counts.waitingReview}</dd>
            </div>
            <div>
              <dt>На доработке</dt>
              <dd>{counts.changesRequested}</dd>
            </div>
            <div>
              <dt>Выполнено</dt>
              <dd>{counts.completed}</dd>
            </div>
          </dl>
          {occurrence?.withdrawnCount ? (
            <p>Доступ завершён: {occurrence.withdrawnCount}. История сохранена.</p>
          ) : null}
          {occurrence?.inactiveCount ? (
            <p>Доступ пока не активен: {occurrence.inactiveCount}.</p>
          ) : null}
          {occurrence?.invalidatedCount ? (
            <p>Попытка отменена: {occurrence.invalidatedCount}.</p>
          ) : null}
        </>
      ) : null}
      <button type="button" className="btn-secondary" disabled={!!unavailable} onClick={onOpen}>
        Проверить работы
      </button>
    </section>
  );
}

function CoursePracticeQueue({
  classroomId,
  run,
  lesson,
  occurrence,
  readOnly,
  onReload,
  onBack,
}: {
  classroomId: string;
  run: ClassroomCourseRun;
  lesson: ClassroomCourseRunLesson;
  occurrence: ClassroomCourseActivityOccurrence;
  readOnly: boolean;
  onReload: () => Promise<void>;
  onBack: () => void;
}) {
  const [items, setItems] = useState<GradebookEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CoursePracticeFilter>('all');
  const [openedSeat, setOpenedSeat] = useState<string | null>(null);
  const active = useRef(false);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const current = ++generation.current;
    const result = await api.classroomGradebook(classroomId);
    if (!active.current || current !== generation.current) return;
    if (!result.ok) {
      setItems(null);
      setOpenedSeat(null);
      setError(result.error.message);
      return;
    }
    setError(null);
    setItems(result.data.items);
  }, [classroomId]);
  const refresh = useCallback(async () => {
    await Promise.all([reload(), onReload()]);
  }, [reload, onReload]);
  useEffect(() => {
    active.current = true;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => {
      active.current = false;
      generation.current += 1;
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [refresh]);
  const queue = items === null ? null : exactCoursePracticeQueue(items, run.id, occurrence);
  const visible = filterCoursePracticeQueue(queue?.items ?? [], search, filter);
  const navigable = visible.filter(canInspectCoursePractice);
  const opened = queue?.items.find((item) => item.seatId === openedSeat) ?? null;
  const index = navigable.findIndex((item) => item.seatId === openedSeat);
  const problem = error ?? queue?.error;
  return (
    <section
      className="classroom-course-detail"
      data-testid="course-practice-queue"
      data-activity-run={occurrence.activityRunId}
    >
      <button type="button" className="classroom-back" onClick={onBack}>
        ← К урокам курса
      </button>
      <header className="course-practice-queue-heading">
        <div>
          <span className="course-eyebrow">
            {run.title} · v{run.versionNumber} · {lesson.title}
          </span>
          <h2>{occurrence.title}</h2>
          <p>Работы и история попыток этой практики.</p>
        </div>
        <button className="btn-secondary" onClick={() => void refresh()}>
          Обновить очередь
        </button>
      </header>
      {readOnly ? (
        <p role="status">Курс или класс закрыт. История работ доступна для просмотра.</p>
      ) : null}
      {problem ? (
        <p role="alert">{problem}</p>
      ) : items === null ? (
        <p role="status">Загружаем очередь…</p>
      ) : (
        <div className="course-practice-review-layout">
          <details className="course-practice-queue-list" open>
            <summary>Ученики · {queue?.items.length ?? 0}</summary>
            <label>
              Поиск ученика
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setOpenedSeat(null);
                }}
              />
            </label>
            <label>
              Состояние работы
              <select
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value as CoursePracticeFilter);
                  setOpenedSeat(null);
                }}
              >
                <option value="all">Все состояния</option>
                <option value="waiting_review">Ждёт проверки</option>
                <option value="submitted">Сдано без результата</option>
                <option value="changes_requested">На доработке</option>
                <option value="in_progress">В работе</option>
                <option value="not_started">Не начато</option>
                <option value="completed">Выполнено</option>
                <option value="not_applicable">Не назначено</option>
                <option value="withdrawn">Доступ завершён</option>
                <option value="inactive">Доступ не активен</option>
                <option value="invalidated">Попытка отменена</option>
              </select>
            </label>
            {!visible.length ? (
              <p>
                {queue?.items.length
                  ? 'По этим условиям учеников нет.'
                  : 'В классе пока нет учеников.'}
              </p>
            ) : (
              <ul>
                {visible.map((item) => (
                  <li key={item.seatId}>
                    <button
                      type="button"
                      className={`course-practice-student${openedSeat === item.seatId ? ' is-selected' : ''}`}
                      aria-pressed={openedSeat === item.seatId}
                      disabled={!canInspectCoursePractice(item)}
                      onClick={() => setOpenedSeat(item.seatId)}
                    >
                      <strong>{item.displayLabel}</strong>
                      <span className={canonicalLearningClass(item.canonicalState)}>
                        {canonicalLearningLabel(item.canonicalState)}
                      </span>
                      {item.attemptNumber ? <small>Попытка {item.attemptNumber}</small> : null}
                      {item.displayGrade ? (
                        <small>Оценка: {item.displayGrade}</small>
                      ) : item.points !== null ? (
                        <small>
                          Баллы: {item.points} / {item.maxPoints}
                        </small>
                      ) : null}
                      {item.canonicalState?.flags.includes('withdrawn') ? (
                        <small>Доступ завершён · история сохранена</small>
                      ) : item.canonicalState?.learnerMessageCode === 'access_suspended' ? (
                        <small>Доступ приостановлен</small>
                      ) : item.canonicalState?.learnerMessageCode === 'access_not_active' ? (
                        <small>Ученик ещё не вошёл в класс</small>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </details>
          <div className="course-practice-review">
            {opened ? (
              <>
                <nav className="course-practice-navigation" aria-label="Работы в очереди">
                  <button
                    className="btn-secondary"
                    disabled={index <= 0}
                    onClick={() => setOpenedSeat(navigable[index - 1]?.seatId ?? null)}
                  >
                    Предыдущий ученик
                  </button>
                  <span>
                    {index >= 0
                      ? `${index + 1} из ${navigable.length}`
                      : 'Работа вне выбранного фильтра'}
                  </span>
                  <button
                    className="btn-secondary"
                    disabled={index >= navigable.length - 1}
                    onClick={() => setOpenedSeat(navigable[index + 1]?.seatId ?? null)}
                  >
                    Следующий ученик
                  </button>
                </nav>
                <CanonicalGradebookReviewDetail
                  key={`${classroomId}:${occurrence.activityRunId}:${opened.seatId}:${opened.attemptId}`}
                  classroomId={classroomId}
                  item={opened}
                  onChanged={refresh}
                  onClose={() => setOpenedSeat(null)}
                  readOnly={
                    readOnly ||
                    opened.canonicalState?.flags.includes('withdrawn') ||
                    opened.canonicalState?.workflowState === 'not_applicable'
                  }
                />
                <a
                  className="btn-secondary"
                  href={`#/classrooms/${classroomId}?assignment=${occurrence.classroomAssignmentId}&learner=${opened.seatId}`}
                >
                  Открыть результат в журнале
                </a>
              </>
            ) : (
              <p className="course-practice-review-empty">
                Выберите ученика, чтобы открыть его попытки, сданную версию и отзыв.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function ClassroomCourses(
  props: Parameters<typeof ClassroomCoursesContent>[0],
): JSX.Element {
  return <ClassroomCoursesContent key={props.classroomId} {...props} />;
}

function ClassroomCoursesContent({
  classroomId,
  archived,
}: {
  readonly classroomId: string;
  readonly archived: boolean;
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
}): JSX.Element {
  const [runs, setRuns] = useState<ClassroomCourseRun[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState('');
  const [assignOpen, setAssignOpen] = useState<boolean | null>(null);
  const [dueAt, setDueAt] = useState('');
  const [audienceType, setAudienceType] = useState<'whole_class' | 'named_learners'>('whole_class');
  const [seatIds, setSeatIds] = useState<string[]>([]);
  const [students, setStudents] = useState<{ id: string; displayLabel: string }[]>([]);
  const deliveryRequest = useRef<{ payload: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const destination = useLearningDestination();
  useEffect(() => {
    if (destination.courseRun) setOpenRunId(destination.courseRun);
  }, [destination.courseRun]);
  const [reviewPractice, setReviewPractice] = useState<{
    lessonId: string;
    activityRunId: string;
  } | null>(null);
  const courseScope = useRef({ classroomId, generation: 0 });
  const mounted = useRef(false);
  const time = useSchoolTime();

  const reload = useCallback(async () => {
    const scope = courseScope.current;
    const generation = ++scope.generation;
    const result = await api.listClassroomCourseRuns(classroomId);
    if (!mounted.current || courseScope.current !== scope || generation !== scope.generation)
      return;
    setRuns(result.ok ? result.data.items : []);
    setError(result.ok ? null : result.error.message);
  }, [classroomId]);

  useEffect(() => {
    mounted.current = true;
    const scope = { classroomId, generation: 0 };
    courseScope.current = scope;
    setRuns(null);
    setStudents([]);
    setCourses([]);
    setReviewPractice(null);
    setError(null);
    void api.listClassroomRoster(classroomId).then((result) => {
      if (!mounted.current || courseScope.current !== scope) return;
      if (result.ok)
        setStudents(
          result.data.items.filter((student) => ['active', 'issued'].includes(student.status)),
        );
      else setError(result.error.message);
    });
    void Promise.all([reload(), api.listCourses()]).then(([, available]) => {
      if (!mounted.current || courseScope.current !== scope || !available.ok) return;
      const published = available.data.items.filter(
        (course) => course.publishedVersion !== null && course.archivedAt === null,
      );
      setCourses(published);
      setCourseId((current) => current || published[0]?.id || '');
    });
    return () => {
      mounted.current = false;
      scope.generation += 1;
    };
  }, [classroomId, reload]);

  const openRun = runs?.find((run) => run.id === openRunId) ?? null;
  const review = useMemo(() => {
    if (!openRun || !reviewPractice) return null;
    const lesson = openRun.sections
      .flatMap((section) => section.lessons)
      .find((item) => item.id === reviewPractice.lessonId);
    const occurrence = lesson?.activityOccurrences?.find(
      (item) => item.activityRunId === reviewPractice.activityRunId,
    );
    return lesson && occurrence ? { lesson, occurrence } : null;
  }, [openRun, reviewPractice]);

  async function assign(): Promise<void> {
    if (!courseId || busy) return;
    const date = assignmentDateTime(dueAt);
    if (!date.ok) {
      setError(date.message);
      return;
    }
    setBusy(true);
    setError(null);
    const selected = courses.find((course) => course.id === courseId);
    if (!selected?.publishedVersion || (audienceType === 'named_learners' && !seatIds.length)) {
      setError('Выберите опубликованный курс и учеников.');
      setBusy(false);
      return;
    }
    const payload = JSON.stringify({
      courseId,
      version: selected.publishedVersion,
      dueAt,
      audienceType,
      seatIds: [...seatIds].sort(),
    });
    if (deliveryRequest.current?.payload !== payload)
      deliveryRequest.current = { payload, id: crypto.randomUUID() };
    const scope = courseScope.current;
    const result = await api.assignCourseToClassroom(classroomId, courseId, date.instant, {
      versionNumber: selected.publishedVersion,
      audienceType,
      seatIds: audienceType === 'whole_class' ? [] : seatIds,
      requestId: deliveryRequest.current.id,
      timeZone: date.timeZone,
    });
    if (!mounted.current || courseScope.current !== scope) return;
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    deliveryRequest.current = null;
    setNotice(
      result.data.reused
        ? `Назначение курса «${selected?.title ?? 'Курс'}» подтверждено.`
        : `Курс «${selected?.title ?? 'Курс'}» · v${result.data.versionNumber} назначен классу.`,
    );
    await reload();
    if (!mounted.current || courseScope.current !== scope) return;
    setOpenRunId(result.data.runId);
  }

  if (openRun && review) {
    return (
      <CoursePracticeQueue
        key={`${classroomId}:${openRun.id}:${review.lesson.id}:${review.occurrence.activityRunId}`}
        classroomId={classroomId}
        run={openRun}
        lesson={review.lesson}
        occurrence={review.occurrence}
        readOnly={archived || openRun.status === 'closed'}
        onReload={reload}
        onBack={() => setReviewPractice(null)}
      />
    );
  }

  if (openRun) {
    return (
      <section className="classroom-course-detail" data-testid="classroom-course-run">
        <fieldset
          className="course-practice-audience"
          disabled={archived || openRun.status === 'closed'}
        >
          <LearningAudience
            key={`${classroomId}:${openRun.id}`}
            classroomId={classroomId}
            courseRunId={openRun.id}
            onChanged={() => void reload()}
          />
        </fieldset>
        <div className="classroom-course-detail-head">
          <button type="button" className="classroom-back" onClick={() => setOpenRunId(null)}>
            ← Все курсы
          </button>
          <div>
            <span className="course-eyebrow">Курс класса · v{openRun.versionNumber}</span>
            <h2>{openRun.title}</h2>
            <p>
              {openRun.summary ?? 'Учебный маршрут класса'}
              {openRun.dueAt ? ` · до ${time.date(openRun.dueAt)}` : ''}
            </p>
          </div>
          <div className="course-practice-navigation">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={() => void reload()}
            >
              Обновить курс
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={archived || busy}
              onClick={async () => {
                const scope = courseScope.current;
                setBusy(true);
                const next = openRun.status === 'open' ? 'closed' : 'open';
                const result = await api.setClassroomCourseRunStatus(classroomId, openRun.id, next);
                if (!mounted.current || courseScope.current !== scope) return;
                setBusy(false);
                if (result.ok) {
                  setNotice(next === 'closed' ? 'Курс закрыт.' : 'Курс снова открыт.');
                  await reload();
                }
              }}
            >
              {openRun.status === 'open' ? 'Закрыть курс' : 'Открыть курс'}
            </button>
          </div>
        </div>
        {notice ? (
          <p className="notice-success" role="status">
            {notice}
          </p>
        ) : null}
        {openRun.sections.map((section) => (
          <section key={section.id} className="classroom-course-section">
            <div>
              <h3>{section.title}</h3>
              {section.summary ? <p>{section.summary}</p> : null}
            </div>
            <ol>
              {section.lessons.map((lesson) => (
                <li key={lesson.id} className="classroom-course-lesson">
                  <span className="classroom-course-lesson-kind">
                    {lesson.kind === 'assignment' ? 'Практика' : 'Материал'}
                  </span>
                  <div>
                    <strong>{lesson.title}</strong>
                    {lesson.summary ? <p>{lesson.summary}</p> : null}
                    <LessonBlocks
                      blocks={lesson.blocks}
                      legacyContent={lesson.content}
                      compact
                      renderActivity={(block) => {
                        const occurrence = lesson.activityOccurrences?.find(
                          (item) =>
                            item.blockId === block.id &&
                            item.learningActivityVersionId === block.learningActivityVersionId,
                        );
                        return (
                          <CoursePracticeCard
                            occurrence={occurrence}
                            onOpen={() => {
                              if (occurrence)
                                setReviewPractice({
                                  lessonId: lesson.id,
                                  activityRunId: occurrence.activityRunId,
                                });
                            }}
                          />
                        );
                      }}
                    />
                    {lesson.kind === 'assignment' ? (
                      <CoursePracticeCard
                        occurrence={lesson.activityOccurrences?.find(
                          (item) => item.blockId === null,
                        )}
                        onOpen={() => {
                          const occurrence = lesson.activityOccurrences?.find(
                            (item) => item.blockId === null,
                          );
                          if (occurrence)
                            setReviewPractice({
                              lessonId: lesson.id,
                              activityRunId: occurrence.activityRunId,
                            });
                        }}
                      />
                    ) : lesson.blocks.some(
                        (block) => block.type === 'activity' && !block.hidden,
                      ) ? null : (
                      <div className="classroom-course-material-summary">
                        Пройдено: {lesson.completedCount} из {lesson.seatCount}
                      </div>
                    )}
                  </div>
                  {lesson.estimatedMinutes ? <small>{lesson.estimatedMinutes} мин</small> : null}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </section>
    );
  }

  return (
    <section className="classroom-courses" data-testid="classroom-courses">
      <div className="classroom-learning-heading">
        <div>
          <h2>Курсы класса</h2>
          <p>Назначайте курсы всему классу или выбранным ученикам.</p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={archived || courses.length === 0}
          onClick={() =>
            setAssignOpen((value) => !(value ?? (courses.length > 0 && runs?.length === 0)))
          }
          aria-expanded={assignOpen ?? (courses.length > 0 && runs?.length === 0)}
        >
          Добавить курс
        </button>
      </div>

      {courses.length > 0 && (assignOpen ?? runs?.length === 0) ? (
        <>
          <div className="classroom-course-assign">
            <label>
              <span>Опубликованный курс</span>
              <select
                value={courseId}
                disabled={archived || busy}
                onChange={(e) => setCourseId(e.target.value)}
              >
                {courses.length === 0 ? <option value="">Нет опубликованных курсов</option> : null}
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title} · v{course.publishedVersion}
                    {course.publicationState === 'changed' ? ' (есть изменения)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Общий срок, если нужен</span>
              <input
                type="datetime-local"
                value={dueAt}
                disabled={archived || busy}
                onChange={(event) => setDueAt(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="portal-create-button"
              disabled={archived || busy || !courseId}
              onClick={() => void assign()}
            >
              {busy ? 'Назначаем…' : 'Назначить курс'}
            </button>
          </div>
          <fieldset disabled={busy || archived} className="learning-assign-field">
            <legend>Аудитория курса</legend>
            <label>
              <input
                type="radio"
                name="course-audience"
                checked={audienceType === 'whole_class'}
                onChange={() => setAudienceType('whole_class')}
              />{' '}
              Весь класс, включая новых учеников
            </label>
            <label>
              <input
                type="radio"
                name="course-audience"
                checked={audienceType === 'named_learners'}
                onChange={() => setAudienceType('named_learners')}
              />{' '}
              Выбранные ученики
            </label>
            {audienceType === 'named_learners'
              ? students.map((student) => (
                  <label key={student.id}>
                    <input
                      type="checkbox"
                      checked={seatIds.includes(student.id)}
                      onChange={(event) =>
                        setSeatIds((ids) =>
                          event.target.checked
                            ? [...ids, student.id]
                            : ids.filter((id) => id !== student.id),
                        )
                      }
                    />
                    {student.displayLabel}
                  </label>
                ))
              : null}
          </fieldset>
          <p className="classroom-course-hint">
            Срок указан по времени {Intl.DateTimeFormat().resolvedOptions().timeZone}. Назначается
            опубликованная версия курса.
          </p>
        </>
      ) : null}
      {courses.length === 0 && Boolean(runs?.length) ? (
        <p className="classroom-course-hint">
          Сначала опубликуйте курс в разделе «Курсы и задания».
        </p>
      ) : null}
      {notice ? <p className="notice-success">{notice}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      {runs === null ? (
        <p role="status">Загружаем курсы…</p>
      ) : runs.length === 0 ? (
        <div className="classroom-roster-empty">
          <h3>Курсов пока нет</h3>
          <p>
            {courses.length
              ? 'Выберите курс и учеников в форме назначения.'
              : 'Опубликуйте первый курс в разделе «Курсы и задания».'}
          </p>
          {!courses.length ? (
            <a className="btn-secondary" href="#/challenges">
              Курсы и задания
            </a>
          ) : null}
        </div>
      ) : (
        <ul className="classroom-course-list">
          {runs.map((run) => {
            const lessonCount = run.sections.reduce(
              (sum, section) => sum + section.lessons.length,
              0,
            );
            return (
              <li key={run.id}>
                <button type="button" onClick={() => setOpenRunId(run.id)}>
                  <span className="classroom-course-mark">
                    {run.title.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="classroom-course-copy">
                    <span>
                      <strong>{run.title}</strong>
                      <em>v{run.versionNumber}</em>
                      {run.status === 'closed' ? <em>закрыт</em> : null}
                    </span>
                    <small>
                      {lessonCount} уроков · начали {run.startedCount} · сдали {run.submittedCount}
                    </small>
                  </span>
                  <span>{run.dueAt ? `До ${time.date(run.dueAt)}` : 'Без срока'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
