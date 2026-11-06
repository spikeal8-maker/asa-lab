/** Source scene only: runtime positions and velocities never become saved construction data. */
export interface RoboticsPoint {
  readonly xMeters: number;
  readonly yMeters: number;
}

export interface RoboticsPose extends RoboticsPoint {
  readonly headingRadians: number;
}

/** Lower-left origin before rotation; rotation is about the rectangle's centre. */
export interface RoboticsRectObstacle extends RoboticsPoint {
  readonly id: string;
  readonly label?: string;
  readonly widthMeters: number;
  readonly heightMeters: number;
  readonly headingRadians?: number;
}

/** A translating planar disc, without spin, rolling inertia or vertical motion. */
export interface RoboticsBall extends RoboticsPoint {
  readonly id: string;
  readonly label?: string;
  readonly radiusMeters: number;
  readonly massKg: number;
  /** Coulomb resistance against the floor, not tangential contact friction. */
  readonly frictionCoefficient: number;
  readonly restitution: number;
}

export type RoboticsFloorMark =
  | {
      readonly id: string;
      readonly label?: string;
      readonly kind: 'line';
      readonly start: RoboticsPoint;
      readonly end: RoboticsPoint;
      readonly widthMeters: number;
      readonly color: string;
    }
  | (RoboticsPoint & {
      readonly id: string;
      readonly label?: string;
      readonly kind: 'area';
      readonly widthMeters: number;
      readonly heightMeters: number;
      readonly color: string;
    });

