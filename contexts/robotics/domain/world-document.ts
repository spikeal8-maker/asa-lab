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
  /** V3: floor rolling resistance and tangential object contact are separate. */
  readonly rollingResistanceCoefficient?: number;
  readonly contactFrictionCoefficient?: number;
}

export type RoboticsPhysicsMode = 'educational' | 'dynamic';
export type RoboticsPhysicsAccuracy = 'balanced' | 'precise';
export type RoboticsFieldSurface = 'smooth' | 'wood' | 'carpet';
export interface RoboticsPhysicsParameters {
  readonly accuracy: RoboticsPhysicsAccuracy;
  readonly robotMassKg: number;
  /** Mechanical force limit per wheel; not a second motor/electrical model. */
  readonly maxWheelForceNewton: number;
  readonly tireFrictionCoefficient: number;
}
export interface RoboticsBodyBase extends RoboticsPose {
  readonly id: string;
  readonly label?: string;
  readonly massKg: number;
  /** Physical size metadata; planar dynamics does not model tipping. */
  readonly heightMeters: number;
  readonly slidingFrictionCoefficient: number;
  readonly contactFrictionCoefficient: number;
  readonly restitution: number;
}
export type RoboticsBody = RoboticsBodyBase &
  (
    | { readonly kind: 'can'; readonly radiusMeters: number }
    | { readonly kind: 'box'; readonly widthMeters: number; readonly depthMeters: number }
  );
export interface RoboticsMarkGroup {
  readonly groupId?: string;
  readonly groupPivot?: RoboticsPoint;
}

export type RoboticsFloorMark = RoboticsMarkGroup &
  (
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
      })
    | {
        readonly id: string;
        readonly label?: string;
        readonly kind: 'curve';
        readonly start: RoboticsPoint;
        readonly control: RoboticsPoint;
        readonly end: RoboticsPoint;
        readonly widthMeters: number;
        readonly color: string;
      }
  );
/** Purely visual 2-D annotations. They do not participate in physical collisions. */
export interface RoboticsFieldDecoration extends RoboticsPoint {
  readonly id: string;
  readonly label?: string;
  readonly kind: 'rectangle' | 'circle' | 'text' | 'image';
  readonly widthMeters: number;
  readonly heightMeters: number;
  readonly strokeColor: string;
  readonly fillColor: string;
  readonly fillEnabled: boolean;
  readonly rotationRadians?: number;
  readonly text?: string;
  /** Browser-resized PNG/JPEG/WebP data only; small enough for account project saves. */
  readonly imageData?: string;
}
export type RoboticsCurveMark = Extract<RoboticsFloorMark, { readonly kind: 'curve' }>;
export type RoboticsObjectKey =
  | 'robot'
  | `wall:${string}`
  | `ball:${string}`
  | `body:${string}`
  | `mark:${string}`
  | `mark-group:${string}`
  | `decoration:${string}`;

