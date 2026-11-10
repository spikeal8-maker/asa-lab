import { describe, expect, it } from 'vitest';
import {
  createRoboticsBall,
  createRoboticsWorldDocument,
  createRoboticsWorldState,
  type RoboticsBall,
  type RoboticsBallState,
  type RoboticsRectObstacle,
  type RoboticsWorldDocument,
} from '../world';
import {
  roboticsContactPointVelocity,
  stepRoboticsPhysics,
  validateRoboticsBallStates,
} from '../world-physics';

const still = { linearMetersPerSecond: 0, angularRadiansPerSecond: 0 };
const tick = 0.005;

function disc(
  id: string,
  xMeters: number,
  yMeters: number,
  properties: Partial<RoboticsBall> = {},
): RoboticsBall {
  return {
    ...createRoboticsBall(id, { xMeters, yMeters }),
    radiusMeters: 0.02,
    frictionCoefficient: 0,
    restitution: 1,
    ...properties,
  };
}

function scene(
  balls: readonly RoboticsBall[],
  obstacles: readonly RoboticsRectObstacle[] = [],
): RoboticsWorldDocument {
  const world = createRoboticsWorldDocument();
  return {
    ...world,
    initialPose: { xMeters: 1.3, yMeters: 1.3, headingRadians: 0 },
    field: { ...world.field, obstacles, balls },
  };
}

function velocities(
  world: RoboticsWorldDocument,
  values: Readonly<Record<string, readonly [number, number]>>,
): readonly RoboticsBallState[] {
  return createRoboticsWorldState(world).balls.map((ball) => ({
    ...ball,
    velocityXMetersPerSecond: values[ball.id]?.[0] ?? 0,
    velocityYMetersPerSecond: values[ball.id]?.[1] ?? 0,
  }));
}

