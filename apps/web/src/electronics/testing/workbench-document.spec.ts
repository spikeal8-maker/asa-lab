import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SchematicDocument } from '../../api';
import {
  configureProductionLibrary,
  type OwnerCatalogManifest,
} from '../production-manifest-adapter';
import {
  addComponentToDocument,
  connectTerminals,
  duplicateComponentInDocument,
  insertWireVertex,
  mirrorSelectionInDocument,
  moveWireVertex,
  reconnectWireEndpoint,
  removeWireVertex,
  removeSelectionFromDocument,
  removeSelectedWireBends,
  rotateSelectionInDocument,
  updateSelectedWireColor,
  updateSelectionName,
  updateSelectionState,
  updateSelectionValue,
  updateWiperPosition,
} from '../workbench-document';
import {
  completeOrthogonalRoute,
  lockOrthogonalBend,
  lockOrthogonalPoint,
  magneticWirePoint,
  wirePoints,
} from '../workbench-geometry';

const EMPTY: SchematicDocument = {
  schemaVersion: 3,
  components: [],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: false, maxIterations: 24 },
};

const activeTypes = [
  ['battery-holder-aa-2', 'source'],
  ['resistor-axial', 'resistor'],
  ['led-5mm', 'led'],
  ['button-tactile-6mm', 'button'],
  ['switch-spdt', 'switch'],
  ['potentiometer', 'potentiometer'],
  ['diode-do35', 'diode'],
  ['incandescent-lamp', 'lamp'],
] as const;

beforeAll(() => {
  const root = resolve(process.cwd(), 'apps/web/public/assets/electronics/owner-catalog');
  configureProductionLibrary(
    JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8')) as OwnerCatalogManifest,
  );
});

function populated(): SchematicDocument {
  return activeTypes.reduce(
    (document, [componentTypeId, id], index) =>
      addComponentToDocument(document, componentTypeId, { x: 120 + index * 180, y: 180 }, id)
        .document,
    EMPTY,
  );
}

