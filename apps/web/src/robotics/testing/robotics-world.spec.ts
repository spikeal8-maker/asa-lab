import { describe, expect, it } from 'vitest';
import {
  advanceRoboticsWorld,
  createRoboticsBall,
  createRoboticsFloorMark,
  createRoboticsWorldDocument,
  createRoboticsWorldV3Document,
  createRoboticsWorldState,
  findRoboticsCollision,
  measureRoboticsDistance,
  parseRoboticsWorldDocument,
  ROBOTICS_FIELD_PRESETS,
  ROBOTICS_RUN_LIMIT_MICROSECONDS,
  type RoboticsWorldDocument,
  type RoboticsWorldState,
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

describe('M1 source clock, runtime scene and geometric sensor feedback', () => {
  it('holds partial observations until the fixed physical boundary and integrates a consistent RPM ramp', () => {
    const world = emptyWorld();
    const initial = createRoboticsWorldState(world);
    const partial = advanceRoboticsWorld(world, initial, {
      atMicroseconds: 4_999,
      leftRpm: 29.994,
      rightRpm: 29.994,
    });
    expect(partial.pose).toBe(initial.pose);
    expect(partial.balls).toBe(initial.balls);
    expect(partial.atMicroseconds).toBe(4_999);
    expect(partial.physicsAtMicroseconds).toBe(0);
    const firstTick = advanceRoboticsWorld(world, partial, {
      atMicroseconds: 5_000,
      leftRpm: 30,
      rightRpm: 30,
    });
    expect(firstTick.physicsAtMicroseconds).toBe(5_000);
    expect(firstTick.pendingLeftMeters).toBe(0);
    const fine = advanceRoboticsWorld(world, firstTick, {
      atMicroseconds: 10_000,
      leftRpm: 60,
      rightRpm: 60,
    });
    const coarse = advanceRoboticsWorld(world, initial, {
      atMicroseconds: 10_000,
      leftRpm: 60,
      rightRpm: 60,
    });
    expect(fine.pose.xMeters).toBeCloseTo(coarse.pose.xMeters, 12);
    expect(fine.pose.xMeters - initial.pose.xMeters).toBeCloseTo(0.0010210176124166828, 12);
  });

  it('pushes a source object, keeps its source placement unchanged, and resets all velocities and physical time', () => {
    const base = emptyWorld();
    const world = {
      ...base,
      field: {
        ...base.field,
        balls: [
          { ...createRoboticsBall('push', { xMeters: 0.8, yMeters: 0.65 }), radiusMeters: 0.02 },
        ],
      },
    };
    const source = structuredClone(world);
    const initial = advanceRoboticsWorld(world, createRoboticsWorldState(world), {
      atMicroseconds: 0,
      leftRpm: 60,
      rightRpm: 60,
    });
    const moved = advanceRoboticsWorld(world, initial, {
      atMicroseconds: 1_000_000,
      leftRpm: 60,
      rightRpm: 60,
    });
    expect(moved.haltReason).toBeNull();
    expect(moved.balls[0].xMeters).toBeGreaterThan(0.8);
    expect(moved.balls[0].velocityXMetersPerSecond).toBeGreaterThan(0);
    expect(world).toEqual(source);
    expect(
      advanceRoboticsWorld(world, moved, { atMicroseconds: 1_000_000, leftRpm: 60, rightRpm: 60 }),
    ).toBe(moved);
    const reset = createRoboticsWorldState(world);
    expect(reset.pose).toEqual(world.initialPose);
    expect(reset.balls).toEqual([
      {
        id: 'push',
        xMeters: 0.8,
        yMeters: 0.65,
        velocityXMetersPerSecond: 0,
        velocityYMetersPerSecond: 0,
      },
    ]);
    expect(reset.atMicroseconds).toBe(0);
    expect(reset.physicsAtMicroseconds).toBe(0);
    expect(reset.pendingLeftMeters).toBe(0);
    expect(reset.pendingRightMeters).toBe(0);
  });

  it('replays the same committed history exactly and does not add physical ticks for tiny observation partitions', () => {
    const base = emptyWorld();
    const world = {
      ...base,
      field: { ...base.field, balls: [createRoboticsBall('free', { xMeters: 0.9, yMeters: 1 })] },
    };
    const initial = createRoboticsWorldState(world);
    const moving: RoboticsWorldState = {
      ...initial,
      leftRpm: 40,
      rightRpm: 40,
      balls: [{ ...initial.balls[0], velocityXMetersPerSecond: 0.3 }],
    };
    const trace = [999, 1_999, 4_999, 5_001, 9_999, 10_000, 20_000, 50_000];
    const replay = () =>
      trace.reduce(
        (state, atMicroseconds) =>
          advanceRoboticsWorld(world, state, { atMicroseconds, leftRpm: 40, rightRpm: 40 }),
        moving,
      );
    const fine = replay();
    expect(fine).toEqual(replay());
    expect(fine.haltReason).toBeNull();
    const coarse = advanceRoboticsWorld(world, moving, {
      atMicroseconds: 50_000,
      leftRpm: 40,
      rightRpm: 40,
    });
    expect(fine.physicsAtMicroseconds).toBe(coarse.physicsAtMicroseconds);
    expect(fine.pose.xMeters).toBeCloseTo(coarse.pose.xMeters, 12);
    expect(fine.balls).toEqual(coarse.balls);
  });

  it('measures the nearest current disc rather than a saved position and ignores all floor paint', () => {
    const base = emptyWorld();
    const world: RoboticsWorldDocument = {
      ...base,
      field: {
        ...base.field,
        obstacles: [
          { id: 'far-wall', xMeters: 1.4, yMeters: 0.4, widthMeters: 0.1, heightMeters: 0.4 },
        ],
        balls: [
          { ...createRoboticsBall('a', { xMeters: 1.1, yMeters: 0.6 }), radiusMeters: 0.05 },
          { ...createRoboticsBall('b', { xMeters: 0.9, yMeters: 0.9 }), radiusMeters: 0.05 },
        ],
        floorMarks: [
          createRoboticsFloorMark('line', 'line', { xMeters: 0.71, yMeters: 0.6 }),
          createRoboticsFloorMark('area', 'area', { xMeters: 0.71, yMeters: 0.5 }),
        ],
      },
    };
    const sourceMeasurement = measureRoboticsDistance(world, world.initialPose);
    expect(sourceMeasurement.status).toBe('ok');
    expect(sourceMeasurement.distanceMeters).toBeCloseTo(0.345, 12);
    const states = createRoboticsWorldState(world).balls.map((ball) => ({
      ...ball,
      xMeters: ball.id === 'a' ? 1.2 : 0.9,
      yMeters: 0.6,
    }));
    const runtime = measureRoboticsDistance(world, world.initialPose, states);
    expect(runtime.status).toBe('ok');
    expect(runtime.distanceMeters).toBeCloseTo(0.145, 12);
    expect(runtime.hit?.xMeters).toBeCloseTo(0.85, 12);
    expect(measureRoboticsDistance(world, world.initialPose)).toEqual(sourceMeasurement);
    const behind = states.map((ball) => (ball.id === 'b' ? { ...ball, xMeters: 0.5 } : ball));
    expect(measureRoboticsDistance(world, world.initialPose, behind).distanceMeters).toBeCloseTo(
      0.445,
      12,
    );
    expect(measureRoboticsDistance(world, world.initialPose, []).status).toBe('invalid');
    expect(
      measureRoboticsDistance(world, world.initialPose, [
        { ...states[0], xMeters: Number.NaN },
        states[1],
      ]).status,
    ).toBe('invalid');
  });

  it('uses oriented wall surfaces consistently for ray hits and robot contacts', () => {
    const base = emptyWorld();
    const world = {
      ...base,
      field: {
        ...base.field,
        obstacles: [
          {
            id: 'tilted',
            xMeters: 0.8,
            yMeters: 0.59,
            widthMeters: 0.4,
            heightMeters: 0.02,
            headingRadians: Math.PI / 4,
          },
        ],
      },
    };
    const measurement = measureRoboticsDistance(world, world.initialPose);
    expect(measurement.status).toBe('ok');
    expect(measurement.distanceMeters).toBeCloseTo(0.280857864376269, 12);
    expect(findRoboticsCollision(world, { xMeters: 1, yMeters: 0.6, headingRadians: 0 })).toContain(
      'tilted',
    );
  });

  it('rejects corrupted physical clocks, pending travel and runtime ball sets before any integration', () => {
    const base = emptyWorld();
    const world = {
      ...base,
      field: { ...base.field, balls: [createRoboticsBall('free', { xMeters: 1, yMeters: 1 })] },
    };
    const state = createRoboticsWorldState(world);
    const invalidStates: RoboticsWorldState[] = [
      { ...state, physicsAtMicroseconds: 1 },
      { ...state, atMicroseconds: Number.NaN },
      { ...state, pendingLeftMeters: 1 },
      { ...state, pendingRightMeters: Number.POSITIVE_INFINITY },
      { ...state, balls: [{ ...state.balls[0], id: 'missing' }] },
      { ...state, balls: [{ ...state.balls[0], velocityXMetersPerSecond: Number.NaN }] },
      { ...state, balls: [null] as unknown as RoboticsWorldState['balls'] },
    ];
    for (const invalid of invalidStates) {
      const result = advanceRoboticsWorld(world, invalid, {
        atMicroseconds: 5_000,
        leftRpm: 60,
        rightRpm: 60,
      });
      expect(result.haltReason).toBeTruthy();
      expect(result.pose).toBe(invalid.pose);
      expect(result.balls).toBe(invalid.balls);
    }
    for (const atMicroseconds of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = advanceRoboticsWorld(world, state, {
        atMicroseconds,
        leftRpm: 0,
        rightRpm: 0,
      });
      expect(result.haltReason).toContain('Время электроники');
      expect(result.pose).toBe(state.pose);
    }
  });
});

describe('Robotics field validation and HC-SR04 geometric environment', () => {
  it.each(ROBOTICS_FIELD_PRESETS)(
    'places the robot in the exact center of the $id field and measures a real forward obstacle',
    (preset) => {
      // The 5m arena uses the v3 source contract; v2 remains limited to 2.4m.
      const world =
        preset.id === 'arena'
          ? createRoboticsWorldV3Document(preset.id)
          : createRoboticsWorldDocument(preset.id);
      expect(world.initialPose).toEqual({
        xMeters: preset.widthMeters / 2,
        yMeters: preset.heightMeters / 2,
        headingRadians: 0,
      });
      expect(parseRoboticsWorldDocument(world)).toEqual({ ok: true, world });
      const wall = world.field.obstacles[0]!;
      expect(wall.xMeters).toBeGreaterThan(world.initialPose.xMeters + 0.2);
      const measured = measureRoboticsDistance(world, world.initialPose);
      expect(measured.status).toBe('ok');
      if (measured.status !== 'ok') throw new Error(measured.message);
      expect(measured.distanceMeters).toBeCloseTo(
        wall.xMeters - world.initialPose.xMeters - world.robot.sensorForwardMeters,
        12,
      );
      expect(measured.distanceMeters).toBeGreaterThan(0.2);
      expect(measured.distanceMeters).toBeLessThan(4);
      // The 1.2 m compact field cannot fit 0.6 m of forward clearance from its center.
      if (preset.id !== 'compact') expect(measured.distanceMeters).toBeGreaterThan(0.6);
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
