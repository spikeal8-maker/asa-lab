import { describe, expect, it } from 'vitest';
import type { SchematicDocument } from '../../apps/web/src/api';
import {
  WORKBENCH_CATALOG,
  catalogEntry,
  componentPhysicalSummary,
  physicalEvidenceLabel,
  renderedSize,
  renderedSizeMillimetres,
  snapComponentOrigin,
  terminalIds,
  terminalPosition,
  terminalSpec,
} from '../../apps/web/src/electronics/component-catalog';
import {
  addComponentToDocument,
  duplicateComponentInDocument,
  rotateSelectionInDocument,
} from '../../apps/web/src/electronics/workbench-document';
import {
  BREADBOARD_PITCH_MM,
  BREADBOARD_PITCH_UNITS,
  HALF_PITCH_UNITS,
  STAGE_HEIGHT_MM,
  STAGE_WIDTH_MM,
  isOnWorkbenchGrid,
  mmToWorkbenchUnits,
  workbenchUnitsToMm,
} from '../../apps/web/src/electronics/workbench-scale';

const empty: SchematicDocument = {
  schemaVersion: 1,
  geometryProfile: 'breadboard-2.54mm-v1',
  components: [],
  connections: [],
};

function centerOf(component: SchematicDocument['components'][number]) {
  const entry = catalogEntry(component.kind)!;
  const size = renderedSize(entry, component.rotation ?? 0);
  return {
    x: component.position.x + size.width / 2,
    y: component.position.y + size.height / 2,
  };
}

function isHalfPitch(value: number): boolean {
  return Math.abs(value / HALF_PITCH_UNITS - Math.round(value / HALF_PITCH_UNITS)) < 1e-6;
}

describe('breadboard-native component geometry', () => {
  it('uses one explicit physical coordinate system for stage and components', () => {
    expect(BREADBOARD_PITCH_MM).toBe(2.54);
    expect(BREADBOARD_PITCH_UNITS).toBe(20);
    expect(workbenchUnitsToMm(mmToWorkbenchUnits(2.54))).toBeCloseTo(2.54, 12);
    expect(workbenchUnitsToMm(mmToWorkbenchUnits(STAGE_WIDTH_MM))).toBeCloseTo(
      STAGE_WIDTH_MM,
      10,
    );
    expect(workbenchUnitsToMm(mmToWorkbenchUnits(STAGE_HEIGHT_MM))).toBeCloseTo(
      STAGE_HEIGHT_MM,
      10,
    );
    expect(isOnWorkbenchGrid(BREADBOARD_PITCH_UNITS, 1)).toBe(true);
    expect(isOnWorkbenchGrid(HALF_PITCH_UNITS, 2)).toBe(true);
  });

  it.each(['source', 'resistor', 'led'] as const)(
    'places every %s terminal on the declared half-pitch grid',
    (kind) => {
      const added = addComponentToDocument(empty, kind, { x: 333.7, y: 244.1 }, `${kind}-1`);
      const component = added.component;
      const entry = catalogEntry(kind)!;
      expect(terminalIds(entry)).toEqual(['a', 'b']);
      for (const terminalId of terminalIds(entry)) {
        const point = terminalPosition(
          kind,
          component.position,
          terminalId,
          component.rotation ?? 0,
        )!;
        expect(isHalfPitch(point.x)).toBe(true);
        expect(isHalfPitch(point.y)).toBe(true);
        expect(terminalSpec(entry, terminalId)).not.toBeNull();
      }
    },
  );

  it.each([
    ['source', 4],
    ['resistor', 10],
    ['led', 1],
  ] as const)('%s primary terminals preserve a %s-pitch physical span', (kind, pitches) => {
    const entry = catalogEntry(kind)!;
    const origin = snapComponentOrigin(kind, { x: 101.25, y: 93.75 }, 0);
    const [first, second] = terminalIds(entry);
    const a = terminalPosition(kind, origin, first!, 0)!;
    const b = terminalPosition(kind, origin, second!, 0)!;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(
      BREADBOARD_PITCH_UNITS * pitches,
      6,
    );
    expect(entry.physical.terminalSpanPitches).toBe(pitches);
  });

  it('preserves terminal identities and approximately preserves centre on rotation', () => {
    const added = addComponentToDocument(empty, 'resistor', { x: 500, y: 400 }, 'r1');
    const before = added.component;
    const beforeCenter = centerOf(before);
    const beforeA = terminalPosition('resistor', before.position, 'a', 0)!;
    const rotatedDocument = rotateSelectionInDocument(added.document, {
      kind: 'component',
      id: before.id,
    })!;
    const after = rotatedDocument.components[0]!;
    const afterCenter = centerOf(after);
    const afterA = terminalPosition('resistor', after.position, 'a', 90)!;

    expect(after.rotation).toBe(90);
    expect(
      Math.hypot(afterCenter.x - beforeCenter.x, afterCenter.y - beforeCenter.y),
    ).toBeLessThanOrEqual(HALF_PITCH_UNITS * Math.SQRT2);
    expect(isHalfPitch(afterA.x)).toBe(true);
    expect(isHalfPitch(afterA.y)).toBe(true);
    expect(Math.hypot(afterA.x - beforeA.x, afterA.y - beforeA.y)).toBeGreaterThan(0);
  });

  it('duplicates at a free deterministic physical-grid position without overlap', () => {
    const added = addComponentToDocument(empty, 'led', { x: 250, y: 220 }, 'led-1');
    const duplicated = duplicateComponentInDocument(
      added.document,
      { kind: 'component', id: 'led-1' },
      'led-2',
    )!;
    expect(duplicated.component.position).not.toEqual(added.component.position);
    expect(isHalfPitch(duplicated.component.position.x + terminalPosition(
      'led',
      { x: 0, y: 0 },
      'a',
      duplicated.component.rotation ?? 0,
    )!.x)).toBe(true);
    for (const terminalId of terminalIds(catalogEntry('led')!)) {
      const point = terminalPosition(
        duplicated.component.kind,
        duplicated.component.position,
        terminalId,
        duplicated.component.rotation ?? 0,
      )!;
      expect(isHalfPitch(point.x)).toBe(true);
      expect(isHalfPitch(point.y)).toBe(true);
    }
  });

  it('distinguishes physical body size from native SVG placement envelope', () => {
    for (const kind of ['source', 'resistor', 'led'] as const) {
      const entry = catalogEntry(kind)!;
      const rendered = renderedSizeMillimetres(entry);
      expect(rendered.width).toBeGreaterThan(0);
      expect(rendered.height).toBeGreaterThan(0);
      expect(entry.physical.bodyMm.width).toBeGreaterThan(0);
      expect(entry.physical.bodyMm.height).toBeGreaterThan(0);
      expect(componentPhysicalSummary(entry)).toContain('мм');
      expect(physicalEvidenceLabel(entry)).not.toBe('');
    }
  });
});

