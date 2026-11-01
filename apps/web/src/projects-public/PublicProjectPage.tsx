import { PublicationLike } from './PublicationLike';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { PortalLink } from '../components/PortalLink';
import { useSchoolTime } from '../components/school-time';
import { publicProjectsApi, type PublicProject } from './api';
import { CopyPublicProject } from './CopyPublicProject';
import { PublicationArtifact } from './PublicationArtifact';
import { PublicProjectTitle } from './PublicProjectTitle';
import { SharePublicationLink } from './SharePublicationLink';
import { PUBLIC_PROJECT_LICENSES, publicModuleName } from './presentation';
import './public-projects.css';

export function PublicationUnavailable({
  onBack,
  legacy = false,
}: {
  readonly onBack: () => void;
  readonly legacy?: boolean;
}): JSX.Element {
  return (
    <main id="main-content" className="portal-content public-projects" tabIndex={-1}>
      <PortalLink className="public-project-back" href="/#/explore" onNavigate={onBack}>
        ← Проекты
      </PortalLink>
      <section className="public-projects-state" data-testid="public-project-unavailable">
        <h1>Публикация недоступна</h1>
        <p>
          {legacy
            ? 'Эта ссылка относится к прежней галерее. Новые публикации находятся в каталоге проектов.'
            : 'Публикация не найдена или доступ к ней закрыт.'}
        </p>
        <button type="button" className="btn-primary" onClick={onBack}>
          Открыть каталог
        </button>
      </section>
    </main>
  );
}

