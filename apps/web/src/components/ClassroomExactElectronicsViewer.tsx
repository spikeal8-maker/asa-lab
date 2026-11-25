import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  validateClassroomElectronicsSimulation,
  validateClassroomFreeElectronicsSimulation,
} from '@asa-lab/contracts';
import {
  loadProductionLibrary,
  productionLibraryReady,
} from '../electronics/production-manifest-adapter';
import { ClassroomElectronicsSimulationScene } from '../projects-public/ElectronicsPublicationScene';

export interface ClassroomExactElectronicsViewerProps {
  readonly artifact: unknown;
  readonly identity:
    | {
        readonly kind: 'submission';
        readonly submissionId: string;
        readonly projectVersionId: string;
      }
    | { readonly kind: 'free'; readonly projectId: string; readonly revision: number };
  readonly fallback: ReactNode;
}

class CircuitBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; message: string },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? (
      <Unavailable message={this.props.message}>{this.props.fallback}</Unavailable>
    ) : (
      this.props.children
    );
  }
}

function Unavailable({ children, message }: { children: ReactNode; message: string }) {
  return (
    <>
      <p role="status">{message}</p>
      {children}
    </>
  );
}

export default function ClassroomExactElectronicsViewer({
  artifact,
  identity,
  fallback,
}: ClassroomExactElectronicsViewerProps): JSX.Element {
  const submissionId = identity.kind === 'submission' ? identity.submissionId : undefined;
  const versionId = identity.kind === 'submission' ? identity.projectVersionId : undefined;
  const projectId = identity.kind === 'free' ? identity.projectId : undefined;
  const revision = identity.kind === 'free' ? identity.revision : undefined;
  const simulation = useMemo(() => {
    if (projectId) {
      const validated = validateClassroomFreeElectronicsSimulation(artifact);
      return validated?.projectId === projectId && validated.revision === revision
        ? validated
        : null;
    }
    const validated = validateClassroomElectronicsSimulation(artifact);
    return validated?.submissionId === submissionId && validated?.projectVersionId === versionId
      ? validated
      : null;
  }, [artifact, projectId, revision, submissionId, versionId]);
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

  const unavailableMessage =
    identity.kind === 'submission'
      ? 'Симуляция этой сдачи недоступна.'
      : 'Симуляция сохранённой работы недоступна.';
  if (!simulation || status === 'failed')
    return <Unavailable message={unavailableMessage}>{fallback}</Unavailable>;
  if (status === 'loading')
    return (
      <>
        <p role="status">Загружаем схему…</p>
        {fallback}
      </>
    );

  return (
    <CircuitBoundary fallback={fallback} message={unavailableMessage}>
      <ClassroomElectronicsSimulationScene
        source={simulation}
        onUnavailable={() => setStatus('failed')}
      />
    </CircuitBoundary>
  );
}
