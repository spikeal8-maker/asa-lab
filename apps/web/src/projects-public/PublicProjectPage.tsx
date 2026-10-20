import { useCallback, useEffect, useRef, useState } from 'react';
import { PortalLink } from '../components/PortalLink';
import { useSchoolTime } from '../components/school-time';
import { publicProjectsApi, type PublicProject } from './api';
import { PublicationPreview } from './PublicationPreview';
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
  const time = useSchoolTime();
  const reload = useCallback(async () => {
    const current = ++request.current;
    setPublication(null);
    setMissing(false);
    setError(null);
    const result = await publicProjectsApi.get(publicationId);
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
          <figure className="public-project-viewer">
            <PublicationPreview key={publication.revisionId} publication={publication} detail />
            <figcaption>Статический просмотр опубликованной версии</figcaption>
            <button type="button" className="btn-secondary" onClick={() => void reload()}>
              Обновить страницу проекта
            </button>
          </figure>
          <div className="public-project-info">
            <span className="publication-module" data-module={publication.moduleKey}>
              {publicModuleName(publication.moduleKey)}
            </span>
            <h1 data-testid="public-project-title">{publication.title}</h1>
            <p className="public-project-detail-author">{publication.authorLabel}</p>
            <p className="public-project-version">
              Версия проекта {publication.versionNo} · Публикация {publication.revisionNo}
              <br />
              <time dateTime={publication.publishedAt}>{time.date(publication.publishedAt)}</time>
            </p>
            {publication.description ? (
              <p className="public-project-description" data-testid="public-project-description">
                {publication.description}
              </p>
            ) : null}
            {publication.tags.length ? (
              <ul className="public-project-tags" aria-label="Теги">
                {publication.tags.map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
            ) : null}
            <div className="public-project-actions">
              {publication.preview ? (
                <a
                  className="btn-primary"
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
            </div>
            <p className="public-project-license">
              <strong>Лицензия</strong>
              <span>{licence}</span>
            </p>
          </div>
        </article>
      )}
    </main>
  );
}