describe('future component evidence contract', () => {
  it('keeps every future component disabled until asset, terminals and model are complete', () => {
    const future = WORKBENCH_CATALOG.filter((entry) => !entry.enabled);
    expect(future.length).toBeGreaterThan(40);
    for (const entry of future) {
      expect(entry.kind).toBeNull();
      expect(entry.terminals).toEqual([]);
      expect(entry.physical.bodyMm.width).toBeGreaterThan(0);
      expect(entry.physical.bodyMm.height).toBeGreaterThan(0);
      expect(entry.physical.referenceBehaviorVerified).toBe(false);
    }
  });

  it.each([
    ['breadboard-mini', 47, 35, 10],
    ['breadboard-half', 83.5, 54.5, 8.5],
    ['breadboard-full', 165.1, 54.29, 9.68],
    ['microbit', 51.6, 42, 11.65],
    ['arduino', 68.6, 53.4, undefined],
  ] as const)('%s records an explicit mechanical evidence profile', (key, width, height, depth) => {
    const entry = WORKBENCH_CATALOG.find((candidate) => candidate.key === key)!;
    expect(entry.enabled).toBe(false);
    expect(entry.physical.evidence).toBe('manufacturer_official');
    expect(entry.physical.bodyMm.width).toBe(width);
    expect(entry.physical.bodyMm.height).toBe(height);
    if (depth !== undefined) expect(entry.physical.bodyMm.depth).toBe(depth);
    expect(entry.physical.source).not.toBe('');
    expect(physicalEvidenceLabel(entry)).toBe('Официальные механические размеры');
  });

  it('exposes instruments as planned native previews without claiming simulation support', () => {
    for (const key of ['multimeter', 'oscilloscope', 'signal-generator', 'bench-power-supply']) {
      const entry = WORKBENCH_CATALOG.find((candidate) => candidate.key === key)!;
      expect(entry.category).toBe('instruments');
      expect(entry.enabled).toBe(false);
      expect(entry.kind).toBeNull();
      expect(entry.asset).toBeNull();
      expect(entry.physical.evidence).toBe('reference_capture_required');
    }
  });

  it('does not silently accept non-finite physical conversion inputs', () => {
    expect(() => mmToWorkbenchUnits(Number.NaN)).toThrow(/finite/);
    expect(() => workbenchUnitsToMm(Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });
});
