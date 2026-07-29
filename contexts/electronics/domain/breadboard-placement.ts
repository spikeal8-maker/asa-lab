import {
  BREADBOARD_HOLE_PITCH_MM,
  breadboardHoleWorldMm,
  nearestBreadboardHole,
  type BreadboardDefinition,
  type BreadboardHole,
  type BreadboardPlacementMm,
  type BreadboardPointMm,
  type BreadboardRotation,
} from './breadboard.js';
import type { TerminalId } from './component-model.js';

export interface PhysicalPartTerminalMm {
  readonly id: TerminalId;
  readonly xMm: number;
  readonly yMm: number;
  /** Decorative/non-electrical anchors may opt out of the all-terminals gate. */
  readonly requiresHole?: boolean;
}

export interface PhysicalPartDefinitionMm {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly terminals: readonly PhysicalPartTerminalMm[];
}

export interface PhysicalPartPlacementMm extends BreadboardPointMm {
  readonly rotation: BreadboardRotation;
}

export interface BreadboardTerminalAssignment {
  readonly terminalId: TerminalId;
  readonly hole: BreadboardHole;
  readonly distanceBeforeSnapMm: number;
  readonly distanceAfterSnapMm: number;
}

export interface BreadboardPartSnapSuccess {
  readonly ok: true;
  readonly placement: PhysicalPartPlacementMm;
  readonly assignments: readonly BreadboardTerminalAssignment[];
  readonly maximumErrorMm: number;
}

export interface BreadboardPartSnapFailure {
  readonly ok: false;
  readonly code:
    | 'invalid_part_geometry'
    | 'anchor_terminal_missing'
    | 'anchor_hole_not_found'
    | 'terminal_hole_not_found'
    | 'terminals_collide_on_one_hole';
  readonly message: string;
  readonly terminalId?: TerminalId;
}

