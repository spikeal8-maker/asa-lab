import { useCallback, useEffect, useState } from 'react';
import { api, type Project } from '../api';
import { CreateProjectModal } from '../components/CreateProjectModal';
import { CircuitIcon, PlusIcon } from '../electronics/workbench-icons';

export function MyProjectsPage({
  onOpenProject,
}: {
  onOpenProject: (projectId: string) => void;
}): JSX.Element {
  const [items, setItems] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const result = await api.listProjects({ scope: 'personal' });
    if (result.ok) setItems(result.data.items);
    else setError(result.status === 0 ? 'Сервер недоступен.' : 'Не удалось загрузить проекты.');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // tabIndex makes this landmark a valid skip-link target.
  return (
    <main className="portal-content" id="main-content" tabIndex={-1}>
      <section className="portal-hero">
        <div>
          <p className="portal-eyebrow">Личная мастерская педагога</p>
          <h1>Мои проекты</h1>
          <p>
            Создавайте демонстрации, экспериментируйте и готовьте будущие задания независимо от
            классов.
          </p>
        </div>
        <button type="button" className="portal-create-button" onClick={() => setCreating(true)}>
          <PlusIcon /> Создать
        </button>
      </section>

      {error ? (
        <div className="portal-empty" role="alert">
          <p>{error}</p>
          <button className="btn-secondary" onClick={() => void load()}>
            Повторить
          </button>
        </div>
      ) : null}
      {items === null && !error ? (
        <div className="project-gallery loading" aria-label="Загрузка проектов">
          <div />
          <div />
          <div />
        </div>
      ) : null}
      {items?.length === 0 ? (
        <section className="portal-empty project-empty">
          <span className="portal-empty-icon">
            <CircuitIcon />
          </span>
          <h2>Создайте первый проект</h2>
          <p>Начните с электронной схемы. Класс для личной работы не требуется.</p>
          <button type="button" className="portal-create-button" onClick={() => setCreating(true)}>
            <PlusIcon /> Создать проект
          </button>
        </section>
      ) : null}
      {items && items.length > 0 ? (
        <ul className="project-gallery" data-testid="personal-project-grid">
          {items.map((project) => (
            <li key={project.id} className="project-gallery-card">
              <button
                type="button"
                className="project-preview"
                onClick={() => onOpenProject(project.id)}
              >
                <span className="project-preview-grid" aria-hidden="true">
                  <CircuitIcon />
                </span>
              </button>
              <div className="project-card-meta">
                <div>
                  <h2>{project.title}</h2>
                  <p>Электроника · личный проект</p>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => onOpenProject(project.id)}
                >
                  Открыть
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {creating ? (
        <CreateProjectModal
          scope="personal"
          onClose={() => setCreating(false)}
          onCreated={(project) => {
            setCreating(false);
            onOpenProject(project.id);
          }}
        />
      ) : null}
    </main>
  );
}
