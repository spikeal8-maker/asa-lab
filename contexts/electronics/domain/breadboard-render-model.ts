import {
  BREADBOARD_CENTER_GAP_MM,
  BREADBOARD_HOLE_PITCH_MM,
  breadboardInternalBusMap,
  type BreadboardDefinition,
  type BreadboardHole,
  type BreadboardRailId,
  type BreadboardTerminalRow,
} from './breadboard.js';

export interface BreadboardRenderHole {
  readonly id: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly visibleRadiusMm: number;
  readonly hitRadiusMm: number;
  readonly internalBusId: string;
  readonly region: 'terminal-strip' | 'power-rail';
  readonly accessibleName: string;
  readonly row?: BreadboardTerminalRow;
  readonly column?: number;
  readonly rail?: BreadboardRailId;
  readonly railIndex?: number;
}

export interface BreadboardRenderChannel {
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
}

export interface BreadboardRenderRailGuide {
  readonly id: BreadboardRailId;
  readonly polarity: 'positive' | 'negative';
  readonly x1Mm: number;
  readonly x2Mm: number;
  readonly yMm: number;
  readonly segments: readonly {
    readonly id: string;
    readonly x1Mm: number;
    readonly x2Mm: number;
  }[];
}

export interface BreadboardRenderLabel {
  readonly text: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly kind: 'column' | 'row' | 'rail-polarity';
}

export interface BreadboardRenderModel {
  readonly kind: BreadboardDefinition['kind'];
  readonly widthMm: number;
  readonly heightMm: number;
  readonly cornerRadiusMm: number;
  readonly bodyInsetMm: number;
  readonly holes: readonly BreadboardRenderHole[];
  readonly channel: BreadboardRenderChannel;
  readonly rails: readonly BreadboardRenderRailGuide[];
  readonly labels: readonly BreadboardRenderLabel[];
  readonly terminalCount: number;
  readonly internalBusCount: number;
}

