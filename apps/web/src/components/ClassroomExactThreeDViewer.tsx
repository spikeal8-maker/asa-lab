import { useMemo, type ReactNode } from 'react';
import { parseThreeDDocument } from '@asa-lab/three-d/document';
import { ThreeDProjectViewer } from '../three-d/ThreeDProjectViewer';

export interface ClassroomExactThreeDViewerProps {
  readonly document: unknown;
  readonly label?: string;
  readonly fallback: ReactNode;
}

export default function ClassroomExactThreeDViewer({
  document,
  label = 'Сданная 3D-модель',
  fallback,
}: ClassroomExactThreeDViewerProps): JSX.Element {
  const parsed = useMemo(() => parseThreeDDocument(document), [document]);
  if (!parsed.ok)
    return (
      <>
        <p role="status">Не удалось запустить 3D-просмотр.</p>
        {fallback}
      </>
    );
  return <ThreeDProjectViewer document={parsed.value} label={label} fallback={fallback} />;
}
