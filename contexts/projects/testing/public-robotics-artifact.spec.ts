import { describe, expect, it, vi } from 'vitest';
import {
  validatePublicArtifact,
  validatePublicProjectDisplayArtifact,
  validatePublicRoboticsArtifact,
  type PublicRoboticsArtifact,
} from '@asa-lab/contracts';

function artifact(): PublicRoboticsArtifact {
  return {
    schemaVersion: 5,
    status: 'display',
    viewerFamily: 'robotics',
    provenance: { publicationId: '123e4567-e89b-42d3-a456-426614174001', revisionNumber: 3 },
    capabilities: { readOnly: true, interactive: true, download: false },
    world: {
      field: {
        widthMeters: 1.8,
        heightMeters: 1.8,
        gridMeters: 0.1,
        obstacles: [
          {
            id: 'wall-1',
            label: 'Стена',
            xMeters: 1,
            yMeters: 0.7,
            widthMeters: 0.3,
            heightMeters: 0.05,
            headingRadians: Math.PI / 4,
          },
        ],
        balls: [{ id: 'ball-1', xMeters: 0.8, yMeters: 0.8, radiusMeters: 0.06 }],
        floorMarks: [
          {
            id: 'line-1',
            kind: 'line',
            color: '#112233',
            widthMeters: 0.02,
            start: { xMeters: 0.3, yMeters: 0.2 },
            end: { xMeters: 0.9, yMeters: 0.2 },
          },
          {
            id: 'area-1',
            kind: 'area',
            color: '#60a5fa',
            xMeters: 0.2,
            yMeters: 1.2,
            widthMeters: 0.3,
            heightMeters: 0.2,
          },
        ],
      },
      robot: {
        bodyLengthMeters: 0.18,
        bodyWidthMeters: 0.14,
        wheelRadiusMeters: 0.0325,
        wheelWidthMeters: 0.025,
        wheelTrackMeters: 0.14,
        sensorForwardMeters: 0.1,
        sensorLateralMeters: 0,
        sensorHeadingRadians: 0,
      },
      initialPose: { xMeters: 0.3, yMeters: 0.3, headingRadians: 0 },
    },
  };
}

