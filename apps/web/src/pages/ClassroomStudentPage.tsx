import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type ClassroomActivityEntry,
  type ClassroomStudentDetail,
  type ModuleSummary,
  type Project,
} from '../api';
import { ProjectCard } from '../modules/ProjectCard';
import { ClassroomActivityList } from '../components/ClassroomActivityList';
import './classroom-student.css';

/**
 * One learner, as their teacher sees them.
 *
 * A register says who is in the class. This says how someone is getting on:
 * what they have made, when they were last here, and what they have been doing
 * — which is the question a teacher actually walks into the room with.
 *
 * The works are shown with the same card the learner sees, because they are the
 * same works. What the teacher gets that the learner does not is the ability to
 * open one and correct it, and a note on any work a teacher has already touched.
 */

function lastSeen(value: string | null): string {
  if (!value) return 'ещё не заходил';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'ещё не заходил';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** The card component speaks in projects; a learner's work is one. */
function asProject(work: ClassroomStudentDetail['projects'][number]): Project {
  return {
    id: work.id,
    scope: 'personal',
    classroomId: null,
    moduleKey: work.moduleKey,
    title: work.title,
    status: work.status,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
    preview: work.preview,
    snapshotRevision: work.snapshotRevision,
  };
}

export function ClassroomStudentPage({
  classroomId,
  classroomTitle,
  seatId,
  onBack,
  onOpenProject,
}: {
  readonly classroomId: string;
  readonly classroomTitle: string;
  readonly seatId: string;
  readonly onBack: () => void;
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
}): JSX.Element {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; detail: ClassroomStudentDetail }
  >({ kind: 'loading' });
  // The card names the environment; without the catalogue it would print the
  // module key at a learner's teacher, which is an identifier, not a name.
  const [modules, setModules] = useState<readonly ModuleSummary[]>([]);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    const result = await api.classroomStudent(classroomId, seatId);
    setState(
      result.ok
        ? { kind: 'ready', detail: result.data }
        : { kind: 'error', message: result.error.message || 'Не удалось открыть ученика.' },
    );
  }, [classroomId, seatId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void api.listModules().then((result) => {
      if (result.ok) setModules(result.data.items);
    });
  }, []);

  if (state.kind === 'loading') {
    return (
      <main className="portal-content" id="main-content" tabIndex={-1} role="status">
        Загружаем страницу ученика…
      </main>
    );
  }

  if (state.kind === 'error') {
    return (
      <main className="portal-content" id="main-content" tabIndex={-1}>
        <section className="portal-empty" role="alert">
          <p>{state.message}</p>
          <button type="button" className="btn-secondary" onClick={onBack}>
            К классу
          </button>
        </section>
      </main>
    );
  }

  const { student, projects, activity } = state.detail;
  const projectEntries: ClassroomActivityEntry[] = activity.filter(
    (entry) => entry.projectId !== null,
  );

  return (
    <main className="portal-content classroom-student" id="main-content" tabIndex={-1}>
      <button type="button" className="portal-back" onClick={onBack}>
        ← {classroomTitle}
      </button>

      <section className="portal-hero classroom-student-hero">
        <div>
          <p className="portal-eyebrow">Ученик класса</p>
          <h1>{student.displayLabel}</h1>
          <p>
            Вход: <code>{student.loginHandle}</code> · последний раз{' '}
            {lastSeen(student.lastActiveAt)}
          </p>
        </div>
        <div className="classroom-student-badges">
          {student.safeMode ? (
            <span className="classroom-student-badge">Безопасный режим</span>
          ) : null}
          {student.status === 'suspended' ? (
            <span className="classroom-student-badge is-warning">Доступ приостановлен</span>
          ) : null}
        </div>
      </section>

      <section className="classroom-student-section" aria-labelledby="student-works">
        <h2 id="student-works">Работы · {projects.length}</h2>
        {projects.length === 0 ? (
          <p className="classroom-student-empty">
            Ученик ещё ничего не создал. Здесь появятся его работы, как только он начнёт.
          </p>
        ) : (
          <ul className="project-card-grid">
            {projects.map((work) => (
              <ProjectCard
                key={work.id}
                project={asProject(work)}
                module={modules.find((entry) => entry.moduleKey === work.moduleKey)}
                timeLabel={`Изменён ${new Intl.DateTimeFormat('ru-RU', {
                  day: 'numeric',
                  month: 'short',
                }).format(new Date(work.updatedAt))}`}
                footerLabel={work.lastEditedByTeacher ? 'Правил педагог' : 'Работа ученика'}
                primaryLabel="Открыть"
                open={{
                  href: `#/projects/${work.id}`,
                  onNavigate: () => onOpenProject(work.id, work.moduleKey),
                }}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="classroom-student-section" aria-labelledby="student-activity">
        <h2 id="student-activity">Что делает</h2>
        <ClassroomActivityList entries={activity} emptyText="Пока никаких действий." />
        <p className="classroom-student-note">
          Записей о работе: {projectEntries.length}. Повторная работа над одним проектом за короткое
          время собирается в одну строку со счётчиком.
        </p>
      </section>
    </main>
  );
}
