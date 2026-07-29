import { describe, expect, it } from 'vitest';
import type { SchematicDocument } from '../../apps/web/src/api';
import {
  catalogEntry,
  renderedSize,
  snapComponentOrigin,
  terminalPosition,
} from '../../apps/web/src/electronics/component-catalog';
import {
  addComponentToDocument,
  duplicateComponentInDocument,
  rotateSelectionInDocument,
} from '../../apps/web/src/electronics/workbench-document';
import {
  BREADBOARD_PITCH_UNITS,
  HALF_PITCH_UNITS,
} from '../../apps/web/src/electronics/workbench-scale';

const empty: SchematicDocument = { schemaVersion: 1, components: [], connections: [] };

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
  it.each(['source', 'resistor', 'led'] as const)(
    'places %s with both terminals on the half-pitch grid',
    (kind) => {
      const added = addComponentToDocument(empty, kind, { x: 333.7, y: 244.1 }, `${kind}-1`);
      const component = added.component;
      for (const terminal of ['a', 'b'] as const) {
        const point = terminalPosition(kind, component.position, terminal, component.rotation ?? 0)!;
        expect(isHalfPitch(point.x)).toBe(true);
        expect(isHalfPitch(point.y)).toBe(true);
      }
    },
  );

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
    expect(Math.hypot(afterCenter.x - beforeCenter.x, afterCenter.y - beforeCenter.y)).toBeLessThanOrEqual(
      HALF_PITCH_UNITS * Math.SQRT2,
    );
    expect(isHalfPitch(afterA.x)).toBe(true);
    expect(isHalfPitch(afterA.y)).toBe(true);
    expect(Math.hypot(afterA.x - beforeA.x, afterA.y - beforeA.y)).toBeGreaterThan(0);
  });

  it('duplicates at a deterministic two-pitch offset and keeps terminal alignment', () => {
    const added = addComponentToDocument(empty, 'led', { x: 250, y: 220 }, 'led-1');
    const duplicated = duplicateComponentInDocument(
      added.document,
      { kind: 'component', id: 'led-1' },
      'led-2',
    )!;
    expect(duplicated.component.position.x - added.component.position.x).toBeCloseTo(
      BREADBOARD_PITCH_UNITS * 2,
      6,
    );
    expect(duplicated.component.position.y - added.component.position.y).toBeCloseTo(
      BREADBOARD_PITCH_UNITS * 2,
      6,
    );
    for (const terminal of ['a', 'b'] as const) {
      const point = terminalPosition(
        duplicated.component.kind,
        duplicated.component.position,
        terminal,
        duplicated.component.rotation ?? 0,
      )!;
      expect(isHalfPitch(point.x)).toBe(true);
      expect(isHalfPitch(point.y)).toBe(true);
    }
  });

  it('snaps a proposed origin through the declared terminal anchor, not arbitrary top-left pixels', () => {
    const origin = snapComponentOrigin('source', { x: 101.25, y: 93.75 }, 0);
    const a = terminalPosition('source', origin, 'a', 0)!;
    const b = terminalPosition('source', origin, 'b', 0)!;
    expect(isHalfPitch(a.x)).toBe(true);
    expect(isHalfPitch(a.y)).toBe(true);
    expect(Math.abs(a.x - b.x)).toBeCloseTo(BREADBOARD_PITCH_UNITS * 4, 6);
  });
});
