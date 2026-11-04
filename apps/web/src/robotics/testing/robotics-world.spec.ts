import { describe, expect, it } from 'vitest';
import {
  advanceRoboticsWorld,
  createRoboticsWorldDocument,
  createRoboticsWorldState,
  findRoboticsCollision,
  measureRoboticsDistance,
  parseRoboticsWorldDocument,
  ROBOTICS_FIELD_PRESETS,
  ROBOTICS_RUN_LIMIT_MICROSECONDS,
  type RoboticsWorldDocument,
} from '../world';

function emptyWorld(): RoboticsWorldDocument {
  const world = createRoboticsWorldDocument();
  return {
    ...world,
    field: { ...world.field, obstacles: [] },
    initialPose: { xMeters: 0.6, yMeters: 0.6, headingRadians: 0 },
  };
}

describe('Robotics geometry consuming canonical output-shaft observations', () => {
  it('moves by one wheel circumference for one output-shaft revolution, without a second gearbox factor', () => {
    const world = emptyWorld();
    const initial = advanceRoboticsWorld(world, createRoboticsWorldState(world), {
      atMicroseconds: 0,
      leftRpm: 60,
      rightRpm: 60,
    });
    const result = advanceRoboticsWorld(world, initial, {
      atMicroseconds: 1_000_000,
      leftRpm: 60,
      rightRpm: 60,
    });
    expect(result.pose.xMeters).toBeCloseTo(
      world.initialPose.xMeters + 2 * Math.PI * world.robot.wheelRadiusMeters,
      12,
    );
    expect(result.pose.yMeters).toBe(world.initialPose.yMeters);
    expect(result.pose.headingRadians).toBe(0);
    expect(result.haltReason).toBeNull();
  });

  it('preserves signed output speeds and rotates about the axle midpoint for opposite wheel speeds', () => {
    const world = emptyWorld();
    const initial = advanceRoboticsWorld(world, createRoboticsWorldState(world), {
      atMicroseconds: 0,
      leftRpm: -60,
      rightRpm: 60,
    });
    const result = advanceRoboticsWorld(world, initial, {
      atMicroseconds: 250_000,
      leftRpm: -60,
      rightRpm: 60,
    });
    expect(result.pose.xMeters).toBe(world.initialPose.xMeters);
    expect(result.pose.yMeters).toBe(world.initialPose.yMeters);
    expect(result.pose.headingRadians).toBeCloseTo(
      (Math.PI * world.robot.wheelRadiusMeters) / world.robot.wheelTrackMeters,
      12,
    );
    const reverse = advanceRoboticsWorld(
      world,
      { ...initial, leftRpm: -60, rightRpm: -60 },
      {
        atMicroseconds: 250_000,
        leftRpm: -60,
        rightRpm: -60,
      },
    );
    expect(reverse.pose.xMeters).toBeLessThan(world.initialPose.xMeters);
    expect(reverse.pose.headingRadians).toBe(0);
  });

  it('follows the differential-drive circular arc when only the right wheel turns', () => {
    const world = emptyWorld();
    const rightRpm =
      ((Math.PI / 2) * world.robot.wheelTrackMeters * 60) /
      (2 * Math.PI * world.robot.wheelRadiusMeters);
    const initial = advanceRoboticsWorld(world, createRoboticsWorldState(world), {
      atMicroseconds: 0,
      leftRpm: 0,
      rightRpm,
    });
    const result = advanceRoboticsWorld(world, initial, {
      atMicroseconds: 1_000_000,
      leftRpm: 0,
      rightRpm,
    });
    expect(result.pose.xMeters).toBeCloseTo(
      world.initialPose.xMeters + world.robot.wheelTrackMeters / 2,
      12,
    );
    expect(result.pose.yMeters).toBeCloseTo(
      world.initialPose.yMeters + world.robot.wheelTrackMeters / 2,
      12,
    );
    expect(result.pose.headingRadians).toBeCloseTo(Math.PI / 2, 12);
  });

  it('uses committed source time independently of the number of observations', () => {
    const world = emptyWorld();
    const initial = advanceRoboticsWorld(world, createRoboticsWorldState(world), {
      atMicroseconds: 0,
      leftRpm: 40,
      rightRpm: 40,
    });
    const coarse = advanceRoboticsWorld(world, initial, {
      atMicroseconds: 1_000_000,
      leftRpm: 40,
      rightRpm: 40,
    });
    let fine = initial;
    for (let atMicroseconds = 25_000; atMicroseconds <= 1_000_000; atMicroseconds += 25_000)
      fine = advanceRoboticsWorld(world, fine, { atMicroseconds, leftRpm: 40, rightRpm: 40 });
    expect(fine.pose.xMeters).toBeCloseTo(coarse.pose.xMeters, 12);
    expect(fine.pose.yMeters).toBe(coarse.pose.yMeters);
    expect(
      advanceRoboticsWorld(world, fine, { atMicroseconds: 1_000_000, leftRpm: 40, rightRpm: 40 }),
    ).toBe(fine);
    const rewind = advanceRoboticsWorld(world, fine, {
      atMicroseconds: 999_999,
      leftRpm: 40,
      rightRpm: 40,
    });
    expect(rewind.pose).toBe(fine.pose);
    expect(rewind.haltReason).toContain('Время электроники');
    const reset = createRoboticsWorldState(world);
    expect(reset.atMicroseconds).toBe(0);
    expect(reset.pose).toEqual(world.initialPose);
    expect(reset.trail).toHaveLength(1);
  });

  it('halts at a thin obstacle without jumping through it or claiming an electrical stall', () => {
    const base = emptyWorld();
    const world: RoboticsWorldDocument = {
      ...base,
      initialPose: { xMeters: 0.3, yMeters: 0.6, headingRadians: 0 },
      field: {
        ...base.field,
        obstacles: [
          { id: 'thin', xMeters: 0.6, yMeters: 0.4, widthMeters: 0.02, heightMeters: 0.4 },
        ],
      },
    };
    const initial = advanceRoboticsWorld(world, createRoboticsWorldState(world), {
      atMicroseconds: 0,
      leftRpm: 60,
      rightRpm: 60,
    });
    const result = advanceRoboticsWorld(world, initial, {
      atMicroseconds: 2_000_000,
      leftRpm: 60,
      rightRpm: 60,
    });
    expect(result.pose.xMeters).toBeLessThan(0.5);
    expect(result.pose.xMeters).toBeGreaterThan(0.49);
    expect(findRoboticsCollision(world, result.pose)).toBeNull();
    expect(result.haltReason).toContain('Контакт');
    expect(result.haltReason).toContain('не моделируется');
    expect(result.leftRpm).toBe(60);
    expect(
      advanceRoboticsWorld(world, result, { atMicroseconds: 2_050_000, leftRpm: 60, rightRpm: 60 }),
    ).toBe(result);
  });

  it('includes the wheel envelope at the wall, even when the narrower chassis would fit', () => {
    const world = emptyWorld();
    expect(findRoboticsCollision(world, { xMeters: 0.5, yMeters: 0.08, headingRadians: 0 })).toBe(
      'граница поля',
    );
    expect(
      findRoboticsCollision(world, { xMeters: 0.5, yMeters: 0.12, headingRadians: 0 }),
    ).toBeNull();
  });

  it('rejects invalid motor observations and ends a bounded run without resetting source time', () => {
    const world = emptyWorld();
    const initial = createRoboticsWorldState(world);
    for (const rpm of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = advanceRoboticsWorld(world, initial, {
        atMicroseconds: 25_000,
        leftRpm: rpm,
        rightRpm: 0,
      });
      expect(result.pose).toBe(initial.pose);
      expect(result.haltReason).toContain('обороты');
    }
    const completed = advanceRoboticsWorld(world, initial, {
      atMicroseconds: ROBOTICS_RUN_LIMIT_MICROSECONDS,
      leftRpm: 0,
      rightRpm: 0,
    });
    expect(completed.atMicroseconds).toBe(ROBOTICS_RUN_LIMIT_MICROSECONDS);
    expect(completed.haltReason).toContain('40 секунд');
    const pastLimit = advanceRoboticsWorld(world, initial, {
      atMicroseconds: ROBOTICS_RUN_LIMIT_MICROSECONDS + 1,
      leftRpm: 0,
      rightRpm: 0,
    });
    expect(pastLimit.pose).toBe(initial.pose);
    expect(pastLimit.atMicroseconds).toBe(0);
    expect(pastLimit.haltReason).toContain('40 секунд');
  });
});

