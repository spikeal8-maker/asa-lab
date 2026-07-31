import { describe, expect, it } from 'vitest';
import type { ComponentKind, SchematicDocument } from '../../api';
import { ACTIVE_COMPONENTS } from '../component-catalog';
import {
  addComponentToDocument,
  connectTerminals,
  duplicateComponentInDocument,
  moveWireVertex,
  reconnectWireEndpoint,
  removeSelectionFromDocument,
  removeSelectedWireBends,
  rotateSelectionInDocument,
  toggleSelectedWireRoute,
  updateSelectedWireColor,
  updateSelectionName,
  updateSelectionState,
  updateSelectionValue,
  updateWiperPosition,
} from '../workbench-document';

const EMPTY: SchematicDocument = {
  schemaVersion: 2,
  components: [],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: false, maxIterations: 24 },
};

const activeKinds = Object.keys(ACTIVE_COMPONENTS) as Exclude<ComponentKind, 'wire'>[];

function populated(): SchematicDocument {
  return activeKinds.reduce(
    (document, kind, index) =>
      addComponentToDocument(document, kind, { x: 120 + index * 180, y: 180 }, kind).document,
    EMPTY,
  );
}

describe('Electronics M1 editor document operations', () => {
  it('places exactly the eight active simulated component kinds', () => {
    const document = populated();
    expect(activeKinds.sort()).toEqual(
      ['button', 'diode', 'lamp', 'led', 'potentiometer', 'resistor', 'source', 'switch'].sort(),
    );
    expect(document.components.map((component) => component.kind).sort()).toEqual(
      activeKinds.sort(),
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

  it('creates, colors, bends, moves, reconnects and straightens a wire', () => {
    let document = populated();
    const created = connectTerminals(
      document,
      { componentId: 'source', terminal: 'a' },
      { componentId: 'resistor', terminal: 'a' },
      'wire-1',
      '#e3212b',
    );
    expect(created.kind).toBe('created');
    if (created.kind !== 'created') return;
    document = created.document;
    const selection = { kind: 'wire' as const, id: 'wire-1' };
    document = updateSelectedWireColor(document, selection, '#2c62c9') as SchematicDocument;
    document = toggleSelectedWireRoute(document, selection) as SchematicDocument;
    expect(document.connections[0]?.vertices).toHaveLength(2);
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
});
