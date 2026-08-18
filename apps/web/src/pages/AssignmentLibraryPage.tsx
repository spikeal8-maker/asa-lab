import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type AssignmentClassroom, type LibraryAssignment, type ModuleSummary } from '../api';
import { useSchoolTime } from '../components/school-time';
import '../components/classroom-assignments.css';
import './assignment-library.css';

/**
 * A teacher's own tasks.
 *
 * The task belongs to the person who wrote it, not to a class. That is the
 * difference between a product a teacher uses for one term and one they use for
 * years: the same work goes to this year's classes and next year's, the wording
 * is corrected in one place, and September does not start with retyping.
 *
 * Handing out is the only thing that involves a class, so it is one dialog with
 * a tick per class and a date — not a trip into each class in turn.
 */

function EditorDialog({
  assignment,
  modules,
  onClose,
  onSave,
}: {
  readonly assignment: LibraryAssignment | null;
  readonly modules: readonly ModuleSummary[];
  readonly onClose: () => void;
  readonly onSave: (input: {
    title: string;
    brief: string | null;
    moduleKey: string;
  }) => Promise<string | null>;
}): JSX.Element {
  const [title, setTitle] = useState(assignment?.title ?? '');
  const [brief, setBrief] = useState(assignment?.brief ?? '');
  const [moduleKey, setModuleKey] = useState(assignment?.moduleKey ?? modules[0]?.moduleKey ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim()) {
      setError('Введите название задания.');
      return;
    }
    setBusy(true);
    const message = await onSave({
      title: title.trim(),
      brief: brief.trim() || null,
      moduleKey,
    });
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="library-edit-heading">
        <h2 id="library-edit-heading">{assignment ? 'Задание' : 'Новое задание'}</h2>
        <p>
          {assignment
            ? 'Изменения увидят все классы, которым это задание выдано.'
            : 'Задание останется у вас и его можно выдать любым классам.'}
        </p>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="library-title">Название</label>
          <input
            id="library-title"
            autoFocus
            maxLength={255}
            value={title}
            disabled={busy}
            placeholder="Брелок с именем"
            onChange={(event) => setTitle(event.target.value)}
          />
          <label htmlFor="library-module">Среда</label>
          <select
            id="library-module"
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
          <label htmlFor="library-brief">Что нужно сделать</label>
          <textarea
            id="library-brief"
            rows={8}
            maxLength={4000}
            value={brief}
            disabled={busy}
            onChange={(event) => setBrief(event.target.value)}
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
              {busy ? 'Сохраняем…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function HandOutDialog({
  assignment,
  onClose,
  onChanged,
}: {
  readonly assignment: LibraryAssignment;
  readonly onClose: () => void;
  readonly onChanged: () => void;
}): JSX.Element {
  const [items, setItems] = useState<AssignmentClassroom[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const result = await api.assignmentClassrooms(assignment.id);
    setItems(result.ok ? result.data.items : []);
  }, [assignment.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function toggle(row: AssignmentClassroom, given: boolean): Promise<void> {
    setBusy(row.classroomId);
    await api.handOutAssignment(assignment.id, row.classroomId, given, row.dueAt);
    setBusy(null);
    await reload();
    onChanged();
  }

  async function setDue(row: AssignmentClassroom, dueAt: string | null): Promise<void> {
    setBusy(row.classroomId);
    await api.handOutAssignment(assignment.id, row.classroomId, true, dueAt);
    setBusy(null);
    await reload();
    onChanged();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="hand-out-heading">
        <h2 id="hand-out-heading">Кому выдать</h2>
        <p>«{assignment.title}» — отметьте классы. Срок можно задать для каждого свой.</p>
        {items === null ? (
          <p role="status">Загружаем классы…</p>
        ) : items.length === 0 ? (
          <p className="account-hint">У вас пока нет классов.</p>
        ) : (
          <ul className="hand-out-list" data-testid="hand-out-list">
            {items.map((row) => (
              <li key={row.classroomId}>
                <label>
                  <input
                    type="checkbox"
                    checked={row.handedOut}
                    disabled={busy === row.classroomId}
                    onChange={(event) => void toggle(row, event.target.checked)}
                  />
                  <span>{row.classroomTitle}</span>
                </label>
                <input
                  type="date"
                  aria-label={`Срок сдачи: ${row.classroomTitle}`}
                  disabled={!row.handedOut || busy === row.classroomId}
                  value={row.dueAt ? row.dueAt.slice(0, 10) : ''}
                  onChange={(event) =>
                    void setDue(
                      row,
                      event.target.value
                        ? new Date(`${event.target.value}T23:59:59`).toISOString()
                        : null,
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}

export function AssignmentLibraryPage(): JSX.Element {
  const [items, setItems] = useState<LibraryAssignment[] | null>(null);
  const [modules, setModules] = useState<readonly ModuleSummary[]>([]);
  const [editing, setEditing] = useState<LibraryAssignment | null | 'new'>(null);
  const [handingOut, setHandingOut] = useState<LibraryAssignment | null>(null);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const time = useSchoolTime();

  const reload = useCallback(async () => {
    const result = await api.listAssignmentLibrary();
    setItems(result.ok ? result.data.items : []);
  }, []);

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

  const moduleName = (key: string): string =>
    modules.find((entry) => entry.moduleKey === key)?.displayName ?? key;

  const needle = search.trim().toLocaleLowerCase('ru-RU');
  const visible = (items ?? []).filter(
    (entry) =>
      needle.length === 0 ||
      entry.title.toLocaleLowerCase('ru-RU').includes(needle) ||
      (entry.brief ?? '').toLocaleLowerCase('ru-RU').includes(needle),
  );

  return (
    <main id="main-content" className="portal-content" tabIndex={-1}>
      <header className="library-heading">
        <div>
          <h1>Задания</h1>
          <p>Ваши задания. Написали один раз — выдаёте любым классам, в этом году и в следующем.</p>
        </div>
        <button type="button" className="portal-create-button" onClick={() => setEditing('new')}>
          Новое задание
        </button>
      </header>

      {notice ? (
        <p className="notice-success" role="status">
          {notice}
        </p>
      ) : null}

      <label className="library-search">
        <span className="sr-only">Поиск заданий</span>
        <input
          type="search"
          placeholder="Поиск по названию или описанию"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>

      {items === null ? (
        <p role="status">Загружаем задания…</p>
      ) : visible.length === 0 ? (
        <div className="classroom-roster-empty">
          <h3>{needle ? 'Ничего не найдено' : 'Заданий пока нет'}</h3>
          <p>Напишите первое — потом его можно будет выдать сразу нескольким классам.</p>
        </div>
      ) : (
        <ul className="library-list" data-testid="assignment-library">
          {visible.map((assignment) => (
            <li key={assignment.id}>
              {assignment.sampleImage ? (
                <img src={assignment.sampleImage} alt="" width={72} height={72} loading="lazy" />
              ) : (
                <span className="library-no-sample" aria-hidden="true" />
              )}
              <div className="library-copy">
                <strong>
                  {assignment.title}
                  {assignment.isDemo ? <em>пример</em> : null}
                </strong>
                <span>
                  {moduleName(assignment.moduleKey)} · создано {time.date(assignment.createdAt)}
                </span>
                <span className="library-counts">
                  {assignment.handoutCount === 0
                    ? 'Не выдано ни одному классу'
                    : `Выдано классам: ${assignment.handoutCount} · работают: ${assignment.startedCount} · сдали: ${assignment.submittedCount}`}
                </span>
              </div>
              <div className="library-actions">
                <button
                  type="button"
                  className="portal-create-button"
                  onClick={() => setHandingOut(assignment)}
                >
                  Выдать классам
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditing(assignment)}
                >
                  Изменить
                </button>
                <button
                  type="button"
                  className="assignment-remove"
                  onClick={async () => {
                    if (
                      !window.confirm(
                        `Удалить «${assignment.title}» из ваших заданий? Оно пропадёт и у классов, которым выдано. Работы учеников останутся у них.`,
                      )
                    )
                      return;
                    const result = await api.deleteLibraryAssignment(assignment.id);
                    if (result.ok) {
                      setNotice(`Задание «${assignment.title}» удалено.`);
                      await reload();
                    }
                  }}
                >
                  Удалить
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <EditorDialog
          assignment={editing === 'new' ? null : editing}
          modules={modules}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            const result = await api.saveLibraryAssignment(
              editing === 'new' ? null : editing.id,
              input,
            );
            if (!result.ok) return result.error.message || 'Не удалось сохранить задание.';
            setEditing(null);
            setNotice(`Задание «${input.title}» сохранено.`);
            await reload();
            return null;
          }}
        />
      ) : null}

      {handingOut ? (
        <HandOutDialog
          assignment={handingOut}
          onClose={() => setHandingOut(null)}
          onChanged={() => void reload()}
        />
      ) : null}
    </main>
  );
}
