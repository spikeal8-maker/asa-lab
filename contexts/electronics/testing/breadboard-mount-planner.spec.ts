import { describe, expect, it } from 'vitest';
import { breadboardHoleWorldMm, createBreadboardDefinition } from '../domain/breadboard';
import {
  occupancyFromAssignments,
  planPartMountToBreadboard,
  type BreadboardHoleOccupant,
} from '../domain/breadboard-mount-planner';
import type { PhysicalPartDefinitionMm } from '../domain/breadboard-placement';

const board = createBreadboardDefinition('mini-170');
const boardPlacement = { xMm: 100, yMm: 40, rotation: 0 as const };
const resistor: PhysicalPartDefinitionMm = {
  widthMm: 25.4,
  heightMm: 2.5,
  terminals: [
    { id: 'a', xMm: 0, yMm: 1.25 },
    { id: 'b', xMm: 25.4, yMm: 1.25 },
  ],
};

function proposedAtHole(holeId: string) {
  const hole = breadboardHoleWorldMm(board, holeId, boardPlacement)!;
  return { xMm: hole.xMm, yMm: hole.yMm - 1.25, rotation: 0 as const };
}

describe('occupancy-aware breadboard mount planner', () => {
  it('uses the nearest valid all-terminal footprint deterministically', () => {
    const result = planPartMountToBreadboard(
      board,
      boardPlacement,
      resistor,
      proposedAtHole('mini-170:terminal:1:a'),
      'a',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.anchorHole.id).toBe('mini-170:terminal:1:a');
    expect(result.assignments.map((assignment) => assignment.hole.id)).toEqual([
      'mini-170:terminal:1:a',
      'mini-170:terminal:11:a',
    ]);
    expect(result.attemptedCandidateCount).toBe(1);
  });

  it('skips an occupied nearest footprint and chooses another valid candidate', () => {
    const occupant: BreadboardHoleOccupant = {
      componentId: 'existing',
      terminalId: 'a',
      conductorType: 'component_lead',
    };
    const occupancy = new Map([
      ['mini-170:terminal:1:a', occupant],
      ['mini-170:terminal:11:a', { ...occupant, terminalId: 'b' }],
    ]);
    const result = planPartMountToBreadboard(
      board,
      boardPlacement,
      resistor,
      proposedAtHole('mini-170:terminal:1:a'),
      'a',
      occupancy,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attemptedCandidateCount).toBeGreaterThan(1);
    expect(result.assignments.some((assignment) => occupancy.has(assignment.hole.id))).toBe(false);
  });

  it('allows a moving component to replace its own previous occupancy', () => {
    const occupancy = new Map<string, BreadboardHoleOccupant>([
      [
        'mini-170:terminal:1:a',
        { componentId: 'moving', terminalId: 'a', conductorType: 'component_lead' },
      ],
      [
        'mini-170:terminal:11:a',
        { componentId: 'moving', terminalId: 'b', conductorType: 'component_lead' },
      ],
    ]);
    const result = planPartMountToBreadboard(
      board,
      boardPlacement,
      resistor,
      proposedAtHole('mini-170:terminal:1:a'),
      'a',
      occupancy,
      { movingComponentId: 'moving' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.anchorHole.id).toBe('mini-170:terminal:1:a');
    expect(result.attemptedCandidateCount).toBe(1);
  });

  it('returns an explicit occupied-hole failure when every nearby footprint is blocked', () => {
    const occupancy = new Map<string, BreadboardHoleOccupant>();
    for (const hole of board.holes) {
      occupancy.set(hole.id, {
        componentId: `occupied-${hole.id}`,
        terminalId: 'a',
        conductorType: 'wire_endpoint',
      });
    }
    const result = planPartMountToBreadboard(
      board,
      boardPlacement,
      resistor,
      proposedAtHole('mini-170:terminal:1:a'),
      'a',
      occupancy,
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'breadboard_hole_occupied',
      terminalId: expect.any(String),
      occupiedHoleId: expect.any(String),
      occupant: { conductorType: 'wire_endpoint' },
    });
    expect(result.attemptedCandidateCount).toBeGreaterThan(0);
  });

  it('does not pull a part onto a distant board', () => {
    expect(
      planPartMountToBreadboard(
        board,
        boardPlacement,
        resistor,
        { xMm: 1000, yMm: 1000, rotation: 0 },
        'a',
      ),
    ).toMatchObject({ ok: false, code: 'anchor_hole_not_found', attemptedCandidateCount: 0 });
  });

  it('builds occupancy maps without duplicate physical holes', () => {
    const result = planPartMountToBreadboard(
      board,
      boardPlacement,
      resistor,
      proposedAtHole('mini-170:terminal:1:a'),
      'a',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const occupancy = occupancyFromAssignments('r1', result.assignments);
    expect(occupancy.size).toBe(2);
    expect(occupancy.get('mini-170:terminal:1:a')).toMatchObject({
      componentId: 'r1',
      terminalId: 'a',
      conductorType: 'component_lead',
    });
    expect(() =>
      occupancyFromAssignments('bad', [result.assignments[0]!, result.assignments[0]!]),
    ).toThrow(/duplicate occupancy assignment/);
  });
});
