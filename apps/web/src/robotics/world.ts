/** Planar geometry only. Electrical motors and Arduino remain owned by Electronics. */
export interface RoboticsPoint {
  readonly xMeters: number;
  readonly yMeters: number;
}

export interface RoboticsPose extends RoboticsPoint {
  readonly headingRadians: number;
}

/** The rectangle origin is its lower-left corner in a Cartesian world. */
export interface RoboticsRectObstacle extends RoboticsPoint {
  readonly id: string;
  readonly widthMeters: number;
  readonly heightMeters: number;
}

export interface RoboticsWorldDocument {
  readonly field: {
    readonly widthMeters: number;
    readonly heightMeters: number;
    readonly gridMeters: number;
    readonly obstacles: readonly RoboticsRectObstacle[];
  };
  readonly robot: {
    readonly bodyLengthMeters: number;
    readonly bodyWidthMeters: number;
    readonly wheelRadiusMeters: number;
    readonly wheelWidthMeters: number;
    readonly wheelTrackMeters: number;
    readonly sensorForwardMeters: number;
    readonly sensorLateralMeters: number;
    readonly sensorHeadingRadians: number;
  };
  readonly initialPose: RoboticsPose;
  readonly bindings: {
    readonly boardId: string;
    readonly leftMotorId: string;
    readonly rightMotorId: string;
    readonly distanceSensorId: string;
  };
}

