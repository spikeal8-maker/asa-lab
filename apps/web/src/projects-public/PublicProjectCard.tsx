import { PortalLink } from '../components/PortalLink';
import { useSchoolTime } from '../components/school-time';
import { ProjectModuleIcon } from '../modules/ProjectModuleIcon';
import type { PublicProject } from './api';
import { PublicAuthorAvatar } from './PublicAuthorAvatar';
import { PublicationPreview } from './PublicationPreview';
import { publicationHref, publicModuleName } from './presentation';

export function PublicProjectCard({
  publication,
  onOpen,
  headingLevel = 2,
}: {
  readonly publication: PublicProject;
  readonly onOpen: (publicationId: string) => void;
  readonly headingLevel?: 2 | 3;
}): JSX.Element {
  const time = useSchoolTime();
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <li className="public-project-card" data-testid="public-project-card">
      <PortalLink
        className="public-project-card-link"
        href={publicationHref(publication.publicationId)}
        onNavigate={() => onOpen(publication.publicationId)}
        aria-label={`Открыть проект «${publication.title}»`}
      >
        <div className="public-project-card-cover">
          <PublicationPreview publication={publication} />
          <div className="public-project-card-topline">
            <div className="public-project-card-identity" title={publication.authorLabel}>
              <PublicAuthorAvatar publication={publication} />
              <span className="public-project-author-caption">
                <span className="public-project-author">{publication.authorLabel}</span>
                <time className="public-project-card-date" dateTime={publication.publishedAt}>
                  {time.date(publication.publishedAt)}
                </time>
              </span>
            </div>
            <span
              className="publication-module"
              data-module={publication.moduleKey}
              title={publicModuleName(publication.moduleKey)}
              aria-label={publicModuleName(publication.moduleKey)}
            >
              <ProjectModuleIcon moduleKey={publication.moduleKey} />
            </span>
          </div>
          <div className="public-project-card-marks">
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
          <div className="public-project-card-body">
            <Heading data-testid="public-project-card-title" title={publication.title}>
              {publication.title}
            </Heading>
            <div className="public-project-card-meta">
              {typeof publication.copyCount === 'number' ? (
                <span
                  aria-label={`${publication.copyCount} добавлений в свои проекты`}
                  title="Добавили к себе"
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
                    <rect x="8" y="8" width="12" height="12" rx="2" />
                    <path d="M16 8V4H4v12h4" />
                  </svg>
                  {publication.copyCount}
                </span>
              ) : null}
              <span aria-label={`${publication.likeCount ?? 0} нравится`}>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="currentColor"
                >
                  <path d="M12 21 3.7 13A5.5 5.5 0 0 1 12 5.8 5.5 5.5 0 0 1 20.3 13Z" />
                </svg>
                {publication.likeCount ?? 0}
              </span>
            </div>
          </div>
        </div>
      </PortalLink>
    </li>
  );
}
