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
  productionCatalog,
  type OwnerCatalogManifest,
} from '../production-manifest-adapter';
import {
  addComponentToDocument,
  componentsBoundToBreadboard,
  moveComponentInDocument,
  snapComponentToBreadboard,
  terminalPositionInDocument,
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

const ACTIVE_PHYSICAL_SIZE_MM = {
  'resistor-axial': [2.54, 11.582],
  'led-5mm': [4.8381, 8.0635],
  'button-tactile-6mm': [10, 10],
  potentiometer: [12.192, 13.716],
  'switch-spdt': [7.112, 3.81],
  'breadboard-small': [47, 35],
  'breadboard-medium': [83, 55],
  'breadboard-large': [165.1, 54.6],
  'battery-holder-aa-1': [20, 60.2],
  'battery-holder-aa-2': [34.2756, 60.2],
  'battery-holder-aa-3': [48.5512, 60.2],
  'battery-holder-aa-4': [62.8269, 60.2],
  'battery-holder-aa-6': [91.3781, 60.2],
  'battery-holder-aa-8': [119.9293, 60.2],
  'diode-do35': [11.582, 2.54],
  'diode-do41': [15, 5.25],
  'rgb-led': [8.75, 10.125],
  'seven-segment-display': [12.7, 19.05],
  'incandescent-lamp': [20, 30],
} as const;

const BREADBOARD_MOUNTABLE = [
  ['resistor-axial', 'lead-1', 'J1'],
  ['led-5mm', 'anode', 'J1'],
  ['button-tactile-6mm', 'SW-A1', 'J1'],
  ['potentiometer', 'terminal-1', 'J1'],
  ['switch-spdt', 'throw-left', 'J1'],
  ['diode-do35', 'anode', 'J1'],
  ['diode-do41', 'anode', 'J1'],
  ['rgb-led', 'red', 'J1'],
  ['seven-segment-display', 'top-1', 'F1'],
  ['incandescent-lamp', 'L1', 'J1'],
] as const;

beforeAll(() => {
  const root = resolve(process.cwd(), 'apps/web/public/assets/electronics/owner-catalog');
  configureProductionLibrary(
    JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8')) as OwnerCatalogManifest,
  );
});

describe('owner SVG integration in the real Electronics document', () => {
  it('uses one breadboard-authoritative physical scale for every active owner variant', () => {
    const entries = productionCatalog();
    expect(entries.map((entry) => entry.key).sort()).toEqual(
      Object.keys(ACTIVE_PHYSICAL_SIZE_MM).sort(),
    );

    for (const entry of entries) {
      const expected = ACTIVE_PHYSICAL_SIZE_MM[entry.key as keyof typeof ACTIVE_PHYSICAL_SIZE_MM];
      expect(expected, entry.key).toBeDefined();
      if (!expected) throw new Error(`missing physical-size contract for ${entry.key}`);
      expect(entry.physicalSizeMm, entry.key).toEqual({ width: expected[0], height: expected[1] });
      expect(renderedSize(entry), entry.key).toEqual({
        width: expected[0] * WORLD_UNITS_PER_MM,
        height: expected[1] * WORLD_UNITS_PER_MM,
      });
      expect(renderedSize(entry, 90), entry.key).toEqual({
        width: expected[1] * WORLD_UNITS_PER_MM,
        height: expected[0] * WORLD_UNITS_PER_MM,
      });
      for (const pin of Object.values(entry.terminals)) {
        expect(pin.xMm, `${entry.key}:${pin.id}:x`).toBeGreaterThanOrEqual(0);
        expect(pin.xMm, `${entry.key}:${pin.id}:x`).toBeLessThanOrEqual(expected[0]);
        expect(pin.yMm, `${entry.key}:${pin.id}:y`).toBeGreaterThanOrEqual(0);
        expect(pin.yMm, `${entry.key}:${pin.id}:y`).toBeLessThanOrEqual(expected[1]);
      }
    }
  });

  it('publishes component-specific terminal names instead of generic invented labels', () => {
    const entries = new Map(productionCatalog().map((entry) => [entry.key, entry]));
    expect(entries.get('resistor-axial')?.terminals).toMatchObject({
      'lead-1': { label: 'Клемма 1' },
      'lead-2': { label: 'Клемма 2' },
    });
    expect(entries.get('rgb-led')?.terminals).toMatchObject({
      red: { label: 'R' },
      green: { label: 'G' },
      blue: { label: 'B' },
      common: { label: 'Общий' },
    });
    expect(entries.get('button-tactile-6mm')?.terminals).toMatchObject({
      'SW-A1': { label: 'Клемма 1a' },
      'SW-A2': { label: 'Клемма 1b' },
      'SW-B1': { label: 'Клемма 2a' },
      'SW-B2': { label: 'Клемма 2b' },
    });
    expect(entries.get('seven-segment-display')?.terminals).toMatchObject({
      'top-1': { label: 'G' },
      'top-2': { label: 'F' },
      'top-3': { label: 'COM2' },
      'top-4': { label: 'A' },
      'top-5': { label: 'B' },
      'bottom-1': { label: 'E' },
      'bottom-2': { label: 'D' },
      'bottom-3': { label: 'COM1' },
      'bottom-4': { label: 'C' },
      'bottom-5': { label: 'DP' },
    });
  });

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
    const rgb = document.components[0];
    const pins = rgb
      ? ['red', 'common', 'green', 'blue'].map((pinId) =>
          terminalPosition(rgb, rgb.position, pinId, rgb.rotation ?? 0),
        )
      : [];
    expect(pins.every(Boolean)).toBe(true);
    expect(pins[0]?.y).toBeCloseTo((rgb?.position.y ?? 0) + 9.3 * WORLD_UNITS_PER_MM, 6);
    for (let index = 1; index < pins.length; index += 1) {
      expect(pins[index]?.y).toBeCloseTo(pins[0]?.y ?? 0, 6);
      expect((pins[index]?.x ?? 0) - (pins[index - 1]?.x ?? 0)).toBeCloseTo(
        2.54 * WORLD_UNITS_PER_MM,
        6,
      );
    }
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

  it('lands an axial resistor across the full five-hole tie group', () => {
    let document = addComponentToDocument(
      EMPTY,
      'breadboard-medium',
      { x: 600, y: 360 },
      'board',
    ).document;
    document = addComponentToDocument(
      document,
      'resistor-axial',
      { x: 400, y: 300 },
      'resistor',
    ).document;
    const board = document.components.find((component) => component.id === 'board');
    const resistor = document.components.find((component) => component.id === 'resistor');
    const definition = productionBreadboard('breadboard-medium');
    const originHole = definition?.holes.find((hole) => hole.id === 'J1');
    const pin = resistor
      ? terminalPosition(resistor, resistor.position, 'lead-1', resistor.rotation ?? 0)
      : null;
    expect(board && resistor && definition && originHole && pin).toBeTruthy();
    if (!board || !resistor || !definition || !originHole || !pin) return;
    document = moveComponentInDocument(document, 'resistor', {
      x: resistor.position.x + board.position.x + originHole.xMm * WORLD_UNITS_PER_MM - pin.x,
      y: resistor.position.y + board.position.y + originHole.yMm * WORLD_UNITS_PER_MM - pin.y,
    });
    document = snapComponentToBreadboard(document, 'resistor');
    const snapped = document.components.find((component) => component.id === 'resistor');
    expect(snapped?.holeBindings).toEqual({
      'lead-1': { breadboardComponentId: 'board', holeId: 'J1' },
      'lead-2': { breadboardComponentId: 'board', holeId: 'F1' },
    });
    expect(componentsBoundToBreadboard(document, 'board')).toContain('resistor');
    expect(snapped && terminalPositionInDocument(document, snapped, 'lead-2')).toEqual({
      x: board.position.x + originHole.xMm * WORLD_UNITS_PER_MM,
      y: board.position.y + (originHole.yMm + 10.16) * WORLD_UNITS_PER_MM,
    });
  });

  it('mounts the ten real seven-segment pins on two stable breadboard rows', () => {
    let document = addComponentToDocument(
      EMPTY,
      'breadboard-medium',
      { x: 600, y: 360 },
      'board',
    ).document;
    document = addComponentToDocument(
      document,
      'seven-segment-display',
      { x: 400, y: 300 },
      'display',
    ).document;
    const board = document.components.find((component) => component.id === 'board');
    const display = document.components.find((component) => component.id === 'display');
    const definition = productionBreadboard('breadboard-medium');
    const originHole = definition?.holes.find((hole) => hole.id === 'F1');
    const pin = display
      ? terminalPosition(display, display.position, 'top-1', display.rotation ?? 0)
      : null;
    expect(board && display && definition && originHole && pin).toBeTruthy();
    if (!board || !display || !definition || !originHole || !pin) return;
    document = moveComponentInDocument(document, 'display', {
      x: display.position.x + board.position.x + originHole.xMm * WORLD_UNITS_PER_MM - pin.x,
      y: display.position.y + board.position.y + originHole.yMm * WORLD_UNITS_PER_MM - pin.y,
    });
    document = snapComponentToBreadboard(document, 'display');
    const snapped = document.components.find((component) => component.id === 'display');
    expect(Object.keys(snapped?.holeBindings ?? {})).toHaveLength(10);
    expect(snapped?.holeBindings).toMatchObject({
      'top-1': { breadboardComponentId: 'board', holeId: 'F1' },
      'top-5': { breadboardComponentId: 'board', holeId: 'F5' },
      'bottom-1': { breadboardComponentId: 'board', holeId: 'B1' },
      'bottom-5': { breadboardComponentId: 'board', holeId: 'B5' },
    });
  });

  it('lands every mountable owner component on its complete breadboard footprint', () => {
    for (const [componentTypeId, firstPinId, originHoleId] of BREADBOARD_MOUNTABLE) {
      let document = addComponentToDocument(
        EMPTY,
        'breadboard-medium',
        { x: 600, y: 360 },
        'board',
      ).document;
      document = addComponentToDocument(
        document,
        componentTypeId,
        { x: 400, y: 300 },
        'part',
      ).document;
      const board = document.components.find((component) => component.id === 'board');
      const part = document.components.find((component) => component.id === 'part');
      const entry = part
        ? workbenchCatalog()
            .flatMap((family) => family.variants)
            .find((variant) => variant.componentTypeId === componentTypeId)?.entry
        : null;
      const definition = productionBreadboard('breadboard-medium');
      const originHole = definition?.holes.find((hole) => hole.id === originHoleId);
      const pin = part
        ? terminalPosition(part, part.position, firstPinId, part.rotation ?? 0)
        : null;
      expect(
        board && part && entry && definition && originHole && pin,
        componentTypeId,
      ).toBeTruthy();
      if (!board || !part || !entry || !definition || !originHole || !pin) continue;

      document = moveComponentInDocument(document, 'part', {
        x: part.position.x + board.position.x + originHole.xMm * WORLD_UNITS_PER_MM - pin.x,
        y: part.position.y + board.position.y + originHole.yMm * WORLD_UNITS_PER_MM - pin.y,
      });
      document = snapComponentToBreadboard(document, 'part');
      const snapped = document.components.find((component) => component.id === 'part');
      const bindings = snapped?.holeBindings ?? {};
      expect(Object.keys(bindings), componentTypeId).toHaveLength(
        entry.footprint?.pinOffsetsMm?.length ?? 0,
      );
      expect(bindings[firstPinId], componentTypeId).toEqual({
        breadboardComponentId: 'board',
        holeId: originHoleId,
      });
      expect(
        new Set(Object.values(bindings).map((binding) => binding.holeId)).size,
        componentTypeId,
      ).toBe(Object.keys(bindings).length);
      for (const pinId of snapped?.pinIds ?? []) {
        const physical = snapped
          ? terminalPosition(snapped, snapped.position, pinId, snapped.rotation ?? 0)
          : null;
        const landing = snapped ? terminalPositionInDocument(document, snapped, pinId) : null;
        expect(physical && landing, `${componentTypeId}:${pinId}:landing`).toBeTruthy();
        if (!physical || !landing) continue;
        expect(
          Math.hypot(physical.x - landing.x, physical.y - landing.y) / WORLD_UNITS_PER_MM,
          `${componentTypeId}:${pinId}:landing-error-mm`,
        ).toBeLessThanOrEqual(0.01);
      }
    }
  });
});
