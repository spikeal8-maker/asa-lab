import type {
  RoboticsBall,
  RoboticsPoint,
  RoboticsPose,
  RoboticsRectObstacle,
  RoboticsWorldDocument,
} from './world-document.js';

export interface RoboticsBallState extends RoboticsPoint {
  readonly id: string;
  readonly velocityXMetersPerSecond: number;
  readonly velocityYMetersPerSecond: number;
}

export interface RoboticsDriveVelocity {
  readonly linearMetersPerSecond: number;
  readonly angularRadiansPerSecond: number;
}

export const ROBOTICS_PHYSICS_LIMITS = {
  stepMicroseconds: 5_000,
  ballSpeedMetersPerSecond: 50,
  wheelSpeedMetersPerSecond: 5,
  angularRadiansPerSecond: 40,
  eventsPerStep: 256,
  iterationsPerAdvance: 32_768,
} as const;

const CONTACT_EPSILON = 1e-8;
const CONTACT_SKIN = 1e-5;
const VELOCITY_EPSILON = 1e-10;
const TIME_EPSILON = 1e-12;
const GRAVITY = 9.81;
const CONTACT_PASSES = 16;

interface Rectangle {
  readonly x: number;
  readonly y: number;
  readonly halfX: number;
  readonly halfY: number;
  readonly angle: number;
}

interface Contact {
  readonly gap: number;
  readonly nx: number;
  readonly ny: number;
  readonly point: RoboticsPoint;
}

interface MovingBall {
  readonly source: RoboticsBall;
  xMeters: number;
  yMeters: number;
  velocityXMetersPerSecond: number;
  velocityYMetersPerSecond: number;
}

