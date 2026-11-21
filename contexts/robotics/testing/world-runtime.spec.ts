import { describe, expect, it } from 'vitest';
import {
  createRoboticsBody,
  createRoboticsBall,
  createRoboticsWorldV3Document,
  createRoboticsWorldDocument,
  createRoboticsWorldState,
  advanceRoboticsWorld,
} from '../domain/world.js';
import { createRoboticsRuntime } from '../domain/world-runtime.js';

const rpm = (speed: number) => (speed * 60) / (2 * Math.PI * 0.0325);
const clear = () => {
  const world = createRoboticsWorldV3Document();
  // These contact-force fixtures intentionally use their historical test
  // geometry; production starters now place the robot at field center.
  return {
    ...world,
    initialPose: { xMeters: 0.25, yMeters: 0.9, headingRadians: 0 },
    field: { ...world.field, obstacles: [] },
  };
};
describe('persistent versioned Robotics mechanics', () => {
  it('keeps the legacy numerical path exact', () => {
    const world = createRoboticsWorldDocument();
    const runtime = createRoboticsRuntime(world);
    let expected = createRoboticsWorldState(world);
    for (const time of [0, 1700, 5000, 25000, 100000]) {
      const frame = { atMicroseconds: time, leftRpm: 60, rightRpm: 50 };
      expected = advanceRoboticsWorld(world, expected, frame);
      expect(runtime.advance(frame)).toEqual(expected);
    }
  });
  it('has finite acceleration and lower acceleration with lower grip', () => {
    const world = clear();
    const high = createRoboticsRuntime(world);
    const low = createRoboticsRuntime({
      ...world,
      physics: { ...world.physics, tireFrictionCoefficient: 0.01 },
    });
    for (const runtime of [high, low])
      runtime.advance({ atMicroseconds: 0, leftRpm: rpm(0.6), rightRpm: rpm(0.6) });
    const first = high.advance({ atMicroseconds: 5000, leftRpm: rpm(0.6), rightRpm: rpm(0.6) });
    expect(first.robotVelocity!.velocityXMetersPerSecond).toBeCloseTo(0.012, 12);
    const slippery = low.advance({ atMicroseconds: 5000, leftRpm: rpm(0.6), rightRpm: rpm(0.6) });
    expect(slippery.robotVelocity!.velocityXMetersPerSecond).toBeLessThan(
      first.robotVelocity!.velocityXMetersPerSecond / 10,
    );
  });
  it('pushes a light can but stops against a heavy can without fabricated electrical feedback', () => {
    function trial(massKg: number) {
      const world = clear();
      const can = createRoboticsBody('can', 'can', { xMeters: 0.8, yMeters: 0.9 });
      const runtime = createRoboticsRuntime({
        ...world,
        field: { ...world.field, bodies: [{ ...can, massKg }] },
      });
      runtime.advance({ atMicroseconds: 0, leftRpm: rpm(0.5), rightRpm: rpm(0.5) });
      return runtime.advance({ atMicroseconds: 2000000, leftRpm: rpm(0.5), rightRpm: rpm(0.5) });
    }
    const light = trial(0.04),
      heavy = trial(2);
    expect(light.bodies![0]!.xMeters).toBeGreaterThan(1.1);
    expect(heavy.bodies![0]!.xMeters).toBeLessThan(0.82);
    expect(Math.abs(heavy.robotVelocity!.velocityXMetersPerSecond)).toBeLessThan(0.001);
    expect(light.haltReason).toBeNull();
    expect(heavy.haltReason).toBeNull();
  });
  it('a rolling ball travels farther than an upright sliding can after the drive stops', () => {
    function trial(kind: 'ball' | 'can') {
      const base = clear();
      const world = {
        ...base,
        field: {
          ...base.field,
          widthMeters: 6,
          balls:
            kind === 'ball'
              ? [
                  {
                    ...createRoboticsBall('ball', { xMeters: 0.8, yMeters: 0.9 }),
                    radiusMeters: 0.033,
                    restitution: 0,
                    rollingResistanceCoefficient: 0.02,
                    contactFrictionCoefficient: 0.3,
                  },
                ]
              : [],
          bodies:
            kind === 'can'
              ? [createRoboticsBody('can', 'can', { xMeters: 0.8, yMeters: 0.9 })]
              : [],
        },
      };
      const runtime = createRoboticsRuntime(world);
      runtime.advance({ atMicroseconds: 0, leftRpm: rpm(0.6), rightRpm: rpm(0.6) });
      runtime.advance({ atMicroseconds: 2000000, leftRpm: rpm(0.6), rightRpm: rpm(0.6) });
      runtime.advance({ atMicroseconds: 2005000, leftRpm: 0, rightRpm: 0 });
      const end = runtime.advance({ atMicroseconds: 6000000, leftRpm: 0, rightRpm: 0 });
      expect(end.haltReason).toBeNull();
      return kind === 'ball' ? end.balls[0]! : end.bodies![0]!;
    }
    const ball = trial('ball'),
      can = trial('can');
    expect(ball.xMeters).toBeGreaterThan(can.xMeters + 0.5);
    expect(Math.abs(ball.velocityXMetersPerSecond)).toBeLessThan(1e-6);
    expect(Math.abs(can.velocityXMetersPerSecond)).toBeLessThan(1e-6);
  });
  it.each(['balanced', 'precise'] as const)(
    'educational %s collides with a static thin wall',
    (accuracy) => {
      const world = createRoboticsWorldV3Document('practice', 'educational');
      const runtime = createRoboticsRuntime({
        ...world,
        initialPose: { xMeters: 0.25, yMeters: 0.9, headingRadians: 0 },
        physics: { ...world.physics, accuracy },
        field: {
          ...world.field,
          obstacles: [
            { id: 'wall', xMeters: 0.8, yMeters: 0.5, widthMeters: 0.02, heightMeters: 0.8 },
          ],
        },
      });
      runtime.advance({ atMicroseconds: 0, leftRpm: rpm(2), rightRpm: rpm(2) });
      const state = runtime.advance({ atMicroseconds: 2000000, leftRpm: rpm(2), rightRpm: rpm(2) });
      expect(state.pose.xMeters).toBeGreaterThan(0.697);
      expect(state.pose.xMeters).toBeLessThanOrEqual(0.7);
      expect(state.haltReason).toBeNull();
    },
  );
  it('is partition deterministic, resets from source, and returns isolated snapshots', () => {
    const world = clear();
    const original = JSON.stringify(world);
    const single = createRoboticsRuntime(world),
      split = createRoboticsRuntime(world);
    for (const runtime of [single, split])
      runtime.advance({ atMicroseconds: 0, leftRpm: 120, rightRpm: 100 });
    const end = single.advance({ atMicroseconds: 2000000, leftRpm: 120, rightRpm: 100 });
    for (let time = 1700; time < 2000000; time += 1700)
      split.advance({ atMicroseconds: time, leftRpm: 120, rightRpm: 100 });
    expect(split.advance({ atMicroseconds: 2000000, leftRpm: 120, rightRpm: 100 })).toEqual(end);
    (end.pose as { xMeters: number }).xMeters = -500;
    expect(single.read().pose.xMeters).toBeGreaterThan(0);
    expect(createRoboticsRuntime(world).read().pose).toEqual(world.initialPose);
    expect(JSON.stringify(world)).toBe(original);
    expect(single.advance({ atMicroseconds: 100, leftRpm: 0, rightRpm: 0 }).haltReason).toMatch(
      /Время/,
    );
  });
});