export type BreadboardPartSnapResult = BreadboardPartSnapSuccess | BreadboardPartSnapFailure;

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function roundMm(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function rotatePartPointMm(
  part: PhysicalPartDefinitionMm,
  point: BreadboardPointMm,
  rotation: BreadboardRotation,
): BreadboardPointMm {
  if (rotation === 90) {
    return { xMm: roundMm(part.heightMm - point.yMm), yMm: roundMm(point.xMm) };
  }
  if (rotation === 180) {
    return {
      xMm: roundMm(part.widthMm - point.xMm),
      yMm: roundMm(part.heightMm - point.yMm),
    };
  }
  if (rotation === 270) {
    return { xMm: roundMm(point.yMm), yMm: roundMm(part.widthMm - point.xMm) };
  }
  return { xMm: roundMm(point.xMm), yMm: roundMm(point.yMm) };
}

export function partTerminalWorldMm(
  part: PhysicalPartDefinitionMm,
  placement: PhysicalPartPlacementMm,
  terminalId: TerminalId,
): BreadboardPointMm | null {
  const terminal = part.terminals.find((candidate) => candidate.id === terminalId);
  if (!terminal) return null;
  const rotated = rotatePartPointMm(part, terminal, placement.rotation);
  return {
    xMm: roundMm(placement.xMm + rotated.xMm),
    yMm: roundMm(placement.yMm + rotated.yMm),
  };
}

function validatePart(part: PhysicalPartDefinitionMm): BreadboardPartSnapFailure | null {
  if (!finitePositive(part.widthMm) || !finitePositive(part.heightMm) || part.terminals.length === 0) {
    return {
      ok: false,
      code: 'invalid_part_geometry',
      message: 'Компонент должен иметь положительные физические размеры и хотя бы один вывод.',
    };
  }
  const ids = new Set<TerminalId>();
  for (const terminal of part.terminals) {
    if (
      !terminal.id ||
      ids.has(terminal.id) ||
      !Number.isFinite(terminal.xMm) ||
      !Number.isFinite(terminal.yMm) ||
      terminal.xMm < 0 ||
      terminal.yMm < 0 ||
      terminal.xMm > part.widthMm ||
      terminal.yMm > part.heightMm
    ) {
      return {
        ok: false,
        code: 'invalid_part_geometry',
        message: `Некорректная физическая геометрия вывода ${terminal.id || '<empty>'}.`,
        terminalId: terminal.id,
      };
    }
    ids.add(terminal.id);
  }
  return null;
}

/**
 * Snap a physically calibrated part to a placed breadboard.
 *
 * 1. The anchor terminal chooses the nearest physical hole.
 * 2. The entire part translates so that anchor terminal and hole coincide.
 * 3. Every required terminal must then coincide with a distinct hole within
 *    tolerance. This prevents pixel-only placement that looks connected but is
 *    electrically impossible on a real solderless breadboard.
 */
export function snapPartToBreadboard(
  board: BreadboardDefinition,
  boardPlacement: BreadboardPlacementMm,
  part: PhysicalPartDefinitionMm,
  proposedPlacement: PhysicalPartPlacementMm,
  anchorTerminalId: TerminalId,
  options: {
    readonly anchorSearchRadiusMm?: number;
    readonly terminalToleranceMm?: number;
  } = {},
): BreadboardPartSnapResult {
  const invalid = validatePart(part);
  if (invalid) return invalid;
  const anchorTerminal = part.terminals.find((terminal) => terminal.id === anchorTerminalId);
  if (!anchorTerminal) {
    return {
      ok: false,
      code: 'anchor_terminal_missing',
      message: `Якорный вывод ${anchorTerminalId} отсутствует у компонента.`,
      terminalId: anchorTerminalId,
    };
  }

  const proposedAnchor = partTerminalWorldMm(part, proposedPlacement, anchorTerminalId)!;
  const anchorNearest = nearestBreadboardHole(board, boardPlacement, proposedAnchor, {
    maximumDistanceMm: options.anchorSearchRadiusMm ?? BREADBOARD_HOLE_PITCH_MM * 1.5,
  });
  if (!anchorNearest) {
    return {
      ok: false,
      code: 'anchor_hole_not_found',
      message: 'Рядом с якорным выводом нет отверстия макетной платы.',
      terminalId: anchorTerminalId,
    };
  }
  const anchorWorld = breadboardHoleWorldMm(board, anchorNearest.hole.id, boardPlacement)!;
  const placement: PhysicalPartPlacementMm = {
    xMm: roundMm(proposedPlacement.xMm + anchorWorld.xMm - proposedAnchor.xMm),
    yMm: roundMm(proposedPlacement.yMm + anchorWorld.yMm - proposedAnchor.yMm),
    rotation: proposedPlacement.rotation,
  };

  const assignments: BreadboardTerminalAssignment[] = [];
  const occupiedHoles = new Set<string>();
  const tolerance = options.terminalToleranceMm ?? BREADBOARD_HOLE_PITCH_MM * 0.12;
  for (const terminal of part.terminals.filter((candidate) => candidate.requiresHole !== false)) {
    const before = partTerminalWorldMm(part, proposedPlacement, terminal.id)!;
    const after = partTerminalWorldMm(part, placement, terminal.id)!;
    const nearest = nearestBreadboardHole(board, boardPlacement, after, {
      maximumDistanceMm: tolerance,
    });
    if (!nearest) {
      return {
        ok: false,
        code: 'terminal_hole_not_found',
        message: `Вывод ${terminal.id} не совпадает с отверстием после привязки.`,
        terminalId: terminal.id,
      };
    }
    if (occupiedHoles.has(nearest.hole.id)) {
      return {
        ok: false,
        code: 'terminals_collide_on_one_hole',
        message: `Несколько выводов компонента попали в отверстие ${nearest.hole.id}.`,
        terminalId: terminal.id,
      };
    }
    occupiedHoles.add(nearest.hole.id);
    const holeWorld = breadboardHoleWorldMm(board, nearest.hole.id, boardPlacement)!;
    assignments.push({
      terminalId: terminal.id,
      hole: nearest.hole,
      distanceBeforeSnapMm: Math.hypot(before.xMm - holeWorld.xMm, before.yMm - holeWorld.yMm),
      distanceAfterSnapMm: Math.hypot(after.xMm - holeWorld.xMm, after.yMm - holeWorld.yMm),
    });
  }

  return {
    ok: true,
    placement,
    assignments,
    maximumErrorMm: Math.max(0, ...assignments.map((assignment) => assignment.distanceAfterSnapMm)),
  };
}
