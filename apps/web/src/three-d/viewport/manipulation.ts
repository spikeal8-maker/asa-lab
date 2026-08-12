export interface AnchoredResizeInput {
  readonly initialWidth: number;
  readonly initialDepth: number;
  readonly pointerX: number;
  readonly pointerZ: number;
  readonly xSign: -1 | 0 | 1;
  readonly zSign: -1 | 0 | 1;
  readonly snapStep: number;
  readonly minimumSize?: number;
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

  const width =
    input.xSign === 0
      ? input.initialWidth
      : snappedSize((input.pointerX - anchorX) * input.xSign, input.snapStep, minimumSize);
  const depth =
    input.zSign === 0
      ? input.initialDepth
      : snappedSize((input.pointerZ - anchorZ) * input.zSign, input.snapStep, minimumSize);

  return {
    width,
    depth,
    centerOffsetX: input.xSign === 0 ? 0 : anchorX + (input.xSign * width) / 2,
    centerOffsetZ: input.zSign === 0 ? 0 : anchorZ + (input.zSign * depth) / 2,
  };
}

export function calculateHeightResize(
  initialHeight: number,
  axisDelta: number,
  snapStep: number,
  minimumSize = Math.max(snapStep, 0.05),
): { readonly height: number; readonly centerOffset: number } {
  const height = snappedSize(initialHeight + axisDelta, snapStep, minimumSize);
  return { height, centerOffset: (height - initialHeight) / 2 };
}

export function calculateLiftPosition(
  initialPosition: number,
  axisDelta: number,
  floorPosition: number,
  snapStep: number,
): number {
  return Math.max(floorPosition, snapToStep(initialPosition + axisDelta, snapStep));
}

export function normaliseDegrees(value: number): number {
  const wrapped = ((((value + 180) % 360) + 360) % 360) - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

export function snapRotationRadians(radians: number, stepDegrees: number): number {
  const degrees = normaliseDegrees((radians * 180) / Math.PI);
  return (snapToStep(degrees, stepDegrees) * Math.PI) / 180;
}
