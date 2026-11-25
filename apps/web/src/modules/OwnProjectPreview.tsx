import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { projectSnapshotUrl, type Project } from '../api';
import { call } from '../api-call';
import type { ObservationFreeProjectPreview } from '../classroom-observation-api';
import { PortalLink } from '../components/PortalLink';
import { ViewIcon } from '../electronics/workbench-icons';
import { ProjectPreviewDialog } from './ProjectPlaybackStage';

const SavedViewer = lazy(() =>
  import('../components/ClassroomSubmittedProjectPreview')
    .then((module) => ({ default: module.FreeProjectPreview }))
    .catch(() => ({ default: () => <p role="status">Не удалось загрузить просмотр.</p> })),
);

interface CoverProps {
  project: Project;
  className: string;
  editor: { href: string; onNavigate: () => void };
  children: ReactNode;
  redundantEditorLink?: boolean;
}

export function ProjectCover({
  project,
  className,
  editor,
  children,
  redundantEditorLink,
}: CoverProps) {
  const [open, setOpen] = useState(false);
  if (
    project.status === 'trashed' ||
    !['electronics', 'three-d', 'robotics'].includes(project.moduleKey)
  ) {
    return (
      <PortalLink
        className={className}
        {...editor}
        {...(redundantEditorLink ? { tabIndex: -1, 'aria-hidden': true } : {})}
      >
        {children}
      </PortalLink>
    );
  }
  return (
    <>
      <button
        type="button"
        className={className + ' project-cover-button'}
        aria-label={`Предпросмотр работы ${project.title}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {children}
        <span aria-hidden="true" className="project-cover-view">
          <ViewIcon />
        </span>
      </button>
      {open && (
        <OwnProjectDialog
          key={project.id}
          project={project}
          editor={editor}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function OwnProjectDialog({
  project,
  editor,
  onClose,
}: {
  project: Project;
  editor: CoverProps['editor'];
  onClose: () => void;
}) {
  const [saved, setSaved] = useState<ObservationFreeProjectPreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [request, setRequest] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void call<ObservationFreeProjectPreview>(
      `/api/projects/${encodeURIComponent(project.id)}/preview`,
      {
        signal: abort.signal,
      },
    ).then((result) => {
      if (abort.signal.aborted) return;
      if (
        result.ok &&
        result.data?.projectId === project.id &&
        result.data.moduleKey === project.moduleKey &&
        Number.isSafeInteger(result.data.revision) &&
        result.data.revision > 0
      )
        setSaved(result.data);
      else setFailed(true);
    });
    return () => abort.abort();
  }, [project.id, project.moduleKey, request]);
  const loading = <p role="status">Загружаем работу…</p>;
  const snapshot =
    saved && saved.revision === project.snapshotRevision ? projectSnapshotUrl(project) : null;
  return (
    <ProjectPreviewDialog
      title={project.title}
      label={`Работа: ${project.title}`}
      onClose={onClose}
    >
      {saved ? (
        <Suspense fallback={loading}>
          <SavedViewer
            project={saved}
            snapshot={
              snapshot ? (
                <img alt={project.title} src={snapshot} />
              ) : (
                <p role="status">У этой версии пока нет снимка.</p>
              )
            }
          />
        </Suspense>
      ) : failed ? (
        <div role="alert">
          Не удалось открыть предпросмотр.{' '}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setFailed(false);
              setRequest((old) => old + 1);
            }}
          >
            Повторить
          </button>
        </div>
      ) : (
        loading
      )}
      <div className="work-preview-actions">
        <PortalLink className="btn-secondary" {...editor}>
          Открыть в редакторе
        </PortalLink>
      </div>
    </ProjectPreviewDialog>
  );
}
