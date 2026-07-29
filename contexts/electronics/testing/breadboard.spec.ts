import { describe, expect, it } from 'vitest';
import {
  BREADBOARD_CENTER_GAP_MM,
  BREADBOARD_HOLE_PITCH_MM,
  areBreadboardHolesConnected,
  breadboardBusMembers,
  breadboardEnvelopeMm,
  breadboardHoleWorldMm,
  breadboardInternalBusMap,
  createBreadboardDefinition,
  expectedBreadboardTiePointCount,
  nearestBreadboardHole,
  rotateBreadboardPointMm,
  type BreadboardKind,
} from '../domain/breadboard';

const kinds: BreadboardKind[] = ['mini-170', 'half-400', 'full-830'];

describe('physical breadboard topology', () => {
  it.each([
    ['mini-170', 170, 47, 35, 10],
    ['half-400', 400, 83.5, 54.5, 8.5],
    ['full-830', 830, 165.1, 54.29, 9.68],
  ] as const)(
    '%s has the declared tie-point count and mechanical envelope',
    (kind, count, width, height, thickness) => {
      const board = createBreadboardDefinition(kind);
      expect(board.holes).toHaveLength(count);
      expect(expectedBreadboardTiePointCount(kind)).toBe(count);
      expect(board.widthMm).toBe(width);
      expect(board.heightMm).toBe(height);
      expect(board.thicknessMm).toBe(thickness);
      expect(board.pitchMm).toBe(BREADBOARD_HOLE_PITCH_MM);
      expect(board.evidence.geometrySource).toContain(`${width}`);
      expect(board.evidence.referenceParityStatus).toBe('evidence_required');
    },
  );

  it.each(kinds)('%s connects five terminal holes in one column and one side only', (kind) => {
    const board = createBreadboardDefinition(kind);
    const upper = ['a', 'b', 'c', 'd', 'e'].map((row) => `${kind}:terminal:1:${row}`);
    const lower = ['f', 'g', 'h', 'i', 'j'].map((row) => `${kind}:terminal:1:${row}`);
    for (const hole of upper) {
      expect(areBreadboardHolesConnected(board, upper[0]!, hole)).toBe(true);
    }
    for (const hole of lower) {
      expect(areBreadboardHolesConnected(board, lower[0]!, hole)).toBe(true);
    }
    expect(areBreadboardHolesConnected(board, upper[0]!, lower[0]!)).toBe(false);
    expect(areBreadboardHolesConnected(board, upper[0]!, `${kind}:terminal:2:a`)).toBe(false);
    expect(breadboardBusMembers(board, upper[0]!)).toHaveLength(5);
  });

  it('keeps the centre channel at the standard 0.3 inch separation', () => {
    const board = createBreadboardDefinition('half-400');
    const e = board.holes.find((hole) => hole.id === 'half-400:terminal:1:e')!;
    const f = board.holes.find((hole) => hole.id === 'half-400:terminal:1:f')!;
    expect(f.yMm - e.yMm).toBeCloseTo(BREADBOARD_CENTER_GAP_MM, 6);
  });

  it('uses four isolated continuous 25-hole rails on the half-size board', () => {
    const board = createBreadboardDefinition('half-400');
    const first = 'half-400:rail:top-positive:1';
    const last = 'half-400:rail:top-positive:25';
    expect(areBreadboardHolesConnected(board, first, last)).toBe(true);
    expect(breadboardBusMembers(board, first)).toHaveLength(25);
    expect(
      areBreadboardHolesConnected(board, first, 'half-400:rail:top-negative:1'),
    ).toBe(false);
    expect(
      areBreadboardHolesConnected(board, first, 'half-400:rail:bottom-positive:1'),
    ).toBe(false);
  });

  it('models each full-size 50-hole rail as two isolated 25-hole segments', () => {
    const board = createBreadboardDefinition('full-830');
    expect(
      areBreadboardHolesConnected(
        board,
        'full-830:rail:top-positive:1',
        'full-830:rail:top-positive:25',
      ),
    ).toBe(true);
    expect(
      areBreadboardHolesConnected(
        board,
        'full-830:rail:top-positive:26',
        'full-830:rail:top-positive:50',
      ),
    ).toBe(true);
    expect(
      areBreadboardHolesConnected(
        board,
        'full-830:rail:top-positive:25',
        'full-830:rail:top-positive:26',
      ),
    ).toBe(false);
    expect(breadboardBusMembers(board, 'full-830:rail:top-positive:1')).toHaveLength(25);
  });

  it.each(kinds)('%s keeps every generated hole inside the physical board', (kind) => {
    const board = createBreadboardDefinition(kind);
    const ids = new Set<string>();
    for (const hole of board.holes) {
      expect(ids.has(hole.id)).toBe(false);
      ids.add(hole.id);
      expect(hole.xMm).toBeGreaterThanOrEqual(0);
      expect(hole.xMm).toBeLessThanOrEqual(board.widthMm);
      expect(hole.yMm).toBeGreaterThanOrEqual(0);
      expect(hole.yMm).toBeLessThanOrEqual(board.heightMm);
    }
  });

  it('exposes deterministic internal bus groups for netlist expansion', () => {
    const board = createBreadboardDefinition('half-400');
    const buses = breadboardInternalBusMap(board);
    expect(buses.get('half-400:terminal:1:upper')).toHaveLength(5);
    expect(buses.get('half-400:terminal:1:lower')).toHaveLength(5);
    expect(buses.get('half-400:rail:top-positive:continuous')).toHaveLength(25);
    expect([...buses.values()].reduce((count, holes) => count + holes.length, 0)).toBe(400);
  });
});