export interface RoboticsWorldDocument {
  readonly physicsProfile: 'kinematic-rover-discs-v1';
  readonly field: {
    readonly widthMeters: number;
    readonly heightMeters: number;
    readonly gridMeters: number;
    readonly obstacles: readonly RoboticsRectObstacle[];
    readonly balls: readonly RoboticsBall[];
    readonly floorMarks: readonly RoboticsFloorMark[];
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

export const ROBOTICS_FIELD_LIMITS = {
  widthMeters: { min: 0.8, max: 2.4 },
  heightMeters: { min: 0.8, max: 2.4 },
  gridMeters: { min: 0.02, max: 0.5 },
} as const;

export const ROBOTICS_BALL_LIMITS = {
  radiusMeters: { min: 0.02, max: 0.25 },
  massKg: { min: 0.01, max: 5 },
  frictionCoefficient: { min: 0, max: 1 },
  restitution: { min: 0, max: 1 },
} as const;

export const ROBOTICS_SCENE_LIMITS = { walls: 24, balls: 12, floorMarks: 48 } as const;

export const ROBOTICS_FIELD_PRESETS = [
  { id: 'compact', label: 'Компактное · 1,2 × 1,2 м', widthMeters: 1.2, heightMeters: 1.2 },
  { id: 'practice', label: 'Учебное · 1,8 × 1,8 м', widthMeters: 1.8, heightMeters: 1.8 },
  { id: 'wide', label: 'Большое · 2,4 × 2,0 м', widthMeters: 2.4, heightMeters: 2 },
] as const;

export type RoboticsFieldPresetId = (typeof ROBOTICS_FIELD_PRESETS)[number]['id'];

export function createRoboticsWall(id: string, position: RoboticsPoint): RoboticsRectObstacle {
  return {
    id,
    label: 'Стена',
    xMeters: position.xMeters,
    yMeters: position.yMeters,
    widthMeters: 0.3,
    heightMeters: 0.05,
    headingRadians: 0,
  };
}

export function createRoboticsBall(id: string, position: RoboticsPoint): RoboticsBall {
  return {
    id,
    label: 'Мяч',
    xMeters: position.xMeters,
    yMeters: position.yMeters,
    radiusMeters: 0.06,
    massKg: 0.05,
    frictionCoefficient: 0.08,
    restitution: 0.65,
  };
}

export function createRoboticsFloorMark(
  kind: RoboticsFloorMark['kind'],
  id: string,
  position: RoboticsPoint,
): RoboticsFloorMark {
  if (kind !== 'line' && kind !== 'area') throw new Error('Неизвестный тип напольной разметки.');
  return kind === 'line'
    ? {
        id,
        label: 'Линия',
        kind,
        start: { xMeters: position.xMeters, yMeters: position.yMeters },
        end: { xMeters: position.xMeters + 0.3, yMeters: position.yMeters },
        widthMeters: 0.02,
        color: '#1e293b',
      }
    : {
        id,
        label: 'Цветная зона',
        kind,
        xMeters: position.xMeters,
        yMeters: position.yMeters,
        widthMeters: 0.3,
        heightMeters: 0.2,
        color: '#60a5fa',
      };
}

export function nextRoboticsObjectId(world: RoboticsWorldDocument, prefix: string): string {
  identifier(prefix, 'тип предмета');
  if (prefix.length > 48) throw new Error('Слишком длинный префикс идентификатора предмета.');
  const occupied = new Set(
    [...world.field.obstacles, ...world.field.balls, ...world.field.floorMarks].map(({ id }) => id),
  );
  for (let index = 1; index <= occupied.size + 1; index += 1) {
    const id = `${prefix}-${index}`;
    if (!occupied.has(id)) return id;
  }
  throw new Error('Не удалось выбрать идентификатор предмета.');
}

export function createRoboticsWorldDocument(
  presetId: RoboticsFieldPresetId = 'practice',
): RoboticsWorldDocument {
  const preset = ROBOTICS_FIELD_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) throw new Error('Неизвестный вариант поля.');
  return {
    physicsProfile: 'kinematic-rover-discs-v1',
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
          headingRadians: 0,
        },
      ],
      balls: [],
      floorMarks: [],
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

function limited(
  value: unknown,
  label: string,
  limits: { readonly min: number; readonly max: number },
): number {
  return bounded(value, label, limits.min, limits.max);
}

function identifier(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.trim() === '' ||
    value.length > 64 ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw new Error(`Некорректный идентификатор: ${label}.`);
  return value;
}

function label(value: unknown): { readonly label?: string } {
  if (value === undefined) return {};
  if (typeof value !== 'string' || value.trim() === '' || value.length > 80)
    throw new Error('Название предмета должно содержать от 1 до 80 символов.');
  return { label: value };
}

function collection(value: unknown, maximum: number, name: string): unknown[] {
  if (!Array.isArray(value) || value.length > maximum)
    throw new Error(`Недопустимый список «${name}»: не более ${maximum} предметов.`);
  return value;
}

/** Structural decoding is separate from the geometric acceptance in the public world facade. */
export function decodeRoboticsWorldDocument(value: unknown): RoboticsWorldDocument {
  const source = record(value, 'поле и робот');
  if (source.physicsProfile !== undefined && source.physicsProfile !== 'kinematic-rover-discs-v1')
    throw new Error('Неизвестный физический профиль поля.');
  const field = record(source.field, 'поле');
  const robot = record(source.robot, 'размеры робота');
  const pose = record(source.initialPose, 'стартовая позиция');
  const bindings = record(source.bindings, 'привязки компонентов');
  const widthMeters = limited(field.widthMeters, 'ширина поля', ROBOTICS_FIELD_LIMITS.widthMeters);
  const heightMeters = limited(
    field.heightMeters,
    'высота поля',
    ROBOTICS_FIELD_LIMITS.heightMeters,
  );
  const diagonal = Math.hypot(widthMeters, heightMeters);
  const ids = new Set<string>();
  const objectId = (value: unknown): string => {
    const id = identifier(value, 'предмет');
    if (ids.has(id)) throw new Error('Идентификаторы предметов поля повторяются.');
    ids.add(id);
    return id;
  };
  const point = (value: unknown, name: string): RoboticsPoint => {
    const position = record(value, name);
    return {
      xMeters: bounded(position.xMeters, `X: ${name}`, 0, widthMeters),
      yMeters: bounded(position.yMeters, `Y: ${name}`, 0, heightMeters),
    };
  };
  const obstacles = collection(field.obstacles, ROBOTICS_SCENE_LIMITS.walls, 'стены').map(
    (value): RoboticsRectObstacle => {
      const obstacle = record(value, 'стена');
      return {
        id: objectId(obstacle.id),
        ...label(obstacle.label),
        xMeters: bounded(obstacle.xMeters, 'X стены', -diagonal, widthMeters),
        yMeters: bounded(obstacle.yMeters, 'Y стены', -diagonal, heightMeters),
        widthMeters: bounded(obstacle.widthMeters, 'ширина стены', 0.02, diagonal),
        heightMeters: bounded(obstacle.heightMeters, 'высота стены', 0.02, diagonal),
        headingRadians: bounded(
          obstacle.headingRadians === undefined ? 0 : obstacle.headingRadians,
          'угол стены',
          -Math.PI,
          Math.PI,
        ),
      };
    },
  );
  const balls = collection(
    field.balls === undefined ? [] : field.balls,
    ROBOTICS_SCENE_LIMITS.balls,
    'мячи',
  ).map((value): RoboticsBall => {
    const ball = record(value, 'мяч');
    return {
      id: objectId(ball.id),
      ...label(ball.label),
      ...point(ball, 'мяч'),
      radiusMeters: limited(ball.radiusMeters, 'радиус мяча', ROBOTICS_BALL_LIMITS.radiusMeters),
      massKg: limited(ball.massKg, 'масса мяча', ROBOTICS_BALL_LIMITS.massKg),
      frictionCoefficient: limited(
        ball.frictionCoefficient,
        'трение мяча',
        ROBOTICS_BALL_LIMITS.frictionCoefficient,
      ),
      restitution: limited(ball.restitution, 'упругость мяча', ROBOTICS_BALL_LIMITS.restitution),
    };
  });
  const floorMarks = collection(
    field.floorMarks === undefined ? [] : field.floorMarks,
    ROBOTICS_SCENE_LIMITS.floorMarks,
    'разметка',
  ).map((value): RoboticsFloorMark => {
    const mark = record(value, 'разметка');
    if (typeof mark.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(mark.color))
      throw new Error('Цвет разметки должен иметь формат #RRGGBB.');
    const common = { id: objectId(mark.id), ...label(mark.label), color: mark.color };
    if (mark.kind === 'line') {
      const start = point(mark.start, 'начало линии');
      const end = point(mark.end, 'конец линии');
      if (Math.hypot(end.xMeters - start.xMeters, end.yMeters - start.yMeters) < 0.02)
        throw new Error('Длина линии должна быть не меньше 2 см.');
      return {
        ...common,
        kind: 'line',
        start,
        end,
        widthMeters: bounded(mark.widthMeters, 'толщина линии', 0.005, 0.2),
      };
    }
    if (mark.kind !== 'area') throw new Error('Неизвестный тип напольной разметки.');
    return {
      ...common,
      kind: 'area',
      ...point(mark, 'цветная зона'),
      widthMeters: bounded(mark.widthMeters, 'ширина зоны', 0.02, widthMeters),
      heightMeters: bounded(mark.heightMeters, 'высота зоны', 0.02, heightMeters),
    };
  });
  const world: RoboticsWorldDocument = {
    physicsProfile: 'kinematic-rover-discs-v1',
    field: {
      widthMeters,
      heightMeters,
      gridMeters: limited(field.gridMeters, 'шаг сетки', ROBOTICS_FIELD_LIMITS.gridMeters),
      obstacles,
      balls,
      floorMarks,
    },
    robot: {
      bodyLengthMeters: bounded(robot.bodyLengthMeters, 'длина шасси', 0.05, 0.5),
      bodyWidthMeters: bounded(robot.bodyWidthMeters, 'ширина шасси', 0.05, 0.5),
      wheelRadiusMeters: bounded(robot.wheelRadiusMeters, 'радиус колеса', 0.01, 0.1),
      wheelWidthMeters: bounded(robot.wheelWidthMeters, 'ширина колеса', 0.005, 0.1),
      wheelTrackMeters: bounded(robot.wheelTrackMeters, 'колея', 0.05, 0.5),
      sensorForwardMeters: bounded(robot.sensorForwardMeters, 'смещение датчика вперёд', -0.3, 0.3),
      sensorLateralMeters: bounded(robot.sensorLateralMeters, 'смещение датчика вбок', -0.3, 0.3),
      sensorHeadingRadians: bounded(robot.sensorHeadingRadians, 'угол датчика', -Math.PI, Math.PI),
    },
    initialPose: {
      ...point(pose, 'стартовая позиция'),
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
  return world;
}
