import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SchematicDocument } from '../../api';
import {
  configureProductionLibrary,
  productionBreadboard,
  type OwnerCatalogManifest,
} from '../production-manifest-adapter';
import {
  catalogEntry,
  componentPointPosition,
  renderedSize,
  terminalPosition,
} from '../component-catalog';
import {
  addComponentToDocument,
  componentsBoundToBreadboard,
  connectTerminals,
  duplicateComponentInDocument,
  insertWireVertex,
  mirrorSelectionInDocument,
  moveComponentInDocument,
  moveWireVertex,
  reconnectWireEndpoint,
  removeWireVertex,
  removeSelectionFromDocument,
  removeSelectedWireBends,
  rotateSelectionInDocument,
  snapComponentToBreadboard,
  terminalPositionInDocument,
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
  const root = resolve(process.cwd(), 'apps/web/public/assets/electronics/component-database');
  configureProductionLibrary(
    JSON.parse(readFileSync(resolve(root, 'catalog.json'), 'utf8')) as OwnerCatalogManifest,
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
  it('snaps a newly placed potentiometer on its first drop', () => {
    let document = addComponentToDocument(
      EMPTY,
      'breadboard-medium',
      { x: 600, y: 500 },
      'board',
    ).document;
    document = addComponentToDocument(
      document,
      'potentiometer',
      { x: 600, y: 500 },
      'pot',
    ).document;
    const boardComponent = document.components.find((item) => item.id === 'board');
    const potentiometer = document.components.find((item) => item.id === 'pot');
    const board = productionBreadboard('breadboard-medium');
    const targetHole = board?.holes.find((hole) => hole.id === 'J8');
    const targetPoint =
      boardComponent && targetHole
        ? componentPointPosition(boardComponent, boardComponent.position, targetHole, 0)
        : null;
    const firstPin = potentiometer
      ? terminalPosition(potentiometer, potentiometer.position, 'terminal-1', 0)
      : null;
    expect(targetPoint).not.toBeNull();
    expect(firstPin).not.toBeNull();
    if (!potentiometer || !targetPoint || !firstPin) return;
    document = moveComponentInDocument(document, 'pot', {
      x: potentiometer.position.x + targetPoint.x - firstPin.x,
      y: potentiometer.position.y + targetPoint.y - firstPin.y,
    });
    document = snapComponentToBreadboard(document, 'pot');
    expect(document.components.find((item) => item.id === 'pot')?.holeBindings).toEqual({
      'terminal-1': { breadboardComponentId: 'board', holeId: 'J8' },
      'terminal-2': { breadboardComponentId: 'board', holeId: 'J10' },
      wiper: { breadboardComponentId: 'board', holeId: 'J9' },
    });
  });

  it('plugs battery lead ends into holes while the battery body stays outside the board group', () => {
    let document = addComponentToDocument(
      EMPTY,
      'breadboard-medium',
      { x: 600, y: 500 },
      'board',
    ).document;
    document = addComponentToDocument(
      document,
      'battery-holder-aa-2',
      { x: 600, y: 500 },
      'battery',
    ).document;
    const boardComponent = document.components.find((item) => item.id === 'board');
    const battery = document.components.find((item) => item.id === 'battery');
    const board = productionBreadboard('breadboard-medium');
    const targetHole = board?.holes.find((hole) => hole.id === 'J8');
    const targetPoint =
      boardComponent && targetHole
        ? componentPointPosition(boardComponent, boardComponent.position, targetHole, 0)
        : null;
    const negative = battery ? terminalPosition(battery, battery.position, 'BAT-', 0) : null;
    expect(targetPoint).not.toBeNull();
    expect(negative).not.toBeNull();
    if (!battery || !boardComponent || !targetPoint || !negative) return;
    const batteryPosition = {
      x: battery.position.x + targetPoint.x - negative.x,
      y: battery.position.y + targetPoint.y - negative.y,
    };
    document = moveComponentInDocument(document, 'battery', batteryPosition);
    document = snapComponentToBreadboard(document, 'battery');
    expect(document.components.find((item) => item.id === 'battery')?.holeBindings).toEqual({
      'BAT-': { breadboardComponentId: 'board', holeId: 'J8' },
      'BAT+': { breadboardComponentId: 'board', holeId: 'J9' },
    });
    expect(componentsBoundToBreadboard(document, 'board')).not.toContain('battery');

    const before = terminalPositionInDocument(
      document,
      document.components.find((item) => item.id === 'battery')!,
      'BAT-',
    );
    document = moveComponentInDocument(document, 'board', {
      x: boardComponent.position.x + 80,
      y: boardComponent.position.y + 40,
    });
    const movedBattery = document.components.find((item) => item.id === 'battery')!;
    const after = terminalPositionInDocument(document, movedBattery, 'BAT-');
    expect(movedBattery.position).toEqual(batteryPosition);
    expect(after).toEqual(before ? { x: before.x + 80, y: before.y + 40 } : null);
  });

  it('plugs both lead ends of both owner piezo variants into breadboard holes', () => {
    for (const [componentTypeId, negativeHole] of [
      ['piezo-disc', 'J11'],
      ['piezo-passive-buzzer', 'J12'],
    ] as const) {
      let document = addComponentToDocument(
        EMPTY,
        'breadboard-medium',
        { x: 600, y: 500 },
        'board',
      ).document;
      document = addComponentToDocument(
        document,
        componentTypeId,
        { x: 600, y: 500 },
        'piezo',
      ).document;
      const boardComponent = document.components.find((item) => item.id === 'board');
      const piezo = document.components.find((item) => item.id === 'piezo');
      const board = productionBreadboard('breadboard-medium');
      const targetHole = board?.holes.find((hole) => hole.id === 'J8');
      const targetPoint =
        boardComponent && targetHole
          ? componentPointPosition(boardComponent, boardComponent.position, targetHole, 0)
          : null;
      const positive = piezo
        ? terminalPosition(piezo, piezo.position, 'positive', piezo.rotation ?? 0)
        : null;
      expect(targetPoint).not.toBeNull();
      expect(positive).not.toBeNull();
      if (!piezo || !targetPoint || !positive) continue;
      document = moveComponentInDocument(document, 'piezo', {
        x: piezo.position.x + targetPoint.x - positive.x,
        y: piezo.position.y + targetPoint.y - positive.y,
      });
      document = snapComponentToBreadboard(document, 'piezo');
      expect(
        document.components.find((item) => item.id === 'piezo')?.holeBindings,
        componentTypeId,
      ).toEqual({
        positive: { breadboardComponentId: 'board', holeId: 'J8' },
        negative: { breadboardComponentId: 'board', holeId: negativeHole },
      });
      expect(componentsBoundToBreadboard(document, 'board')).not.toContain('piezo');
    }
  });

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
        .every((item) => item.rotation === 45),
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

  it('rotates a non-square component by 45 degrees around its unchanged centre', () => {
    const document = populated();
    const source = document.components.find((item) => item.id === 'source');
    expect(source).toBeDefined();
    if (!source) return;
    const entry = catalogEntry(source);
    expect(entry).toBeDefined();
    if (!entry) return;
    const beforeSize = renderedSize(entry, source.rotation ?? 0);
    const beforeCenter = {
      x: source.position.x + beforeSize.width / 2,
      y: source.position.y + beforeSize.height / 2,
    };
    const rotated = rotateSelectionInDocument(document, {
      kind: 'component',
      id: 'source',
      ids: ['source'],
    });
    const next = rotated?.components.find((item) => item.id === 'source');
    expect(next?.rotation).toBe(45);
    if (!next) return;
    const nextEntry = catalogEntry(next);
    expect(nextEntry).toBeDefined();
    if (!nextEntry) return;
    const nextSize = renderedSize(nextEntry, next.rotation ?? 0);
    expect(next.position.x + nextSize.width / 2).toBeCloseTo(beforeCenter.x, 8);
    expect(next.position.y + nextSize.height / 2).toBeCloseTo(beforeCenter.y, 8);
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
