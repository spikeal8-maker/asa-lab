import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Project, type ProjectFeedback, type ProjectStatus } from '../api';
import {
  QuickCreateMenu,
  useQuickProjectCreation,
  useProjectScroll,
} from '../creator-portal/QuickProjectCreation';
import { creatorViewToHref, type ProjectListView } from '../creator-portal/navigation';
import { newClientId } from '../client-id';
import { ProjectCard } from '../modules/ProjectCard';
import { ProjectProperties } from '../components/ProjectProperties';
import { ProjectHistoryDialog } from '../components/ProjectHistoryDialog';
import { CollectPicker } from '../components/CollectPicker';

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
  view,
  onView,
}: {
  onOpenProject: (projectId: string, moduleKey: string) => void;
  view: ProjectListView;
  onView: (view: ProjectListView) => void;
}): JSX.Element {
  const [items, setItems] = useState<Project[] | null>(null);
  const { modules } = useQuickProjectCreation();
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState(view.search ?? '');
  const { module: selectedModule, search, sort, status, cursor } = view;
  const moduleFilter = selectedModule ?? 'all';
  const { cursor: _cursor, ...firstPage } = view;
  void _cursor;
  const setModuleFilter = (value: string): void => {
    const { module: _module, ...rest } = firstPage;
    void _module;
    onView({ ...rest, ...(value === 'all' ? {} : { module: value }) });
  };
  const statusFilter = status ?? 'active';
  const setStatusFilter = (value: ProjectStatus): void => onView({ ...firstPage, status: value });
  const sortMode = sort ?? 'recent';
  const setSortMode = (value: SortMode): void => onView({ ...firstPage, sort: value });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const duplicateKeys = useRef(new Map<string, string>());
  const [layout, setLayout] = useState<LayoutMode>('grid');
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  // What a teacher said, keyed by project. Empty for anyone with no teacher.
  const [feedback, setFeedback] = useState<Readonly<Record<string, ProjectFeedback>>>({});
  const [reading, setReading] = useState<{ title: string; entry: ProjectFeedback } | null>(null);
  // Which of these are on the gallery wall, so the menu item says the truth.
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [properties, setProperties] = useState<Project | null>(null);
  const [history, setHistory] = useState<Project | null>(null);
  const [collecting, setCollecting] = useState<Project | null>(null);

  const load = useCallback(async () => {
    const current = ++sequence.current;
    setError(null);
    void api.myProjectFeedback().then((result) => {
      if (current === sequence.current && mounted.current && result.ok)
        setFeedback(result.data.items);
    });
    const projectsResult = await api.listProjects({
      scope: 'personal',
      status: status ?? 'active',
      limit: 40,
      ...(selectedModule ? { module: selectedModule } : {}),
      ...(search ? { search } : {}),
      ...(sort ? { sort } : {}),
      ...(cursor ? { cursor } : {}),
    });
    if (current !== sequence.current || !mounted.current) return;
    if (!projectsResult.ok) {
      setError(
        projectsResult.status === 0 ? 'Сервер недоступен.' : 'Не удалось загрузить проекты.',
      );
      return;
    }
    setItems(projectsResult.data.items);
    setNextCursor(projectsResult.data.nextCursor ?? null);
  }, [selectedModule, search, sort, status, cursor]);

  useEffect(() => {
    mounted.current = true;
    setItems(null);
    setNextCursor(null);
    void load();
    return () => {
      sequence.current++;
      mounted.current = false;
    };
  }, [load]);
  useEffect(() => setQuery(search ?? ''), [search]);

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

  const visibleItems = items ?? [];
  const rememberScroll = useProjectScroll(items !== null);

  async function changeStatus(project: Project, status: ProjectStatus): Promise<void> {
    setActionBusy(project.id);
    setActionError(null);
    const result = await api.changeProjectStatus(project.id, status);
    if (!mounted.current) return;
    setActionBusy(null);
    if (!result.ok) {
      setActionError(result.error.message || 'Не удалось изменить состояние проекта.');
      return;
    }
    await load();
  }

  async function duplicate(project: Project): Promise<void> {
    setActionBusy(project.id);
    setActionError(null);
    const key = duplicateKeys.current.get(project.id) ?? newClientId();
    duplicateKeys.current.set(project.id, key);
    const result = await api.duplicateProject(project.id, `${project.title} — копия`, key);
    if (!mounted.current) return;
    setActionBusy(null);
    if (!result.ok) {
      setActionError(result.error.message || 'Не удалось создать копию проекта.');
      return;
    }
    duplicateKeys.current.delete(project.id);
    await load();
  }

  return (
    <main className="portal-content project-hub" id="main-content" tabIndex={-1}>
      <section className="portal-hero project-hub-heading">
        <div>
          <h1>Мои проекты</h1>
        </div>
        <div className="project-hub-heading-tools">
          <form
            className="project-search-form"
            onSubmit={(event) => {
              event.preventDefault();
              const { search: _search, ...rest } = firstPage;
              void _search;
              onView({ ...rest, ...(query.trim() ? { search: query.trim() } : {}) });
            }}
          >
            <label className="project-search">
              <span className="sr-only">Поиск проектов</span>
              <input
                type="search"
                maxLength={255}
                placeholder="Поиск"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button type="submit" className="btn-secondary">
              Найти
            </button>
          </form>
          <QuickCreateMenu />
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

      {shareNotice ? (
        <p className="notice-success" role="status">
          {shareNotice}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="notice-error">
          {actionError}
        </p>
      ) : null}
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
            {search || cursor
              ? 'Ничего не найдено'
              : statusFilter === 'active'
                ? 'Создайте первый проект'
                : statusFilter === 'archived'
                  ? 'Архив пуст'
                  : 'Корзина пуста'}
          </h2>
          <p>
            {search || cursor
              ? 'Измените поиск или вернитесь к началу списка.'
              : statusFilter === 'active'
                ? 'Выберите учебную среду. Класс для личной работы не требуется.'
                : 'Здесь появятся проекты после соответствующего действия.'}
          </p>
          {statusFilter === 'active' ? <QuickCreateMenu /> : null}
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
              returnTo: view,
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
                        onNavigate: () => {
                          rememberScroll();
                          onOpenProject(project.id, project.moduleKey);
                        },
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
                        {
                          // Имя, описание, теги, лицензия и то, кому работа
                          // видна — в одном диалоге. Публикация живёт там же:
                          // это состояние работы, а не действие сбоку.
                          label: 'Свойства',
                          onSelect: () => setProperties(project),
                        },
                        {
                          label: 'Дублировать',
                          disabled: busy,
                          onSelect: () => void duplicate(project),
                        },
                        {
                          label: 'Журнал версий',
                          onSelect: () => setHistory(project),
                        },
                        {
                          label: 'Добавить в коллекцию',
                          onSelect: () => setCollecting(project),
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
              />
            );
          })}
        </ul>
      ) : null}

      {cursor || nextCursor ? (
        <nav className="project-pagination" aria-label="Страницы проектов">
          {cursor ? (
            <button type="button" className="btn-secondary" onClick={() => onView(firstPage)}>
              В начало списка
            </button>
          ) : null}
          {nextCursor ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onView({ ...view, cursor: nextCursor })}
            >
              Следующие проекты
            </button>
          ) : null}
        </nav>
      ) : null}

      {properties ? (
        <ProjectProperties
          project={properties}
          onClose={() => setProperties(null)}
          onSaved={async () => {
            setProperties(null);
            setShareNotice('Свойства сохранены.');
            await load();
          }}
        />
      ) : null}
      {history ? (
        <ProjectHistoryDialog
          projectId={history.id}
          title={history.title}
          onClose={() => setHistory(null)}
        />
      ) : null}
      {collecting ? (
        <CollectPicker
          projectId={collecting.id}
          title={collecting.title}
          onClose={() => setCollecting(null)}
        />
      ) : null}
      {reading ? (
        <FeedbackNote
          title={reading.title}
          entry={reading.entry}
          onClose={() => setReading(null)}
        />
      ) : null}
    </main>
  );
}
