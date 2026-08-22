import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type SeatAssignment, type SeatCourseRun, type SeatCourseRunLesson } from '../api';
import { newClientId } from '../client-id';
import { AssignmentView } from './AssignmentView';
import { LessonBlocks } from './LessonBlocks';
import { useSchoolTime } from './school-time';
import './seat-courses.css';

function assignmentShape(run: SeatCourseRun, lesson: SeatCourseRunLesson): SeatAssignment {
  return {
    id: lesson.classroomAssignmentId ?? lesson.id,
    title: lesson.assignmentTitle ?? lesson.title,
    brief: lesson.assignmentBrief ?? lesson.content,
    goal: lesson.assignmentGoal,
    moduleKey: lesson.moduleKey ?? 'unknown',
    dueAt: run.dueAt,
    status: run.status,
    sampleImage: lesson.sampleImage,
    projectId: lesson.projectId,
    submittedAt: lesson.submittedAt,
    snapshotRevision: lesson.snapshotRevision,
    updatedAt: lesson.updatedAt,
  };
}

function lessonComplete(lesson: SeatCourseRunLesson): boolean {
  return lesson.kind === 'material' ? lesson.completedAt !== null : lesson.submittedAt !== null;
}

export function SeatCourses({
  onOpenProject,
  source = 'seat',
}: {
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
  readonly source?: 'seat' | 'account';
}): JSX.Element | null {
  const [runs, setRuns] = useState<SeatCourseRun[] | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [openLessonId, setOpenLessonId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const time = useSchoolTime();

  const reload = useCallback(async () => {
    const result =
      source === 'account' ? await api.accountCourseRuns() : await api.seatCourseRuns();
    setRuns(result.ok ? result.data.items : []);
    if (!result.ok) setError(result.error.message);
  }, [source]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openRun = runs?.find((run) => run.id === openRunId) ?? null;
  const lessons = useMemo(
    () => openRun?.sections.flatMap((section) => section.lessons) ?? [],
    [openRun],
  );
  const openLesson = lessons.find((lesson) => lesson.id === openLessonId) ?? lessons[0] ?? null;
  const openLessonIndex = openLesson
    ? lessons.findIndex((lesson) => lesson.id === openLesson.id)
    : -1;
  const completedLessonCount = lessons.filter(lessonComplete).length;

  async function start(lesson: SeatCourseRunLesson): Promise<void> {
    if (!lesson.classroomAssignmentId || !lesson.moduleKey) return;
    setBusy(lesson.id);
    setError(null);
    const created = await api.createProject({
      scope: 'personal',
      module: lesson.moduleKey,
      title: lesson.assignmentTitle ?? lesson.title,
      idempotencyKey: newClientId(),
    });
    if (!created.ok) {
      setBusy(null);
      setError(created.error.message || 'Не удалось начать задание.');
      return;
    }
    const linked = await api.startSeatAssignment(
      lesson.classroomAssignmentId,
      created.data.project.id,
    );
    setBusy(null);
    if (!linked.ok) {
      setError(linked.error.message || 'Не удалось начать задание.');
      return;
    }
    await reload();
    onOpenProject(linked.data.projectId, lesson.moduleKey);
  }

  async function markMaterial(lesson: SeatCourseRunLesson, completed: boolean): Promise<boolean> {
    if (!openRun || lesson.kind !== 'material') return false;
    setBusy(lesson.id);
    setError(null);
    const result =
      source === 'account'
        ? await api.setAccountCourseLessonProgress(openRun.id, lesson.id, completed)
        : await api.setSeatCourseLessonProgress(openRun.id, lesson.id, completed);
    setBusy(null);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось сохранить прогресс.');
      return false;
    }
    await reload();
    return true;
  }

  if (runs === null || runs.length === 0) return null;

  if (openRun && openLesson) {
    const assignment =
      openLesson.kind === 'assignment' ? assignmentShape(openRun, openLesson) : null;
    return (
      <section className="seat-course-player" data-testid="seat-course-player">
        <header className="seat-course-player-head">
          <button type="button" className="classroom-back" onClick={() => setOpenRunId(null)}>
            ← Мои курсы
          </button>
          <div>
            <span className="course-eyebrow">Курс · v{openRun.versionNumber}</span>
            <h2>{openRun.title}</h2>
            <p>
              Пройдено {completedLessonCount} из {lessons.length}
              {openRun.dueAt ? ` · до ${time.date(openRun.dueAt)}` : ' · без общего срока'}
            </p>
            <div
              className="seat-course-progress"
              role="progressbar"
              aria-label="Прогресс курса"
              aria-valuemin={0}
              aria-valuemax={lessons.length}
              aria-valuenow={completedLessonCount}
            >
              <span
                style={{
                  width: `${lessons.length ? (completedLessonCount / lessons.length) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        </header>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="seat-course-layout">
          <aside aria-label="Содержание курса">
            {openRun.sections.map((section) => (
              <section key={section.id}>
                <strong>{section.title}</strong>
                <ol>
                  {section.lessons.map((lesson) => (
                    <li key={lesson.id}>
                      <button
                        type="button"
                        className={lesson.id === openLesson.id ? 'active' : undefined}
                        onClick={() => setOpenLessonId(lesson.id)}
                      >
                        <span>{lesson.kind === 'assignment' ? '◆' : '●'}</span>
                        <span>
                          {lesson.title}
                          <small>
                            {lesson.submittedAt
                              ? 'Сдано'
                              : lesson.completedAt
                                ? 'Пройдено'
                                : lesson.projectId
                                  ? 'В работе'
                                  : lesson.kind === 'assignment'
                                    ? 'Практика'
                                    : 'Материал'}
                          </small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </aside>
          <article className="seat-course-lesson">
            <span className="course-eyebrow">
              {openLesson.kind === 'assignment' ? 'Практическое задание' : 'Материал'}
            </span>
            <h3>{openLesson.title}</h3>
            {openLesson.summary ? (
              <p className="seat-course-summary">{openLesson.summary}</p>
            ) : null}
            <LessonBlocks blocks={openLesson.blocks} legacyContent={openLesson.content} />
            {assignment ? (
              <>
                <AssignmentView
                  assignment={assignment}
                  aside={
                    assignment.projectId ? (
                      <figure className="seat-assignment-work">
                        {assignment.snapshotRevision === null ? (
                          <span className="seat-assignment-work-empty">
                            Работа открыта, но пока пустая.
                          </span>
                        ) : (
                          <img
                            src={`/api/projects/${encodeURIComponent(
                              assignment.projectId,
                            )}/snapshot?rev=${assignment.snapshotRevision}`}
                            alt="Ваша работа"
                            loading="lazy"
                          />
                        )}
                        <figcaption>
                          {assignment.updatedAt
                            ? `Вы работали ${time.dateTime(assignment.updatedAt)}`
                            : 'Ваша работа'}
                        </figcaption>
                      </figure>
                    ) : null
                  }
                />
                <div className="seat-course-actions">
                  {assignment.projectId ? (
                    <>
                      <button
                        type="button"
                        className="portal-create-button"
                        onClick={() =>
                          onOpenProject(assignment.projectId as string, assignment.moduleKey)
                        }
                      >
                        Открыть работу
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={busy === openLesson.id || assignment.submittedAt !== null}
                        onClick={async () => {
                          setBusy(openLesson.id);
                          const result = await api.submitSeatAssignment(assignment.id, true);
                          setBusy(null);
                          if (result.ok) await reload();
                        }}
                      >
                        {assignment.submittedAt ? 'На проверке' : 'Сдать'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="portal-create-button"
                      disabled={busy === openLesson.id || openRun.status === 'closed'}
                      onClick={() => void start(openLesson)}
                    >
                      {busy === openLesson.id ? 'Готовим…' : 'Начать задание'}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="seat-course-actions">
                <button
                  type="button"
                  className={openLesson.completedAt ? 'btn-secondary' : 'portal-create-button'}
                  disabled={busy === openLesson.id || openRun.status === 'closed'}
                  onClick={() => void markMaterial(openLesson, openLesson.completedAt === null)}
                >
                  {busy === openLesson.id
                    ? 'Сохраняем…'
                    : openLesson.completedAt
                      ? 'Отметить непройденным'
                      : 'Отметить пройденным'}
                </button>
              </div>
            )}
            <nav className="seat-course-step-nav" aria-label="Переход между уроками">
              <button
                type="button"
                className="btn-secondary"
                disabled={openLessonIndex <= 0}
                onClick={() => setOpenLessonId(lessons[openLessonIndex - 1]?.id ?? null)}
              >
                ← Назад
              </button>
              <span>
                {openLessonIndex + 1} из {lessons.length}
              </span>
              <button
                type="button"
                className="btn-secondary"
                disabled={openLessonIndex < 0 || openLessonIndex >= lessons.length - 1}
                onClick={async () => {
                  if (openLesson.kind === 'material' && !openLesson.completedAt) {
                    const saved = await markMaterial(openLesson, true);
                    if (!saved) return;
                  }
                  setOpenLessonId(lessons[openLessonIndex + 1]?.id ?? null);
                }}
              >
                Далее →
              </button>
            </nav>
          </article>
        </div>
      </section>
    );
  }

  return (
    <section className="seat-courses" aria-labelledby="seat-courses-title">
      <div>
        <h2 id="seat-courses-title">Мои курсы</h2>
        <p>Проходите уроки по порядку и возвращайтесь к начатой практике.</p>
      </div>
      <ul data-testid="seat-courses">
        {runs.map((run) => {
          const lessons = run.sections.flatMap((section) => section.lessons);
          const assignments = lessons.filter((lesson) => lesson.kind === 'assignment');
          const completed = lessons.filter((lesson) =>
            lesson.kind === 'material' ? lesson.completedAt !== null : lesson.submittedAt !== null,
          ).length;
          return (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => {
                  setOpenRunId(run.id);
                  setOpenLessonId(
                    lessons.find((lesson) => !lessonComplete(lesson))?.id ?? lessons[0]?.id ?? null,
                  );
                }}
              >
                <span className="classroom-course-mark">{run.title.slice(0, 1).toUpperCase()}</span>
                <span>
                  <strong>{run.title}</strong>
                  <small>
                    Пройдено {completed} из {lessons.length}
                    {assignments.length > 0 ? ` · практика ${assignments.length}` : ''}
                  </small>
                </span>
                <span>{run.dueAt ? `До ${time.date(run.dueAt)}` : 'Без срока'}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
