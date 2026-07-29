/**
 * Electronics workbench physical scale.
 *
 * One full grid pitch represents the standard 0.1 inch / 2.54 mm breadboard
 * pitch. Documents continue to store plain world coordinates, but every new
 * placement is calibrated against this contract rather than arbitrary pixels.
 */
export const BREADBOARD_PITCH_MM = 2.54;
export const BREADBOARD_PITCH_UNITS = 20;
export const HALF_PITCH_UNITS = BREADBOARD_PITCH_UNITS / 2;
export const WORKBENCH_UNITS_PER_MM = BREADBOARD_PITCH_UNITS / BREADBOARD_PITCH_MM;
export const WORKBENCH_MM_PER_UNIT = 1 / WORKBENCH_UNITS_PER_MM;

/** Eight-inch by 4.9-inch initial field, expressed through the physical scale. */
export const STAGE_WIDTH_MM = 203.2;
export const STAGE_HEIGHT_MM = 124.46;
export const STAGE_WIDTH_UNITS = Math.round(STAGE_WIDTH_MM * WORKBENCH_UNITS_PER_MM);
export const STAGE_HEIGHT_UNITS = Math.round(STAGE_HEIGHT_MM * WORKBENCH_UNITS_PER_MM);

export type PhysicalEvidence =
  | 'owner_asset_calibrated'
  | 'manufacturer_typical'
  | 'reference_capture_required';

export interface PhysicalComponentSpec {
  /** Typical body dimensions; not the full lead envelope. */
  readonly bodyMm: {
    readonly width: number;
    readonly height: number;
    readonly depth?: number;
  };
  /** Required distance between the primary placement terminals. */
  readonly terminalSpanPitches?: number;
  readonly evidence: PhysicalEvidence;
  readonly source: string;
}

export interface PlacementSpec {
  /** `2` means half-pitch snapping; both terminals still align when their span is integral. */
  readonly gridDivisor: 1 | 2 | 4;
  readonly anchorTerminal: 'a' | 'b' | null;
}

export function mmToWorkbenchUnits(mm: number): number {
  return mm * WORKBENCH_UNITS_PER_MM;
}

export function workbenchUnitsToMm(units: number): number {
  return units * WORKBENCH_MM_PER_UNIT;
}

export function pitchesToWorkbenchUnits(pitches: number): number {
  return pitches * BREADBOARD_PITCH_UNITS;
}

export function snapWorkbench(value: number, divisor: 1 | 2 | 4 = 2): number {
  const step = BREADBOARD_PITCH_UNITS / divisor;
  return Math.round(value / step) * step;
}

/**
 * Scale a vector asset so that the distance between two asset-space terminals
 * equals an integral number of breadboard pitches on the stage.
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
