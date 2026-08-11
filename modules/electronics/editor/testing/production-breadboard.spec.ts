import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  connectedHoleIds,
  snapFootprint,
  validatePlacement,
  type BreadboardDefinition,
} from '../breadboard-contracts';

interface OwnerCatalogManifest {
  breadboards: BreadboardDefinition[];
  components: Array<{
    componentId: string;
    footprint: { pinOffsetsMm?: number[][] } | null;
  }>;
}

const manifest = JSON.parse(
  readFileSync(
    resolve(process.cwd(), 'apps/web/public/assets/electronics/owner-catalog/manifest.json'),
    'utf8',
  ),
) as OwnerCatalogManifest;

const board = (componentId: string) => {
  const result = manifest.breadboards.find((candidate) => candidate.componentId === componentId);
  expect(result, componentId).toBeDefined();
  return result as BreadboardDefinition;
};

const footprint = (componentId: string) =>
  manifest.components.find((item) => item.componentId === componentId)?.footprint?.pinOffsetsMm;

describe('breadboard fit and internal connectivity contracts', () => {
  it('models all three owner breadboards at exact 2.54mm pitch with stable hole IDs', () => {
    expect(manifest.breadboards.map((item) => item.holes.length)).toEqual([170, 420, 882]);
    for (const item of manifest.breadboards) {
      expect(item.pitchMm).toBe(2.54);
      expect(new Set(item.holes.map((hole) => hole.id)).size).toBe(item.holes.length);
      for (const hole of item.holes) {
        expect(item.groups[hole.groupId]).toContain(hole.id);
      }
    }
  });

  it('preserves continuous rails and the four physical center breaks on the 882 board', () => {
    const railGroups = (item: BreadboardDefinition) =>
      Object.keys(item.groups).filter((groupId) => groupId.startsWith('rail-'));
    expect(railGroups(board('breadboard-small'))).toHaveLength(0);
    const medium = board('breadboard-medium');
    expect(railGroups(medium)).toHaveLength(4);
    const continuousRail = medium.groups['rail-top-negative'];
    expect(connectedHoleIds(medium, continuousRail[0] as string)).toContain(continuousRail.at(-1));
    const large = board('breadboard-large');
    expect(railGroups(large)).toHaveLength(8);
    for (const polarity of ['negative', 'positive']) {
      for (const position of ['top', 'bottom']) {
        const left = large.groups[`rail-${position}-${polarity}-left`];
        const right = large.groups[`rail-${position}-${polarity}-right`];
        expect(connectedHoleIds(large, left.at(-1) as string)).not.toContain(right[0] as string);
      }
    }
  });

  it('snaps a four-pin button footprint and rejects a placement beyond 0.25mm', () => {
    const small = board('breadboard-small');
    const buttonFootprint = footprint('button-tactile-6mm');
    expect(buttonFootprint).toBeDefined();
    const origin = small.holes.find((hole) => hole.id === 'J1');
    expect(origin).toBeDefined();
    const pins = (buttonFootprint ?? []).map(([dxMm, dyMm], index) => ({
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
      [10.16, 0],
    ]);
    expect(footprint('diode-do41')).toEqual([
      [0, 0],
      [7.62, 0],
    ]);
    expect(footprint('incandescent-lamp')).toEqual([
      [0, 0],
      [2.54, 0],
    ]);
    expect(footprint('transistor-npn')).toEqual([
      [0, 0],
      [-2.54, 0],
      [2.54, 0],
    ]);
    expect(footprint('seven-segment-display')).toHaveLength(10);
  });
});
