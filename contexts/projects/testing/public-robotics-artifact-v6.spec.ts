import { describe, expect, it, vi } from 'vitest';
import {
  validatePublicRoboticsArtifactV6,
  validatePublicProjectDisplayArtifact,
  type PublicRoboticsArtifactV6,
} from '@asa-lab/contracts';

function artifact(): PublicRoboticsArtifactV6 {
  return {
    schemaVersion: 6,
    status: 'display',
    viewerFamily: 'robotics',
    provenance: { publicationId: '123e4567-e89b-42d3-a456-426614174000', revisionNumber: 2 },
    capabilities: { readOnly: true, interactive: true, download: false },
    world: {
      field: {
        widthMeters: 6,
        heightMeters: 3,
        gridMeters: 0.05,
        tiles: { enabled: true, sizeMeters: 0.3 },
        surface: 'wood',
        obstacles: [],
        balls: [],
        bodies: [
          {
            id: 'can',
            kind: 'can',
            xMeters: 1,
            yMeters: 1,
            radiusMeters: 0.033,
            heightMeters: 0.115,
            headingRadians: 0,
          },
          {
            id: 'box',
            kind: 'box',
            xMeters: 2,
            yMeters: 1,
            widthMeters: 0.12,
            depthMeters: 0.08,
            heightMeters: 0.04,
            headingRadians: Math.PI / 4,
          },
        ],
        floorMarks: [
          {
            id: 'turn',
            kind: 'curve',
            start: { xMeters: 0, yMeters: 0.15 },
            control: { xMeters: 0.15, yMeters: 0.15 },
            end: { xMeters: 0.15, yMeters: 0.3 },
            widthMeters: 0.02,
            color: '#112233',
          },
        ],
      },
      robot: {
        bodyLengthMeters: 0.2,
        bodyWidthMeters: 0.13,
        wheelRadiusMeters: 0.0325,
        wheelWidthMeters: 0.026,
        wheelTrackMeters: 0.15,
        sensorForwardMeters: 0.105,
        sensorLateralMeters: 0,
        sensorHeadingRadians: 0,
      },
      initialPose: { xMeters: 0.25, yMeters: 0.9, headingRadians: 0 },
    },
  };
}
describe('frozen visual Robotics v6', () => {
  it('accepts only a fresh deep-frozen geometry copy and dispatches v6 explicitly', () => {
    const input = artifact();
    const parsed = validatePublicRoboticsArtifactV6(input);
    expect(parsed).toEqual({ ok: true, artifact: input });
    expect(validatePublicProjectDisplayArtifact(input)).toEqual(parsed);
    if (!parsed.ok) throw new Error('valid source rejected');
    expect(parsed.artifact).not.toBe(input);
    expect(Object.isFrozen(parsed.artifact.world.field.bodies[0])).toBe(true);
  });
  it.each([
    'massKg',
    'slidingFrictionCoefficient',
    'velocityXMetersPerSecond',
    'groupId',
    'groupPivot',
    'arduinoSource',
    'bindings',
  ])('rejects private field %s rather than filtering it', (key) => {
    const input = artifact();
    Object.assign(input.world.field.bodies[0]!, {
      [key]: key === 'groupPivot' ? { xMeters: 0, yMeters: 0 } : 1,
    });
    expect(validatePublicRoboticsArtifactV6(input).ok).toBe(false);
  });
  it('rejects executable, aliased, sparse, future and out-of-budget wire values', () => {
    const getter = vi.fn(() => 1);
    const accessor = artifact();
    Object.defineProperty(accessor.world.field, 'private', { enumerable: true, get: getter });
    expect(validatePublicRoboticsArtifactV6(accessor).ok).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    const aliased = artifact();
    Object.assign(aliased.world.field.floorMarks[0]!, {
      end: (aliased.world.field.floorMarks[0] as { start: unknown }).start,
    });
    expect(validatePublicRoboticsArtifactV6(aliased).ok).toBe(false);
    const sparse = artifact();
    Object.assign(sparse.world.field, { bodies: new Array(2) });
    expect(validatePublicRoboticsArtifactV6(sparse).ok).toBe(false);
    expect(validatePublicRoboticsArtifactV6({ ...artifact(), schemaVersion: 7 }).ok).toBe(false);
    const tooLarge = artifact();
    Object.assign(tooLarge.world.field, { widthMeters: 6.001 });
    expect(validatePublicRoboticsArtifactV6(tooLarge).ok).toBe(false);
  });
});
