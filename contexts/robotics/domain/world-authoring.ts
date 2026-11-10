/** Pure source operations. One gesture/stamp is one validated document replacement. */
import {
  isRoboticsWorldV3,
  nextRoboticsObjectId,
  ROBOTICS_TILE_LIMITS,
  type RoboticsFloorMark,
  type RoboticsObjectKey,
  type RoboticsPoint,
  type RoboticsWorldDocument,
} from './world-document.js';
import { parseRoboticsWorldDocument } from './world.js';

export type RoboticsTileStampKind = 'straight' | 'turn' | 'cross' | 't-junction';
const angle = (value: number): number => Math.atan2(Math.sin(value), Math.cos(value));
// Canonical generated geometry, far below physical precision; never expands parser bounds.
const metres = (value: number): number => Math.round(value * 1e12) / 1e12;
const moved = (point: RoboticsPoint, dx: number, dy: number): RoboticsPoint => ({
  xMeters: metres(point.xMeters + dx),
  yMeters: metres(point.yMeters + dy),
});
const rotated = (point: RoboticsPoint, pivot: RoboticsPoint, radians: number): RoboticsPoint => {
  const x = point.xMeters - pivot.xMeters,
    y = point.yMeters - pivot.yMeters;
  return {
    xMeters: metres(pivot.xMeters + x * Math.cos(radians) - y * Math.sin(radians)),
    yMeters: metres(pivot.yMeters + x * Math.sin(radians) + y * Math.cos(radians)),
  };
};
function checked(world: RoboticsWorldDocument): RoboticsWorldDocument {
  const result = parseRoboticsWorldDocument(world);
  if (!result.ok) throw new Error(result.message);
  return result.world;
}
export function canonicalRoboticsObjectKey(
  world: RoboticsWorldDocument,
  key: RoboticsObjectKey,
): RoboticsObjectKey {
  if (key.startsWith('mark:')) {
    const mark = world.field.floorMarks.find((candidate) => candidate.id === key.slice(5));
    if (mark?.groupId) return `mark-group:${mark.groupId}`;
  }
  return key;
}
function markMatches(mark: RoboticsFloorMark, key: RoboticsObjectKey): boolean {
  return key === `mark:${mark.id}` || (!!mark.groupId && key === `mark-group:${mark.groupId}`);
}
function assertKey(world: RoboticsWorldDocument, input: RoboticsObjectKey): RoboticsObjectKey {
  const key = canonicalRoboticsObjectKey(world, input);
  if (
    key === 'robot' ||
    world.field.obstacles.some((item) => key === `wall:${item.id}`) ||
    world.field.balls.some((item) => key === `ball:${item.id}`) ||
    world.field.bodies?.some((item) => key === `body:${item.id}`) ||
    world.field.visuals?.some((item) => key === `decoration:${item.id}`) ||
    world.field.floorMarks.some((item) => markMatches(item, key))
  )
    return key;
  throw new Error('Предмет больше не существует на поле.');
}
function transformMark(
  mark: RoboticsFloorMark,
  transform: (point: RoboticsPoint) => RoboticsPoint,
): RoboticsFloorMark {
  const group = mark.groupPivot ? { groupPivot: transform(mark.groupPivot) } : {};
  if (mark.kind === 'area') return { ...mark, ...transform(mark), ...group };
  return {
    ...mark,
    start: transform(mark.start),
    end: transform(mark.end),
    ...group,
    ...(mark.kind === 'curve' ? { control: transform(mark.control) } : {}),
  };
}
export function translateRoboticsObject(
  world: RoboticsWorldDocument,
  input: RoboticsObjectKey,
  dx: number,
  dy: number,
): RoboticsWorldDocument {
  if (![dx, dy].every(Number.isFinite)) throw new Error('Смещение должно быть конечным числом.');
  const key = assertKey(world, input);
  const transform = (point: RoboticsPoint): RoboticsPoint => moved(point, dx, dy);
  return checked({
    ...world,
    initialPose:
      key === 'robot'
        ? { ...world.initialPose, ...transform(world.initialPose) }
        : world.initialPose,
    field: {
      ...world.field,
      obstacles: world.field.obstacles.map((item) =>
        key === `wall:${item.id}` ? { ...item, ...transform(item) } : item,
      ),
      balls: world.field.balls.map((item) =>
        key === `ball:${item.id}` ? { ...item, ...transform(item) } : item,
      ),
      ...(world.field.bodies
        ? {
            bodies: world.field.bodies.map((item) =>
              key === `body:${item.id}` ? { ...item, ...transform(item) } : item,
            ),
          }
        : {}),
      floorMarks: world.field.floorMarks.map((mark) =>
        markMatches(mark, key) ? transformMark(mark, transform) : mark,
      ),
      ...(world.field.visuals
        ? {
            visuals: world.field.visuals.map((item) =>
              key === `decoration:${item.id}` ? { ...item, ...transform(item) } : item,
            ),
          }
        : {}),
    },
  });
}
export function rotateRoboticsObject(
  world: RoboticsWorldDocument,
  input: RoboticsObjectKey,
  deltaRadians: number,
): RoboticsWorldDocument {
  if (!Number.isFinite(deltaRadians)) throw new Error('Угол должен быть конечным числом.');
  const key = assertKey(world, input);
  if (key.startsWith('ball:')) throw new Error('Поворот мяча не изменяет его конструкцию.');
  const marks = world.field.floorMarks.filter((mark) => markMatches(mark, key));
  if (marks.some((mark) => mark.kind === 'area'))
    throw new Error('Цветная зона остаётся прямоугольной.');
  const first = marks[0];
  const pivot =
    first && first.kind !== 'area'
      ? (first.groupPivot ?? {
          xMeters: (first.start.xMeters + first.end.xMeters) / 2,
          yMeters: (first.start.yMeters + first.end.yMeters) / 2,
        })
      : null;
  return checked({
    ...world,
    initialPose:
      key === 'robot'
        ? {
            ...world.initialPose,
            headingRadians: angle(world.initialPose.headingRadians + deltaRadians),
          }
        : world.initialPose,
    field: {
      ...world.field,
      obstacles: world.field.obstacles.map((item) =>
        key === `wall:${item.id}`
          ? { ...item, headingRadians: angle((item.headingRadians ?? 0) + deltaRadians) }
          : item,
      ),
      ...(world.field.bodies
        ? {
            bodies: world.field.bodies.map((item) =>
              key === `body:${item.id}`
                ? { ...item, headingRadians: angle(item.headingRadians + deltaRadians) }
                : item,
            ),
          }
        : {}),
      floorMarks: world.field.floorMarks.map((mark) =>
        markMatches(mark, key) && pivot
          ? {
              ...transformMark(mark, (point) => rotated(point, pivot, deltaRadians)),
              ...(mark.groupPivot ? { groupPivot: { ...pivot } } : {}),
            }
          : mark,
      ),
      ...(world.field.visuals
        ? {
            visuals: world.field.visuals.map((item) =>
              key === `decoration:${item.id}`
                ? { ...item, rotationRadians: angle((item.rotationRadians ?? 0) + deltaRadians) }
                : item,
            ),
          }
        : {}),
    },
  });
}
export function removeRoboticsObject(
  world: RoboticsWorldDocument,
  input: RoboticsObjectKey,
): RoboticsWorldDocument {
  const key = assertKey(world, input);
  if (key === 'robot') throw new Error('Робот не удаляется из проекта.');
  return checked({
    ...world,
    field: {
      ...world.field,
      obstacles: world.field.obstacles.filter((item) => key !== `wall:${item.id}`),
      balls: world.field.balls.filter((item) => key !== `ball:${item.id}`),
      ...(world.field.bodies
        ? { bodies: world.field.bodies.filter((item) => key !== `body:${item.id}`) }
        : {}),
      floorMarks: world.field.floorMarks.filter((mark) => !markMatches(mark, key)),
      ...(world.field.visuals
        ? {
            visuals: world.field.visuals.filter((item) => key !== `decoration:${item.id}`),
          }
        : {}),
    },
  });
}
export function duplicateRoboticsObject(
  world: RoboticsWorldDocument,
  input: RoboticsObjectKey,
  offset: RoboticsPoint = { xMeters: 0.1, yMeters: 0.1 },
): { world: RoboticsWorldDocument; key: RoboticsObjectKey } {
  const key = assertKey(world, input);
  if (key === 'robot') throw new Error('На поле может быть только один робот.');
  let next = world;
  let newKey: RoboticsObjectKey;
  if (key.startsWith('wall:')) {
    const item = world.field.obstacles.find((item) => key === `wall:${item.id}`)!;
    const id = nextRoboticsObjectId(world, 'wall');
    next = {
      ...world,
      field: { ...world.field, obstacles: [...world.field.obstacles, { ...item, id }] },
    };
    newKey = `wall:${id}`;
  } else if (key.startsWith('ball:')) {
    const item = world.field.balls.find((item) => key === `ball:${item.id}`)!;
    const id = nextRoboticsObjectId(world, 'ball');
    next = { ...world, field: { ...world.field, balls: [...world.field.balls, { ...item, id }] } };
    newKey = `ball:${id}`;
  } else if (key.startsWith('decoration:')) {
    const item = world.field.visuals!.find((item) => key === `decoration:${item.id}`)!;
    const id = nextRoboticsObjectId(world, 'visual');
    next = {
      ...world,
      field: {
        ...world.field,
        visuals: [...world.field.visuals!, { ...item, id }],
      },
    };
    newKey = `decoration:${id}`;
  } else if (key.startsWith('body:')) {
    const item = world.field.bodies!.find((item) => key === `body:${item.id}`)!;
    const id = nextRoboticsObjectId(world, item.kind);
    next = {
      ...world,
      field: { ...world.field, bodies: [...world.field.bodies!, { ...item, id }] },
    };
    newKey = `body:${id}`;
  } else {
    const sourceMarks = world.field.floorMarks.filter((mark) => markMatches(mark, key));
    const groupId = key.startsWith('mark-group:')
      ? nextRoboticsObjectId(world, 'stamp')
      : undefined;
    newKey = groupId ? `mark-group:${groupId}` : key;
    for (const mark of sourceMarks) {
      const id = nextRoboticsObjectId(next, 'mark');
      const copy = { ...mark, id, ...(groupId ? { groupId } : {}) };
      next = { ...next, field: { ...next.field, floorMarks: [...next.field.floorMarks, copy] } };
      if (!groupId) newKey = `mark:${id}`;
    }
  }
  return {
    world: translateRoboticsObject(next, newKey, offset.xMeters, offset.yMeters),
    key: newKey,
  };
}
export function createRoboticsTileStamp(
  kind: RoboticsTileStampKind,
  world: RoboticsWorldDocument,
  origin: RoboticsPoint,
  quarterTurns: number = 0,
): { world: RoboticsWorldDocument; keys: readonly RoboticsObjectKey[] } {
  if (!isRoboticsWorldV3(world)) throw new Error('Сначала включите расширенное поле.');
  if (!Number.isInteger(quarterTurns) || quarterTurns < 0 || quarterTurns > 3)
    throw new Error('Поворот плитки должен быть 0, 1, 2 или 3.');
  const size = world.field.tiles.sizeMeters;
  const pivot = moved(origin, size / 2, size / 2);
  const groupId = nextRoboticsObjectId(world, 'stamp');
  let result: RoboticsWorldDocument = world;
  const point = (x: number, y: number): RoboticsPoint =>
    rotated(moved(origin, size * x, size * y), pivot, (quarterTurns * Math.PI) / 2);
  const add = (start: RoboticsPoint, end: RoboticsPoint, control?: RoboticsPoint): void => {
    const common = {
      id: nextRoboticsObjectId(result, 'mark'),
      label: 'Плитка трассы',
      groupId,
      groupPivot: pivot,
      start,
      end,
      widthMeters: 0.02,
      color: '#1e293b',
    };
    const mark: RoboticsFloorMark = control
      ? { ...common, kind: 'curve', control }
      : { ...common, kind: 'line' };
    result = {
      ...result,
      field: { ...result.field, floorMarks: [...result.field.floorMarks, mark] },
    };
  };
  if (kind === 'turn') add(point(0, 0.5), point(0.5, 1), point(0.5, 0.5));
  else if (kind === 'straight' || kind === 'cross' || kind === 't-junction') {
    add(point(0, 0.5), point(1, 0.5));
    if (kind === 'cross') add(point(0.5, 0), point(0.5, 1));
    if (kind === 't-junction') add(point(0.5, 0.5), point(0.5, 1));
  } else throw new Error('Неизвестный штамп плитки.');
  return { world: checked(result), keys: [`mark-group:${groupId}`] };
}
export function resizeRoboticsTileField(
  world: RoboticsWorldDocument,
  columns: number,
  rows: number,
): RoboticsWorldDocument {
  if (!isRoboticsWorldV3(world)) throw new Error('Сначала включите расширенное поле.');
  if (
    ![columns, rows].every(
      (value) =>
        Number.isInteger(value) &&
        value >= ROBOTICS_TILE_LIMITS.columns.min &&
        value <= ROBOTICS_TILE_LIMITS.columns.max,
    )
  )
    throw new Error('Число плиток должно быть целым от 1 до 60.');
  const widthMeters = metres(columns * world.field.tiles.sizeMeters);
  const heightMeters = metres(rows * world.field.tiles.sizeMeters);
  // Recenter BEFORE validating the reduced field. A 5m starting pose
  // cannot be validated inside a 1.2m tile field and must never cause
  // an otherwise valid resize to be silently discarded.
  return checked({
    ...world,
    initialPose: {
      ...world.initialPose,
      xMeters: widthMeters / 2,
      yMeters: heightMeters / 2,
    },
    field: {
      ...world.field,
      widthMeters,
      heightMeters,
    },
  });
}
