/** Public robotics facade. Electrical motors, Arduino and committed time belong to Electronics. */
import {
  decodeRoboticsWorldDocument,
  type RoboticsPoint,
  type RoboticsPose,
  type RoboticsWorldDocument,
} from './world-document';
import {
  createRoboticsBallStates,
  findRoboticsCollision,
  ROBOTICS_PHYSICS_LIMITS,
  roboticsRayBall,
  roboticsRayWall,
  stepRoboticsPhysics,
  validateRoboticsBallStates,
  validateRoboticsWorldGeometry,
  type RoboticsBallState,
} from './world-physics';

export {
  createRoboticsBall,
  createRoboticsFloorMark,
  createRoboticsWall,
  createRoboticsWorldDocument,
  nextRoboticsObjectId,
  ROBOTICS_BALL_LIMITS,
  ROBOTICS_FIELD_LIMITS,
  ROBOTICS_FIELD_PRESETS,
  ROBOTICS_SCENE_LIMITS,
  type RoboticsBall,
  type RoboticsFieldPresetId,
  type RoboticsFloorMark,
  type RoboticsPoint,
  type RoboticsPose,
  type RoboticsRectObstacle,
  type RoboticsWorldDocument,
} from './world-document';
export {
  findRoboticsCollision,
  ROBOTICS_PHYSICS_LIMITS,
  type RoboticsBallState,
} from './world-physics';

export interface RoboticsWorldState {
  readonly pose: RoboticsPose;
  readonly balls: readonly RoboticsBallState[];
  /** Last accepted committed electronics observation, including a partial physical tick. */
  readonly atMicroseconds: number;
  /** Last fully committed physical tick. A failed tick preserves its complete starting state. */
  readonly physicsAtMicroseconds: number;
  readonly pendingLeftMeters: number;
  readonly pendingRightMeters: number;
  readonly leftRpm: number;
  readonly rightRpm: number;
  readonly trail: readonly RoboticsPose[];
  readonly haltReason: string | null;
}

export interface RoboticsDriveFrame {
  readonly atMicroseconds: number;
  /** Signed output-shaft RPM, already after the gearbox. */
  readonly leftRpm: number;
  readonly rightRpm: number;
}

export type RoboticsDistanceMeasurement =
  | {
      readonly status: 'ok';
      readonly distanceMeters: number;
      readonly origin: RoboticsPoint;
      readonly hit: RoboticsPoint;
    }
  | {
      readonly status: 'out-of-range' | 'invalid';
      readonly message: string;
      readonly origin: RoboticsPoint | null;
      readonly hit: RoboticsPoint | null;
      readonly distanceMeters?: number;
    };

export const ROBOTICS_SENSOR_INTERVAL_MICROSECONDS = 50_000;
export const ROBOTICS_RUN_LIMIT_MICROSECONDS = 40_000_000;
const RUN_COMPLETE = 'Завершены 40 секунд модельного времени. Для нового опыта нажмите «Сбросить».';

export function parseRoboticsWorldDocument(
  value: unknown,
):
  | { readonly ok: true; readonly world: RoboticsWorldDocument }
  | { readonly ok: false; readonly message: string } {
  try {
    const world = decodeRoboticsWorldDocument(value);
    const geometry = validateRoboticsWorldGeometry(world);
    if (geometry) throw new Error(geometry);
    const measurement = measureRoboticsDistance(world, world.initialPose);
    if (measurement.status !== 'ok') throw new Error(measurement.message);
    return { ok: true, world };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Некорректный проект поля.',
    };
  }
}

export function createRoboticsWorldState(world: RoboticsWorldDocument): RoboticsWorldState {
  const pose = { ...world.initialPose };
  return {
    pose,
    balls: createRoboticsBallStates(world),
    atMicroseconds: 0,
    physicsAtMicroseconds: 0,
    pendingLeftMeters: 0,
    pendingRightMeters: 0,
    leftRpm: 0,
    rightRpm: 0,
    trail: [pose],
    haltReason: null,
  };
}

function validPose(pose: RoboticsPose): boolean {
  return !!pose && [pose.xMeters, pose.yMeters, pose.headingRadians].every(Number.isFinite);
}

