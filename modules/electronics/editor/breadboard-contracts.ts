import { PIN_ANCHOR_TOLERANCE_MM } from './production-asset-contracts';

export interface BreadboardHole {
  readonly id: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly groupId: string;
  readonly kind: string;
}

export interface BreadboardDefinition {
  readonly componentId: string;
  readonly pitchMm: number;
  readonly holes: readonly BreadboardHole[];
  readonly groups: Readonly<Record<string, readonly string[]>>;
}

export interface FootprintPin {
  readonly pinId: string;
  readonly dxMm: number;
  readonly dyMm: number;
}

export interface FootprintPlacement {
  readonly originMm: { readonly x: number; readonly y: number };
  readonly pins: readonly FootprintPin[];
}

export interface SnappedFootprintPin extends FootprintPin {
  readonly holeId: string;
  readonly errorMm: number;
}

export function nearestHole(
  holes: readonly BreadboardHole[],
  point: { readonly x: number; readonly y: number },
): { readonly hole: BreadboardHole; readonly errorMm: number } | null {
  let nearest: { hole: BreadboardHole; errorMm: number } | null = null;
  for (const hole of holes) {
    const errorMm = Math.hypot(hole.xMm - point.x, hole.yMm - point.y);
    if (nearest === null || errorMm < nearest.errorMm) nearest = { hole, errorMm };
  }
  return nearest;
}

export function snapFootprint(
  board: BreadboardDefinition,
  placement: FootprintPlacement,
): readonly SnappedFootprintPin[] | null {
  const snapped: SnappedFootprintPin[] = [];
  for (const pin of placement.pins) {
    const target = {
      x: placement.originMm.x + pin.dxMm,
      y: placement.originMm.y + pin.dyMm,
    };
    const nearest = nearestHole(board.holes, target);
    if (nearest === null || nearest.errorMm > PIN_ANCHOR_TOLERANCE_MM) return null;
    snapped.push({ ...pin, holeId: nearest.hole.id, errorMm: nearest.errorMm });
  }
  if (new Set(snapped.map((pin) => pin.holeId)).size !== snapped.length) return null;
  return snapped;
}

export function validatePlacement(
  board: BreadboardDefinition,
  placement: FootprintPlacement,
): {
  readonly valid: boolean;
  readonly reason: string;
  readonly pins: readonly SnappedFootprintPin[];
} {
  const pins = snapFootprint(board, placement);
  if (pins === null) return { valid: false, reason: 'pin_outside_snap_tolerance', pins: [] };
  return { valid: true, reason: 'all_pins_snapped', pins };
}

export function connectedHoleIds(board: BreadboardDefinition, holeId: string): readonly string[] {
  const hole = board.holes.find((candidate) => candidate.id === holeId);
  return hole ? (board.groups[hole.groupId] ?? []) : [];
}
