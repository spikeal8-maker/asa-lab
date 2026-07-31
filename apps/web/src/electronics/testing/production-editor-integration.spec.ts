import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SchematicDocument } from '../../api';
import {
  catalogEntry,
  renderedSize,
  terminalPosition,
  workbenchCatalog,
} from '../component-catalog';
import { WORLD_UNITS_PER_MM } from '../production-asset-contracts';
import {
  configureProductionLibrary,
  productionBreadboard,
  type BreadboardConnectivityManifest,
  type ProductionManifest,
} from '../production-manifest-adapter';
import {
  addComponentToDocument,
  moveComponentInDocument,
  snapComponentToBreadboard,
  updateSelectionProperties,
} from '../workbench-document';

const EMPTY: SchematicDocument = {
  schemaVersion: 3,
  components: [],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: false, maxIterations: 24 },
};

beforeAll(() => {
  const root = resolve(process.cwd(), 'apps/web/public/assets/electronics/production');
  configureProductionLibrary(
    JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8')) as ProductionManifest,
    JSON.parse(
      readFileSync(resolve(root, 'breadboard-connectivity.json'), 'utf8'),
    ) as BreadboardConnectivityManifest,
  );
});

describe('production manifest integration in the real Electronics document', () => {
  it('exposes required owner variants without any legacy image in the new-project catalog', () => {
    const required = [
      'battery-holder-aa-1',
      'battery-holder-aa-2',
      'battery-holder-aa-3',
      'battery-holder-aa-4',
      'battery-holder-aa-6',
      'battery-holder-aa-8',
      'resistor-axial',
      'led-5mm',
      'rgb-led',
      'seven-segment-display',
      'button-tactile-6mm',
      'switch-spdt',
      'potentiometer',
      'diode-do35',
      'incandescent-lamp',
      'breadboard-small',
      'breadboard-medium',
      'breadboard-large',
    ];
    expect(workbenchCatalog()).toHaveLength(32);
    for (const componentTypeId of required) {
      const entry = catalogEntry(componentTypeId);
      expect(entry, componentTypeId).not.toBeNull();
      expect(entry?.asset, componentTypeId).toMatch(/^\/assets\/electronics\/production\/.*\.svg$/);
      expect(entry?.asset, componentTypeId).not.toContain('/electronics/components/');
      expect(renderedSize(entry as NonNullable<typeof entry>)).toEqual({
        width: (entry?.physicalSizeMm.width as number) * WORLD_UNITS_PER_MM,
        height: (entry?.physicalSizeMm.height as number) * WORLD_UNITS_PER_MM,
      });
    }
  });

  it('persists component type, variant, typed state and real manifest pins in schema v3', () => {
    let document = addComponentToDocument(EMPTY, 'rgb-led', { x: 300, y: 240 }, 'rgb').document;
    document = updateSelectionProperties(
      document,
      { kind: 'component', id: 'rgb', ids: ['rgb'] },
      { red: 20, green: 80, blue: 55, commonMode: 'common-anode' },
    ) as SchematicDocument;
    expect(document.components[0]).toMatchObject({
      componentTypeId: 'rgb-led',
      variantId: 'rgb-led',
      stateProperties: { red: 20, green: 80, blue: 55, commonMode: 'common-anode' },
      pinIds: ['red', 'common', 'green', 'blue'],
    });
  });

  it('snaps a real four-pin footprint to stable 2.54mm holes and joins board nets', () => {
    let document = addComponentToDocument(
      EMPTY,
      'breadboard-medium',
      { x: 600, y: 360 },
      'board',
    ).document;
    document = addComponentToDocument(
      document,
      'button-tactile-6mm',
      { x: 400, y: 300 },
      'button',
    ).document;
    const board = document.components.find((component) => component.id === 'board');
    const button = document.components.find((component) => component.id === 'button');
    const definition = productionBreadboard('breadboard-medium');
    const originHole = definition?.holes.find((hole) => hole.id === 'J1');
    const pin = button
      ? terminalPosition(button, button.position, 'SW-A1', button.rotation ?? 0)
      : null;
    expect(board && button && definition && originHole && pin).toBeTruthy();
    if (!board || !button || !definition || !originHole || !pin) return;
    document = moveComponentInDocument(document, 'button', {
      x: button.position.x + board.position.x + originHole.xMm * WORLD_UNITS_PER_MM - pin.x,
      y: button.position.y + board.position.y + originHole.yMm * WORLD_UNITS_PER_MM - pin.y,
    });
    document = snapComponentToBreadboard(document, 'button');
    const snapped = document.components.find((component) => component.id === 'button');
    expect(snapped?.holeBindings).toEqual({
      'SW-A1': { breadboardComponentId: 'board', holeId: 'J1' },
      'SW-B1': { breadboardComponentId: 'board', holeId: 'J3' },
      'SW-A2': { breadboardComponentId: 'board', holeId: 'G1' },
      'SW-B2': { breadboardComponentId: 'board', holeId: 'G3' },
    });
    expect(
      document.components.find((item) => item.id === 'board')?.internalConnections,
    ).toContainEqual(['J1', 'I1']);
  });
});
