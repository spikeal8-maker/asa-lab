import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { api, type ModuleSummary, type Project } from '../api';
import { CreateProjectModal } from '../components/CreateProjectModal';
import { PlusIcon } from '../electronics/workbench-icons';
import { ModuleGlyph, moduleAccent } from '../modules/ModuleGlyph';

type SortMode = 'recent' | 'title';

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function MyProjectsPage({
  onOpenProject,
}: {
  onOpenProject: (projectId: string) => void;
}): JSX.Element {
  const [items, setItems] = useState<Project[] | null>(null);
  const [modules, setModules] = useState<ModuleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [projectsResult, modulesResult] = await Promise.all([
      api.listProjects({ scope: 'personal' }),
      api.listModules(),
    ]);
    if (!projectsResult.ok || !modulesResult.ok) {
      setError(
        projectsResult.status === 0 || modulesResult.status === 0
          ? 'Сервер недоступен.'
          : 'Не удалось загрузить мастерскую.',
      );
      return;
    }
    setItems(projectsResult.data.items);
    setModules(modulesResult.data.items);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const modulesByKey = useMemo(
    () => new Map((modules ?? []).map((module) => [module.moduleKey, module])),
    [modules],
  );

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru-RU');
    const result = (items ?? []).filter((project) => {
      const matchesModule = moduleFilter === 'all' || project.moduleKey === moduleFilter;
      const matchesQuery =
        normalized.length === 0 || project.title.toLocaleLowerCase('ru-RU').includes(normalized);
      return matchesModule && matchesQuery;
    });
    return [...result].sort((left, right) => {
      if (sortMode === 'title') return left.title.localeCompare(right.title, 'ru');
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
  }, [items, moduleFilter, query, sortMode]);

  function beginRename(project: Project): void {
    setRenamingId(project.id);
    setRenameValue(project.title);
  }

  async function rename(event: FormEvent, projectId: string): Promise<void> {
    event.preventDefault();
    const title = renameValue.trim();
    if (!title) return;
    setRenameBusy(true);
    const result = await api.renameProject(projectId, title);
    setRenameBusy(false);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось переименовать проект.');
      return;
    }
    setItems(
      (current) =>
        current?.map((project) => (project.id === projectId ? result.data.project : project)) ??
        null,
    );
    setRenamingId(null);
  }

  return (
    <main className="portal-content project-hub" id="main-content">
      <section className="portal-hero">
        <div>
          <p className="portal-eyebrow">Личная мастерская педагога</p>
          <h1>Мои проекты</h1>
          <p>
            Создавайте демонстрации во всех доступных средах, сохраняйте версии и готовьте будущие
            задания независимо от классов.
          </p>
        </div>
        <button type="button" className="portal-create-button" onClick={() => setCreating(true)}>
          <PlusIcon /> Создать
        </button>
      </section>

      <section className="project-hub-toolbar" aria-label="Фильтры проектов">
        <label className="project-search">
          <span className="sr-only">Поиск проектов</span>
          <input
            type="search"
            placeholder="Поиск проектов"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Среда проекта</span>
          <select value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value)}>
            <option value="all">Все среды</option>
            {modules?.map((module) => (
              <option key={module.moduleKey} value={module.moduleKey}>
                {module.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Сортировка проектов</span>
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as SortMode)}
          >
            <option value="recent">Сначала новые</option>
            <option value="title">По названию</option>
          </select>
        </label>
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
          <span className="portal-empty-icon" aria-hidden="true">
            +
          </span>
          <h2>Создайте первый проект</h2>
          <p>Выберите учебную среду. Класс для личной работы не требуется.</p>
          <button type="button" className="portal-create-button" onClick={() => setCreating(true)}>
            <PlusIcon /> Создать проект
          </button>
        </section>
      ) : null}

      {items && items.length > 0 && visibleItems.length === 0 ? (
        <section className="portal-empty project-empty">
          <h2>Ничего не найдено</h2>
          <p>Измените поисковый запрос или фильтр среды.</p>
        </section>
      ) : null}

      {visibleItems.length > 0 ? (
        <ul className="project-gallery project-hub-grid" data-testid="personal-project-grid">
          {visibleItems.map((project) => {
            const module = modulesByKey.get(project.moduleKey);
            const style = {
              '--module-accent': moduleAccent(project.moduleKey),
            } as CSSProperties;
            return (
              <li key={project.id} className="project-gallery-card project-hub-card" style={style}>
                <button
                  type="button"
                  className="project-preview project-module-preview"
                  onClick={() => onOpenProject(project.id)}
                >
                  {module ? (
                    <ModuleGlyph module={module} size={64} />
                  ) : (
                    <span aria-hidden="true">?</span>
                  )}
                  <span className="project-preview-label">
                    {module?.displayName ?? project.moduleKey}
                  </span>
                </button>
                <div className="project-card-meta project-card-details">
                  {renamingId === project.id ? (
                    <form
                      className="project-rename-form"
                      onSubmit={(event) => void rename(event, project.id)}
                    >
                      <label className="sr-only" htmlFor={`rename-${project.id}`}>
                        Новое название проекта
                      </label>
                      <input
                        id={`rename-${project.id}`}
                        value={renameValue}
                        maxLength={255}
                        autoFocus
                        onChange={(event) => setRenameValue(event.target.value)}
                      />
                      <div className="project-card-actions">
                        <button type="submit" className="btn-secondary" disabled={renameBusy}>
                          Сохранить
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => setRenamingId(null)}
                        >
                          Отмена
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div>
                        <div className="project-card-badges">
                          <span className="project-visibility-badge">Приватный</span>
                          <span>{module?.displayName ?? project.moduleKey}</span>
                        </div>
                        <h2>{project.title}</h2>
                        <p>Создан {formatDate(project.createdAt)}</p>
                      </div>
                      <div className="project-card-actions">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => onOpenProject(project.id)}
                        >
                          Открыть
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => beginRename(project)}
                        >
                          Переименовать
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </li>
            );
          })}
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
