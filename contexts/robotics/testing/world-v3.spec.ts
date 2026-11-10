import { describe, expect, it } from 'vitest';
import {
  createInitialRoboticsProject,
  parseRoboticsProject,
  upgradeRoboticsProjectToV3,
} from '../domain/document.js';
import {
  createRoboticsBody,
  createRoboticsCurve,
  createRoboticsWorldDocument,
  createRoboticsWorldV3Document,
  parseRoboticsWorldDocument,
  measureRoboticsDistance,
} from '../domain/world.js';

describe('extended source and legacy version boundary', () => {
  it('keeps v2 source exact until the explicit educational upgrade', () => {
    const legacy = {
      ...createInitialRoboticsProject(),
      schemaVersion: 2 as const,
      world: createRoboticsWorldDocument(),
    };
    expect(parseRoboticsProject(legacy)).toEqual({ ok: true, project: legacy });
    const upgraded = upgradeRoboticsProjectToV3(legacy);
    expect(upgraded.schemaVersion).toBe(3);
    expect(upgraded.world.physicsProfile).toBe('kinematic-rover-bodies-v2');
    expect(upgraded.world.robot).toEqual(legacy.world.robot);
    expect(upgraded.world.initialPose).toEqual(legacy.world.initialPose);
    expect(upgraded.world.bindings).toEqual(legacy.world.bindings);
    expect(upgraded.circuit).toEqual(legacy.circuit);
    expect(legacy.schemaVersion).toBe(2);
    expect(parseRoboticsProject({ ...upgraded, schemaVersion: 2 }).ok).toBe(false);
    expect(parseRoboticsProject({ ...legacy, schemaVersion: 3 }).ok).toBe(false);
  });
  it('round-trips material parameters, upright bodies, curves, tiles and the full six-metre field', () => {
    const initial = createRoboticsWorldV3Document();
    const world = {
      ...initial,
      field: {
        ...initial.field,
        widthMeters: 6,
        heightMeters: 6,
        obstacles: [],
        surface: 'carpet' as const,
        bodies: [
          createRoboticsBody('can', 'can', { xMeters: 2, yMeters: 2 }),
          createRoboticsBody('box', 'box', { xMeters: 3, yMeters: 2 }),
        ],
        floorMarks: [createRoboticsCurve('curve', { xMeters: 1, yMeters: 1 })],
      },
    };
    expect(parseRoboticsWorldDocument(JSON.parse(JSON.stringify(world)))).toEqual({
      ok: true,
      world,
    });
    expect(measureRoboticsDistance(world, world.initialPose)).toMatchObject({
      status: 'no-echo',
      distanceMeters: 5.645,
    });
    expect(
      parseRoboticsWorldDocument({ ...world, physicsProfile: 'kinematic-rover-discs-v1' }).ok,
    ).toBe(false);
  });
  it('measures current can and rotated box geometry, never their authored old positions', () => {
    const initial = createRoboticsWorldV3Document();
    const can = createRoboticsBody('can', 'can', { xMeters: 1, yMeters: 0.9 });
    const world = { ...initial, field: { ...initial.field, obstacles: [], bodies: [can] } };
    expect(measureRoboticsDistance(world, world.initialPose).status).toBe('ok');
    expect(measureRoboticsDistance(world, world.initialPose).distanceMeters).toBeCloseTo(0.612, 12);
    const moved = {
      id: 'can',
      xMeters: 0.8,
      yMeters: 0.9,
      headingRadians: 0,
      velocityXMetersPerSecond: 0,
      velocityYMetersPerSecond: 0,
      angularVelocityRadiansPerSecond: 0,
    };
    expect(
      measureRoboticsDistance(world, world.initialPose, [], [moved]).distanceMeters,
    ).toBeCloseTo(0.412, 12);
    expect(
      measureRoboticsDistance(world, world.initialPose, [], [{ ...moved, id: 'foreign' }]).status,
    ).toBe('invalid');
    const box = {
      ...createRoboticsBody('box', 'box', { xMeters: 1, yMeters: 0.9 }),
      headingRadians: Math.PI / 2,
    };
    const boxWorld = { ...world, field: { ...world.field, bodies: [box] } };
    expect(measureRoboticsDistance(boxWorld, boxWorld.initialPose).distanceMeters).toBeCloseTo(
      0.605,
      12,
    );
  });
  it('rejects overlaps, oversized dynamic scenes and invalid parameters without modifying valid source', () => {
    const initial = createRoboticsWorldV3Document();
    const original = JSON.stringify(initial);
    const overlap = createRoboticsBody('box', 'box', initial.initialPose);
    expect(
      parseRoboticsWorldDocument({ ...initial, field: { ...initial.field, bodies: [overlap] } }).ok,
    ).toBe(false);
    expect(
      parseRoboticsWorldDocument({
        ...initial,
        physics: { ...initial.physics, maxWheelForceNewton: Infinity },
      }).ok,
    ).toBe(false);
    expect(
      parseRoboticsWorldDocument({
        ...initial,
        field: {
          ...initial.field,
          bodies: Array.from({ length: 13 }, (_, index) =>
            createRoboticsBody('can', `can-${index}`, { xMeters: 1, yMeters: 1 }),
          ),
        },
      }).ok,
    ).toBe(false);
    expect(JSON.stringify(initial)).toBe(original);
  });
});
