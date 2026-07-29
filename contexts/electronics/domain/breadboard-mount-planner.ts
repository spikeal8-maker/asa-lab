import {
  BREADBOARD_HOLE_PITCH_MM,
  breadboardHoleWorldMm,
  type BreadboardDefinition,
  type BreadboardHole,
  type BreadboardPlacementMm,
} from './breadboard.js';
import {
  partTerminalWorldMm,
  snapPartToBreadboard,
  type BreadboardPartSnapFailure,
  type BreadboardPartSnapSuccess,
  type PhysicalPartDefinitionMm,
  type PhysicalPartPlacementMm,
} from './breadboard-placement.js';
import type { TerminalId } from './component-model.js';

export interface BreadboardHoleOccupant {
  readonly componentId: string;
  readonly terminalId: TerminalId;
  readonly conductorType: 'component_lead' | 'wire_endpoint' | 'instrument_probe';
}

export type BreadboardOccupancy = ReadonlyMap<string, BreadboardHoleOccupant>;

export interface PlannedBreadboardMount extends BreadboardPartSnapSuccess {
  readonly anchorHole: BreadboardHole;
  readonly anchorDistanceBeforeSnapMm: number;
  readonly attemptedCandidateCount: number;
}

export type BreadboardMountFailure = BreadboardPartSnapFailure & {
  readonly attemptedCandidateCount: number;
  readonly occupiedHoleId?: string;
  readonly occupant?: BreadboardHoleOccupant;
};

export type BreadboardMountPlan = PlannedBreadboardMount | BreadboardMountFailure;

export interface PlanBreadboardMountOptions {
  readonly anchorSearchRadiusMm?: number;
  readonly terminalToleranceMm?: number;
  /** Existing attachments belonging to this component are replaceable. */
  readonly movingComponentId?: string;
}

interface CandidateAnchor {
  readonly hole: BreadboardHole;
  readonly world: { readonly xMm: number; readonly yMm: number };
  readonly distanceMm: number;
}

