import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import type { SchematicDocument } from '../apps/web/src/api';
import { collectBrowserFailures } from './browser-failures';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher, type SeededTeacher } from './seed';

const ARTIFACT_DIR = 'e2e/artifacts/electronics-simulation';

let admin: pg.Pool;
let teacher: SeededTeacher;

interface OwnerCatalogFixture {
  readonly components: ReadonlyArray<{
    readonly componentId: string;
    readonly pins: ReadonlyArray<{ readonly id: string }>;
  }>;
}

const ownerCatalog = JSON.parse(
  readFileSync(
    resolve(process.cwd(), 'apps/web/public/assets/electronics/owner-catalog/manifest.json'),
    'utf8',
  ),
) as OwnerCatalogFixture;
const breadboardPinIds = ownerCatalog.components
  .find((component) => component.componentId === 'breadboard-medium')
  ?.pins.map((pin) => pin.id);

if (!breadboardPinIds) throw new Error('breadboard-medium owner manifest entry is missing');

function circuitDocument(options: {
  readonly switchClosed: boolean;
  readonly resistorOhms: number;
  readonly reversedLed: boolean;
  readonly running?: boolean;
}): SchematicDocument {
  const ledInput = options.reversedLed ? 'cathode' : 'anode';
  const ledReturn = options.reversedLed ? 'anode' : 'cathode';
  return {
    schemaVersion: 4,
    components: [
      {
        id: 'source',
        kind: 'source',
        componentTypeId: 'battery-holder-aa-2',
        variantId: 'battery-holder-aa-2',
        name: 'Источник 3 В',
        position: { x: 70, y: 110 },
        rotation: 0,
        value: 3,
        pinIds: ['BAT-', 'BAT+'],
        stateProperties: { cells: 2 },
      },
      {
        id: 'board',
        kind: 'breadboard',
        componentTypeId: 'breadboard-medium',
        variantId: 'breadboard-medium',
        name: 'Макетная плата',
        position: { x: 260, y: 380 },
        rotation: 0,
        value: 0,
        pinIds: ['J1', 'I1'],
        internalConnections: [['J1', 'I1']],
        stateProperties: {},
      },
      {
        id: 'switch',
        kind: 'switch',
        componentTypeId: 'switch-spdt',
        variantId: 'switch-spdt',
        name: 'SW1',
        position: { x: 390, y: 120 },
        rotation: 0,
        value: 0,
        state: options.switchClosed,
        pinIds: ['throw-left', 'common', 'throw-right'],
        stateProperties: { selectedThrow: options.switchClosed ? 'right' : 'left' },
      },
      {
        id: 'resistor',
        kind: 'resistor',
        componentTypeId: 'resistor-axial',
        variantId: 'resistor-axial',
        name: 'R1',
        position: { x: 610, y: 150 },
        rotation: 90,
        value: options.resistorOhms,
        pinIds: ['lead-1', 'lead-2'],
        stateProperties: { tolerancePercent: 5, resistanceUnit: 'Ом' },
      },
      {
        id: 'led',
        kind: 'led',
        componentTypeId: 'led-5mm',
        variantId: 'led-5mm',
        name: 'LED1',
        position: { x: 790, y: 140 },
        rotation: 0,
        value: 2,
        pinIds: ['anode', 'cathode'],
        stateProperties: { ledColour: 'red', ledBrightness: 0, ledFault: 'none' },
      },
    ],
    connections: [
      {
        id: 'wire-source-board',
        from: { componentId: 'source', terminal: 'BAT+' },
        to: { componentId: 'board', terminal: 'J1' },
        color: '#e3212b',
        vertices: [{ x: 230, y: 300 }],
      },
      {
        id: 'wire-board-switch',
        from: { componentId: 'board', terminal: 'I1' },
        to: { componentId: 'switch', terminal: 'common' },
        color: '#e3212b',
        vertices: [{ x: 430, y: 320 }],
      },
      {
        id: 'wire-switch-resistor',
        from: { componentId: 'switch', terminal: 'throw-right' },
        to: { componentId: 'resistor', terminal: 'lead-1' },
        color: '#149447',
        vertices: [],
      },
      {
        id: 'wire-resistor-led',
        from: { componentId: 'resistor', terminal: 'lead-2' },
        to: { componentId: 'led', terminal: ledInput },
        color: '#149447',
        vertices: [],
      },
      {
        id: 'wire-led-source',
        from: { componentId: 'led', terminal: ledReturn },
        to: { componentId: 'source', terminal: 'BAT-' },
        color: '#2a3035',
        vertices: [
          { x: 820, y: 330 },
          { x: 160, y: 330 },
        ],
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: options.running ?? false, maxIterations: 24 },
  };
}

function diodeProfileDocument(componentTypeId: 'diode-do35' | 'diode-do41'): SchematicDocument {
  const seeded = circuitDocument({ switchClosed: true, resistorOhms: 220, reversedLed: false });
  return {
    ...seeded,
    components: seeded.components.map((item) =>
      item.id === 'led'
        ? {
            ...item,
            kind: 'diode' as const,
            componentTypeId,
            variantId: componentTypeId,
            name: componentTypeId === 'diode-do41' ? 'Диод DO-41' : 'Диод DO-35',
            value: 0.7,
            pinIds: ['anode', 'cathode'],
            stateProperties: {},
          }
        : item,
    ),
  };
}

function photoresistorDocument(): SchematicDocument {
  return {
    schemaVersion: 4,
    components: [
      {
        id: 'source',
        kind: 'source',
        componentTypeId: 'battery-holder-aa-2',
        variantId: 'battery-holder-aa-2',
        name: 'Источник 3 В',
        position: { x: 150, y: 360 },
        rotation: 0,
        value: 3,
        pinIds: ['BAT-', 'BAT+'],
        stateProperties: { cells: 2 },
      },
      {
        id: 'resistor',
        kind: 'resistor',
        componentTypeId: 'resistor-axial',
        variantId: 'resistor-axial',
        name: 'R1 10 кОм',
        position: { x: 520, y: 170 },
        rotation: 90,
        value: 10_000,
        pinIds: ['lead-1', 'lead-2'],
        stateProperties: { tolerancePercent: 5, resistanceUnit: 'кОм' },
      },
      {
        id: 'ldr',
        kind: 'photoresistor',
        componentTypeId: 'photoresistor',
        variantId: 'photoresistor',
        name: 'Фоторезистор',
        position: { x: 740, y: 190 },
        rotation: 0,
        value: 15_000,
        pinIds: ['lead-1', 'lead-2'],
        stateProperties: { illumination: 0.5 },
      },
    ],
    connections: [
      {
        id: 'positive-resistor',
        from: { componentId: 'source', terminal: 'BAT+' },
        to: { componentId: 'resistor', terminal: 'lead-1' },
        color: '#e3212b',
        vertices: [],
      },
      {
        id: 'resistor-ldr',
        from: { componentId: 'resistor', terminal: 'lead-2' },
        to: { componentId: 'ldr', terminal: 'lead-1' },
        color: '#149447',
        vertices: [],
      },
      {
        id: 'ldr-negative',
        from: { componentId: 'ldr', terminal: 'lead-2' },
        to: { componentId: 'source', terminal: 'BAT-' },
        color: '#2a3035',
        vertices: [],
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

function incandescentLampDocument(): SchematicDocument {
  return {
    schemaVersion: 4,
    components: [
      {
        id: 'source',
        kind: 'source',
        componentTypeId: 'battery-holder-aa-4',
        variantId: 'battery-holder-aa-4',
        name: 'Источник 6 В',
        position: { x: 190, y: 340 },
        rotation: 0,
        value: 6,
        pinIds: ['BAT-', 'BAT+'],
        stateProperties: { cells: 4 },
      },
      {
        id: 'lamp',
        kind: 'lamp',
        componentTypeId: 'incandescent-lamp',
        variantId: 'incandescent-lamp',
        name: 'Лампа накаливания',
        position: { x: 650, y: 220 },
        rotation: 0,
        value: 6,
        pinIds: ['L1', 'L2'],
        stateProperties: { lampLevel: 'off' },
      },
    ],
    connections: [
      {
        id: 'positive-lamp',
        from: { componentId: 'source', terminal: 'BAT+' },
        to: { componentId: 'lamp', terminal: 'L1' },
        color: '#e3212b',
        vertices: [],
      },
      {
        id: 'lamp-negative',
        from: { componentId: 'lamp', terminal: 'L2' },
        to: { componentId: 'source', terminal: 'BAT-' },
        color: '#2a3035',
        vertices: [],
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

function npnKeyDocument(): SchematicDocument {
  return {
    schemaVersion: 4,
    components: [
      {
        id: 'source',
        kind: 'source',
        componentTypeId: 'battery-holder-aa-3',
        variantId: 'battery-holder-aa-3',
        name: 'Источник 4,5 В',
        position: { x: 120, y: 300 },
        rotation: 0,
        value: 4.5,
        pinIds: ['BAT-', 'BAT+'],
        stateProperties: { cells: 3 },
      },
      {
        id: 'rb',
        kind: 'resistor',
        componentTypeId: 'resistor-axial',
        variantId: 'resistor-axial',
        name: 'Rbase 100 кОм',
        position: { x: 360, y: 180 },
        rotation: 90,
        value: 100_000,
        pinIds: ['lead-1', 'lead-2'],
        stateProperties: { tolerancePercent: 5, resistanceUnit: 'кОм' },
      },
      {
        id: 'rc',
        kind: 'resistor',
        componentTypeId: 'resistor-axial',
        variantId: 'resistor-axial',
        name: 'Rcollector 470 Ом',
        position: { x: 570, y: 180 },
        rotation: 90,
        value: 470,
        pinIds: ['lead-1', 'lead-2'],
        stateProperties: { tolerancePercent: 5, resistanceUnit: 'Ом' },
      },
      {
        id: 'q1',
        kind: 'transistor',
        componentTypeId: 'transistor-npn',
        variantId: 'transistor-npn',
        name: 'NPN-транзистор',
        position: { x: 610, y: 350 },
        rotation: 0,
        value: 100,
        pinIds: ['collector', 'base', 'emitter'],
        stateProperties: {
          transistorType: 'npn',
          currentGain: 100,
          baseEmitterVoltage: 0.7,
          saturationVoltage: 0.2,
          earlyVoltage: 100,
          maxCollectorCurrent: 0.2,
        },
      },
    ],
    connections: [
      {
        id: 'positive-base',
        from: { componentId: 'source', terminal: 'BAT+' },
        to: { componentId: 'rb', terminal: 'lead-1' },
        color: '#e3212b',
        vertices: [],
      },
      {
        id: 'base-drive',
        from: { componentId: 'rb', terminal: 'lead-2' },
        to: { componentId: 'q1', terminal: 'base' },
        color: '#149447',
        vertices: [],
      },
      {
        id: 'positive-collector',
        from: { componentId: 'source', terminal: 'BAT+' },
        to: { componentId: 'rc', terminal: 'lead-1' },
        color: '#e3212b',
        vertices: [],
      },
      {
        id: 'collector-load',
        from: { componentId: 'rc', terminal: 'lead-2' },
        to: { componentId: 'q1', terminal: 'collector' },
        color: '#149447',
        vertices: [],
      },
      {
        id: 'emitter-return',
        from: { componentId: 'q1', terminal: 'emitter' },
        to: { componentId: 'source', terminal: 'BAT-' },
        color: '#2a3035',
        vertices: [],
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

function buttonCircuitDocument(resistorOhms: number): SchematicDocument {
  const seeded = circuitDocument({
    switchClosed: false,
    resistorOhms,
    reversedLed: false,
  });
  return {
    ...seeded,
    components: seeded.components.map((item) =>
      item.id === 'switch'
        ? {
            ...item,
            id: 'button',
            kind: 'button' as const,
            componentTypeId: 'button-tactile-6mm',
            variantId: 'button-tactile-6mm',
            name: 'S1',
            state: false,
            pinIds: ['SW-A1', 'SW-A2', 'SW-B1', 'SW-B2'],
            internalConnections: [
              ['SW-A1', 'SW-A2'],
              ['SW-B1', 'SW-B2'],
            ],
            stateProperties: {},
          }
        : item,
    ),
    connections: seeded.connections.map((wire) =>
      wire.id === 'wire-board-switch'
        ? {
            ...wire,
            to: { componentId: 'button', terminal: 'SW-A2' },
          }
        : wire.id === 'wire-switch-resistor'
          ? {
              ...wire,
              from: { componentId: 'button', terminal: 'SW-B2' },
            }
          : wire,
    ),
  };
}

function capacitorInteractionDocument(): SchematicDocument {
  return {
    schemaVersion: 4,
    components: [
      {
        id: 'resistor',
        kind: 'resistor',
        componentTypeId: 'resistor-axial',
        variantId: 'resistor-axial',
        name: 'Резистор',
        position: { x: 620, y: 250 },
        rotation: 0,
        value: 1_000,
        pinIds: ['lead-1', 'lead-2'],
        stateProperties: { tolerancePercent: 5, resistanceUnit: 'кОм' },
      },
      {
        id: 'capacitor',
        kind: 'visual',
        componentTypeId: 'electrolytic-capacitor',
        variantId: 'electrolytic-capacitor',
        name: 'Электролитический конденсатор',
        position: { x: 360, y: 250 },
        rotation: 0,
        value: 10_000,
        pinIds: ['negative', 'positive'],
        stateProperties: { initialVoltageVolt: 0, voltageRatingVolt: 25 },
      },
      {
        id: 'battery-holder',
        kind: 'source',
        componentTypeId: 'battery-holder-aa-2',
        variantId: 'battery-holder-aa-2',
        name: 'Батарейный отсек 2×AA',
        position: { x: 850, y: 210 },
        rotation: 0,
        value: 3,
        pinIds: ['BAT-', 'BAT+'],
        stateProperties: { cells: 2, internalResistanceOhm: 0.3, maxContinuousCurrentAmp: 2 },
      },
    ],
    connections: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

function dcMotorDocument(): SchematicDocument {
  return {
    schemaVersion: 4,
    components: [
      {
        id: 'source',
        kind: 'source',
        componentTypeId: 'battery-holder-aa-4',
        variantId: 'battery-holder-aa-4',
        name: 'Источник 6 В',
        position: { x: 180, y: 340 },
        rotation: 0,
        value: 6,
        pinIds: ['BAT-', 'BAT+'],
        stateProperties: { cells: 4 },
      },
      {
        id: 'motor',
        kind: 'visual',
        componentTypeId: 'dc-motor',
        variantId: 'dc-motor',
        name: 'Двигатель постоянного тока',
        position: { x: 600, y: 260 },
        rotation: 0,
        value: 6,
        pinIds: ['negative', 'positive'],
        stateProperties: {},
      },
    ],
    connections: [
      {
        id: 'motor-positive',
        from: { componentId: 'source', terminal: 'BAT+' },
        to: { componentId: 'motor', terminal: 'positive' },
        color: '#e3212b',
        vertices: [],
      },
      {
        id: 'motor-negative',
        from: { componentId: 'motor', terminal: 'negative' },
        to: { componentId: 'source', terminal: 'BAT-' },
        color: '#2a3035',
        vertices: [],
      },
    ],
    viewport: { x: 60, y: 80, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

function gearmotorDocument(): SchematicDocument {
  const document = dcMotorDocument();
  return {
    ...document,
    components: document.components.map((component) =>
      component.id === 'motor'
        ? {
            ...component,
            componentTypeId: 'gearmotor',
            variantId: 'gearmotor',
            name: 'Мотор-редуктор TT 1:48',
            stateProperties: { motorAssemblyProfileId: 'adafruit-3777-tt-48to1' },
          }
        : component,
    ),
  };
}

function gearmotorOvervoltageDocument(): SchematicDocument {
  const document = gearmotorDocument();
  return {
    ...document,
    components: document.components.map((component) =>
      component.id === 'source'
        ? {
            ...component,
            componentTypeId: 'battery-holder-aa-8',
            variantId: 'battery-holder-aa-8',
            name: 'Источник 12 В',
            position: { x: 100, y: 430 },
            value: 12,
            stateProperties: { cells: 8 },
          }
        : component.id === 'motor'
          ? { ...component, position: { x: 720, y: 150 } }
          : component,
    ),
  };
}

function dcMotorOvervoltageDocument(): SchematicDocument {
  const document = dcMotorDocument();
  return {
    ...document,
    components: document.components.map((component) =>
      component.id === 'source'
        ? {
            ...component,
            name: 'Источник 23 В',
            value: 23,
            stateProperties: { ...component.stateProperties, internalResistanceOhm: 0 },
          }
        : component,
    ),
  };
}

function reverseCapacitorDocument(): SchematicDocument {
  const interaction = capacitorInteractionDocument();
  return {
    ...interaction,
    components: interaction.components.filter((component) =>
      ['resistor', 'capacitor', 'battery-holder'].includes(component.id),
    ),
    connections: [
      {
        id: 'reverse-source-resistor',
        from: { componentId: 'battery-holder', terminal: 'BAT+' },
        to: { componentId: 'resistor', terminal: 'lead-1' },
        color: '#e3212b',
        vertices: [],
      },
      {
        id: 'reverse-resistor-capacitor',
        from: { componentId: 'resistor', terminal: 'lead-2' },
        to: { componentId: 'capacitor', terminal: 'negative' },
        color: '#149447',
        vertices: [],
      },
      {
        id: 'reverse-capacitor-return',
        from: { componentId: 'capacitor', terminal: 'positive' },
        to: { componentId: 'battery-holder', terminal: 'BAT-' },
        color: '#2a3035',
        vertices: [],
      },
    ],
  };
}

function pnpAstableDocument(capacitanceMicrofarad = 10): SchematicDocument {
  const resistor = (id: string, name: string, x: number, y: number, value: number) => ({
    id,
    kind: 'resistor' as const,
    componentTypeId: 'resistor-axial',
    variantId: 'resistor-axial',
    name,
    position: { x, y },
    rotation: 90 as const,
    value,
    pinIds: ['lead-1', 'lead-2'],
    stateProperties: { tolerancePercent: 5, resistanceUnit: value >= 1_000 ? 'кОм' : 'Ом' },
  });
  const transistor = (id: string, name: string, x: number) => ({
    id,
    kind: 'transistor' as const,
    componentTypeId: 'transistor-pnp',
    variantId: 'transistor-pnp',
    name,
    position: { x, y: 350 },
    rotation: 0 as const,
    value: 100,
    pinIds: ['collector', 'base', 'emitter'],
    stateProperties: { transistorType: 'pnp', currentGain: 100 },
  });
  const led = (id: string, name: string, x: number) => ({
    id,
    kind: 'led' as const,
    componentTypeId: 'led-5mm',
    variantId: 'led-5mm',
    name,
    position: { x, y: 650 },
    rotation: 0 as const,
    value: 2,
    pinIds: ['anode', 'cathode'],
    stateProperties: { ledColour: 'red', ledBrightness: 0, ledFault: 'none' },
  });
  const capacitor = (id: string, name: string, x: number) => ({
    id,
    kind: 'visual' as const,
    componentTypeId: 'electrolytic-capacitor',
    variantId: 'electrolytic-capacitor',
    name,
    position: { x, y: 470 },
    rotation: 0 as const,
    value: capacitanceMicrofarad,
    pinIds: ['negative', 'positive'],
    stateProperties: { voltageRatingVolt: 25, initialVoltageVolt: 0 },
  });
  const wire = (
    id: string,
    fromComponentId: string,
    fromTerminal: string,
    toComponentId: string,
    toTerminal: string,
  ) => ({
    id,
    from: { componentId: fromComponentId, terminal: fromTerminal },
    to: { componentId: toComponentId, terminal: toTerminal },
    color: '#149447',
    vertices: [],
  });

  return {
    schemaVersion: 4,
    components: [
      {
        id: 'source',
        kind: 'source',
        componentTypeId: 'battery-holder-aa-3',
        variantId: 'battery-holder-aa-3',
        name: 'Источник 4,5 В',
        position: { x: 120, y: 430 },
        rotation: 0,
        value: 4.5,
        pinIds: ['BAT-', 'BAT+'],
        stateProperties: { cells: 3, internalResistanceOhm: 0.1, maxContinuousCurrentAmp: 5 },
      },
      resistor('rc1', 'R светодиода 1', 480, 560, 1_000),
      resistor('rc2', 'R светодиода 2', 900, 560, 1_000),
      resistor('rb1', 'R базы 1', 590, 250, 10_000),
      resistor('rb2', 'R базы 2', 790, 250, 10_000),
      transistor('q1', 'PNP-транзистор 1', 530),
      transistor('q2', 'PNP-транзистор 2', 850),
      led('led1', 'Светодиод 1', 480),
      led('led2', 'Светодиод 2', 900),
      capacitor('c1', 'Конденсатор 1', 630),
      capacitor('c2', 'Конденсатор 2', 750),
    ],
    connections: [
      wire('w1', 'q1', 'collector', 'rc1', 'lead-1'),
      wire('w2', 'rc1', 'lead-2', 'led1', 'anode'),
      wire('w3', 'led1', 'cathode', 'source', 'BAT-'),
      wire('w4', 'q2', 'collector', 'rc2', 'lead-1'),
      wire('w5', 'rc2', 'lead-2', 'led2', 'anode'),
      wire('w6', 'led2', 'cathode', 'source', 'BAT-'),
      wire('w7', 'q1', 'base', 'rb1', 'lead-1'),
      wire('w8', 'rb1', 'lead-2', 'source', 'BAT-'),
      wire('w9', 'q2', 'base', 'rb2', 'lead-1'),
      wire('w10', 'rb2', 'lead-2', 'source', 'BAT-'),
      wire('w11', 'q1', 'emitter', 'source', 'BAT+'),
      wire('w12', 'q2', 'emitter', 'source', 'BAT+'),
      wire('w13', 'c1', 'negative', 'q1', 'collector'),
      wire('w14', 'c1', 'positive', 'q2', 'base'),
      wire('w15', 'c2', 'negative', 'q2', 'collector'),
      wire('w16', 'c2', 'positive', 'q1', 'base'),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 32 },
  };
}

function breadboardDocument(): SchematicDocument {
  const seeded = circuitDocument({
    switchClosed: false,
    resistorOhms: 220,
    reversedLed: false,
  });
  return {
    ...seeded,
    components: seeded.components
      .filter((component) => component.id === 'board')
      .map((component) => ({ ...component, pinIds: breadboardPinIds })),
    connections: [],
  };
}

function shortCircuitDocument(): SchematicDocument {
  const source = circuitDocument({
    switchClosed: true,
    resistorOhms: 220,
    reversedLed: false,
  }).components.find((component) => component.id === 'source');
  if (!source) throw new Error('source fixture is missing');
  return {
    schemaVersion: 4,
    components: [source],
    connections: [
      {
        id: 'wire-direct-short',
        from: { componentId: 'source', terminal: 'BAT+' },
        to: { componentId: 'source', terminal: 'BAT-' },
        color: '#e3212b',
        vertices: [],
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

function isolatedSourceDiagnosticsDocument(): SchematicDocument {
  const seeded = circuitDocument({
    switchClosed: true,
    resistorOhms: 220,
    reversedLed: false,
  });
  const originalSource = seeded.components.find((component) => component.id === 'source');
  const originalResistor = seeded.components.find((component) => component.id === 'resistor');
  const originalLed = seeded.components.find((component) => component.id === 'led');
  if (!originalSource || !originalResistor || !originalLed) {
    throw new Error('isolated source diagnostics fixture is incomplete');
  }
  return {
    schemaVersion: 4,
    components: [
      {
        ...originalSource,
        id: 'shorted-source',
        name: 'Источник с КЗ',
        position: { x: 120, y: 360 },
      },
      {
        ...originalSource,
        id: 'safe-source',
        name: 'Исправный источник',
        position: { x: 540, y: 360 },
      },
      {
        ...originalSource,
        id: 'burnout-source',
        name: 'Источник LED без резистора',
        position: { x: 960, y: 360 },
      },
      {
        ...originalResistor,
        id: 'safe-resistor',
        name: 'R безопасной цепи',
        position: { x: 660, y: 200 },
      },
      {
        ...originalLed,
        id: 'safe-led',
        name: 'Исправный LED',
        position: { x: 570, y: 120 },
      },
      {
        ...originalLed,
        id: 'burned-led',
        name: 'LED без резистора',
        position: { x: 1_060, y: 120 },
      },
    ],
    connections: [
      {
        id: 'shorted-wire',
        from: { componentId: 'shorted-source', terminal: 'BAT+' },
        to: { componentId: 'shorted-source', terminal: 'BAT-' },
        color: '#149447',
        vertices: [{ x: 120, y: 300 }],
      },
      {
        id: 'safe-positive',
        from: { componentId: 'safe-source', terminal: 'BAT+' },
        to: { componentId: 'safe-resistor', terminal: 'lead-1' },
        color: '#149447',
        vertices: [],
      },
      {
        id: 'safe-limited',
        from: { componentId: 'safe-resistor', terminal: 'lead-2' },
        to: { componentId: 'safe-led', terminal: 'anode' },
        color: '#149447',
        vertices: [],
      },
      {
        id: 'safe-return',
        from: { componentId: 'safe-led', terminal: 'cathode' },
        to: { componentId: 'safe-source', terminal: 'BAT-' },
        color: '#149447',
        vertices: [],
      },
      {
        id: 'burnout-positive',
        from: { componentId: 'burnout-source', terminal: 'BAT+' },
        to: { componentId: 'burned-led', terminal: 'anode' },
        color: '#149447',
        vertices: [],
      },
      {
        id: 'burnout-return',
        from: { componentId: 'burned-led', terminal: 'cathode' },
        to: { componentId: 'burnout-source', terminal: 'BAT-' },
        color: '#149447',
        vertices: [],
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

function conflictingParallelSourcesDocument(): SchematicDocument {
  const seeded = circuitDocument({
    switchClosed: true,
    resistorOhms: 100,
    reversedLed: false,
  });
  const originalSource = seeded.components.find((component) => component.id === 'source');
  const originalResistor = seeded.components.find((component) => component.id === 'resistor');
  if (!originalSource || !originalResistor) {
    throw new Error('parallel source conflict fixture is incomplete');
  }
  return {
    schemaVersion: 4,
    components: [
      {
        ...originalSource,
        id: 'source-high',
        name: 'Источник 3 В',
        position: { x: 240, y: 360 },
      },
      {
        ...originalSource,
        id: 'source-low',
        componentTypeId: 'battery-holder-aa-1',
        variantId: 'battery-holder-aa-1',
        name: 'Источник 1,5 В',
        value: 1.5,
        position: { x: 600, y: 360 },
        stateProperties: { cells: 1 },
      },
      {
        ...originalResistor,
        id: 'parallel-load',
        name: 'Нагрузка 100 Ом',
        value: 100,
        position: { x: 940, y: 180 },
      },
    ],
    connections: [
      {
        id: 'high-positive',
        from: { componentId: 'source-high', terminal: 'BAT+' },
        to: { componentId: 'parallel-load', terminal: 'lead-1' },
        color: '#e3212b',
        vertices: [],
      },
      {
        id: 'high-negative',
        from: { componentId: 'source-high', terminal: 'BAT-' },
        to: { componentId: 'parallel-load', terminal: 'lead-2' },
        color: '#2a3035',
        vertices: [],
      },
      {
        id: 'low-positive',
        from: { componentId: 'source-low', terminal: 'BAT+' },
        to: { componentId: 'parallel-load', terminal: 'lead-1' },
        color: '#e3212b',
        vertices: [],
      },
      {
        id: 'low-negative',
        from: { componentId: 'source-low', terminal: 'BAT-' },
        to: { componentId: 'parallel-load', terminal: 'lead-2' },
        color: '#2a3035',
        vertices: [],
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

function resistorOverloadDocument(): SchematicDocument {
  const seeded = circuitDocument({
    switchClosed: true,
    resistorOhms: 1,
    reversedLed: false,
  });
  const source = seeded.components.find((component) => component.id === 'source');
  const resistor = seeded.components.find((component) => component.id === 'resistor');
  if (!source || !resistor) throw new Error('resistor overload fixture is incomplete');
  return {
    schemaVersion: 4,
    components: [source, resistor],
    connections: [
      {
        id: 'wire-overload-positive',
        from: { componentId: 'source', terminal: 'BAT+' },
        to: { componentId: 'resistor', terminal: 'lead-1' },
        color: '#e3212b',
        vertices: [],
      },
      {
        id: 'wire-overload-return',
        from: { componentId: 'resistor', terminal: 'lead-2' },
        to: { componentId: 'source', terminal: 'BAT-' },
        color: '#2a3035',
        vertices: [],
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

function directLedWithLoosePartsDocument(): SchematicDocument {
  const seeded = circuitDocument({
    switchClosed: true,
    resistorOhms: 166,
    reversedLed: false,
  });
  const source = seeded.components.find((component) => component.id === 'source');
  const board = seeded.components.find((component) => component.id === 'board');
  const resistor = seeded.components.find((component) => component.id === 'resistor');
  const led = seeded.components.find((component) => component.id === 'led');
  if (!source || !board || !resistor || !led) throw new Error('direct LED fixture is incomplete');

  return {
    ...seeded,
    components: [
      board,
      {
        ...source,
        id: 'open-source',
        name: 'Неподключённый источник',
        position: { x: 80, y: 500 },
      },
      source,
      resistor,
      led,
      { ...led, id: 'unused-led', name: 'Свободный LED', position: { x: 980, y: 360 } },
      {
        id: 'unused-potentiometer',
        kind: 'potentiometer',
        componentTypeId: 'potentiometer',
        variantId: 'potentiometer',
        name: 'Свободный потенциометр',
        position: { x: 1_050, y: 480 },
        rotation: 0,
        value: 1_000,
        pinIds: ['terminal-1', 'terminal-2', 'wiper'],
        stateProperties: {},
      },
      {
        id: 'unused-transistor',
        kind: 'transistor',
        componentTypeId: 'transistor-npn',
        variantId: 'transistor-npn',
        name: 'Свободный NPN',
        position: { x: 1_150, y: 480 },
        rotation: 0,
        value: 100,
        pinIds: ['base', 'collector', 'emitter'],
        stateProperties: {
          currentGain: 100,
          saturationVoltage: 0.2,
          baseEmitterVoltage: 0.7,
          maxCollectorCurrent: 0.2,
        },
      },
      {
        id: 'unused-rgb-led',
        kind: 'rgb-led',
        componentTypeId: 'rgb-led',
        variantId: 'rgb-led',
        name: 'Свободный RGB LED',
        position: { x: 1_250, y: 480 },
        rotation: 0,
        value: 0,
        pinIds: ['red', 'common', 'green', 'blue'],
        stateProperties: { commonMode: 'common-cathode' },
      },
    ],
    connections: [
      {
        id: 'wire-open-source',
        from: { componentId: 'board', terminal: 'J1' },
        to: { componentId: 'open-source', terminal: 'BAT+' },
        color: '#149447',
        vertices: [],
      },
      {
        id: 'wire-positive',
        from: { componentId: 'source', terminal: 'BAT+' },
        to: { componentId: 'resistor', terminal: 'lead-1' },
        color: '#e3212b',
        vertices: [],
      },
      {
        id: 'wire-limited',
        from: { componentId: 'resistor', terminal: 'lead-2' },
        to: { componentId: 'led', terminal: 'anode' },
        color: '#e3212b',
        vertices: [],
      },
      {
        id: 'wire-negative',
        from: { componentId: 'led', terminal: 'cathode' },
        to: { componentId: 'source', terminal: 'BAT-' },
        color: '#149447',
        vertices: [],
      },
    ],
  };
}

function rgbLedDocument(commonMode: 'common-cathode' | 'common-anode'): SchematicDocument {
  const commonCathode = commonMode === 'common-cathode';
  const channels = ['red', 'green', 'blue'] as const;
  return {
    schemaVersion: 4,
    components: [
      {
        id: 'source',
        kind: 'source',
        componentTypeId: 'battery-holder-aa-4',
        variantId: 'battery-holder-aa-4',
        name: 'Источник 6 В',
        position: { x: 100, y: 260 },
        rotation: 0,
        value: 6,
        pinIds: ['BAT-', 'BAT+'],
        stateProperties: { cells: 4 },
      },
      ...channels.map((channel, index) => ({
        id: `resistor-${channel}`,
        kind: 'resistor' as const,
        componentTypeId: 'resistor-axial',
        variantId: 'resistor-axial',
        name: `R ${channel.toUpperCase()}`,
        position: { x: 430 + index * 120, y: 390 },
        rotation: 0,
        value: 220,
        pinIds: ['lead-1', 'lead-2'],
        stateProperties: { tolerancePercent: 5, resistanceUnit: 'Ом' },
      })),
      {
        id: 'rgb',
        kind: 'rgb-led',
        componentTypeId: 'rgb-led',
        variantId: 'rgb-led',
        name: 'RGB LED',
        position: { x: 560, y: 160 },
        rotation: 0,
        value: 0,
        pinIds: ['red', 'common', 'green', 'blue'],
        stateProperties: { commonMode },
      },
    ],
    connections: commonCathode
      ? [
          ...channels.flatMap((channel) => [
            {
              id: `positive-${channel}`,
              from: { componentId: 'source', terminal: 'BAT+' },
              to: { componentId: `resistor-${channel}`, terminal: 'lead-1' },
              color: '#e3212b',
              vertices: [],
            },
            {
              id: `channel-${channel}`,
              from: { componentId: `resistor-${channel}`, terminal: 'lead-2' },
              to: { componentId: 'rgb', terminal: channel },
              color: channel === 'red' ? '#e3212b' : channel === 'green' ? '#149447' : '#2868d7',
              vertices: [],
            },
          ]),
          {
            id: 'common-return',
            from: { componentId: 'rgb', terminal: 'common' },
            to: { componentId: 'source', terminal: 'BAT-' },
            color: '#2a3035',
            vertices: [],
          },
        ]
      : [
          {
            id: 'common-positive',
            from: { componentId: 'source', terminal: 'BAT+' },
            to: { componentId: 'rgb', terminal: 'common' },
            color: '#e3212b',
            vertices: [],
          },
          ...channels.flatMap((channel) => [
            {
              id: `channel-${channel}`,
              from: { componentId: 'rgb', terminal: channel },
              to: { componentId: `resistor-${channel}`, terminal: 'lead-1' },
              color: channel === 'red' ? '#e3212b' : channel === 'green' ? '#149447' : '#2868d7',
              vertices: [],
            },
            {
              id: `return-${channel}`,
              from: { componentId: `resistor-${channel}`, terminal: 'lead-2' },
              to: { componentId: 'source', terminal: 'BAT-' },
              color: '#2a3035',
              vertices: [],
            },
          ]),
        ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

function sevenSegmentDocument(commonMode: 'common-cathode' | 'common-anode'): SchematicDocument {
  const commonCathode = commonMode === 'common-cathode';
  const segmentPins = {
    a: 'top-4',
    b: 'top-5',
    d: 'bottom-2',
    e: 'bottom-1',
    g: 'top-1',
  } as const;
  const segments = Object.keys(segmentPins) as Array<keyof typeof segmentPins>;
  return {
    schemaVersion: 4,
    components: [
      {
        id: 'source',
        kind: 'source',
        componentTypeId: 'battery-holder-aa-2',
        variantId: 'battery-holder-aa-2',
        name: 'Источник 3 В',
        position: { x: 100, y: 300 },
        rotation: 0,
        value: 3,
        pinIds: ['BAT-', 'BAT+'],
        stateProperties: { cells: 2 },
      },
      ...segments.map((segment, index) => ({
        id: `resistor-${segment}`,
        kind: 'resistor' as const,
        componentTypeId: 'resistor-axial',
        variantId: 'resistor-axial',
        name: `R ${segment.toUpperCase()}`,
        position: { x: 380 + index * 100, y: 430 },
        rotation: 0 as const,
        value: 220,
        pinIds: ['lead-1', 'lead-2'],
        stateProperties: { tolerancePercent: 5, resistanceUnit: 'Ом' },
      })),
      {
        id: 'display',
        kind: 'seven-segment',
        componentTypeId: 'seven-segment-display',
        variantId: 'seven-segment-display',
        name: 'Семисегментный индикатор',
        position: { x: 600, y: 170 },
        rotation: 0,
        value: 0,
        pinIds: [
          'top-1',
          'top-2',
          'top-3',
          'top-4',
          'top-5',
          'bottom-1',
          'bottom-2',
          'bottom-3',
          'bottom-4',
          'bottom-5',
        ],
        stateProperties: { commonMode, segmentColor: 'red' },
      },
    ],
    connections: commonCathode
      ? [
          ...segments.flatMap((segment) => [
            {
              id: `positive-${segment}`,
              from: { componentId: 'source', terminal: 'BAT+' },
              to: { componentId: `resistor-${segment}`, terminal: 'lead-1' },
              color: '#e3212b',
              vertices: [],
            },
            {
              id: `segment-${segment}`,
              from: { componentId: `resistor-${segment}`, terminal: 'lead-2' },
              to: { componentId: 'display', terminal: segmentPins[segment] },
              color: '#149447',
              vertices: [],
            },
          ]),
          {
            id: 'common-return',
            from: { componentId: 'display', terminal: 'top-3' },
            to: { componentId: 'source', terminal: 'BAT-' },
            color: '#2a3035',
            vertices: [],
          },
        ]
      : [
          {
            id: 'common-positive',
            from: { componentId: 'source', terminal: 'BAT+' },
            to: { componentId: 'display', terminal: 'bottom-3' },
            color: '#e3212b',
            vertices: [],
          },
          ...segments.flatMap((segment) => [
            {
              id: `segment-${segment}`,
              from: { componentId: 'display', terminal: segmentPins[segment] },
              to: { componentId: `resistor-${segment}`, terminal: 'lead-1' },
              color: '#149447',
              vertices: [],
            },
            {
              id: `return-${segment}`,
              from: { componentId: `resistor-${segment}`, terminal: 'lead-2' },
              to: { componentId: 'source', terminal: 'BAT-' },
              color: '#2a3035',
              vertices: [],
            },
          ]),
        ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

function ownerRedBlueRgbDocument(): SchematicDocument {
  const seeded = rgbLedDocument('common-cathode');
  return {
    ...seeded,
    components: seeded.components
      .filter((item) => ['source', 'resistor-red', 'rgb'].includes(item.id))
      .map((item) =>
        item.id === 'source'
          ? {
              ...item,
              componentTypeId: 'battery-holder-aa-2',
              variantId: 'battery-holder-aa-2',
              name: 'Источник 3 В',
              value: 3,
              stateProperties: { cells: 2 },
            }
          : item.id === 'rgb'
            ? {
                ...item,
                stateProperties: { commonMode: 'common-cathode', pinLayout: 'RCBG' },
              }
            : item,
      ),
    connections: [
      ...seeded.connections.filter((wire) =>
        ['positive-red', 'channel-red', 'common-return'].includes(wire.id),
      ),
      {
        id: 'direct-blue',
        from: { componentId: 'source', terminal: 'BAT+' },
        to: { componentId: 'rgb', terminal: 'blue' },
        color: '#2868d7',
        vertices: [],
      },
    ],
  };
}

function ownerGreenBlueEqualRgbDocument(): SchematicDocument {
  const seeded = rgbLedDocument('common-cathode');
  return {
    ...seeded,
    components: seeded.components
      .filter((item) => ['source', 'resistor-green', 'resistor-blue', 'rgb'].includes(item.id))
      .map((item) =>
        item.id === 'source'
          ? {
              ...item,
              componentTypeId: 'battery-holder-aa-2',
              variantId: 'battery-holder-aa-2',
              name: 'Источник 3 В',
              value: 3,
              stateProperties: { cells: 2 },
            }
          : item.id === 'rgb'
            ? {
                ...item,
                stateProperties: { commonMode: 'common-cathode', pinLayout: 'RCBG' },
              }
            : item,
      ),
    connections: seeded.connections.filter((wire) =>
      [
        'positive-green',
        'channel-green',
        'positive-blue',
        'channel-blue',
        'common-return',
      ].includes(wire.id),
    ),
  };
}

function singleChannelRgbLedDocument(options: {
  readonly componentMode: 'common-cathode' | 'common-anode';
  readonly wiringMode: 'common-cathode' | 'common-anode';
  readonly resistorOhms: number | null;
}): SchematicDocument {
  const seeded = rgbLedDocument(options.wiringMode);
  const components = seeded.components
    .filter((item) => ['source', 'resistor-green', 'rgb'].includes(item.id))
    .filter((item) => options.resistorOhms !== null || item.id !== 'resistor-green')
    .map((item) =>
      item.id === 'source'
        ? {
            ...item,
            componentTypeId: 'battery-holder-aa-2',
            variantId: 'battery-holder-aa-2',
            name: 'Источник 3 В',
            value: 3,
            stateProperties: { cells: 2 },
          }
        : item.id === 'resistor-green'
          ? { ...item, value: options.resistorOhms ?? 0 }
          : item.id === 'rgb'
            ? { ...item, stateProperties: { commonMode: options.componentMode } }
            : item,
    );
  const direct = options.resistorOhms === null;
  const connections =
    options.wiringMode === 'common-cathode'
      ? [
          ...(direct
            ? [
                {
                  id: 'direct-green',
                  from: { componentId: 'source', terminal: 'BAT+' },
                  to: { componentId: 'rgb', terminal: 'green' },
                  color: '#149447',
                  vertices: [],
                },
              ]
            : seeded.connections.filter((wire) =>
                ['positive-green', 'channel-green'].includes(wire.id),
              )),
          ...seeded.connections.filter((wire) => wire.id === 'common-return'),
        ]
      : [
          ...seeded.connections.filter((wire) => wire.id === 'common-positive'),
          ...(direct
            ? [
                {
                  id: 'direct-green-return',
                  from: { componentId: 'rgb', terminal: 'green' },
                  to: { componentId: 'source', terminal: 'BAT-' },
                  color: '#149447',
                  vertices: [],
                },
              ]
            : seeded.connections.filter((wire) =>
                ['channel-green', 'return-green'].includes(wire.id),
              )),
        ];
  return { ...seeded, components, connections };
}

function multimeterDcVoltageDocument(reverseProbes = false): SchematicDocument {
  return {
    schemaVersion: 4,
    components: [
      {
        id: 'source',
        kind: 'source',
        componentTypeId: 'battery-holder-aa-2',
        variantId: 'battery-holder-aa-2',
        name: 'Источник 3 В',
        position: { x: 170, y: 390 },
        rotation: 0,
        value: 3,
        pinIds: ['BAT-', 'BAT+'],
        stateProperties: { cells: 2 },
      },
      {
        id: 'meter',
        kind: 'visual',
        componentTypeId: 'multimeter',
        variantId: 'multimeter',
        name: 'Мультиметр',
        position: { x: 660, y: 230 },
        rotation: 0,
        value: 0,
        pinIds: ['com', 'v-ohm-ma'],
        stateProperties: { measurementMode: 'dc-voltage', meterRange: 'auto' },
      },
    ],
    connections: reverseProbes
      ? [
          {
            id: 'negative-red-probe',
            from: { componentId: 'source', terminal: 'BAT-' },
            to: { componentId: 'meter', terminal: 'v-ohm-ma' },
            color: '#e3212b',
            vertices: [],
          },
          {
            id: 'positive-black-probe',
            from: { componentId: 'source', terminal: 'BAT+' },
            to: { componentId: 'meter', terminal: 'com' },
            color: '#2a3035',
            vertices: [],
          },
        ]
      : [
          {
            id: 'positive-red-probe',
            from: { componentId: 'source', terminal: 'BAT+' },
            to: { componentId: 'meter', terminal: 'v-ohm-ma' },
            color: '#e3212b',
            vertices: [],
          },
          {
            id: 'negative-black-probe',
            from: { componentId: 'source', terminal: 'BAT-' },
            to: { componentId: 'meter', terminal: 'com' },
            color: '#2a3035',
            vertices: [],
          },
        ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

function multimeterDcCurrentDocument(): SchematicDocument {
  return {
    schemaVersion: 4,
    components: [
      {
        id: 'source',
        kind: 'source',
        componentTypeId: 'battery-holder-aa-2',
        variantId: 'battery-holder-aa-2',
        name: 'Источник 3 В',
        position: { x: 170, y: 390 },
        rotation: 0,
        value: 3,
        pinIds: ['BAT-', 'BAT+'],
        stateProperties: { cells: 2 },
      },
      {
        id: 'load',
        kind: 'resistor',
        componentTypeId: 'resistor-axial',
        variantId: 'resistor-axial',
        name: 'Нагрузка 100 Ом',
        position: { x: 520, y: 310 },
        rotation: 90,
        value: 100,
        pinIds: ['lead-1', 'lead-2'],
        stateProperties: { powerRatingWatt: 0.25 },
      },
      {
        id: 'meter',
        kind: 'visual',
        componentTypeId: 'multimeter',
        variantId: 'multimeter',
        name: 'Мультиметр',
        position: { x: 760, y: 230 },
        rotation: 0,
        value: 0,
        pinIds: ['com', 'v-ohm-ma'],
        stateProperties: { measurementMode: 'dc-voltage', meterRange: 'auto' },
      },
    ],
    connections: [
      {
        id: 'supply',
        from: { componentId: 'source', terminal: 'BAT+' },
        to: { componentId: 'load', terminal: 'lead-1' },
        color: '#e3212b',
        vertices: [],
      },
      {
        id: 'meter-input',
        from: { componentId: 'load', terminal: 'lead-2' },
        to: { componentId: 'meter', terminal: 'v-ohm-ma' },
        color: '#e3212b',
        vertices: [],
      },
      {
        id: 'return',
        from: { componentId: 'meter', terminal: 'com' },
        to: { componentId: 'source', terminal: 'BAT-' },
        color: '#2a3035',
        vertices: [],
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

function multimeterResistanceDocument(powered = false): SchematicDocument {
  const resistor = {
    id: 'load',
    kind: 'resistor' as const,
    componentTypeId: 'resistor-axial',
    variantId: 'resistor-axial',
    name: 'Резистор 1 кОм',
    position: { x: 420, y: 390 },
    rotation: 90 as const,
    value: 1_000,
    pinIds: ['lead-1', 'lead-2'],
    stateProperties: { powerRatingWatt: 0.25 },
  };
  const meter = {
    id: 'meter',
    kind: 'visual' as const,
    componentTypeId: 'multimeter',
    variantId: 'multimeter',
    name: 'Мультиметр',
    position: { x: 760, y: 230 },
    rotation: 0 as const,
    value: 0,
    pinIds: ['com', 'v-ohm-ma'],
    stateProperties: { measurementMode: powered ? 'resistance' : 'dc-voltage', meterRange: 'auto' },
  };
  const source = {
    id: 'source',
    kind: 'source' as const,
    componentTypeId: 'battery-holder-aa-2',
    variantId: 'battery-holder-aa-2',
    name: 'Источник 3 В',
    position: { x: 150, y: 390 },
    rotation: 0 as const,
    value: 3,
    pinIds: ['BAT-', 'BAT+'],
    stateProperties: { cells: 2 },
  };
  return {
    schemaVersion: 4,
    components: powered ? [source, resistor, meter] : [resistor, meter],
    connections: [
      {
        id: 'probe-red',
        from: { componentId: 'meter', terminal: 'v-ohm-ma' },
        to: { componentId: 'load', terminal: 'lead-1' },
        color: '#e3212b',
        vertices: [],
      },
      {
        id: 'probe-black',
        from: { componentId: 'meter', terminal: 'com' },
        to: { componentId: 'load', terminal: 'lead-2' },
        color: '#2a3035',
        vertices: [],
      },
      ...(powered
        ? [
            {
              id: 'supply-positive',
              from: { componentId: 'source', terminal: 'BAT+' },
              to: { componentId: 'load', terminal: 'lead-1' },
              color: '#e3212b',
              vertices: [],
            },
            {
              id: 'supply-negative',
              from: { componentId: 'source', terminal: 'BAT-' },
              to: { componentId: 'load', terminal: 'lead-2' },
              color: '#2a3035',
              vertices: [],
            },
          ]
        : []),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

async function createProject(page: Page, title: string): Promise<string> {
  const response = await page.context().request.post('/api/projects', {
    headers: {
      origin: new URL(page.url()).origin,
      'idempotency-key': `electronics-simulation-${crypto.randomUUID()}`,
    },
    data: {
      scope: 'personal',
      classroomId: null,
      module: 'electronics',
      title,
    },
  });
  expect(response.status()).toBe(201);
  const payload = (await response.json()) as { project: { id: string } };
  return payload.project.id;
}

async function saveDocument(
  page: Page,
  projectId: string,
  document: SchematicDocument,
): Promise<void> {
  const origin = new URL(page.url()).origin;
  const opened = await page.context().request.get(`/api/projects/${projectId}`, {
    headers: { origin },
  });
  expect(opened.status()).toBe(200);
  const current = (await opened.json()) as { draft: { revision: number } };
  const response = await page.context().request.put(`/api/projects/${projectId}/draft`, {
    headers: { origin },
    data: {
      document,
      baseRevision: current.draft.revision,
      mutationId: crypto.randomUUID(),
    },
  });
  expect(response.status()).toBe(200);
}

async function openProject(page: Page, projectId: string): Promise<void> {
  await page.goto(`/#/home/${projectId}`);
  await expect(page.locator('.workbench-stage')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('Название проекта')).toHaveValue('R4-M1 live simulation');
}

function component(page: Page, componentTypeId: string) {
  return page.locator(
    `[data-testid="schematic-component"][data-component-type="${componentTypeId}"]`,
  );
}

/**
 * Диагностическая метка детали.
 *
 * Метки рисуются отдельным слоем поверх схемы — иначе подсказка тонула под
 * проводами и деталями, нарисованными позже. Деталь метка называет сама, так
 * что искать её нужно по имени детали, а не внутри её группы.
 */
function diagnostic(page: Page, componentTypeId: string, testId: string) {
  return page.locator(
    `[data-testid="component-diagnostic"][data-component-type="${componentTypeId}"] [data-testid="${testId}"]`,
  );
}

async function brightnessValue(page: Page): Promise<number> {
  const value = await component(page, 'led-5mm')
    .locator('.workbench-production-visual')
    .getAttribute('data-led-brightness');
  return Number(value ?? '0');
}

async function selectLed(page: Page): Promise<void> {
  const led = component(page, 'led-5mm');
  const burnout = diagnostic(page, 'led-5mm', 'led-burnout-explosion');
  if ((await burnout.count()) > 0 && (await burnout.isVisible())) {
    await burnout.locator('.workbench-led-explosion-inner').click();
  } else {
    try {
      // The owner asset itself is pointer-transparent: the stage resolves the
      // exact alpha silhouette so transparent viewBox pixels pass through.
      await led.locator('.workbench-part').click({ timeout: 2_000, force: true });
    } catch (error) {
      if ((await burnout.count()) === 0 || !(await burnout.isVisible())) throw error;
      await burnout.locator('.workbench-led-explosion-inner').click();
    }
  }
  await expect(page.getByRole('complementary', { name: 'Параметры выделения' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: /^Цвет(?: светодиода)?$/ })).toBeVisible();
}

async function holeCenter(page: Page, holeId: string): Promise<{ x: number; y: number }> {
  const box = await page
    .locator(`[data-hole-id="${holeId}"] .workbench-breadboard-hole-hit`)
    .boundingBox();
  if (!box) throw new Error(`breadboard hole ${holeId} is not rendered`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function dragCatalogComponent(
  page: Page,
  name: string,
  target: { x: number; y: number },
): Promise<void> {
  const card = page.getByRole('button', { name, exact: true });
  const box = await card.boundingBox();
  if (!box) throw new Error(`catalog card ${name} is not rendered`);
  const before = await page.locator('[data-testid="schematic-component"]').count();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 4, start.y, { steps: 2 });
  await expect(page.locator('.workbench-picked-up')).toHaveCount(1);
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await expect(page.locator('.workbench-picked-up')).toHaveCount(0);
  await expect(page.getByTestId('catalog-placement-preview')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('.workbench-picked-up')).toHaveCount(0);
  await expect(page.getByTestId('catalog-placement-preview')).toHaveCount(0);
  await expect(page.locator('[data-testid="schematic-component"]')).toHaveCount(before + 1);
}

async function unobstructedComponentPoint(
  page: Page,
  componentTypeId: string,
): Promise<{ x: number; y: number }> {
  return page
    .locator(
      `[data-testid="schematic-component"][data-component-type="${componentTypeId}"] .workbench-part`,
    )
    .evaluate((element, typeId) => {
      const rect = element.getBoundingClientRect();
      for (let y = rect.top + 8; y < rect.bottom - 8; y += 12) {
        for (let x = rect.left + 8; x < rect.right - 8; x += 12) {
          const hit = document.elementFromPoint(x, y);
          if (
            hit &&
            (element.contains(hit) || hit.classList.contains('workbench-grid-hit')) &&
            !hit.closest('.workbench-terminal-hit, .workbench-breadboard-hole-hit')
          ) {
            return { x, y };
          }
        }
      }
      throw new Error(`no unobstructed point found for ${typeId}`);
    }, componentTypeId);
}

test.beforeAll(async () => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  admin = e2eAdminPool();
});

test.beforeEach(async ({ browserName: _browserName }, testInfo) => {
  void _browserName;
  // Authentication intentionally allows ten attempts per identifier in five
  // minutes. Give each isolated journey its own isolated teacher instead of
  // weakening that production guard or making the eleventh test fail by
  // construction.
  teacher = await seedTeacher(admin, `e2e-electronics-${testInfo.workerIndex}-${testInfo.retry}`);
});

test.afterAll(async () => {
  await admin.end();
});

test.afterEach(async ({ page }) => {
  // Every Playwright test gets an isolated browser context. End its server
  // session as well, otherwise the eleventh journey reaches the account's
  // active-session limit even though the ten earlier browser contexts are
  // already gone.
  const origin = new URL(page.url()).origin;
  await page.context().request.post('/api/auth/logout', { headers: { origin } });
});

test('component inspector separates compact settings, live state and educational help', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithOrganization(page, teacher);
  const projectId = await createProject(page, 'R4-M1 component information');
  await saveDocument(
    page,
    projectId,
    circuitDocument({ switchClosed: false, resistorOhms: 220, reversedLed: false }),
  );
  await page.goto(`/#/home/${projectId}`);

  await component(page, 'resistor-axial').locator('.workbench-part').press('Enter');
  const inspector = page.getByRole('complementary', { name: 'Параметры выделения' });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByTestId('component-compact-properties')).toContainText('Имя');
  await expect(inspector.getByTestId('component-compact-properties')).toContainText(
    'Сопротивление',
  );
  await expect(inspector).not.toContainText('Модель ожидает корректную цепь');

  await inspector.getByRole('button', { name: 'Техническое состояние Резистор' }).click();
  await expect(inspector.getByTestId('component-simulation-status')).toHaveCount(0);
  await expect(inspector.getByRole('combobox', { name: 'Допуск резистора' })).toBeVisible();
  await expect(inspector.getByRole('region', { name: 'Справка' })).toHaveCount(0);

  await inspector.getByRole('button', { name: 'Справка о компоненте Резистор' }).click();
  const help = inspector.getByRole('region', { name: 'Справка' });
  await expect(help).toBeVisible();
  await expect(help).toContainText('Описание');
  await expect(help).toContainText('Принцип работы');
  await expect(help).toContainText('Подключение');
  await expect(inspector.getByTestId('component-simulation-status')).toHaveCount(0);

  await inspector.getByRole('button', { name: 'Техническое состояние Резистор' }).click();
  await expect(inspector.getByRole('combobox', { name: 'Допуск резистора' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Свернуть библиотеку' }).click();
  await expect(inspector).toBeVisible();
  for (const buttonName of ['Техническое состояние Резистор', 'Справка о компоненте Резистор']) {
    const box = await inspector.getByRole('button', { name: buttonName }).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  failures.assertEmpty();
});

test('capacitor and battery holder pass interaction through transparent owner pixels', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithOrganization(page, teacher);
  const projectId = await createProject(page, 'MATH-4B1 capacitor body hit area');
  await saveDocument(page, projectId, capacitorInteractionDocument());
  await page.goto(`/#/home/${projectId}`);
  await expect(page.locator('.workbench-stage')).toBeVisible();

  const capacitor = component(page, 'electrolytic-capacitor');
  const capacitorBody = capacitor.locator('.workbench-part');
  await expect(capacitorBody.locator('.workbench-component-body-hit')).toHaveAttribute(
    'data-hit-surface',
    'owner-alpha-mask',
  );
  await page.waitForTimeout(300);
  const beforeX = await capacitor.getAttribute('data-x');
  const transparentBounds = await capacitorBody.boundingBox();
  if (!transparentBounds) throw new Error('capacitor body has no rendered bounds');
  const transparentPoint = {
    x: transparentBounds.x + 3,
    y: transparentBounds.y + transparentBounds.height / 2,
  };
  const resistor = component(page, 'resistor-axial');
  const resistorBody = resistor.locator('.workbench-part');
  const resistorBounds = await resistorBody.boundingBox();
  if (!resistorBounds) throw new Error('resistor body has no rendered bounds');
  await page.mouse.move(
    resistorBounds.x + resistorBounds.width / 2,
    resistorBounds.y + resistorBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(transparentPoint.x, transparentPoint.y, { steps: 5 });
  await page.mouse.up();
  const resistorUnderlayX = await resistor.getAttribute('data-x');

  await page.mouse.move(transparentPoint.x, transparentPoint.y);
  await page.mouse.down();
  await page.mouse.move(transparentPoint.x + 60, transparentPoint.y, { steps: 5 });
  await page.mouse.up();
  await expect(capacitor).toHaveAttribute('data-x', beforeX ?? '');
  await expect(resistor).not.toHaveAttribute('data-x', resistorUnderlayX ?? '');

  const visibleBounds = await capacitorBody.boundingBox();
  if (!visibleBounds) throw new Error('capacitor visible body has no rendered bounds');
  await page.mouse.move(
    visibleBounds.x + visibleBounds.width / 2,
    visibleBounds.y + visibleBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    visibleBounds.x + visibleBounds.width / 2 + 50,
    visibleBounds.y + visibleBounds.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(capacitor).not.toHaveAttribute('data-x', beforeX ?? '');

  const battery = component(page, 'battery-holder-aa-2');
  const batteryBody = battery.locator('.workbench-part');
  const batteryBeforeX = await battery.getAttribute('data-x');
  const batteryBounds = await batteryBody.boundingBox();
  if (!batteryBounds) throw new Error('battery holder has no rendered bounds');
  const batteryTransparentCorner = {
    x: batteryBounds.x + 1,
    y: batteryBounds.y + 1,
  };
  const currentResistorBounds = await resistorBody.boundingBox();
  if (!currentResistorBounds)
    throw new Error('resistor has no rendered bounds after capacitor test');
  await page.mouse.move(
    currentResistorBounds.x + currentResistorBounds.width / 2,
    currentResistorBounds.y + currentResistorBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(batteryTransparentCorner.x, batteryTransparentCorner.y, { steps: 5 });
  await page.mouse.up();
  const resistorAtBatteryX = await resistor.getAttribute('data-x');
  await page.mouse.move(batteryTransparentCorner.x, batteryTransparentCorner.y);
  await page.mouse.down();
  await page.mouse.move(batteryTransparentCorner.x - 60, batteryTransparentCorner.y, { steps: 5 });
  await page.mouse.up();
  await expect(battery).toHaveAttribute('data-x', batteryBeforeX ?? '');
  await expect(resistor).not.toHaveAttribute('data-x', resistorAtBatteryX ?? '');

  const movedBounds = await capacitorBody.boundingBox();
  if (!movedBounds) throw new Error('moved capacitor has no rendered bounds');
  await page.mouse.click(
    movedBounds.x + movedBounds.width / 2,
    movedBounds.y + movedBounds.height / 2,
  );
  const inspector = page.getByRole('complementary', { name: 'Параметры выделения' });
  const capacitorInformation = inspector.getByRole('button', {
    name: 'Техническое состояние Конденсатор',
  });
  await capacitorInformation.click();
  await expect(capacitorInformation).toHaveAttribute('aria-expanded', 'true');

  await component(page, 'resistor-axial').locator('.workbench-part').click();
  const resistorInformation = inspector.getByRole('button', {
    name: 'Техническое состояние Резистор',
  });
  await expect(resistorInformation).toHaveAttribute('aria-expanded', 'true');
  await expect(inspector.getByRole('combobox', { name: 'Допуск резистора' })).toBeVisible();
  failures.assertEmpty();
});

test('reverse-sign capacitor voltage stays inside I without a stage warning', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithOrganization(page, teacher);
  const projectId = await createProject(page, 'MATH-4B2 capacitor polarity information');
  await saveDocument(page, projectId, reverseCapacitorDocument());
  await page.goto(`/#/home/${projectId}`);
  await page.getByRole('button', { name: 'Начать моделирование' }).click();

  const capacitor = component(page, 'electrolytic-capacitor');
  await expect(capacitor).toHaveAttribute('data-diagnostics', /capacitor_reverse_polarity/, {
    timeout: 10_000,
  });
  await expect(
    page.locator(
      '[data-testid="component-diagnostic"][data-component-type="electrolytic-capacitor"]',
    ),
  ).toHaveCount(0);
  await capacitor.locator('.workbench-part').click({ force: true });
  const inspector = page.getByRole('complementary', { name: 'Параметры выделения' });
  await inspector.getByRole('button', { name: 'Техническое состояние Конденсатор' }).click();
  await expect(inspector.getByTestId('capacitor-polarity-state')).toContainText(
    'Напряжение обратного знака',
  );
  await expect(
    inspector.getByText(/напряжение на выводах сейчас имеет обратный знак/i),
  ).toBeVisible();
  failures.assertEmpty();
});

test('a safe PNP astable visibly alternates both LEDs', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithOrganization(page, teacher);
  const projectId = await createProject(page, 'MATH-4B2 PNP multivibrator');
  await saveDocument(page, projectId, pnpAstableDocument(100));
  await page.goto(`/#/home/${projectId}`);
  await expect(page.locator('.workbench-stage')).toBeVisible();

  const leftLed = page.locator(
    '[data-testid="schematic-component"][data-component-id="led1"] .workbench-production-visual',
  );
  const rightLed = page.locator(
    '[data-testid="schematic-component"][data-component-id="led2"] .workbench-production-visual',
  );
  await page.getByRole('button', { name: 'Начать моделирование' }).click();

  const samples: Array<readonly [number, number]> = [];
  for (let index = 0; index < 80; index += 1) {
    await page.waitForTimeout(100);
    samples.push([
      Number((await leftLed.getAttribute('data-led-brightness')) ?? '0'),
      Number((await rightLed.getAttribute('data-led-brightness')) ?? '0'),
    ]);
  }

  expect(
    samples.some(([left, right]) => left > right + 1),
    JSON.stringify(samples),
  ).toBe(true);
  expect(
    samples.some(([left, right]) => right > left + 1),
    JSON.stringify(samples),
  ).toBe(true);
  await expect(
    page.locator('[data-testid="component-diagnostic"][data-component-id="led1"]'),
  ).toHaveCount(0);
  await expect(
    page.locator('[data-testid="component-diagnostic"][data-component-id="led2"]'),
  ).toHaveCount(0);
  failures.assertEmpty();
});

test('DO-35 exposes calculated current and fixed profile limits through I', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithOrganization(page, teacher);
  const projectId = await createProject(page, 'MATH-2 DO-35 inspector');
  await saveDocument(page, projectId, diodeProfileDocument('diode-do35'));
  await page.goto(`/#/home/${projectId}`);

  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await component(page, 'diode-do35').locator('.workbench-part').click({ force: true });
  const inspector = page.getByRole('complementary', { name: 'Параметры выделения' });
  await inspector.getByRole('button', { name: 'Техническое состояние Диод' }).click();
  await expect(inspector.getByText('Длительный ток', { exact: true })).toBeVisible();
  await expect(inspector.getByText('200 мА', { exact: true })).toBeVisible();
  await expect(inspector.getByText('Обратный предел', { exact: true })).toBeVisible();
  await expect(inspector.getByText('100 В', { exact: true })).toBeVisible();
  await expect(inspector.getByText('Ток', { exact: true })).toBeVisible();
  await expect(inspector.getByText('Прямое падение', { exact: true })).toHaveCount(0);
  failures.assertEmpty();
});

test('NPN key exposes its calculated operating point through I', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithOrganization(page, teacher);
  const projectId = await createProject(page, 'MATH-3 NPN key inspector');
  await saveDocument(page, projectId, npnKeyDocument());
  await page.goto(`/#/home/${projectId}`);

  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await component(page, 'transistor-npn').locator('.workbench-part').click({ force: true });
  const inspector = page.getByRole('complementary', { name: 'Параметры выделения' });
  await inspector.getByRole('button', { name: /Техническое состояние/ }).click();
  await expect(inspector.getByText('Регулирует ток', { exact: true })).toBeVisible();
  await expect(inspector.getByText('Ток управления (база)', { exact: true })).toBeVisible();
  await expect(inspector.getByText('Ток нагрузки (коллектор)', { exact: true })).toBeVisible();
  await expect(inspector.getByText('Общий ток (эмиттер)', { exact: true })).toBeVisible();

  const variant = inspector.getByLabel('Вариант Транзистор в проекте');
  await expect(page.locator('[data-testid="schematic-wire"]')).toHaveCount(5);
  await variant.selectOption('transistor-fet');
  await expect(component(page, 'transistor-fet')).toBeVisible();
  await expect(page.locator('[data-testid="schematic-wire"]')).toHaveCount(5);
  await variant.selectOption('transistor-pnp');
  await expect(component(page, 'transistor-pnp')).toBeVisible();
  await expect(page.locator('[data-testid="schematic-wire"]')).toHaveCount(5);
  failures.assertEmpty();
});

test('photoresistor converts runtime light to resistance without saving the project', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithOrganization(page, teacher);
  const projectId = await createProject(page, 'MATH-6B photoresistor runtime');
  await saveDocument(page, projectId, photoresistorDocument());
  await page.goto(`/#/home/${projectId}`);

  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  const ldr = component(page, 'photoresistor');
  await ldr.locator('.workbench-part').click({ force: true });
  const lightControl = page.getByTestId('photoresistor-light-control');
  await expect(lightControl.locator('output')).toHaveText('32 лк');

  const inspector = page.getByRole('complementary', { name: 'Параметры выделения' });
  await inspector.getByRole('button', { name: /Техническое состояние/ }).click();
  const profile = inspector.getByTestId('photoresistor-reference-profile');
  await expect(profile).toContainText('GL5528-class 5 mm CdS LDR');
  await expect(profile).toContainText('6.72 кОм');

  const origin = new URL(page.url()).origin;
  await page.waitForTimeout(1_200);
  const revisionBeforeResponse = await page.context().request.get(`/api/projects/${projectId}`, {
    headers: { origin },
  });
  const revisionBefore = ((await revisionBeforeResponse.json()) as { draft: { revision: number } })
    .draft.revision;

  const slider = lightControl.getByRole('slider', { name: 'Освещённость фоторезистора' });
  await slider.fill('100');
  await expect(lightControl.locator('output')).toHaveText('10 тыс. лк');
  await expect(profile).toContainText('119 Ом');
  await slider.fill('0');
  await expect(lightControl.locator('output')).toHaveText('0 лк');
  await expect(profile).toContainText('1.00 МОм');

  await inspector.getByRole('button', { name: /Справка/ }).click();
  await expect(page.getByText('Как свет меняет сопротивление', { exact: true })).toBeVisible();
  await expect(page.getByText(/делитель напряжения/)).toBeVisible();

  await page.waitForTimeout(1_200);
  const revisionAfterResponse = await page.context().request.get(`/api/projects/${projectId}`, {
    headers: { origin },
  });
  const revisionAfter = ((await revisionAfterResponse.json()) as { draft: { revision: number } })
    .draft.revision;
  expect(revisionAfter).toBe(revisionBefore);

  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-photoresistor-runtime.png`,
    fullPage: true,
  });
  failures.assertEmpty();
});

test('6 V incandescent lamp warms into the owner glow and explains its fixed profile', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithOrganization(page, teacher);
  const projectId = await createProject(page, 'MATH-6D incandescent lamp electrothermal runtime');
  await saveDocument(page, projectId, incandescentLampDocument());
  await page.goto(`/#/home/${projectId}`);

  const lamp = component(page, 'incandescent-lamp');
  const lampAsset = lamp.locator('image').last();
  await expect(lampAsset).toHaveAttribute('href', /lamp\/off\.svg$/);

  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await expect
    .poll(async () => lampAsset.getAttribute('href'), { timeout: 10_000 })
    .toMatch(/lamp\/(on|max)\.svg$/);

  await lamp.locator('.workbench-part').click({ force: true });
  const inspector = page.getByRole('complementary', { name: 'Параметры выделения' });
  await inspector.getByRole('button', { name: /Техническое состояние/ }).click();
  const profile = inspector.getByTestId('lamp-reference-profile');
  await expect(profile).toContainText('T-1, два штырька');
  await expect(profile).toContainText('6 В');
  await expect(profile).toContainText('250 мА');
  await expect(profile).toContainText('1.5 Вт');
  await expect(profile).toContainText(/Сопротивление нити сейчас2[0-4]\.\d{2} Ом/);
  await expect(inspector.getByText('Светит', { exact: true })).toBeVisible();
  await expect(lamp).not.toHaveAttribute('data-presentation-state', 'destructive');

  await inspector.getByRole('button', { name: /Справка/ }).click();
  await expect(page.getByText('Что имитируется', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Почему яркость меняется не мгновенно', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Перенапряжение и перегорание', { exact: true })).toBeVisible();

  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-incandescent-lamp-runtime.png`,
    fullPage: true,
  });
  failures.assertEmpty();
});

test('direct DC motor shows calculated signed RPM and calm visual direction', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithOrganization(page, teacher);
  const projectId = await createProject(page, 'MATH-5C DC motor runtime');
  await saveDocument(page, projectId, dcMotorDocument());
  await page.goto(`/#/home/${projectId}`);

  const motor = component(page, 'dc-motor');
  const readout = page.locator('[data-testid="dc-motor-rpm"][data-component-id="motor"]');
  await expect(readout).toHaveText('0 об/мин');
  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await expect
    .poll(async () => (await readout.textContent())?.trim(), { timeout: 10_000 })
    .not.toBe('0 об/мин');

  const phaseVisual = motor.getByTestId('dc-motor-phase');
  await expect(phaseVisual).toBeVisible();
  await expect(phaseVisual).toHaveAttribute('data-motor-visual-direction', 'clockwise');
  await expect(phaseVisual).toHaveAttribute('data-motor-visual-period-seconds', '1.95');
  const gear = phaseVisual.locator('.workbench-dc-motor-gear');
  const firstPhase = await gear.evaluate((element) => getComputedStyle(element).transform);
  await page.waitForTimeout(250);
  const secondPhase = await gear.evaluate((element) => getComputedStyle(element).transform);
  expect(secondPhase).not.toBe(firstPhase);

  await motor.locator('.workbench-part').click({ force: true });
  const inspector = page.getByRole('complementary', { name: 'Параметры выделения' });
  await inspector.getByRole('button', { name: /Техническое состояние/ }).click();
  await expect(inspector.getByText('Скорость', { exact: true })).toBeVisible();
  await expect(inspector.getByText('Направление', { exact: true })).toBeVisible();
  await expect(inspector.getByText('Электромагнитный момент', { exact: true })).toBeVisible();
  await expect(inspector.getByText('Нагрузка на валу', { exact: true })).toBeVisible();
  await expect(inspector.getByText('Рабочий диапазон', { exact: true })).toBeVisible();
  await expect(inspector.getByText('В рабочем диапазоне', { exact: true })).toBeVisible();
  await expect(inspector.getByText('Нагрев обмотки I²R', { exact: true })).toBeVisible();
  await expect(inspector.getByText('Температура', { exact: true })).toBeVisible();
  await expect(inspector.getByText('Обмотка', { exact: true })).toBeVisible();
  const shaftLock = inspector.getByLabel('Заблокировать вал двигателя');
  await shaftLock.check();
  await expect(inspector.getByText('Вал заблокирован', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await readout.textContent())?.trim(), { timeout: 5_000 })
    .toBe('0 об/мин');
  await shaftLock.uncheck();
  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-dc-motor-runtime.png`,
    fullPage: true,
  });
  failures.assertEmpty();
});

test('1:48 gearmotor exposes real settings, output RPM and runtime shaft control', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithOrganization(page, teacher);
  const projectId = await createProject(page, 'MATH-5F gearmotor runtime');
  await saveDocument(page, projectId, gearmotorDocument());
  await page.goto(`/#/home/${projectId}`);

  const motor = component(page, 'gearmotor');
  const readout = page.locator('[data-testid="gearmotor-output-rpm"][data-component-id="motor"]');
  await expect(readout).toHaveText('0 об/мин');
  await motor.locator('.workbench-part').click({ force: true });
  const inspector = page.getByRole('complementary', { name: 'Параметры выделения' });
  await inspector.getByRole('button', { name: /Техническое состояние/ }).click();
  await expect(inspector.getByText('Настройки мотор-редуктора', { exact: true })).toBeVisible();
  await expect(inspector.getByText('1:48 · TT · 3–6 В', { exact: true })).toBeVisible();
  await expect(
    inspector.getByText('Сейчас доступна одна подтверждённая версия.', { exact: true }),
  ).toBeVisible();
  await expect(inspector.getByLabel('Нагрузка на выходном валу мотор-редуктора')).toHaveValue('0');

  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await expect
    .poll(async () => Number.parseInt((await readout.textContent()) ?? '0', 10), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
  await expect(readout).toHaveAttribute('data-placement', 'primary-body');
  const phaseVisual = motor.getByTestId('gearmotor-phase');
  await expect(phaseVisual).toHaveAttribute('data-output-visual-direction', 'clockwise');
  const visualBox = await phaseVisual.boundingBox();
  const readoutBox = await readout.boundingBox();
  expect(visualBox).not.toBeNull();
  expect(readoutBox).not.toBeNull();
  if (!visualBox || !readoutBox) throw new Error('gearmotor RPM placement is unavailable');
  const readoutCenterX = readoutBox.x + readoutBox.width / 2;
  const readoutCenterY = readoutBox.y + readoutBox.height / 2;
  expect((readoutCenterX - visualBox.x) / visualBox.width).toBeGreaterThan(0.4);
  expect((readoutCenterX - visualBox.x) / visualBox.width).toBeLessThan(0.52);
  expect((readoutCenterY - visualBox.y) / visualBox.height).toBeGreaterThan(0.18);
  expect((readoutCenterY - visualBox.y) / visualBox.height).toBeLessThan(0.32);
  const outputShaft = phaseVisual.locator('.workbench-gearmotor-output-bar');
  const outputShaftMarker = phaseVisual.locator('.workbench-gearmotor-output-bar-highlight');
  await expect(outputShaftMarker).toHaveCSS('fill', 'rgb(102, 114, 123)');
  await expect(phaseVisual.locator('.workbench-gearmotor-output-axle-highlight')).toHaveCount(0);
  const motorShaftMarker = phaseVisual.locator('.workbench-gearmotor-motor-shaft-highlight');
  await expect(motorShaftMarker).toHaveCSS('fill', 'rgb(70, 81, 90)');
  const initialMarkerTransform = await outputShaftMarker.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  const initialMarkerOpacity = await outputShaftMarker.evaluate(
    (element) => getComputedStyle(element).opacity,
  );
  const initialShaftTransform = await outputShaft.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  const initialMotorMarkerTransform = await motorShaftMarker.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  await expect
    .poll(
      async () => outputShaftMarker.evaluate((element) => getComputedStyle(element).transform),
      { timeout: 5_000 },
    )
    .not.toBe(initialMarkerTransform);
  await expect
    .poll(async () => outputShaftMarker.evaluate((element) => getComputedStyle(element).opacity), {
      timeout: 5_000,
    })
    .not.toBe(initialMarkerOpacity);
  await expect
    .poll(async () => outputShaft.evaluate((element) => getComputedStyle(element).transform), {
      timeout: 5_000,
    })
    .not.toBe(initialShaftTransform);
  await expect
    .poll(async () => motorShaftMarker.evaluate((element) => getComputedStyle(element).transform), {
      timeout: 5_000,
    })
    .not.toBe(initialMotorMarkerTransform);
  await expect(inspector.getByText('Выходной вал', { exact: true })).toBeVisible();
  const advancedParameters = inspector.getByText('Подробные параметры', { exact: true });
  await advancedParameters.click();
  await expect(inspector.getByText('Двигатель внутри', { exact: true })).toBeVisible();
  await expect(inspector.getByText('Передаточное отношение', { exact: true })).toBeVisible();
  await expect(inspector.getByText('КПД редуктора', { exact: true })).toBeVisible();
  await expect(inspector.getByText('Момент выходного вала', { exact: true })).toBeVisible();
  await advancedParameters.click();
  await expect(inspector.getByText('Двигатель внутри', { exact: true })).toBeHidden();

  const shaftLock = inspector.getByLabel('Заблокировать выходной вал мотор-редуктора');
  await shaftLock.check();
  await expect(inspector.getByText('Вал заблокирован', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await readout.textContent())?.trim(), { timeout: 5_000 })
    .toBe('0 об/мин');
  await shaftLock.uncheck();
  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-gearmotor-runtime.png`,
    fullPage: true,
  });
  failures.assertEmpty();
});

test('gearmotor warning stays on the primary yellow housing instead of a shaft tip', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithOrganization(page, teacher);
  const projectId = await createProject(page, 'MATH-5F gearmotor diagnostic anchor');
  await saveDocument(page, projectId, gearmotorOvervoltageDocument());
  await page.goto(`/#/home/${projectId}`);
  await page.getByRole('button', { name: 'Начать моделирование' }).click();

  const motor = component(page, 'gearmotor');
  const visual = motor.getByTestId('gearmotor-phase');
  const diagnosticGroup = page.locator(
    '[data-testid="component-diagnostic"][data-component-type="gearmotor"]',
  );
  await expect(diagnosticGroup).toHaveAttribute('data-anchor', 'primary-body-top-right');
  const visualBox = await visual.boundingBox();
  const diagnosticBox = await diagnosticGroup.boundingBox();
  expect(visualBox).not.toBeNull();
  expect(diagnosticBox).not.toBeNull();
  if (!visualBox || !diagnosticBox) throw new Error('gearmotor visual geometry is unavailable');
  const relativeCenterX =
    (diagnosticBox.x + diagnosticBox.width / 2 - visualBox.x) / visualBox.width;
  const relativeCenterY =
    (diagnosticBox.y + diagnosticBox.height / 2 - visualBox.y) / visualBox.height;
  expect(relativeCenterX).toBeGreaterThan(0.55);
  expect(relativeCenterX).toBeLessThan(0.8);
  expect(relativeCenterY).toBeGreaterThan(0.05);
  expect(relativeCenterY).toBeLessThan(0.25);

  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-gearmotor-warning-anchor.png`,
    fullPage: true,
  });
  failures.assertEmpty();
});

test('23 V motor shows local overvoltage, accumulated damage and open failure', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithOrganization(page, teacher);
  const projectId = await createProject(page, 'MATH-5C DC motor overvoltage damage');
  await saveDocument(page, projectId, dcMotorOvervoltageDocument());
  await page.goto(`/#/home/${projectId}`);

  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  const motor = component(page, 'dc-motor');
  await motor.locator('.workbench-part').click({ force: true });
  const inspector = page.getByRole('complementary', { name: 'Параметры выделения' });
  await inspector.getByRole('button', { name: /Техническое состояние/ }).click();

  await expect(inspector.getByText('Выше рабочего диапазона', { exact: true })).toBeVisible();
  const overvoltageBadge = diagnostic(page, 'dc-motor', 'component-diagnostic-indicator');
  await expect(overvoltageBadge).toBeVisible();
  await expect(motor).toHaveAttribute('data-presentation-state', 'destructive');
  await expect(inspector.getByText('Накопленный износ', { exact: true })).toBeVisible({
    timeout: 8_000,
  });
  await expect(inspector.getByText('Перегорела — цепь разомкнута', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(motor).toHaveAttribute('data-presentation-state', 'failed');
  const failedMotorReadout = page.locator(
    '[data-testid="dc-motor-rpm"][data-component-id="motor"]',
  );
  await expect
    .poll(async () => Number.parseInt((await failedMotorReadout.textContent()) ?? '', 10), {
      timeout: 8_000,
    })
    .toBeLessThan(500);
  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-dc-motor-overvoltage-failed.png`,
    fullPage: true,
  });
  failures.assertEmpty();
});

test('catalog placement is one hold-drag-release gesture and snaps on the first drop', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);
  const projectId = await createProject(page, 'R4-M1 catalog drag and first snap');
  await saveDocument(page, projectId, breadboardDocument());
  await page.goto(`/#/home/${projectId}`);
  await expect(page.locator('.workbench-stage')).toBeVisible();

  const j8 = await holeCenter(page, 'J8');
  const j9 = await holeCenter(page, 'J9');
  const pitch = j9.x - j8.x;
  await dragCatalogComponent(page, 'Потенциометр', {
    x: j8.x + pitch,
    y: j8.y - (pitch * 6.858) / 2.54,
  });
  const potentiometer = component(page, 'potentiometer');
  await expect(potentiometer).toHaveAttribute('data-hole-bindings', '3');
  await expect(potentiometer).toHaveAttribute(
    'data-hole-ids',
    /terminal-1:J8,terminal-2:J10,wiper:J9/,
  );

  const j20 = await holeCenter(page, 'J20');
  await dragCatalogComponent(page, 'Батарейный отсек AA', {
    x: j20.x + (pitch * 1.2721) / 2.54,
    y: j20.y + (pitch * 28.9396) / 2.54,
  });
  const battery = component(page, 'battery-holder-aa-2');
  await expect(battery).toHaveAttribute('data-hole-bindings', '2');
  await expect(battery).toHaveAttribute('data-hole-ids', /BAT-:J20,BAT\+:J21/);
  const batteryPosition = {
    x: await battery.getAttribute('data-x'),
    y: await battery.getAttribute('data-y'),
  };
  const negativeLead = page.locator('[data-mounted-terminal="BAT-"]');
  const leadBefore = {
    x: await negativeLead.getAttribute('x2'),
    y: await negativeLead.getAttribute('y2'),
  };

  const board = component(page, 'breadboard-medium');
  const boardPosition = {
    x: await board.getAttribute('data-x'),
    y: await board.getAttribute('data-y'),
  };
  const boardGrab = await unobstructedComponentPoint(page, 'breadboard-medium');
  await page.mouse.move(boardGrab.x, boardGrab.y);
  await page.mouse.down();
  await page.mouse.move(boardGrab.x + 60, boardGrab.y + 30, { steps: 10 });
  await page.mouse.up();
  await expect(board).not.toHaveAttribute('data-x', boardPosition.x ?? '');
  await expect(battery).toHaveAttribute('data-x', batteryPosition.x ?? '');
  await expect(battery).toHaveAttribute('data-y', batteryPosition.y ?? '');
  await expect
    .poll(async () => ({
      x: await negativeLead.getAttribute('x2'),
      y: await negativeLead.getAttribute('y2'),
    }))
    .not.toEqual(leadBefore);
  failures.assertEmpty();
});

test('real editor recalculates SPDT, resistor and LED without waiting for persistence', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);

  const projectId = await createProject(page, 'R4-M1 live simulation');
  await openProject(page, projectId);
  await expect(page.getByText('Рабочее поле пустое')).toBeVisible();
  await page.screenshot({ path: `${ARTIFACT_DIR}/electronics-empty.png`, fullPage: true });

  await saveDocument(
    page,
    projectId,
    circuitDocument({ switchClosed: false, resistorOhms: 50, reversedLed: false }),
  );
  await page.reload();

  const led = component(page, 'led-5mm');
  const switchComponent = component(page, 'switch-spdt');
  const resistor = component(page, 'resistor-axial');
  await expect(component(page, 'breadboard-medium')).toBeVisible();
  await expect(page.locator('[data-testid="schematic-wire"]')).toHaveCount(5);
  await page.screenshot({ path: `${ARTIFACT_DIR}/electronics-wired.png`, fullPage: true });

  const sourcePositive = component(page, 'battery-holder-aa-2').locator(
    '.workbench-terminal-hit[data-terminal-id="BAT+"]',
  );
  await sourcePositive.click();
  const previewWire = page.locator('.workbench-wire-preview');
  const stageBox = await page.locator('svg.workbench-canvas').boundingBox();
  if (!stageBox) throw new Error('workbench canvas has no visual bounding box');
  await page.mouse.move(stageBox.x + stageBox.width * 0.46, stageBox.y + stageBox.height * 0.38);
  await expect(previewWire).toBeVisible();
  const initialPreviewPath = await previewWire.getAttribute('d');
  await page.mouse.move(stageBox.x + stageBox.width * 0.52, stageBox.y + stageBox.height * 0.42);
  await expect.poll(() => previewWire.getAttribute('d')).not.toBe(initialPreviewPath);
  await page.keyboard.press('Escape');
  await expect(previewWire).toHaveCount(0);

  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await expect(page.getByRole('button', { name: 'Остановить моделирование' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Остановить моделирование' })).toHaveAttribute(
    'data-simulation-status',
    'running',
  );

  await selectLed(page);
  await expect.poll(() => brightnessValue(page)).toBe(0);
  await expect(led.locator('.workbench-production-visual')).toHaveAttribute(
    'data-led-runtime-state',
    'off',
  );
  await expect(diagnostic(page, 'led-5mm', 'led-diagnostic-badge')).toHaveCount(0);
  await expect(led.locator('image:not([filter])')).toHaveAttribute('href', /led_red_i000\.svg$/);
  await switchComponent.getByTestId('spdt-actuator').click();
  await expect(switchComponent).toHaveClass(/workbench-component-actuator-active/);
  const colourBrightness = new Map<string, number>();
  for (const colour of ['red', 'orange', 'yellow', 'green', 'blue', 'white']) {
    await selectLed(page);
    await page.getByRole('combobox', { name: /^Цвет(?: светодиода)?$/ }).selectOption(colour);
    await expect(led.locator('.workbench-production-visual')).toHaveAttribute(
      'data-led-colour',
      colour,
    );
    await expect.poll(() => brightnessValue(page)).toBeGreaterThan(0);
    await expect(led.locator('image:not([filter])')).toHaveAttribute(
      'href',
      new RegExp(`led_${colour}_i(?!000)\\d{3}\\.svg$`),
    );
    colourBrightness.set(colour, await brightnessValue(page));
  }
  await page.getByRole('combobox', { name: /^Цвет(?: светодиода)?$/ }).selectOption('red');
  await expect.poll(() => brightnessValue(page)).toBe(colourBrightness.get('red'));
  const brightAt50Ohms = await brightnessValue(page);
  await expect(led.locator('.workbench-production-visual')).toHaveAttribute(
    'data-led-runtime-state',
    'lit',
  );
  await expect(diagnostic(page, 'led-5mm', 'led-diagnostic-badge')).toHaveCount(0);
  await expect(led.locator('image:not([filter])')).not.toHaveAttribute(
    'href',
    /led_red_i000\.svg$/,
  );
  const ledInspector = page.locator('.workbench-inspector');
  await expect(ledInspector.getByText('Имя', { exact: true })).toBeVisible();
  await expect(ledInspector.getByText('цвет', { exact: true })).toBeVisible();
  await expect(ledInspector.getByText(/Яркость|Ток|Напряжение/)).toHaveCount(0);
  await page.screenshot({ path: `${ARTIFACT_DIR}/electronics-running.png`, fullPage: true });

  await resistor.locator('.workbench-part').press('Enter');
  const resistanceInput = page
    .locator('.workbench-inspector label')
    .filter({ hasText: 'Сопротивление' })
    .locator('input[type="number"]');
  await resistanceInput.fill('1');
  await selectLed(page);
  const warningBadge = diagnostic(page, 'led-5mm', 'led-diagnostic-badge');
  await expect(warningBadge).toBeVisible();
  await expect(warningBadge).toHaveAttribute(
    'aria-label',
    'Сила тока в светодиоде равна 114 mA (максимальное рекомендуемое значение — 20.0 mA). Это может привести к сокращению срока службы светодиода.',
  );
  await expect(warningBadge.locator('.workbench-component-diagnostic-tooltip')).toHaveCount(0);
  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-led-warning.png`,
    fullPage: true,
  });

  // Runtime damage is intentionally persistent until Stop/new Start. Move the
  // resistor back into a safe range, restart the simulation and prove that the
  // fresh run uses the edited circuit rather than carrying the failed LED.
  await resistor.locator('.workbench-part').press('Enter');
  await page
    .locator('.workbench-inspector label')
    .filter({ hasText: 'Сопротивление' })
    .locator('input[type="number"]')
    .fill('100');
  await page.getByRole('button', { name: 'Остановить моделирование' }).click();
  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  // Runtime actuator overrides reset with a new run as well as thermal
  // damage, so close the SPDT again before checking the safe resistor value.
  await switchComponent.getByTestId('spdt-actuator').click();
  await selectLed(page);
  await expect.poll(() => brightnessValue(page)).toBeLessThan(brightAt50Ohms);
  await expect.poll(() => brightnessValue(page)).toBeGreaterThan(0);

  let previousBrightness = await brightnessValue(page);
  let persistedArbitraryBrightness = previousBrightness;
  for (const resistance of [166.7]) {
    await resistor.locator('.workbench-part').press('Enter');
    const arbitraryResistanceInput = page
      .locator('.workbench-inspector label')
      .filter({ hasText: 'Сопротивление' })
      .locator('input[type="number"]');
    await arbitraryResistanceInput.fill(String(resistance));
    await selectLed(page);
    await expect.poll(() => brightnessValue(page)).toBeLessThan(previousBrightness);
    await expect.poll(() => brightnessValue(page)).toBeGreaterThan(0);
    persistedArbitraryBrightness = await brightnessValue(page);
    previousBrightness = persistedArbitraryBrightness;
  }
  await resistor.locator('.workbench-part').press('Enter');
  await expect(page.getByRole('combobox', { name: 'Единица сопротивления' })).toHaveValue('Ω');
  await expect(
    page
      .locator('.workbench-inspector label')
      .filter({ hasText: 'Сопротивление' })
      .locator('input[type="number"]'),
  ).toHaveValue('166.7');
  await selectLed(page);
  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-resistance-changed.png`,
    fullPage: true,
  });

  await expect
    .poll(
      async () => {
        const saved = await page.context().request.get(`/api/projects/${projectId}`, {
          headers: { origin: new URL(page.url()).origin },
        });
        if (saved.status() !== 200) return null;
        const payload = (await saved.json()) as {
          draft: { document: SchematicDocument };
        };
        return payload.draft.document.components.find((item) => item.id === 'resistor')?.value;
      },
      { timeout: 15_000 },
    )
    .toBe(166.7);
  const checkpoint = await page.context().request.post(`/api/projects/${projectId}/checkpoints`, {
    headers: { origin: new URL(page.url()).origin },
    data: { label: 'Electronics M1 release candidate' },
  });
  expect(checkpoint.status()).toBe(201);
  expect((await checkpoint.json()) as { version: { versionNo: number } }).toMatchObject({
    version: { versionNo: 1 },
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Начать моделирование' })).toBeVisible();
  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await expect(page.getByRole('button', { name: 'Остановить моделирование' })).toBeVisible();
  await expect(switchComponent).not.toHaveClass(/workbench-component-actuator-active/);
  await selectLed(page);
  await expect.poll(() => brightnessValue(page)).toBe(0);
  await switchComponent.getByTestId('spdt-actuator').click();
  await expect(switchComponent).toHaveClass(/workbench-component-actuator-active/);
  await selectLed(page);
  await expect.poll(() => brightnessValue(page)).toBe(persistedArbitraryBrightness);
  await page.screenshot({ path: `${ARTIFACT_DIR}/electronics-reload.png`, fullPage: true });

  await page.getByRole('button', { name: 'Остановить моделирование' }).click();
  await expect(page.getByRole('button', { name: 'Начать моделирование' })).toBeVisible();
  await page.goto('/#/projects');
  await page.evaluate((id) => localStorage.removeItem(`asa-project-local-draft:${id}`), projectId);
  await saveDocument(
    page,
    projectId,
    circuitDocument({ switchClosed: true, resistorOhms: 1000, reversedLed: true }),
  );
  await page.goto(`/#/home/${projectId}`);
  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await expect(page.getByRole('button', { name: 'Остановить моделирование' })).toBeVisible();
  await selectLed(page);
  await expect.poll(() => brightnessValue(page)).toBe(0);
  await expect(led).not.toHaveAttribute('data-diagnostics', /reverse_polarity/);
  await expect(led.locator('image:not([filter])')).toHaveAttribute(
    'href',
    /special\/led_red_reverse_polarity\.svg$/,
  );
  await expect(led.locator('.workbench-production-visual')).toHaveClass(/is-reverse/);
  await expect(diagnostic(page, 'led-5mm', 'led-diagnostic-badge')).toHaveCount(0);
  await expect(diagnostic(page, 'led-5mm', 'led-burnout-explosion')).toHaveCount(0);
  await page.getByRole('button', { name: /Техническое состояние.*Светодиод/i }).click();
  await expect(ledInspector.getByText('Закрыт — обратное включение')).toBeVisible();
  await expect(ledInspector.getByText('Номинальный ток')).toBeVisible();
  await expect(ledInspector.getByText('20 мА', { exact: true })).toBeVisible();
  await expect(ledInspector.getByText('Разрушительный ток')).toBeVisible();
  await expect(ledInspector.getByText('120 мА', { exact: true })).toBeVisible();
  await expect(ledInspector.getByText('Обратный предел')).toBeVisible();
  await expect(ledInspector.getByText('5 В', { exact: true })).toBeVisible();
  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-reverse-polarity.png`,
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Остановить моделирование' }).click();
  await expect(led.locator('.workbench-production-visual')).toHaveAttribute(
    'data-led-runtime-state',
    'stopped',
  );
  await expect(led.locator('image:not([filter])')).not.toHaveAttribute(
    'href',
    /special\/led_red_burned\.svg$/,
  );
  await expect(diagnostic(page, 'led-5mm', 'led-burnout-explosion')).toHaveCount(0);
  await page.goto('/#/projects');
  await page.evaluate((id) => localStorage.removeItem(`asa-project-local-draft:${id}`), projectId);
  await saveDocument(
    page,
    projectId,
    circuitDocument({ switchClosed: true, resistorOhms: 0, reversedLed: false }),
  );
  await page.goto(`/#/home/${projectId}`);
  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await selectLed(page);
  await expect(led).toHaveAttribute('data-diagnostics', /led_burnout/);
  await expect(led.locator('image:not([filter])')).toHaveAttribute(
    'href',
    /special\/led_red_burned\.svg$/,
  );
  await expect(diagnostic(page, 'led-5mm', 'led-diagnostic-badge')).toHaveCount(0);
  await expect(diagnostic(page, 'led-5mm', 'led-burnout-explosion')).toBeVisible();
  await expect(diagnostic(page, 'led-5mm', 'led-burnout-explosion')).toHaveAttribute(
    'aria-label',
    /компонент вышел из строя/i,
  );
  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-led-burnout.png`,
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Остановить моделирование' }).click();
  await page.goto('/#/projects');
  await page.evaluate((id) => localStorage.removeItem(`asa-project-local-draft:${id}`), projectId);
  await saveDocument(page, projectId, shortCircuitDocument());
  await page.goto(`/#/home/${projectId}`);
  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await expect(page.getByRole('button', { name: 'Остановить моделирование' })).toBeVisible();
  await expect(page.getByText(/Время моделирования:/)).toBeVisible();
  const source = page.locator('[data-testid="schematic-component"][data-kind="source"]');
  await expect(source).toHaveAttribute('data-diagnostics', /short_circuit/);
  const sourceDiagnostic = page.locator(
    '[data-testid="component-diagnostic"][data-component-type="battery-holder-aa-2"]',
  );
  await expect(sourceDiagnostic).toHaveAttribute('data-anchor', 'owner-alpha-top-right');
  await expect(sourceDiagnostic.getByTestId('component-diagnostic-indicator')).toBeVisible();
  const sourceBounds = await source.locator('.workbench-part').boundingBox();
  const sourceDiagnosticBounds = await sourceDiagnostic.boundingBox();
  if (!sourceBounds || !sourceDiagnosticBounds) {
    throw new Error('source diagnostic anchor has no rendered bounds');
  }
  const diagnosticCenter = {
    x: sourceDiagnosticBounds.x + sourceDiagnosticBounds.width / 2,
    y: sourceDiagnosticBounds.y + sourceDiagnosticBounds.height / 2,
  };
  expect(diagnosticCenter.x).toBeGreaterThan(sourceBounds.x + sourceBounds.width / 2);
  expect(diagnosticCenter.x).toBeLessThanOrEqual(sourceBounds.x + sourceBounds.width);
  expect(diagnosticCenter.y).toBeGreaterThanOrEqual(sourceBounds.y);
  expect(diagnosticCenter.y).toBeLessThan(sourceBounds.y + sourceBounds.height / 2);
  await expect(source).toHaveAttribute('data-presentation-state', 'failed');
  await expect(source).toHaveAttribute('data-diagnostics', /component_failed/);
  await expect(page.locator('.workbench-results')).toHaveCount(0);
  await expect(page.locator('.workbench-toast')).toHaveCount(0);

  await page.getByRole('button', { name: 'Остановить моделирование' }).click();
  await page.goto('/#/projects');
  await page.evaluate((id) => localStorage.removeItem(`asa-project-local-draft:${id}`), projectId);
  await saveDocument(page, projectId, resistorOverloadDocument());
  await page.goto(`/#/home/${projectId}`);
  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  const overloadedSource = component(page, 'battery-holder-aa-2');
  const overloadedResistor = component(page, 'resistor-axial');
  await expect(overloadedSource).toHaveAttribute('data-presentation-state', 'destructive');
  await expect(overloadedResistor).toHaveAttribute('data-presentation-state', 'failed');
  await expect(overloadedResistor).toHaveAttribute('data-diagnostics', /component_failed/);
  expect(failures.counts).toMatchObject({
    consoleErrors: 0,
    pageErrors: 0,
    failedRequests: 0,
    httpServerErrors: 0,
  });
  failures.assertEmpty();
});

test('four-pin button is a momentary bridge for an arbitrary decimal LED load', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);

  const projectId = await createProject(page, 'R4-M1 momentary button arbitrary resistance');
  await saveDocument(page, projectId, buttonCircuitDocument(683.7));
  await page.goto(`/#/home/${projectId}`);
  await expect(page.locator('.workbench-stage')).toBeVisible();
  await page.getByRole('button', { name: 'Начать моделирование' }).click();

  const button = component(page, 'button-tactile-6mm');
  const buttonBody = button.locator('.workbench-part');
  await selectLed(page);
  await expect.poll(() => brightnessValue(page)).toBe(0);

  const buttonBox = await buttonBody.boundingBox();
  if (!buttonBox) throw new Error('button actuator has no visual bounding box');
  await page.mouse.move(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2);
  await page.mouse.down();
  await expect(button).toHaveClass(/workbench-component-actuator-active/);
  await expect.poll(() => brightnessValue(page)).toBeGreaterThan(0);

  await page.mouse.up();
  await expect(button).not.toHaveClass(/workbench-component-actuator-active/);
  await selectLed(page);
  await expect.poll(() => brightnessValue(page)).toBe(0);

  await buttonBody.click();
  const buttonInspector = page.locator('.workbench-inspector');
  await buttonInspector.getByRole('button', { name: 'Техническое состояние Кнопка' }).click();
  await expect(buttonInspector.getByTestId('button-contact-summary')).toContainText('Отпущена');
  await expect(buttonInspector.getByRole('checkbox')).toHaveCount(0);

  const holdButton = buttonInspector.getByRole('button', { name: 'Удерживать кнопку' });
  const holdBox = await holdButton.boundingBox();
  if (!holdBox) throw new Error('button inspector control has no visual bounding box');
  await page.mouse.move(holdBox.x + holdBox.width / 2, holdBox.y + holdBox.height / 2);
  await page.mouse.down();
  await expect(buttonInspector.getByTestId('button-contact-summary')).toContainText('Нажата');
  await expect.poll(() => brightnessValue(page)).toBeGreaterThan(0);
  await page.mouse.up();
  await expect(buttonInspector.getByTestId('button-contact-summary')).toContainText('Отпущена');
  await expect.poll(() => brightnessValue(page)).toBe(0);

  await buttonInspector.getByRole('button', { name: 'Справка о компоненте Кнопка' }).click();
  await expect(
    page.getByText('После отпускания цепь снова размыкается.', { exact: false }),
  ).toBeVisible();
  failures.assertEmpty();
});

test('SPDT selects exactly one throw and keeps the runtime position out of autosave', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);

  const projectId = await createProject(page, 'MATH-6C deterministic SPDT');
  await saveDocument(
    page,
    projectId,
    circuitDocument({ switchClosed: false, resistorOhms: 330, reversedLed: false }),
  );
  await page.goto(`/#/home/${projectId}`);
  await page.getByRole('button', { name: 'Начать моделирование' }).click();

  const switchComponent = component(page, 'switch-spdt');
  await selectLed(page);
  await expect.poll(() => brightnessValue(page)).toBe(0);
  await switchComponent.getByTestId('spdt-actuator').click();
  await expect.poll(() => brightnessValue(page)).toBeGreaterThan(0);

  const inspector = page.locator('.workbench-inspector');
  await inspector
    .getByRole('button', { name: 'Техническое состояние Ползунковый переключатель' })
    .click();
  await expect(inspector.getByTestId('spdt-contact-summary')).toContainText('правым выводом');
  await expect(inspector.getByRole('button', { name: 'Правый вывод' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await inspector.getByRole('button', { name: 'Левый вывод' }).click();
  await expect(inspector.getByTestId('spdt-contact-summary')).toContainText('левым выводом');
  await expect.poll(() => brightnessValue(page)).toBe(0);
  await inspector.getByRole('button', { name: 'Правый вывод' }).click();
  await expect.poll(() => brightnessValue(page)).toBeGreaterThan(0);

  await inspector
    .getByRole('button', { name: 'Справка о компоненте Ползунковый переключатель' })
    .click();
  await expect(
    page.getByText('Общий контакт всегда соединён ровно с одним выводом', { exact: false }),
  ).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await selectLed(page);
  await expect.poll(() => brightnessValue(page)).toBe(0);
  await expect(page.locator('[data-testid="schematic-wire"]')).toHaveCount(5);
  failures.assertEmpty();
});

test('independent and parallel sources keep diagnostics local and expose current direction', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithOrganization(page, teacher);
  const projectId = await createProject(page, 'R4-M1 isolated source diagnostics');
  await saveDocument(page, projectId, isolatedSourceDiagnosticsDocument());
  await page.goto(`/#/home/${projectId}`);
  await page.getByRole('button', { name: 'Начать моделирование' }).click();

  const renderedComponents = page.locator('[data-testid="schematic-component"]');
  const shortedSource = renderedComponents.nth(0);
  const safeSource = renderedComponents.nth(1);
  const burnoutSource = renderedComponents.nth(2);
  await expect(shortedSource).toHaveAttribute('data-diagnostics', /short_circuit/);
  await expect(safeSource).not.toHaveAttribute('data-diagnostics', /short_circuit/);
  await expect(burnoutSource).not.toHaveAttribute('data-diagnostics', /short_circuit/);
  await expect(
    page.locator('[data-testid="component-diagnostic"][data-component-id="safe-source"]'),
  ).toHaveCount(0);

  const burnedLedDiagnostic = page.locator(
    '[data-testid="component-diagnostic"][data-component-id="burned-led"]',
  );
  await burnedLedDiagnostic.locator('[data-testid="led-burnout-explosion"]').click();
  const technicalState = page.getByRole('button', {
    name: 'Техническое состояние Светодиод',
  });
  await expect(technicalState).toHaveAttribute('data-diagnostic-severity', 'error');
  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-isolated-source-diagnostics.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Остановить моделирование' }).click();
  const conflictProjectId = await createProject(page, 'R4-M1 parallel source modes');
  await saveDocument(page, conflictProjectId, conflictingParallelSourcesDocument());
  await page.goto(`/#/home/${conflictProjectId}`);
  await page.getByRole('button', { name: 'Начать моделирование' }).click();

  const highSource = page.locator(
    '[data-testid="schematic-component"][data-component-id="source-high"]',
  );
  const lowSource = page.locator(
    '[data-testid="schematic-component"][data-component-id="source-low"]',
  );
  await expect(highSource).toHaveAttribute('data-source-operating-mode', 'delivering');
  await expect(lowSource).toHaveAttribute('data-source-operating-mode', 'absorbing');
  await expect(highSource).toHaveAttribute('data-diagnostics', /conflicting_sources/);
  await expect(lowSource).toHaveAttribute('data-diagnostics', /conflicting_sources/);
  await expect(page.getByRole('button', { name: 'Остановить моделирование' })).toBeVisible();
  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-parallel-source-conflict.png`,
    fullPage: true,
  });
  failures.assertEmpty();
});

test('a direct 3 V / 166 ohm LED branch stays lit beside loose editor parts', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);

  const projectId = await createProject(page, 'R4-M1 direct 166 ohm LED regression');
  await saveDocument(page, projectId, directLedWithLoosePartsDocument());
  await page.goto(`/#/home/${projectId}`);
  await expect(page.locator('.workbench-stage')).toBeVisible();
  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await expect(page.getByRole('button', { name: 'Остановить моделирование' })).toBeVisible();

  const workingLed = component(page, 'led-5mm').first();
  await expect(workingLed.locator('.workbench-production-visual')).toHaveAttribute(
    'data-led-runtime-state',
    'lit',
  );
  await expect
    .poll(async () =>
      Number(
        (await workingLed
          .locator('.workbench-production-visual')
          .getAttribute('data-led-brightness')) ?? '0',
      ),
    )
    .toBeGreaterThan(40);
  await expect(workingLed).not.toHaveAttribute('data-diagnostics', /numerical_instability/);
  await expect(workingLed.locator('image:not([filter])')).not.toHaveAttribute(
    'href',
    /led_red_i000\.svg$/,
  );
  await page.screenshot({ path: `${ARTIFACT_DIR}/electronics-direct-led-166.png`, fullPage: true });
  failures.assertEmpty();
});

test('RGB LED mixes three calculated channels for both common modes', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);

  for (const commonMode of ['common-cathode', 'common-anode'] as const) {
    const projectId = await createProject(page, `R4-M1 RGB LED ${commonMode}`);
    await saveDocument(page, projectId, rgbLedDocument(commonMode));
    await page.goto(`/#/home/${projectId}`);
    await expect(page.locator('.workbench-stage')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Начать моделирование' }).click();

    const rgb = component(page, 'rgb-led');
    const visual = rgb.locator('.workbench-production-visual');
    await expect(visual).toHaveAttribute('data-rgb-runtime-state', 'lit');
    for (const channel of ['red', 'green', 'blue'] as const) {
      await expect
        .poll(async () => Number((await visual.getAttribute(`data-rgb-${channel}`)) ?? '0'))
        .toBeGreaterThan(0);
    }
    await expect(visual).not.toHaveAttribute('data-rgb-colour', 'rgb(0, 0, 0)');
    await expect(rgb.getByTestId('rgb-led-mixture')).toHaveCSS('opacity', /^(?!0(?:\.0+)?$)/);
    await rgb.locator('.workbench-part').click();
    const inspector = page.getByRole('complementary', { name: 'Параметры выделения' });
    await inspector.getByRole('button', { name: 'Техническое состояние RGB-светодиод' }).click();
    await expect(inspector.getByLabel('Разводка выводов RGB-светодиода')).toHaveValue('RCBG');
    await expect(inspector.locator('.workbench-calculated-property')).toHaveCount(0);
    await expect(inspector.locator('.workbench-terminal-list')).toHaveCount(1);

    if (commonMode === 'common-cathode') {
      await page.screenshot({
        path: `${ARTIFACT_DIR}/electronics-rgb-mixed-common-cathode.png`,
        fullPage: true,
      });
    }
  }
  failures.assertEmpty();
});

test('MATH-6E RGB inspector reports every physical channel independently', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);

  const projectId = await createProject(page, 'MATH-6E RGB independent channels');
  await saveDocument(page, projectId, rgbLedDocument('common-cathode'));
  await page.goto(`/#/home/${projectId}`);
  await expect(page.locator('.workbench-stage')).toBeVisible({ timeout: 15_000 });

  const rgb = component(page, 'rgb-led');
  await rgb.locator('.workbench-part').click();
  const inspector = page.getByRole('complementary', { name: 'Параметры выделения' });
  const technicalState = inspector.getByRole('button', {
    name: 'Техническое состояние RGB-светодиод',
  });
  await expect(technicalState).toHaveAttribute('aria-expanded', 'false');
  await expect(inspector.getByTestId('rgb-led-primary-controls')).toBeVisible();
  await expect(inspector.getByLabel('Тип общего вывода RGB-светодиода')).toHaveValue(
    'common-cathode',
  );
  await expect(inspector.getByLabel('Разводка выводов RGB-светодиода')).toHaveValue('RCBG');
  await expect(inspector.getByTestId('rgb-led-channel-measurements')).toHaveCount(0);
  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-rgb-led-compact-controls.png`,
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await technicalState.click();
  await expect(inspector.locator('.workbench-terminal-list')).toHaveCount(0);
  const channels = inspector.getByTestId('rgb-led-channel-measurements');
  await expect(channels).toContainText('Красный R');
  await expect(channels).toContainText('Зелёный G');
  await expect(channels).toContainText('Синий B');
  await expect(channels).toContainText('Подключён');
  await expect(channels).toContainText('Общая мощность');
  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-rgb-led-math-6e-runtime.png`,
    fullPage: true,
  });
  failures.assertEmpty();
});

test('MATH-6E seven-segment display uses physical pins and an arbitrary segment mask', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);

  for (const commonMode of ['common-cathode', 'common-anode'] as const) {
    const projectId = await createProject(page, `MATH-6E seven segment ${commonMode}`);
    await saveDocument(page, projectId, sevenSegmentDocument(commonMode));
    await page.goto(`/#/home/${projectId}`);
    await expect(page.locator('.workbench-stage')).toBeVisible({ timeout: 15_000 });

    const display = component(page, 'seven-segment-display');
    await display.locator('.workbench-part').press('Enter');
    const inspector = page.getByRole('complementary', { name: 'Параметры выделения' });
    const technicalState = inspector.getByRole('button', {
      name: 'Техническое состояние Семисегментный индикатор',
    });
    if ((await technicalState.getAttribute('aria-expanded')) === 'true') {
      await technicalState.click();
    }
    await expect(technicalState).toHaveAttribute('aria-expanded', 'false');
    await expect(inspector.getByTestId('seven-segment-primary-controls')).toBeVisible();
    await expect(inspector.getByLabel('Тип общего вывода семисегментного индикатора')).toHaveValue(
      commonMode,
    );
    await expect(inspector.getByTestId('seven-segment-junction-measurements')).toHaveCount(0);
    if (commonMode === 'common-cathode') {
      await page.screenshot({
        path: `${ARTIFACT_DIR}/electronics-seven-segment-compact-controls.png`,
        fullPage: true,
      });
    }

    await page.getByRole('button', { name: 'Начать моделирование' }).click();
    const visual = display.getByTestId('seven-segment-state');
    for (const segment of ['a', 'b', 'd', 'e', 'g']) {
      await expect
        .poll(async () =>
          Number(
            (await visual.locator(`[data-segment="${segment}"]`).getAttribute('opacity')) ?? '0',
          ),
        )
        .toBeGreaterThan(0);
    }
    for (const segment of ['c', 'f', 'dp']) {
      await expect(visual.locator(`[data-segment="${segment}"]`)).toHaveAttribute('opacity', '0');
    }

    await technicalState.click();
    await expect(inspector.locator('.workbench-terminal-list')).toHaveCount(0);
    await expect(inspector.getByTestId('seven-segment-active-mask')).toContainText('A, B, D, E, G');
    const segments = inspector.getByTestId('seven-segment-junction-measurements');
    await expect(segments).toContainText('DP');
    await expect(segments).toContainText('Подключён');
    await expect(inspector).toContainText('COM1 и COM2 электрически соединены внутри корпуса');

    if (commonMode === 'common-cathode') {
      await page.screenshot({
        path: `${ARTIFACT_DIR}/electronics-seven-segment-math-6e-runtime.png`,
        fullPage: true,
      });
    }
  }
  failures.assertEmpty();
});

test('MATH-10A1 multimeter measures signed DC voltage with a finite input', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);

  for (const reverseProbes of [false, true]) {
    const projectId = await createProject(
      page,
      reverseProbes ? 'Мультиметр: обратная полярность' : 'Мультиметр: 3 В',
    );
    await saveDocument(page, projectId, multimeterDcVoltageDocument(reverseProbes));
    await page.goto(`/#/home/${projectId}`);
    await expect(page.locator('.workbench-stage')).toBeVisible({ timeout: 15_000 });

    const meter = component(page, 'multimeter');
    await meter.locator('.workbench-part').press('Enter');
    const inspector = page.getByRole('complementary', { name: 'Параметры выделения' });
    await expect(inspector.getByTestId('multimeter-primary-controls')).toBeVisible();
    await expect(inspector.getByLabel('Режим мультиметра')).toHaveValue('dc-voltage');
    await expect(inspector.getByTestId('multimeter-panel-reading')).toContainText(
      'Запустите моделирование',
    );

    await page.getByRole('button', { name: 'Начать моделирование' }).click();
    const display = meter.getByTestId('multimeter-runtime-display');
    await expect(display).toHaveAttribute('data-measurement-mode', 'dc-voltage');
    await expect
      .poll(async () => Number((await display.getAttribute('data-measured-value')) ?? 'NaN'))
      .toBeCloseTo(reverseProbes ? -2.999999865 : 2.999999865, 6);
    await expect(display).toContainText(reverseProbes ? '-3.000 V' : '3.000 V');
    await expect(inspector.getByTestId('multimeter-panel-reading')).toContainText(
      reverseProbes ? '-3.000 В' : '3.000 В',
    );

    const technicalState = inspector.getByRole('button', {
      name: 'Техническое состояние Мультиметр',
    });
    if ((await technicalState.getAttribute('aria-expanded')) !== 'true') {
      await technicalState.click();
    }
    await expect(inspector.getByTestId('multimeter-reference-profile')).toContainText('10 МОм');
    await expect(inspector.getByTestId('multimeter-reference-profile')).toContainText(
      'Параллельно измеряемому участку',
    );
    await expect(inspector).not.toContainText('математическая модель пока не реализована');
    await page.screenshot({
      path: `${ARTIFACT_DIR}/${
        reverseProbes
          ? 'electronics-multimeter-reversed-probes.png'
          : 'electronics-multimeter-dc-voltage.png'
      }`,
      fullPage: true,
    });
  }
  failures.assertEmpty();
});

test('MATH-10A2 multimeter measures series DC current from the owner A button', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);
  const projectId = await createProject(page, 'Мультиметр: ток 100 Ом');
  await saveDocument(page, projectId, multimeterDcCurrentDocument());
  await page.goto(`/#/home/${projectId}`);
  await expect(page.locator('.workbench-stage')).toBeVisible({ timeout: 15_000 });

  const meter = component(page, 'multimeter');
  await meter.locator('.workbench-part').press('Enter');
  const inspector = page.getByRole('complementary', { name: 'Параметры выделения' });
  await expect(inspector.getByLabel('Режим мультиметра')).toHaveValue('dc-voltage');
  await meter.locator('.workbench-multimeter-mode-current').first().click();
  await expect(inspector.getByLabel('Режим мультиметра')).toHaveValue('dc-current');

  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  const display = meter.getByTestId('multimeter-runtime-display');
  await expect(display).toHaveAttribute('data-measurement-mode', 'dc-current');
  await expect
    .poll(async () => Number((await display.getAttribute('data-measured-value')) ?? 'NaN'))
    .toBeCloseTo(3 / (0.45 + 100 + 1.8), 5);
  await expect(display).toContainText('29.3 mA');
  await expect(inspector.getByTestId('multimeter-panel-reading')).toContainText('29.3 мА');

  const technicalState = inspector.getByRole('button', {
    name: 'Техническое состояние Мультиметр',
  });
  if ((await technicalState.getAttribute('aria-expanded')) !== 'true') {
    await technicalState.click();
  }
  const profile = inspector.getByTestId('multimeter-reference-profile');
  await expect(profile).toContainText('1.8 Ом');
  await expect(profile).toContainText('Последовательно с нагрузкой');
  await expect(profile).toContainText('Исправен · 440 мА');
  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-multimeter-dc-current.png`,
    fullPage: true,
  });
  failures.assertEmpty();
});

test('MATH-10A3 multimeter measures resistance from the owner R button and blocks powered circuits', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);

  const projectId = await createProject(page, 'Мультиметр: сопротивление 1 кОм');
  await saveDocument(page, projectId, multimeterResistanceDocument());
  await page.goto(`/#/home/${projectId}`);
  await expect(page.locator('.workbench-stage')).toBeVisible({ timeout: 15_000 });

  const meter = component(page, 'multimeter');
  await meter.locator('.workbench-part').press('Enter');
  const inspector = page.getByRole('complementary', { name: 'Параметры выделения' });
  await expect(inspector.getByLabel('Режим мультиметра')).toHaveValue('dc-voltage');
  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  await meter.locator('.workbench-multimeter-mode-resistance').first().click();
  await expect(inspector.getByLabel('Режим мультиметра')).toHaveValue('resistance');

  const display = meter.getByTestId('multimeter-runtime-display');
  await expect(display).toHaveAttribute('data-measurement-mode', 'resistance');
  await expect
    .poll(async () => Number((await display.getAttribute('data-measured-value')) ?? 'NaN'))
    .toBeCloseTo(1_000, 2);
  await expect(display).toContainText('1.000 kΩ');
  await expect(inspector.getByTestId('multimeter-panel-reading')).toContainText('1.00 кОм');

  const technicalState = inspector.getByRole('button', {
    name: 'Техническое состояние Мультиметр',
  });
  if ((await technicalState.getAttribute('aria-expanded')) !== 'true') await technicalState.click();
  const profile = inspector.getByTestId('multimeter-reference-profile');
  await expect(profile).toContainText('Авто · до 50.00 МОм');
  await expect(profile).toContainText('Нет');
  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-multimeter-resistance.png`,
    fullPage: true,
  });

  const saved = await page.context().request.get(`/api/projects/${projectId}`, {
    headers: { origin: new URL(page.url()).origin },
  });
  const savedPayload = (await saved.json()) as { draft: { document: SchematicDocument } };
  expect(
    savedPayload.draft.document.components.find((item) => item.id === 'meter')?.stateProperties?.[
      'measurementMode'
    ],
  ).toBe('dc-voltage');

  const poweredProjectId = await createProject(page, 'Мультиметр: R под питанием');
  await saveDocument(page, poweredProjectId, multimeterResistanceDocument(true));
  await page.goto(`/#/home/${poweredProjectId}`);
  await page.getByRole('button', { name: 'Начать моделирование' }).click();
  const poweredMeter = component(page, 'multimeter');
  await poweredMeter.locator('.workbench-part').press('Enter');
  const poweredInspector = page.getByRole('complementary', { name: 'Параметры выделения' });
  await expect(poweredMeter.getByTestId('multimeter-runtime-display')).toContainText('ОШИБКА');
  await expect(poweredInspector.getByTestId('multimeter-panel-reading')).toContainText(
    'Ошибка · внешнее напряжение',
  );
  failures.assertEmpty();
});

test('RGB LED visibly mixes the saved 3 V red and blue owner wiring', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);

  const projectId = await createProject(page, 'R4-M1 RGB red blue 3 V regression');
  await saveDocument(page, projectId, ownerRedBlueRgbDocument());
  await page.goto(`/#/home/${projectId}`);
  await expect(page.locator('.workbench-stage')).toBeVisible();
  await page.getByRole('button', { name: 'Начать моделирование' }).click();

  const rgb = component(page, 'rgb-led');
  const visual = rgb.locator('.workbench-production-visual');
  await expect(visual).toHaveAttribute('data-rgb-runtime-state', 'lit');
  const red = Number((await visual.getAttribute('data-rgb-red')) ?? '0');
  const green = Number((await visual.getAttribute('data-rgb-green')) ?? '0');
  const blue = Number((await visual.getAttribute('data-rgb-blue')) ?? '0');
  expect(red).toBeGreaterThan(0);
  expect(green).toBe(0);
  expect(blue).toBeGreaterThan(red);
  await expect(visual).not.toHaveAttribute('data-rgb-colour', /^rgb\((?:0, 0, 0|255, 0, 0)\)$/);
  await expect(rgb.getByTestId('rgb-led-mixture')).toHaveCSS('opacity', /^(?!0(?:\.0+)?$)/);
  await expect(diagnostic(page, 'rgb-led', 'rgb-led-burnout-explosion')).toHaveCount(0);
  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-rgb-red-blue-3v.png`,
    fullPage: true,
  });
  failures.assertEmpty();
});

test('RGB LED visibly mixes equal 220 ohm green and blue branches at 3 V', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);

  const projectId = await createProject(page, 'R4-M1 RGB green blue equal 220 ohm regression');
  await saveDocument(page, projectId, ownerGreenBlueEqualRgbDocument());
  await page.goto(`/#/home/${projectId}`);
  await expect(page.locator('.workbench-stage')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Начать моделирование' }).click();

  const rgb = component(page, 'rgb-led');
  const visual = rgb.locator('.workbench-production-visual');
  await expect(visual).toHaveAttribute('data-rgb-runtime-state', 'lit');
  const red = Number((await visual.getAttribute('data-rgb-red')) ?? '0');
  const green = Number((await visual.getAttribute('data-rgb-green')) ?? '0');
  const blue = Number((await visual.getAttribute('data-rgb-blue')) ?? '0');
  expect(red).toBe(0);
  expect(green).toBeGreaterThan(0);
  expect(blue).toBeGreaterThanOrEqual(green * 0.45);
  expect(blue).toBeLessThan(green);

  const mixture = rgb.getByTestId('rgb-led-mixture');
  const displayColour = (await mixture.getAttribute('fill')) ?? '';
  const channels = displayColour.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
  expect(channels).not.toBeNull();
  expect(Number(channels?.[1] ?? 0)).toBe(0);
  expect(Number(channels?.[2] ?? 0)).toBe(255);
  expect(Number(channels?.[3] ?? 0)).toBeGreaterThanOrEqual(110);
  await expect(rgb).toHaveAttribute('data-diagnostics', '');
  await expect(page.getByTestId('component-diagnostic-indicator')).toHaveCount(0);
  await page.screenshot({
    path: `${ARTIFACT_DIR}/electronics-rgb-green-blue-equal-220.png`,
    fullPage: true,
  });
  failures.assertEmpty();
});

test('RGB LED mirrors ordinary LED lit, reverse-polarity and burnout states', async ({ page }) => {
  test.setTimeout(120_000);
  const failures = collectBrowserFailures(page, { allowAnonymousSessionProbe: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithOrganization(page, teacher);

  const scenarios = [
    {
      name: 'single-green',
      document: singleChannelRgbLedDocument({
        componentMode: 'common-cathode',
        wiringMode: 'common-cathode',
        resistorOhms: 220,
      }),
      runtimeState: 'lit',
      diagnostic: null,
    },
    {
      name: 'owner-reversed-common',
      document: singleChannelRgbLedDocument({
        componentMode: 'common-cathode',
        wiringMode: 'common-anode',
        resistorOhms: null,
      }),
      runtimeState: 'off',
      diagnostic: 'reverse_polarity',
    },
    {
      name: 'direct-overload',
      document: singleChannelRgbLedDocument({
        componentMode: 'common-anode',
        wiringMode: 'common-anode',
        resistorOhms: null,
      }),
      runtimeState: 'burned',
      diagnostic: 'led_burnout',
    },
  ] as const;

  for (const scenario of scenarios) {
    const projectId = await createProject(page, `R4-M1 RGB ${scenario.name}`);
    await saveDocument(page, projectId, scenario.document);
    await page.goto(`/#/home/${projectId}`);
    await expect(page.locator('.workbench-stage')).toBeVisible();
    await page.getByRole('button', { name: 'Начать моделирование' }).click();

    const rgb = component(page, 'rgb-led');
    const visual = rgb.locator('.workbench-production-visual');
    await expect(visual).toHaveAttribute('data-rgb-runtime-state', scenario.runtimeState);
    if (scenario.runtimeState === 'lit') {
      await expect(visual).toHaveAttribute('data-rgb-red', '0');
      await expect
        .poll(async () => Number((await visual.getAttribute('data-rgb-green')) ?? '0'))
        .toBeGreaterThan(0);
      await expect(visual).toHaveAttribute('data-rgb-blue', '0');
      await expect(rgb.getByTestId('rgb-led-mixture')).toHaveCSS('opacity', /^(?!0(?:\.0+)?$)/);
    } else {
      await expect(rgb).toHaveAttribute('data-diagnostics', new RegExp(scenario.diagnostic ?? ''));
      await expect(rgb.getByTestId('rgb-led-mixture')).toHaveCSS('opacity', '0');
    }
    if (scenario.diagnostic === 'reverse_polarity') {
      await expect(diagnostic(page, 'rgb-led', 'led-diagnostic-badge')).toHaveCount(0);
      await expect(diagnostic(page, 'rgb-led', 'rgb-led-burnout-explosion')).toHaveCount(0);
    }
    if (scenario.runtimeState === 'burned') {
      await expect(diagnostic(page, 'rgb-led', 'rgb-led-burnout-explosion')).toBeVisible();
      await expect(diagnostic(page, 'rgb-led', 'rgb-led-burnout-explosion')).toHaveAttribute(
        'aria-label',
        /перегорел/i,
      );
    }
  }
  failures.assertEmpty();
});
