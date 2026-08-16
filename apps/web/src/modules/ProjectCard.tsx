import type { CSSProperties, ReactNode } from 'react';
import type { ModuleSummary, Project } from '../api';
import { PortalLink } from '../components/PortalLink';
import { ModuleGlyph, moduleAccent } from './ModuleGlyph';
import { ProjectPreview } from './ProjectPreviewFigure';
import './project-card.css';

/**
 * One project card, used wherever projects are listed.
 *
 * The card exists once rather than per page because a learner meets the same
 * object on the home page, in their workshop and inside a class, and a project
 * that looks like three different things is three things to learn. Pages pass
 * what differs — which actions apply to an archived project, what the date line
 * says — and nothing else.
 *
 * The picture is given most of the card. Everything that is not the work itself
 * — the actions, the menu — sits over the picture and appears on hover or
 * keyboard focus, so the resting card is the project and nothing else.
 */

export interface ProjectCardMenuItem {
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  readonly danger?: boolean;
}

export interface ProjectCardOpen {
  readonly href: string;
  readonly onNavigate: () => void;
}

function SettingsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        d="M12 15.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M19.4 13a7.5 7.5 0 0 0 0-2l1.7-1.3-1.8-3.1-2 .8a7.6 7.6 0 0 0-1.7-1l-.3-2.1h-3.6l-.3 2.1c-.6.2-1.2.6-1.7 1l-2-.8-1.8 3.1L7.6 11a7.5 7.5 0 0 0 0 2l-1.7 1.3 1.8 3.1 2-.8c.5.4 1.1.8 1.7 1l.3 2.1h3.6l.3-2.1c.6-.2 1.2-.6 1.7-1l2 .8 1.8-3.1L19.4 13Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ProjectCard({
  className,
  project,
  module,
  timeLabel,
  footerLabel,
  open,
  primaryLabel = 'Изменить',
  primaryAction,
  menuItems = [],
  editing,
}: {
  readonly className?: string;
  readonly project: Project;
  readonly module?: ModuleSummary | undefined;
  readonly timeLabel: string;
  readonly footerLabel: string;
  /** Present while the project can be opened in its editor. */
  readonly open?: ProjectCardOpen | undefined;
  readonly primaryLabel?: string;
  /** Used instead of the editor link — an archived project is restored, not edited. */
  readonly primaryAction?: ProjectCardMenuItem | undefined;
  readonly menuItems?: readonly ProjectCardMenuItem[];
  /** Replaces the title and date while the project is being renamed. */
  readonly editing?: ReactNode;
}): JSX.Element {
  const subject = module?.displayName ?? project.moduleKey;
  const preview = (
    <ProjectPreview
      project={project}
      module={module}
      fallback={
        <span className="project-card-glyph">
          {module ? (
            <ModuleGlyph module={module} size={56} />
          ) : (
            <span className="project-card-unknown" aria-hidden="true">
              ?
            </span>
          )}
        </span>
      }
    />
  );

  return (
    <li
      className={`project-card${className ? ` ${className}` : ''}`}
      style={{ '--module-accent': moduleAccent(project.moduleKey) } as CSSProperties}
      data-testid="project-card"
    >
      <div className="project-card-frame">
        {open ? (
          // The whole picture is a click target, but it is not a second link for
          // a screen reader: the title below already names this destination.
          <PortalLink
            className="project-card-surface"
            href={open.href}
            onNavigate={open.onNavigate}
            tabIndex={-1}
            aria-hidden="true"
          >
            {preview}
          </PortalLink>
        ) : (
          <div className="project-card-surface">{preview}</div>
        )}

        <div className="project-card-hover">
          {open ? (
            <PortalLink
              className="project-card-primary"
              href={open.href}
              onNavigate={open.onNavigate}
            >
              {primaryLabel}
            </PortalLink>
          ) : null}
          {primaryAction ? (
            <button
              type="button"
              className="project-card-primary"
              disabled={primaryAction.disabled === true}
              onClick={primaryAction.onSelect}
            >
              {primaryAction.label}
            </button>
          ) : null}
          {menuItems.length > 0 ? (
            <details className="project-card-tools">
              <summary aria-label={`Действия с проектом ${project.title}`}>
                <SettingsIcon />
              </summary>
              <div>
                {menuItems.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className={item.danger === true ? 'danger' : undefined}
                    disabled={item.disabled === true}
                    onClick={item.onSelect}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </div>

      <div className="project-card-body">
        {editing ?? (
          <>
            <h2 className="project-card-title">
              {open ? (
                <PortalLink href={open.href} onNavigate={open.onNavigate}>
                  {project.title}
                </PortalLink>
              ) : (
                project.title
              )}
            </h2>
            <p className="project-card-time">{timeLabel}</p>
          </>
        )}
        <p className="project-card-footer">
          <span>{footerLabel}</span>
          <span className="project-card-subject">{subject}</span>
        </p>
      </div>
    </li>
  );
}