describe('Planar disc physical oracles, independent of the contact implementation', () => {
  it('conserves momentum for unequal masses and loses exactly the energy specified by restitution', () => {
    const world = scene([
      disc('a', 0.5, 0.5, { massKg: 0.1, restitution: 0.6 }),
      disc('b', 0.54, 0.5, { massKg: 0.2, restitution: 0.6 }),
    ]);
    const initial = velocities(world, { a: [1, 0] });
    const snapshot = structuredClone({ world, initial });
    const result = stepRoboticsPhysics(world, world.initialPose, initial, still, tick);
    expect(result.haltReason).toBeNull();
    const [a, b] = result.balls;
    expect(a.velocityXMetersPerSecond).toBeCloseTo(-0.06666666666666667, 9);
    expect(b.velocityXMetersPerSecond).toBeCloseTo(0.5333333333333333, 9);
    expect(0.1 * a.velocityXMetersPerSecond + 0.2 * b.velocityXMetersPerSecond).toBeCloseTo(
      0.1,
      10,
    );
    expect(
      0.05 * a.velocityXMetersPerSecond ** 2 + 0.1 * b.velocityXMetersPerSecond ** 2,
    ).toBeCloseTo(0.02866666666666667, 10);
    expect(a.velocityYMetersPerSecond).toBe(0);
    expect(b.velocityYMetersPerSecond).toBe(0);
    expect({ world, initial }).toEqual(snapshot);
  });

  it.each([
    [1, 2],
    [0.75, 1.5],
    [0, 0],
  ])(
    'reflects normal speed at e=%s without inventing tangential friction',
    (restitution, expectedSpeed) => {
      const world = scene(
        [disc('ball', 0.84, 0.5, { restitution })],
        [{ id: 'wall', xMeters: 0.8, yMeters: 0.3, widthMeters: 0.02, heightMeters: 0.6 }],
      );
      const result = stepRoboticsPhysics(
        world,
        world.initialPose,
        velocities(world, { ball: [-2, 0.4] }),
        still,
        tick,
      );
      expect(result.haltReason).toBeNull();
      expect(result.balls[0].velocityXMetersPerSecond).toBeCloseTo(expectedSpeed, 9);
      expect(result.balls[0].velocityYMetersPerSecond).toBeCloseTo(0.4, 9);
    },
  );

  it('stops through Coulomb floor friction at the analytic distance, without reversing or creeping', () => {
    const world = scene([disc('ball', 0.4, 0.5, { frictionCoefficient: 0.2 })]);
    let balls = velocities(world, { ball: [1, 0] });
    let stoppedX = Number.NaN;
    for (let step = 1; step <= 120; step += 1) {
      const result = stepRoboticsPhysics(world, world.initialPose, balls, still, tick);
      expect(result.haltReason).toBeNull();
      balls = result.balls;
      if (step === 50) {
        expect(balls[0].velocityXMetersPerSecond).toBeCloseTo(0.5095, 8);
        expect(balls[0].xMeters - 0.4).toBeCloseTo(0.1886875, 8);
      }
      if (step === 101) expect(balls[0].velocityXMetersPerSecond).toBeGreaterThan(0);
      if (step === 102) {
        expect(balls[0].velocityXMetersPerSecond).toBe(0);
        expect(Math.abs(balls[0].xMeters - 0.4 - 0.254841997961264)).toBeLessThan(0.0001);
        stoppedX = balls[0].xMeters;
      }
      if (step > 102) {
        expect(balls[0].xMeters).toBe(stoppedX);
        expect(balls[0].velocityXMetersPerSecond).toBe(0);
      }
    }
  });

  it('pushes a disc with the velocity of a turning chassis contact point, even at zero centre speed', () => {
    const base = scene([disc('ball', 1.12, 0.95, { restitution: 0.5 })]);
    const world = { ...base, initialPose: { xMeters: 1, yMeters: 1, headingRadians: 0 } };
    const drive = { linearMetersPerSecond: 0, angularRadiansPerSecond: 2 };
    const velocity = roboticsContactPointVelocity(world.initialPose, drive, {
      xMeters: 1.1,
      yMeters: 0.95,
    });
    expect(velocity.xMetersPerSecond).toBeCloseTo(0.1, 12);
    expect(velocity.yMetersPerSecond).toBeCloseTo(0.2, 12);
    const result = stepRoboticsPhysics(
      world,
      world.initialPose,
      velocities(world, {}),
      drive,
      tick,
    );
    expect(result.haltReason).toBeNull();
    expect(result.pose.headingRadians).toBeCloseTo(0.01, 12);
    expect(result.balls[0].velocityXMetersPerSecond).toBeCloseTo(0.15, 9);
    expect(result.balls[0].velocityYMetersPerSecond).toBeCloseTo(0, 9);
    expect(result.balls[0].xMeters).toBeGreaterThan(1.12);
  });

  it('hits a 20 mm wall at 1.5 ms and completes the reflected flight inside the same tick', () => {
    const world = scene(
      [disc('ball', 0.25, 0.7)],
      [{ id: 'thin', xMeters: 0.3, yMeters: 0.4, widthMeters: 0.02, heightMeters: 0.6 }],
    );
    const result = stepRoboticsPhysics(
      world,
      world.initialPose,
      velocities(world, { ball: [20, 0] }),
      still,
      tick,
    );
    expect(result.haltReason).toBeNull();
    expect(result.balls[0].xMeters).toBeCloseTo(0.21, 9);
    expect(result.balls[0].velocityXMetersPerSecond).toBeCloseTo(-20, 9);
    expect(validateRoboticsBallStates(world, result.pose, result.balls)).toBeNull();
  });
});

