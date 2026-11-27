import type { ModuleRegistry } from '@asa-lab/module-sdk';
import type { RoboticsProject } from '@asa-lab/robotics/document';
import {
  classroomArduinoBlocks,
  PUBLIC_ELECTRONICS_EDITOR_PROPERTIES,
  PUBLIC_ELECTRONICS_PROPERTIES,
  validateStudentPublicationReviewArtifact,
  type PublicArtifactProvenance,
  type RoboticsPublicationReviewArtifact,
} from '@asa-lab/contracts';
import { validatePortableProjectCopyDocument } from './private-project-copy-document.js';

const circuitState = new Set([
  ...PUBLIC_ELECTRONICS_PROPERTIES.filter((key) => key !== 'arduinoBlocks'),
  ...PUBLIC_ELECTRONICS_EDITOR_PROPERTIES,
  'arduinoInputPins',
  'arduinoSerialBaud',
  'echoAvailable',
  'simulationStatus',
]);
const editorOnly = new Set(['arduinoSerialOpen', 'arduinoSerialBaud', 'arduinoBaudRate']);

function rasterMatchesType(value: string): boolean {
  const [prefix, data] = value.split(',', 2);
  if (!data) return false;
  const header = Buffer.from(data.slice(0, 24), 'base64');
  switch (prefix) {
    case 'data:image/png;base64':
      return header
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'data:image/jpeg;base64':
      return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    case 'data:image/webp;base64':
      return (
        header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP'
      );
    default:
      return false;
  }
}

export function createRoboticsPublicationReviewArtifact(
  registry: ModuleRegistry,
  document: unknown,
  provenance: PublicArtifactProvenance,
): RoboticsPublicationReviewArtifact | null {
  const source = validatePortableProjectCopyDocument(registry, 'robotics', document);
  if (!source) return null;
  const project = source.document as RoboticsProject;
  const { world, circuit } = project;
  const circuitIds = new Set(circuit.components.map(({ id }) => id));
  if (
    !Object.values(world.bindings).every((id) => circuitIds.has(id)) ||
    world.field.visuals?.some(
      (visual) => visual.kind === 'image' && !rasterMatchesType(visual.imageData ?? ''),
    )
  )
    return null;

  const components: Array<RoboticsProject['circuit']['components'][number]> = [];
  for (const component of circuit.components) {
    if (!component.stateProperties) {
      components.push(component);
      continue;
    }
    const stateProperties: Record<string, string | number | boolean | readonly string[]> = {};
    for (const [key, value] of Object.entries(component.stateProperties)) {
      if (!circuitState.has(key)) return null;
      if (editorOnly.has(key)) continue;
      if (key === 'arduinoWorkspace') {
        const blocks = classroomArduinoBlocks(value);
        if (!blocks) return null;
        stateProperties[key] = blocks;
      } else {
        stateProperties[key] = value;
      }
    }
    components.push({ ...component, stateProperties });
  }
  // The canonical provider has already reconstructed every physical field,
  // connection, note and binding. The envelope has no editable project metadata
  // or external resources. Replay uses only the sanitized local circuit.
  const artifact = validateStudentPublicationReviewArtifact({
    schemaVersion: 7,
    status: 'simulation',
    viewerFamily: 'robotics',
    provenance,
    capabilities: { readOnly: true, interactive: true, download: false },
    robotVersion: project.schemaVersion,
    world,
    circuit: {
      schemaVersion: circuit.schemaVersion,
      components,
      connections: circuit.connections,
      simulation: { ...circuit.simulation, running: false },
      ...(circuit.annotations ? { annotations: circuit.annotations } : {}),
    },
  });
  return artifact?.schemaVersion === 7 ? artifact : null;
}