function validateRuntime(world: RoboticsWorldDocument, state: RoboticsWorldState): string | null {
  const step = ROBOTICS_PHYSICS_LIMITS.stepMicroseconds;
  if (
    !Number.isSafeInteger(state.atMicroseconds) ||
    state.atMicroseconds < 0 ||
    state.atMicroseconds > ROBOTICS_RUN_LIMIT_MICROSECONDS ||
    !Number.isSafeInteger(state.physicsAtMicroseconds) ||
    state.physicsAtMicroseconds < 0 ||
    state.physicsAtMicroseconds % step !== 0 ||
    state.physicsAtMicroseconds > state.atMicroseconds ||
    state.atMicroseconds - state.physicsAtMicroseconds >= step ||
    ![state.leftRpm, state.rightRpm, state.pendingLeftMeters, state.pendingRightMeters].every(
      Number.isFinite,
    )
  )
    return 'Повреждено время или накопленное движение мира. Нажмите «Сбросить».';
  const pendingLimit =
    ((state.atMicroseconds - state.physicsAtMicroseconds) / 1_000_000) *
      ROBOTICS_PHYSICS_LIMITS.wheelSpeedMetersPerSecond +
    1e-10;
  if (
    Math.abs(state.pendingLeftMeters) > pendingLimit ||
    Math.abs(state.pendingRightMeters) > pendingLimit ||
    !validPose(state.pose) ||
    !Array.isArray(state.trail) ||
    state.trail.length < 1 ||
    state.trail.length > 800 ||
    !state.trail.every(validPose)
  )
    return 'Повреждено состояние мира. Нажмите «Сбросить».';
  if (findRoboticsCollision(world, state.pose))
    return 'Робот пересекает неподвижное тело. Нажмите «Сбросить».';
  return validateRoboticsBallStates(world, state.pose, state.balls);
}

/**
 * Integrate wheel travel between complete RPM observations onto a global 5 ms physical clock.
 * Display frames and sub-tick observation partitions never create extra physical ticks.
 * Electrical output is prescribed; no contact force is sent back as a fabricated motor load.
 */
export function advanceRoboticsWorld(
  world: RoboticsWorldDocument,
  state: RoboticsWorldState,
  frame: RoboticsDriveFrame,
): RoboticsWorldState {
  if (state.haltReason) return state;
  const parsed = parseRoboticsWorldDocument(world);
  if (!parsed.ok) return { ...state, haltReason: parsed.message };
  const invalid = validateRuntime(world, state);
  if (invalid) return { ...state, haltReason: invalid };
  if (!Number.isSafeInteger(frame.atMicroseconds) || frame.atMicroseconds < state.atMicroseconds)
    return { ...state, haltReason: 'Время электроники изменилось. Сбросьте запуск робота.' };
  if (!Number.isFinite(frame.leftRpm) || !Number.isFinite(frame.rightRpm))
    return { ...state, haltReason: 'Ядро не предоставило корректные обороты обоих моторов.' };
  if (frame.atMicroseconds > ROBOTICS_RUN_LIMIT_MICROSECONDS)
    return { ...state, haltReason: RUN_COMPLETE };
  const metresPerRpmSecond = (2 * Math.PI * world.robot.wheelRadiusMeters) / 60;
  if (
    [state.leftRpm, state.rightRpm, frame.leftRpm, frame.rightRpm].some(
      (rpm) =>
        Math.abs(rpm * metresPerRpmSecond) > ROBOTICS_PHYSICS_LIMITS.wheelSpeedMetersPerSecond,
    )
  )
    return {
      ...state,
      haltReason:
        'Обороты моторов превышают предел скорости физического профиля (5 м/с на колесе).',
    };
  if (frame.atMicroseconds === state.atMicroseconds)
    return state.atMicroseconds === 0
      ? { ...state, leftRpm: frame.leftRpm, rightRpm: frame.rightRpm }
      : state;

  const duration = frame.atMicroseconds - state.atMicroseconds;
  const step = ROBOTICS_PHYSICS_LIMITS.stepMicroseconds;
  let cursor = state.atMicroseconds;
  let physicsAtMicroseconds = state.physicsAtMicroseconds;
  let pendingLeftMeters = state.pendingLeftMeters;
  let pendingRightMeters = state.pendingRightMeters;
  let pose = state.pose;
  let balls = state.balls;
  let haltReason: string | null = null;
  let iterationBudget: number = ROBOTICS_PHYSICS_LIMITS.iterationsPerAdvance;
  const trail = [...state.trail];
  while (cursor < frame.atMicroseconds) {
    const end = Math.min(frame.atMicroseconds, physicsAtMicroseconds + step);
    const middleFraction = ((cursor + end) / 2 - state.atMicroseconds) / duration;
    const seconds = (end - cursor) / 1_000_000;
    pendingLeftMeters +=
      (state.leftRpm + (frame.leftRpm - state.leftRpm) * middleFraction) *
      metresPerRpmSecond *
      seconds;
    pendingRightMeters +=
      (state.rightRpm + (frame.rightRpm - state.rightRpm) * middleFraction) *
      metresPerRpmSecond *
      seconds;
    cursor = end;
    if (cursor !== physicsAtMicroseconds + step) continue;
    const tickSeconds = step / 1_000_000;
    const result = stepRoboticsPhysics(
      world,
      pose,
      balls,
      {
        linearMetersPerSecond: (pendingLeftMeters + pendingRightMeters) / (2 * tickSeconds),
        angularRadiansPerSecond:
          (pendingRightMeters - pendingLeftMeters) / (world.robot.wheelTrackMeters * tickSeconds),
      },
      tickSeconds,
      iterationBudget,
    );
    iterationBudget -= result.iterations;
    if (result.haltReason) {
      haltReason = result.haltReason;
      break;
    }
    pose = result.pose;
    balls = result.balls;
    physicsAtMicroseconds += step;
    pendingLeftMeters = 0;
    pendingRightMeters = 0;
    const last = trail[trail.length - 1];
    if (Math.hypot(pose.xMeters - last.xMeters, pose.yMeters - last.yMeters) >= 0.005) {
      trail.push(pose);
      if (trail.length > 800) trail.shift();
    }
  }
  return {
    pose,
    balls,
    atMicroseconds: frame.atMicroseconds,
    physicsAtMicroseconds,
    pendingLeftMeters: haltReason ? 0 : pendingLeftMeters,
    pendingRightMeters: haltReason ? 0 : pendingRightMeters,
    leftRpm: frame.leftRpm,
    rightRpm: frame.rightRpm,
    trail,
    haltReason:
      haltReason ??
      (frame.atMicroseconds === ROBOTICS_RUN_LIMIT_MICROSECONDS ? RUN_COMPLETE : null),
  };
}

