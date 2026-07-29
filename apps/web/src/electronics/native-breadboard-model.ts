import {
  BREADBOARD_PITCH_MM,
  mmToWorkbenchUnits,
  type PointLike,
} from './workbench-scale';

export type HalfBreadboardRow = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j';
export type HalfBreadboardRail =
  | 'top-positive'
  | 'top-negative'
  | 'bottom-positive'
  | 'bottom-negative';
export type HalfBreadboardRotation = 0 | 90 | 180 | 270;

export interface HalfBreadboardVisualHole {
  readonly id: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly label: string;
  readonly accessibleName: string;
  readonly region: 'terminal-strip' | 'power-rail';
  readonly internalBusId: string;
  readonly row?: HalfBreadboardRow;
  readonly column?: number;
  readonly rail?: HalfBreadboardRail;
  readonly railIndex?: number;
}

export interface HalfBreadboardVisualModel {
  readonly key: 'breadboard-half-400';
  readonly widthMm: 83.5;
  readonly heightMm: 54.5;
  readonly depthMm: 8.5;
  readonly viewBox: { readonly width: 83.5; readonly height: 54.5 };
  readonly renderWidth: number;
  readonly renderHeight: number;
  readonly pitchMm: 2.54;
  readonly centerChannelMm: 7.62;
  readonly channel: {
    readonly xMm: number;
    readonly yMm: number;
    readonly widthMm: number;
    readonly heightMm: number;
  };
  readonly holes: readonly HalfBreadboardVisualHole[];
  readonly terminalCount: 400;
}

const WIDTH_MM = 83.5 as const;
const HEIGHT_MM = 54.5 as const;
const DEPTH_MM = 8.5 as const;
const CENTER_CHANNEL_MM = 7.62 as const;
const TERMINAL_COLUMNS = 30;
const RAIL_POINTS = 25;
const ROWS: readonly HalfBreadboardRow[] = [
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
];
const RAILS: readonly HalfBreadboardRail[] = [
  'top-positive',
  'top-negative',
  'bottom-positive',
  'bottom-negative',
];

