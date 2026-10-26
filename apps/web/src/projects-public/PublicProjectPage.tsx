import { useCallback, useEffect, useRef, useState } from 'react';
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
}: {
  readonly publicationId: string;
  readonly onBack: () => void;
}): JSX.Element {
  const [publication, setPublication] = useState<PublicProject | null>(null);
  const [missing, setMissing] = useState(false);
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
      <PortalLink className="public-project-back" href="/#/explore" onNavigate={onBack}>
        ← Проекты
      </PortalLink>
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
        <article className="public-project-layout" data-testid="public-project-detail">
          <header className="public-project-heading">
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
            <PublicProjectTitle key={publication.revisionId} title={publication.title} />
            <p className="public-project-detail-author">{publication.authorLabel}</p>
          </header>
          <div className="public-project-commandbar" aria-label="Действия с проектом">
            <CopyPublicProject key={publication.revisionId} publication={publication} />
            <div className="public-project-actions">
              {publication.preview ? (
                <a
                  className="btn-secondary"
                  href={publication.preview.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть изображение
                </a>
              ) : null}
              <SharePublicationLink
                key={publication.publicationId}
                publicationId={publication.publicationId}
              />
              <button
                type="button"
                className="public-project-refresh"
                onClick={() => void reload()}
              >
                Обновить публикацию
              </button>
            </div>
          </div>
          <section className="public-project-viewer" aria-label="Просмотр проекта">
            <PublicationArtifact
              key={publication.revisionId}
              publication={publication}
              onUnavailable={unavailable}
            />
          </section>
          <section className="public-project-about" aria-label="О проекте">
            {publication.description ? (
              <>
                <h2>О проекте</h2>
                <p className="public-project-description" data-testid="public-project-description">
                  {publication.description}
                </p>
              </>
            ) : null}
            {publication.tags.length ? (
              <ul className="public-project-tags" aria-label="Теги">
                {publication.tags.map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
            ) : null}
            <dl className="public-project-facts">
              <div>
                <dt>Лицензия</dt>
                <dd>{licence}</dd>
              </div>
              <div>
                <dt>Опубликовано</dt>
                <dd>
                  <time dateTime={publication.publishedAt}>
                    {time.date(publication.publishedAt)}
                  </time>
                </dd>
              </div>
              <div>
                <dt>Версия проекта</dt>
                <dd>
                  {publication.versionNo} · Публикация {publication.revisionNo}
                </dd>
              </div>
            </dl>
          </section>
        </article>
      )}
    </main>
  );
}