export interface RoboticsWorldState {
  readonly pose: RoboticsPose;
  readonly atMicroseconds: number;
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
export const ROBOTICS_FIELD_PRESETS = [
  { id: 'compact', label: 'Компактное · 1,2 × 1,2 м', widthMeters: 1.2, heightMeters: 1.2 },
  { id: 'practice', label: 'Учебное · 1,8 × 1,8 м', widthMeters: 1.8, heightMeters: 1.8 },
  { id: 'wide', label: 'Большое · 2,4 × 2,0 м', widthMeters: 2.4, heightMeters: 2 },
] as const;

export type RoboticsFieldPresetId = (typeof ROBOTICS_FIELD_PRESETS)[number]['id'];

export function createRoboticsWorldDocument(
  presetId: RoboticsFieldPresetId = 'practice',
): RoboticsWorldDocument {
  const preset = ROBOTICS_FIELD_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) throw new Error('Неизвестный вариант поля.');
  return {
    field: {
      widthMeters: preset.widthMeters,
      heightMeters: preset.heightMeters,
      gridMeters: 0.1,
      obstacles: [
        {
          id: 'barrier',
          xMeters: preset.widthMeters - 0.2,
          yMeters: preset.heightMeters * 0.35,
          widthMeters: 0.08,
          heightMeters: preset.heightMeters * 0.3,
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
    initialPose: { xMeters: 0.25, yMeters: preset.heightMeters / 2, headingRadians: 0 },
    bindings: {
      boardId: 'uno',
      leftMotorId: 'left-motor',
      rightMotorId: 'right-motor',
      distanceSensorId: 'sonar',
    },
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`Некорректные данные: ${label}.`);
  return value as Record<string, unknown>;
}

function bounded(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum)
    throw new Error(`Недопустимое значение: ${label}.`);
  return value;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 64)
    throw new Error(`Некорректный идентификатор: ${label}.`);
  return value;
}

export function parseRoboticsWorldDocument(
  value: unknown,
):
  | { readonly ok: true; readonly world: RoboticsWorldDocument }
  | { readonly ok: false; readonly message: string } {
  try {
    const source = record(value, 'поле и робот');
    const field = record(source.field, 'поле');
    const robot = record(source.robot, 'размеры робота');
    const pose = record(source.initialPose, 'стартовая позиция');
    const bindings = record(source.bindings, 'привязки компонентов');
    const widthMeters = bounded(field.widthMeters, 'ширина поля', 0.8, 2.4);
    const heightMeters = bounded(field.heightMeters, 'высота поля', 0.8, 2.4);
    if (!Array.isArray(field.obstacles) || field.obstacles.length > 24)
      throw new Error('Поле должно содержать не более 24 препятствий.');
    const obstacleIds = new Set<string>();
    const obstacles = field.obstacles.map((value): RoboticsRectObstacle => {
      const obstacle = record(value, 'препятствие');
      const id = identifier(obstacle.id, 'препятствие');
      if (obstacleIds.has(id)) throw new Error('Идентификаторы препятствий повторяются.');
      obstacleIds.add(id);
      const width = bounded(obstacle.widthMeters, 'ширина препятствия', 0.02, widthMeters);
      const height = bounded(obstacle.heightMeters, 'высота препятствия', 0.02, heightMeters);
      return {
        id,
        xMeters: bounded(obstacle.xMeters, 'X препятствия', 0, widthMeters - width),
        yMeters: bounded(obstacle.yMeters, 'Y препятствия', 0, heightMeters - height),
        widthMeters: width,
        heightMeters: height,
      };
    });
    const world: RoboticsWorldDocument = {
      field: {
        widthMeters,
        heightMeters,
        gridMeters: bounded(field.gridMeters, 'шаг сетки', 0.02, 0.5),
        obstacles,
      },
      robot: {
        bodyLengthMeters: bounded(robot.bodyLengthMeters, 'длина шасси', 0.05, 0.5),
        bodyWidthMeters: bounded(robot.bodyWidthMeters, 'ширина шасси', 0.05, 0.5),
        wheelRadiusMeters: bounded(robot.wheelRadiusMeters, 'радиус колеса', 0.01, 0.1),
        wheelWidthMeters: bounded(robot.wheelWidthMeters, 'ширина колеса', 0.005, 0.1),
        wheelTrackMeters: bounded(robot.wheelTrackMeters, 'колея', 0.05, 0.5),
        sensorForwardMeters: bounded(
          robot.sensorForwardMeters,
          'смещение датчика вперёд',
          -0.3,
          0.3,
        ),
        sensorLateralMeters: bounded(robot.sensorLateralMeters, 'смещение датчика вбок', -0.3, 0.3),
        sensorHeadingRadians: bounded(
          robot.sensorHeadingRadians,
          'угол датчика',
          -Math.PI,
          Math.PI,
        ),
      },
      initialPose: {
        xMeters: bounded(pose.xMeters, 'стартовый X', 0, widthMeters),
        yMeters: bounded(pose.yMeters, 'стартовый Y', 0, heightMeters),
        headingRadians: bounded(pose.headingRadians, 'стартовый угол', -Math.PI, Math.PI),
      },
      bindings: {
        boardId: identifier(bindings.boardId, 'Arduino'),
        leftMotorId: identifier(bindings.leftMotorId, 'левый мотор'),
        rightMotorId: identifier(bindings.rightMotorId, 'правый мотор'),
        distanceSensorId: identifier(bindings.distanceSensorId, 'датчик расстояния'),
      },
    };
    if (new Set(Object.values(world.bindings)).size !== 4)
      throw new Error('Arduino, два мотора и датчик должны иметь разные идентификаторы.');
    if (findRoboticsCollision(world, world.initialPose))
      throw new Error('Стартовое положение робота пересекает стену или препятствие.');
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
  return { pose, atMicroseconds: 0, leftRpm: 0, rightRpm: 0, trail: [pose], haltReason: null };
}

/** Four separating axes for the complete robot envelope and an axis-aligned obstacle. */
export function findRoboticsCollision(
  world: RoboticsWorldDocument,
  pose: RoboticsPose,
): string | null {
  const halfLength = Math.max(world.robot.bodyLengthMeters / 2, world.robot.wheelRadiusMeters);
  const halfWidth = Math.max(
    world.robot.bodyWidthMeters / 2,
    (world.robot.wheelTrackMeters + world.robot.wheelWidthMeters) / 2,
  );
  const cosine = Math.cos(pose.headingRadians);
  const sine = Math.sin(pose.headingRadians);
  const extentX = Math.abs(cosine) * halfLength + Math.abs(sine) * halfWidth;
  const extentY = Math.abs(sine) * halfLength + Math.abs(cosine) * halfWidth;
  if (
    pose.xMeters - extentX <= 0 ||
    pose.xMeters + extentX >= world.field.widthMeters ||
    pose.yMeters - extentY <= 0 ||
    pose.yMeters + extentY >= world.field.heightMeters
  )
    return 'граница поля';
  for (const obstacle of world.field.obstacles) {
    const dx = obstacle.xMeters + obstacle.widthMeters / 2 - pose.xMeters;
    const dy = obstacle.yMeters + obstacle.heightMeters / 2 - pose.yMeters;
    const ox = obstacle.widthMeters / 2;
    const oy = obstacle.heightMeters / 2;
    if (
      Math.abs(dx) > extentX + ox ||
      Math.abs(dy) > extentY + oy ||
      Math.abs(dx * cosine + dy * sine) >
        halfLength + ox * Math.abs(cosine) + oy * Math.abs(sine) ||
      Math.abs(-dx * sine + dy * cosine) > halfWidth + ox * Math.abs(sine) + oy * Math.abs(cosine)
    )
      continue;
    return `препятствие «${obstacle.id}»`;
  }
  return null;
}

function integratePose(
  pose: RoboticsPose,
  velocity: number,
  angularVelocity: number,
  seconds: number,
): RoboticsPose {
  const heading = pose.headingRadians + angularVelocity * seconds;
  const straight = Math.abs(angularVelocity) < 1e-10;
  return {
    xMeters:
      pose.xMeters +
      (straight
        ? velocity * seconds * Math.cos(pose.headingRadians)
        : (velocity / angularVelocity) * (Math.sin(heading) - Math.sin(pose.headingRadians))),
    yMeters:
      pose.yMeters +
      (straight
        ? velocity * seconds * Math.sin(pose.headingRadians)
        : (velocity / angularVelocity) * (Math.cos(pose.headingRadians) - Math.cos(heading))),
    headingRadians: Math.atan2(Math.sin(heading), Math.cos(heading)),
  };
}

/** Consume a complete committed frame; wall time and display frame rate are irrelevant. */
export function advanceRoboticsWorld(
  world: RoboticsWorldDocument,
  state: RoboticsWorldState,
  frame: RoboticsDriveFrame,
): RoboticsWorldState {
  if (state.haltReason) return state;
  if (!Number.isSafeInteger(frame.atMicroseconds) || frame.atMicroseconds < state.atMicroseconds)
    return { ...state, haltReason: 'Время электроники изменилось. Сбросьте запуск робота.' };
  if (!Number.isFinite(frame.leftRpm) || !Number.isFinite(frame.rightRpm))
    return { ...state, haltReason: 'Ядро не предоставило корректные обороты обоих моторов.' };
  if (frame.atMicroseconds > ROBOTICS_RUN_LIMIT_MICROSECONDS)
    return {
      ...state,
      haltReason: 'Завершены 40 секунд модельного времени. Для нового опыта нажмите «Сбросить».',
    };
  if (frame.atMicroseconds === state.atMicroseconds)
    return state.atMicroseconds === 0
      ? { ...state, leftRpm: frame.leftRpm, rightRpm: frame.rightRpm }
      : state;

  const seconds = (frame.atMicroseconds - state.atMicroseconds) / 1_000_000;
  const metresPerRpmSecond = (2 * Math.PI * world.robot.wheelRadiusMeters) / 60;
  const left = ((state.leftRpm + frame.leftRpm) / 2) * metresPerRpmSecond;
  const right = ((state.rightRpm + frame.rightRpm) / 2) * metresPerRpmSecond;
  const velocity = (left + right) / 2;
  const angularVelocity = (right - left) / world.robot.wheelTrackMeters;
  // Finite geometric substeps prevent skipping a 20 mm obstacle. They do not solve motor dynamics.
  const steps = Math.max(
    1,
    Math.ceil(Math.abs(velocity * seconds) / 0.005),
    Math.ceil(Math.abs(angularVelocity * seconds) / 0.02),
  );
  if (!Number.isFinite(steps) || steps > 4096)
    return {
      ...state,
      haltReason: 'Получен слишком большой шаг движения. Сбросьте запуск и проверьте схему.',
    };
  let pose = state.pose;
  let haltReason: string | null = null;
  for (let step = 0; step < steps; step += 1) {
    const candidate = integratePose(pose, velocity, angularVelocity, seconds / steps);
    const collision = findRoboticsCollision(world, candidate);
    if (collision) {
      haltReason = `Контакт: ${collision}. Опыт приостановлен; нагрузка при столкновении в M0 не моделируется.`;
      break;
    }
    pose = candidate;
  }
  const lastTrail = state.trail[state.trail.length - 1];
  const moved =
    !lastTrail ||
    Math.hypot(pose.xMeters - lastTrail.xMeters, pose.yMeters - lastTrail.yMeters) >= 0.005;
  return {
    pose,
    atMicroseconds: frame.atMicroseconds,
    leftRpm: frame.leftRpm,
    rightRpm: frame.rightRpm,
    trail: moved ? [...state.trail.slice(-799), pose] : state.trail,
    haltReason:
      haltReason ??
      (frame.atMicroseconds === ROBOTICS_RUN_LIMIT_MICROSECONDS
        ? 'Завершены 40 секунд модельного времени. Для нового опыта нажмите «Сбросить».'
        : null),
  };
}

function rayRectangle(
  origin: RoboticsPoint,
  dx: number,
  dy: number,
  rectangle: RoboticsRectObstacle,
): number | null {
  let entry = Number.NEGATIVE_INFINITY;
  let exit = Number.POSITIVE_INFINITY;
  for (const [position, direction, minimum, size] of [
    [origin.xMeters, dx, rectangle.xMeters, rectangle.widthMeters],
    [origin.yMeters, dy, rectangle.yMeters, rectangle.heightMeters],
  ]) {
    if (Math.abs(direction) < 1e-12) {
      if (position < minimum || position > minimum + size) return null;
    } else {
      const first = (minimum - position) / direction;
      const second = (minimum + size - position) / direction;
      entry = Math.max(entry, Math.min(first, second));
      exit = Math.min(exit, Math.max(first, second));
    }
  }
  if (exit < Math.max(0, entry)) return null;
  return Math.max(0, entry);
}

/** A single geometric ray, not an acoustic cone or a fabricated no-echo response. */
export function measureRoboticsDistance(
  world: RoboticsWorldDocument,
  pose: RoboticsPose,
): RoboticsDistanceMeasurement {
  if (![pose.xMeters, pose.yMeters, pose.headingRadians].every(Number.isFinite))
    return {
      status: 'invalid',
      message: 'Некорректное положение датчика.',
      origin: null,
      hit: null,
    };
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
  if (
    origin.xMeters < 0 ||
    origin.xMeters > world.field.widthMeters ||
    origin.yMeters < 0 ||
    origin.yMeters > world.field.heightMeters
  )
    return { status: 'invalid', message: 'Датчик находится за границей поля.', origin, hit: null };
  const heading = pose.headingRadians + world.robot.sensorHeadingRadians;
  const dx = Math.cos(heading);
  const dy = Math.sin(heading);
  const candidates: number[] = [];
  if (dx > 1e-12) candidates.push((world.field.widthMeters - origin.xMeters) / dx);
  else if (dx < -1e-12) candidates.push(-origin.xMeters / dx);
  if (dy > 1e-12) candidates.push((world.field.heightMeters - origin.yMeters) / dy);
  else if (dy < -1e-12) candidates.push(-origin.yMeters / dy);
  for (const rectangle of world.field.obstacles) {
    const distance = rayRectangle(origin, dx, dy, rectangle);
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