/** A single geometric ray against walls, boundaries and current discs; floor paint has no echo. */
export function measureRoboticsDistance(
  world: RoboticsWorldDocument,
  pose: RoboticsPose,
  runtimeBalls?: readonly RoboticsBallState[],
): RoboticsDistanceMeasurement {
  const invalid = (message: string): RoboticsDistanceMeasurement => ({
    status: 'invalid',
    message,
    origin: null,
    hit: null,
  });
  if (!validPose(pose)) return invalid('Некорректное положение датчика.');
  const cosine = Math.cos(pose.headingRadians);
  const sine = Math.sin(pose.headingRadians);
  const origin = {
    xMeters:
      pose.xMeters +
      world.robot.sensorForwardMeters * cosine -
      world.robot.sensorLateralMeters * sine,
    yMeters:
      pose.yMeters +
      world.robot.sensorForwardMeters * sine +
      world.robot.sensorLateralMeters * cosine,
  };
  const heading = pose.headingRadians + world.robot.sensorHeadingRadians;
  if (
    ![
      origin.xMeters,
      origin.yMeters,
      heading,
      world.field.widthMeters,
      world.field.heightMeters,
    ].every(Number.isFinite)
  )
    return invalid('Некорректная геометрия датчика или поля.');
  if (
    origin.xMeters < 0 ||
    origin.xMeters > world.field.widthMeters ||
    origin.yMeters < 0 ||
    origin.yMeters > world.field.heightMeters
  )
    return { status: 'invalid', message: 'Датчик находится за границей поля.', origin, hit: null };
  const dx = Math.cos(heading);
  const dy = Math.sin(heading);
  const candidates: number[] = [];
  if (dx > 1e-12) candidates.push((world.field.widthMeters - origin.xMeters) / dx);
  else if (dx < -1e-12) candidates.push(-origin.xMeters / dx);
  if (dy > 1e-12) candidates.push((world.field.heightMeters - origin.yMeters) / dy);
  else if (dy < -1e-12) candidates.push(-origin.yMeters / dy);
  for (const rectangle of world.field.obstacles) {
    const distance = roboticsRayWall(origin, dx, dy, rectangle);
    if (distance !== null) candidates.push(distance);
  }
  const definitions = world.field.balls;
  if (runtimeBalls !== undefined && !Array.isArray(runtimeBalls))
    return invalid('Некорректный набор предметов датчика.');
  const positions = runtimeBalls ?? definitions;
  if (positions.length !== definitions.length)
    return invalid('Набор предметов датчика не соответствует сцене.');
  const byId = new Map(definitions.map((ball) => [ball.id, ball]));
  const seen = new Set<string>();
  for (const position of positions) {
    if (!position) return invalid('Некорректное положение предмета для датчика.');
    const ball = byId.get(position.id);
    if (
      !ball ||
      seen.has(position.id) ||
      ![position.xMeters, position.yMeters, ball.radiusMeters].every(Number.isFinite) ||
      ball.radiusMeters <= 0
    )
      return invalid('Некорректное положение предмета для датчика.');
    seen.add(position.id);
    const distance = roboticsRayBall(origin, dx, dy, position, ball.radiusMeters);
    if (distance !== null) candidates.push(distance);
  }
  const distanceMeters = Math.min(...candidates);
  if (!Number.isFinite(distanceMeters))
    return {
      status: 'invalid',
      message: 'Не найдено корректное попадание луча датчика.',
      origin,
      hit: null,
    };
  const hit = {
    xMeters: origin.xMeters + dx * distanceMeters,
    yMeters: origin.yMeters + dy * distanceMeters,
  };
  if (distanceMeters < 0.02 || distanceMeters > 4)
    return {
      status: 'out-of-range',
      message: 'Расстояние вне диапазона HC-SR04: 0,02–4,00 м. Опыт приостановлен.',
      origin,
      hit,
      distanceMeters,
    };
  return { status: 'ok', distanceMeters, origin, hit };
}
