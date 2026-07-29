import { HALF_PITCH_UNITS } from './workbench-scale';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function snap(value: number, grid = HALF_PITCH_UNITS): number {
  return Math.round(value / grid) * grid;
}

export function roundedOrthogonalPath(points: readonly Point[], radius = 12): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);
  const toward = (from: Point, to: Point, amount: number): Point => {
    const d = distance(from, to);
    if (d === 0) return to;
    const ratio = clamp(amount / d, 0, 1);
    return { x: to.x + (from.x - to.x) * ratio, y: to.y + (from.y - to.y) * ratio };
  };

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1] as Point;
    const current = points[index] as Point;
    const next = points[index + 1] as Point | undefined;
    if (!next) {
      path += ` L ${current.x} ${current.y}`;
      continue;
    }
    const corner = Math.min(radius, distance(previous, current) / 2, distance(current, next) / 2);
    const entry = toward(previous, current, corner);
    const exit = toward(next, current, corner);
    path += ` L ${entry.x} ${entry.y} Q ${current.x} ${current.y} ${exit.x} ${exit.y}`;
  }
  return path;
}

export function defaultWirePoints(from: Point, to: Point): Point[] {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  if (dx >= dy) {
    const midX = snap((from.x + to.x) / 2);
    return [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];
  }
  const midY = snap((from.y + to.y) / 2);
  return [from, { x: from.x, y: midY }, { x: to.x, y: midY }, to];
}

export function wirePoints(from: Point, to: Point, vertices?: readonly Point[]): Point[] {
  if (vertices && vertices.length > 0) return [from, ...vertices, to];
  return defaultWirePoints(from, to);
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function viewportViewBox(
  viewport: Viewport,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: viewport.x,
    y: viewport.y,
    width: width / viewport.zoom,
    height: height / viewport.zoom,
  };
}

/** Mathematical fallback used when the browser cannot expose an SVG CTM. */
export function clientToWorld(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
): Point {
  const box = viewportViewBox(viewport, canvasWidth, canvasHeight);
  return {
    x: box.x + ((clientX - rect.left) / rect.width) * box.width,
    y: box.y + ((clientY - rect.top) / rect.height) * box.height,
  };
}

/**
 * Convert a browser pointer into the actual SVG user coordinate system. This
 * remains correct with responsive letterboxing, zoom and `preserveAspectRatio`,
 * unlike a raw DOM-rectangle ratio.
 */
export function clientToSvgWorld(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  fallback: () => Point,
): Point {
  const matrix = svg.getScreenCTM();
  if (!matrix) return fallback();
  try {
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const world = point.matrixTransform(matrix.inverse());
    if (Number.isFinite(world.x) && Number.isFinite(world.y)) {
      return { x: world.x, y: world.y };
    }
  } catch {
    // JSDOM and older embedded browsers may not expose an invertible CTM.
  }
  return fallback();
}

export function fitViewport(
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null,
  canvasWidth: number,
  canvasHeight: number,
  padding = 90,
): Viewport {
  if (!bounds) return { x: 0, y: 0, zoom: 1 };
  const width = Math.max(160, bounds.maxX - bounds.minX + padding * 2);
  const height = Math.max(120, bounds.maxY - bounds.minY + padding * 2);
  const zoom = clamp(Math.min(canvasWidth / width, canvasHeight / height), 0.35, 2.5);
  const visibleWidth = canvasWidth / zoom;
  const visibleHeight = canvasHeight / zoom;
  return {
    x: bounds.minX - padding - (visibleWidth - width) / 2,
    y: bounds.minY - padding - (visibleHeight - height) / 2,
    zoom,
  };
}
