import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { validateClassroomElectronicsSimulation } from '@asa-lab/contracts';
import {
  loadProductionLibrary,
  productionLibraryReady,
} from '../electronics/production-manifest-adapter';
import { ClassroomElectronicsSimulationScene } from '../projects-public/ElectronicsPublicationScene';

export interface ClassroomExactElectronicsViewerProps {
  readonly artifact: unknown;
  readonly submissionId: string;
  readonly projectVersionId: string;
  readonly fallback: ReactNode;
}

class CircuitBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <Unavailable>{this.props.fallback}</Unavailable>
    ) : (
      this.props.children
    );
  }
}

function Unavailable({ children }: { children: ReactNode }) {
  return (
    <>
      <p role="status">Симуляция этой сдачи недоступна.</p>
      {children}
    </>
  );
}

export default function ClassroomExactElectronicsViewer({
  artifact,
  submissionId,
  projectVersionId,
  fallback,
}: ClassroomExactElectronicsViewerProps): JSX.Element {
  const simulation = useMemo(() => {
    const validated = validateClassroomElectronicsSimulation(artifact);
    return validated?.submissionId === submissionId &&
      validated.projectVersionId === projectVersionId
      ? validated
      : null;
  }, [artifact, projectVersionId, submissionId]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(() =>
    productionLibraryReady() ? 'ready' : 'loading',
  );

  useEffect(() => {
    if (!simulation) return;
    if (productionLibraryReady()) {
      setStatus('ready');
      return;
    }
    let open = true;
    void loadProductionLibrary().then(
      () => {
        if (open) setStatus(productionLibraryReady() ? 'ready' : 'failed');
      },
      () => {
        if (open) setStatus('failed');
      },
    );
    return () => {
      open = false;
    };
  }, [simulation]);

  if (!simulation || status === 'failed') return <Unavailable>{fallback}</Unavailable>;
  if (status === 'loading')
    return (
      <>
        <p role="status">Загружаем схему…</p>
        {fallback}
      </>
    );

  return (
    <CircuitBoundary fallback={fallback}>
      <ClassroomElectronicsSimulationScene
        submission={simulation}
        onUnavailable={() => setStatus('failed')}
      />
    </CircuitBoundary>
  );
}
