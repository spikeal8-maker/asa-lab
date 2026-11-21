import type { RoboticsBody, RoboticsPoint, RoboticsWorldV3Document } from './world-document.js';
import {
  circleRectangle,
  rectangleBoundaryGap,
  rectangleGap,
  robotRectangle,
  wallRectangle,
  validateRoboticsWorldGeometry,
  type Rectangle,
} from './world-physics.js';

type Shape =
  | { readonly kind: 'circle'; readonly point: RoboticsPoint; readonly radius: number }
  | { readonly kind: 'rect'; readonly rectangle: Rectangle };
export function roboticsBodyRectangle(body: Extract<RoboticsBody, { kind: 'box' }>): Rectangle {
  return wallRectangle({
    id: body.id,
    xMeters: body.xMeters - body.widthMeters / 2,
    yMeters: body.yMeters - body.depthMeters / 2,
    widthMeters: body.widthMeters,
    heightMeters: body.depthMeters,
    headingRadians: body.headingRadians,
  });
}
function bodyShape(body: RoboticsBody): Shape {
  return body.kind === 'can'
    ? { kind: 'circle', point: body, radius: body.radiusMeters }
    : { kind: 'rect', rectangle: roboticsBodyRectangle(body) };
}
function gap(first: Shape, second: Shape): number {
  if (first.kind === 'rect' && second.kind === 'rect')
    return rectangleGap(first.rectangle, second.rectangle);
  if (first.kind === 'circle' && second.kind === 'rect')
    return circleRectangle(first.point, first.radius, second.rectangle).gap;
  if (first.kind === 'rect' && second.kind === 'circle')
    return circleRectangle(second.point, second.radius, first.rectangle).gap;
  if (first.kind === 'circle' && second.kind === 'circle')
    return (
      Math.hypot(
        first.point.xMeters - second.point.xMeters,
        first.point.yMeters - second.point.yMeters,
      ) -
      first.radius -
      second.radius
    );
  return Infinity;
}
/** The new renderer clips paint strokes to the field. Control points stay inside its convex bounds. */
export function validateRoboticsWorldV3Geometry(world: RoboticsWorldV3Document): string | null {
  const legacyGeometry = validateRoboticsWorldGeometry({
    ...world,
    field: { ...world.field, floorMarks: [] },
  });
  if (legacyGeometry) return legacyGeometry;
  for (const mark of world.field.floorMarks)
    if (
      mark.kind === 'area' &&
      (mark.xMeters + mark.widthMeters > world.field.widthMeters + 1e-8 ||
        mark.yMeters + mark.heightMeters > world.field.heightMeters + 1e-8)
    )
      return 'Цветная зона выходит за границы поля.';
  const occupied: Shape[] = [
    { kind: 'rect', rectangle: robotRectangle(world, world.initialPose) },
    ...world.field.obstacles.map((wall) => ({
      kind: 'rect' as const,
      rectangle: wallRectangle(wall),
    })),
    ...world.field.balls.map((ball) => ({
      kind: 'circle' as const,
      point: ball,
      radius: ball.radiusMeters,
    })),
  ];
  for (const body of world.field.bodies) {
    const shape = bodyShape(body);
    const boundary =
      shape.kind === 'rect'
        ? rectangleBoundaryGap(world, shape.rectangle)
        : Math.min(
            body.xMeters - shape.radius,
            body.yMeters - shape.radius,
            world.field.widthMeters - body.xMeters - shape.radius,
            world.field.heightMeters - body.yMeters - shape.radius,
          );
    if (boundary < -1e-8) return `Предмет «${body.label ?? body.id}» выходит за границы поля.`;
    if (occupied.some((other) => gap(shape, other) < -1e-8))
      return `Предмет «${body.label ?? body.id}» пересекает другое тело.`;
    occupied.push(shape);
  }
  return null;
}
