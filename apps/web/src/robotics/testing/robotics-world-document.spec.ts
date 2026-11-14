import { describe, expect, it } from 'vitest';
import {
  createRoboticsBall,
  createRoboticsFloorMark,
  createRoboticsWall,
  createRoboticsWorldDocument,
  nextRoboticsObjectId,
  parseRoboticsWorldDocument,
  ROBOTICS_FIELD_LIMITS,
  ROBOTICS_SCENE_LIMITS,
  type RoboticsWorldDocument,
} from '../world';

function document(): RoboticsWorldDocument {
  const world = createRoboticsWorldDocument();
  return {
    ...world,
    field: {
      ...world.field,
      obstacles: [
        {
          ...createRoboticsWall('wall-1', { xMeters: 1.2, yMeters: 0.3 }),
          headingRadians: Math.PI / 6,
        },
      ],
      // Keep the authored sample clear of the now-centered robot (0.9, 0.9).
      balls: [createRoboticsBall('ball-1', { xMeters: 0.8, yMeters: 1.2 })],
      floorMarks: [
        createRoboticsFloorMark('line', 'line-1', { xMeters: 0.2, yMeters: 0.25 }),
        createRoboticsFloorMark('area', 'area-1', { xMeters: 0.6, yMeters: 1.2 }),
      ],
    },
  };
}

function expectInvalid(value: unknown): void {
  const result = parseRoboticsWorldDocument(value);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.message).not.toBe('');
}

describe('Robotics scene source document and M0 migration', () => {
  it('round-trips complete source objects and returns an independent normalized document', () => {
    const world = document();
    const snapshot = structuredClone(world);
    const result = parseRoboticsWorldDocument(world);
    expect(result).toEqual({ ok: true, world });
    if (!result.ok) throw new Error(result.message);
    expect(result.world).not.toBe(world);
    expect(result.world.field.balls[0]).not.toBe(world.field.balls[0]);
    expect(result.world.field.floorMarks[0]).not.toBe(world.field.floorMarks[0]);
    expect(world).toEqual(snapshot);
  });

  it('adds the declared profile and empty collections to M0 without changing physical dimensions or bindings', () => {
    const world = createRoboticsWorldDocument('compact');
    const field: Record<string, unknown> = { ...world.field };
    delete field.balls;
    delete field.floorMarks;
    field.obstacles = world.field.obstacles.map((wall) => {
      const legacy: Record<string, unknown> = { ...wall };
      delete legacy.headingRadians;
      return legacy;
    });
    const legacy: Record<string, unknown> = { ...world, field };
    delete legacy.physicsProfile;
    const snapshot = structuredClone(legacy);
    const result = parseRoboticsWorldDocument(legacy);
    expect(result).toEqual({ ok: true, world });
    expect(legacy).toEqual(snapshot);
  });

  it('keeps runtime coordinates and velocities out of saved source objects', () => {
    const world = document();
    const result = parseRoboticsWorldDocument({
      ...world,
      balls: [{ id: 'ball-1', xMeters: 1.4, yMeters: 1.4 }],
      atMicroseconds: 10_000_000,
      field: {
        ...world.field,
        balls: [
          { ...world.field.balls[0], velocityXMetersPerSecond: 20, velocityYMetersPerSecond: -20 },
        ],
      },
    });
    expect(result).toEqual({ ok: true, world });
  });

  it('creates explicit source positions, localized defaults and IDs unique across every object kind', () => {
    const world = document();
    expect(nextRoboticsObjectId(world, 'wall')).toBe('wall-2');
    expect(nextRoboticsObjectId(world, 'ball')).toBe('ball-2');
    const mixed = {
      ...world,
      field: { ...world.field, balls: [{ ...world.field.balls[0], id: 'wall-2' }] },
    };
    expect(nextRoboticsObjectId(mixed, 'wall')).toBe('wall-3');
    expect(createRoboticsBall('new', { xMeters: 0.7, yMeters: 0.4 })).toMatchObject({
      id: 'new',
      label: 'Мяч',
      xMeters: 0.7,
      yMeters: 0.4,
      radiusMeters: 0.06,
      massKg: 0.05,
      frictionCoefficient: 0.08,
      restitution: 0.65,
    });
    const line = createRoboticsFloorMark('line', 'new-line', { xMeters: 0.4, yMeters: 0.3 });
    expect(line).toMatchObject({
      start: { xMeters: 0.4, yMeters: 0.3 },
      end: { xMeters: 0.7, yMeters: 0.3 },
    });
    expect(() => nextRoboticsObjectId(world, 'x'.repeat(49))).toThrow();
    const extraPosition = {
      xMeters: 0.7,
      yMeters: 0.4,
      id: 'injected',
      label: 'injected',
      kind: 'line',
    };
    expect(createRoboticsBall('requested', extraPosition).id).toBe('requested');
    expect(createRoboticsWall('requested', extraPosition).id).toBe('requested');
    expect(createRoboticsFloorMark('area', 'requested', extraPosition)).toMatchObject({
      id: 'requested',
      kind: 'area',
    });
  });
});

