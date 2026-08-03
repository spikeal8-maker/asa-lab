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

export function snap(value: number, grid = 10): number {
  return Math.round(value / grid) * grid;
}

export function roundedWirePath(points: readonly Point[], radius = 12): string {
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

export function lockOrthogonalPoint(anchor: Point, point: Point): Point {
  const snapped = { x: snap(point.x), y: snap(point.y) };
  return Math.abs(snapped.x - anchor.x) >= Math.abs(snapped.y - anchor.y)
    ? { x: snapped.x, y: anchor.y }
    : { x: anchor.x, y: snapped.y };
}

export function lockOrthogonalBend(previous: Point, next: Point, point: Point): Point {
  const snapped = { x: snap(point.x), y: snap(point.y) };
  const candidates = [
    { x: previous.x, y: next.y },
    { x: next.x, y: previous.y },
  ];
  return candidates.reduce((closest, candidate) => {
    const closestDistance = Math.hypot(closest.x - snapped.x, closest.y - snapped.y);
    const candidateDistance = Math.hypot(candidate.x - snapped.x, candidate.y - snapped.y);
    return candidateDistance < closestDistance ? candidate : closest;
  });
}

export function freeWirePoint(point: Point): Point {
  return { x: snap(point.x), y: snap(point.y) };
}

export function magneticWirePoint(anchor: Point, point: Point, threshold = 10): Point {
  const snapped = freeWirePoint(point);
  const horizontalDistance = Math.abs(snapped.y - anchor.y);
  const verticalDistance = Math.abs(snapped.x - anchor.x);
  if (horizontalDistance <= threshold && horizontalDistance <= verticalDistance) {
    return { x: snapped.x, y: anchor.y };
  }
  if (verticalDistance <= threshold) {
    return { x: anchor.x, y: snapped.y };
  }
  return snapped;
}

export function completeOrthogonalRoute(
  start: Point,
  target: Point,
  vertices: readonly Point[],
): readonly Point[] {
  const anchor = vertices[vertices.length - 1] ?? start;
  const elbow = lockOrthogonalPoint(anchor, target);
  const isAnchor = elbow.x === anchor.x && elbow.y === anchor.y;
  const isTarget = elbow.x === target.x && elbow.y === target.y;
  return isAnchor || isTarget ? vertices : [...vertices, elbow];
}

export function wirePoints(from: Point, to: Point, vertices?: readonly Point[]): Point[] {
  if (vertices !== undefined) {
    return [from, ...vertices, to];
  }
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
