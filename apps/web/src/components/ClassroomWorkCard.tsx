import { useState, type ReactNode } from 'react';
import type { ProjectCardUsage } from '../api';
import { ProjectModuleIcon } from '../modules/ProjectModuleIcon';
import { PortalLink } from './PortalLink';
import { useSchoolTime } from './school-time';
import { WorkSnapshot } from './WorkPreview';
import './classroom-work-card.css';

type EditorAction = { readonly href?: string; readonly onOpen: () => void };

function activeDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—';
  if (seconds > 0 && seconds < 60) return '<1 мин';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return String(minutes) + ' мин';
  return String(Math.floor(minutes / 60)) + ' ч ' + String(minutes % 60) + ' мин';
}

export function ClassroomWorkCard({
  projectId,
  title,
  learner,
  moduleKey,
  moduleLabel,
  status,
  archived,
  createdAt,
  updatedAt,
  usage,
  revision,
  refresh,
  snapshotUrl,
  fallback,
  onPreview,
  editor,
}: {
  readonly projectId: string;
  readonly title: string;
  readonly learner?: string | undefined;
  readonly moduleKey: string;
  readonly moduleLabel: string;
  readonly status?: ReactNode;
  readonly archived?: boolean | undefined;
  readonly createdAt?: string | undefined;
  readonly updatedAt: string;
  readonly usage?: ProjectCardUsage | undefined;
  readonly revision?: number | null | undefined;
  readonly refresh?: number | undefined;
  readonly snapshotUrl?: string | null | undefined;
  readonly fallback?: ReactNode;
  readonly onPreview: () => void;
  readonly editor?: EditorAction | undefined;
}): JSX.Element {
  const editorLabel = 'Открыть в редакторе: ' + title;
  const previewLabel = 'Предпросмотр работы ' + title + (learner ? ', ' + learner : '');
  const time = useSchoolTime();
  const [failedSnapshot, setFailedSnapshot] = useState<string | null>(null);
  const empty = fallback ?? <span>Без снимка</span>;
  return (
    <li className="classroom-work-card" data-project-id={projectId}>
      <button
        type="button"
        className="classroom-work-card-preview"
        aria-label={previewLabel}
        aria-haspopup={editor ? 'dialog' : undefined}
        onClick={onPreview}
      >
        <span className="classroom-work-card-picture">
          {snapshotUrl === undefined ? (
            <WorkSnapshot
              projectId={projectId}
              revision={revision}
              refresh={refresh}
              alt=""
              lazy
              fallback={empty}
            />
          ) : snapshotUrl && failedSnapshot !== snapshotUrl ? (
            <img
              src={snapshotUrl}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setFailedSnapshot(snapshotUrl)}
            />
          ) : (
            empty
          )}
        </span>
        <span className="classroom-work-card-title">
          <strong title={title}>{title}</strong>
          {learner ? <span title={learner}>{learner}</span> : null}
          {status || archived ? (
            <span className="classroom-work-card-meta">
              {status}
              {archived ? <span>Архив</span> : null}
            </span>
          ) : null}
        </span>
        <span className="classroom-work-card-details">
          <span title={time.date(createdAt)}>
            Создан <time dateTime={createdAt}>{time.shortDate(createdAt)}</time>
          </span>
          <span title={time.date(updatedAt)}>
            Изменён <time dateTime={updatedAt}>{time.shortDate(updatedAt)}</time>
          </span>
          <span>Открытий {usage?.openCount ?? '—'}</span>
          <span title="Активное время автора">Время {activeDuration(usage?.activeSeconds)}</span>
        </span>
      </button>
      <span
        className="classroom-work-card-module"
        role="img"
        aria-label={moduleLabel}
        title={moduleLabel}
      >
        <ProjectModuleIcon moduleKey={moduleKey} size={22} />
      </span>
      {editor?.href ? (
        <PortalLink
          className="classroom-work-card-editor"
          aria-label={editorLabel}
          href={editor.href}
          onNavigate={editor.onOpen}
        >
          Открыть в редакторе
        </PortalLink>
      ) : editor ? (
        <button
          className="classroom-work-card-editor"
          type="button"
          aria-label={editorLabel}
          onClick={editor.onOpen}
        >
          Открыть в редакторе
        </button>
      ) : null}
    </li>
  );
}
