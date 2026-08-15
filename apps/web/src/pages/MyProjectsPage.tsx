import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { api, type ModuleSummary, type Project, type ProjectStatus } from '../api';
import { CreateProjectModal } from '../components/CreateProjectModal';
import { PortalLink } from '../components/PortalLink';
import { creatorViewToHref } from '../creator-portal/navigation';
import { PlusIcon } from '../electronics/workbench-icons';
import { ModuleGlyph, moduleAccent } from '../modules/ModuleGlyph';

type SortMode = 'recent' | 'oldest' | 'title';
type LayoutMode = 'grid' | 'list';

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

const STATUS_TABS: ReadonlyArray<{ value: ProjectStatus; label: string }> = [
  { value: 'active', label: 'Проекты' },
  { value: 'archived', label: 'Архив' },
  { value: 'trashed', label: 'Корзина' },
];

export function MyProjectsPage({
  onOpenProject,
}: {
  onOpenProject: (projectId: string, moduleKey: string) => void;
}): JSX.Element {
  const [items, setItems] = useState<Project[] | null>(null);
  const [modules, setModules] = useState<ModuleSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<ProjectStatus>('active');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [layout, setLayout] = useState<LayoutMode>('grid');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setItems(null);
    setError(null);
    const [projectsResult, modulesResult] = await Promise.all([
      api.listProjects({ scope: 'personal', status: statusFilter }),
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
  }, [statusFilter]);

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
      const direction = sortMode === 'oldest' ? 1 : -1;
      return direction * (new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime());
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

  async function changeStatus(project: Project, status: ProjectStatus): Promise<void> {
    setActionBusy(project.id);
    setError(null);
    const result = await api.changeProjectStatus(project.id, status);
    setActionBusy(null);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось изменить состояние проекта.');
      return;
    }
    setItems((current) => current?.filter((item) => item.id !== project.id) ?? null);
  }

  async function duplicate(project: Project): Promise<void> {
    setActionBusy(project.id);
    setError(null);
    const result = await api.duplicateProject(
      project.id,
      `${project.title} — копия`,
      `duplicate-${project.id}-${crypto.randomUUID()}`,
    );
    setActionBusy(null);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось создать копию проекта.');
      return;
    }
    setItems((current) => (current ? [result.data.project, ...current] : [result.data.project]));
  }

  return (
    <main className="portal-content project-hub" id="main-content" tabIndex={-1}>
      <section className="portal-hero project-hub-heading">
        <div>
          <h1>Мои проекты</h1>
          <p>Все ваши проекты, версии и рабочие среды в одном месте.</p>
        </div>
        <button type="button" className="portal-create-button" onClick={() => setCreating(true)}>
          <PlusIcon /> Создать
        </button>
      </section>

      <div className="project-status-tabs" role="tablist" aria-label="Состояние проектов">
        {STATUS_TABS.map((tab) => (
          <button
            type="button"
            role="tab"
            key={tab.value}
            aria-selected={statusFilter === tab.value}
            className={statusFilter === tab.value ? 'active' : undefined}
            onClick={() => setStatusFilter(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>

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
            <option value="recent">Сначала недавние</option>
            <option value="oldest">Сначала старые</option>
            <option value="title">По названию</option>
          </select>
        </label>
        <div className="project-layout-toggle" aria-label="Вид проектов">
          <button
            type="button"
            className={layout === 'grid' ? 'active' : undefined}
            aria-label="Сетка"
            onClick={() => setLayout('grid')}
          >
            ▦
          </button>
          <button
            type="button"
            className={layout === 'list' ? 'active' : undefined}
            aria-label="Список"
            onClick={() => setLayout('list')}
          >
            ☷
          </button>
        </div>
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
          <h2>
            {statusFilter === 'active'
              ? 'Создайте первый проект'
              : statusFilter === 'archived'
                ? 'Архив пуст'
                : 'Корзина пуста'}
          </h2>
          <p>
            {statusFilter === 'active'
              ? 'Выберите учебную среду. Класс для личной работы не требуется.'
              : 'Здесь появятся проекты после соответствующего действия.'}
          </p>
          {statusFilter === 'active' ? (
            <button
              type="button"
              className="portal-create-button"
              onClick={() => setCreating(true)}
            >
              <PlusIcon /> Создать проект
            </button>
          ) : null}
        </section>
      ) : null}

      {items && items.length > 0 && visibleItems.length === 0 ? (
        <section className="portal-empty project-empty">
          <h2>Ничего не найдено</h2>
          <p>Измените поисковый запрос или фильтр среды.</p>
        </section>
      ) : null}

      {visibleItems.length > 0 ? (
        <ul
          className={`project-gallery project-hub-grid ${layout}`}
          data-testid="personal-project-grid"
        >
          {visibleItems.map((project) => {
            const module = modulesByKey.get(project.moduleKey);
            const style = { '--module-accent': moduleAccent(project.moduleKey) } as CSSProperties;
            const editorHref = creatorViewToHref({
              kind: 'editor',
              projectId: project.id,
              moduleKey: project.moduleKey,
              returnTo: { kind: 'my-projects' },
            });
            const preview = (
              <>
                {module ? (
                  <ModuleGlyph module={module} size={64} />
                ) : (
                  <span aria-hidden="true">?</span>
                )}
                <span className="project-preview-label">
                  {module?.displayName ?? project.moduleKey}
                </span>
              </>
            );
            return (
              <li key={project.id} className="project-gallery-card project-hub-card" style={style}>
                {statusFilter === 'active' ? (
                  <PortalLink
                    className="project-preview project-module-preview"
                    href={editorHref}
                    onNavigate={() => onOpenProject(project.id, project.moduleKey)}
                  >
                    {preview}
                  </PortalLink>
                ) : (
                  <button type="button" className="project-preview project-module-preview" disabled>
                    {preview}
                  </button>
                )}
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
                        <p>Изменён {formatDate(project.updatedAt)}</p>
                      </div>
                      <div className="project-card-actions">
                        {statusFilter === 'active' ? (
                          <>
                            <PortalLink
                              className="btn-secondary"
                              href={editorHref}
                              onNavigate={() => onOpenProject(project.id, project.moduleKey)}
                            >
                              Открыть
                            </PortalLink>
                            <details className="project-card-menu">
                              <summary aria-label={`Действия с проектом ${project.title}`}>
                                •••
                              </summary>
                              <div>
                                <button type="button" onClick={() => beginRename(project)}>
                                  Переименовать
                                </button>
                                <button
                                  type="button"
                                  disabled={actionBusy === project.id}
                                  onClick={() => void duplicate(project)}
                                >
                                  Дублировать
                                </button>
                                <button
                                  type="button"
                                  disabled={actionBusy === project.id}
                                  onClick={() => void changeStatus(project, 'archived')}
                                >
                                  Архивировать
                                </button>
                                <button
                                  type="button"
                                  className="danger"
                                  disabled={actionBusy === project.id}
                                  onClick={() => void changeStatus(project, 'trashed')}
                                >
                                  В корзину
                                </button>
                              </div>
                            </details>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={actionBusy === project.id}
                              onClick={() => void changeStatus(project, 'active')}
                            >
                              Восстановить
                            </button>
                            {statusFilter === 'archived' ? (
                              <button
                                type="button"
                                className="btn-ghost"
                                disabled={actionBusy === project.id}
                                onClick={() => void changeStatus(project, 'trashed')}
                              >
                                В корзину
                              </button>
                            ) : null}
                          </>
                        )}
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
            onOpenProject(project.id, project.moduleKey);
          }}
        />
      ) : null}
    </main>
  );
}