export interface RoboticsWorldDocument {
  readonly physicsProfile:
    'kinematic-rover-discs-v1' | 'kinematic-rover-bodies-v2' | 'rigid-body-2d-v1';
  readonly physics?: RoboticsPhysicsParameters;
  readonly field: {
    readonly widthMeters: number;
    readonly heightMeters: number;
    readonly gridMeters: number;
    readonly obstacles: readonly RoboticsRectObstacle[];
    readonly balls: readonly RoboticsBall[];
    readonly floorMarks: readonly RoboticsFloorMark[];
    readonly visuals?: readonly RoboticsFieldDecoration[];
    readonly bodies?: readonly RoboticsBody[];
    readonly surface?: RoboticsFieldSurface;
    readonly tiles?: { readonly enabled: boolean; readonly sizeMeters: number };
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

export interface RoboticsWorldV3Document extends RoboticsWorldDocument {
  readonly physicsProfile: 'kinematic-rover-bodies-v2' | 'rigid-body-2d-v1';
  readonly physics: RoboticsPhysicsParameters;
  readonly field: RoboticsWorldDocument['field'] & {
    readonly bodies: readonly RoboticsBody[];
    readonly surface: RoboticsFieldSurface;
    readonly tiles: { readonly enabled: boolean; readonly sizeMeters: number };
  };
}
export function isRoboticsWorldV3(world: RoboticsWorldDocument): world is RoboticsWorldV3Document {
  return (
    world.physicsProfile === 'kinematic-rover-bodies-v2' ||
    world.physicsProfile === 'rigid-body-2d-v1'
  );
}

export const ROBOTICS_FIELD_LIMITS = {
  widthMeters: { min: 0.8, max: 6 },
  heightMeters: { min: 0.8, max: 6 },
  gridMeters: { min: 0.02, max: 0.5 },
} as const;

export const ROBOTICS_BALL_LIMITS = {
  radiusMeters: { min: 0.02, max: 0.25 },
  massKg: { min: 0.01, max: 5 },
  frictionCoefficient: { min: 0, max: 1 },
  restitution: { min: 0, max: 1 },
  rollingResistanceCoefficient: { min: 0, max: 1 },
  contactFrictionCoefficient: { min: 0, max: 1 },
} as const;

export const ROBOTICS_BODY_LIMITS = {
  radiusMeters: { min: 0.02, max: 0.25 },
  widthMeters: { min: 0.02, max: 0.6 },
  depthMeters: { min: 0.02, max: 0.6 },
  heightMeters: { min: 0.01, max: 1 },
  massKg: { min: 0.01, max: 5 },
  slidingFrictionCoefficient: { min: 0, max: 1 },
  contactFrictionCoefficient: { min: 0, max: 1 },
  restitution: { min: 0, max: 1 },
} as const;
export const ROBOTICS_PHYSICS_PARAMETER_LIMITS = {
  robotMassKg: { min: 0.1, max: 5 },
  maxWheelForceNewton: { min: 0.01, max: 10 },
  tireFrictionCoefficient: { min: 0, max: 1 },
} as const;
export const ROBOTICS_TILE_LIMITS = {
  sizeMeters: { min: 0.1, max: 1 },
  columns: { min: 1, max: 60 },
  rows: { min: 1, max: 60 },
} as const;
export const ROBOTICS_FIELD_SURFACES = [
  { id: 'smooth', label: 'Гладкое покрытие', resistanceMultiplier: 0.6, gripMultiplier: 0.65 },
  { id: 'wood', label: 'Деревянное покрытие', resistanceMultiplier: 1, gripMultiplier: 1 },
  { id: 'carpet', label: 'Ковровое покрытие', resistanceMultiplier: 2, gripMultiplier: 1.1 },
] as const;
export const ROBOTICS_ACCURACY_PRESETS = [
  { id: 'balanced', label: 'Обычная', substeps: 2, velocityIterations: 10, positionIterations: 6 },
  {
    id: 'precise',
    label: 'Повышенная',
    substeps: 4,
    velocityIterations: 14,
    positionIterations: 8,
  },
] as const;

export const ROBOTICS_SCENE_LIMITS = {
  walls: 24,
  balls: 12,
  bodies: 12,
  dynamicBodies: 12,
  floorMarks: 48,
  visuals: 32,
} as const;

export const ROBOTICS_FIELD_PRESETS = [
  { id: 'arena', label: 'Основное поле · 5 × 5 м', widthMeters: 5, heightMeters: 5 },
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
    [
      ...world.field.obstacles,
      ...world.field.balls,
      ...(world.field.bodies ?? []),
      ...world.field.floorMarks,
      ...(world.field.visuals ?? []),
    ].map(({ id }) => id),
  );
  for (const mark of world.field.floorMarks) if (mark.groupId) occupied.add(mark.groupId);
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
          // Keep the robot centered and the obstacle in front of its HC-SR04.
          // Compact 1.2-m fields have less than 0.6 m of space ahead of a centered robot.
          xMeters: Math.min(preset.widthMeters - 0.14, preset.widthMeters / 2 + 0.9),
          yMeters: preset.heightMeters / 2 - 0.27,
          widthMeters: 0.08,
          heightMeters: 0.54,
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
    initialPose: {
      xMeters: preset.widthMeters / 2,
      yMeters: preset.heightMeters / 2,
      headingRadians: 0,
    },
    bindings: {
      boardId: 'uno',
      leftMotorId: 'left-motor',
      rightMotorId: 'right-motor',
      distanceSensorId: 'sonar',
    },
  };
}

export function getRoboticsPhysicsMode(world: RoboticsWorldDocument): RoboticsPhysicsMode {
  return world.physicsProfile === 'rigid-body-2d-v1' ? 'dynamic' : 'educational';
}

