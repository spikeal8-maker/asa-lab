import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  api,
  type ClassroomAssignment,
  type ClassroomAssignmentProgress,
  type ModuleSummary,
} from '../api';
import { useSchoolTime } from './school-time';
import { seatAvatar } from '../creator-portal/default-avatars';
import './classroom-assignments.css';

/**
 * Work a teacher sets, and how the class is getting on with it.
 *
 * Two numbers per assignment, because a class asks two questions. "Started" is
 * how many opened it at all — the one that finds the child who is stuck before
 * the lesson ends. "Handed in" is how many decided they were done. Neither can
 * be derived from the other: a learner who has been working for twenty minutes
 * has not finished, and one who pressed the button has stopped asking for help.
 *
 * Opening an assignment shows the register against it, including the learners
 * who never opened it — the empty row is the one that matters.
 */

function AssignmentDialog({
  modules,
  onClose,
  onCreate,
}: {
  readonly modules: readonly ModuleSummary[];
  readonly onClose: () => void;
  readonly onCreate: (input: {
    title: string;
    brief: string | null;
    moduleKey: string;
    dueAt: string | null;
  }) => Promise<string | null>;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [moduleKey, setModuleKey] = useState(modules[0]?.moduleKey ?? '');
  const [dueAt, setDueAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim()) {
      setError('Введите название задания.');
      return;
    }
    if (!moduleKey) {
      setError('Выберите среду, в которой ученики будут работать.');
      return;
    }
    setBusy(true);
    const message = await onCreate({
      title: title.trim(),
      brief: brief.trim() || null,
      moduleKey,
      // A date without a time means the end of that day, which is what a
      // teacher writing "до пятницы" means.
      dueAt: dueAt ? new Date(`${dueAt}T23:59:59`).toISOString() : null,
    });
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="assignment-heading">
        <h2 id="assignment-heading">Новое задание</h2>
        <p>Каждый ученик получит свою копию работы в выбранной среде.</p>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="assignment-title">Название</label>
          <input
            id="assignment-title"
            autoFocus
            maxLength={255}
            value={title}
            disabled={busy}
            placeholder="Брелок с именем"
            onChange={(event) => setTitle(event.target.value)}
          />
          <label htmlFor="assignment-module">Среда</label>
          <select
            id="assignment-module"
            value={moduleKey}
            disabled={busy}
            onChange={(event) => setModuleKey(event.target.value)}
          >
            {modules.map((module) => (
              <option key={module.moduleKey} value={module.moduleKey}>
                {module.displayName}
              </option>
            ))}
          </select>
          <label htmlFor="assignment-brief">Что нужно сделать</label>
          <textarea
            id="assignment-brief"
            rows={5}
            maxLength={4000}
            value={brief}
            disabled={busy}
            placeholder="Можно оставить пустым, если объяснили на уроке."
            onChange={(event) => setBrief(event.target.value)}
          />
          <label htmlFor="assignment-due">Срок сдачи</label>
          <input
            id="assignment-due"
            type="date"
            value={dueAt}
            disabled={busy}
            onChange={(event) => setDueAt(event.target.value)}
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
              {busy ? 'Создаём…' : 'Выдать классу'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ClassroomAssignments({
  classroomId,
  archived,
  onOpenProject,
}: {
  readonly classroomId: string;
  readonly archived: boolean;
  readonly onOpenProject: (projectId: string, moduleKey: string) => void;
}): JSX.Element {
  const [items, setItems] = useState<ClassroomAssignment[] | null>(null);
  const [modules, setModules] = useState<readonly ModuleSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<ClassroomAssignment | null>(null);
  const [progress, setProgress] = useState<ClassroomAssignmentProgress[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const time = useSchoolTime();

  const reload = useCallback(async () => {
    const result = await api.listClassroomAssignments(classroomId);
    setItems(result.ok ? result.data.items : []);
  }, [classroomId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void api.listModules().then((result) => {
      if (result.ok) {
        setModules(
          result.data.items.filter((entry) => entry.availability === 'active' && entry.creatable),
        );
      }
    });
  }, []);

  useEffect(() => {
    if (!open) {
      setProgress(null);
      return;
    }
    let cancelled = false;
    setProgress(null);
    void api.classroomAssignmentProgress(classroomId, open.id).then((result) => {
      if (!cancelled) setProgress(result.ok ? result.data.items : []);
    });
    return () => {
      cancelled = true;
    };
  }, [classroomId, open]);

  const moduleName = (key: string): string =>
    modules.find((entry) => entry.moduleKey === key)?.displayName ?? key;

  if (open) {
    return (
      <section className="classroom-tab-panel">
        <button type="button" className="classroom-back" onClick={() => setOpen(null)}>
          ← Все задания
        </button>
        <div className="assignment-detail-heading">
          <h2>{open.title}</h2>
          <p>
            {moduleName(open.moduleKey)}
            {open.dueAt ? ` · срок ${time.date(open.dueAt)}` : ''}
            {open.status === 'closed' ? ' · закрыто' : ''}
          </p>
          {open.brief ? <p className="assignment-brief">{open.brief}</p> : null}
        </div>

        {progress === null ? (
          <p role="status">Загружаем…</p>
        ) : (
          <ul className="assignment-progress" data-testid="assignment-progress">
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
                    row.submittedAt ? 'is-done' : row.startedAt ? 'is-started' : 'is-idle'
                  }`}
                >
                  {row.submittedAt
                    ? `Сдано ${time.dateTime(row.submittedAt)}`
                    : row.startedAt
                      ? `Работает с ${time.dateTime(row.startedAt)}`
                      : 'Не открывал'}
                </span>
                {row.projectId ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onOpenProject(row.projectId as string, open.moduleKey)}
                  >
                    Открыть работу
                  </button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <section className="classroom-tab-panel">
      <div className="assignment-heading">
        <div>
          <h2>Задания класса</h2>
          <p>Каждый ученик получает свою копию работы. Прогресс виден сразу.</p>
        </div>
        <button
          type="button"
          className="portal-create-button"
          disabled={archived || modules.length === 0}
          onClick={() => setCreating(true)}
        >
          Новое задание
        </button>
      </div>

      {notice ? (
        <p className="notice-success" role="status">
          {notice}
        </p>
      ) : null}

      {items === null ? (
        <p role="status">Загружаем задания…</p>
      ) : items.length === 0 ? (
        <div className="classroom-roster-empty">
          <h3>Заданий пока нет</h3>
          <p>Выдайте первое — ученики увидят его на своей главной странице.</p>
        </div>
      ) : (
        <ul className="assignment-list" data-testid="assignment-list">
          {items.map((assignment) => (
            <li key={assignment.id}>
              <button
                type="button"
                className="assignment-title"
                onClick={() => setOpen(assignment)}
              >
                {assignment.title}
                {assignment.status === 'closed' ? <em>закрыто</em> : null}
              </button>
              <span className="assignment-module">{moduleName(assignment.moduleKey)}</span>
              <span className="assignment-counts">
                Работают: {assignment.startedCount} из {assignment.seatCount} · Сдали:{' '}
                {assignment.submittedCount}
              </span>
              <span className="assignment-due">
                {assignment.dueAt ? `Срок ${time.date(assignment.dueAt)}` : 'Без срока'}
              </span>
              <button
                type="button"
                className="btn-secondary"
                disabled={archived}
                onClick={async () => {
                  const next = assignment.status === 'open' ? 'closed' : 'open';
                  const result = await api.setClassroomAssignmentStatus(
                    classroomId,
                    assignment.id,
                    next,
                  );
                  if (result.ok) {
                    setNotice(
                      next === 'closed'
                        ? 'Задание закрыто. Начатые работы останутся у учеников.'
                        : 'Задание снова открыто.',
                    );
                    await reload();
                  }
                }}
              >
                {assignment.status === 'open' ? 'Закрыть' : 'Открыть'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <AssignmentDialog
          modules={modules}
          onClose={() => setCreating(false)}
          onCreate={async (input) => {
            const result = await api.createClassroomAssignment(classroomId, input);
            if (!result.ok) return result.error.message || 'Не удалось создать задание.';
            setCreating(false);
            setNotice(`Задание «${result.data.assignment.title}» выдано классу.`);
            await reload();
            return null;
          }}
        />
      ) : null}
    </section>
  );
}
