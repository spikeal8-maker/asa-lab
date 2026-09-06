export interface AnchoredResizeInput {
  readonly initialWidth: number;
  readonly initialDepth: number;
  readonly pointerX: number;
  readonly pointerZ: number;
  readonly xSign: -1 | 0 | 1;
  readonly zSign: -1 | 0 | 1;
  readonly snapStep: number;
  readonly minimumSize?: number;
  readonly centered?: boolean;
  readonly uniform?: boolean;
}

export interface AnchoredResizeResult {
  readonly width: number;
  readonly depth: number;
  readonly centerOffsetX: number;
  readonly centerOffsetZ: number;
}

export function snapToStep(value: number, step: number): number {
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
  return Math.round(value / safeStep) * safeStep;
}

function snappedSize(value: number, step: number, minimumSize: number): number {
  return Math.max(minimumSize, snapToStep(value, step));
}

/**
 * Resizes a footprint around the opposite handle. The returned centre offset is
 * expressed in the object's original local coordinate system, so callers can
 * rotate it into world space without losing the anchored edge.
 */
export function calculateAnchoredResize(input: AnchoredResizeInput): AnchoredResizeResult {
  const minimumSize = Math.max(input.minimumSize ?? input.snapStep, 0.05);
  const anchorX = input.xSign === 0 ? 0 : (-input.xSign * input.initialWidth) / 2;
  const anchorZ = input.zSign === 0 ? 0 : (-input.zSign * input.initialDepth) / 2;

  let width =
    input.xSign === 0
      ? input.initialWidth
      : snappedSize(
          input.centered ? Math.abs(input.pointerX) * 2 : (input.pointerX - anchorX) * input.xSign,
          input.snapStep,
          minimumSize,
        );
  let depth =
    input.zSign === 0
      ? input.initialDepth
      : snappedSize(
          input.centered ? Math.abs(input.pointerZ) * 2 : (input.pointerZ - anchorZ) * input.zSign,
          input.snapStep,
          minimumSize,
        );

  if (input.uniform) {
    const factors = [
      ...(input.xSign === 0 ? [] : [width / input.initialWidth]),
      ...(input.zSign === 0 ? [] : [depth / input.initialDepth]),
    ];
    const factor = factors.sort((left, right) => Math.abs(right - 1) - Math.abs(left - 1))[0] ?? 1;
    width = snappedSize(input.initialWidth * factor, input.snapStep, minimumSize);
    depth = snappedSize(input.initialDepth * factor, input.snapStep, minimumSize);
  }

  return {
    width,
    depth,
    centerOffsetX: input.centered || input.xSign === 0 ? 0 : anchorX + (input.xSign * width) / 2,
    centerOffsetZ: input.centered || input.zSign === 0 ? 0 : anchorZ + (input.zSign * depth) / 2,
  };
}

export function calculateHeightResize(
  initialHeight: number,
  axisDelta: number,
  snapStep: number,
  minimumSize = Math.max(snapStep, 0.05),
  centered = false,
): { readonly height: number; readonly centerOffset: number } {
  const height = snappedSize(initialHeight + axisDelta * (centered ? 2 : 1), snapStep, minimumSize);
  return { height, centerOffset: centered ? 0 : (height - initialHeight) / 2 };
}

export function calculateLiftPosition(
  initialPosition: number,
  axisDelta: number,
  floorOffset: number,
  snapStep: number,
): number {
  const initialBottom = initialPosition - floorOffset;
  const snappedBottom = Math.max(0, snapToStep(initialBottom + axisDelta, snapStep));
  return floorOffset + snappedBottom;
}

export function normaliseDegrees(value: number): number {
  const wrapped = ((((value + 180) % 360) + 360) % 360) - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

export function snapRotationRadians(radians: number, stepDegrees: number): number {
  const degrees = normaliseDegrees((radians * 180) / Math.PI);
  return (snapToStep(degrees, stepDegrees) * Math.PI) / 180;
}

/**
 * Высота горизонтальной плоскости, по которой ведётся перетаскивание.
 *
 * Плоскость обязана проходить через саму фигуру. Пока здесь стоял пол (y = 0),
 * деталь уезжала из-под курсора: луч от мыши пересекает пол не там, где
 * проходит через деталь, и при одном движении мыши она проходила лишнее — почти
 * 6% для куба на плоскости и в разы больше для поднятого. Это то, что видно как
 * «фигура бежит и плывёт».
 */
export function dragPlaneHeight(shapeCentreY: number): number {
  return Number.isFinite(shapeCentreY) ? shapeCentreY : 0;
}

/**
 * Можно ли вообще двигать по этой плоскости с такого угла.
 *
 * Луч, идущий вдоль плоскости, пересекает её сколь угодно далеко: у горизонта
 * один пиксель мыши превращается в метры, и деталь исчезает с экрана. Ниже
 * этого порога движение не применяется — лучше не сдвинуть, чем зашвырнуть.
 */
export const GRAZING_LIMIT = 0.08;

export function canDragOnPlane(rayDotPlaneNormal: number): boolean {
  return Math.abs(rayDotPlaneNormal) >= GRAZING_LIMIT;
}

interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** Editable labels must not intercept a neighbouring resize/rotation handle. */
export function placeMeasurementLabel(
  anchor: ScreenPoint,
  size: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
  handles: readonly ScreenPoint[],
): ScreenPoint {
  const halfWidth = size.width / 2;
  const halfHeight = size.height / 2;
  const clamp = (value: number, half: number, limit: number): number =>
    Math.max(half + 4, Math.min(limit - half - 4, value));
  const candidates = [
    anchor,
    ...handles.flatMap((handle) => [
      { x: anchor.x, y: handle.y - halfHeight - 18 },
      { x: anchor.x, y: handle.y + halfHeight + 18 },
      { x: handle.x - halfWidth - 18, y: anchor.y },
      { x: handle.x + halfWidth + 18, y: anchor.y },
    ]),
  ].map((point) => ({
    x: clamp(point.x, halfWidth, viewport.width),
    y: clamp(point.y, halfHeight, viewport.height),
  }));
  const score = (point: ScreenPoint): number =>
    handles.filter(
      (handle) =>
        Math.abs(point.x - handle.x) < halfWidth + 16 &&
        Math.abs(point.y - handle.y) < halfHeight + 16,
    ).length *
      1e9 +
    (point.x - anchor.x) ** 2 +
    (point.y - anchor.y) ** 2;
  return candidates.reduce((best, point) => (score(point) < score(best) ? point : best));
}
