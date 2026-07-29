export const BREADBOARD_HOLE_PITCH_MM = 2.54;
export const BREADBOARD_CENTER_GAP_MM = 7.62;

export type BreadboardKind = 'mini-170' | 'half-400' | 'full-830';
export type BreadboardTerminalRow = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j';
export type BreadboardHoleRegion = 'terminal-strip' | 'power-rail';
export type BreadboardRailId =
  | 'top-positive'
  | 'top-negative'
  | 'bottom-positive'
  | 'bottom-negative';

export interface BreadboardHole {
  readonly id: string;
  readonly region: BreadboardHoleRegion;
  readonly xMm: number;
  readonly yMm: number;
  /** Holes with the same internalBusId are electrically connected by the board. */
  readonly internalBusId: string;
  readonly column?: number;
  readonly row?: BreadboardTerminalRow;
  readonly rail?: BreadboardRailId;
  readonly railIndex?: number;
  readonly segment?: 'continuous' | 'left' | 'right';
}

export interface BreadboardEvidence {
  readonly geometrySource: string;
  readonly topologySource: string;
  readonly referenceParityStatus: 'evidence_required';
}

export interface BreadboardDefinition {
  readonly kind: BreadboardKind;
  readonly displayName: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly thicknessMm: number;
  readonly pitchMm: number;
  readonly terminalColumns: number;
  readonly railHolesPerRow: number;
  readonly railSplit: boolean;
  readonly holes: readonly BreadboardHole[];
  readonly evidence: BreadboardEvidence;
}

interface BreadboardProfile {
  readonly kind: BreadboardKind;
  readonly displayName: string;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly thicknessMm: number;
  readonly terminalColumns: number;
  readonly railHolesPerRow: number;
  readonly railSplit: boolean;
  readonly geometrySource: string;
  readonly topologySource: string;
}

const PROFILES: Readonly<Record<BreadboardKind, BreadboardProfile>> = {
  'mini-170': {
    kind: 'mini-170',
    displayName: 'Мини-макетная плата, 170 точек',
    widthMm: 47,
    heightMm: 35,
    thicknessMm: 10,
    terminalColumns: 17,
    railHolesPerRow: 0,
    railSplit: false,
    geometrySource: 'SparkFun PRT-12047: 47 × 35 × 10 mm, 170 tie points',
    topologySource: 'Standard 0.1 inch terminal strips; exact Tinkercad visual capture pending',
  },
  'half-400': {
    kind: 'half-400',
    displayName: 'Макетная плата половинного размера, 400 точек',
    widthMm: 82.6,
    heightMm: 55,
    thicknessMm: 9.3,
    terminalColumns: 30,
    railHolesPerRow: 25,
    railSplit: false,
    geometrySource: 'Adafruit product 64: 82.6 × 55 × 9.3 mm, 400 tie points',
    topologySource: '30 rows, two five-hole terminal strips and four 25-hole rail rows',
  },
  'full-830': {
    kind: 'full-830',
    displayName: 'Полноразмерная макетная плата, 830 точек',
    widthMm: 165.1,
    heightMm: 54.29,
    thicknessMm: 9.68,
    terminalColumns: 63,
    railHolesPerRow: 50,
    railSplit: true,
    geometrySource: 'SparkFun PRT-12615: 165.1 × 54.29 × 9.68 mm, 830 tie points',
    topologySource: '63 rows, ten terminal columns, two split power buses; exact reference visual pending',
  },
};

const UPPER_ROWS: readonly BreadboardTerminalRow[] = ['a', 'b', 'c', 'd', 'e'];
const LOWER_ROWS: readonly BreadboardTerminalRow[] = ['f', 'g', 'h', 'i', 'j'];
const RAILS: readonly BreadboardRailId[] = [
  'top-positive',
  'top-negative',
  'bottom-positive',
  'bottom-negative',
];