export function extendRoboticsWorld(
  world: RoboticsWorldDocument,
  mode: RoboticsPhysicsMode = 'educational',
): RoboticsWorldV3Document {
  return {
    ...world,
    physicsProfile: mode === 'dynamic' ? 'rigid-body-2d-v1' : 'kinematic-rover-bodies-v2',
    physics: world.physics ?? {
      accuracy: 'balanced',
      robotMassKg: 0.5,
      maxWheelForceNewton: 0.6,
      tireFrictionCoefficient: 0.55,
    },
    field: {
      ...world.field,
      bodies: world.field.bodies ?? [],
      surface: world.field.surface ?? 'wood',
      tiles: world.field.tiles ?? { enabled: true, sizeMeters: 0.3 },
      balls: world.field.balls.map((ball) => ({
        ...ball,
        rollingResistanceCoefficient: ball.rollingResistanceCoefficient ?? 0.02,
        contactFrictionCoefficient: ball.contactFrictionCoefficient ?? 0.3,
      })),
    },
  };
}

export function createRoboticsWorldV3Document(
  presetId: RoboticsFieldPresetId = 'practice',
  mode: RoboticsPhysicsMode = 'dynamic',
): RoboticsWorldV3Document {
  return extendRoboticsWorld(createRoboticsWorldDocument(presetId), mode);
}

export function setRoboticsPhysicsMode(
  world: RoboticsWorldDocument,
  mode: RoboticsPhysicsMode,
): RoboticsWorldV3Document {
  if (!isRoboticsWorldV3(world)) throw new Error('Сначала включите расширенное поле.');
  if (mode !== 'educational' && mode !== 'dynamic') throw new Error('Неизвестный режим физики.');
  return extendRoboticsWorld(world, mode);
}

export function createRoboticsBody(
  kind: RoboticsBody['kind'],
  id: string,
  position: RoboticsPoint,
): RoboticsBody {
  const common = {
    id,
    ...position,
    headingRadians: 0,
    contactFrictionCoefficient: 0.35,
    restitution: 0.1,
  };
  if (kind === 'can')
    return {
      ...common,
      kind,
      label: 'Металлическая банка',
      radiusMeters: 0.033,
      heightMeters: 0.115,
      massKg: 0.04,
      slidingFrictionCoefficient: 0.35,
    };
  if (kind === 'box')
    return {
      ...common,
      kind,
      label: 'Кубик',
      widthMeters: 0.03,
      depthMeters: 0.03,
      heightMeters: 0.03,
      massKg: 0.02,
      slidingFrictionCoefficient: 0.3,
    };
  throw new Error('Неизвестный предмет.');
}

