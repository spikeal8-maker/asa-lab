export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export type WireAssistAxis = 'horizontal' | 'vertical';

export interface WireAssistResult {
  readonly axis: WireAssistAxis | null;
  readonly point: Point;
}

export type WireVertexAssistTarget = 'previous-x-next-y' | 'next-x-previous-y';

export interface WireVertexAssistResult {
  readonly target: WireVertexAssistTarget | null;
  readonly point: Point;
}

export const WIRE_ASSIST_MIN_DISTANCE_PX = 24;
export const WIRE_ASSIST_ENTER_DEVIATION_PX = 6;
export const WIRE_ASSIST_EXIT_DEVIATION_PX = 10;
export const WIRE_ASSIST_ENTER_ANGLE_DEG = 3;
export const WIRE_ASSIST_EXIT_ANGLE_DEG = 5;

export const TERMINAL_MARKER_SIZE = 8;
export const TERMINAL_HIT_RADIUS = 9;
export const TERMINAL_TOUCH_HIT_RADIUS = 14;
export const WIRE_ENDPOINT_VISIBLE_RADIUS = 4;
export const WIRE_ENDPOINT_HIT_RADIUS = 9;
export const WIRE_ENDPOINT_TOUCH_HIT_RADIUS = 14;
export const WIRE_VERTEX_ASSIST_ENTER_DISTANCE_PX = 8;
export const WIRE_VERTEX_ASSIST_EXIT_DISTANCE_PX = 12;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function potentiometerWiperPosition(
  center: Point,
  point: Point,
  componentRotation = 0,
): number {
  let angle =
    (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI + 90 - componentRotation;
  while (angle > 180) angle -= 360;
  while (angle < -180) angle += 360;
  return clamp((clamp(angle, -135, 135) + 135) / 270, 0, 1);
}

export interface DiagnosticBadgeGeometry {
  readonly radius: number;
  readonly fontSize: number;
  readonly textBaseline: number;
  readonly screenDiameter: number;
}

export interface StageReadoutGeometry {
  readonly fontSize: number;
  readonly gap: number;
  readonly screenFontSize: number;
}

/** Neutral calculated values shrink with the circuit down to a readable 7 px floor. */
export function stageReadoutGeometry(zoom: number): StageReadoutGeometry {
  const safeZoom = Math.max(0.01, zoom);
  const screenFontSize = clamp(12 * safeZoom, 7, 12);
  const screenGap = clamp(8 * safeZoom, 4, 8);
  return {
    fontSize: screenFontSize / safeZoom,
    gap: screenGap / safeZoom,
    screenFontSize,
  };
}

/**
 * Diagnostic badges follow the circuit while zooming out, then stop shrinking
 * at a 7 px readable floor. Above 100% they stop growing at 18 px. Returned
 * values are SVG world units, so every component uses exactly the same rule.
 */
export function diagnosticBadgeGeometry(zoom: number): DiagnosticBadgeGeometry {
  const safeZoom = Math.max(0.01, zoom);
  const screenRadius = clamp(9 * safeZoom, 3.5, 9);
  return {
    radius: screenRadius / safeZoom,
    fontSize: (screenRadius * 4) / 3 / safeZoom,
    textBaseline: (screenRadius * 4) / 9 / safeZoom,
    screenDiameter: screenRadius * 2,
  };
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

/**
 * Soft assistance for an existing bend. Unlike the removed pair of independent
 * axis magnets, this resolver chooses between the two complete canonical
 * elbows. One target is held until the wider exit corridor is crossed; on the
 * sample that exits, no competing target may take over.
 *
 * previous/next/pointer are CSS-pixel coordinates. The controller commits the
 * corresponding exact world-space elbow after this resolver selects it.
 */
export function resolveWireVertexAssist(
  previous: Point,
  next: Point,
  pointer: Point,
  currentTarget: WireVertexAssistTarget | null,
  disabled = false,
): WireVertexAssistResult {
  if (disabled) return { target: null, point: pointer };

  const candidates: Record<WireVertexAssistTarget, Point> = {
    'previous-x-next-y': { x: previous.x, y: next.y },
    'next-x-previous-y': { x: next.x, y: previous.y },
  };

  if (currentTarget) {
    const candidate = candidates[currentTarget];
    return Math.hypot(pointer.x - candidate.x, pointer.y - candidate.y) <=
      WIRE_VERTEX_ASSIST_EXIT_DISTANCE_PX
      ? { target: currentTarget, point: candidate }
      : { target: null, point: pointer };
  }

  const ranked = (Object.entries(candidates) as Array<[WireVertexAssistTarget, Point]>)
    .map(([target, point]) => ({
      target,
      point,
      distance: Math.hypot(pointer.x - point.x, pointer.y - point.y),
    }))
    .sort((a, b) => a.distance - b.distance || a.target.localeCompare(b.target));
  const nearest = ranked[0];
  return nearest && nearest.distance <= WIRE_VERTEX_ASSIST_ENTER_DISTANCE_PX
    ? { target: nearest.target, point: nearest.point }
    : { target: null, point: pointer };
}

/** A wire point placed by hand, outside the 90° mode.
 *
 * Free routing is deliberately not grid-rounded. The stored endpoint follows
 * the same world coordinate produced by the pointer transform; only explicit
 * 90° routing is allowed to quantize an intermediate bend.
 */
export function freeWirePoint(point: Point): Point {
  return { x: point.x, y: point.y };
}

function assistAngleDegrees(primary: number, transverse: number): number {
  return (
    (Math.atan2(Math.abs(transverse), Math.max(Math.abs(primary), Number.EPSILON)) * 180) / Math.PI
  );
}

/**
 * Legacy pure geometry helper retained for older document-level regression tests.
 * The live routing controller no longer calls this function; R1 uses
 * resolveWireAssist in CSS-pixel space with hysteresis instead.
 */
export function magneticWirePoint(anchor: Point, point: Point, threshold = 10): Point {
  const horizontalDistance = Math.abs(point.y - anchor.y);
  const verticalDistance = Math.abs(point.x - anchor.x);
  if (horizontalDistance <= threshold && horizontalDistance <= verticalDistance) {
    return { x: point.x, y: anchor.y };
  }
  if (verticalDistance <= threshold) {
    return { x: anchor.x, y: point.y };
  }
  return point;
}

/**
 * Resolve the optional H/V drafting aid entirely in CSS-pixel space.
 *
 * currentAxis provides hysteresis: an active axis is held until its wider
 * exit corridor is crossed, and an axis that exits is not replaced by the
 * other axis on the same sample. This prevents horizontal/vertical flicker.
 */
export function resolveWireAssist(
  anchor: Point,
  pointer: Point,
  currentAxis: WireAssistAxis | null,
  disabled = false,
): WireAssistResult {
  if (disabled) return { axis: null, point: pointer };

  const dx = pointer.x - anchor.x;
  const dy = pointer.y - anchor.y;
  const distance = Math.hypot(dx, dy);
  if (distance < WIRE_ASSIST_MIN_DISTANCE_PX) return { axis: null, point: pointer };

  const horizontalDeviation = Math.abs(dy);
  const verticalDeviation = Math.abs(dx);
  const horizontalAngle = assistAngleDegrees(dx, dy);
  const verticalAngle = assistAngleDegrees(dy, dx);

  if (currentAxis === 'horizontal') {
    const staysLocked =
      horizontalDeviation <= WIRE_ASSIST_EXIT_DEVIATION_PX &&
      horizontalAngle <= WIRE_ASSIST_EXIT_ANGLE_DEG;
    return staysLocked
      ? { axis: 'horizontal', point: { x: pointer.x, y: anchor.y } }
      : { axis: null, point: pointer };
  }

  if (currentAxis === 'vertical') {
    const staysLocked =
      verticalDeviation <= WIRE_ASSIST_EXIT_DEVIATION_PX &&
      verticalAngle <= WIRE_ASSIST_EXIT_ANGLE_DEG;
    return staysLocked
      ? { axis: 'vertical', point: { x: anchor.x, y: pointer.y } }
      : { axis: null, point: pointer };
  }

  const horizontalCandidate =
    horizontalDeviation <= WIRE_ASSIST_ENTER_DEVIATION_PX &&
    horizontalAngle <= WIRE_ASSIST_ENTER_ANGLE_DEG;
  const verticalCandidate =
    verticalDeviation <= WIRE_ASSIST_ENTER_DEVIATION_PX &&
    verticalAngle <= WIRE_ASSIST_ENTER_ANGLE_DEG;

  if (horizontalCandidate && (!verticalCandidate || horizontalDeviation <= verticalDeviation)) {
    return { axis: 'horizontal', point: { x: pointer.x, y: anchor.y } };
  }
  if (verticalCandidate) {
    return { axis: 'vertical', point: { x: anchor.x, y: pointer.y } };
  }
  return { axis: null, point: pointer };
}

/** Keep a dragged segment parallel to the segment the user grabbed.
 *
 * Horizontal and vertical segments move only across their own axis. An
 * intentionally diagonal segment moves along its perpendicular, so dragging
 * never changes its angle while it is in the user's hand.
 */
export function wireSegmentParallelDelta(start: Point, end: Point, pointerDelta: Point): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) >= Math.abs(dy) * 4) return { x: 0, y: pointerDelta.y };
  if (Math.abs(dy) >= Math.abs(dx) * 4) return { x: pointerDelta.x, y: 0 };
  const length = Math.hypot(dx, dy);
  if (length === 0) return pointerDelta;
  const perpendicular = { x: -dy / length, y: dx / length };
  const distance = pointerDelta.x * perpendicular.x + pointerDelta.y * perpendicular.y;
  return {
    x: perpendicular.x * distance,
    y: perpendicular.y * distance,
  };
}

