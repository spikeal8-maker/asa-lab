import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_VIEWPORT } from '@asa-lab/electronics';
import {
  validateStudentPublicationReviewArtifact,
  type ElectronicsDisplayArtifact,
  type RoboticsPublicationReviewArtifact,
} from '@asa-lab/contracts';
import { parseRoboticsProject } from '@asa-lab/robotics/document';
import { ElectronicsPublicationScene } from '../projects-public/ElectronicsPublicationScene';
import RoboticsProjectViewer from './RoboticsProjectViewer';

export function roboticsPublicationReviewDocument(input: unknown) {
  const artifact = validateStudentPublicationReviewArtifact(input);
  if (artifact?.schemaVersion !== 7) return null;
  const parsed = parseRoboticsProject({
    schemaVersion: artifact.robotVersion,
    title: 'Сохранённая работа',
    world: artifact.world,
    circuit: { ...artifact.circuit, viewport: DEFAULT_VIEWPORT },
  });
  return parsed.ok ? { artifact, project: parsed.project } : null;
}

function circuitFigure(
  artifact: RoboticsPublicationReviewArtifact,
  project: NonNullable<ReturnType<typeof roboticsPublicationReviewDocument>>['project'],
): ElectronicsDisplayArtifact {
  return {
    schemaVersion: 2,
    viewerFamily: 'electronics',
    status: 'display',
    provenance: artifact.provenance,
    capabilities: artifact.capabilities,
    connections: project.circuit.connections,
    components: project.circuit.components.map(({ stateProperties, ...component }) => {
      const pinLayout = stateProperties?.['pinLayout'];
      return {
        ...component,
        visualProperties: {
          mirrorX: stateProperties?.['mirrorX'] === true,
          mirrorY: stateProperties?.['mirrorY'] === true,
          ...(pinLayout === 'RCBG' || pinLayout === 'RCGB' || pinLayout === 'BRCG'
            ? { pinLayout }
            : {}),
        },
      };
    }),
  };
}

export default function RoboticsReviewViewer({
  artifact: input,
  onReady,
  onUnavailable,
}: {
  readonly artifact: unknown;
  readonly onReady?: () => void;
  readonly onUnavailable?: () => void;
}) {
  const model = useMemo(() => roboticsPublicationReviewDocument(input), [input]);
  const [circuitOpen, setCircuitOpen] = useState(false);
  const unavailable = useRef(onUnavailable);
  unavailable.current = onUnavailable;
  useEffect(() => {
    if (!model) unavailable.current?.();
  }, [model]);
  if (!model) return <p role="status">Точный просмотр робототехники недоступен.</p>;
  const { artifact, project } = model;
  const { publicationId, revisionNumber } = artifact.provenance;
  return (
    <section aria-label="Проверка сохранённого робота">
      <RoboticsProjectViewer
        document={project}
        sessionId={'publication-review:' + publicationId + ':' + revisionNumber}
        fallback={null}
        {...(onReady ? { onReady } : {})}
        {...(onUnavailable ? { onUnavailable } : {})}
      />
      <details onToggle={(event) => setCircuitOpen(event.currentTarget.open)}>
        <summary>Электрическая схема робота</summary>
        {circuitOpen && (
          <>
            <ElectronicsPublicationScene artifact={circuitFigure(artifact, project)} />
            {project.circuit.annotations?.map((annotation) => (
              <p key={annotation.id} style={{ whiteSpace: 'pre-wrap' }}>
                {annotation.text}
              </p>
            ))}
          </>
        )}
      </details>
    </section>
  );
}
