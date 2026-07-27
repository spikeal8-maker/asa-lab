import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type Project } from '../api';

export function ProjectsPage({
  classroomId,
  classroomTitle,
  onBack,
  onOpenProject,
}: {
  classroomId: string;
  classroomTitle: string;
  onBack: () => void;
  onOpenProject: (projectId: string) => void;
}): JSX.Element {
  const [items, setItems] = useState<Project[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    const response = await api.listProjects(classroomId);
    if (response.ok) {
      setItems(response.data.items);
    } else {
      setFailed(true);
    }
  }, [classroomId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Введите название проекта.');
      return;
    }
    setBusy(true);
    const response = await api.createProject(classroomId, trimmed, crypto.randomUUID());
    setBusy(false);
    if (response.ok) {
      setCreating(false);
      setTitle('');
      setError(null);
      onOpenProject(response.data.project.id);
      return;
    }
    setError(response.error.message || 'Не удалось создать проект.');
  }

  return (
    <main className="content">
      <div className="content-head">
        <div>
          <button type="button" className="btn-ghost" onClick={onBack}>
            ← Классы
          </button>
          <h1>Проекты · {classroomTitle}</h1>
        </div>
        <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
          Создать проект
        </button>
      </div>

      {creating ? (
        <form className="inline-form" onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor="project-title">Название проекта</label>
          <input
            id="project-title"
            value={title}
            autoFocus
            maxLength={255}
            onChange={(event) => setTitle(event.target.value)}
          />
          <fieldset className="module-choice">
            <legend>Тип проекта</legend>
            <label htmlFor="module-electronics">
              <input
                id="module-electronics"
                type="radio"
                name="module"
                value="electronics"
                defaultChecked
              />
              Электроника
            </label>
          </fieldset>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setCreating(false)}
              disabled={busy}
            >
              Отмена
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Создаём…' : 'Создать'}
            </button>
          </div>
        </form>
      ) : null}

      {failed ? (
        <div className="empty-state" role="alert">
          <p>Не удалось загрузить проекты.</p>
          <button type="button" className="btn-secondary" onClick={() => void load()}>
            Повторить
          </button>
        </div>
      ) : null}

      {items && items.length === 0 && !failed ? (
        <div className="empty-state">
          <p>Проектов пока нет.</p>
          <p className="muted">Создайте проект «Электроника», чтобы собрать первую схему.</p>
        </div>
      ) : null}

      {items && items.length > 0 ? (
        <ul className="card-grid" data-testid="project-grid">
          {items.map((item) => (
            <li key={item.id} className="card" data-testid="project-card">
              <h2>{item.title}</h2>
              <p className="muted">Электроника</p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onOpenProject(item.id)}
              >
                Открыть редактор
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </main>
  );
}
