import type { ReactNode } from 'react';
import { PortalLink } from './PortalLink';
import { WorkSnapshot } from './WorkPreview';
import './classroom-work-card.css';

type EditorAction = { readonly href?: string; readonly onOpen: () => void };

export function ClassroomWorkCard({
  projectId,
  title,
  learner,
  moduleLabel,
  status,
  archived,
  updatedAt,
  dateLabel,
  revision,
  refresh,
  fallback,
  onPreview,
  editor,
}: {
  readonly projectId: string;
  readonly title: string;
  readonly learner: string;
  readonly moduleLabel: string;
  readonly status: ReactNode;
  readonly archived: boolean;
  readonly updatedAt: string;
  readonly dateLabel: string;
  readonly revision?: number | null | undefined;
  readonly refresh?: number | undefined;
  readonly fallback?: ReactNode;
  readonly onPreview: () => void;
  readonly editor: EditorAction;
}): JSX.Element {
  const editorLabel = `Открыть в редакторе: ${title}`;
  return (
    <li className="classroom-work-card" data-project-id={projectId}>
      <button
        type="button"
        className="classroom-work-card-preview"
        aria-label={`Предпросмотр работы ${title}, ${learner}`}
        aria-haspopup="dialog"
        onClick={onPreview}
      >
        <span className="classroom-work-card-picture">
          <WorkSnapshot
            projectId={projectId}
            revision={revision}
            refresh={refresh}
            alt=""
            lazy
            fallback={fallback ?? <span>Без снимка</span>}
          />
        </span>
        <span className="classroom-work-card-title">
          <strong>{title}</strong>
          <span>{learner}</span>
          <span className="classroom-work-card-meta">
            <span>{moduleLabel}</span>
            {status}
            {archived ? <span>Архив</span> : null}
          </span>
          <time dateTime={updatedAt}>{dateLabel}</time>
        </span>
      </button>
      {editor.href ? (
        <PortalLink
          className="btn-secondary classroom-work-card-editor"
          aria-label={editorLabel}
          href={editor.href}
          onNavigate={editor.onOpen}
        >
          Открыть в редакторе
        </PortalLink>
      ) : (
        <button
          className="classroom-work-card-editor"
          type="button"
          aria-label={editorLabel}
          onClick={editor.onOpen}
        >
          Открыть в редакторе
        </button>
      )}
    </li>
  );
}
