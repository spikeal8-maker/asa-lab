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

/**
 * The gear is built from a ring and eight teeth rather than one traced outline.
 * At 17 pixels a hand-written gear path collapses into a blob; a ring with
 * repeated teeth stays a gear at any size, and the hole is punched with an
 * even-odd fill so it shows whatever is behind the button.
 */
const GEAR_TEETH = [0, 45, 90, 135, 180, 225, 270, 315];

function SettingsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      {GEAR_TEETH.map((angle) => (
        <rect
          key={angle}
          x="10.75"
          y="1.9"
          width="2.5"
          height="5"
          rx="1"
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
      <path
        fillRule="evenodd"
        d="M12 5.1a6.9 6.9 0 1 0 0 13.8 6.9 6.9 0 0 0 0-13.8Zm0 4.25a2.65 2.65 0 1 1 0 5.3 2.65 2.65 0 0 1 0-5.3Z"
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
