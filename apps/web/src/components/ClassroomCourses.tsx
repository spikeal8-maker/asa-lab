import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  type ClassroomAssignment,
  type ClassroomAssignmentProgress,
  type ClassroomCourseRun,
  type ClassroomCourseRunLesson,
  type Course,
} from '../api';
import { seatAvatar } from '../creator-portal/default-avatars';
import { AssignmentView } from './AssignmentView';
import { LessonBlocks } from './LessonBlocks';
import { WorkPreview } from './WorkPreview';
import { useSchoolTime } from './school-time';
import './classroom-courses.css';
import {
  canonicalLearningClass,
  canonicalLearningLabel,
} from '../learning/canonical-learning-presentation';

function assignmentShape(
  run: ClassroomCourseRun,
  lesson: ClassroomCourseRunLesson,
): ClassroomAssignment {
  return {
    id: lesson.classroomAssignmentId ?? lesson.id,
    assignmentId: lesson.classroomAssignmentId ?? lesson.id,
    title: lesson.assignmentTitle ?? lesson.title,
    brief: lesson.assignmentBrief ?? lesson.content,
    goal: lesson.assignmentGoal,
    moduleKey: lesson.moduleKey ?? 'unknown',
    dueAt: run.dueAt,
    status: run.status,
    createdAt: run.publishedAt,
    isDemo: false,
    sampleImage: lesson.sampleImage,
    seatCount: lesson.seatCount,
    startedCount: lesson.startedCount,
    submittedCount: lesson.submittedCount,
    audienceType: null,
    assignedCount: null,
  };
}

export function ClassroomCourses({
  classroomId,
  archived,
  onOpenProject,
}: {
  readonly classroomId: string;
  readonly archived: boolean;
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
}): JSX.Element {
  const [runs, setRuns] = useState<ClassroomCourseRun[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [reviewLessonId, setReviewLessonId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ClassroomAssignmentProgress[] | null>(null);
  const [previewing, setPreviewing] = useState<ClassroomAssignmentProgress | null>(null);
  const time = useSchoolTime();

  const reload = useCallback(async () => {
    const result = await api.listClassroomCourseRuns(classroomId);
    setRuns(result.ok ? result.data.items : []);
    if (!result.ok) setError(result.error.message);
  }, [classroomId]);

  useEffect(() => {
    void Promise.all([reload(), api.listCourses()]).then(([, available]) => {
      if (!available.ok) return;
      const published = available.data.items.filter((course) => course.publishedVersion !== null);
      setCourses(published);
      setCourseId((current) => current || published[0]?.id || '');
    });
  }, [reload]);

  const openRun = runs?.find((run) => run.id === openRunId) ?? null;
  const review = useMemo(() => {
    if (!openRun || !reviewLessonId) return null;
    for (const section of openRun.sections) {
      const lesson = section.lessons.find((entry) => entry.id === reviewLessonId);
      if (lesson) return lesson;
    }
    return null;
  }, [openRun, reviewLessonId]);

  useEffect(() => {
    if (!openRun || !review?.classroomAssignmentId) {
      setProgress(null);
      return;
    }
    let cancelled = false;
    setProgress(null);
    void api
      .classroomAssignmentProgress(classroomId, review.classroomAssignmentId)
      .then((result) => {
        if (!cancelled) setProgress(result.ok ? result.data.items : []);
      });
    return () => {
      cancelled = true;
    };
  }, [classroomId, openRun, review]);

  async function assign(): Promise<void> {
    if (!courseId || busy) return;
    setBusy(true);
    setError(null);
    const result = await api.assignCourseToClassroom(
      classroomId,
      courseId,
      dueAt ? new Date(dueAt).toISOString() : null,
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    const selected = courses.find((course) => course.id === courseId);
    setNotice(
      result.data.reused
        ? `Срок курса «${selected?.title ?? 'Курс'}» обновлён.`
        : `Курс «${selected?.title ?? 'Курс'}» · v${result.data.versionNumber} назначен классу.`,
    );
    await reload();
    setOpenRunId(result.data.runId);
  }

  if (openRun && review) {
    const assignment = assignmentShape(openRun, review);
    return (
      <section className="classroom-course-detail">
        <button type="button" className="classroom-back" onClick={() => setReviewLessonId(null)}>
          ← К курсу
        </button>
        <div className="assignment-detail-heading">
          <h2>{assignment.title}</h2>
          <p>
            {openRun.title} · v{openRun.versionNumber}
            {openRun.dueAt ? ` · срок ${time.date(openRun.dueAt)}` : ''}
          </p>
        </div>
        <AssignmentView assignment={assignment} />
        {progress === null ? (
          <p role="status">Загружаем работы…</p>
        ) : (
          <ul className="assignment-progress" data-testid="course-assignment-progress">
            {progress.map((row) => (
              <li key={row.seatId}>
                <img
                  src={seatAvatar(row.seatId, row.avatarKey).src}
                  alt=""
                  width={36}
                  height={36}
                />
                <span className="assignment-progress-name">{row.displayLabel}</span>
                <span
                  className={`assignment-state ${
                    canonicalLearningClass(row.canonicalState) ||
                    (row.submittedAt ? 'is-done' : row.startedAt ? 'is-started' : 'is-idle')
                  }`}
                >
                  {canonicalLearningLabel(row.canonicalState) ??
                    (row.submittedAt
                      ? `Сдано ${time.dateTime(row.submittedAt)}`
                      : row.startedAt
                        ? `Работает с ${time.dateTime(row.startedAt)}`
                        : 'Не открывал')}
                </span>
                {row.projectId ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setPreviewing(row)}
                  >
                    Посмотреть работу
                  </button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        )}
        {previewing?.projectId ? (
          <WorkPreview
            projectId={previewing.projectId}
            snapshotRevision={previewing.snapshotRevision}
            moduleKey={assignment.moduleKey}
            learnerName={previewing.displayLabel}
            workTitle={assignment.title}
            submittedAt={previewing.submittedAt}
            assignment={assignment}
            onClose={() => setPreviewing(null)}
            onOpenEditor={() => {
              const projectId = previewing.projectId as string;
              setPreviewing(null);
              onOpenProject(projectId, assignment.moduleKey);
            }}
            onGraded={() => {
              if (!review.classroomAssignmentId) return;
              void api
                .classroomAssignmentProgress(classroomId, review.classroomAssignmentId)
                .then((result) => {
                  if (result.ok) setProgress(result.data.items);
                });
            }}
          />
        ) : null}
      </section>
    );
  }

  if (openRun) {
    return (
      <section className="classroom-course-detail" data-testid="classroom-course-run">
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
          <button
            type="button"
            className="btn-secondary"
            disabled={archived || busy}
            onClick={async () => {
              setBusy(true);
              const next = openRun.status === 'open' ? 'closed' : 'open';
              const result = await api.setClassroomCourseRunStatus(classroomId, openRun.id, next);
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
                    <LessonBlocks blocks={lesson.blocks} legacyContent={lesson.content} compact />
                    {lesson.kind === 'assignment' ? (
                      <div className="classroom-course-assignment-summary">
                        <span>
                          Работают: {lesson.startedCount} из {lesson.seatCount} · Сдали:{' '}
                          {lesson.submittedCount}
                        </span>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setReviewLessonId(lesson.id)}
                        >
                          Проверить работы
                        </button>
                      </div>
                    ) : (
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
          <p>Ученики проходят опубликованную версию; изменения черновика сюда не попадут.</p>
        </div>
      </div>

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
      {courses.length === 0 ? (
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
          <p>Выберите опубликованный курс выше. Отдельные задания остаются на соседней вкладке.</p>
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
