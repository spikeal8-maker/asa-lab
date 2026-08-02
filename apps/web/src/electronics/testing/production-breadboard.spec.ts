import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  connectedHoleIds,
  snapFootprint,
  validatePlacement,
  type BreadboardDefinition,
} from '../breadboard-contracts';

interface ConnectivityManifest {
  placementRules: { snapToleranceMm: number; requiredPitchMm: number };
  boards: Array<
    BreadboardDefinition & {
      physicalWidthMm: number;
      physicalHeightMm: number;
      powerRailGroups: string[];
      railBreaks: Array<{
        rail: string;
        afterHoleId: string;
        beforeHoleId: string;
        electricallyConnectedAcrossBreak: boolean;
      }>;
      railBreaksPreserved: boolean;
    }
  >;
  componentFootprints: Array<{
    componentId: string;
    pinOffsetsMm: number[][];
  }>;
}

const manifest = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      'apps/web/public/assets/electronics/production/breadboard-connectivity.json',
    ),
    'utf8',
  ),
) as ConnectivityManifest;

const board = (componentId: string) => {
  const result = manifest.boards.find((candidate) => candidate.componentId === componentId);
  expect(result, componentId).toBeDefined();
  return result as ConnectivityManifest['boards'][number];
};

describe('breadboard fit and internal connectivity contracts', () => {
  it('models all three owner breadboards at exact 2.54mm pitch with stable hole IDs', () => {
    expect(manifest.placementRules).toEqual({
      snapToleranceMm: 0.25,
      requiredPitchMm: 2.54,
      rotationDegrees: [0, 90, 180, 270],
    });
    expect(manifest.boards.map((item) => item.holes.length)).toEqual([170, 420, 882]);
    for (const item of manifest.boards) {
      expect(item.pitchMm).toBe(2.54);
      expect(new Set(item.holes.map((hole) => hole.id)).size).toBe(item.holes.length);
      expect(item.railBreaksPreserved).toBe(true);
      for (const hole of item.holes) {
        expect(item.groups[hole.groupId]).toContain(hole.id);
      }
    }
  });

  it('preserves continuous rails and the four physical center breaks on the 882 board', () => {
    expect(board('breadboard-small').powerRailGroups).toHaveLength(0);
    expect(board('breadboard-medium').powerRailGroups).toHaveLength(4);
    const large = board('breadboard-large');
    expect(large.powerRailGroups).toHaveLength(8);
    expect(large.railBreaks).toHaveLength(4);
    for (const gap of large.railBreaks) {
      expect(gap.electricallyConnectedAcrossBreak).toBe(false);
      expect(connectedHoleIds(large, gap.afterHoleId)).not.toContain(gap.beforeHoleId);
    }
  });

  it('snaps a four-pin button footprint and rejects a placement beyond 0.25mm', () => {
    const small = board('breadboard-small');
    const footprint = manifest.componentFootprints.find(
      (item) => item.componentId === 'button-tactile-6mm',
    );
    expect(footprint).toBeDefined();
    const origin = small.holes.find((hole) => hole.id === 'J1');
    expect(origin).toBeDefined();
    const pins = (footprint?.pinOffsetsMm ?? []).map(([dxMm, dyMm], index) => ({
      pinId: `pin-${index + 1}`,
      dxMm: dxMm as number,
      dyMm: dyMm as number,
    }));
    const placement = { originMm: { x: origin?.xMm as number, y: origin?.yMm as number }, pins };
    const snapped = snapFootprint(small, placement);
    expect(snapped).not.toBeNull();
    expect(snapped).toHaveLength(4);
    expect(snapped?.every((pin) => pin.errorMm <= 0.25)).toBe(true);
    expect(
      validatePlacement(small, {
        ...placement,
        originMm: { x: placement.originMm.x + 0.4, y: placement.originMm.y },
      }),
    ).toMatchObject({
      valid: false,
      reason: 'pin_outside_snap_tolerance',
    });
  });

  it('uses pitch-derived landing widths for axial, inline and display components', () => {
    const footprint = (componentId: string) =>
      manifest.componentFootprints.find((item) => item.componentId === componentId)?.pinOffsetsMm;
    expect(footprint('resistor-axial')).toEqual([
      [0, 0],
      [0, 10.16],
    ]);
    expect(footprint('potentiometer')).toEqual([
      [0, 0],
      [5.08, 0],
      [2.54, 0],
    ]);
    expect(footprint('diode-do35')).toEqual([
      [0, 0],
      [7.62, 0],
    ]);
    expect(footprint('diode-do41')).toEqual([
      [0, 0],
      [7.62, 0],
    ]);
    expect(footprint('incandescent-lamp')).toEqual([
      [0, 0],
      [2.54, 0],
    ]);
    expect(footprint('seven-segment-display')).toHaveLength(10);
  });
});
