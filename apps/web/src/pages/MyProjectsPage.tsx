import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  api,
  type ModuleSummary,
  type Project,
  type ProjectFeedback,
  type ProjectStatus,
} from '../api';
import { CreateProjectModal } from '../components/CreateProjectModal';
import { creatorViewToHref } from '../creator-portal/navigation';
import { PlusIcon } from '../electronics/workbench-icons';
import { ProjectCard } from '../modules/ProjectCard';

type SortMode = 'recent' | 'oldest' | 'title';
type LayoutMode = 'grid' | 'list';

/**
 * The four verdicts, as a learner reads them. The same words their teacher
 * chose, in the same colours, on their own card — a mark that only existed on
 * the teacher's screen was a note to nobody.
 */
const FEEDBACK_LABELS: Readonly<Record<string, string>> = {
  excellent: 'Отлично',
  good: 'Хорошо',
  progress: 'Есть прогресс',
  redo: 'Нужно доделать',
};

function feedbackTone(
  badge: string | null,
): 'excellent' | 'good' | 'progress' | 'redo' | 'teacher' | undefined {
  if (badge === 'excellent' || badge === 'good' || badge === 'progress' || badge === 'redo') {
    return badge;
  }
  // A comment with no badge still deserves to be visible.
  return 'teacher';
}