describe('breadboard physical placement', () => {
  it.each(kinds)('%s swaps its physical envelope at 90 and 270 degrees', (kind) => {
    const board = createBreadboardDefinition(kind);
    expect(breadboardEnvelopeMm(board, 0)).toEqual({
      widthMm: board.widthMm,
      heightMm: board.heightMm,
    });
    expect(breadboardEnvelopeMm(board, 90)).toEqual({
      widthMm: board.heightMm,
      heightMm: board.widthMm,
    });
    expect(breadboardEnvelopeMm(board, 270)).toEqual({
      widthMm: board.heightMm,
      heightMm: board.widthMm,
    });
  });

  it('rotates a local hole without changing its stable ID or electrical bus', () => {
    const board = createBreadboardDefinition('mini-170');
    const hole = board.holes.find((candidate) => candidate.id === 'mini-170:terminal:1:a')!;
    const rotated = rotateBreadboardPointMm(board, hole, 90);
    expect(rotated.xMm).toBeCloseTo(board.heightMm - hole.yMm, 6);
    expect(rotated.yMm).toBeCloseTo(hole.xMm, 6);

    const world = breadboardHoleWorldMm(board, hole.id, {
      xMm: 100,
      yMm: 50,
      rotation: 90,
    })!;
    expect(world.xMm).toBeCloseTo(100 + rotated.xMm, 6);
    expect(world.yMm).toBeCloseTo(50 + rotated.yMm, 6);
    expect(breadboardBusMembers(board, hole.id).map((member) => member.id)).toContain(hole.id);
  });

  it.each([0, 90, 180, 270] as const)(
    'finds the nearest stable hole after %s degree placement',
    (rotation) => {
      const board = createBreadboardDefinition('half-400');
      const targetId = 'half-400:terminal:12:d';
      const placement = { xMm: 250, yMm: 110, rotation };
      const target = breadboardHoleWorldMm(board, targetId, placement)!;
      const nearest = nearestBreadboardHole(
        board,
        placement,
        { xMm: target.xMm + 0.25, yMm: target.yMm - 0.2 },
        { maximumDistanceMm: 0.5 },
      );
      expect(nearest?.hole.id).toBe(targetId);
      expect(nearest?.distanceMm).toBeLessThan(0.5);
    },
  );

  it('does not snap a terminal when no hole is within the declared radius', () => {
    const board = createBreadboardDefinition('mini-170');
    const nearest = nearestBreadboardHole(
      board,
      { xMm: 0, yMm: 0, rotation: 0 },
      { xMm: 200, yMm: 200 },
    );
    expect(nearest).toBeNull();
  });

  it('can restrict snapping to terminal strips or power rails', () => {
    const board = createBreadboardDefinition('half-400');
    const placement = { xMm: 0, yMm: 0, rotation: 0 as const };
    const rail = board.holes.find((hole) => hole.id === 'half-400:rail:top-positive:4')!;
    expect(
      nearestBreadboardHole(board, placement, rail, {
        region: 'power-rail',
        maximumDistanceMm: 0.1,
      })?.hole.id,
    ).toBe(rail.id);
    expect(
      nearestBreadboardHole(board, placement, rail, {
        region: 'terminal-strip',
        maximumDistanceMm: 0.1,
      }),
    ).toBeNull();
  });
});
