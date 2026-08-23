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
  'battery-9v': [23.5763, 52.667],
  'resistor-axial': [2.54, 11.582],
  'led-5mm': [4.8381, 8.0635],
  'button-tactile-6mm': [10, 10],
  potentiometer: [12.192, 13.716],
  photoresistor: [10.2973, 12.1508],
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
  'diode-do35': [18, 6],
  'diode-do41': [20, 7],
  'rgb-led': [8.75, 10.125],
  'seven-segment-display': [12.7, 19.05],
  'incandescent-lamp': [20, 30],
  'transistor-npn': [5.79, 9.6371],
  'transistor-pnp': [5.79, 9.6371],
  'transistor-fet': [5.79, 9.6371],
  'arduino-uno': [78.74, 58.816875],
  'piezo-passive-buzzer': [22.133, 22],
  'piezo-disc': [24, 24],
} as const;

const BREADBOARD_MOUNTABLE = [
  ['resistor-axial', 'lead-1', 'J1'],
  ['led-5mm', 'cathode', 'J1'],
  ['button-tactile-6mm', 'SW-A1', 'J1'],
  ['potentiometer', 'terminal-1', 'J1'],
  ['photoresistor', 'lead-1', 'J2'],
  ['switch-spdt', 'throw-left', 'J1'],
  ['diode-do35', 'anode', 'J1'],
  ['diode-do41', 'anode', 'J1'],
  ['rgb-led', 'red', 'J1'],
  ['seven-segment-display', 'top-1', 'F1'],
  ['incandescent-lamp', 'L1', 'J1'],
  ['transistor-npn', 'base', 'J2'],
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
      'lead-1': { label: 'Вывод 1' },
      'lead-2': { label: 'Вывод 2' },
    });
    expect(entries.get('rgb-led')?.terminals).toMatchObject({
      red: { label: 'Красный' },
      green: { label: 'Зеленый' },
      blue: { label: 'Синий' },
      common: { label: 'Катод' },
    });
    expect(entries.get('transistor-npn')?.terminals).toMatchObject({
      collector: { label: 'Коллектор' },
      base: { label: 'База' },
      emitter: { label: 'Эмиттер' },
    });
    expect(entries.get('transistor-pnp')?.terminals).toMatchObject({
      collector: { label: 'Коллектор' },
      base: { label: 'База' },
      emitter: { label: 'Эмиттер' },
    });
    expect(entries.get('transistor-fet')?.terminals).toMatchObject({
      gate: { label: 'Затвор' },
      source: { label: 'Исток' },
      drain: { label: 'Сток' },
    });
    expect(entries.get('button-tactile-6mm')?.terminals).toMatchObject({
      'SW-A1': { label: '1a' },
      'SW-A2': { label: '1b' },
      'SW-B1': { label: '2a' },
      'SW-B2': { label: '2b' },
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
    expect(entries.get('arduino-uno')?.terminals).toMatchObject({
      scl: { label: 'SCL' },
      sda: { label: 'SDA' },
      aref: { label: 'AREF' },
      'gnd-top': { label: 'GND' },
      d0: { label: 'D0 / RX' },
      d1: { label: 'D1 / TX' },
      d13: { label: 'D13' },
      ioref: { label: 'IOREF' },
      'power-3v3': { label: '3.3V' },
      'power-5v': { label: '5V' },
      vin: { label: 'VIN' },
      a0: { label: 'A0' },
      a5: { label: 'A5' },
    });
  });

  it('anchors all Arduino contacts to the real 2.54 mm header centres', () => {
    const arduino = productionCatalog().find((entry) => entry.key === 'arduino-uno');
    expect(arduino).toBeDefined();
    expect(arduino?.runtimePath).toBe('/assets/electronics/owner-approved/arduino-uno.svg');
    expect(arduino?.runtimeSha256).toBe(
      'c4bba011bb122735bf8e1d23d266e2c545e2575c5f17c650294ad0015117027d',
    );
    expect(Object.keys(arduino?.terminals ?? {})).toHaveLength(31);

    const expectedPixels: Readonly<Record<string, readonly [number, number]>> = {
      scl: [337, 64],
      sda: [369, 64],
      aref: [401, 64],
      'gnd-top': [433, 64],
      d13: [465, 64],
      d8: [625, 64],
      d7: [675, 64],
      d0: [899, 64],
      ioref: [484, 671],
      reset: [516, 671],
      'power-3v3': [548, 671],
      'power-5v': [580, 671],
      'power-gnd-1': [612, 671],
      'power-gnd-2': [644, 671],
      vin: [676, 671],
      a0: [739, 671],
      a5: [899, 671],
    };
    for (const [pinId, [xPixel, yPixel]] of Object.entries(expectedPixels)) {
      const pin = arduino?.terminals[pinId];
      expect(pin, pinId).toBeDefined();
      expect(pin?.xMm, `${pinId}:x`).toBeCloseTo((xPixel * 2.54) / 32, 3);
      expect(pin?.yMm, `${pinId}:y`).toBeCloseTo((yPixel * 2.54) / 32, 3);
      expect(pin?.toleranceMm, pinId).toBeLessThanOrEqual(0.25);
    }
  });

  it('groups owner assets into deterministic families and safe tiers', () => {
    const families = workbenchCatalog();
    const basicFamilies = families.filter((family) => familyMatchesCategory(family, 'basic'));
    expect(basicFamilies.map((family) => family.familyId)).toEqual([
      'resistor',
      'led',
      'button',
      'potentiometer',
      'capacitor',
      'spdt-switch',
      'battery',
      'battery-holder-aa',
      'breadboard',
      'arduino-uno',
      'vibration-motor',
      'dc-motor',
      'servo',
      'transistor',
      'rgb-led',
      'diode',
      'photoresistor',
      'piezo',
      'multimeter',
      'seven-segment',
      'lamp',
      'regulated-power-supply',
    ]);
    expect(basicFamilies.some((family) => family.familyId === 'microbit')).toBe(false);
    expect(basicFamilies).toHaveLength(families.length);
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
      enabled: true,
      appearsInBasic: true,
      simulationStatus: 'supported',
      defaultVariantId: 'battery-9v',
    });
    // The confirmed 9 V «Крона» is the family's only variant with owner art;
    // cells without confirmed SVG stay out of the family entirely.
    expect(
      families.find((family) => family.familyId === 'battery')?.variants.map((v) => v.variantId),
    ).toEqual(['battery-9v']);
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
            /^\/assets\/electronics\/(owner-supplied|owner-approved|owner-audit\/components)\/.*\.svg$/,
          );
          expect(entry.asset, variant.variantId).not.toContain('/production/');
          expect(entry.asset, variant.variantId).not.toContain('/source-reference/');
        } else {
          expect(['vibration-motor']).toContain(entry.preview);
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

  it.each([
    ['battery-holder-aa-1', 1.5, 1],
    ['battery-holder-aa-2', 3, 2],
    ['battery-holder-aa-3', 4.5, 3],
    ['battery-holder-aa-4', 6, 4],
    ['battery-holder-aa-6', 9, 6],
    ['battery-holder-aa-8', 12, 8],
  ] as const)('maps %s to its physical series voltage', (componentTypeId, voltage, cells) => {
    const entry = productionCatalog().find((candidate) => candidate.key === componentTypeId);
    expect(entry).toMatchObject({
      defaultValue: voltage,
      defaultStateProperties: { cells },
      unit: 'В',
      simulationSupported: true,
    });
  });

  it('gives the standard axial resistor a visible quarter-watt rating', () => {
    const entry = productionCatalog().find((candidate) => candidate.key === 'resistor-axial');
    expect(entry?.defaultStateProperties).toMatchObject({ powerRatingWatt: 0.25 });
  });

  it('persists the Tinkercad RGB pin layout and maps terminal names onto physical legs', () => {
    let document = addComponentToDocument(EMPTY, 'rgb-led', { x: 300, y: 240 }, 'rgb').document;
    expect(document.components[0]?.stateProperties).toMatchObject({
      commonMode: 'common-cathode',
      pinLayout: 'RCBG',
    });
    document = updateSelectionProperties(
      document,
      { kind: 'component', id: 'rgb', ids: ['rgb'] },
      { red: 20, green: 80, blue: 55, pinLayout: 'BRCG' },
    ) as SchematicDocument;
    const restored = JSON.parse(JSON.stringify(document)) as SchematicDocument;
    expect(restored.components[0]).toMatchObject({
      componentTypeId: 'rgb-led',
      variantId: 'rgb-led',
      stateProperties: {
        red: 20,
        green: 80,
        blue: 55,
        commonMode: 'common-cathode',
        pinLayout: 'BRCG',
      },
      pinIds: ['red', 'common', 'green', 'blue'],
    });
    const rgb = restored.components[0];
    const physicalOrder = ['blue', 'red', 'common', 'green'];
    const pins = rgb
      ? physicalOrder.map((pinId) => terminalPosition(rgb, rgb.position, pinId, rgb.rotation ?? 0))
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

  it('persists the owner NPN pin map and electrical properties after reload', () => {
    let document = addComponentToDocument(
      EMPTY,
      'transistor-npn',
      { x: 300, y: 240 },
      'q1',
    ).document;
    document = updateSelectionProperties(
      document,
      { kind: 'component', id: 'q1', ids: ['q1'] },
      { currentGain: 180 },
    ) as SchematicDocument;

    const restored = JSON.parse(JSON.stringify(document)) as SchematicDocument;
    expect(restored.components[0]).toMatchObject({
      kind: 'transistor',
      componentTypeId: 'transistor-npn',
      variantId: 'transistor-npn',
      value: 100,
      pinIds: ['base', 'collector', 'emitter'],
      stateProperties: {
        currentGain: 180,
        baseEmitterVoltage: 0.7,
        saturationVoltage: 0.2,
        maxCollectorCurrent: 0.2,
      },
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
        const landingErrorMm =
          Math.hypot(physical.x - landing.x, physical.y - landing.y) / WORLD_UNITS_PER_MM;
        if (componentTypeId === 'transistor-npn') {
          // The exact owner package has 1.882 mm lead spacing. A real TO-92 part
          // bends the outer leads onto adjacent 2.54 mm breadboard holes; the
          // contact anchor remains at the drawn metal tip while the mounted-lead
          // segment makes that small, explicit bend.
          expect(
            landingErrorMm,
            `${componentTypeId}:${pinId}:landing-error-mm`,
          ).toBeLessThanOrEqual(pinId === 'base' ? 0.025 : 0.67);
        } else {
          expect(
            landingErrorMm,
            `${componentTypeId}:${pinId}:landing-error-mm`,
          ).toBeLessThanOrEqual(0.01);
        }
      }
    }
  });
});