function roundMm(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function terminalHoles(profile: BreadboardProfile): BreadboardHole[] {
  const holes: BreadboardHole[] = [];
  const xStart = (profile.widthMm - (profile.terminalColumns - 1) * BREADBOARD_HOLE_PITCH_MM) / 2;
  const totalTerminalSpan =
    4 * BREADBOARD_HOLE_PITCH_MM +
    BREADBOARD_CENTER_GAP_MM +
    4 * BREADBOARD_HOLE_PITCH_MM;
  const yStart = (profile.heightMm - totalTerminalSpan) / 2;

  for (let column = 1; column <= profile.terminalColumns; column += 1) {
    const xMm = roundMm(xStart + (column - 1) * BREADBOARD_HOLE_PITCH_MM);
    UPPER_ROWS.forEach((row, rowIndex) => {
      holes.push({
        id: `${profile.kind}:terminal:${column}:${row}`,
        region: 'terminal-strip',
        xMm,
        yMm: roundMm(yStart + rowIndex * BREADBOARD_HOLE_PITCH_MM),
        internalBusId: `${profile.kind}:terminal:${column}:upper`,
        column,
        row,
      });
    });
    LOWER_ROWS.forEach((row, rowIndex) => {
      holes.push({
        id: `${profile.kind}:terminal:${column}:${row}`,
        region: 'terminal-strip',
        xMm,
        yMm: roundMm(
          yStart +
            4 * BREADBOARD_HOLE_PITCH_MM +
            BREADBOARD_CENTER_GAP_MM +
            rowIndex * BREADBOARD_HOLE_PITCH_MM,
        ),
        internalBusId: `${profile.kind}:terminal:${column}:lower`,
        column,
        row,
      });
    });
  }
  return holes;
}

function railY(profile: BreadboardProfile, rail: BreadboardRailId): number {
  const outer = 3.8;
  const inner = outer + BREADBOARD_HOLE_PITCH_MM;
  if (rail === 'top-positive') return outer;
  if (rail === 'top-negative') return inner;
  if (rail === 'bottom-negative') return profile.heightMm - inner;
  return profile.heightMm - outer;
}

function railHoles(profile: BreadboardProfile): BreadboardHole[] {
  if (profile.railHolesPerRow === 0) return [];
  const holes: BreadboardHole[] = [];
  const xStart =
    (profile.widthMm - (profile.railHolesPerRow - 1) * BREADBOARD_HOLE_PITCH_MM) / 2;
  const splitAt = profile.railHolesPerRow / 2;

  for (const rail of RAILS) {
    for (let railIndex = 1; railIndex <= profile.railHolesPerRow; railIndex += 1) {
      const segment = profile.railSplit
        ? railIndex <= splitAt
          ? 'left'
          : 'right'
        : 'continuous';
      holes.push({
        id: `${profile.kind}:rail:${rail}:${railIndex}`,
        region: 'power-rail',
        xMm: roundMm(xStart + (railIndex - 1) * BREADBOARD_HOLE_PITCH_MM),
        yMm: roundMm(railY(profile, rail)),
        internalBusId: `${profile.kind}:rail:${rail}:${segment}`,
        rail,
        railIndex,
        segment,
      });
    }
  }
  return holes;
}

export function createBreadboardDefinition(kind: BreadboardKind): BreadboardDefinition {
  const profile = PROFILES[kind];
  const holes = [...terminalHoles(profile), ...railHoles(profile)];
  return {
    kind,
    displayName: profile.displayName,
    widthMm: profile.widthMm,
    heightMm: profile.heightMm,
    thicknessMm: profile.thicknessMm,
    pitchMm: BREADBOARD_HOLE_PITCH_MM,
    terminalColumns: profile.terminalColumns,
    railHolesPerRow: profile.railHolesPerRow,
    railSplit: profile.railSplit,
    holes,
    evidence: {
      geometrySource: profile.geometrySource,
      topologySource: profile.topologySource,
      referenceParityStatus: 'evidence_required',
    },
  };
}

export function breadboardHole(
  definition: BreadboardDefinition,
  holeId: string,
): BreadboardHole | null {
  return definition.holes.find((hole) => hole.id === holeId) ?? null;
}

export function areBreadboardHolesConnected(
  definition: BreadboardDefinition,
  firstHoleId: string,
  secondHoleId: string,
): boolean {
  const first = breadboardHole(definition, firstHoleId);
  const second = breadboardHole(definition, secondHoleId);
  return Boolean(first && second && first.internalBusId === second.internalBusId);
}

export function breadboardBusMembers(
  definition: BreadboardDefinition,
  holeId: string,
): readonly BreadboardHole[] {
  const hole = breadboardHole(definition, holeId);
  if (!hole) return [];
  return definition.holes.filter((candidate) => candidate.internalBusId === hole.internalBusId);
}

export function expectedBreadboardTiePointCount(kind: BreadboardKind): number {
  const profile = PROFILES[kind];
  return profile.terminalColumns * 10 + profile.railHolesPerRow * 4;
}