export function createRoboticsCurve(id: string, position: RoboticsPoint): RoboticsCurveMark {
  return {
    id,
    label: 'Плавный поворот',
    kind: 'curve',
    start: { ...position },
    control: { xMeters: position.xMeters + 0.3, yMeters: position.yMeters },
    end: { xMeters: position.xMeters + 0.3, yMeters: position.yMeters + 0.3 },
    widthMeters: 0.02,
    color: '#1e293b',
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
  if (
    source.physicsProfile !== undefined &&
    !['kinematic-rover-discs-v1', 'kinematic-rover-bodies-v2', 'rigid-body-2d-v1'].includes(
      String(source.physicsProfile),
    )
  )
    throw new Error('Неизвестный физический профиль поля.');
  const extended =
    source.physicsProfile === 'kinematic-rover-bodies-v2' ||
    source.physicsProfile === 'rigid-body-2d-v1';
  const field = record(source.field, 'поле');
  const robot = record(source.robot, 'размеры робота');
  const pose = record(source.initialPose, 'стартовая позиция');
  const bindings = record(source.bindings, 'привязки компонентов');
  const widthMeters = bounded(field.widthMeters, 'ширина поля', 0.8, extended ? 6 : 2.4);
  const heightMeters = limited(field.heightMeters, 'высота поля', {
    min: 0.8,
    max: extended ? 6 : 2.4,
  });
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
      ...(extended
        ? {
            rollingResistanceCoefficient: limited(
              ball.rollingResistanceCoefficient ?? 0.02,
              'сопротивление качению',
              ROBOTICS_BALL_LIMITS.rollingResistanceCoefficient,
            ),
            contactFrictionCoefficient: limited(
              ball.contactFrictionCoefficient ?? 0.3,
              'контактное трение',
              ROBOTICS_BALL_LIMITS.contactFrictionCoefficient,
            ),
          }
        : {}),
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
    let group: RoboticsMarkGroup = {};
    if (extended && (mark.groupId !== undefined || mark.groupPivot !== undefined)) {
      if (mark.kind !== 'line' && mark.kind !== 'curve')
        throw new Error('Штамп состоит из линий и кривых.');
      group = {
        groupId: identifier(mark.groupId, 'штамп'),
        groupPivot: point(mark.groupPivot, 'центр штампа'),
      };
    }
    const common = { id: objectId(mark.id), ...label(mark.label), color: mark.color, ...group };
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
    if (extended && mark.kind === 'curve') {
      const start = point(mark.start, 'начало кривой');
      const control = point(mark.control, 'точка поворота');
      const end = point(mark.end, 'конец кривой');
      if (Math.hypot(start.xMeters - end.xMeters, start.yMeters - end.yMeters) < 0.02)
        throw new Error('Концы кривой должны быть разделены минимум на 2 см.');
      return {
        ...common,
        kind: 'curve',
        start,
        control,
        end,
        widthMeters: bounded(mark.widthMeters, 'толщина кривой', 0.005, 0.2),
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
  const visuals =
    field.visuals === undefined
      ? undefined
      : collection(field.visuals, ROBOTICS_SCENE_LIMITS.visuals, 'рисунки и изображения').map(
          (value): RoboticsFieldDecoration => {
            const visual = record(value, 'графический элемент');
            if (!['rectangle', 'circle', 'text', 'image'].includes(String(visual.kind)))
              throw new Error('Неизвестный тип графического элемента.');
            const kind = visual.kind as RoboticsFieldDecoration['kind'];
            const shape = {
              id: objectId(visual.id),
              ...label(visual.label),
              kind,
              ...point(visual, 'графический элемент'),
              widthMeters: bounded(visual.widthMeters, 'ширина элемента', 0.02, widthMeters),
              heightMeters: bounded(visual.heightMeters, 'высота элемента', 0.02, heightMeters),
              strokeColor: String(visual.strokeColor),
              fillColor: String(visual.fillColor),
              fillEnabled: visual.fillEnabled === true,
              rotationRadians: bounded(
                visual.rotationRadians ?? 0,
                'поворот элемента',
                -Math.PI,
                Math.PI,
              ),
            };
            if (
              !/^#[0-9a-fA-F]{6}$/.test(shape.strokeColor) ||
              !/^#[0-9a-fA-F]{6}$/.test(shape.fillColor) ||
              typeof visual.fillEnabled !== 'boolean'
            )
              throw new Error('Некорректные параметры цвета или заливки.');
            if (
              shape.xMeters + shape.widthMeters > widthMeters + 1e-8 ||
              shape.yMeters + shape.heightMeters > heightMeters + 1e-8
            )
              throw new Error('Графический элемент выходит за границы поля.');
            if (kind === 'circle' && Math.abs(shape.widthMeters - shape.heightMeters) > 1e-8)
              throw new Error('Для окружности ширина и высота должны совпадать.');
            if (kind === 'text') {
              if (
                typeof visual.text !== 'string' ||
                visual.text.trim().length === 0 ||
                visual.text.length > 120 ||
                Array.from(visual.text).some((character) => {
                  const code = character.charCodeAt(0);
                  return code <= 8 || code === 11 || (code >= 14 && code <= 31);
                })
              )
                throw new Error('Надпись должна содержать от 1 до 120 символов.');
              return { ...shape, text: visual.text };
            }
            if (kind === 'image') {
              if (
                typeof visual.imageData !== 'string' ||
                visual.imageData.length > 240_000 ||
                !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
                  visual.imageData,
                )
              )
                throw new Error('Картинка должна быть PNG, JPEG или WebP до 180 КБ.');
              return { ...shape, imageData: visual.imageData };
            }
            return shape;
          },
        );
  const embeddedImageLength =
    visuals?.reduce((sum, visual) => sum + (visual.imageData?.length ?? 0), 0) ?? 0;
  if (embeddedImageLength > 480_000)
    throw new Error('Общий размер картинок поля превышает 360 КБ. Уменьшите изображения.');
  const bodies: RoboticsBody[] = extended
    ? collection(field.bodies, ROBOTICS_SCENE_LIMITS.bodies, 'предметы').map((value) => {
        const body = record(value, 'предмет');
        const common: RoboticsBodyBase = {
          id: objectId(body.id),
          ...label(body.label),
          ...point(body, 'предмет'),
          headingRadians: bounded(body.headingRadians, 'угол предмета', -Math.PI, Math.PI),
          heightMeters: limited(
            body.heightMeters,
            'высота предмета',
            ROBOTICS_BODY_LIMITS.heightMeters,
          ),
          massKg: limited(body.massKg, 'масса предмета', ROBOTICS_BODY_LIMITS.massKg),
          slidingFrictionCoefficient: limited(
            body.slidingFrictionCoefficient,
            'трение скольжения',
            ROBOTICS_BODY_LIMITS.slidingFrictionCoefficient,
          ),
          contactFrictionCoefficient: limited(
            body.contactFrictionCoefficient,
            'контактное трение',
            ROBOTICS_BODY_LIMITS.contactFrictionCoefficient,
          ),
          restitution: limited(body.restitution, 'упругость', ROBOTICS_BODY_LIMITS.restitution),
        };
        if (body.kind === 'can')
          return {
            ...common,
            kind: 'can',
            radiusMeters: limited(
              body.radiusMeters,
              'радиус банки',
              ROBOTICS_BODY_LIMITS.radiusMeters,
            ),
          };
        if (body.kind === 'box')
          return {
            ...common,
            kind: 'box',
            widthMeters: limited(
              body.widthMeters,
              'ширина бруска',
              ROBOTICS_BODY_LIMITS.widthMeters,
            ),
            depthMeters: limited(
              body.depthMeters,
              'глубина бруска',
              ROBOTICS_BODY_LIMITS.depthMeters,
            ),
          };
        throw new Error('Неизвестный тип предмета.');
      })
    : [];
  if (extended && balls.length + bodies.length > ROBOTICS_SCENE_LIMITS.dynamicBodies)
    throw new Error('На поле допускается не более 12 подвижных предметов.');
  const groups = new Map<string, RoboticsPoint>();
  for (const mark of floorMarks)
    if (mark.groupId && mark.groupPivot) {
      if (ids.has(mark.groupId)) throw new Error('Идентификатор штампа совпадает с предметом.');
      const previous = groups.get(mark.groupId);
      if (
        previous &&
        (previous.xMeters !== mark.groupPivot.xMeters ||
          previous.yMeters !== mark.groupPivot.yMeters)
      )
        throw new Error('Части штампа должны иметь общий центр.');
      groups.set(mark.groupId, mark.groupPivot);
    }
  let physics: RoboticsPhysicsParameters | undefined;
  let extraField: Partial<RoboticsWorldV3Document['field']> = {};
  if (extended) {
    const parameters = record(source.physics, 'параметры физики');
    if (parameters.accuracy !== 'balanced' && parameters.accuracy !== 'precise')
      throw new Error('Неизвестная точность физики.');
    physics = {
      accuracy: parameters.accuracy,
      robotMassKg: limited(
        parameters.robotMassKg,
        'масса робота',
        ROBOTICS_PHYSICS_PARAMETER_LIMITS.robotMassKg,
      ),
      maxWheelForceNewton: limited(
        parameters.maxWheelForceNewton,
        'тяга колеса',
        ROBOTICS_PHYSICS_PARAMETER_LIMITS.maxWheelForceNewton,
      ),
      tireFrictionCoefficient: limited(
        parameters.tireFrictionCoefficient,
        'сцепление колёс',
        ROBOTICS_PHYSICS_PARAMETER_LIMITS.tireFrictionCoefficient,
      ),
    };
    if (!ROBOTICS_FIELD_SURFACES.some((surface) => surface.id === field.surface))
      throw new Error('Неизвестное покрытие поля.');
    const tiles = record(field.tiles, 'плитки');
    if (typeof tiles.enabled !== 'boolean') throw new Error('Некорректная видимость плиток.');
    extraField = {
      bodies,
      surface: field.surface as RoboticsFieldSurface,
      tiles: {
        enabled: tiles.enabled,
        sizeMeters: limited(tiles.sizeMeters, 'сторона плитки', ROBOTICS_TILE_LIMITS.sizeMeters),
      },
    };
  }
  const world: RoboticsWorldDocument = {
    physicsProfile: extended
      ? (source.physicsProfile as RoboticsWorldV3Document['physicsProfile'])
      : 'kinematic-rover-discs-v1',
    ...(physics ? { physics } : {}),
    field: {
      widthMeters,
      heightMeters,
      gridMeters: limited(field.gridMeters, 'шаг сетки', ROBOTICS_FIELD_LIMITS.gridMeters),
      obstacles,
      balls,
      floorMarks,
      ...(visuals ? { visuals } : {}),
      ...extraField,
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
