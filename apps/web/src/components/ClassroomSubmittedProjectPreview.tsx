import { lazy, Suspense, useId, useRef, useState, type ReactNode } from 'react';
import type { ObservationFreeProjectPreview } from '../classroom-observation-api';
import type { ExactLearningSubmission } from '../api';
import { ProjectPreviewFigure } from '../modules/ProjectPreviewFigure';
import { ProjectPlaybackStage } from '../modules/ProjectPlaybackStage';
import type { ClassroomExactElectronicsViewerProps } from './ClassroomExactElectronicsViewer';
import type { ClassroomExactThreeDViewerProps } from './ClassroomExactThreeDViewer';
import './classroom-gradebook.css';

const ExactThreeDViewer = lazy(() =>
  import('./ClassroomExactThreeDViewer').catch(() => ({
    default: ({ fallback }: ClassroomExactThreeDViewerProps) => (
      <>
        <p role="status">Не удалось запустить 3D-просмотр.</p>
        {fallback}
      </>
    ),
  })),
);

const ExactElectronicsViewer = lazy(() =>
  import('./ClassroomExactElectronicsViewer').catch(() => ({
    default: ({ fallback }: ClassroomExactElectronicsViewerProps) => (
      <>
        <p role="status">Не удалось загрузить симуляцию.</p>
        {fallback}
      </>
    ),
  })),
);

const RoboticsViewer = lazy(() =>
  import('../robotics/RoboticsProjectViewer').catch(() => ({
    default: ({ fallback }: { fallback: ReactNode }) => <>{fallback}</>,
  })),
);

const ExactArduinoSource = lazy(() =>
  import('./ClassroomExactArduinoSource').catch(() => ({ default: () => null })),
);

export type FrozenProject = Extract<ExactLearningSubmission, { projectVersionId: string }>;

export function FrozenProjectPreview({
  submission,
  initiallyOpen = false,
}: {
  submission: FrozenProject;
  initiallyOpen?: boolean;
}) {
  return (
    <ProjectPlaybackStage>
      <ClassroomProjectPlayback
        project={submission}
        initiallyOpen={initiallyOpen}
        snapshotLabel="Точный снимок сданной работы"
      />
    </ProjectPlaybackStage>
  );
}

export function FreeProjectPreview({
  project,
  snapshot,
}: {
  project: ObservationFreeProjectPreview;
  snapshot: ReactNode;
}) {
  return (
    <ProjectPlaybackStage>
      <ClassroomProjectPlayback
        project={project}
        initiallyOpen
        snapshotLabel="Снимок сохранённой работы"
        snapshot={snapshot}
      />
    </ProjectPlaybackStage>
  );
}

function ClassroomProjectPlayback({
  project,
  initiallyOpen,
  snapshotLabel,
  snapshot,
}: {
  project: FrozenProject | ObservationFreeProjectPreview;
  initiallyOpen: boolean;
  snapshotLabel: string;
  snapshot?: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const viewerId = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const fallback = project.preview?.figure ? (
    <ProjectPreviewFigure figure={project.preview.figure} label={snapshotLabel} />
  ) : (
    (snapshot ?? <p>Визуальный предпросмотр для этого снимка недоступен.</p>)
  );
  if (!('submissionId' in project) && project.moduleKey === 'robotics') {
    const sessionId = `classroom-robot:${project.projectId}:${project.revision}`;
    return (
      <Suspense fallback={fallback}>
        <RoboticsViewer
          key={sessionId}
          sessionId={sessionId}
          document={project.document}
          fallback={fallback}
        />
      </Suspense>
    );
  }
  if (project.moduleKey === 'electronics') {
    const expanded = open && Boolean(project.electronicsSimulation);
    return (
      <div
        className="gradebook-electronics-preview"
        onKeyDown={(event) => {
          if (
            initiallyOpen ||
            event.defaultPrevented ||
            event.key !== 'Escape' ||
            !open ||
            document.fullscreenElement
          )
            return;
          event.preventDefault();
          setOpen(false);
          opener.current?.focus();
        }}
      >
        {!initiallyOpen && project.electronicsSimulation && (
          <button
            ref={opener}
            type="button"
            className="btn-secondary"
            aria-controls={viewerId}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? 'Скрыть симуляцию' : 'Открыть симуляцию'}
          </button>
        )}
        <div id={viewerId} hidden={!expanded}>
          {expanded && (
            <Suspense
              fallback={
                <>
                  {fallback}
                  <p role="status">Загружаем схему…</p>
                </>
              }
            >
              <ExactElectronicsViewer
                artifact={project.electronicsSimulation}
                document={project.document}
                identity={
                  'submissionId' in project
                    ? {
                        kind: 'submission',
                        submissionId: project.submissionId,
                        projectVersionId: project.projectVersionId,
                      }
                    : { kind: 'free', projectId: project.projectId, revision: project.revision }
                }
                fallback={fallback}
              />
            </Suspense>
          )}
        </div>
        {!expanded && fallback}
        {!expanded && (
          <Suspense fallback={null}>
            <ExactArduinoSource document={project.document} />
          </Suspense>
        )}
      </div>
    );
  }
  if (project.moduleKey !== 'three-d') return fallback;

  return (
    <div
      className="gradebook-three-d-preview"
      onKeyDown={(event) => {
        if (
          initiallyOpen ||
          event.defaultPrevented ||
          event.key !== 'Escape' ||
          !open ||
          document.fullscreenElement
        )
          return;
        event.preventDefault();
        setOpen(false);
        opener.current?.focus();
      }}
    >
      {!initiallyOpen && (
        <button
          ref={opener}
          type="button"
          className="btn-secondary"
          aria-controls={viewerId}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Скрыть 3D-модель' : 'Показать 3D-модель'}
        </button>
      )}
      <div id={viewerId} hidden={!open}>
        {open && (
          <Suspense
            fallback={
              <>
                <p role="status">Загружаем 3D-модель…</p>
                {fallback}
              </>
            }
          >
            <ExactThreeDViewer
              document={project.document}
              label={'submissionId' in project ? 'Сданная 3D-модель' : 'Сохранённая 3D-модель'}
              fallback={fallback}
            />
          </Suspense>
        )}
      </div>
      {!open && fallback}
    </div>
  );
}