describe('Electronics M1 editor document operations', () => {
  it('keeps free user points by default and applies 90-degree locking only on demand', () => {
    expect(
      wirePoints({ x: 100, y: 100 }, { x: 300, y: 260 }, [
        { x: 150, y: 180 },
        { x: 240, y: 210 },
      ]),
    ).toEqual([
      { x: 100, y: 100 },
      { x: 150, y: 180 },
      { x: 240, y: 210 },
      { x: 300, y: 260 },
    ]);
    expect(lockOrthogonalPoint({ x: 100, y: 100 }, { x: 187, y: 124 })).toEqual({
      x: 190,
      y: 100,
    });
    expect(lockOrthogonalPoint({ x: 100, y: 100 }, { x: 117, y: 184 })).toEqual({
      x: 100,
      y: 180,
    });
    expect(lockOrthogonalBend({ x: 100, y: 100 }, { x: 300, y: 260 }, { x: 280, y: 120 })).toEqual({
      x: 300,
      y: 100,
    });
    expect(magneticWirePoint({ x: 100, y: 100 }, { x: 237, y: 106 })).toEqual({
      x: 237,
      y: 100,
    });
    expect(completeOrthogonalRoute({ x: 100, y: 100 }, { x: 300, y: 260 }, [])).toEqual([
      { x: 300, y: 100 },
    ]);
    expect(
      completeOrthogonalRoute({ x: 100, y: 100 }, { x: 300, y: 260 }, [{ x: 180, y: 100 }]),
    ).toEqual([
      { x: 180, y: 100 },
      { x: 180, y: 260 },
    ]);
    expect(magneticWirePoint({ x: 100, y: 100 }, { x: 106, y: 237 })).toEqual({
      x: 100,
      y: 237,
    });
    expect(magneticWirePoint({ x: 100, y: 100 }, { x: 237, y: 166 })).toEqual({
      x: 237,
      y: 166,
    });
  });

  it('places exactly the eight active simulated component kinds', () => {
    const document = populated();
    expect(activeTypes.map(([, kind]) => kind).sort()).toEqual(
      ['button', 'diode', 'lamp', 'led', 'potentiometer', 'resistor', 'source', 'switch'].sort(),
    );
    expect(document.components.map((component) => component.kind).sort()).toEqual(
      activeTypes.map(([, kind]) => kind).sort(),
    );
    expect(
      document.components.find((component) => component.kind === 'potentiometer'),
    ).toMatchObject({
      value: 1000,
      wiperPosition: 0.5,
    });
  });

  it('rotates, duplicates and deletes a multi-selection without losing internal wires', () => {
    let document = populated();
    const connected = connectTerminals(
      document,
      { componentId: 'source', terminal: 'a' },
      { componentId: 'resistor', terminal: 'a' },
      'wire-1',
      '#e3212b',
    );
    expect(connected.kind).toBe('created');
    if (connected.kind !== 'created') return;
    document = connected.document;
    const selection = { kind: 'component' as const, id: 'source', ids: ['source', 'resistor'] };
    const rotated = rotateSelectionInDocument(document, selection);
    expect(
      rotated?.components
        .filter((item) => selection.ids.includes(item.id))
        .every((item) => item.rotation === 90),
    ).toBe(true);
    const duplicated = duplicateComponentInDocument(
      rotated as SchematicDocument,
      selection,
      'copy',
    );
    expect(duplicated?.document.components).toHaveLength(10);
    expect(duplicated?.document.connections).toHaveLength(2);
    expect(duplicated?.components.map((item) => item.id)).toEqual(['copy-1', 'copy-2']);
    const removed = removeSelectionFromDocument(document, selection);
    expect(removed.components.some((item) => selection.ids.includes(item.id))).toBe(false);
    expect(removed.connections).toHaveLength(0);
  });

  it('changes component name, value, contact state and potentiometer wiper', () => {
    let document = populated();
    const resistor = { kind: 'component' as const, id: 'resistor', ids: ['resistor'] };
    document = updateSelectionName(document, resistor, 'R load') as SchematicDocument;
    document = updateSelectionValue(document, resistor, 470) as SchematicDocument;
    const switchSelection = { kind: 'component' as const, id: 'switch', ids: ['switch'] };
    document = updateSelectionState(document, switchSelection, true) as SchematicDocument;
    const pot = { kind: 'component' as const, id: 'potentiometer', ids: ['potentiometer'] };
    document = updateWiperPosition(document, pot, 0.75) as SchematicDocument;
    expect(document.components.find((item) => item.id === 'resistor')).toMatchObject({
      name: 'R load',
      value: 470,
    });
    expect(document.components.find((item) => item.id === 'switch')?.state).toBe(true);
    expect(document.components.find((item) => item.id === 'potentiometer')?.wiperPosition).toBe(
      0.75,
    );
  });

  it('mirrors a selected component without changing its owner asset or terminals', () => {
    const document = populated();
    const selection = { kind: 'component' as const, id: 'resistor', ids: ['resistor'] };
    const mirrored = mirrorSelectionInDocument(document, selection, 'horizontal');
    const resistor = mirrored?.components.find((item) => item.id === 'resistor');
    expect(resistor?.stateProperties?.['mirrorX']).toBe(true);
    expect(resistor?.componentTypeId).toBe('resistor-axial');
    expect(resistor?.pinIds).toEqual(
      document.components.find((item) => item.id === 'resistor')?.pinIds,
    );
  });

  it('creates, colors, bends, moves, reconnects and straightens a wire', () => {
    let document = populated();
    const created = connectTerminals(
      document,
      { componentId: 'source', terminal: 'a' },
      { componentId: 'resistor', terminal: 'a' },
      'wire-1',
      '#e3212b',
      [
        { x: 260, y: 220 },
        { x: 260, y: 340 },
      ],
    );
    expect(created.kind).toBe('created');
    if (created.kind !== 'created') return;
    document = created.document;
    expect(document.connections[0]?.vertices).toEqual([
      { x: 260, y: 220 },
      { x: 260, y: 340 },
    ]);
    const selection = { kind: 'wire' as const, id: 'wire-1' };
    document = updateSelectedWireColor(document, selection, '#2c62c9') as SchematicDocument;
    document = moveWireVertex(document, 'wire-1', 0, { x: 420, y: 320 });
    expect(document.connections[0]?.vertices?.[0]).toEqual({ x: 420, y: 320 });
    document = reconnectWireEndpoint(document, 'wire-1', 'to', {
      componentId: 'led',
      terminal: 'a',
    }) as SchematicDocument;
    expect(document.connections[0]).toMatchObject({
      color: '#2c62c9',
      to: { componentId: 'led', terminal: 'a' },
    });
    document = removeSelectedWireBends(document, selection) as SchematicDocument;
    expect(document.connections[0]?.vertices).toEqual([]);
  });

  it('removes one selected bend without deleting its wire', () => {
    const created = connectTerminals(
      populated(),
      { componentId: 'source', terminal: 'BAT+' },
      { componentId: 'resistor', terminal: 'lead-1' },
      'wire-bend-delete',
      '#149447',
      [
        { x: 260, y: 220 },
        { x: 260, y: 340 },
      ],
    );
    expect(created.kind).toBe('created');
    if (created.kind !== 'created') return;
    const before = created.document.connections[0]?.vertices?.length ?? 0;
    expect(before).toBeGreaterThan(0);
    const after = removeWireVertex(created.document, 'wire-bend-delete', 0);
    expect(after.connections).toHaveLength(1);
    expect(after.connections[0]?.vertices).toHaveLength(before - 1);
    expect(after.connections[0]?.vertices).toEqual([{ x: 260, y: 340 }]);
  });

  it('adds a control point to the closest wire segment on double click', () => {
    let document = populated();
    const created = connectTerminals(
      document,
      { componentId: 'source', terminal: 'BAT+' },
      { componentId: 'resistor', terminal: 'lead-1' },
      'wire-double-click',
      '#149447',
      [],
    );
    expect(created.kind).toBe('created');
    if (created.kind !== 'created') return;
    const before = created.document.connections[0]?.vertices?.length ?? 0;
    document = insertWireVertex(created.document, 'wire-double-click', { x: 300, y: 210 });
    expect(document.connections[0]?.vertices).toHaveLength(before + 1);
  });
});