/** Move one route segment while keeping both terminal anchors fixed.
 *
 * When the segment touches a terminal, a neighbouring bend is created. This is
 * the same physical gesture as pulling a straight length of insulated wire
 * sideways while its ends remain plugged in.
 */
export function moveWireSegmentVertices(
  from: Point,
  to: Point,
  vertices: readonly Point[],
  segmentIndex: number,
  pointerDelta: Point,
): Point[] | null {
  const route = wirePoints(from, to, vertices);
  if (segmentIndex < 0 || segmentIndex >= route.length - 1) return null;
  const start = route[segmentIndex] as Point;
  const end = route[segmentIndex + 1] as Point;
  const delta = wireSegmentParallelDelta(start, end, pointerDelta);
  if (Math.abs(delta.x) < 0.5 && Math.abs(delta.y) < 0.5) return null;

  const shiftedStart = {
    x: Math.round(start.x + delta.x),
    y: Math.round(start.y + delta.y),
  };
  const shiftedEnd = {
    x: Math.round(end.x + delta.x),
    y: Math.round(end.y + delta.y),
  };
  let next = vertices.map((point) => ({ ...point }));
  const startIsTerminal = segmentIndex === 0;
  const endIsTerminal = segmentIndex + 1 === route.length - 1;

  if (!startIsTerminal) next[segmentIndex - 1] = shiftedStart;
  if (!endIsTerminal) next[segmentIndex] = shiftedEnd;
  if (startIsTerminal) next = [shiftedStart, ...next];
  if (endIsTerminal) next = [...next, shiftedEnd];
  return next.length <= 48 ? next : null;
}

