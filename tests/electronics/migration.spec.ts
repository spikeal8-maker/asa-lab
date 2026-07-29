import { describe, expect, it } from 'vitest';
import type { SchematicDocument } from '../../apps/web/src/api';
import { terminalPosition } from '../../apps/web/src/electronics/component-catalog';
import { migrateElectronicsGeometry } from '../../apps/web/src/electronics/workbench-migration';
import { HALF_PITCH_UNITS } from '../../apps/web/src/electronics/workbench-scale';

const legacy: SchematicDocument = {
  schemaVersion: 1,
  components: [
    { id: 'src', kind: 'source', position: { x: 100, y: 80 }, value: 3, rotation: 0 },
    { id: 'r1', kind: 'resistor', position: { x: 410, y: 260 }, value: 300, rotation: 90 },
    { id: 'led1', kind: 'led', position: { x: 760, y: 420 }, value: 2, rotation: 180 },
  ],
  connections: [
    {
      id: 'w1',
      from: { componentId: 'src', terminal: 'a' },
      to: { componentId: 'r1', terminal: 'a' },
      color: '#e3212b',
      vertices: [
        { x: 320, y: 100 },
        { x: 320, y: 300 },
      ],
    },
    {
      id: 'w2',
      from: { componentId: 'r1', terminal: 'b' },
      to: { componentId: 'led1', terminal: 'a' },
      color: '#149447',
    },
  ],
};

function snapshotTopology(document: SchematicDocument) {
  return {
    componentIds: document.components.map((component) => component.id),
    componentKinds: document.components.map((component) => component.kind),
    componentValues: document.components.map((component) => component.value),
    componentRotations: document.components.map((component) => component.rotation ?? 0),
    connections: document.connections.map((connection) => ({
      id: connection.id,
      from: connection.from,
      to: connection.to,
      color: connection.color,
      vertices: connection.vertices,
    })),
  };
}

function onHalfPitch(value: number): boolean {
  return Math.abs(value / HALF_PITCH_UNITS - Math.round(value / HALF_PITCH_UNITS)) < 1e-6;
}

describe('legacy Electronics geometry migration', () => {
  it('is deterministic and idempotent', () => {
    const first = migrateElectronicsGeometry(legacy);
    const repeatedFromLegacy = migrateElectronicsGeometry(legacy);
    const second = migrateElectronicsGeometry(first.document);

    expect(first.migrated).toBe(true);
    expect(first.fromProfile).toBe('legacy-pixel-v1');
    expect(first.toProfile).toBe('breadboard-2.54mm-v1');
    expect(first.document).toEqual(repeatedFromLegacy.document);
    expect(second.migrated).toBe(false);
    expect(second.document).toBe(first.document);
  });

  it('preserves IDs, electrical topology, values, rotation, wire colour and manual vertices', () => {
    const migrated = migrateElectronicsGeometry(legacy).document;
    expect(snapshotTopology(migrated)).toEqual(snapshotTopology(legacy));
    expect(migrated.geometryProfile).toBe('breadboard-2.54mm-v1');
  });

  it('moves only component positions and aligns physical terminals to the half-pitch grid', () => {
    const result = migrateElectronicsGeometry(legacy);
    expect(result.migratedComponents).toBe(3);
    expect(result.maximumCentreShift).toBeLessThanOrEqual(HALF_PITCH_UNITS * Math.SQRT2);
    expect(result.document.components.map((item) => item.position)).not.toEqual(
      legacy.components.map((item) => item.position),
    );

    for (const component of result.document.components) {
      if (component.kind === 'wire') continue;
      for (const terminal of ['a', 'b'] as const) {
        const point = terminalPosition(
          component.kind,
          component.position,
          terminal,
          component.rotation ?? 0,
        )!;
        expect(onHalfPitch(point.x)).toBe(true);
        expect(onHalfPitch(point.y)).toBe(true);
      }
    }
  });

  it('does not mutate the input object or rewrite immutable-version data implicitly', () => {
    const before = JSON.stringify(legacy);
    const result = migrateElectronicsGeometry(legacy);
    expect(JSON.stringify(legacy)).toBe(before);
    expect(result.document).not.toBe(legacy);
    expect(result.document.connections).toBe(legacy.connections);
  });
});