describe('Robotics field validation and HC-SR04 geometric environment', () => {
  it.each(ROBOTICS_FIELD_PRESETS)(
    'validates the $id preset with an initial distance beyond the safe stopping threshold',
    (preset) => {
      const world = createRoboticsWorldDocument(preset.id);
      expect(parseRoboticsWorldDocument(world)).toEqual({ ok: true, world });
      const measured = measureRoboticsDistance(world, world.initialPose);
      expect(measured.status).toBe('ok');
      if (measured.status !== 'ok') throw new Error(measured.message);
      expect(measured.distanceMeters).toBeCloseTo(preset.widthMeters - 0.555, 12);
      expect(measured.distanceMeters).toBeGreaterThan(0.6);
      expect(measured.distanceMeters).toBeLessThan(4);
    },
  );

  it('finds the nearest forward surface, ignores obstacles behind it, and rotates the sensor with the chassis', () => {
    const base = emptyWorld();
    const world: RoboticsWorldDocument = {
      ...base,
      field: {
        ...base.field,
        obstacles: [
          { id: 'behind', xMeters: 0.1, yMeters: 0.4, widthMeters: 0.1, heightMeters: 0.4 },
          { id: 'front', xMeters: 1, yMeters: 0.4, widthMeters: 0.1, heightMeters: 0.4 },
          { id: 'far', xMeters: 1.4, yMeters: 0.4, widthMeters: 0.1, heightMeters: 0.4 },
        ],
      },
    };
    const forward = measureRoboticsDistance(world, world.initialPose);
    expect(forward.status).toBe('ok');
    expect(forward.distanceMeters).toBeCloseTo(0.295, 12);
    expect(forward.hit).toEqual({ xMeters: 1, yMeters: 0.6 });
    const turned = measureRoboticsDistance(world, {
      ...world.initialPose,
      headingRadians: Math.PI / 2,
    });
    expect(turned.status).toBe('ok');
    expect(turned.distanceMeters).toBeCloseTo(1.095, 12);
    expect(turned.hit?.yMeters).toBeCloseTo(1.8, 12);
  });

  it('reports actual out-of-range geometry instead of inventing a 4 m or 2 cm echo', () => {
    const world = emptyWorld();
    const tooFar = measureRoboticsDistance(
      { ...world, field: { ...world.field, widthMeters: 6 } },
      world.initialPose,
    );
    expect(tooFar.status).toBe('out-of-range');
    expect(tooFar.distanceMeters).toBeGreaterThan(4);
    const inside = measureRoboticsDistance(
      {
        ...world,
        field: {
          ...world.field,
          obstacles: [
            { id: 'inside', xMeters: 0.7, yMeters: 0.5, widthMeters: 0.1, heightMeters: 0.2 },
          ],
        },
      },
      world.initialPose,
    );
    expect(inside.status).toBe('out-of-range');
    expect(inside.distanceMeters).toBe(0);
    expect(
      measureRoboticsDistance(world, { ...world.initialPose, xMeters: Number.NaN }).status,
    ).toBe('invalid');
  });

  it('rejects nonfinite geometry, repeated bindings, out-of-field obstacles and invalid initial contact', () => {
    const world = emptyWorld();
    const invalid: unknown[] = [
      { ...world, robot: { ...world.robot, wheelTrackMeters: 0 } },
      { ...world, robot: { ...world.robot, wheelRadiusMeters: Number.NaN } },
      { ...world, field: { ...world.field, widthMeters: 5 } },
      { ...world, bindings: { ...world.bindings, rightMotorId: world.bindings.leftMotorId } },
      { ...world, initialPose: { ...world.initialPose, yMeters: 0.02 } },
      {
        ...world,
        field: {
          ...world.field,
          obstacles: [
            { id: 'outside', xMeters: 1.7, yMeters: 0.2, widthMeters: 0.5, heightMeters: 0.2 },
          ],
        },
      },
    ];
    for (const value of invalid) {
      const result = parseRoboticsWorldDocument(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
    }
  });
});