describe('public Robotics V5 wire contract', () => {
  it('dispatches bounded source geometry, detaches it and freezes the public projection', () => {
    const source = artifact();
    const result = validatePublicProjectDisplayArtifact(source);
    expect(result.ok).toBe(true);
    if (!result.ok || result.artifact.schemaVersion !== 5) throw Error('V5 expected');
    expect(result.artifact).toEqual(source);
    expect(result.artifact.world).not.toBe(source.world);
    expect(Object.isFrozen(result.artifact.world.field.floorMarks[0])).toBe(true);
    Reflect.set(source.world.field, 'widthMeters', 2.4);
    expect(result.artifact.world.field.widthMeters).toBe(1.8);
  });

  it.each([
    ['circuit', { components: [] }],
    ['arduinoSource', 'PRIVATE_SOURCE'],
    ['arduinoWorkspace', 'PRIVATE_BLOCKS'],
    ['bindings', { boardId: 'private-board' }],
    ['physicsProfile', 'kinematic-rover-discs-v1'],
    ['ownerId', 'private-owner'],
    ['runtime', { leftRpm: 120 }],
  ])('refuses the unclassified world field %s without echoing its value', (key, value) => {
    const input = artifact();
    Object.assign(input.world, { [String(key)]: value });
    expect(validatePublicRoboticsArtifact(input)).toEqual({
      ok: false,
      reason: 'invalid-public-artifact',
    });
  });

  it.each(['massKg', 'frictionCoefficient', 'restitution', 'velocityXMetersPerSecond'])(
    'does not transport ball physics/runtime parameter %s',
    (key) => {
      const input = artifact();
      Object.assign(input.world.field.balls[0]!, { [key]: 0.5 });
      expect(validatePublicRoboticsArtifact(input).ok).toBe(false);
    },
  );

  it.each([
    (value: PublicRoboticsArtifact) => Object.assign(value, { schemaVersion: 6 }),
    (value: PublicRoboticsArtifact) => Object.assign(value, { status: 'simulation' }),
    (value: PublicRoboticsArtifact) => Object.assign(value.capabilities, { download: true }),
    (value: PublicRoboticsArtifact) => Object.assign(value.capabilities, { readOnly: false }),
    (value: PublicRoboticsArtifact) => Object.assign(value.provenance, { publicationId: 'owner' }),
    (value: PublicRoboticsArtifact) => Object.assign(value.provenance, { revisionNumber: 1.5 }),
    (value: PublicRoboticsArtifact) => Object.assign(value.provenance, { revisionNumber: 0 }),
    (value: PublicRoboticsArtifact) => Object.assign(value.world.field, { widthMeters: 1000 }),
    (value: PublicRoboticsArtifact) => Object.assign(value.world.field, { gridMeters: 0 }),
    (value: PublicRoboticsArtifact) => Object.assign(value.world.initialPose, { xMeters: NaN }),
    (value: PublicRoboticsArtifact) => Object.assign(value.world.robot, { wheelRadiusMeters: -1 }),
    (value: PublicRoboticsArtifact) => Object.assign(value.world.field.balls[0]!, { id: 'wall-1' }),
    (value: PublicRoboticsArtifact) =>
      Object.assign(value.world.field.obstacles[0]!, { label: 'x'.repeat(81) }),
    (value: PublicRoboticsArtifact) =>
      Object.assign(value.world.field.floorMarks[0]!, { color: 'url(private)' }),
    (value: PublicRoboticsArtifact) =>
      Object.assign(value.world.field.floorMarks[0]!, { xMeters: 0.1 }),
  ])('fails closed on altered envelope or invalid geometry (%#)', (mutate) => {
    const input = artifact();
    mutate(input);
    expect(validatePublicProjectDisplayArtifact(input).ok).toBe(false);
  });

  it('rejects oversized collections, sparse arrays, hidden fields and custom prototypes', () => {
    const oversized = artifact();
    Object.assign(oversized.world.field, {
      obstacles: Array.from({ length: 25 }, (_, index) => ({
        ...oversized.world.field.obstacles[0],
        id: `wall-${index}`,
      })),
    });
    expect(validatePublicRoboticsArtifact(oversized).ok).toBe(false);
    const sparse = artifact();
    Reflect.deleteProperty(sparse.world.field.floorMarks, '0');
    expect(validatePublicRoboticsArtifact(sparse).ok).toBe(false);
    const hidden = artifact();
    Object.defineProperty(hidden.world.robot, 'token', { value: 'PRIVATE' });
    expect(validatePublicRoboticsArtifact(hidden).ok).toBe(false);
    const prototype = artifact();
    Object.setPrototypeOf(prototype.world.robot, { secret: true });
    expect(validatePublicRoboticsArtifact(prototype).ok).toBe(false);
  });

  it('never invokes supplied accessors and rejects symbols, cycles and shared object aliases', () => {
    const accessor = artifact();
    const read = vi.fn(() => 'PRIVATE');
    Object.defineProperty(accessor.world.robot, 'token', { get: read, enumerable: true });
    expect(validatePublicRoboticsArtifact(accessor).ok).toBe(false);
    expect(read).not.toHaveBeenCalled();
    const symbol = artifact();
    Object.assign(symbol.world, { [Symbol('private')]: 'PRIVATE' });
    expect(validatePublicRoboticsArtifact(symbol).ok).toBe(false);
    const cyclic = artifact();
    Object.assign(cyclic.world.robot, { secret: cyclic });
    expect(validatePublicRoboticsArtifact(cyclic).ok).toBe(false);
    const aliased = artifact();
    const line = aliased.world.field.floorMarks[0]!;
    if (line.kind !== 'line') throw Error('line expected');
    Object.assign(line, { end: line.start });
    expect(validatePublicRoboticsArtifact(aliased).ok).toBe(false);
  });

  it('keeps an honest payload-free V1 fallback for an unavailable Robotics viewer', () => {
    const fallback = {
      schemaVersion: 1,
      status: 'static-only',
      viewerFamily: 'robotics',
      reason: 'viewer-not-available',
      provenance: artifact().provenance,
      capabilities: { readOnly: true, interactive: false, download: false },
    };
    expect(validatePublicArtifact(fallback)).toMatchObject({ ok: true, artifact: fallback });
    expect(validatePublicProjectDisplayArtifact(fallback)).toMatchObject({ ok: true });
    expect(validatePublicArtifact({ ...fallback, world: artifact().world }).ok).toBe(false);
  });
});
