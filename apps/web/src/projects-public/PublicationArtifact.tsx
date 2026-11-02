import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import type {
  ElectronicsDisplayArtifact,
  ElectronicsSimulationArtifact,
  PublicThreeDArtifact,
} from '@asa-lab/contracts';
import { publicProjectsApi, type PublicProject } from './api';
import { PublicationPreview } from './PublicationPreview';

const Scene = lazy(() =>
  import('./ElectronicsPublicationScene').then((module) => ({
    default: module.ElectronicsPublicationScene,
  })),
);
const ScratchPlayer = lazy(() =>
  import('./PublicScratchPlayer').then((module) => ({ default: module.PublicScratchPlayer })),
);
const ThreeDViewer = lazy(() =>
  import('./PublicThreeDViewer').then((m) => ({ default: m.PublicThreeDViewer })),
);
class SceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
export function PublicationArtifact({
  publication,
  onUnavailable,
}: {
  readonly publication: PublicProject;
  readonly onUnavailable: () => void;
}): JSX.Element {
  const [artifact, setArtifact] = useState<
    ElectronicsDisplayArtifact | ElectronicsSimulationArtifact | PublicThreeDArtifact | null
  >(null);
  const [state, setState] = useState<'loading' | 'fallback' | 'error'>('loading');
  useEffect(() => {
    setArtifact(null);
    setState('loading');
    if (!['electronics', 'three-d'].includes(publication.moduleKey)) {
      setState('fallback');
      return;
    }
    const controller = new AbortController();
    let active = true;
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    void publicProjectsApi
      .artifact(publication.publicationId, publication.revisionId, controller.signal)
      .then(async (result) => {
        if (!active) return;
        if (!result.ok) {
          if ([403, 404, 409, 410].includes(result.status)) {
            onUnavailable();
            return;
          }
          setState('error');
          return;
        }
        const value = result.data.artifact;
        if (
          value.provenance.publicationId !== publication.publicationId ||
          value.provenance.revisionNumber !== publication.revisionNo
        ) {
          onUnavailable();
          return;
        }
        if (
          value.schemaVersion === 4 &&
          value.viewerFamily === 'three-d' &&
          publication.moduleKey === 'three-d'
        ) {
          setArtifact(value);
        } else if (
          (value.schemaVersion === 2 || value.schemaVersion === 3) &&
          (value.status === 'display' || value.status === 'simulation') &&
          value.viewerFamily === 'electronics' &&
          publication.moduleKey === 'electronics'
        ) {
          const library = await import('../electronics/production-manifest-adapter');
          if (!active) return;
          if (!library.productionLibraryReady()) {
            const response = await fetch(library.OWNER_CATALOG_MANIFEST_URL, {
              signal: controller.signal,
            });
            if (!response.ok) throw new Error('Catalog unavailable');
            const manifest = await response.json();
            if (!active) return;
            library.configureProductionLibrary(manifest);
          }
          if (active) setArtifact(value);
        } else setState('fallback');
      })
      .catch(() => {
        if (active) setState('error');
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [publication, onUnavailable]);
  const fallback = (
    <div data-testid="public-artifact-fallback">
      <PublicationPreview publication={publication} detail />
    </div>
  );
  if (publication.moduleKey === 'blocks')
    return (
      <SceneBoundary fallback={fallback}>
        <Suspense fallback={<p role="status">Загружаем Scratch…</p>}>
          <ScratchPlayer
            publicationId={publication.publicationId}
            revisionId={publication.revisionId}
            onUnavailable={onUnavailable}
            fallback={fallback}
          />
        </Suspense>
      </SceneBoundary>
    );
  if (artifact?.schemaVersion === 4)
    return (
      <SceneBoundary fallback={fallback}>
        <Suspense fallback={fallback}>
          <ThreeDViewer
            key={`${artifact.provenance.publicationId}:${artifact.provenance.revisionNumber}`}
            artifact={artifact}
            fallback={fallback}
          />
        </Suspense>
      </SceneBoundary>
    );
  if (artifact)
    return (
      <SceneBoundary fallback={fallback}>
        <Suspense
          fallback={
            <p role="status" data-testid="public-artifact-loading">
              Готовим схему…
            </p>
          }
        >
          <Scene
            key={`${artifact.provenance.publicationId}:${artifact.provenance.revisionNumber}`}
            artifact={artifact}
          />
        </Suspense>
      </SceneBoundary>
    );
  if (state === 'loading')
    return (
      <p className="public-artifact-state" data-testid="public-artifact-loading" role="status">
        {publication.moduleKey === 'three-d' ? 'Загружаем модель…' : 'Загружаем схему…'}
      </p>
    );
  return (
    <>
      {state === 'error' ? (
        <p data-testid="public-artifact-error" role="status">
          Просмотр не загрузился. Обновите страницу, чтобы повторить.
        </p>
      ) : null}
      {fallback}
    </>
  );
}
