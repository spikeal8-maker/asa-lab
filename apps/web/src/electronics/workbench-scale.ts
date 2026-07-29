/**
 * Electronics workbench physical scale.
 *
 * One full grid pitch represents the standard 0.1 inch / 2.54 mm solderless
 * breadboard pitch. Documents store world coordinates, while component assets,
 * terminals and board holes are calibrated against this explicit scale.
 */
export const BREADBOARD_PITCH_MM = 2.54;
export const BREADBOARD_PITCH_UNITS = 20;
export const HALF_PITCH_UNITS = BREADBOARD_PITCH_UNITS / 2;
export const QUARTER_PITCH_UNITS = BREADBOARD_PITCH_UNITS / 4;
export const WORKBENCH_UNITS_PER_MM = BREADBOARD_PITCH_UNITS / BREADBOARD_PITCH_MM;
export const WORKBENCH_MM_PER_UNIT = 1 / WORKBENCH_UNITS_PER_MM;

/** Eight-inch by 4.9-inch initial field, expressed through the physical scale. */
export const STAGE_WIDTH_MM = 203.2;
export const STAGE_HEIGHT_MM = 124.46;
export const STAGE_WIDTH_UNITS = Math.round(STAGE_WIDTH_MM * WORKBENCH_UNITS_PER_MM);
export const STAGE_HEIGHT_UNITS = Math.round(STAGE_HEIGHT_MM * WORKBENCH_UNITS_PER_MM);

export type PhysicalEvidence =
  | 'owner_asset_calibrated'
  | 'manufacturer_official'
  | 'manufacturer_typical'
  | 'reference_capture_required';

export interface PhysicalDimensionsMm {
  readonly width: number;
  readonly height: number;
  readonly depth?: number;
}

export interface PhysicalComponentSpec {
  /** Physical body or board dimensions, excluding arbitrary SVG whitespace. */
  readonly bodyMm: PhysicalDimensionsMm;
  /** Full placement envelope when leads/connectors extend beyond the body. */
  readonly envelopeMm?: PhysicalDimensionsMm;
  /** Distance between the two primary placement terminals for simple parts. */
  readonly terminalSpanPitches?: number;
  readonly evidence: PhysicalEvidence;
  readonly source: string;
  /** Exact reference behavior can remain unresolved even with official dimensions. */
  readonly referenceBehaviorVerified?: boolean;
}

export interface PlacementSpec {
  /** `2` means half-pitch snapping; terminal spans remain physically calibrated. */
  readonly gridDivisor: 1 | 2 | 4;
  /** Stable persisted terminal ID used as the placement anchor. */
  readonly anchorTerminal: string | null;
  /** Current placement mode. Future boards use hole snapping through their own model. */
  readonly mode: 'terminal-grid' | 'free-physical' | 'breadboard-hole';
}

export function mmToWorkbenchUnits(mm: number): number {
  if (!Number.isFinite(mm)) throw new Error('millimetre value must be finite');
  return mm * WORKBENCH_UNITS_PER_MM;
}

export function workbenchUnitsToMm(units: number): number {
  if (!Number.isFinite(units)) throw new Error('workbench value must be finite');
  return units * WORKBENCH_MM_PER_UNIT;
}

export function pitchesToWorkbenchUnits(pitches: number): number {
  if (!Number.isFinite(pitches)) throw new Error('pitch count must be finite');
  return pitches * BREADBOARD_PITCH_UNITS;
}

export function snapWorkbench(value: number, divisor: 1 | 2 | 4 = 2): number {
  if (!Number.isFinite(value)) throw new Error('snap value must be finite');
  const step = BREADBOARD_PITCH_UNITS / divisor;
  return Math.round(value / step) * step;
}

export function isOnWorkbenchGrid(value: number, divisor: 1 | 2 | 4 = 2): boolean {
  if (!Number.isFinite(value)) return false;
  const step = BREADBOARD_PITCH_UNITS / divisor;
  return Math.abs(value / step - Math.round(value / step)) <= 1e-7;
}

/**
 * Scale a vector asset so that the distance between two asset-space terminals
 * equals an integral number of breadboard pitches on the stage. Uniform scale
 * preserves native SVG proportions; terminal geometry, not arbitrary pixels,
 * determines the rendered size.
 */
export function renderWidthForTerminalSpan(
  viewBoxWidth: number,
  terminalAX: number,
  terminalBX: number,
  spanPitches: number,
): number {
  const assetSpan = Math.abs(terminalBX - terminalAX);
  if (!(viewBoxWidth > 0) || !(assetSpan > 0) || !(spanPitches > 0)) {
    throw new Error('invalid terminal-span calibration');
  }
  return (viewBoxWidth * pitchesToWorkbenchUnits(spanPitches)) / assetSpan;
}

export function formatMillimetres(mm: number): string {
  const rounded = Math.round(mm * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} мм`;
}