export function completeOrthogonalRoute(
  start: Point,
  target: Point,
  vertices: readonly Point[],
): readonly Point[] {
  const routed: Point[] = [];
  let anchor = start;

  for (const vertex of vertices) {
    const alreadyOrthogonal = vertex.x === anchor.x || vertex.y === anchor.y;
    const next = alreadyOrthogonal
      ? vertex
      : Math.abs(vertex.x - anchor.x) >= Math.abs(vertex.y - anchor.y)
        ? { x: vertex.x, y: anchor.y }
        : { x: anchor.x, y: vertex.y };
    if (next.x !== anchor.x || next.y !== anchor.y) routed.push(next);
    anchor = next;
  }

  if (target.x === anchor.x || target.y === anchor.y) return routed;

  // The terminal is authoritative and may be fractional/off-grid. Build the
  // final elbow from its exact coordinate instead of snapping the terminal.
  const elbow =
    Math.abs(target.x - anchor.x) >= Math.abs(target.y - anchor.y)
      ? { x: target.x, y: anchor.y }
      : { x: anchor.x, y: target.y };
  if (elbow.x !== anchor.x || elbow.y !== anchor.y) routed.push(elbow);
  return routed;
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
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
): Point {
  const box = viewportViewBox(viewport, canvasWidth, canvasHeight);
  const scale = Math.max(rect.width / box.width, rect.height / box.height);
  const renderedWidth = box.width * scale;
  const renderedHeight = box.height * scale;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;
  return {
    x: box.x + (clientX - rect.left - offsetX) / scale,
    y: box.y + (clientY - rect.top - offsetY) / scale,
  };
}