/** What the teacher wrote, in full. The card can only carry the verdict. */
function FeedbackNote({
  title,
  entry,
  onClose,
}: {
  readonly title: string;
  readonly entry: ProjectFeedback;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Отклик: ${title}`}>
        <h2>Отклик на «{title}»</h2>
        {entry.badge ? (
          <p className={`project-card-mark tone-${feedbackTone(entry.badge)} feedback-note-mark`}>
            {FEEDBACK_LABELS[entry.badge] ?? entry.badge}
          </p>
        ) : null}
        {entry.comment ? <p className="feedback-note-comment">{entry.comment}</p> : null}
        <p className="feedback-note-author">
          {entry.author} ·{' '}
          {new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).format(
            new Date(entry.updatedAt),
          )}
        </p>
        <div className="modal-actions">
          <button type="button" className="btn-primary" autoFocus onClick={onClose}>
            Понятно
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** Where a project can be instead of in the workshop. */
const STATUS_PLACES: ReadonlyArray<{ value: ProjectStatus; label: string }> = [
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
  // What a teacher said, keyed by project. Empty for anyone with no teacher.
  const [feedback, setFeedback] = useState<Readonly<Record<string, ProjectFeedback>>>({});
  const [reading, setReading] = useState<{ title: string; entry: ProjectFeedback } | null>(null);

  const load = useCallback(async () => {
    setItems(null);
    setError(null);
    // The teacher's responses arrive with the projects, so a mark is on the card
    // when the card appears. A response is not required for the page to work: a
    // learner with no teacher simply has none.
    const [projectsResult, modulesResult, feedbackResult] = await Promise.all([
      api.listProjects({ scope: 'personal', status: statusFilter }),
      api.listModules(),
      api.myProjectFeedback(),
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
    setFeedback(feedbackResult.ok ? feedbackResult.data.items : {});
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const modulesByKey = useMemo(
    () => new Map((modules ?? []).map((module) => [module.moduleKey, module])),
    [modules],
  );

  /**
   * Only environments a project can actually be in. The registry also lists
   * what is coming later, and a tab that can never hold anything is a dead end
   * on the one page that is supposed to be a person's own work.
   */
  const filterModules = useMemo(
    () =>
      (modules ?? [])
        .filter((module) => module.availability === 'active' && module.creatable)
        .sort((left, right) => left.displayName.localeCompare(right.displayName, 'ru')),
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
        </div>
        <div className="project-hub-heading-tools">
          <label className="project-search">
            <span className="sr-only">Поиск проектов</span>
            <input
              type="search"
              placeholder="Поиск"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button type="button" className="portal-create-button" onClick={() => setCreating(true)}>
            <PlusIcon /> Создать
          </button>
        </div>
      </section>

      {/*
        The first choice a person makes here is which kind of work they are
        looking for, so the environments lead. Archive and trash are places a
        project ends up rather than kinds of project, and they sit apart on the
        right with the controls that change how the same set is displayed.
      */}
      <section className="project-toolbar" aria-label="Фильтры проектов">
        <div className="project-kind-tabs" role="tablist" aria-label="Среда проекта">
          <button
            type="button"
            role="tab"
            aria-selected={moduleFilter === 'all'}
            className={moduleFilter === 'all' ? 'active' : undefined}
            onClick={() => setModuleFilter('all')}
          >
            Все
          </button>
          {filterModules.map((module) => (
            <button
              type="button"
              role="tab"
              key={module.moduleKey}
              aria-selected={moduleFilter === module.moduleKey}
              className={moduleFilter === module.moduleKey ? 'active' : undefined}
              onClick={() => setModuleFilter(module.moduleKey)}
            >
              {module.displayName}
            </button>
          ))}
        </div>

        <div className="project-toolbar-tools">
          {STATUS_PLACES.map((place) => (
            <button
              type="button"
              key={place.value}
              className={`project-place${statusFilter === place.value ? ' active' : ''}`}
              aria-pressed={statusFilter === place.value}
              onClick={() => setStatusFilter(statusFilter === place.value ? 'active' : place.value)}
            >
              {place.label}
            </button>
          ))}
          <label>
            <span className="sr-only">Сортировка проектов</span>
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
            >
              <option value="recent">Отредактировано</option>
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
        <ul className={`project-card-grid ${layout}`} data-testid="personal-project-grid">
          {visibleItems.map((project) => {
            const module = modulesByKey.get(project.moduleKey);
            const editorHref = creatorViewToHref({
              kind: 'editor',
              projectId: project.id,
              moduleKey: project.moduleKey,
              returnTo: { kind: 'my-projects' },
            });
            const busy = actionBusy === project.id;
            const active = statusFilter === 'active';
            // A teacher's verdict belongs on the learner's own card. Until now
            // it lived only on the teacher's copy: a mark nobody reads.
            const response = feedback[project.id];
            const tone = response ? feedbackTone(response.badge) : undefined;
            return (
              <ProjectCard
                key={project.id}
                project={project}
                module={module}
                timeLabel={`Изменён ${formatDate(project.updatedAt)}`}
                footerLabel={
                  response
                    ? (FEEDBACK_LABELS[response.badge ?? ''] ?? 'Есть отклик педагога')
                    : 'Приватный'
                }
                {...(tone ? { footerTone: tone } : {})}
                {...(response
                  ? {
                      footerAction: {
                        label: 'Отклик педагога',
                        onSelect: () => setReading({ title: project.title, entry: response }),
                      },
                    }
                  : {})}
                {...(active
                  ? {
                      open: {
                        href: editorHref,
                        onNavigate: () => onOpenProject(project.id, project.moduleKey),
                      },
                    }
                  : {
                      primaryAction: {
                        label: 'Восстановить',
                        disabled: busy,
                        onSelect: () => void changeStatus(project, 'active'),
                      },
                    })}
                menuItems={
                  active
                    ? [
                        ...(response
                          ? [
                              {
                                label: 'Отклик педагога',
                                onSelect: () =>
                                  setReading({ title: project.title, entry: response }),
                              },
                            ]
                          : []),
                        { label: 'Переименовать', onSelect: () => beginRename(project) },
                        {
                          label: 'Дублировать',
                          disabled: busy,
                          onSelect: () => void duplicate(project),
                        },
                        {
                          label: 'Архивировать',
                          disabled: busy,
                          onSelect: () => void changeStatus(project, 'archived'),
                        },
                        {
                          label: 'В корзину',
                          danger: true,
                          disabled: busy,
                          onSelect: () => void changeStatus(project, 'trashed'),
                        },
                      ]
                    : statusFilter === 'archived'
                      ? [
                          {
                            label: 'В корзину',
                            danger: true,
                            disabled: busy,
                            onSelect: () => void changeStatus(project, 'trashed'),
                          },
                        ]
                      : []
                }
                {...(renamingId === project.id
                  ? {
                      editing: (
                        <form
                          className="project-card-rename"
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
                          <div className="project-card-rename-actions">
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
                      ),
                    }
                  : {})}
              />
            );
          })}
        </ul>
      ) : null}

      {reading ? (
        <FeedbackNote
          title={reading.title}
          entry={reading.entry}
          onClose={() => setReading(null)}
        />
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