describe('Swept contact, determinism and bounded failure', () => {
  it.each([0.1, 0.3, 0.7, 1.2])(
    'leaves a rounded wall corner tangentially at zero restitution, angle %s',
    (angle) => {
      const world = scene(
        [
          disc('ball', 0.6 - 0.02 * Math.cos(angle), 0.6 - 0.02 * Math.sin(angle), {
            restitution: 0,
          }),
        ],
        [{ id: 'corner', xMeters: 0.6, yMeters: 0.6, widthMeters: 0.1, heightMeters: 0.1 }],
      );
      const result = stepRoboticsPhysics(
        world,
        world.initialPose,
        velocities(world, { ball: [1, 0] }),
        still,
        tick,
      );
      expect(result.haltReason).toBeNull();
      expect(result.balls[0].velocityXMetersPerSecond).toBeCloseTo(Math.sin(angle) ** 2, 9);
      expect(result.balls[0].velocityYMetersPerSecond).toBeCloseTo(
        -Math.cos(angle) * Math.sin(angle),
        9,
      );
      expect(validateRoboticsBallStates(world, result.pose, result.balls)).toBeNull();
    },
  );

  it('detects a turning corner grazing a disc between two separated endpoint poses, or halts conservatively', () => {
    const cornerRadius = Math.hypot(0.1, 0.088);
    const direction = Math.atan2(0.088, 0.1) + 0.1;
    const distance = cornerRadius + 0.02 - 0.000001;
    const base = scene([
      disc('grazing', 0.8 + distance * Math.cos(direction), 0.8 + distance * Math.sin(direction)),
    ]);
    const world = { ...base, initialPose: { xMeters: 0.8, yMeters: 0.8, headingRadians: 0 } };
    const initial = velocities(world, {});
    const result = stepRoboticsPhysics(
      world,
      world.initialPose,
      initial,
      { linearMetersPerSecond: 0, angularRadiansPerSecond: 40 },
      tick,
    );
    if (result.haltReason) {
      expect(result.pose).toBe(world.initialPose);
      expect(result.balls).toBe(initial);
    } else {
      expect(
        Math.hypot(
          result.balls[0].velocityXMetersPerSecond,
          result.balls[0].velocityYMetersPerSecond,
        ),
      ).toBeGreaterThan(0.001);
      expect(validateRoboticsBallStates(world, result.pose, result.balls)).toBeNull();
    }
  });

  it('detects a grazing corner crossing shorter than a geometric substep, although both endpoints are outside', () => {
    const world = scene(
      [disc('ball', 0.5505025960276198, 0.6212132741462746)],
      [{ id: 'corner', xMeters: 0.6, yMeters: 0.6, widthMeters: 0.1, heightMeters: 0.1 }],
    );
    const result = stepRoboticsPhysics(
      world,
      world.initialPose,
      velocities(world, { ball: [14.14213562373095, -14.14213562373095] }),
      still,
      tick,
    );
    expect(result.haltReason).toBeNull();
    // Offset from the corner is r - 0.1 micrometre; analytic chord half-length is 63.245474 micrometres.
    expect(result.balls[0].velocityXMetersPerSecond).toBeCloseTo(14.05241062164234, 7);
    expect(result.balls[0].velocityYMetersPerSecond).toBeCloseTo(-14.231294941808827, 7);
    expect(
      Math.hypot(
        result.balls[0].velocityXMetersPerSecond,
        result.balls[0].velocityYMetersPerSecond,
      ),
    ).toBeCloseTo(20, 8);
    expect(validateRoboticsBallStates(world, result.pose, result.balls)).toBeNull();
  });

  it('uses the same swept collision for a rotated thin wall', () => {
    const diagonal = Math.SQRT1_2;
    const world = scene(
      [disc('ball', 0.8 - 0.06 * diagonal, 0.8 - 0.06 * diagonal)],
      [
        {
          id: 'diagonal',
          xMeters: 0.79,
          yMeters: 0.6,
          widthMeters: 0.02,
          heightMeters: 0.4,
          headingRadians: Math.PI / 4,
        },
      ],
    );
    const result = stepRoboticsPhysics(
      world,
      world.initialPose,
      velocities(world, { ball: [20 * diagonal, 20 * diagonal] }),
      still,
      tick,
    );
    expect(result.haltReason).toBeNull();
    expect(result.balls[0].xMeters).toBeCloseTo(0.8 - 0.1 * diagonal, 9);
    expect(result.balls[0].yMeters).toBeCloseTo(0.8 - 0.1 * diagonal, 9);
    expect(result.balls[0].velocityXMetersPerSecond).toBeCloseTo(-20 * diagonal, 9);
    expect(result.balls[0].velocityYMetersPerSecond).toBeCloseTo(-20 * diagonal, 9);
  });

  it('cannot pass fast discs through one another and is independent of source/runtime array order', () => {
    const world = scene([disc('a', 0.3, 0.5), disc('b', 0.35, 0.5)]);
    const states = velocities(world, { a: [20, 0] });
    const result = stepRoboticsPhysics(world, world.initialPose, states, still, tick);
    expect(result.haltReason).toBeNull();
    expect(result.balls[0].xMeters).toBeCloseTo(0.31, 9);
    expect(result.balls[0].velocityXMetersPerSecond).toBeCloseTo(0, 9);
    expect(result.balls[1].xMeters).toBeCloseTo(0.44, 9);
    expect(result.balls[1].velocityXMetersPerSecond).toBeCloseTo(20, 9);
    const reordered = {
      ...world,
      field: { ...world.field, balls: [...world.field.balls].reverse() },
    };
    expect(
      stepRoboticsPhysics(reordered, world.initialPose, [...states].reverse(), still, tick),
    ).toEqual(result);
  });

  it('halts a jammed tick atomically at the last valid state instead of moving a disc through a wall', () => {
    const base = scene(
      [disc('ball', 0.58, 0.5, { restitution: 0.5 })],
      [{ id: 'wall', xMeters: 0.6, yMeters: 0.2, widthMeters: 0.02, heightMeters: 0.6 }],
    );
    const world = { ...base, initialPose: { xMeters: 0.455, yMeters: 0.5, headingRadians: 0 } };
    const initial = velocities(world, {});
    const result = stepRoboticsPhysics(
      world,
      world.initialPose,
      initial,
      { linearMetersPerSecond: 3, angularRadiansPerSecond: 0 },
      tick,
    );
    expect(result.haltReason).toContain('Контакт');
    expect(result.haltReason).toContain('не моделируется');
    expect(result.pose).toBe(world.initialPose);
    expect(result.balls).toBe(initial);
    expect(result.pose.xMeters + world.robot.bodyLengthMeters / 2).toBeLessThanOrEqual(0.56);
    expect(validateRoboticsBallStates(world, result.pose, result.balls)).toBeNull();
  });

  it('bounds work and fails closed for invalid runtime data, speed and budgets', () => {
    const world = scene([disc('ball', 0.4, 0.5)]);
    const initial = velocities(world, {});
    const unexpectedProperties = [
      { ...initial[0], source: { radiusMeters: Number.NaN, massKg: 0 } },
    ];
    expect(
      stepRoboticsPhysics(world, world.initialPose, unexpectedProperties, still, tick),
    ).toEqual(stepRoboticsPhysics(world, world.initialPose, initial, still, tick));
    for (const budget of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      const result = stepRoboticsPhysics(world, world.initialPose, initial, still, tick, budget);
      expect(result.haltReason).toBeTruthy();
      expect(result.pose).toBe(world.initialPose);
      expect(result.balls).toBe(initial);
      expect(result.iterations).toBe(0);
    }
    for (const states of [
      [{ ...initial[0], velocityXMetersPerSecond: Number.NaN }],
      [{ ...initial[0], velocityYMetersPerSecond: 51 }],
      [{ ...initial[0], xMeters: Number.POSITIVE_INFINITY }],
      [{ ...initial[0], id: 'missing' }],
      [null] as unknown as RoboticsBallState[],
    ])
      expect(
        stepRoboticsPhysics(world, world.initialPose, states, still, tick).haltReason,
      ).toBeTruthy();
    expect(
      stepRoboticsPhysics(
        world,
        world.initialPose,
        initial,
        { ...still, angularRadiansPerSecond: 41 },
        tick,
      ).haltReason,
    ).toBeTruthy();
    expect(
      stepRoboticsPhysics(world, world.initialPose, initial, still, 0.006).haltReason,
    ).toBeTruthy();
  });
});
