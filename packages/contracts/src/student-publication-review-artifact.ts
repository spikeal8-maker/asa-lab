import type { PublicArtifactProvenance } from './public-artifact.js';
import {
  validatePublicProjectDisplayArtifact,
  type PublicProjectDisplayArtifact,
} from './public-project-display-artifact.js';

/** A closed envelope for the saved Robotics presentation and local runtime inputs.
 * Native world/circuit parsers validate their own versioned subdocuments. */
export interface RoboticsPublicationReviewArtifact {
  readonly schemaVersion: 7;
  readonly status: 'simulation';
  readonly viewerFamily: 'robotics';
  readonly provenance: PublicArtifactProvenance;
  readonly capabilities: {
    readonly readOnly: true;
    readonly interactive: true;
    readonly download: false;
  };
  readonly robotVersion: 2 | 3;
  readonly world: unknown;
  readonly circuit: Record<string, unknown>;
}

export interface ScratchPublicationReviewArtifact {
  readonly schemaVersion: 8;
  readonly status: 'player';
  readonly viewerFamily: 'scratch';
  readonly provenance: PublicArtifactProvenance;
  readonly capabilities: RoboticsPublicationReviewArtifact['capabilities'];
}

export type StudentPublicationReviewArtifact =
  | Extract<PublicProjectDisplayArtifact, { schemaVersion: 3 | 4 }>
  | RoboticsPublicationReviewArtifact
  | ScratchPublicationReviewArtifact;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
    ? (value as Record<string, unknown>)
    : null;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

export function validateStudentPublicationReviewArtifact(
  input: unknown,
): StudentPublicationReviewArtifact | null {
  const artifact = record(input);
  if (!artifact) return null;
  if (artifact.schemaVersion !== 7 && artifact.schemaVersion !== 8) {
    const publicArtifact = validatePublicProjectDisplayArtifact(input);
    if (!publicArtifact.ok) return null;
    const candidate = publicArtifact.artifact;
    return (candidate.viewerFamily === 'three-d' && candidate.schemaVersion === 4) ||
      (candidate.viewerFamily === 'electronics' &&
        candidate.schemaVersion === 3 &&
        candidate.status === 'simulation')
      ? candidate
      : null;
  }
  const provenance = record(artifact.provenance);
  const capabilities = record(artifact.capabilities);
  if (
    !provenance ||
    !onlyKeys(provenance, ['publicationId', 'revisionNumber']) ||
    typeof provenance.publicationId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      provenance.publicationId,
    ) ||
    !Number.isSafeInteger(provenance.revisionNumber) ||
    Number(provenance.revisionNumber) < 1 ||
    !capabilities ||
    !onlyKeys(capabilities, ['readOnly', 'interactive', 'download']) ||
    capabilities.readOnly !== true ||
    capabilities.interactive !== true ||
    capabilities.download !== false
  )
    return null;
  if (artifact.schemaVersion === 8) {
    return artifact.viewerFamily === 'scratch' &&
      artifact.status === 'player' &&
      onlyKeys(artifact, ['schemaVersion', 'status', 'viewerFamily', 'provenance', 'capabilities'])
      ? (input as ScratchPublicationReviewArtifact)
      : null;
  }
  const circuit = record(artifact.circuit);
  const world = record(artifact.world);
  if (
    !onlyKeys(artifact, [
      'schemaVersion',
      'status',
      'viewerFamily',
      'provenance',
      'capabilities',
      'robotVersion',
      'world',
      'circuit',
    ]) ||
    artifact.viewerFamily !== 'robotics' ||
    artifact.status !== 'simulation' ||
    (artifact.robotVersion !== 2 && artifact.robotVersion !== 3) ||
    !world ||
    !onlyKeys(world, ['physicsProfile', 'physics', 'field', 'robot', 'initialPose', 'bindings']) ||
    !circuit ||
    !onlyKeys(circuit, [
      'schemaVersion',
      'components',
      'connections',
      'simulation',
      'annotations',
    ]) ||
    !Array.isArray(circuit.components) ||
    !Array.isArray(circuit.connections) ||
    !record(circuit.simulation)
  )
    return null;
  return input as RoboticsPublicationReviewArtifact;
}
