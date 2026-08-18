import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  api,
  type ClassroomActivityEntry,
  type ClassroomStudentDetail,
  type ModuleSummary,
  type Project,
  type ProjectFeedback,
} from '../api';
import { ProjectCard } from '../modules/ProjectCard';
import { ClassroomActivityList } from '../components/ClassroomActivityList';
import { useSchoolTime } from '../components/school-time';
import { seatAvatar } from '../creator-portal/default-avatars';
import { SeatAwardPanel, SeatAwardRow } from '../components/SeatAwards';
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

/**
 * The verdicts a teacher can give. A fixed set rather than free text: a badge
 * means the same thing in every class, so a learner who has met it before knows
 * what it says, and a teacher giving thirty of them in a lesson is not writing.
 */
const BADGES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'excellent', label: 'Отлично' },
  { value: 'good', label: 'Хорошо' },
  { value: 'progress', label: 'Есть прогресс' },
  { value: 'redo', label: 'Нужно доделать' },
];

export const BADGE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  BADGES.map((badge) => [badge.value, badge.label]),
);

function FeedbackDialog({
  work,
  current,
  onClose,
  onSaved,
}: {
  readonly work: { readonly id: string; readonly title: string };
  readonly current: ProjectFeedback | null;
  readonly onClose: () => void;
  readonly onSaved: (feedback: ProjectFeedback) => void;
}): JSX.Element {
  const [badge, setBadge] = useState<string | null>(current?.badge ?? null);
  const [comment, setComment] = useState(current?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (badge === null && !comment.trim()) {
      setError('Поставьте значок или напишите комментарий.');
      return;
    }
    setBusy(true);
    const result = await api.saveProjectFeedback(work.id, { badge, comment });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось сохранить отклик.');
      return;
    }
    onSaved(result.data.feedback);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Отклик: ${work.title}`}>
        <h2>Отклик на «{work.title}»</h2>
        <p>Значок ученик увидит сразу, комментарий — когда откроет работу.</p>
        <form onSubmit={(event) => void submit(event)}>
          <div className="feedback-badges" role="group" aria-label="Значок">
            {BADGES.map((option) => (
              <button
                type="button"
                key={option.value}
                className={badge === option.value ? 'active' : undefined}
                aria-pressed={badge === option.value}
                onClick={() => setBadge(badge === option.value ? null : option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label htmlFor="feedback-comment">Комментарий</label>
          <textarea
            id="feedback-comment"
            rows={4}
            maxLength={1000}
            value={comment}
            disabled={busy}
            placeholder="Что получилось и что стоит поправить"
            onChange={(event) => setComment(event.target.value)}
          />
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Сохраняем…' : 'Сохранить отклик'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const BADGE_TONES = new Set(['excellent', 'good', 'progress', 'redo']);

/** Which colour the footer mark takes: the verdict if there is one, otherwise
 * the note that a teacher has been in the work. Untouched work has no mark. */
function markTone(
  entry: ProjectFeedback | null,
  editedByTeacher: boolean,
): 'excellent' | 'good' | 'progress' | 'redo' | 'teacher' | undefined {
  if (entry?.badge && BADGE_TONES.has(entry.badge)) {
    return entry.badge as 'excellent' | 'good' | 'progress' | 'redo';
  }
  return editedByTeacher ? 'teacher' : undefined;
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
    // The register does not carry provenance; the card treats that as "made here".
    copiedFrom: null,
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
  // Responses already given, so a teacher revises rather than starts again.
  const [feedback, setFeedback] = useState<Readonly<Record<string, ProjectFeedback>>>({});
  const [responding, setResponding] = useState<{ id: string; title: string } | null>(null);
  const time = useSchoolTime();
  const [awardKeys, setAwardKeys] = useState<readonly string[]>([]);

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

  // Existing responses, fetched per work once the list is known.
  useEffect(() => {
    if (state.kind !== 'ready') return;
    let cancelled = false;
    void Promise.all(
      state.detail.projects.map(async (work) => {
        const result = await api.projectFeedback(work.id);
        return [work.id, result.ok ? (result.data.items[0] ?? null) : null] as const;
      }),
    ).then((pairs) => {
      if (cancelled) return;
      const next: Record<string, ProjectFeedback> = {};
      for (const [id, entry] of pairs) if (entry) next[id] = entry;
      setFeedback(next);
    });
    return () => {
      cancelled = true;
    };
  }, [state]);

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

  const { student, projects, activity, submittedCount, awaitingReview } = state.detail;
  const projectEntries: ClassroomActivityEntry[] = activity.filter(
    (entry) => entry.projectId !== null,
  );

  return (
    <main className="portal-content classroom-student" id="main-content" tabIndex={-1}>
      {/* Возврат в класс — обычная заметная кнопка. Тонкая ссылка размером с
          строку читалась как подпись, и преподаватели её не находили. */}
      <button type="button" className="classroom-student-back" onClick={onBack}>
        <span aria-hidden="true">←</span> {classroomTitle}
      </button>

      {/* The same face as in the register, at the size a page deserves: a
          teacher arriving here has just clicked a name and should land on the
          same person, not on a form. */}
      <section className="classroom-student-hero">
        <img
          className="classroom-student-avatar"
          src={seatAvatar(student.id, student.avatarKey).src}
          alt=""
          width={64}
          height={64}
        />
        <div className="classroom-student-identity">
          <p className="portal-eyebrow">Ученик класса</p>
          <h1>{student.displayLabel}</h1>
          <p>
            Вход: <code>{student.loginHandle}</code> · последний раз{' '}
            {student.lastActiveAt ? time.longDateTime(student.lastActiveAt) : 'ещё не заходил'}
          </p>

          {/* Три числа, ради которых преподаватель сюда и пришёл. */}
          <ul className="classroom-student-stats">
            <li>
              <strong>{projects.length}</strong>
              <span>работ</span>
            </li>
            <li>
              <strong>{submittedCount}</strong>
              <span>сдано</span>
            </li>
            <li className={awaitingReview > 0 ? 'is-waiting' : undefined}>
              <strong>{awaitingReview}</strong>
              <span>ждут ответа</span>
            </li>
          </ul>
          <div className="classroom-student-badges">
            <SeatAwardRow keys={awardKeys} />
            {student.safeMode ? (
              <span className="classroom-student-badge">Безопасный режим</span>
            ) : null}
            {student.status === 'suspended' ? (
              <span className="classroom-student-badge is-warning">Доступ приостановлен</span>
            ) : null}
          </div>
        </div>
      </section>

      {/* What they made, and what they did — side by side on a laptop, one
          under the other on a phone. */}
      <div className="classroom-student-columns">
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
                  timeLabel={`Изменён ${time.shortDate(work.updatedAt)}`}
                  footerLabel={
                    feedback[work.id]?.badge
                      ? (BADGE_LABELS[feedback[work.id]!.badge!] ?? 'Отклик есть')
                      : work.lastEditedByTeacher
                        ? 'Правил педагог'
                        : 'Работа ученика'
                  }
                  footerTone={markTone(feedback[work.id] ?? null, work.lastEditedByTeacher)}
                  primaryLabel="Открыть"
                  open={{
                    href: `#/projects/${work.id}`,
                    onNavigate: () => onOpenProject(work.id, work.moduleKey),
                  }}
                  menuItems={[
                    {
                      label: feedback[work.id] ? 'Изменить отклик' : 'Оценить работу',
                      onSelect: () => setResponding({ id: work.id, title: work.title }),
                    },
                  ]}
                />
              ))}
            </ul>
          )}
        </section>

        <section
          className="classroom-student-section classroom-student-record"
          aria-labelledby="student-activity"
        >
          <h2 id="student-activity">Что делает</h2>
          <ClassroomActivityList entries={activity} emptyText="Пока никаких действий." />
          <p className="classroom-student-note">
            Записей о работе: {projectEntries.length}. Повторная работа над одним проектом за
            короткое время собирается в одну строку со счётчиком.
          </p>
        </section>
      </div>

      {/* What this learner has been noticed for. Below their work, because the
          work is the evidence and the badge is the conclusion. */}
      <SeatAwardPanel classroomId={classroomId} seatId={seatId} onChanged={setAwardKeys} />

      {responding ? (
        <FeedbackDialog
          work={responding}
          current={feedback[responding.id] ?? null}
          onClose={() => setResponding(null)}
          onSaved={(entry) => {
            setFeedback((current) => ({ ...current, [responding.id]: entry }));
            setResponding(null);
          }}
        />
      ) : null}
    </main>
  );
}
