import { useMemo, type ReactNode } from 'react';
import type { PublicThreeDArtifact } from '@asa-lab/contracts';
import { ThreeDProjectViewer } from '../three-d/ThreeDProjectViewer';
import { publicThreeDDocument } from '../three-d/public-three-d-document';

export function PublicThreeDViewer({
  artifact,
  fallback,
}: {
  readonly artifact: PublicThreeDArtifact;
  readonly fallback: ReactNode;
}): JSX.Element {
  const document = useMemo(() => publicThreeDDocument(artifact), [artifact]);
  return (
    <ThreeDProjectViewer
      document={document}
      label="Интерактивная 3D-модель"
      fallback={fallback}
      testId="public-three-d-viewer"
    />
  );
}
