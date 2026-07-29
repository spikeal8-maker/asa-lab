import { describe, expect, it } from 'vitest';
import {
  BREADBOARD_CENTER_GAP_MM,
  BREADBOARD_HOLE_PITCH_MM,
  areBreadboardHolesConnected,
  breadboardBusMembers,
  createBreadboardDefinition,
  expectedBreadboardTiePointCount,
  type BreadboardKind,
} from '../domain/breadboard';

const kinds: BreadboardKind[] = ['mini-170', 'half-400', 'full-830'];

describe('physical breadboard topology', () => {
  it.each([
    ['mini-170', 170, 47, 35, 10],
    ['half-400', 400, 82.6, 55, 9.3],
    ['full-830', 830, 165.1, 54.29, 9.68],
  ] as const)('%s has the declared tie-point count and physical envelope', (kind, count, width, height, thickness) => {
    const board = createBreadboardDefinition(kind);
    expect(board.holes).toHaveLength(count);
    expect(expectedBreadboardTiePointCount(kind)).toBe(count);
    expect(board.widthMm).toBe(width);
    expect(board.heightMm).toBe(height);
    expect(board.thicknessMm).toBe(thickness);
    expect(board.pitchMm).toBe(BREADBOARD_HOLE_PITCH_MM);
    expect(board.evidence.referenceParityStatus).toBe('evidence_required');
  });

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
      areBreadboardHolesConnected(
        board,
        first,
        'half-400:rail:top-negative:1',
      ),
    ).toBe(false);
    expect(
      areBreadboardHolesConnected(
        board,
        first,
        'half-400:rail:bottom-positive:1',
      ),
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
});
