/** Versioned mechanical adapter. Imported only by the lazy Robotics runtime subpath. */
import { World, Vec2, Box, Circle, MotorJoint, type Body } from 'planck';
import {
  ROBOTICS_ACCURACY_PRESETS,
  ROBOTICS_FIELD_SURFACES,
  type RoboticsWorldV3Document,
} from './world-document.js';
import {
  robotRectangle,
  ROBOTICS_PHYSICS_LIMITS,
  type RoboticsBallState,
} from './world-physics.js';
import type { RoboticsPose } from './world-document.js';
import type { RoboticsRigidBodyState } from './world.js';

/** Fixed per profile, never a global Planck Settings mutation. kg and seconds are unchanged. */
export const ROBOTICS_ENGINE_LENGTH_SCALE = 10;
const SCALE = ROBOTICS_ENGINE_LENGTH_SCALE;
const GRAVITY = 9.81;
const angle = (value: number): number => Math.atan2(Math.sin(value), Math.cos(value));
const byId = <T extends { id: string }>(a: T, b: T): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export interface RoboticsMechanicalSnapshot {
  readonly pose: RoboticsPose;
  readonly balls: readonly RoboticsBallState[];
  readonly bodies: readonly RoboticsRigidBodyState[];
  readonly robotVelocity: {
    readonly velocityXMetersPerSecond: number;
    readonly velocityYMetersPerSecond: number;
    readonly angularVelocityRadiansPerSecond: number;
  };
}
export function createPlanckRoboticsPhysics(source: RoboticsWorldV3Document): {
  read(): RoboticsMechanicalSnapshot;
  step(leftMetersPerSecond: number, rightMetersPerSecond: number): RoboticsMechanicalSnapshot;
} {
  const engine = new World({ gravity: Vec2(0, 0), allowSleep: false });
  engine.setContinuousPhysics(true);
  // A joint's connected-body exclusion must never exclude boundary/wall fixtures.
  const frictionAnchor = engine.createBody();
  const surface = ROBOTICS_FIELD_SURFACES.find((item) => item.id === source.field.surface)!;
  const accuracy = ROBOTICS_ACCURACY_PRESETS.find((item) => item.id === source.physics.accuracy)!;
  const balls = new Map<string, Body>();
  const bodies = new Map<string, Body>();
  const createBody = (
    position: RoboticsPose,
    mass: number,
    radius: number | null,
    width: number,
    depth: number,
    contactFriction: number,
    restitution: number,
    resistance: number,
    spherical = false,
  ): Body => {
    const body = engine.createDynamicBody({
      position: Vec2(position.xMeters * SCALE, position.yMeters * SCALE),
      angle: position.headingRadians,
      bullet: true,
      allowSleep: false,
    });
    const area = radius === null ? width * depth : Math.PI * radius * radius;
    body.createFixture(
      radius === null
        ? new Box((width * SCALE) / 2, (depth * SCALE) / 2)
        : new Circle(radius * SCALE),
      { density: mass / (area * SCALE ** 2), friction: contactFriction, restitution },
    );
    if (radius !== null)
      body.setMassData({
        mass,
        center: Vec2(0, 0),
        I: (spherical ? 0.4 : 1) * mass * radius ** 2 * SCALE ** 2,
      });
    if (resistance > 0) {
      const force = resistance * surface.resistanceMultiplier * mass * GRAVITY;
      const contactRadius = radius === null ? Math.hypot(width, depth) / 3 : (radius * 2) / 3;
      // Zero bias means no position spring. Planck 1.4.2 FrictionJoint aliases oldImpulse;
      // its supported MotorJoint equivalent copies it and resolves static resistance correctly.
      engine.createJoint(
        new MotorJoint(
          {
            correctionFactor: 0,
            maxForce: force * SCALE,
            maxTorque: force * contactRadius * SCALE ** 2,
          },
          frictionAnchor,
          body,
        ),
      );
    }
    return body;
  };
  const definitions = [
    ...source.field.balls.map((ball) => ({ id: ball.id, category: 'ball' as const, ball })),
    ...source.field.bodies.map((body) => ({ id: body.id, category: 'body' as const, body })),
  ].sort(byId);
  for (const definition of definitions) {
    if (definition.category === 'ball') {
      const ball = definition.ball;
      balls.set(
        ball.id,
        createBody(
          { ...ball, headingRadians: 0 },
          ball.massKg,
          ball.radiusMeters,
          0,
          0,
          ball.contactFrictionCoefficient!,
          ball.restitution,
          ball.rollingResistanceCoefficient!,
          true,
        ),
      );
    } else {
      const body = definition.body;
      bodies.set(
        body.id,
        createBody(
          body,
          body.massKg,
          body.kind === 'can' ? body.radiusMeters : null,
          body.kind === 'box' ? body.widthMeters : 0,
          body.kind === 'box' ? body.depthMeters : 0,
          body.contactFrictionCoefficient,
          body.restitution,
          body.slidingFrictionCoefficient,
        ),
      );
    }
  }
  const envelope = robotRectangle(source, source.initialPose);
  const chassis = createBody(
    source.initialPose,
    source.physics.robotMassKg,
    null,
    envelope.halfX * 2,
    envelope.halfY * 2,
    0.35,
    0,
    0,
  );
  const wall = (x: number, y: number, width: number, depth: number, heading = 0): void => {
    const body = engine.createBody({ position: Vec2(x * SCALE, y * SCALE), angle: heading });
    body.createFixture(new Box((width * SCALE) / 2, (depth * SCALE) / 2), {
      friction: 0.35,
      restitution: 0,
    });
  };
  const { widthMeters: width, heightMeters: height } = source.field;
  const thickness = 0.05;
  wall(-thickness / 2, height / 2, thickness, height + thickness * 2);
  wall(width + thickness / 2, height / 2, thickness, height + thickness * 2);
  wall(width / 2, -thickness / 2, width + thickness * 2, thickness);
  wall(width / 2, height + thickness / 2, width + thickness * 2, thickness);
  for (const item of [...source.field.obstacles].sort(byId))
    wall(
      item.xMeters + item.widthMeters / 2,
      item.yMeters + item.heightMeters / 2,
      item.widthMeters,
      item.heightMeters,
      item.headingRadians ?? 0,
    );

  const readBody = (id: string, body: Body): RoboticsRigidBodyState => {
    const position = body.getPosition(),
      velocity = body.getLinearVelocity();
    return {
      id,
      xMeters: position.x / SCALE,
      yMeters: position.y / SCALE,
      headingRadians: angle(body.getAngle()),
      velocityXMetersPerSecond: velocity.x / SCALE,
      velocityYMetersPerSecond: velocity.y / SCALE,
      angularVelocityRadiansPerSecond: body.getAngularVelocity(),
    };
  };
  const read = (): RoboticsMechanicalSnapshot => {
    const robot = readBody('robot', chassis);
    const states = [...bodies].map(([id, body]) => readBody(id, body));
    const spheres = [...balls].map(([id, body]) => readBody(id, body));
    for (const state of [robot, ...states, ...spheres]) {
      if (
        ![
          state.xMeters,
          state.yMeters,
          state.headingRadians,
          state.velocityXMetersPerSecond,
          state.velocityYMetersPerSecond,
          state.angularVelocityRadiansPerSecond,
        ].every(Number.isFinite)
      )
        throw new Error('Физика не получила конечное состояние. Нажмите «Сбросить».');
      if (
        Math.hypot(state.velocityXMetersPerSecond, state.velocityYMetersPerSecond) >
          ROBOTICS_PHYSICS_LIMITS.ballSpeedMetersPerSecond ||
        Math.abs(state.angularVelocityRadiansPerSecond) >
          ROBOTICS_PHYSICS_LIMITS.angularRadiansPerSecond
      )
        throw new Error('Движение превышает предел физического профиля. Нажмите «Сбросить».');
    }
    return {
      pose: {
        xMeters: robot.xMeters,
        yMeters: robot.yMeters,
        headingRadians: robot.headingRadians,
      },
      robotVelocity: {
        velocityXMetersPerSecond: robot.velocityXMetersPerSecond,
        velocityYMetersPerSecond: robot.velocityYMetersPerSecond,
        angularVelocityRadiansPerSecond: robot.angularVelocityRadiansPerSecond,
      },
      balls: spheres.map(
        ({ id, xMeters, yMeters, velocityXMetersPerSecond, velocityYMetersPerSecond }) => ({
          id,
          xMeters,
          yMeters,
          velocityXMetersPerSecond,
          velocityYMetersPerSecond,
        }),
      ),
      bodies: states,
    };
  };
  const drive = (left: number, right: number, seconds: number): void => {
    const heading = chassis.getAngle();
    const forward = Vec2(Math.cos(heading), Math.sin(heading));
    const lateral = Vec2(-forward.y, forward.x);
    if (source.physicsProfile === 'kinematic-rover-bodies-v2') {
      const speed = (left + right) / 2;
      // A dynamic finite-mass body still collides with static walls. This actuator is intentionally ideal.
      chassis.setLinearVelocity(Vec2(speed * forward.x * SCALE, speed * forward.y * SCALE));
      chassis.setAngularVelocity((right - left) / source.robot.wheelTrackMeters);
      return;
    }
    const mass = chassis.getMass();
    const grip =
      (source.physics.tireFrictionCoefficient * surface.gripMultiplier * mass * GRAVITY) / 2;
    for (const [side, target] of [
      [1, left],
      [-1, right],
    ]) {
      const point = chassis.getWorldPoint(
        Vec2(0, (side * source.robot.wheelTrackMeters * SCALE) / 2),
      );
      const velocity = chassis.getLinearVelocityFromWorldPoint(point);
      const longitudinal = Vec2.dot(velocity, forward) / SCALE;
      const transverse = Vec2.dot(velocity, lateral) / SCALE;
      const maximum = source.physics.maxWheelForceNewton;
      const fx = Math.max(
        -maximum,
        Math.min(maximum, ((target - longitudinal) * mass) / (2 * 0.12)),
      );
      const fy = (-transverse * mass) / (2 * Math.max(seconds, 0.025));
      const magnitude = Math.hypot(fx, fy);
      const traction = magnitude === 0 ? 1 : Math.min(1, grip / magnitude);
      chassis.applyForce(
        Vec2(
          (forward.x * fx + lateral.x * fy) * traction * SCALE,
          (forward.y * fx + lateral.y * fy) * traction * SCALE,
        ),
        point,
        true,
      );
    }
  };
  return {
    read,
    step: (left, right) => {
      if (
        ![left, right].every(Number.isFinite) ||
        Math.abs(left) > 5 ||
        Math.abs(right) > 5 ||
        Math.abs((right - left) / source.robot.wheelTrackMeters) >
          ROBOTICS_PHYSICS_LIMITS.angularRadiansPerSecond
      )
        throw new Error('Скорость колёс превышает предел физического профиля.');
      const seconds = ROBOTICS_PHYSICS_LIMITS.stepMicroseconds / 1_000_000 / accuracy.substeps;
      for (let substep = 0; substep < accuracy.substeps; substep++) {
        drive(left, right, seconds);
        engine.step(seconds, accuracy.velocityIterations, accuracy.positionIterations);
      }
      return read();
    },
  };
}
