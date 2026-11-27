import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import type { StudentPublicationReviewArtifact as ReviewDisplay } from '@asa-lab/contracts';
import { ProjectPlaybackStage } from '../modules/ProjectPlaybackStage';
import {
  type PublicationReviewScope,
  type ReviewRequest,
  studentPublicationReviewerApi,
} from './student-publication-review-api';

const ThreeD = lazy(() =>
  import('./PublicThreeDViewer').then((module) => ({ default: module.PublicThreeDViewer })),
);
const Electronics = lazy(() =>
  import('./ElectronicsPublicationScene').then((module) => ({
    default: module.ElectronicsPublicationScene,
  })),
);
const Robotics = lazy(() => import('../robotics/RoboticsReviewViewer'));
const Scratch = lazy(() =>
  import('./PublicScratchPlayer').then((module) => ({ default: module.PublicScratchPlayer })),
);

function keepViewerPreloadFailureLocal(event: Event): void {
  const reason = (event as CustomEvent<unknown>).detail;
  if (!(reason instanceof Error)) return;
  const address = reason.message.match(/https?:\/\/[^\s]+/)?.[0];
  if (!address) return;
  try {
    const asset = new URL(address);
    if (
      asset.origin === window.location.origin &&
      /^\/assets\/(PublicThreeDViewer|ElectronicsPublicationScene|production-manifest-adapter|RoboticsReviewViewer|PublicScratchPlayer)-[\w-]+\.js$/.test(
        asset.pathname,
      )
    )
      event.preventDefault();
  } catch {
    // Other route chunks retain the application's normal recovery.
  }
}

class ViewerBoundary extends Component<
  { readonly children: ReactNode; readonly onReloadRequired: () => void },
  { readonly failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    this.props.onReloadRequired();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function StudentPublicationReviewArtifact({
  base,
  scope,
  request,
  onReady,
  onUnavailable,
  onReloadRequired,
}: {
  readonly base: string;
  readonly scope: PublicationReviewScope;
  readonly request: ReviewRequest;
  readonly onReady: () => void;
  readonly onUnavailable: () => void;
  readonly onReloadRequired: () => void;
}): JSX.Element | null {
  const [artifact, setArtifact] = useState<ReviewDisplay | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const event = 'asa-optional-preload-error';
    window.addEventListener(event, keepViewerPreloadFailureLocal);
    return () => window.removeEventListener(event, keepViewerPreloadFailureLocal);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(false);
      onUnavailable();
      controller.abort();
    }, 20_000);
    void (async () => {
      const exact = await studentPublicationReviewerApi.artifact(base, request, controller.signal);
      if (controller.signal.aborted) return;
      if (!exact) throw new Error('Review artifact unavailable');
      if (exact.schemaVersion === 3) {
        const library = await import('../electronics/production-manifest-adapter').catch(() => {
          if (!controller.signal.aborted) onReloadRequired();
          return null;
        });
        if (!library || controller.signal.aborted) return;
        if (!library.productionLibraryReady()) {
          const response = await fetch(library.OWNER_CATALOG_MANIFEST_URL, {
            signal: controller.signal,
          });
          if (!response.ok) throw new Error('Catalog unavailable');
          const manifest = await response.json();
          if (controller.signal.aborted) return;
          library.configureProductionLibrary(manifest);
        }
      }
      if (!controller.signal.aborted) setArtifact(exact);
    })()
      .catch(() => {
        if (!controller.signal.aborted) onUnavailable();
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [base, request, onReloadRequired, onUnavailable]);

  const pending = <p role="status">Загружаем сохранённую работу…</p>;
  if (loading) return pending;
  if (!artifact) return null;
  return (
    <ProjectPlaybackStage>
      <ViewerBoundary onReloadRequired={onReloadRequired}>
        <Suspense fallback={pending}>
          {artifact.schemaVersion === 4 ? (
            <ThreeD
              artifact={artifact}
              fallback={null}
              onReady={onReady}
              onUnavailable={onUnavailable}
            />
          ) : artifact.schemaVersion === 3 ? (
            <Electronics artifact={artifact} onReady={onReady} onUnavailable={onUnavailable} />
          ) : artifact.schemaVersion === 7 ? (
            <Robotics artifact={artifact} onReady={onReady} onUnavailable={onUnavailable} />
          ) : (
            <Scratch
              publicationId={request.requestId}
              revisionId={request.requestId}
              review={
                scope
                  ? {
                      role: 'teacher',
                      classroomId: scope.classroomId,
                      sourceRevision: request.sourceRevision,
                    }
                  : { role: 'platform', sourceRevision: request.sourceRevision }
              }
              onReady={onReady}
              onUnavailable={onUnavailable}
              fallback={null}
            />
          )}
        </Suspense>
      </ViewerBoundary>
    </ProjectPlaybackStage>
  );
}
