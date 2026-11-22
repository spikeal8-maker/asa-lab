import type { RoboticsPoint, RoboticsWorldDocument } from '@asa-lab/robotics/world-document';

export type FieldResizeHandle = 'start' | 'end' | 'control' | 'radius';
export type FieldResizeKind = 'mark' | 'decoration' | 'wall' | 'ball' | 'body';

const bounded = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value * 10000) / 10000));

/** One pointer gesture produces one new source scene; no new simulation model. */
export function resizeRoboticsFieldHandle(
  world: RoboticsWorldDocument,
  kind: FieldResizeKind,
  id: string,
  handle: FieldResizeHandle,
  position: RoboticsPoint,
): RoboticsWorldDocument {
  if (!Number.isFinite(position.xMeters) || !Number.isFinite(position.yMeters))
    throw new Error('Некорректная точка изменения размера.');
  const w = world.field.widthMeters,
    h = world.field.heightMeters;
  const point = {
    xMeters: bounded(position.xMeters, 0, w),
    yMeters: bounded(position.yMeters, 0, h),
  };
  if (kind === 'mark') {
    const marks = world.field.floorMarks.map((mark) => {
      if (mark.id !== id) return mark;
      if (mark.kind === 'line' || mark.kind === 'curve') {
        if (handle === 'start') return { ...mark, start: point };
        if (handle === 'end') return { ...mark, end: point };
        if (mark.kind === 'curve' && handle === 'control') return { ...mark, control: point };
        return mark;
      }
      const right = mark.xMeters + mark.widthMeters;
      const top = mark.yMeters + mark.heightMeters;
      if (handle === 'start') {
        const x = bounded(point.xMeters, 0, right - 0.02);
        const y = bounded(point.yMeters, 0, top - 0.02);
        return { ...mark, xMeters: x, yMeters: y, widthMeters: right - x, heightMeters: top - y };
      }
      if (handle === 'end')
        return {
          ...mark,
          widthMeters: bounded(point.xMeters - mark.xMeters, 0.02, w - mark.xMeters),
          heightMeters: bounded(point.yMeters - mark.yMeters, 0.02, h - mark.yMeters),
        };
      return mark;
    });
    return { ...world, field: { ...world.field, floorMarks: marks } };
  }
  if (kind === 'decoration') {
    return {
      ...world,
      field: {
        ...world.field,
        visuals: (world.field.visuals ?? []).map((item) => {
          if (item.id !== id) return item;
          const right = item.xMeters + item.widthMeters;
          const top = item.yMeters + item.heightMeters;
          if (handle === 'start') {
            const x = bounded(point.xMeters, 0, right - 0.02);
            const y = bounded(point.yMeters, 0, top - 0.02);
            const size =
              item.kind === 'circle' ? Math.max(0.02, Math.min(right - x, top - y)) : null;
            return {
              ...item,
              xMeters: x,
              yMeters: y,
              widthMeters: size ?? right - x,
              heightMeters: size ?? top - y,
            };
          }
          if (handle === 'end') {
            const width = bounded(point.xMeters - item.xMeters, 0.02, w - item.xMeters);
            const height = bounded(point.yMeters - item.yMeters, 0.02, h - item.yMeters);
            const size = item.kind === 'circle' ? Math.max(0.02, Math.min(width, height)) : null;
            return {
              ...item,
              widthMeters: size ?? width,
              heightMeters: size ?? height,
            };
          }
          return item;
        }),
      },
    };
  }
  if (kind === 'wall')
    return {
      ...world,
      field: {
        ...world.field,
        obstacles: world.field.obstacles.map((wall) => {
          if (wall.id !== id) return wall;
          const right = wall.xMeters + wall.widthMeters;
          const top = wall.yMeters + wall.heightMeters;
          if (handle === 'start') {
            const x = bounded(point.xMeters, 0, right - 0.02);
            const y = bounded(point.yMeters, 0, top - 0.02);
            return {
              ...wall,
              xMeters: x,
              yMeters: y,
              widthMeters: right - x,
              heightMeters: top - y,
            };
          }
          if (handle === 'end')
            return {
              ...wall,
              widthMeters: bounded(point.xMeters - wall.xMeters, 0.02, w - wall.xMeters),
              heightMeters: bounded(point.yMeters - wall.yMeters, 0.02, h - wall.yMeters),
            };
          return wall;
        }),
      },
    };
  if (kind === 'ball')
    return {
      ...world,
      field: {
        ...world.field,
        balls: world.field.balls.map((ball) =>
          ball.id === id && handle === 'radius'
            ? {
                ...ball,
                radiusMeters: bounded(
                  Math.hypot(point.xMeters - ball.xMeters, point.yMeters - ball.yMeters),
                  0.02,
                  Math.min(0.25, ball.xMeters, ball.yMeters, w - ball.xMeters, h - ball.yMeters),
                ),
              }
            : ball,
        ),
      },
    };
  if (kind === 'body')
    return {
      ...world,
      field: {
        ...world.field,
        bodies: (world.field.bodies ?? []).map((body) => {
          if (body.id !== id || handle !== 'radius') return body;
          if (body.kind === 'can')
            return {
              ...body,
              radiusMeters: bounded(
                Math.hypot(point.xMeters - body.xMeters, point.yMeters - body.yMeters),
                0.02,
                Math.min(0.25, body.xMeters, body.yMeters, w - body.xMeters, h - body.yMeters),
              ),
            };
          return {
            ...body,
            widthMeters: bounded(
              Math.abs(point.xMeters - body.xMeters) * 2,
              0.02,
              Math.min(0.6, body.xMeters * 2, (w - body.xMeters) * 2),
            ),
            depthMeters: bounded(
              Math.abs(point.yMeters - body.yMeters) * 2,
              0.02,
              Math.min(0.6, body.yMeters * 2, (h - body.yMeters) * 2),
            ),
          };
        }),
      },
    };
  throw new Error('Некорректный тип векторного элемента.');
}