function roundMm(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function candidatesNearAnchor(
  board: BreadboardDefinition,
  boardPlacement: BreadboardPlacementMm,
  proposedAnchor: { readonly xMm: number; readonly yMm: number },
  maximumDistanceMm: number,
): CandidateAnchor[] {
  return board.holes
    .map((hole) => {
      const world = breadboardHoleWorldMm(board, hole.id, boardPlacement)!;
      return {
        hole,
        world,
        distanceMm: Math.hypot(world.xMm - proposedAnchor.xMm, world.yMm - proposedAnchor.yMm),
      };
    })
    .filter((candidate) => candidate.distanceMm <= maximumDistanceMm)
    .sort(
      (left, right) =>
        left.distanceMm - right.distanceMm || left.hole.id.localeCompare(right.hole.id),
    );
}

function occupancyConflict(
  snap: BreadboardPartSnapSuccess,
  occupancy: BreadboardOccupancy,
  movingComponentId?: string,
): { readonly holeId: string; readonly occupant: BreadboardHoleOccupant } | null {
  for (const assignment of snap.assignments) {
    const occupant = occupancy.get(assignment.hole.id);
    if (!occupant || occupant.componentId === movingComponentId) continue;
    return { holeId: assignment.hole.id, occupant };
  }
  return null;
}

/**
 * Plan an all-terminal physical mount using deterministic candidate ranking.
 *
 * Unlike a visual nearest-point snap, the planner can skip a nearer anchor when
 * another lead would miss a hole or when any target hole is already occupied.
 * The function never mutates a document or occupancy map.
 */
export function planPartMountToBreadboard(
  board: BreadboardDefinition,
  boardPlacement: BreadboardPlacementMm,
  part: PhysicalPartDefinitionMm,
  proposedPlacement: PhysicalPartPlacementMm,
  anchorTerminalId: TerminalId,
  occupancy: BreadboardOccupancy = new Map(),
  options: PlanBreadboardMountOptions = {},
): BreadboardMountPlan {
  const proposedAnchor = partTerminalWorldMm(part, proposedPlacement, anchorTerminalId);
  if (!proposedAnchor) {
    return {
      ok: false,
      code: 'anchor_terminal_missing',
      message: `Якорный вывод ${anchorTerminalId} отсутствует у компонента.`,
      terminalId: anchorTerminalId,
      attemptedCandidateCount: 0,
    };
  }

  const radius = options.anchorSearchRadiusMm ?? BREADBOARD_HOLE_PITCH_MM * 1.5;
  const candidates = candidatesNearAnchor(board, boardPlacement, proposedAnchor, radius);
  if (candidates.length === 0) {
    return {
      ok: false,
      code: 'anchor_hole_not_found',
      message: 'Рядом с якорным выводом нет отверстия макетной платы.',
      terminalId: anchorTerminalId,
      attemptedCandidateCount: 0,
    };
  }

  const localAnchor = partTerminalWorldMm(
    part,
    { xMm: 0, yMm: 0, rotation: proposedPlacement.rotation },
    anchorTerminalId,
  )!;
  let lastGeometryFailure: BreadboardPartSnapFailure | null = null;
  let firstOccupancyConflict:
    | { readonly holeId: string; readonly occupant: BreadboardHoleOccupant }
    | null = null;
  let attemptedCandidateCount = 0;

  for (const candidate of candidates) {
    attemptedCandidateCount += 1;
    const candidatePlacement: PhysicalPartPlacementMm = {
      xMm: roundMm(candidate.world.xMm - localAnchor.xMm),
      yMm: roundMm(candidate.world.yMm - localAnchor.yMm),
      rotation: proposedPlacement.rotation,
    };
    const snap = snapPartToBreadboard(
      board,
      boardPlacement,
      part,
      candidatePlacement,
      anchorTerminalId,
      {
        anchorSearchRadiusMm: Math.max(0.01, options.terminalToleranceMm ?? 0.01),
        ...(options.terminalToleranceMm === undefined
          ? {}
          : { terminalToleranceMm: options.terminalToleranceMm }),
      },
    );
    if (!snap.ok) {
      lastGeometryFailure = snap;
      continue;
    }
    const conflict = occupancyConflict(snap, occupancy, options.movingComponentId);
    if (conflict) {
      firstOccupancyConflict ??= conflict;
      continue;
    }
    return {
      ...snap,
      anchorHole: candidate.hole,
      anchorDistanceBeforeSnapMm: candidate.distanceMm,
      attemptedCandidateCount,
    };
  }

  if (firstOccupancyConflict) {
    return {
      ok: false,
      code: 'terminals_collide_on_one_hole',
      message: `Отверстие ${firstOccupancyConflict.holeId} уже занято другим проводником.`,
      attemptedCandidateCount,
      occupiedHoleId: firstOccupancyConflict.holeId,
      occupant: firstOccupancyConflict.occupant,
    };
  }
  if (lastGeometryFailure) {
    return { ...lastGeometryFailure, attemptedCandidateCount };
  }
  return {
    ok: false,
    code: 'terminal_hole_not_found',
    message: 'Ни один допустимый набор отверстий не соответствует геометрии компонента.',
    attemptedCandidateCount,
  };
}

export function occupancyFromAssignments(
  componentId: string,
  assignments: readonly { readonly terminalId: TerminalId; readonly hole: BreadboardHole }[],
): Map<string, BreadboardHoleOccupant> {
  const occupancy = new Map<string, BreadboardHoleOccupant>();
  for (const assignment of assignments) {
    if (occupancy.has(assignment.hole.id)) {
      throw new Error(`duplicate occupancy assignment for ${assignment.hole.id}`);
    }
    occupancy.set(assignment.hole.id, {
      componentId,
      terminalId: assignment.terminalId,
      conductorType: 'component_lead',
    });
  }
  return occupancy;
}
