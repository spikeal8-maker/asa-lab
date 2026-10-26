import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { PortalLink } from '../components/PortalLink';
import { useSchoolTime } from '../components/school-time';
import type { PublicProjectListView } from '../creator-portal/navigation';
import { publicProjectsApi, type PublicProject } from './api';
import { PublicationPreview } from './PublicationPreview';
import { PUBLIC_PROJECT_MODULES, publicationHref, publicModuleName } from './presentation';
import './public-projects.css';

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
  const [query, setQuery] = useState(view.search ?? '');
  const [items, setItems] = useState<readonly PublicProject[] | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const request = useRef(0);
  const moreRequest = useRef(false);
  const time = useSchoolTime();

  const reload = useCallback(async () => {
    const current = ++request.current;
    setItems(null);
    setError(null);
    setMoreError(null);
    setNextOffset(null);
    setLoadingMore(false);
    moreRequest.current = false;
    const result = await publicProjectsApi.list({
      ...(view.search ? { search: view.search } : {}),
      ...(view.module ? { module: view.module } : {}),
    });
    if (current !== request.current) return;
    if (!result.ok || !Array.isArray(result.data?.items)) {
      setError('Не удалось загрузить проекты. Проверьте соединение и повторите.');
      return;
    }
    setItems(result.data.items);
    setNextOffset(result.data.nextOffset);
  }, [view.search, view.module]);

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
      ...(view.module ? { module: view.module } : {}),
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
        ...(view.module ? { module: view.module } : {}),
      });
  }

  const filtered = Boolean(view.search || view.module);
  return (
    <main
      id="main-content"
      className="portal-content public-projects"
      data-testid="public-project-catalog"
      tabIndex={-1}
    >
      <header className="public-projects-heading">
        <div>
          <h1>Проекты</h1>
          <p>Смотрите работы, которыми поделились авторы ASA Lab.</p>
        </div>
        {onMyProjects ? (
          <PortalLink className="btn-secondary" href="/#/projects" onNavigate={onMyProjects}>
            Мои проекты
          </PortalLink>
        ) : null}
      </header>

      <section className="public-projects-tools" aria-label="Поиск проектов">
        <form className="public-projects-search" role="search" onSubmit={search}>
          <label htmlFor="public-project-search" className="sr-only">
            Поиск по названию и описанию
          </label>
          <input
            id="public-project-search"
            type="search"
            value={query}
            maxLength={120}
            placeholder="Название или описание проекта"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" className="btn-primary">
            Найти
          </button>
        </form>
        <div className="public-projects-filters">
          <label htmlFor="public-project-module" className="sr-only">
            Среда проекта
          </label>
          <select
            id="public-project-module"
            value={view.module ?? ''}
            onChange={(event) =>
              onView({
                kind: 'public-projects',
                ...(view.search ? { search: view.search } : {}),
                ...(event.target.value ? { module: event.target.value } : {}),
              })
            }
          >
            <option value="">Все среды</option>
            {PUBLIC_PROJECT_MODULES.map((module) => (
              <option key={module.value} value={module.value}>
                {module.label}
              </option>
            ))}
          </select>
          <span className="public-projects-order">Сначала новые</span>
        </div>
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
            <li
              key={`${publication.publicationId}:${publication.revisionId}`}
              className="public-project-card"
              data-testid="public-project-card"
            >
              <PortalLink
                className="public-project-card-link"
                href={publicationHref(publication.publicationId)}
                onNavigate={() => onOpen(publication.publicationId)}
                aria-label={`Открыть проект «${publication.title}»`}
              >
                <PublicationPreview publication={publication} />
                <div className="public-project-card-body">
                  {publication.pinned ? (
                    <span className="public-project-pinned" data-testid="public-project-pinned">
                      Закреплено
                    </span>
                  ) : null}
                  {publication.featured ? (
                    <span className="public-project-featured" data-testid="public-project-featured">
                      ★ Выбор редакции
                    </span>
                  ) : null}
                  <h2 data-testid="public-project-card-title" title={publication.title}>
                    {publication.title}
                  </h2>
                  <p className="public-project-author" title={publication.authorLabel}>
                    {publication.authorLabel}
                  </p>
                  <div className="public-project-card-meta">
                    <span className="publication-module" data-module={publication.moduleKey}>
                      {publicModuleName(publication.moduleKey)}
                    </span>
                    <time dateTime={publication.publishedAt}>
                      {time.shortDate(publication.publishedAt)}
                    </time>
                  </div>
                </div>
              </PortalLink>
            </li>
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