function roundMm(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function fieldBusId(column: number, row: HalfBreadboardRow): string {
  return `half-400:terminal:${column}:${['a', 'b', 'c', 'd', 'e'].includes(row) ? 'upper' : 'lower'}`;
}

function fieldHoleId(column: number, row: HalfBreadboardRow): string {
  return `half-400:terminal:${column}:${row}`;
}

function railBusId(rail: HalfBreadboardRail): string {
  return `half-400:rail:${rail}:continuous`;
}

function railHoleId(rail: HalfBreadboardRail, railIndex: number): string {
  return `half-400:rail:${rail}:${railIndex}`;
}

function fieldAccessibleName(column: number, row: HalfBreadboardRow): string {
  const side = ['a', 'b', 'c', 'd', 'e'].includes(row)
    ? 'верхняя группа из пяти'
    : 'нижняя группа из пяти';
  return `Отверстие ${row}${column}, ${side}`;
}

function railAccessibleName(rail: HalfBreadboardRail, railIndex: number): string {
  const side = rail.startsWith('top') ? 'верхняя' : 'нижняя';
  const polarity = rail.endsWith('positive') ? 'положительная' : 'отрицательная';
  return `${side} ${polarity} шина, отверстие ${railIndex}`;
}

function buildHalfBreadboardHoles(): HalfBreadboardVisualHole[] {
  const fieldWidth = (TERMINAL_COLUMNS - 1) * BREADBOARD_PITCH_MM;
  const xStart = (WIDTH_MM - fieldWidth) / 2;
  const fieldHeight = (5 - 1) * BREADBOARD_PITCH_MM * 2 + CENTER_CHANNEL_MM;
  const yStart = (HEIGHT_MM - fieldHeight) / 2;
  const holes: HalfBreadboardVisualHole[] = [];

  for (let column = 1; column <= TERMINAL_COLUMNS; column += 1) {
    for (const [rowIndex, row] of ROWS.entries()) {
      const lower = rowIndex >= 5;
      const localRow = lower ? rowIndex - 5 : rowIndex;
      holes.push({
        id: fieldHoleId(column, row),
        xMm: roundMm(xStart + (column - 1) * BREADBOARD_PITCH_MM),
        yMm: roundMm(
          yStart +
            localRow * BREADBOARD_PITCH_MM +
            (lower ? (5 - 1) * BREADBOARD_PITCH_MM + CENTER_CHANNEL_MM : 0),
        ),
        label: `${row}${column}`,
        accessibleName: fieldAccessibleName(column, row),
        region: 'terminal-strip',
        internalBusId: fieldBusId(column, row),
        row,
        column,
      });
    }
  }

  const railWidth = (RAIL_POINTS - 1) * BREADBOARD_PITCH_MM;
  const railXStart = (WIDTH_MM - railWidth) / 2;
  const railY = {
    'top-positive': BREADBOARD_PITCH_MM * 2,
    'top-negative': BREADBOARD_PITCH_MM * 4,
    'bottom-positive': HEIGHT_MM - BREADBOARD_PITCH_MM * 4,
    'bottom-negative': HEIGHT_MM - BREADBOARD_PITCH_MM * 2,
  } satisfies Record<HalfBreadboardRail, number>;
  for (const rail of RAILS) {
    for (let railIndex = 1; railIndex <= RAIL_POINTS; railIndex += 1) {
      holes.push({
        id: railHoleId(rail, railIndex),
        xMm: roundMm(railXStart + (railIndex - 1) * BREADBOARD_PITCH_MM),
        yMm: roundMm(railY[rail]),
        label: `${rail}:${railIndex}`,
        accessibleName: railAccessibleName(rail, railIndex),
        region: 'power-rail',
        internalBusId: railBusId(rail),
        rail,
        railIndex,
      });
    }
  }
  if (holes.length !== 400 || new Set(holes.map((hole) => hole.id)).size !== holes.length) {
    throw new Error('native half-breadboard visual must contain 400 unique holes');
  }
  return holes;
}

const HOLES = buildHalfBreadboardHoles();
const upperE = HOLES.find((hole) => hole.id === 'half-400:terminal:1:e')!;
const lowerF = HOLES.find((hole) => hole.id === 'half-400:terminal:1:f')!;

export const HALF_BREADBOARD_VISUAL: HalfBreadboardVisualModel = {
  key: 'breadboard-half-400',
  widthMm: WIDTH_MM,
  heightMm: HEIGHT_MM,
  depthMm: DEPTH_MM,
  viewBox: { width: WIDTH_MM, height: HEIGHT_MM },
  renderWidth: mmToWorkbenchUnits(WIDTH_MM),
  renderHeight: mmToWorkbenchUnits(HEIGHT_MM),
  pitchMm: BREADBOARD_PITCH_MM,
  centerChannelMm: CENTER_CHANNEL_MM,
  channel: {
    xMm: 0.45,
    yMm: roundMm(upperE.yMm + BREADBOARD_PITCH_MM / 2),
    widthMm: roundMm(WIDTH_MM - 0.9),
    heightMm: roundMm(lowerF.yMm - upperE.yMm - BREADBOARD_PITCH_MM),
  },
  holes: HOLES,
  terminalCount: 400,
};

export function halfBreadboardVisualHole(
  terminalId: string,
): HalfBreadboardVisualHole | null {
  return HALF_BREADBOARD_VISUAL.holes.find((hole) => hole.id === terminalId) ?? null;
}

export function halfBreadboardRenderedSize(
  rotation: HalfBreadboardRotation = 0,
): { width: number; height: number } {
  const { renderWidth, renderHeight } = HALF_BREADBOARD_VISUAL;
  return rotation === 90 || rotation === 270
    ? { width: renderHeight, height: renderWidth }
    : { width: renderWidth, height: renderHeight };
}

export function halfBreadboardTerminalPosition(
  origin: PointLike,
  terminalId: string,
  rotation: HalfBreadboardRotation = 0,
): PointLike | null {
  const hole = halfBreadboardVisualHole(terminalId);
  if (!hole) return null;
  const baseWidth = HALF_BREADBOARD_VISUAL.renderWidth;
  const baseHeight = HALF_BREADBOARD_VISUAL.renderHeight;
  const x = mmToWorkbenchUnits(hole.xMm);
  const y = mmToWorkbenchUnits(hole.yMm);
  if (rotation === 90) return { x: origin.x + baseHeight - y, y: origin.y + x };
  if (rotation === 180) {
    return { x: origin.x + baseWidth - x, y: origin.y + baseHeight - y };
  }
  if (rotation === 270) return { x: origin.x + y, y: origin.y + baseWidth - x };
  return { x: origin.x + x, y: origin.y + y };
}