const VISIBLE_HOLE_RADIUS_MM = 0.48;
const POINTER_HIT_RADIUS_MM = BREADBOARD_HOLE_PITCH_MM / 2;
const BOARD_BODY_INSET_MM = 0.45;
const BOARD_CORNER_RADIUS_MM = 2.2;
const FIELD_ROWS: readonly BreadboardTerminalRow[] = [
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

function roundMm(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function holeAccessibleName(hole: BreadboardHole): string {
  if (hole.region === 'terminal-strip') {
    const group = ['a', 'b', 'c', 'd', 'e'].includes(hole.row ?? '')
      ? 'верхняя группа из пяти'
      : 'нижняя группа из пяти';
    return `Отверстие ${hole.row}${hole.column}, ${group}, шина ${hole.internalBusId}`;
  }
  const side = hole.rail?.startsWith('top') ? 'верхняя' : 'нижняя';
  const polarity = hole.rail?.endsWith('positive') ? 'положительная' : 'отрицательная';
  return `${side} ${polarity} шина, отверстие ${hole.railIndex}, шина ${hole.internalBusId}`;
}

function renderHole(hole: BreadboardHole): BreadboardRenderHole {
  return {
    id: hole.id,
    xMm: hole.xMm,
    yMm: hole.yMm,
    visibleRadiusMm: VISIBLE_HOLE_RADIUS_MM,
    hitRadiusMm: POINTER_HIT_RADIUS_MM,
    internalBusId: hole.internalBusId,
    region: hole.region,
    accessibleName: holeAccessibleName(hole),
    ...(hole.row === undefined ? {} : { row: hole.row }),
    ...(hole.column === undefined ? {} : { column: hole.column }),
    ...(hole.rail === undefined ? {} : { rail: hole.rail }),
    ...(hole.railIndex === undefined ? {} : { railIndex: hole.railIndex }),
  };
}

function channel(definition: BreadboardDefinition): BreadboardRenderChannel {
  const upper = definition.holes.find(
    (hole) => hole.region === 'terminal-strip' && hole.column === 1 && hole.row === 'e',
  );
  const lower = definition.holes.find(
    (hole) => hole.region === 'terminal-strip' && hole.column === 1 && hole.row === 'f',
  );
  if (!upper || !lower) throw new Error('breadboard definition misses the centre-channel rows');
  const heightMm = lower.yMm - upper.yMm - BREADBOARD_HOLE_PITCH_MM;
  if (Math.abs(lower.yMm - upper.yMm - BREADBOARD_CENTER_GAP_MM) > 0.02) {
    throw new Error('breadboard centre-channel geometry is inconsistent');
  }
  return {
    xMm: BOARD_BODY_INSET_MM,
    yMm: roundMm(upper.yMm + BREADBOARD_HOLE_PITCH_MM / 2),
    widthMm: roundMm(definition.widthMm - BOARD_BODY_INSET_MM * 2),
    heightMm: roundMm(heightMm),
  };
}

function railGuides(definition: BreadboardDefinition): BreadboardRenderRailGuide[] {
  const rails = new Map<BreadboardRailId, BreadboardHole[]>();
  for (const hole of definition.holes) {
    if (hole.region !== 'power-rail' || !hole.rail) continue;
    const values = rails.get(hole.rail) ?? [];
    values.push(hole);
    rails.set(hole.rail, values);
  }
  return [...rails.entries()].map(([id, rawHoles]) => {
    const holes = [...rawHoles].sort((left, right) => left.xMm - right.xMm);
    const segmentGroups = new Map<string, BreadboardHole[]>();
    for (const hole of holes) {
      const key = hole.segment ?? 'continuous';
      const values = segmentGroups.get(key) ?? [];
      values.push(hole);
      segmentGroups.set(key, values);
    }
    return {
      id,
      polarity: id.endsWith('positive') ? 'positive' : 'negative',
      x1Mm: holes[0]?.xMm ?? 0,
      x2Mm: holes.at(-1)?.xMm ?? 0,
      yMm: holes[0]?.yMm ?? 0,
      segments: [...segmentGroups.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([segmentId, values]) => {
          const ordered = [...values].sort((left, right) => left.xMm - right.xMm);
          return {
            id: `${id}:${segmentId}`,
            x1Mm: ordered[0]?.xMm ?? 0,
            x2Mm: ordered.at(-1)?.xMm ?? 0,
          };
        }),
    };
  });
}

function fieldLabels(definition: BreadboardDefinition): BreadboardRenderLabel[] {
  const labels: BreadboardRenderLabel[] = [];
  const topRow = definition.holes.find(
    (hole) => hole.region === 'terminal-strip' && hole.column === 1 && hole.row === 'a',
  );
  const bottomRow = definition.holes.find(
    (hole) => hole.region === 'terminal-strip' && hole.column === 1 && hole.row === 'j',
  );
  if (!topRow || !bottomRow) throw new Error('breadboard definition misses field rows');

  const labelledColumns = new Set([1, definition.terminalColumns]);
  for (let column = 5; column < definition.terminalColumns; column += 5) {
    labelledColumns.add(column);
  }
  for (const column of [...labelledColumns].sort((left, right) => left - right)) {
    const hole = definition.holes.find(
      (candidate) =>
        candidate.region === 'terminal-strip' && candidate.column === column && candidate.row === 'a',
    );
    if (!hole) continue;
    labels.push({
      text: String(column),
      xMm: hole.xMm,
      yMm: roundMm(topRow.yMm - BREADBOARD_HOLE_PITCH_MM * 0.72),
      kind: 'column',
    });
    labels.push({
      text: String(column),
      xMm: hole.xMm,
      yMm: roundMm(bottomRow.yMm + BREADBOARD_HOLE_PITCH_MM * 0.82),
      kind: 'column',
    });
  }

  const firstColumn = definition.holes.filter(
    (hole) => hole.region === 'terminal-strip' && hole.column === 1,
  );
  for (const row of FIELD_ROWS) {
    const hole = firstColumn.find((candidate) => candidate.row === row);
    if (!hole) continue;
    labels.push({
      text: row.toUpperCase(),
      xMm: roundMm(hole.xMm - BREADBOARD_HOLE_PITCH_MM * 0.8),
      yMm: roundMm(hole.yMm + 0.35),
      kind: 'row',
    });
  }

  for (const rail of railGuides(definition)) {
    labels.push({
      text: rail.polarity === 'positive' ? '+' : '−',
      xMm: roundMm(rail.x1Mm - BREADBOARD_HOLE_PITCH_MM * 0.85),
      yMm: roundMm(rail.yMm + 0.35),
      kind: 'rail-polarity',
    });
  }
  return labels;
}

/**
 * Build one deterministic, renderer-neutral native breadboard scene.
 * Electrical identity comes from the domain definition; screen-space hit areas
 * are a rendering concern and do not change physical coordinates or nets.
 */
export function buildBreadboardRenderModel(
  definition: BreadboardDefinition,
): BreadboardRenderModel {
  const holes = definition.holes.map(renderHole);
  const uniqueIds = new Set(holes.map((hole) => hole.id));
  if (uniqueIds.size !== holes.length) throw new Error('breadboard render holes must have unique IDs');
  for (const hole of holes) {
    if (
      hole.xMm < 0 ||
      hole.yMm < 0 ||
      hole.xMm > definition.widthMm ||
      hole.yMm > definition.heightMm
    ) {
      throw new Error(`breadboard render hole is outside the board: ${hole.id}`);
    }
  }
  return {
    kind: definition.kind,
    widthMm: definition.widthMm,
    heightMm: definition.heightMm,
    cornerRadiusMm: BOARD_CORNER_RADIUS_MM,
    bodyInsetMm: BOARD_BODY_INSET_MM,
    holes,
    channel: channel(definition),
    rails: railGuides(definition),
    labels: fieldLabels(definition),
    terminalCount: holes.length,
    internalBusCount: breadboardInternalBusMap(definition).size,
  };
}

export function breadboardRenderHole(
  model: BreadboardRenderModel,
  holeId: string,
): BreadboardRenderHole | null {
  return model.holes.find((hole) => hole.id === holeId) ?? null;
}
