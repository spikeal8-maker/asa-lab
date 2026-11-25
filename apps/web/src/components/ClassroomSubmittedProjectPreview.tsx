import { lazy, Suspense, useId, useRef, useState } from 'react';
import type { ExactLearningSubmission } from '../api';
import { ProjectPreviewFigure } from '../modules/ProjectPreviewFigure';
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
  const [open, setOpen] = useState(initiallyOpen);
  const viewerId = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const fallback = submission.preview?.figure ? (
    <ProjectPreviewFigure figure={submission.preview.figure} label="Точный снимок сданной работы" />
  ) : (
    <p>Визуальный предпросмотр для этого снимка недоступен.</p>
  );
  if (submission.moduleKey === 'electronics') {
    const expanded = open && Boolean(submission.electronicsSimulation);
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
        {!initiallyOpen && submission.electronicsSimulation && (
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
                artifact={submission.electronicsSimulation}
                submissionId={submission.submissionId}
                projectVersionId={submission.projectVersionId}
                fallback={fallback}
              />
            </Suspense>
          )}
        </div>
        {!expanded && fallback}
        <Suspense fallback={null}>
          <ExactArduinoSource document={submission.document} />
        </Suspense>
      </div>
    );
  }
  if (submission.moduleKey !== 'three-d') return fallback;

  return (
    <div
      className="gradebook-three-d-preview"
      onKeyDown={(event) => {
        if (initiallyOpen || event.key !== 'Escape' || !open) return;
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
            <ExactThreeDViewer document={submission.document} fallback={fallback} />
          </Suspense>
        )}
      </div>
      {!open && fallback}
    </div>
  );
}
