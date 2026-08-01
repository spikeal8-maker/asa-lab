import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SchematicDocument } from '../../api';
import {
  familyMatchesCategory,
  renderedSize,
  terminalPosition,
  workbenchCatalog,
} from '../component-catalog';
import { WORLD_UNITS_PER_MM } from '../production-asset-contracts';
import {
  configureProductionLibrary,
  productionBreadboard,
  type OwnerCatalogManifest,
} from '../production-manifest-adapter';
import {
  addComponentToDocument,
  moveComponentInDocument,
  snapComponentToBreadboard,
  updateSelectionProperties,
  updateSelectionVariant,
} from '../workbench-document';

const EMPTY: SchematicDocument = {
  schemaVersion: 3,
  components: [],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: false, maxIterations: 24 },
};

beforeAll(() => {
  const root = resolve(process.cwd(), 'apps/web/public/assets/electronics/owner-catalog');
  configureProductionLibrary(
    JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8')) as OwnerCatalogManifest,
  );
});

describe('owner SVG integration in the real Electronics document', () => {
  it('groups owner assets into deterministic families and safe tiers', () => {
    const families = workbenchCatalog();
    const basicFamilies = families.filter((family) => familyMatchesCategory(family, 'basic'));
    expect(basicFamilies.map((family) => family.familyId)).toEqual(
      families.map((family) => family.familyId),
    );
    expect(basicFamilies.map((family) => family.familyId)).toEqual(
      expect.arrayContaining([
        'resistor',
        'led',
        'button',
        'breadboard',
        'battery-holder-aa',
        'diode',
        'rgb-led',
        'seven-segment',
        'microbit',
        'vibration-motor',
      ]),
    );
    expect(families.find((family) => family.familyId === 'battery-holder-aa')).toMatchObject({
      defaultVariantId: 'battery-holder-aa-2',
      catalogTier: 'core',
      enabled: true,
    });
    expect(
      families
        .find((family) => family.familyId === 'battery-holder-aa')
        ?.variants.map((variant) => variant.variantId),
    ).toEqual([
      'battery-holder-aa-1',
      'battery-holder-aa-2',
      'battery-holder-aa-3',
      'battery-holder-aa-4',
      'battery-holder-aa-6',
      'battery-holder-aa-8',
    ]);
    expect(
      families
        .find((family) => family.familyId === 'breadboard')
        ?.variants.map((variant) => variant.variantId),
    ).toEqual(['breadboard-small', 'breadboard-medium', 'breadboard-large']);
    expect(families.find((family) => family.familyId === 'breadboard')?.defaultVariantId).toBe(
      'breadboard-medium',
    );
    expect(
      families
        .find((family) => family.familyId === 'diode')
        ?.variants.map((variant) => variant.variantId),
    ).toEqual(['diode-do35', 'diode-do41']);
    expect(families.find((family) => family.familyId === 'battery')).toMatchObject({
      enabled: false,
      appearsInBasic: true,
      simulationStatus: 'not_yet_supported',
    });
    expect(families.filter((family) => family.catalogTier === 'preview')).not.toHaveLength(0);
    expect(
      families
        .filter((family) => family.catalogTier === 'preview')
        .every((family) => !family.enabled && family.simulationStatus === 'not_yet_supported'),
    ).toBe(true);

    for (const family of families) {
      for (const variant of family.variants) {
        const entry = variant.entry;
        if (entry.asset) {
          expect(entry.asset, variant.variantId).toMatch(
            /^\/assets\/electronics\/(owner-supplied|owner-audit\/components)\/.*\.svg$/,
          );
          expect(entry.asset, variant.variantId).not.toContain('/production/');
          expect(entry.asset, variant.variantId).not.toContain('/source-reference/');
        } else {
          expect(['microbit', 'vibration-motor']).toContain(entry.preview);
          expect(family.enabled).toBe(false);
        }
        expect(renderedSize(entry)).toEqual({
          width: entry.physicalSizeMm.width * WORLD_UNITS_PER_MM,
          height: entry.physicalSizeMm.height * WORLD_UNITS_PER_MM,
        });
      }
    }
  });

  it('persists a selected family variant through document serialization', () => {
    let document = addComponentToDocument(
      EMPTY,
      'battery-holder-aa-2',
      { x: 300, y: 240 },
      'battery',
    ).document;
    const before = document.components[0];
    const beforeNegative = before
      ? terminalPosition(before, before.position, 'BAT-', before.rotation ?? 0)
      : null;
    const beforePositive = before
      ? terminalPosition(before, before.position, 'BAT+', before.rotation ?? 0)
      : null;
    document = updateSelectionVariant(
      document,
      { kind: 'component', id: 'battery', ids: ['battery'] },
      'battery-holder-aa-6',
    ) as SchematicDocument;
    const restored = JSON.parse(JSON.stringify(document)) as SchematicDocument;
    expect(restored.components[0]).toMatchObject({
      componentTypeId: 'battery-holder-aa-6',
      variantId: 'battery-holder-aa-6',
      value: 9,
    });
    const after = restored.components[0];
    const afterNegative = after
      ? terminalPosition(after, after.position, 'BAT-', after.rotation ?? 0)
      : null;
    const afterPositive = after
      ? terminalPosition(after, after.position, 'BAT+', after.rotation ?? 0)
      : null;
    expect(afterNegative?.x).toBeCloseTo(beforeNegative?.x ?? 0, 3);
    expect(afterNegative?.y).toBeCloseTo(beforeNegative?.y ?? 0, 3);
    expect(afterPositive?.x).toBeCloseTo(beforePositive?.x ?? 0, 3);
    expect(afterPositive?.y).toBeCloseTo(beforePositive?.y ?? 0, 3);
  });

  it('persists component type, variant, typed state and owner manifest pins in schema v3', () => {
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