export function PublicProjectPage({
  publicationId,
  onBack,
  authenticated = false,
}: {
  readonly publicationId: string;
  readonly authenticated?: boolean;
  readonly onBack: () => void;
}): JSX.Element {
  const [publication, setPublication] = useState<PublicProject | null>(null);
  const [missing, setMissing] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const descriptionId = useId();
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const time = useSchoolTime();
  const unavailable = useCallback(() => {
    setPublication(null);
    setMissing(true);
  }, []);
  const reload = useCallback(async () => {
    controller.current?.abort();
    controller.current = new AbortController();
    const current = ++request.current;
    setPublication(null);
    setDescriptionExpanded(false);
    setMissing(false);
    setError(null);
    const result = await publicProjectsApi.get(publicationId, controller.current.signal);
    if (current !== request.current) return;
    if (!result.ok) {
      if ([400, 403, 404, 410].includes(result.status)) setMissing(true);
      else setError('Не удалось загрузить публикацию. Проверьте соединение и повторите.');
      return;
    }
    if (!result.data?.publication) {
      setError('Не удалось прочитать публикацию. Попробуйте снова.');
      return;
    }
    setPublication(result.data.publication);
  }, [publicationId]);
  useEffect(() => {
    void reload();
    return () => {
      request.current++;
      controller.current?.abort();
    };
  }, [reload]);
  if (missing) return <PublicationUnavailable onBack={onBack} />;
  const licence = publication
    ? (PUBLIC_PROJECT_LICENSES.find((entry) => entry.value === publication.license)?.label ??
      publication.license)
    : '';
  return (
    <main
      id="main-content"
      className="portal-content public-projects public-project-detail"
      tabIndex={-1}
    >
      {!publication ? (
        <PortalLink className="public-project-back" href="/#/explore" onNavigate={onBack}>
          ← Проекты
        </PortalLink>
      ) : null}
      {error ? (
        <section
          className="public-projects-state notice-error"
          data-testid="public-project-error"
          role="alert"
        >
          <p>{error}</p>
          <button type="button" className="btn-secondary" onClick={() => void reload()}>
            Повторить
          </button>
        </section>
      ) : !publication ? (
        <p className="public-projects-state" data-testid="public-project-loading" role="status">
          Загружаем публикацию…
        </p>
      ) : (
        <article
          className="public-project-layout"
          data-module={publication.moduleKey}
          data-testid="public-project-detail"
        >
          <header className="public-project-heading">
            <div className="public-project-detail-topline">
              <PortalLink className="public-project-back" href="/#/explore" onNavigate={onBack}>
                ← Проекты
              </PortalLink>
              <PublicProjectTitle key={publication.revisionId} title={publication.title} />
            </div>
            <div className="public-project-commandbar" aria-label="Действия с проектом">
              <CopyPublicProject key={publication.revisionId} publication={publication} />
              <div className="public-project-actions">
                <PublicationLike
                  key={publication.revisionId}
                  publication={publication}
                  authenticated={authenticated}
                />
                {typeof publication.copyCount === 'number' ? (
                  <span
                    className="public-project-detail-copies"
                    title="Добавили к себе"
                    aria-label={`Добавили к себе: ${publication.copyCount}`}
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    >
                      <path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4" />
                    </svg>
                    {publication.copyCount}
                  </span>
                ) : null}
                <SharePublicationLink
                  key={publication.publicationId}
                  publicationId={publication.publicationId}
                />
              </div>
            </div>{' '}
          </header>
          <div className="public-project-workspace">
            <div className="public-project-stage-column">
              <section className="public-project-viewer" aria-label="Просмотр проекта">
                <PublicationArtifact
                  key={publication.revisionId}
                  publication={publication}
                  onUnavailable={unavailable}
                />
              </section>
            </div>
            <aside className="public-project-sidebar" aria-label="Об авторе и проекте">
              <div className="public-project-authorline">
                <div className="public-project-author-identity">
                  <span className="public-project-detail-avatar" aria-hidden="true">
                    {publication.authorLabel
                      .trim()
                      .split(/\s+/u)
                      .slice(0, 2)
                      .map((part) => Array.from(part)[0])
                      .join('')
                      .toLocaleUpperCase('ru') || '?'}
                  </span>
                  <div className="public-project-author-text">
                    <span className="public-project-detail-author">{publication.authorLabel}</span>
                    <time dateTime={publication.publishedAt}>
                      {time.date(publication.publishedAt)}
                    </time>
                  </div>
                </div>
                <div className="public-project-badges">
                  <span className="publication-module" data-module={publication.moduleKey}>
                    {publicModuleName(publication.moduleKey)}
                  </span>
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
                </div>
              </div>
              <section className="public-project-about" aria-label="О проекте">
                <div className="public-project-description-block">
                  {publication.description ? (
                    <>
                      <h2>О проекте</h2>
                      <p
                        id={descriptionId}
                        className={`public-project-description${publication.description.length > 600 && !descriptionExpanded ? ' is-collapsed' : ''}`}
                        data-testid="public-project-description"
                      >
                        {publication.description}
                      </p>
                      {publication.description.length > 600 ? (
                        <button
                          type="button"
                          className="public-project-description-toggle"
                          aria-controls={descriptionId}
                          aria-expanded={descriptionExpanded}
                          onClick={() => setDescriptionExpanded((value) => !value)}
                        >
                          {descriptionExpanded ? 'Свернуть описание' : 'Читать полностью'}
                        </button>
                      ) : null}
                    </>
                  ) : null}
                  {publication.tags.length ? (
                    <ul className="public-project-tags" aria-label="Теги">
                      {publication.tags.map((tag) => (
                        <li key={tag}>{tag}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <details className="public-project-metadata">
                  <summary>Лицензия и сведения о публикации</summary>
                  <dl className="public-project-facts">
                    <div>
                      <dt>Лицензия</dt>
                      <dd>{licence}</dd>
                    </div>
                    <div>
                      <dt>Версия проекта</dt>
                      <dd>
                        {publication.versionNo} · Публикация {publication.revisionNo}
                      </dd>
                    </div>
                  </dl>
                </details>
              </section>
            </aside>
          </div>
        </article>
      )}
    </main>
  );
}