describe('Atomic scene validation including complete extents', () => {
  it('rejects rotated wall corners, circle radii, line thickness/endcaps and area bounds', () => {
    const world = document();
    const invalidFields: unknown[] = [
      {
        ...world.field,
        obstacles: [
          {
            ...createRoboticsWall('rotated', { xMeters: 0.1, yMeters: 0 }),
            widthMeters: 0.4,
            headingRadians: Math.PI / 2,
          },
        ],
      },
      { ...world.field, balls: [{ ...world.field.balls[0], xMeters: 0.02 }] },
      {
        ...world.field,
        floorMarks: [createRoboticsFloorMark('line', 'line', { xMeters: 0.2, yMeters: 0.005 })],
      },
      {
        ...world.field,
        floorMarks: [createRoboticsFloorMark('line', 'line', { xMeters: 0.005, yMeters: 0.2 })],
      },
      {
        ...world.field,
        floorMarks: [createRoboticsFloorMark('area', 'area', { xMeters: 1.6, yMeters: 0.4 })],
      },
    ];
    for (const field of invalidFields) expectInvalid({ ...world, field });
  });

  it('rejects an invalid resize/edit batch without changing, clipping or deleting any source item', () => {
    const world = document();
    const snapshot = structuredClone(world);
    expectInvalid({
      ...world,
      field: { ...world.field, widthMeters: ROBOTICS_FIELD_LIMITS.widthMeters.min },
    });
    expectInvalid({
      ...world,
      field: {
        ...world.field,
        balls: [world.field.balls[0], { ...world.field.balls[0], id: 'outside', xMeters: 5 }],
      },
    });
    expect(world).toEqual(snapshot);
    expect(parseRoboticsWorldDocument(world).ok).toBe(true);
  });

  it('rejects source ball intersections with the robot, walls and other balls while allowing joined walls', () => {
    const world = document();
    const intersections = [
      [
        {
          ...world.field.balls[0],
          xMeters: world.initialPose.xMeters,
          yMeters: world.initialPose.yMeters,
        },
      ],
      [{ ...world.field.balls[0], xMeters: 1.35, yMeters: 0.325 }],
      [world.field.balls[0], { ...world.field.balls[0], id: 'ball-2', xMeters: 0.9 }],
    ];
    for (const balls of intersections)
      expectInvalid({ ...world, field: { ...world.field, balls } });
    const joined = {
      ...world,
      field: {
        ...world.field,
        obstacles: [
          world.field.obstacles[0],
          { ...world.field.obstacles[0], id: 'wall-2', xMeters: 1.25 },
        ],
      },
    };
    expect(parseRoboticsWorldDocument(joined).ok).toBe(true);
  });

  it('enforces finite numbers, positive masses and sizes, bounded material parameters and explicit profiles', () => {
    const world = document();
    for (const patch of [
      { radiusMeters: Number.NaN },
      { radiusMeters: Number.POSITIVE_INFINITY },
      { radiusMeters: 0 },
      { radiusMeters: 0.3 },
      { massKg: 0 },
      { massKg: -1 },
      { massKg: Number.POSITIVE_INFINITY },
      { frictionCoefficient: -0.1 },
      { frictionCoefficient: 1.1 },
      { restitution: -0.1 },
      { restitution: 1.1 },
      { xMeters: Number.NaN },
      { yMeters: '0.5' },
    ])
      expectInvalid({
        ...world,
        field: { ...world.field, balls: [{ ...world.field.balls[0], ...patch }] },
      });
    for (const physicsProfile of ['unknown', null, 1]) expectInvalid({ ...world, physicsProfile });
    for (const headingRadians of [Number.NaN, Number.POSITIVE_INFINITY, null, Math.PI + 0.1])
      expectInvalid({
        ...world,
        field: { ...world.field, obstacles: [{ ...world.field.obstacles[0], headingRadians }] },
      });
    for (const gridMeters of [0, Number.POSITIVE_INFINITY, 0.6])
      expectInvalid({ ...world, field: { ...world.field, gridMeters } });
  });

  it('rejects malformed, repeated and cross-kind IDs, invalid collections, colors and degenerate lines', () => {
    const world = document();
    for (const id of [
      '',
      ' ',
      'x'.repeat(65),
      'bad\u0000id',
      { value: 'id' },
      world.field.obstacles[0].id,
      world.field.floorMarks[0].id,
    ])
      expectInvalid({
        ...world,
        field: { ...world.field, balls: [{ ...world.field.balls[0], id }] },
      });
    for (const value of [null, {}, '[]']) {
      expectInvalid({ ...world, field: { ...world.field, balls: value } });
      expectInvalid({ ...world, field: { ...world.field, floorMarks: value } });
      expectInvalid({ ...world, field: { ...world.field, obstacles: value } });
    }
    const line = createRoboticsFloorMark('line', 'line', { xMeters: 0.2, yMeters: 0.2 });
    for (const patch of [
      { color: 'url(javascript:alert(1))' },
      { color: '#fff' },
      { color: 'red' },
      { kind: 'path' },
      { widthMeters: Number.NaN },
      { widthMeters: 0.001 },
      { start: { xMeters: 0.2, yMeters: 0.2 }, end: { xMeters: 0.2, yMeters: 0.2 } },
    ])
      expectInvalid({ ...world, field: { ...world.field, floorMarks: [{ ...line, ...patch }] } });
  });

  it('enforces scene counts before running geometry and handles property-like string IDs as data', () => {
    const world = document();
    expectInvalid({
      ...world,
      field: {
        ...world.field,
        obstacles: Array.from({ length: ROBOTICS_SCENE_LIMITS.walls + 1 }, (_, i) => ({
          ...world.field.obstacles[0],
          id: 'wall-' + i,
        })),
      },
    });
    expectInvalid({
      ...world,
      field: {
        ...world.field,
        balls: Array.from({ length: ROBOTICS_SCENE_LIMITS.balls + 1 }, (_, i) => ({
          ...world.field.balls[0],
          id: 'ball-' + i,
        })),
      },
    });
    expectInvalid({
      ...world,
      field: {
        ...world.field,
        floorMarks: Array.from({ length: ROBOTICS_SCENE_LIMITS.floorMarks + 1 }, (_, i) => ({
          ...world.field.floorMarks[0],
          id: 'mark-' + i,
        })),
      },
    });
    const named = {
      ...world,
      field: { ...world.field, balls: [{ ...world.field.balls[0], id: '__proto__' }] },
    };
    expect(parseRoboticsWorldDocument(named)).toEqual({ ok: true, world: named });
  });
});