export function worldToClient(
  point: Point,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  viewport: Viewport,
  canvasWidth: number,
  canvasHeight: number,
): Point {
  const box = viewportViewBox(viewport, canvasWidth, canvasHeight);
  const scale = Math.max(rect.width / box.width, rect.height / box.height);
  const renderedWidth = box.width * scale;
  const renderedHeight = box.height * scale;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;
  return {
    x: rect.left + offsetX + (point.x - box.x) * scale,
    y: rect.top + offsetY + (point.y - box.y) * scale,
  };
}

/** One xMidYMid/slice transform for pointer, pan, pinch, wheel and fit. */
export function gestureViewport(
  start: Viewport,
  anchor: Point,
  pointer: Point,
  zoom: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  canvasWidth: number,
  canvasHeight: number,
): Viewport {
  if (rect.width <= 0 || rect.height <= 0 || !Number.isFinite(zoom) || zoom <= 0) return start;
  const before = clientToWorld(anchor.x, anchor.y, rect, start, canvasWidth, canvasHeight);
  const candidate = { ...start, zoom };
  const after = clientToWorld(pointer.x, pointer.y, rect, candidate, canvasWidth, canvasHeight);
  return { x: start.x + before.x - after.x, y: start.y + before.y - after.y, zoom };
}

export interface ViewportFitInsets {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export function fitViewportToScreen(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  rect: Pick<DOMRect, 'width' | 'height'>,
  canvasWidth: number,
  canvasHeight: number,
  minZoom: number,
  maxZoom: number,
  padding: number | ViewportFitInsets = 28,
): Viewport {
  const baseScale = Math.max(rect.width / canvasWidth, rect.height / canvasHeight);
  if (baseScale <= 0) return { x: 0, y: 0, zoom: 1 };
  const insets =
    typeof padding === 'number'
      ? { left: padding, right: padding, top: padding, bottom: padding }
      : padding;
  const targetScale = Math.min(
    Math.max(1, rect.width - insets.left - insets.right) / Math.max(1, bounds.maxX - bounds.minX),
    Math.max(1, rect.height - insets.top - insets.bottom) / Math.max(1, bounds.maxY - bounds.minY),
  );
  const zoom = clamp(targetScale / baseScale, minZoom, maxZoom);
  const actualScale = baseScale * zoom;
  const horizontalOffset = (insets.left - insets.right) / (2 * actualScale);
  const verticalOffset = (insets.top - insets.bottom) / (2 * actualScale);
  return {
    x: (bounds.minX + bounds.maxX) / 2 - canvasWidth / zoom / 2 - horizontalOffset,
    y: (bounds.minY + bounds.maxY) / 2 - canvasHeight / zoom / 2 - verticalOffset,
    zoom,
  };
}
