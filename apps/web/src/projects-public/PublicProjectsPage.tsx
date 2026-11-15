import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { PortalLink } from '../components/PortalLink';
import type { PublicProjectListView } from '../creator-portal/navigation';
import { publicProjectsApi, type PublicProject } from './api';
import { PublicProjectCard } from './PublicProjectCard';
import { ProjectModuleIcon } from '../modules/ProjectModuleIcon';
import { PUBLIC_PROJECT_MODULES, publicModuleName } from './presentation';
import './public-projects.css';

const CATALOG_MODULES = [...PUBLIC_PROJECT_MODULES, { value: 'ai', label: 'ИИ' }];

export function PublicProjectsPage({
  view,
  onView,
  onOpen,
  onMyProjects,
}: {
  readonly view: PublicProjectListView;
  readonly onView: (view: PublicProjectListView) => void;
  readonly onOpen: (publicationId: string) => void;
  readonly onMyProjects?: () => void;
}): JSX.Element {
  const moduleFilter = ['chess', 'checkers'].includes(view.module ?? '') ? undefined : view.module;
  const [query, setQuery] = useState(view.search ?? '');
  const [items, setItems] = useState<readonly PublicProject[] | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const request = useRef(0);
  const moreRequest = useRef(false);

  const reload = useCallback(async () => {
    const current = ++request.current;
    setItems(null);
    setError(null);
    setMoreError(null);
    setNextOffset(null);
    setLoadingMore(false);
    moreRequest.current = false;
    // AI is a catalog-only category until its publication contract is admitted.
    if (moduleFilter === 'ai') {
      setItems([]);
      return;
    }
    const result = await publicProjectsApi.list({
      ...(view.search ? { search: view.search } : {}),
      ...(moduleFilter ? { module: moduleFilter } : {}),
      ...(view.sort ? { sort: view.sort } : {}),
    });
    if (current !== request.current) return;
    if (!result.ok || !Array.isArray(result.data?.items)) {
      setError('Не удалось загрузить проекты. Проверьте соединение и повторите.');
      return;
    }
    setItems(result.data.items);
    setNextOffset(result.data.nextOffset);
  }, [view.search, moduleFilter, view.sort]);

  useEffect(() => {
    void reload();
    return () => {
      request.current++;
    };
  }, [reload]);
  useEffect(() => setQuery(view.search ?? ''), [view.search]);

  async function loadMore(): Promise<void> {
    if (nextOffset === null || moreRequest.current) return;
    const current = request.current;
    moreRequest.current = true;
    setLoadingMore(true);
    setMoreError(null);
    const result = await publicProjectsApi.list({
      ...(view.search ? { search: view.search } : {}),
      ...(moduleFilter ? { module: moduleFilter } : {}),
      ...(view.sort ? { sort: view.sort } : {}),
      offset: nextOffset,
    });
    if (current !== request.current) return;
    moreRequest.current = false;
    setLoadingMore(false);
    if (!result.ok || !Array.isArray(result.data?.items)) {
      setMoreError('Следующие проекты не загрузились. Попробуйте ещё раз.');
      return;
    }
    setItems((previous) => [
      ...new Map(
        [...(previous ?? []), ...result.data.items].map((item) => [item.publicationId, item]),
      ).values(),
    ]);
    setNextOffset(result.data.nextOffset);
  }

  function search(event: FormEvent): void {
    event.preventDefault();
    const value = query.trim();
    if (value === (view.search ?? '')) void reload();
    else
      onView({
        kind: 'public-projects',
        ...(value ? { search: value } : {}),
        ...(moduleFilter ? { module: moduleFilter } : {}),
        ...(view.sort ? { sort: view.sort } : {}),
      });
  }

  const filtered = Boolean(view.search || moduleFilter);
  return (
    <main
      id="main-content"
      className="portal-content public-projects"
      data-testid="public-project-catalog"
      tabIndex={-1}
    >
      <header className="public-projects-heading">
        <div className="public-projects-intro">
          <div className="public-projects-title-row">
            <h1>Идеи, схемы и программы сообщества ASA Lab</h1>
            {onMyProjects ? (
              <PortalLink
                className="public-projects-personal"
                href="/#/projects"
                onNavigate={onMyProjects}
              >
                Мои проекты <span aria-hidden="true">↗</span>
              </PortalLink>
            ) : null}
          </div>
        </div>
        <form className="public-projects-search" role="search" onSubmit={search}>
          <label htmlFor="public-project-search" className="sr-only">
            Поиск по названию и описанию
          </label>
          <input
            id="public-project-search"
            type="search"
            value={query}
            maxLength={120}
            placeholder="Найти проект"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" aria-label="Найти" title="Найти проект">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 4.5 4.5" />
            </svg>
          </button>
        </form>
      </header>

      <section className="public-projects-tools" aria-label="Каталог проектов">
        <div className="public-projects-categories" role="group" aria-label="Среда проекта">
          {[
            { value: '', label: 'Все' },
            ...CATALOG_MODULES,
            ...(moduleFilter && !CATALOG_MODULES.some((module) => module.value === moduleFilter)
              ? [{ value: moduleFilter, label: publicModuleName(moduleFilter) }]
              : []),
          ].map((module) => (
            <button
              key={module.value}
              type="button"
              className="public-projects-category"
              data-module={module.value}
              aria-pressed={(moduleFilter ?? '') === module.value}
              onClick={() =>
                onView({
                  kind: 'public-projects',
                  ...(view.search ? { search: view.search } : {}),
                  ...(module.value ? { module: module.value } : {}),
                  ...(view.sort ? { sort: view.sort } : {}),
                })
              }
            >
              <ProjectModuleIcon moduleKey={module.value || 'all'} />
              {module.label}
            </button>
          ))}
        </div>
        <label className="public-projects-order">
          <span className="sr-only">Сортировка проектов</span>
          <select
            value={view.sort ?? 'newest'}
            onChange={(event) =>
              onView({
                kind: 'public-projects',
                ...(view.search ? { search: view.search } : {}),
                ...(moduleFilter ? { module: moduleFilter } : {}),
                ...(event.target.value !== 'newest'
                  ? { sort: event.target.value as NonNullable<PublicProjectListView['sort']> }
                  : {}),
              })
            }
          >
            <option value="newest">Сначала новые</option>
            <option value="oldest">Сначала ранние</option>
            <option value="likes">По лайкам</option>
            <option value="copies">По добавлениям</option>
          </select>
        </label>
      </section>

      {items === null && !error ? (
        <p className="public-projects-state" data-testid="public-projects-loading" role="status">
          Загружаем проекты…
        </p>
      ) : null}
      {error ? (
        <section
          className="public-projects-state notice-error"
          data-testid="public-projects-error"
          role="alert"
        >
          <p>{error}</p>
          <button type="button" className="btn-secondary" onClick={() => void reload()}>
            Повторить
          </button>
        </section>
      ) : null}
      {items?.length === 0 ? (
        <section className="public-projects-state" data-testid="public-projects-empty">
          <h2>{filtered ? 'Проекты не найдены' : 'Публикаций пока нет'}</h2>
          <p>
            {filtered
              ? 'Попробуйте другие слова или выберите другую среду.'
              : 'Здесь появятся проекты после публикации их авторами.'}
          </p>
          {filtered ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onView({ kind: 'public-projects' })}
            >
              Сбросить поиск и фильтр
            </button>
          ) : onMyProjects ? (
            <button type="button" className="btn-primary" onClick={onMyProjects}>
              Выбрать свой проект
            </button>
          ) : null}
        </section>
      ) : null}
      {items && items.length > 0 ? (
        <ul className="public-project-grid" data-testid="public-project-grid">
          {items.map((publication) => (
            <PublicProjectCard
              key={`${publication.publicationId}:${publication.revisionId}`}
              publication={publication}
              onOpen={onOpen}
            />
          ))}
        </ul>
      ) : null}
      {nextOffset !== null ? (
        <div className="public-project-pagination">
          {moreError ? (
            <p role="alert" className="notice-error">
              {moreError}
            </p>
          ) : null}
          <button
            type="button"
            className="btn-secondary"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? 'Загружаем…' : moreError ? 'Повторить загрузку' : 'Показать ещё'}
          </button>
        </div>
      ) : null}
    </main>
  );
}
