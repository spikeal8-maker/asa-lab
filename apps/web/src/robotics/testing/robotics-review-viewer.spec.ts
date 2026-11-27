import { describe, expect, it } from 'vitest';
import { createInitialRoboticsProject } from '@asa-lab/robotics/document';
import { validatePublicProjectDisplayArtifact } from '@asa-lab/contracts';
import { roboticsPublicationReviewDocument } from '../RoboticsReviewViewer';

const saved = createInitialRoboticsProject();
const { viewport, ...circuit } = saved.circuit;
const artifact = {
  schemaVersion: 7,
  viewerFamily: 'robotics',
  status: 'simulation',
  robotVersion: saved.schemaVersion,
  world: saved.world,
  circuit,
  capabilities: { readOnly: true, interactive: true, download: false },
  provenance: { publicationId: '123e4567-e89b-42d3-a456-426614174002', revisionNumber: 8 },
};

describe('private Robotics review viewer input', () => {
  it('restores local runtime inputs without opening a project in the editor', () => {
    const preview = roboticsPublicationReviewDocument(artifact);
    expect(preview?.project.world).toEqual(saved.world);
    expect(preview?.project.circuit.components).toEqual(saved.circuit.components);
    expect(preview?.project.circuit.simulation.running).toBe(false);
    expect(preview?.project.circuit.viewport).toEqual(viewport);
    expect(validatePublicProjectDisplayArtifact(artifact).ok).toBe(false);
  });

  it('denies malformed native world data and any editable capability', () => {
    expect(
      roboticsPublicationReviewDocument({ ...artifact, world: { ...saved.world, field: {} } }),
    ).toBeNull();
    expect(
      roboticsPublicationReviewDocument({
        ...artifact,
        capabilities: { ...artifact.capabilities, download: true },
      }),
    ).toBeNull();
    expect(
      roboticsPublicationReviewDocument({ ...artifact, editorToken: 'editor-session' }),
    ).toBeNull();
  });
});