function byId<T extends { readonly id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function wallRectangle(wall: RoboticsRectObstacle): Rectangle {
  return {
    x: wall.xMeters + wall.widthMeters / 2,
    y: wall.yMeters + wall.heightMeters / 2,
    halfX: wall.widthMeters / 2,
    halfY: wall.heightMeters / 2,
    angle: wall.headingRadians ?? 0,
  };
}

function robotRectangle(world: RoboticsWorldDocument, pose: RoboticsPose): Rectangle {
  return {
    x: pose.xMeters,
    y: pose.yMeters,
    halfX: Math.max(world.robot.bodyLengthMeters / 2, world.robot.wheelRadiusMeters),
    halfY: Math.max(
      world.robot.bodyWidthMeters / 2,
      (world.robot.wheelTrackMeters + world.robot.wheelWidthMeters) / 2,
    ),
    angle: pose.headingRadians,
  };
}

function axes(rectangle: Rectangle): readonly (readonly [number, number])[] {
  const c = Math.cos(rectangle.angle);
  const s = Math.sin(rectangle.angle);
  return [
    [c, s],
    [-s, c],
  ];
}

function projectionRadius(rectangle: Rectangle, x: number, y: number): number {
  const [u, v] = axes(rectangle);
  return (
    rectangle.halfX * Math.abs(x * u[0] + y * u[1]) +
    rectangle.halfY * Math.abs(x * v[0] + y * v[1])
  );
}

/** A positive separating-axis gap is a conservative lower bound on Euclidean separation. */
function rectangleGap(first: Rectangle, second: Rectangle): number {
  let gap = Number.NEGATIVE_INFINITY;
  for (const [x, y] of [...axes(first), ...axes(second)])
    gap = Math.max(
      gap,
      Math.abs((first.x - second.x) * x + (first.y - second.y) * y) -
        projectionRadius(first, x, y) -
        projectionRadius(second, x, y),
    );
  return gap;
}

function rectangleBoundaryGap(world: RoboticsWorldDocument, rectangle: Rectangle): number {
  const ex = projectionRadius(rectangle, 1, 0);
  const ey = projectionRadius(rectangle, 0, 1);
  return Math.min(
    rectangle.x - ex,
    world.field.widthMeters - rectangle.x - ex,
    rectangle.y - ey,
    world.field.heightMeters - rectangle.y - ey,
  );
}

function circleRectangle(point: RoboticsPoint, radius: number, rectangle: Rectangle): Contact {
  const c = Math.cos(rectangle.angle);
  const s = Math.sin(rectangle.angle);
  const dx = point.xMeters - rectangle.x;
  const dy = point.yMeters - rectangle.y;
  const x = dx * c + dy * s;
  const y = -dx * s + dy * c;
  let qx = Math.max(-rectangle.halfX, Math.min(rectangle.halfX, x));
  let qy = Math.max(-rectangle.halfY, Math.min(rectangle.halfY, y));
  const distance = Math.hypot(x - qx, y - qy);
  let nx: number;
  let ny: number;
  let gap: number;
  if (distance > 1e-15) {
    nx = (x - qx) / distance;
    ny = (y - qy) / distance;
    gap = distance - radius;
  } else if (rectangle.halfX - Math.abs(x) <= rectangle.halfY - Math.abs(y)) {
    nx = x >= 0 ? 1 : -1;
    ny = 0;
    qx = nx * rectangle.halfX;
    gap = -(rectangle.halfX - Math.abs(x)) - radius;
  } else {
    nx = 0;
    ny = y >= 0 ? 1 : -1;
    qy = ny * rectangle.halfY;
    gap = -(rectangle.halfY - Math.abs(y)) - radius;
  }
  return {
    gap,
    nx: nx * c - ny * s,
    ny: nx * s + ny * c,
    point: { xMeters: rectangle.x + qx * c - qy * s, yMeters: rectangle.y + qx * s + qy * c },
  };
}

export function findRoboticsCollision(
  world: RoboticsWorldDocument,
  pose: RoboticsPose,
): string | null {
  if (![pose.xMeters, pose.yMeters, pose.headingRadians].every(Number.isFinite))
    return 'некорректное положение робота';
  const robot = robotRectangle(world, pose);
  if (rectangleBoundaryGap(world, robot) <= 0) return 'граница поля';
  for (const wall of [...world.field.obstacles].sort(byId))
    if (rectangleGap(robot, wallRectangle(wall)) <= 0) return `препятствие «${wall.id}»`;
  return null;
}

function ballBoundaryGap(
  world: RoboticsWorldDocument,
  point: RoboticsPoint,
  radius: number,
): number {
  return Math.min(
    point.xMeters - radius,
    point.yMeters - radius,
    world.field.widthMeters - point.xMeters - radius,
    world.field.heightMeters - point.yMeters - radius,
  );
}

/** Validates complete physical/stroke extents; never clips, translates or deletes source objects. */
export function validateRoboticsWorldGeometry(world: RoboticsWorldDocument): string | null {
  for (const wall of world.field.obstacles)
    if (rectangleBoundaryGap(world, wallRectangle(wall)) < -CONTACT_EPSILON)
      return `Стена «${wall.label ?? wall.id}» выходит за границы поля с учётом поворота.`;
  if (findRoboticsCollision(world, world.initialPose))
    return 'Стартовое положение робота пересекает стену или препятствие.';
  const robot = robotRectangle(world, world.initialPose);
  for (let index = 0; index < world.field.balls.length; index += 1) {
    const ball = world.field.balls[index];
    if (ballBoundaryGap(world, ball, ball.radiusMeters) < -CONTACT_EPSILON)
      return `Мяч «${ball.label ?? ball.id}» выходит за границы поля.`;
    if (circleRectangle(ball, ball.radiusMeters, robot).gap < -CONTACT_EPSILON)
      return `Мяч «${ball.label ?? ball.id}» пересекает стартовое положение робота.`;
    if (
      world.field.obstacles.some(
        (wall) =>
          circleRectangle(ball, ball.radiusMeters, wallRectangle(wall)).gap < -CONTACT_EPSILON,
      )
    )
      return `Мяч «${ball.label ?? ball.id}» пересекает стену.`;
    for (const other of world.field.balls.slice(index + 1))
      if (
        Math.hypot(ball.xMeters - other.xMeters, ball.yMeters - other.yMeters) <
        ball.radiusMeters + other.radiusMeters - CONTACT_EPSILON
      )
        return 'Начальные положения мячей пересекаются.';
  }
  for (const mark of world.field.floorMarks) {
    const outside =
      mark.kind === 'line'
        ? [mark.start, mark.end].some(
            (point) => ballBoundaryGap(world, point, mark.widthMeters / 2) < -CONTACT_EPSILON,
          )
        : mark.xMeters + mark.widthMeters > world.field.widthMeters + CONTACT_EPSILON ||
          mark.yMeters + mark.heightMeters > world.field.heightMeters + CONTACT_EPSILON;
    if (outside)
      return `Разметка «${mark.label ?? mark.id}» выходит за границы поля с учётом толщины.`;
  }
  return null;
}

export function createRoboticsBallStates(
  world: RoboticsWorldDocument,
): readonly RoboticsBallState[] {
  return [...world.field.balls].sort(byId).map((ball) => ({
    id: ball.id,
    xMeters: ball.xMeters,
    yMeters: ball.yMeters,
    velocityXMetersPerSecond: 0,
    velocityYMetersPerSecond: 0,
  }));
}

/** Exact constant differential-drive twist; wheel speed already includes the electrical gearbox. */
export function integrateRoboticsPose(
  pose: RoboticsPose,
  drive: RoboticsDriveVelocity,
  seconds: number,
): RoboticsPose {
  const velocity = drive.linearMetersPerSecond;
  const angular = drive.angularRadiansPerSecond;
  const heading = pose.headingRadians + angular * seconds;
  const straight = Math.abs(angular) < 1e-10;
  return {
    xMeters:
      pose.xMeters +
      (straight
        ? velocity * seconds * Math.cos(pose.headingRadians)
        : (velocity / angular) * (Math.sin(heading) - Math.sin(pose.headingRadians))),
    yMeters:
      pose.yMeters +
      (straight
        ? velocity * seconds * Math.sin(pose.headingRadians)
        : (velocity / angular) * (Math.cos(pose.headingRadians) - Math.cos(heading))),
    headingRadians: Math.atan2(Math.sin(heading), Math.cos(heading)),
  };
}

export function roboticsContactPointVelocity(
  pose: RoboticsPose,
  drive: RoboticsDriveVelocity,
  point: RoboticsPoint,
): { readonly xMetersPerSecond: number; readonly yMetersPerSecond: number } {
  return {
    xMetersPerSecond:
      drive.linearMetersPerSecond * Math.cos(pose.headingRadians) -
      drive.angularRadiansPerSecond * (point.yMeters - pose.yMeters),
    yMetersPerSecond:
      drive.linearMetersPerSecond * Math.sin(pose.headingRadians) +
      drive.angularRadiansPerSecond * (point.xMeters - pose.xMeters),
  };
}

function circleSweep(
  x: number,
  y: number,
  vx: number,
  vy: number,
  radius: number,
  limit: number,
): number | null {
  const speedSquared = vx * vx + vy * vy;
  const approach = x * vx + y * vy;
  // A resolved inelastic tangent may retain a round-off-sized negative normal speed.
  // It cannot close CONTACT_EPSILON within this bounded tick and must not create a zero-time loop.
  if (
    speedSquared < VELOCITY_EPSILON ** 2 ||
    approach >= -VELOCITY_EPSILON * Math.max(radius, Math.hypot(x, y))
  )
    return null;
  const c = x * x + y * y - radius * radius;
  const discriminant = approach * approach - speedSquared * c;
  if (discriminant < 0) return null;
  // The equivalent quotient avoids subtracting two nearly equal positive values at contact.
  const time = c <= 0 ? 0 : c / (-approach + Math.sqrt(discriminant));
  return time >= 0 && time <= limit ? time : null;
}

/** Exact swept disc against the four faces and rounded corners of an oriented rectangle. */
function circleWallSweep(
  ball: RoboticsPoint,
  vx: number,
  vy: number,
  radius: number,
  rectangle: Rectangle,
  limit: number,
): number | null {
  const c = Math.cos(rectangle.angle);
  const s = Math.sin(rectangle.angle);
  const x = (ball.xMeters - rectangle.x) * c + (ball.yMeters - rectangle.y) * s;
  const y = -(ball.xMeters - rectangle.x) * s + (ball.yMeters - rectangle.y) * c;
  const ux = vx * c + vy * s;
  const uy = -vx * s + vy * c;
  let earliest = Number.POSITIVE_INFINITY;
  for (const sign of [-1, 1]) {
    if (ux * sign < -VELOCITY_EPSILON) {
      const time = (sign * (rectangle.halfX + radius) - x) / ux;
      if (time >= 0 && time <= limit && Math.abs(y + uy * time) <= rectangle.halfY)
        earliest = Math.min(earliest, time);
    }
    if (uy * sign < -VELOCITY_EPSILON) {
      const time = (sign * (rectangle.halfY + radius) - y) / uy;
      if (time >= 0 && time <= limit && Math.abs(x + ux * time) <= rectangle.halfX)
        earliest = Math.min(earliest, time);
    }
    for (const otherSign of [-1, 1]) {
      const qx = sign * rectangle.halfX;
      const qy = otherSign * rectangle.halfY;
      const time = circleSweep(x - qx, y - qy, ux, uy, radius, limit);
      if (
        time !== null &&
        sign * (x + ux * time - qx) >= -CONTACT_EPSILON &&
        otherSign * (y + uy * time - qy) >= -CONTACT_EPSILON
      )
        earliest = Math.min(earliest, time);
    }
  }
  return Number.isFinite(earliest) ? earliest : null;
}

function rectangleSweep(
  first: Rectangle,
  second: Rectangle,
  vx: number,
  vy: number,
  limit: number,
): number | null {
  let enter = 0;
  let leave = limit;
  for (const [x, y] of [...axes(first), ...axes(second)]) {
    const position = (first.x - second.x) * x + (first.y - second.y) * y;
    const speed = vx * x + vy * y;
    const radius = projectionRadius(first, x, y) + projectionRadius(second, x, y);
    if (Math.abs(speed) < VELOCITY_EPSILON) {
      if (Math.abs(position) > radius) return null;
    } else {
      const a = (-radius - position) / speed;
      const b = (radius - position) / speed;
      enter = Math.max(enter, Math.min(a, b));
      leave = Math.min(leave, Math.max(a, b));
      if (enter > leave) return null;
    }
  }
  return leave >= 0 && enter <= limit ? enter : null;
}

function boundaryContacts(world: RoboticsWorldDocument, ball: MovingBall): readonly Contact[] {
  const radius = ball.source.radiusMeters;
  return [
    { gap: ball.xMeters - radius, nx: 1, ny: 0, point: { xMeters: 0, yMeters: ball.yMeters } },
    {
      gap: world.field.widthMeters - ball.xMeters - radius,
      nx: -1,
      ny: 0,
      point: { xMeters: world.field.widthMeters, yMeters: ball.yMeters },
    },
    { gap: ball.yMeters - radius, nx: 0, ny: 1, point: { xMeters: ball.xMeters, yMeters: 0 } },
    {
      gap: world.field.heightMeters - ball.yMeters - radius,
      nx: 0,
      ny: -1,
      point: { xMeters: ball.xMeters, yMeters: world.field.heightMeters },
    },
  ];
}

function contactImpulse(
  ball: MovingBall,
  contact: Contact,
  surfaceX: number,
  surfaceY: number,
  movingSurface: boolean,
): boolean {
  if (contact.gap > CONTACT_EPSILON) return false;
  const relative =
    (ball.velocityXMetersPerSecond - surfaceX) * contact.nx +
    (ball.velocityYMetersPerSecond - surfaceY) * contact.ny;
  let changed = false;
  if (relative < -VELOCITY_EPSILON) {
    const impulsePerMass = -(1 + ball.source.restitution) * relative;
    ball.velocityXMetersPerSecond += impulsePerMass * contact.nx;
    ball.velocityYMetersPerSecond += impulsePerMass * contact.ny;
    changed = true;
  }
  if (contact.gap < -CONTACT_EPSILON || (movingSurface && changed)) {
    const correction = (movingSurface ? CONTACT_SKIN : 0) - contact.gap;
    ball.xMeters += correction * contact.nx;
    ball.yMeters += correction * contact.ny;
    changed = true;
  }
  return changed;
}

function pairImpulse(first: MovingBall, second: MovingBall): boolean {
  const dx = second.xMeters - first.xMeters;
  const dy = second.yMeters - first.yMeters;
  const distance = Math.hypot(dx, dy);
  const gap = distance - first.source.radiusMeters - second.source.radiusMeters;
  if (gap > CONTACT_EPSILON) return false;
  const nx = distance > 1e-15 ? dx / distance : 1;
  const ny = distance > 1e-15 ? dy / distance : 0;
  const relative =
    (second.velocityXMetersPerSecond - first.velocityXMetersPerSecond) * nx +
    (second.velocityYMetersPerSecond - first.velocityYMetersPerSecond) * ny;
  const inverseFirst = 1 / first.source.massKg;
  const inverseSecond = 1 / second.source.massKg;
  const inverseSum = inverseFirst + inverseSecond;
  let changed = false;
  if (relative < -VELOCITY_EPSILON) {
    const impulse =
      (-(1 + Math.min(first.source.restitution, second.source.restitution)) * relative) /
      inverseSum;
    first.velocityXMetersPerSecond -= impulse * inverseFirst * nx;
    first.velocityYMetersPerSecond -= impulse * inverseFirst * ny;
    second.velocityXMetersPerSecond += impulse * inverseSecond * nx;
    second.velocityYMetersPerSecond += impulse * inverseSecond * ny;
    changed = true;
  }
  if (gap < -CONTACT_EPSILON) {
    first.xMeters += ((gap * inverseFirst) / inverseSum) * nx;
    first.yMeters += ((gap * inverseFirst) / inverseSum) * ny;
    second.xMeters -= ((gap * inverseSecond) / inverseSum) * nx;
    second.yMeters -= ((gap * inverseSecond) / inverseSum) * ny;
    changed = true;
  }
  return changed;
}

function solveContacts(
  world: RoboticsWorldDocument,
  pose: RoboticsPose,
  drive: RoboticsDriveVelocity,
  balls: MovingBall[],
  walls: readonly Rectangle[],
): boolean {
  const robot = robotRectangle(world, pose);
  for (let pass = 0; pass < CONTACT_PASSES; pass += 1) {
    let changed = false;
    for (const ball of balls) {
      for (const contact of boundaryContacts(world, ball))
        changed = contactImpulse(ball, contact, 0, 0, false) || changed;
      for (const wall of walls)
        changed =
          contactImpulse(
            ball,
            circleRectangle(ball, ball.source.radiusMeters, wall),
            0,
            0,
            false,
          ) || changed;
      const contact = circleRectangle(ball, ball.source.radiusMeters, robot);
      const velocity = roboticsContactPointVelocity(pose, drive, contact.point);
      changed =
        contactImpulse(ball, contact, velocity.xMetersPerSecond, velocity.yMetersPerSecond, true) ||
        changed;
    }
    for (let first = 0; first < balls.length; first += 1)
      for (let second = first + 1; second < balls.length; second += 1)
        changed = pairImpulse(balls[first], balls[second]) || changed;
    if (!changed) return true;
  }
  return false;
}

function friction(ball: MovingBall, seconds: number): void {
  const speed = Math.hypot(ball.velocityXMetersPerSecond, ball.velocityYMetersPerSecond);
  if (speed === 0) return;
  const remaining = Math.max(0, speed - ball.source.frictionCoefficient * GRAVITY * seconds);
  ball.velocityXMetersPerSecond *= remaining / speed;
  ball.velocityYMetersPerSecond *= remaining / speed;
}

function movingBallState(ball: MovingBall): RoboticsBallState {
  return {
    id: ball.source.id,
    xMeters: ball.xMeters,
    yMeters: ball.yMeters,
    velocityXMetersPerSecond: ball.velocityXMetersPerSecond,
    velocityYMetersPerSecond: ball.velocityYMetersPerSecond,
  };
}

export function validateRoboticsBallStates(
  world: RoboticsWorldDocument,
  pose: RoboticsPose,
  states: readonly RoboticsBallState[],
): string | null {
  if (!Array.isArray(states) || states.length !== world.field.balls.length)
    return 'Набор подвижных предметов не соответствует исходной сцене.';
  const definitions = new Map(world.field.balls.map((ball) => [ball.id, ball]));
  const ids = new Set<string>();
  const robot = robotRectangle(world, pose);
  for (const state of states) {
    if (!state || ids.has(state.id)) return 'Некорректные идентификаторы подвижных предметов.';
    ids.add(state.id);
    const ball = definitions.get(state.id);
    if (
      !ball ||
      ![
        state.xMeters,
        state.yMeters,
        state.velocityXMetersPerSecond,
        state.velocityYMetersPerSecond,
      ].every(Number.isFinite)
    )
      return 'Некорректное состояние подвижного предмета.';
    if (
      Math.hypot(state.velocityXMetersPerSecond, state.velocityYMetersPerSecond) >
      ROBOTICS_PHYSICS_LIMITS.ballSpeedMetersPerSecond
    )
      return 'Скорость предмета превышает предел физического профиля (50 м/с).';
  }
  for (let index = 0; index < states.length; index += 1) {
    const state = states[index];
    const ball = definitions.get(state.id)!;
    if (
      ballBoundaryGap(world, state, ball.radiusMeters) < -CONTACT_EPSILON ||
      circleRectangle(state, ball.radiusMeters, robot).gap < -CONTACT_EPSILON ||
      world.field.obstacles.some(
        (wall) =>
          circleRectangle(state, ball.radiusMeters, wallRectangle(wall)).gap < -CONTACT_EPSILON,
      )
    )
      return 'Подвижный предмет пересекает неподвижное тело.';
    for (const other of states.slice(index + 1)) {
      const otherBall = definitions.get(other.id);
      if (
        otherBall &&
        Math.hypot(state.xMeters - other.xMeters, state.yMeters - other.yMeters) <
          ball.radiusMeters + otherBall.radiusMeters - CONTACT_EPSILON
      )
        return 'Подвижные предметы пересекаются.';
    }
  }
  return null;
}

export interface RoboticsPhysicsStep {
  readonly pose: RoboticsPose;
  readonly balls: readonly RoboticsBallState[];
  readonly haltReason: string | null;
  readonly iterations: number;
}

/**
 * One bounded physical tick. Constant ball flights use swept faces/corners and pairs;
 * turning chassis use conservative advancement with a bound on every surface point's speed.
 * Friction is split into two half-kicks (no spin). A failed tick commits nothing.
 */
export function stepRoboticsPhysics(
  world: RoboticsWorldDocument,
  initialPose: RoboticsPose,
  initialBalls: readonly RoboticsBallState[],
  drive: RoboticsDriveVelocity,
  seconds: number,
  iterationBudget: number = ROBOTICS_PHYSICS_LIMITS.eventsPerStep,
): RoboticsPhysicsStep {
  let iterations = 0;
  const fail = (message: string): RoboticsPhysicsStep => ({
    pose: initialPose,
    balls: initialBalls,
    haltReason: message,
    iterations,
  });
  if (
    ![seconds, drive.linearMetersPerSecond, drive.angularRadiansPerSecond].every(Number.isFinite) ||
    !Number.isSafeInteger(iterationBudget) ||
    iterationBudget < 1 ||
    seconds <= 0 ||
    seconds > ROBOTICS_PHYSICS_LIMITS.stepMicroseconds / 1_000_000 ||
    Math.abs(drive.linearMetersPerSecond) > ROBOTICS_PHYSICS_LIMITS.wheelSpeedMetersPerSecond ||
    Math.abs(drive.angularRadiansPerSecond) > ROBOTICS_PHYSICS_LIMITS.angularRadiansPerSecond
  )
    return fail('Скорость или шаг движения превышает предел физического профиля.');
  const initialCollision = findRoboticsCollision(world, initialPose);
  const invalid = validateRoboticsBallStates(world, initialPose, initialBalls);
  if (initialCollision || invalid) return fail(invalid ?? `Контакт: ${initialCollision}.`);
  const states = new Map(initialBalls.map((ball) => [ball.id, ball]));
  const balls: MovingBall[] = [...world.field.balls].sort(byId).map((source) => {
    const state = states.get(source.id)!;
    return {
      source,
      xMeters: state.xMeters,
      yMeters: state.yMeters,
      velocityXMetersPerSecond: state.velocityXMetersPerSecond,
      velocityYMetersPerSecond: state.velocityYMetersPerSecond,
    };
  });
  const walls = [...world.field.obstacles].sort(byId).map(wallRectangle);
  for (const ball of balls) friction(ball, seconds / 2);
  let pose = initialPose;
  let remaining = seconds;
  const contactHalt =
    'Контакт: предмет зажат или движение не удалось безопасно разрешить. Опыт приостановлен; обратная нагрузка на мотор не моделируется.';
  const staticHalt =
    'Контакт: стена или граница поля. Опыт приостановлен; обратная нагрузка на мотор не моделируется.';
  while (remaining > TIME_EPSILON) {
    iterations += 1;
    if (iterations > Math.min(ROBOTICS_PHYSICS_LIMITS.eventsPerStep, iterationBudget))
      return fail(contactHalt);
    if (!solveContacts(world, pose, drive, balls, walls)) return fail(contactHalt);
    const robot = robotRectangle(world, pose);
    const cx = drive.linearMetersPerSecond * Math.cos(pose.headingRadians);
    const cy = drive.linearMetersPerSecond * Math.sin(pose.headingRadians);
    const angular = Math.abs(drive.angularRadiansPerSecond);
    const radius = Math.hypot(robot.halfX, robot.halfY);
    const surfaceSpeed = Math.abs(drive.linearMetersPerSecond) + angular * radius;
    // Finish positional corrections before calculating any swept flight certificate:
    // a later correction could invalidate an earlier wall/pair time of impact.
    if (angular >= 1e-10) {
      let separated = false;
      for (const ball of balls) {
        const contact = circleRectangle(ball, ball.source.radiusMeters, robot);
        const speedBound =
          Math.hypot(ball.velocityXMetersPerSecond - cx, ball.velocityYMetersPerSecond - cy) +
          angular * (radius + Math.abs(drive.linearMetersPerSecond) * remaining);
        if (contact.gap <= CONTACT_EPSILON && speedBound > VELOCITY_EPSILON) {
          ball.xMeters += (CONTACT_SKIN - contact.gap) * contact.nx;
          ball.yMeters += (CONTACT_SKIN - contact.gap) * contact.ny;
          separated = true;
        }
      }
      if (separated && validateRoboticsBallStates(world, pose, balls.map(movingBallState)))
        return fail(contactHalt);
    }
    let next = remaining;
    if (angular < 1e-10) {
      for (const wall of walls)
        if (rectangleSweep(robot, wall, cx, cy, remaining) !== null) return fail(staticHalt);
      const candidate = integrateRoboticsPose(pose, drive, remaining);
      if (rectangleBoundaryGap(world, robotRectangle(world, candidate)) <= 0)
        return fail(staticHalt);
    } else if (surfaceSpeed > 0) {
      let gap = rectangleBoundaryGap(world, robot);
      for (const wall of walls) gap = Math.min(gap, rectangleGap(robot, wall));
      if (gap <= CONTACT_EPSILON) return fail(staticHalt);
      next = Math.min(next, (gap / surfaceSpeed) * 0.95);
    }
    for (let index = 0; index < balls.length; index += 1) {
      const ball = balls[index];
      const vx = ball.velocityXMetersPerSecond;
      const vy = ball.velocityYMetersPerSecond;
      if (
        !Number.isFinite(vx) ||
        !Number.isFinite(vy) ||
        Math.hypot(vx, vy) > ROBOTICS_PHYSICS_LIMITS.ballSpeedMetersPerSecond
      )
        return fail('Скорость предмета превышает предел физического профиля (50 м/с).');
      for (const contact of boundaryContacts(world, ball)) {
        const normalSpeed = vx * contact.nx + vy * contact.ny;
        if (normalSpeed < -VELOCITY_EPSILON)
          next = Math.min(next, Math.max(0, contact.gap) / -normalSpeed);
      }
      for (const wall of walls) {
        const time = circleWallSweep(ball, vx, vy, ball.source.radiusMeters, wall, remaining);
        if (time !== null) next = Math.min(next, time);
      }
      if (angular < 1e-10) {
        const time = circleWallSweep(
          ball,
          vx - cx,
          vy - cy,
          ball.source.radiusMeters,
          robot,
          remaining,
        );
        if (time !== null) next = Math.min(next, time);
      } else {
        const contact = circleRectangle(ball, ball.source.radiusMeters, robot);
        const speedBound =
          Math.hypot(vx - cx, vy - cy) +
          angular * (radius + Math.abs(drive.linearMetersPerSecond) * remaining);
        if (speedBound > VELOCITY_EPSILON) {
          next = Math.min(next, (contact.gap / speedBound) * 0.95);
        }
      }
      for (const other of balls.slice(index + 1)) {
        const time = circleSweep(
          other.xMeters - ball.xMeters,
          other.yMeters - ball.yMeters,
          other.velocityXMetersPerSecond - vx,
          other.velocityYMetersPerSecond - vy,
          ball.source.radiusMeters + other.source.radiusMeters,
          remaining,
        );
        if (time !== null) next = Math.min(next, time);
      }
    }
    if (!Number.isFinite(next) || next <= TIME_EPSILON) return fail(contactHalt);
    const candidate = integrateRoboticsPose(pose, drive, next);
    if (findRoboticsCollision(world, candidate)) return fail(staticHalt);
    pose = candidate;
    for (const ball of balls) {
      ball.xMeters += ball.velocityXMetersPerSecond * next;
      ball.yMeters += ball.velocityYMetersPerSecond * next;
    }
    remaining = Math.max(0, remaining - next);
  }
  if (!solveContacts(world, pose, drive, balls, walls)) return fail(contactHalt);
  for (const ball of balls) friction(ball, seconds / 2);
  const result = balls.map(movingBallState);
  if (validateRoboticsBallStates(world, pose, result)) return fail(contactHalt);
  return { pose, balls: result, haltReason: null, iterations };
}

export function roboticsRayWall(
  origin: RoboticsPoint,
  dx: number,
  dy: number,
  wall: RoboticsRectObstacle,
): number | null {
  const rectangle = wallRectangle(wall);
  const c = Math.cos(rectangle.angle);
  const s = Math.sin(rectangle.angle);
  let entry = Number.NEGATIVE_INFINITY;
  let exit = Number.POSITIVE_INFINITY;
  for (const [position, direction, half] of [
    [
      (origin.xMeters - rectangle.x) * c + (origin.yMeters - rectangle.y) * s,
      dx * c + dy * s,
      rectangle.halfX,
    ],
    [
      -(origin.xMeters - rectangle.x) * s + (origin.yMeters - rectangle.y) * c,
      -dx * s + dy * c,
      rectangle.halfY,
    ],
  ]) {
    if (Math.abs(direction) < 1e-12) {
      if (position < -half || position > half) return null;
    } else {
      const first = (-half - position) / direction;
      const second = (half - position) / direction;
      entry = Math.max(entry, Math.min(first, second));
      exit = Math.min(exit, Math.max(first, second));
    }
  }
  return exit < Math.max(0, entry) ? null : Math.max(0, entry);
}

export function roboticsRayBall(
  origin: RoboticsPoint,
  dx: number,
  dy: number,
  point: RoboticsPoint,
  radius: number,
): number | null {
  const x = origin.xMeters - point.xMeters;
  const y = origin.yMeters - point.yMeters;
  const squared = x * x + y * y - radius * radius;
  if (squared <= 0) return 0;
  const projection = x * dx + y * dy;
  const discriminant = projection * projection - squared;
  if (discriminant < 0 || projection >= 0) return null;
  return squared / (-projection + Math.sqrt(discriminant));
}
