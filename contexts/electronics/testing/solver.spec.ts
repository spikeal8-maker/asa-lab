import { describe, expect, it } from 'vitest';
import {
  parseElectronicsDocument,
  type ComponentKind,
  type ElectronicsDocument,
  type SchematicComponent,
  type Terminal,
} from '../domain/document';
import { buildNetlist, terminalKey } from '../domain/netlist';
import { electricalModelFor } from '../domain/model-registry';
import {
  canonicalElectricalModelRegistry,
  electricalModelIdentityForComponent,
  electricalModelRegistryEntries,
} from '../domain/model-identity';
import {
  ledCurrentForSeriesResistance,
  ledBrightnessPercent,
  ordinaryLedProfile,
  ORDINARY_LED_PROFILES,
  rgbLedProfile,
  type OrdinaryLedColour,
  type RgbLedChannel,
} from '../domain/led-model';
import { solveCircuit } from '../domain/solver';
import {
  canonicalPhotoresistorProfileRegistry,
  photoresistorIlluminanceLux,
  photoresistorResistanceAtIlluminanceOhm,
  photoresistorResistanceOhm,
  PHOTORESISTOR_BRIGHT_RESISTANCE_OHM,
  PHOTORESISTOR_DARK_RESISTANCE_OHM,
  PHOTORESISTOR_PROFILE,
} from '../domain/photoresistor-model';
import {
  canonicalNonlinearDcProfileRegistry,
  DIODE_JUNCTION_PROFILES,
  nonlinearDcBranchesForComponent,
} from '../domain/models/nonlinear-dc-models';
import {
  canonicalIncandescentLampProfileRegistry,
  incandescentLampResistanceOhm,
  INCANDESCENT_LAMP_PROFILE,
} from '../domain/models/incandescent-lamp-model';

function component(
  id: string,
  kind: ComponentKind,
  value: number,
  options: Partial<SchematicComponent> = {},
): SchematicComponent {
  return { id, kind, position: { x: 0, y: 0 }, value, ...options };
}

function connect(
  id: string,
  from: string,
  fromTerminal: Terminal,
  to: string,
  toTerminal: Terminal,
) {
  return {
    id,
    from: { componentId: from, terminal: fromTerminal },
    to: { componentId: to, terminal: toTerminal },
    color: '#e3212b',
    vertices: [],
  };
}

function doc(
  components: SchematicComponent[],
  connections: ReturnType<typeof connect>[],
): ElectronicsDocument {
  const parsed = parseElectronicsDocument({
    schemaVersion: 2,
    components,
    connections,
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

function series(parts: SchematicComponent[], voltage = 5): ElectronicsDocument {
  const source = component('source', 'source', voltage);
  const connections = [connect('wire-0', 'source', 'a', parts[0]!.id, 'a')];
  parts.forEach((part, index) => {
    const next = parts[index + 1];
    connections.push(
      next
        ? connect(`wire-${index + 1}`, part.id, 'b', next.id, 'a')
        : connect(`wire-${index + 1}`, part.id, 'b', 'source', 'b'),
    );
  });
  return doc([source, ...parts], connections);
}

function resultFor(document: ElectronicsDocument, componentId: string) {
  return solveCircuit(document).components.find((result) => result.componentId === componentId);
}

function deterministicResistanceSamples(count: number): readonly number[] {
  let state = 0x6d2b79f5;
  const samples = Array.from({ length: count }, () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const unit = state / 0x1_0000_0000;
    // Exercise decimal values across seven orders of magnitude without relying
    // on a test runner's random seed.
    return Number((10 ** (-2 + unit * 7)).toPrecision(10));
  });
  return [0, ...samples].sort((left, right) => left - right);
}

describe('schema-versioned Electronics document', () => {
  it('normalises an existing schema v1 document without data loss', () => {
    const parsed = parseElectronicsDocument({
      schemaVersion: 1,
      components: [component('r1', 'resistor', 100)],
      connections: [],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.migrated).toBe(true);
    expect(parsed.document).toMatchObject({
      schemaVersion: 4,
      components: [{ id: 'r1', kind: 'resistor', value: 100 }],
      viewport: { x: 0, y: 0, zoom: 1 },
      simulation: { running: false, maxIterations: 24 },
    });
    expect(parsed.document.components[0]).toMatchObject({
      electricalModelId: 'resistor',
      electricalModelVersion: 1,
      modelProfileId: 'legacy-resistor',
      modelProfileVersion: 1,
    });
  });

  it('normalises exact production types into a deterministic versioned model registry', () => {
    const parsed = parseElectronicsDocument({
      schemaVersion: 3,
      components: [
        component('d1', 'diode', 0.7, { componentTypeId: 'diode-do41' }),
        component('motor', 'visual', 0, { componentTypeId: 'dc-motor' }),
      ],
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      simulation: { running: false, maxIterations: 24 },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document.schemaVersion).toBe(4);
    expect(parsed.document.components[0]).toMatchObject({
      electricalModelId: 'diode',
      modelProfileId: 'generic-rectifier-diode-do41',
    });
    expect(parsed.document.components[1]).toMatchObject({
      electricalModelId: 'dc-motor',
      modelProfileId: 'pololu-1117-130-6v',
    });
    expect(electricalModelFor(parsed.document.components[1]!)).toMatchObject({
      support: 'supported',
      topology: 'two-terminal',
    });

    const entries = electricalModelRegistryEntries();
    expect(entries.map((entry) => entry.componentTypeId)).toEqual(
      [...entries.map((entry) => entry.componentTypeId)].sort(),
    );
    expect(canonicalElectricalModelRegistry()).toBe(canonicalElectricalModelRegistry());
  });

  it('upgrades the exact lamp placeholder identity to the versioned 6 V profile', () => {
    expect(
      electricalModelIdentityForComponent(
        component('lamp', 'lamp', 24, {
          componentTypeId: 'incandescent-lamp',
          electricalModelId: 'incandescent-lamp',
          electricalModelVersion: 1,
          modelProfileId: 'generic-incandescent-lamp',
          modelProfileVersion: 1,
        }),
      ),
    ).toMatchObject({
      electricalModelId: 'incandescent-lamp',
      modelProfileId: 't1-bipin-6v-incandescent',
      modelProfileVersion: 2,
    });
  });

  it('upgrades the exact RGB and seven-segment placeholders to independent-junction profiles', () => {
    expect(
      electricalModelIdentityForComponent(
        component('rgb', 'rgb-led', 0, {
          componentTypeId: 'rgb-led',
          electricalModelId: 'rgb-led',
          electricalModelVersion: 1,
          modelProfileId: 'generic-rgb-led',
          modelProfileVersion: 1,
        }),
      ),
    ).toMatchObject({
      electricalModelId: 'rgb-led',
      modelProfileId: 'four-pin-rgb-led-independent-junctions',
      modelProfileVersion: 2,
    });
    expect(
      electricalModelIdentityForComponent(
        component('display', 'seven-segment', 0, {
          componentTypeId: 'seven-segment-display',
          electricalModelId: 'seven-segment',
          electricalModelVersion: 1,
          modelProfileId: 'generic-seven-segment',
          modelProfileVersion: 1,
        }),
      ),
    ).toMatchObject({
      electricalModelId: 'seven-segment',
      modelProfileId: 'single-digit-seven-segment-10pin',
      modelProfileVersion: 2,
    });
  });

  it('preserves a complete future model identity and rejects partial identities', () => {
    const future = parseElectronicsDocument({
      schemaVersion: 4,
      components: [
        component('future', 'visual', 0, {
          componentTypeId: 'future-device',
          electricalModelId: 'future-model',
          electricalModelVersion: 7,
          modelProfileId: 'future-profile',
          modelProfileVersion: 3,
        }),
      ],
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      simulation: { running: false, maxIterations: 24 },
    });
    expect(future.ok && future.document.components[0]).toMatchObject({
      electricalModelId: 'future-model',
      electricalModelVersion: 7,
      modelProfileId: 'future-profile',
      modelProfileVersion: 3,
    });
    if (future.ok) {
      expect(electricalModelFor(future.document.components[0]!)).toMatchObject({
        id: 'unsupported',
        support: 'unsupported',
      });
    }
    expect(
      parseElectronicsDocument({
        schemaVersion: 4,
        components: [
          component('broken', 'resistor', 100, {
            electricalModelId: 'resistor',
          }),
        ],
        connections: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        simulation: { running: false, maxIterations: 24 },
      }).ok,
    ).toBe(false);
  });

  it('preserves stable ids, three-terminal potentiometers, bends, colors and settings', () => {
    const parsed = parseElectronicsDocument({
      schemaVersion: 2,
      components: [
        component('p1', 'potentiometer', 1000, { wiperPosition: 0.25, name: 'Регулятор' }),
        component('r1', 'resistor', 100),
      ],
      connections: [connect('w1', 'p1', 'wiper', 'r1', 'a')],
      viewport: { x: 15, y: -5, zoom: 1.5 },
      simulation: { running: true, maxIterations: 32 },
    });
    expect(parsed.ok && parsed.document.connections[0]).toMatchObject({
      id: 'w1',
      color: '#e3212b',
      vertices: [],
      from: { componentId: 'p1', terminal: 'wiper' },
    });
    expect(parsed.ok && parsed.document.viewport.zoom).toBe(1.5);
  });

  it('persists 45-degree rotations and rejects angles outside the editor step', () => {
    const accepted = parseElectronicsDocument({
      schemaVersion: 4,
      components: [component('r1', 'resistor', 100, { rotation: 45 })],
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      simulation: { running: false, maxIterations: 24 },
    });
    expect(accepted.ok && accepted.document.components[0]?.rotation).toBe(45);
    expect(
      parseElectronicsDocument({
        schemaVersion: 4,
        components: [{ ...component('r1', 'resistor', 100), rotation: 30 }],
        connections: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        simulation: { running: false, maxIterations: 24 },
      }).ok,
    ).toBe(false);
  });

  it('rejects malformed documents and dangling endpoint ids', () => {
    expect(parseElectronicsDocument({ schemaVersion: 9, components: [], connections: [] }).ok).toBe(
      false,
    );
    expect(
      parseElectronicsDocument({
        schemaVersion: 1,
        components: [component('r1', 'resistor', 100)],
        connections: [connect('w1', 'r1', 'a', 'missing', 'b')],
      }).ok,
    ).toBe(false);
  });
});

describe('MATH-10A3 multimeter resistance', () => {
  function resistanceCircuit(
    options: {
      resistanceOhm?: number;
      powered?: boolean;
      shorted?: boolean;
      open?: boolean;
    } = {},
  ): ElectronicsDocument {
    const meter = component('meter', 'visual', 0, {
      componentTypeId: 'multimeter',
      pinIds: ['com', 'v-ohm-ma'],
      stateProperties: { measurementMode: 'resistance', meterRange: 'auto' },
    });
    const resistor = component('load', 'resistor', options.resistanceOhm ?? 1_000, {
      componentTypeId: 'resistor-axial',
      pinIds: ['lead-1', 'lead-2'],
    });
    const source = component('battery', 'source', 3, {
      componentTypeId: 'battery-holder-aa-2',
      pinIds: ['BAT-', 'BAT+'],
    });
    if (options.open) return doc([meter], []);
    if (options.shorted) {
      return doc([meter], [connect('short', 'meter', 'v-ohm-ma', 'meter', 'com')]);
    }
    const components = options.powered ? [source, resistor, meter] : [resistor, meter];
    const connections = [
      connect('probe-red', 'meter', 'v-ohm-ma', 'load', 'lead-1'),
      connect('probe-black', 'meter', 'com', 'load', 'lead-2'),
      ...(options.powered
        ? [
            connect('supply-positive', 'battery', 'BAT+', 'load', 'lead-1'),
            connect('supply-negative', 'battery', 'BAT-', 'load', 'lead-2'),
          ]
        : []),
    ];
    return doc(components, connections);
  }

  it('uses its own bounded test source to measure a de-energized resistor', () => {
    const result = solveCircuit(resistanceCircuit({ resistanceOhm: 1_000 }));
    const meter = result.components.find((entry) => entry.componentId === 'meter');
    expect(result.status).toBe('solved');
    expect(meter).toMatchObject({
      measurementMode: 'resistance',
      measurementUnit: 'Ω',
      meterTestVoltageVolt: 1,
      meterResistanceRangeOhm: 50_000_000,
      meterOpenCircuit: false,
      meterExternalPowerPresent: false,
      meterOverload: false,
    });
    expect(meter?.measuredValue).toBeCloseTo(1_000, 3);
    expect(meter?.meterTestCurrentAmp).toBeCloseTo(0.0005, 8);
    expect(result.numericalResidual).toBeLessThanOrEqual(result.numericalTolerance);
  });

  it('reports zero for a short and OL for an open circuit', () => {
    const shorted = solveCircuit(resistanceCircuit({ shorted: true }));
    const open = solveCircuit(resistanceCircuit({ open: true }));
    expect(shorted.components.find((entry) => entry.componentId === 'meter')).toMatchObject({
      measuredValue: 0,
      meterOpenCircuit: false,
    });
    expect(open.components.find((entry) => entry.componentId === 'meter')).toMatchObject({
      measurementMode: 'resistance',
      meterOpenCircuit: true,
      meterOverload: false,
    });
  });

  it('treats a one-terminal source path through a motor as an open circuit, not external power', () => {
    const meter = component('meter', 'visual', 0, {
      componentTypeId: 'multimeter',
      pinIds: ['com', 'v-ohm-ma'],
      stateProperties: { measurementMode: 'resistance', meterRange: 'auto' },
    });
    const motor = component('motor', 'visual', 0, {
      componentTypeId: 'gearmotor',
      pinIds: ['negative', 'positive'],
      stateProperties: { motorAssemblyProfileId: 'adafruit-3777-tt-48to1' },
    });
    const source = component('battery', 'source', 3, {
      componentTypeId: 'battery-holder-aa-2',
      pinIds: ['BAT-', 'BAT+'],
    });
    const result = solveCircuit(
      doc(
        [source, motor, meter],
        [
          connect('source-to-motor', 'battery', 'BAT+', 'motor', 'positive'),
          connect('motor-to-red-probe', 'motor', 'negative', 'meter', 'v-ohm-ma'),
        ],
      ),
    );
    const measurement = result.components.find((entry) => entry.componentId === 'meter');

    expect(result.status).toBe('solved');
    expect(measurement).toMatchObject({
      measurementMode: 'resistance',
      measurementUnit: 'Ω',
      meterTestCurrentAmp: 0,
      meterOpenCircuit: true,
      meterExternalPowerPresent: false,
      meterOverload: false,
    });
    expect(result.diagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'multimeter_powered_resistance' })]),
    );
  });

  it('measures a potentiometer when a powered motor loop touches it at only one node', () => {
    const meter = component('meter', 'visual', 0, {
      componentTypeId: 'multimeter',
      pinIds: ['com', 'v-ohm-ma'],
      stateProperties: { measurementMode: 'resistance', meterRange: 'auto' },
    });
    const potentiometer = component('pot', 'potentiometer', 1_000, {
      componentTypeId: 'potentiometer',
      pinIds: ['terminal-1', 'wiper', 'terminal-2'],
      wiperPosition: 0.5,
    });
    const motor = component('motor', 'visual', 0, {
      componentTypeId: 'gearmotor',
      pinIds: ['negative', 'positive'],
      stateProperties: { motorAssemblyProfileId: 'adafruit-3777-tt-48to1' },
    });
    const source = component('battery', 'source', 3, {
      componentTypeId: 'battery-holder-aa-2',
      pinIds: ['BAT-', 'BAT+'],
    });
    const result = solveCircuit(
      doc(
        [source, motor, potentiometer, meter],
        [
          connect('source-positive', 'battery', 'BAT+', 'motor', 'positive'),
          connect('source-negative', 'battery', 'BAT-', 'motor', 'negative'),
          connect('red-probe', 'meter', 'v-ohm-ma', 'pot', 'terminal-1'),
          connect('single-shared-node', 'pot', 'terminal-1', 'motor', 'negative'),
          connect('black-probe', 'meter', 'com', 'pot', 'terminal-2'),
        ],
      ),
    );
    const measurement = result.components.find((entry) => entry.componentId === 'meter');

    expect(result.status).toBe('solved');
    expect(measurement).toMatchObject({
      measurementMode: 'resistance',
      measurementUnit: 'Ω',
      meterOpenCircuit: false,
      meterExternalPowerPresent: false,
      meterOverload: false,
    });
    expect(measurement?.measuredValue).toBeCloseTo(1_000, 3);
    expect(result.diagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'multimeter_powered_resistance' })]),
    );
  });

  it('does not inject a test source into a powered circuit and reports external voltage', () => {
    const result = solveCircuit(resistanceCircuit({ powered: true }));
    const meter = result.components.find((entry) => entry.componentId === 'meter');
    expect(result.status).toBe('solved');
    expect(meter).toMatchObject({
      measurementMode: 'resistance',
      measurementUnit: 'Ω',
      meterTestCurrentAmp: 0,
      meterExternalPowerPresent: true,
      meterOverload: true,
    });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'multimeter_powered_resistance', severity: 'error' }),
      ]),
    );
  });
});

describe('MATH-10A1 multimeter DC voltage', () => {
  function meterCircuit(reverseProbes = false): ElectronicsDocument {
    const source = component('battery', 'source', 3, {
      componentTypeId: 'battery-holder-aa-2',
      pinIds: ['BAT-', 'BAT+'],
    });
    const meter = component('meter', 'visual', 0, {
      componentTypeId: 'multimeter',
      pinIds: ['com', 'v-ohm-ma'],
      stateProperties: { measurementMode: 'dc-voltage', meterRange: 'auto' },
    });
    return doc(
      [source, meter],
      reverseProbes
        ? [
            connect('red', 'battery', 'BAT-', 'meter', 'v-ohm-ma'),
            connect('black', 'battery', 'BAT+', 'meter', 'com'),
          ]
        : [
            connect('red', 'battery', 'BAT+', 'meter', 'v-ohm-ma'),
            connect('black', 'battery', 'BAT-', 'meter', 'com'),
          ],
    );
  }

  it('measures the source in parallel and includes finite input loading in KCL', () => {
    const result = solveCircuit(meterCircuit());
    const meter = result.components.find((entry) => entry.componentId === 'meter');
    expect(result.status).toBe('solved');
    expect(meter).toMatchObject({
      measurementMode: 'dc-voltage',
      measurementUnit: 'V',
      meterInputResistanceOhm: 10_000_000,
      meterOverload: false,
    });
    expect(meter?.measuredValue).toBeCloseTo(2.999999865, 8);
    expect(meter?.current).toBeCloseTo(0.0000003, 10);
    expect(meter?.terminalCurrents?.['v-ohm-ma']).toBeCloseTo(0.0000003, 10);
    expect(result.numericalResidual).toBeLessThanOrEqual(result.numericalTolerance);
  });

  it('shows a negative reading when the probes are reversed', () => {
    const result = solveCircuit(meterCircuit(true));
    const meter = result.components.find((entry) => entry.componentId === 'meter');
    expect(result.status).toBe('solved');
    expect(meter?.measuredValue).toBeCloseTo(-2.999999865, 8);
    expect(meter?.current).toBeLessThan(0);
  });

  it('upgrades only the known saved unsupported multimeter placeholder', () => {
    const upgraded = electricalModelIdentityForComponent(
      component('meter', 'visual', 0, {
        componentTypeId: 'multimeter',
        electricalModelId: 'unsupported',
        electricalModelVersion: 1,
        modelProfileId: 'unsupported-multimeter',
        modelProfileVersion: 1,
      }),
    );
    expect(upgraded).toEqual({
      electricalModelId: 'digital-multimeter',
      electricalModelVersion: 1,
      modelProfileId: 'asa-two-terminal-dmm',
      modelProfileVersion: 3,
    });
  });
});

describe('MATH-10A2 multimeter DC current', () => {
  function currentCircuit(directlyAcrossSource = false): ElectronicsDocument {
    const source = component('battery', 'source', 3, {
      componentTypeId: 'battery-holder-aa-2',
      pinIds: ['BAT-', 'BAT+'],
    });
    const meter = component('meter', 'visual', 0, {
      componentTypeId: 'multimeter',
      pinIds: ['com', 'v-ohm-ma'],
      stateProperties: { measurementMode: 'dc-current', meterRange: '400ma' },
    });
    const resistor = component('load', 'resistor', 100, {
      componentTypeId: 'resistor-axial',
      pinIds: ['lead-1', 'lead-2'],
    });
    return directlyAcrossSource
      ? doc(
          [source, meter],
          [
            connect('red', 'battery', 'BAT+', 'meter', 'v-ohm-ma'),
            connect('black', 'meter', 'com', 'battery', 'BAT-'),
          ],
        )
      : doc(
          [source, resistor, meter],
          [
            connect('supply', 'battery', 'BAT+', 'load', 'lead-1'),
            connect('series', 'load', 'lead-2', 'meter', 'v-ohm-ma'),
            connect('return', 'meter', 'com', 'battery', 'BAT-'),
          ],
        );
  }

  it('measures series current and includes its burden voltage in the circuit', () => {
    const result = solveCircuit(currentCircuit(), { simulationTimeMs: 1 });
    const meter = result.components.find((entry) => entry.componentId === 'meter');
    expect(result.status).toBe('solved');
    expect(meter).toMatchObject({
      measurementMode: 'dc-current',
      measurementUnit: 'A',
      meterShuntResistanceOhm: 1.8,
      meterFuseRatingAmp: 0.44,
      meterFuseState: 'intact',
      meterOverload: false,
    });
    expect(meter?.measuredValue).toBeCloseTo(3 / (0.45 + 100 + 1.8), 8);
    expect(meter?.meterBurdenVoltageVolt).toBeCloseTo((meter?.measuredValue ?? 0) * 1.8, 8);
  });

  it('opens the fuse after a sustained direct connection across a source', () => {
    const result = solveCircuit(currentCircuit(true), { simulationTimeMs: 100 });
    const meter = result.components.find((entry) => entry.componentId === 'meter');
    expect(result.status).toBe('solved');
    expect(meter).toMatchObject({
      measurementMode: 'dc-current',
      meterFuseState: 'blown',
      meterOverload: true,
    });
    expect(Math.abs(meter?.current ?? 1)).toBeLessThan(1e-9);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'multimeter_fuse_blown' })]),
    );
    expect(result.transientState?.multimeterFuses?.[0]).toMatchObject({
      componentId: 'meter',
      fuseState: 'blown',
    });
  });
});

describe('photoresistor electrical model', () => {
  it('uses a deterministic versioned GL5528-class illumination profile', () => {
    expect(JSON.parse(canonicalPhotoresistorProfileRegistry())).toEqual({
      registryVersion: 1,
      profiles: [PHOTORESISTOR_PROFILE],
    });
    expect(PHOTORESISTOR_PROFILE.resistanceAt10LuxOhm).toBe(15_000);
    expect(PHOTORESISTOR_PROFILE.gamma).toBe(0.7);
    expect(PHOTORESISTOR_PROFILE.profileVersion).toBe(2);
    expect(
      electricalModelIdentityForComponent(
        component('legacy-ldr', 'photoresistor', 15_000, {
          componentTypeId: 'photoresistor',
          electricalModelId: 'photoresistor',
          electricalModelVersion: 1,
          modelProfileId: 'generic-photoresistor',
          modelProfileVersion: 1,
        }),
      ),
    ).toMatchObject({
      electricalModelId: 'photoresistor',
      modelProfileId: 'generic-photoresistor',
      modelProfileVersion: 2,
    });
  });

  it('maps the logarithmic light control monotonically to finite lux and resistance', () => {
    const ldr = component('ldr', 'photoresistor', 0);
    expect(photoresistorResistanceOhm({ ...ldr, stateProperties: { illumination: 0 } })).toBe(
      PHOTORESISTOR_DARK_RESISTANCE_OHM,
    );
    expect(photoresistorIlluminanceLux({ ...ldr, stateProperties: { illumination: 0 } })).toBe(0);
    expect(photoresistorIlluminanceLux({ ...ldr, stateProperties: { illumination: 1 } })).toBe(
      PHOTORESISTOR_PROFILE.maximumIlluminanceLux,
    );
    expect(
      photoresistorResistanceOhm({ ...ldr, stateProperties: { illumination: 1 } }),
    ).toBeCloseTo(PHOTORESISTOR_BRIGHT_RESISTANCE_OHM, 10);
    const midpoint = photoresistorResistanceOhm({
      ...ldr,
      stateProperties: { illumination: 0.5 },
    });
    expect(Number.isFinite(midpoint)).toBe(true);
    expect(midpoint).toBeLessThan(PHOTORESISTOR_DARK_RESISTANCE_OHM);
    expect(midpoint).toBeGreaterThan(PHOTORESISTOR_BRIGHT_RESISTANCE_OHM);
    const midpointLux = photoresistorIlluminanceLux({
      ...ldr,
      stateProperties: { illumination: 0.5 },
    });
    expect(midpointLux).toBeGreaterThan(30);
    expect(midpointLux).toBeLessThan(32);
  });

  it('matches the profile reference curve at 10, 100 and 1000 lux', () => {
    expect(photoresistorResistanceAtIlluminanceOhm(10)).toBe(15_000);
    expect(photoresistorResistanceAtIlluminanceOhm(100)).toBeCloseTo(2_992.893, 3);
    expect(photoresistorResistanceAtIlluminanceOhm(1_000)).toBeCloseTo(597.161, 3);
    expect(photoresistorResistanceAtIlluminanceOhm(Number.NaN)).toBe(
      PHOTORESISTOR_DARK_RESISTANCE_OHM,
    );
    expect(photoresistorResistanceAtIlluminanceOhm(Number.POSITIVE_INFINITY)).toBe(
      PHOTORESISTOR_DARK_RESISTANCE_OHM,
    );
  });

  it('increases circuit current when illumination increases', () => {
    const dark = resultFor(
      series([component('ldr', 'photoresistor', 0, { stateProperties: { illumination: 0 } })]),
      'ldr',
    );
    const bright = resultFor(
      series([component('ldr', 'photoresistor', 0, { stateProperties: { illumination: 1 } })]),
      'ldr',
    );
    expect(dark?.current).toBeCloseTo(5 / PHOTORESISTOR_DARK_RESISTANCE_OHM, 12);
    expect(bright?.current).toBeCloseTo(5 / PHOTORESISTOR_BRIGHT_RESISTANCE_OHM, 8);
    expect(Math.abs(bright?.current ?? 0)).toBeGreaterThan(Math.abs(dark?.current ?? 0));
  });
});

describe('netlist', () => {
  it('merges every ideal wire endpoint into deterministic nodes', () => {
    const document = doc(
      [component('r1', 'resistor', 100), component('r2', 'resistor', 100)],
      [connect('w1', 'r1', 'b', 'r2', 'a')],
    );
    const netlist = buildNetlist(document);
    expect(netlist.nodeOf.get(terminalKey('r1', 'b'))).toBe(
      netlist.nodeOf.get(terminalKey('r2', 'a')),
    );
  });

  it('persists production variants and joins snapped pins through breadboard groups', () => {
    const parsed = parseElectronicsDocument({
      schemaVersion: 4,
      components: [
        {
          id: 'board',
          kind: 'breadboard',
          componentTypeId: 'breadboard-medium',
          variantId: 'breadboard-medium',
          position: { x: 10, y: 20 },
          value: 0,
          pinIds: ['J1', 'I1'],
          internalConnections: [['J1', 'I1']],
          stateProperties: {},
        },
        {
          id: 'rgb',
          kind: 'rgb-led',
          componentTypeId: 'rgb-led',
          variantId: 'rgb-led',
          position: { x: 30, y: 40 },
          value: 0,
          pinIds: ['red', 'common', 'green', 'blue'],
          stateProperties: {
            red: 20,
            green: 80,
            blue: 55,
            commonMode: 'common-anode',
          },
          holeBindings: { red: { breadboardComponentId: 'board', holeId: 'J1' } },
        },
      ],
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      simulation: { running: false, maxIterations: 24 },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.document.components[1]).toMatchObject({
      componentTypeId: 'rgb-led',
      variantId: 'rgb-led',
      stateProperties: { red: 20, green: 80, blue: 55, commonMode: 'common-anode' },
    });
    const netlist = buildNetlist(parsed.document);
    expect(netlist.nodeOf.get(terminalKey('rgb', 'red'))).toBe(
      netlist.nodeOf.get(terminalKey('board', 'J1')),
    );
    expect(netlist.nodeOf.get(terminalKey('board', 'J1'))).toBe(
      netlist.nodeOf.get(terminalKey('board', 'I1')),
    );
  });

  it('assigns the same canonical node ids regardless of component and wire order', () => {
    const components = [component('source', 'source', 5), component('r1', 'resistor', 100)];
    const connections = [
      connect('positive', 'source', 'a', 'r1', 'a'),
      connect('negative', 'r1', 'b', 'source', 'b'),
    ];
    const forward = buildNetlist(doc(components, connections));
    const reordered = buildNetlist(doc([...components].reverse(), [...connections].reverse()));

    expect([...forward.nodeOf.entries()]).toEqual([...reordered.nodeOf.entries()]);
    expect([...forward.terminalsByNode.entries()]).toEqual([
      ...reordered.terminalsByNode.entries(),
    ]);
  });
});

describe('electrical model registry', () => {
  it('marks owner-visible components without an electrical model as unsupported', () => {
    expect(electricalModelFor(component('sensor', 'visual', 0))).toMatchObject({
      support: 'unsupported',
      topology: 'unsupported',
    });
    expect(electricalModelFor(component('board', 'breadboard', 0))).toMatchObject({
      support: 'infrastructure',
      topology: 'connectivity-only',
    });
    expect(
      electricalModelFor(
        component('q1', 'transistor', 100, {
          componentTypeId: 'transistor-npn',
          pinIds: ['collector', 'base', 'emitter'],
        }),
      ),
    ).toMatchObject({
      id: 'npn-transistor',
      support: 'supported',
      topology: 'three-terminal',
      requiredTerminals: ['base', 'collector', 'emitter'],
    });
    expect(
      electricalModelFor(
        component('uno', 'visual', 5, {
          componentTypeId: 'arduino-uno',
          pinIds: ['d13', 'power-5v', 'power-3v3', 'power-gnd-1'],
        }),
      ),
    ).toMatchObject({
      id: 'arduino-uno',
      support: 'supported',
      topology: 'multi-junction',
    });
  });
});

describe('deterministic DC solver', () => {
  it('runs Arduino Uno by itself and exposes the deterministic first D13 output state', () => {
    const result = solveCircuit(
      doc(
        [
          component('uno', 'visual', 5, {
            componentTypeId: 'arduino-uno',
            pinIds: ['d13', 'power-5v', 'power-3v3', 'power-gnd-1', 'power-gnd-2', 'gnd-top'],
          }),
        ],
        [],
      ),
    );

    expect(result.solved).toBe(true);
    expect(result.status).toBe('solved');
    const uno = result.components.find((item) => item.componentId === 'uno');
    expect(uno).toMatchObject({ energized: true });
    expect(uno?.terminalVoltages.d13).toBeCloseTo(5, 9);
    expect(uno?.terminalVoltages['power-5v']).toBeCloseTo(5, 9);
    expect(uno?.terminalVoltages['power-3v3']).toBeCloseTo(3.3, 9);
    expect(result.diagnostics.map((item) => item.code)).not.toContain('unsupported_component');
  });

  it('models a resistor-less LED on Arduino D13 and reports physical burnout', () => {
    const result = solveCircuit(
      doc(
        [
          component('uno', 'visual', 5, {
            componentTypeId: 'arduino-uno',
            pinIds: ['d13', 'power-5v', 'power-3v3', 'power-gnd-1', 'power-gnd-2', 'gnd-top'],
          }),
          component('led', 'led', 2, {
            componentTypeId: 'led-5mm',
            pinIds: ['anode', 'cathode'],
          }),
        ],
        [
          connect('d13-anode', 'uno', 'd13', 'led', 'anode'),
          connect('cathode-ground', 'led', 'cathode', 'uno', 'gnd-top'),
        ],
      ),
    );

    expect(result.solved).toBe(true);
    expect(result.components.find((item) => item.componentId === 'led')).toMatchObject({
      lit: true,
      stressState: 'burned',
    });
    expect(result.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['led_overcurrent', 'led_burnout']),
    );
  });

  it('turns the D13 LED off when the Arduino program starts with LOW', () => {
    const result = solveCircuit(
      doc(
        [
          component('uno', 'visual', 5, {
            componentTypeId: 'arduino-uno',
            pinIds: ['d13', 'power-5v', 'power-3v3', 'power-gnd-1'],
            stateProperties: { arduinoSource: 'void loop() { digitalWrite(13, LOW); }' },
          }),
          component('led', 'led', 2),
        ],
        [
          connect('d13-anode', 'uno', 'd13', 'led', 'a'),
          connect('cathode-ground', 'led', 'b', 'uno', 'power-gnd-1'),
        ],
      ),
    );

    expect(result.solved).toBe(true);
    expect(result.components.find((item) => item.componentId === 'led')).toMatchObject({
      lit: false,
      current: 0,
    });
  });

  it('fails closed when the document contains an unsupported electrical component', () => {
    const result = solveCircuit(
      doc(
        [
          component('source', 'source', 5),
          component('r1', 'resistor', 1000),
          component('sensor', 'visual', 0, { componentTypeId: 'temperature-sensor' }),
        ],
        [connect('w1', 'source', 'a', 'r1', 'a'), connect('w2', 'r1', 'b', 'source', 'b')],
      ),
    );

    expect(result.solved).toBe(false);
    expect(result.status).toBe('unsupported');
    expect(result.current).toBe(0);
    expect(result.components).toEqual([]);
    expect(result.nodes).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'unsupported_component',
        severity: 'error',
        componentIds: ['sensor'],
        anchors: [{ kind: 'component', id: 'sensor' }],
      }),
    );
  });

  it('keeps a supported LED circuit running when an existing unconnected DC motor is present', () => {
    const result = solveCircuit(
      doc(
        [
          component('source', 'source', 3),
          component('led', 'led', 2, {
            componentTypeId: 'led-5mm',
            pinIds: ['anode', 'cathode'],
          }),
          component('motor', 'visual', 0, {
            componentTypeId: 'dc-motor',
            pinIds: ['negative', 'positive'],
            electricalModelId: 'unsupported',
            electricalModelVersion: 1,
            modelProfileId: 'unsupported-dc-motor',
            modelProfileVersion: 1,
          }),
        ],
        [
          connect('positive', 'source', 'a', 'led', 'anode'),
          connect('negative', 'led', 'cathode', 'source', 'b'),
        ],
      ),
    );

    expect(result.status).toBe('solved');
    expect(result.diagnostics.map((item) => item.code)).not.toContain('unsupported_component');
    expect(result.components.find((item) => item.componentId === 'led')).toMatchObject({
      lit: true,
      stressState: 'burned',
    });
    expect(result.components.find((item) => item.componentId === 'motor')).toMatchObject({
      energized: false,
      speedPercent: 0,
      direction: 'stopped',
    });
  });

  it('advances the owner motor through the shared transient solver', () => {
    const motorDocument = doc(
      [
        component('source', 'source', 6),
        component('motor', 'visual', 6, {
          componentTypeId: 'dc-motor',
          pinIds: ['negative', 'positive'],
        }),
      ],
      [
        connect('positive', 'source', 'a', 'motor', 'positive'),
        connect('negative', 'motor', 'negative', 'source', 'b'),
      ],
    );
    const result = solveCircuit(motorDocument, { simulationTimeMs: 500 });

    expect(result.status).toBe('solved');
    expect(result.components.find((item) => item.componentId === 'motor')).toMatchObject({
      energized: true,
      direction: 'clockwise',
      motorOperatingMode: 'running',
      windingFailureMode: 'none',
    });
    const motor = result.components.find((item) => item.componentId === 'motor');
    expect(motor?.voltageDrop).toBeCloseTo(6, 9);
    expect(motor?.current).toBeCloseTo(0.0718, 3);
    expect(motor?.motorRpm).toBeCloseTo(11_471.7, 0);
    expect(motor?.motorAngularPhaseRadian).toBeGreaterThanOrEqual(0);
    expect(motor?.motorAngularPhaseRadian).toBeLessThan(2 * Math.PI);
    expect(result.transientState?.motors).toHaveLength(1);
    expect(result.transientAnalysis).toMatchObject({
      acceptedSteps: 500,
      rejectedSteps: 0,
      minStepMs: 1,
      maxStepMs: 1,
    });
  });

  it('advances the confirmed 1:48 gearmotor and reports its output shaft separately', () => {
    const gearmotorDocument = doc(
      [
        component('source', 'source', 6),
        component('gearmotor', 'visual', 6, {
          componentTypeId: 'gearmotor',
          pinIds: ['negative', 'positive'],
          stateProperties: { motorAssemblyProfileId: 'adafruit-3777-tt-48to1' },
        }),
      ],
      [
        connect('positive', 'source', 'a', 'gearmotor', 'positive'),
        connect('negative', 'gearmotor', 'negative', 'source', 'b'),
      ],
    );
    const result = solveCircuit(gearmotorDocument, { simulationTimeMs: 500 });
    const gearmotor = result.components.find((item) => item.componentId === 'gearmotor');

    expect(result.status).toBe('solved');
    expect(gearmotor).toMatchObject({
      energized: true,
      direction: 'clockwise',
      motorOperatingMode: 'running',
      windingFailureMode: 'none',
      operatingVoltageMinVolt: 3,
      operatingVoltageMaxVolt: 6,
    });
    expect(gearmotor?.motorRpm).toBeGreaterThan(0);
    expect(gearmotor?.outputRpm).toBeGreaterThan(0);
    expect((gearmotor?.motorRpm ?? 0) / (gearmotor?.outputRpm ?? 1)).toBeCloseTo(48, 3);
    expect(gearmotor?.outputMechanicalPowerWatt).toBeLessThanOrEqual(
      gearmotor?.motorMechanicalPowerWatt ?? 0,
    );
    expect(gearmotor?.transmissionEfficiency).toBeGreaterThan(0);
    expect(result.transientState?.motors).toHaveLength(1);
  });

  it('treats 12 V as destructive for the confirmed 3-6 V gearmotor profile', () => {
    const gearmotorDocument = doc(
      [
        component('source', 'source', 12),
        component('gearmotor', 'visual', 6, {
          componentTypeId: 'gearmotor',
          pinIds: ['negative', 'positive'],
          stateProperties: { motorAssemblyProfileId: 'adafruit-3777-tt-48to1' },
        }),
      ],
      [
        connect('positive', 'source', 'a', 'gearmotor', 'positive'),
        connect('negative', 'gearmotor', 'negative', 'source', 'b'),
      ],
    );
    const firstSecond = solveCircuit(gearmotorDocument, { simulationTimeMs: 1_000 });
    const running = firstSecond.components.find((item) => item.componentId === 'gearmotor');

    expect(running).toMatchObject({
      operatingVoltageMinVolt: 3,
      operatingVoltageMaxVolt: 6,
      motorVoltageState: 'overvoltage',
      windingFailureMode: 'none',
    });
    expect(running?.accumulatedDamagePercent).toBeGreaterThan(0);
    expect(running?.temperatureCelsius).toBeLessThan(90);
    expect(firstSecond.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'motor_overvoltage',
        componentIds: ['gearmotor'],
        suggestedAction: expect.stringContaining('рассчитан на 3–6 В'),
      }),
    );

    let failed = firstSecond;
    for (let simulationTimeMs = 2_000; simulationTimeMs <= 20_000; simulationTimeMs += 1_000) {
      if (!failed.transientState) throw new Error('gearmotor transient state missing');
      failed = solveCircuit(gearmotorDocument, {
        simulationTimeMs,
        transientState: failed.transientState,
      });
      if (
        failed.components.find((item) => item.componentId === 'gearmotor')?.windingFailureMode ===
        'winding_open'
      ) {
        break;
      }
    }
    expect(failed.components.find((item) => item.componentId === 'gearmotor')).toMatchObject({
      current: 0,
      motorVoltageState: 'overvoltage',
      windingFailureMode: 'winding_open',
      stressState: 'burned',
      deviceHealth: 'failed_open',
      damageState: 'failed',
      presentationState: 'failed',
    });
  });

  it('marks a 23 V unloaded motor as destructive overvoltage instead of healthy', () => {
    const motorDocument = doc(
      [
        component('source', 'source', 23),
        component('motor', 'visual', 6, {
          componentTypeId: 'dc-motor',
          pinIds: ['negative', 'positive'],
        }),
      ],
      [
        connect('positive', 'source', 'a', 'motor', 'positive'),
        connect('negative', 'motor', 'negative', 'source', 'b'),
      ],
    );
    const result = solveCircuit(motorDocument, { simulationTimeMs: 500 });
    const motor = result.components.find((item) => item.componentId === 'motor');

    expect(result.status).toBe('solved');
    expect(motor).toMatchObject({
      operatingVoltageMinVolt: 3,
      operatingVoltageMaxVolt: 12,
      motorVoltageState: 'overvoltage',
      stressState: 'overvoltage',
      deviceHealth: 'overvoltage',
      damageState: 'destructive_preview',
      presentationState: 'destructive',
      windingFailureMode: 'none',
    });
    expect(motor?.temperatureCelsius).toBeLessThan(90);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'motor_overvoltage',
        severity: 'error',
        componentIds: ['motor'],
      }),
    );

    const afterFourSeconds = solveCircuit(motorDocument, { simulationTimeMs: 4_000 });
    if (!afterFourSeconds.transientState) throw new Error('motor transient state missing at 4 s');
    const afterEightSeconds = solveCircuit(motorDocument, {
      simulationTimeMs: 8_000,
      transientState: afterFourSeconds.transientState,
    });
    if (!afterEightSeconds.transientState) throw new Error('motor transient state missing at 8 s');
    const afterTwelveSeconds = solveCircuit(motorDocument, {
      simulationTimeMs: 12_000,
      transientState: afterEightSeconds.transientState,
    });
    if (!afterTwelveSeconds.transientState)
      throw new Error('motor transient state missing at 12 s');
    const failed = solveCircuit(motorDocument, {
      simulationTimeMs: 13_000,
      transientState: afterTwelveSeconds.transientState,
    });
    const failedMotor = failed.components.find((item) => item.componentId === 'motor');
    expect(failedMotor).toMatchObject({
      voltageDrop: -23,
      current: 0,
      motorVoltageState: 'overvoltage',
      windingFailureMode: 'winding_open',
      stressState: 'burned',
      deviceHealth: 'failed_open',
      damageState: 'failed',
      presentationState: 'failed',
    });
    expect(failed.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'motor_overvoltage',
        severity: 'error',
        componentIds: ['motor'],
      }),
    );
  });

  it('reports signed reverse RPM and carries rotor coast after power is removed', () => {
    const direct = doc(
      [
        component('source', 'source', 6),
        component('motor', 'visual', 6, {
          componentTypeId: 'dc-motor',
          pinIds: ['negative', 'positive'],
        }),
      ],
      [
        connect('positive', 'source', 'a', 'motor', 'positive'),
        connect('negative', 'motor', 'negative', 'source', 'b'),
      ],
    );
    const reverse = doc(Array.from(direct.components), [
      connect('reverse-positive', 'source', 'a', 'motor', 'negative'),
      connect('reverse-negative', 'motor', 'positive', 'source', 'b'),
    ]);
    const reversed = solveCircuit(reverse, { simulationTimeMs: 500 });
    expect(reversed.components.find((item) => item.componentId === 'motor')).toMatchObject({
      direction: 'counterclockwise',
    });
    expect(reversed.components.find((item) => item.componentId === 'motor')?.motorRpm).toBeLessThan(
      -11_000,
    );

    const accelerated = solveCircuit(direct, { simulationTimeMs: 500 });
    if (!accelerated.transientState) throw new Error('motor transient state missing');
    const disconnected = doc(Array.from(direct.components), []);
    const coasting = solveCircuit(disconnected, {
      simulationTimeMs: 600,
      transientState: accelerated.transientState,
    });
    const coastingMotor = coasting.components.find((item) => item.componentId === 'motor');
    expect(coastingMotor).toMatchObject({
      direction: 'clockwise',
      motorOperatingMode: 'coasting',
    });
    expect(coastingMotor?.motorRpm).toBeGreaterThan(0);
    expect(coastingMotor?.motorRpm).toBeLessThan(11_472);
  });

  it('fails before matrix assembly when a production component has an incomplete pin map', () => {
    const result = solveCircuit(
      doc(
        [
          component('source', 'source', 3, {
            componentTypeId: 'battery-holder-aa-2',
            pinIds: ['BAT+'],
          }),
        ],
        [],
      ),
    );

    expect(result.status).toBe('invalid');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'invalid_terminal_contract',
        componentIds: ['source'],
      }),
    );
  });

  it('solves parallel sources through their finite internal resistance', () => {
    const result = solveCircuit(
      doc(
        [
          component('source-5v', 'source', 5, {
            stateProperties: { internalResistanceOhm: 0.2 },
          }),
          component('source-9v', 'source', 9, {
            stateProperties: { internalResistanceOhm: 0.2 },
          }),
          component('load', 'resistor', 1000),
        ],
        [
          connect('p1', 'source-5v', 'a', 'load', 'a'),
          connect('n1', 'source-5v', 'b', 'load', 'b'),
          connect('p2', 'source-9v', 'a', 'load', 'a'),
          connect('n2', 'source-9v', 'b', 'load', 'b'),
        ],
      ),
    );

    expect(result.solved).toBe(true);
    expect(result.status).toBe('solved');
    expect(result.components.find((item) => item.componentId === 'source-5v')).toMatchObject({
      deviceHealth: 'overheated',
      damageState: 'destructive_preview',
      presentationState: 'destructive',
    });
    expect(result.diagnostics.map((item) => item.code)).toContain('source_overload');
    expect(result.components.every((item) => Number.isFinite(item.current))).toBe(true);
  });

  it('adds finite source voltages in series with declared polarity', () => {
    const source = (id: string): SchematicComponent =>
      component(id, 'source', 3, {
        componentTypeId: 'battery-holder-aa-2',
        pinIds: ['BAT-', 'BAT+'],
      });
    const result = solveCircuit(
      doc(
        [source('source-a'), source('source-b'), component('load', 'resistor', 100)],
        [
          connect('load-in', 'source-a', 'BAT+', 'load', 'a'),
          connect('load-out', 'load', 'b', 'source-b', 'BAT-'),
          connect('series-link', 'source-b', 'BAT+', 'source-a', 'BAT-'),
        ],
      ),
    );

    expect(result.status).toBe('solved');
    expect(result.components.find((item) => item.componentId === 'load')?.current).toBeCloseTo(
      6 / 100.9,
      9,
    );
    for (const sourceId of ['source-a', 'source-b']) {
      expect(result.components.find((item) => item.componentId === sourceId)).toMatchObject({
        sourceOperatingMode: 'delivering',
        deviceHealth: 'normal',
      });
    }
    expect(result.diagnostics.map((item) => item.code)).not.toContain('conflicting_sources');
  });

  it('models an opposing source as absorbing current and anchors the conflict to its island', () => {
    const sourceA = component('source-a', 'source', 3, {
      componentTypeId: 'battery-holder-aa-2',
      pinIds: ['BAT-', 'BAT+'],
    });
    const sourceB = component('source-b', 'source', 1.5, {
      componentTypeId: 'battery-holder-aa-1',
      pinIds: ['BAT-', 'BAT+'],
    });
    const unrelated = component('unrelated', 'source', 3, {
      componentTypeId: 'battery-holder-aa-2',
      pinIds: ['BAT-', 'BAT+'],
    });
    const result = solveCircuit(
      doc(
        [sourceB, unrelated, component('load', 'resistor', 100), sourceA],
        [
          connect('load-in', 'source-a', 'BAT+', 'load', 'a'),
          connect('load-out', 'load', 'b', 'source-b', 'BAT+'),
          connect('opposing-link', 'source-b', 'BAT-', 'source-a', 'BAT-'),
        ],
      ),
    );

    expect(result.status).toBe('solved');
    expect(result.components.find((item) => item.componentId === 'load')?.current).toBeCloseTo(
      1.5 / 100.675,
      9,
    );
    expect(result.components.find((item) => item.componentId === 'source-a')).toMatchObject({
      sourceOperatingMode: 'delivering',
    });
    expect(result.components.find((item) => item.componentId === 'source-b')).toMatchObject({
      sourceOperatingMode: 'absorbing',
    });
    expect(result.components.find((item) => item.componentId === 'unrelated')).toMatchObject({
      current: 0,
      sourceOperatingMode: 'idle',
    });
    expect(result.diagnostics.find((item) => item.code === 'conflicting_sources')).toMatchObject({
      severity: 'warning',
      componentIds: ['source-a', 'source-b'],
    });
  });

  it('shares a load between equal parallel sources without a false conflict', () => {
    const source = (id: string): SchematicComponent =>
      component(id, 'source', 3, {
        componentTypeId: 'battery-holder-aa-2',
        pinIds: ['BAT-', 'BAT+'],
      });
    const result = solveCircuit(
      doc(
        [source('source-a'), source('source-b'), component('load', 'resistor', 29.775)],
        [
          connect('a-positive', 'source-a', 'BAT+', 'load', 'a'),
          connect('a-negative', 'source-a', 'BAT-', 'load', 'b'),
          connect('b-positive', 'source-b', 'BAT+', 'load', 'a'),
          connect('b-negative', 'source-b', 'BAT-', 'load', 'b'),
        ],
      ),
    );

    expect(result.status).toBe('solved');
    expect(result.components.find((item) => item.componentId === 'load')?.current).toBeCloseTo(
      0.1,
      9,
    );
    for (const sourceId of ['source-a', 'source-b']) {
      const sourceResult = result.components.find((item) => item.componentId === sourceId);
      expect(sourceResult).toMatchObject({
        sourceOperatingMode: 'delivering',
        stressState: 'normal',
      });
      expect(sourceResult?.current).toBeCloseTo(0.05, 9);
    }
    expect(result.diagnostics.map((item) => item.code)).not.toContain('conflicting_sources');
  });

  it('calculates loaded AA-holder voltage from cell internal resistance', () => {
    const battery = component('battery', 'source', 3, {
      componentTypeId: 'battery-holder-aa-2',
      pinIds: ['BAT-', 'BAT+'],
    });
    const load = component('load', 'resistor', 29.55);
    const result = solveCircuit(
      doc(
        [battery, load],
        [
          connect('positive', 'battery', 'BAT+', 'load', 'a'),
          connect('negative', 'load', 'b', 'battery', 'BAT-'),
        ],
      ),
    );
    const sourceResult = result.components.find((item) => item.componentId === 'battery');

    expect(result.status).toBe('solved');
    expect(sourceResult).toMatchObject({
      internalResistanceOhm: 0.45,
      internalPower: 0.0045,
      stressState: 'normal',
    });
    expect(sourceResult?.current).toBeCloseTo(0.1, 9);
    expect(sourceResult?.voltageDrop).toBeCloseTo(2.955, 9);
    expect(sourceResult?.voltageSag).toBeCloseTo(0.045, 9);
  });

  it('anchors a short circuit only to the overloaded source among independent circuits', () => {
    const source = (id: string): SchematicComponent =>
      component(id, 'source', 3, {
        componentTypeId: 'battery-holder-aa-2',
        pinIds: ['BAT-', 'BAT+'],
      });
    const result = solveCircuit(
      doc(
        [
          source('shorted-source'),
          source('loaded-source'),
          source('open-source'),
          component('load', 'resistor', 220, {
            componentTypeId: 'resistor-axial',
            pinIds: ['lead-1', 'lead-2'],
          }),
        ],
        [
          connect('short', 'shorted-source', 'BAT+', 'shorted-source', 'BAT-'),
          connect('loaded-positive', 'loaded-source', 'BAT+', 'load', 'lead-1'),
          connect('loaded-negative', 'load', 'lead-2', 'loaded-source', 'BAT-'),
        ],
      ),
    );

    expect(result.status).toBe('solved');
    const shortDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'short_circuit',
    );
    expect(shortDiagnostics.length).toBeGreaterThan(0);
    expect(shortDiagnostics.every((diagnostic) => diagnostic.componentIds?.length === 1)).toBe(
      true,
    );
    expect(
      shortDiagnostics.every((diagnostic) => diagnostic.componentIds?.[0] === 'shorted-source'),
    ).toBe(true);
    expect(result.components.find((item) => item.componentId === 'shorted-source')).toMatchObject({
      deviceHealth: 'overheated',
      damageState: 'destructive_preview',
      presentationState: 'destructive',
    });
    expect(result.components.find((item) => item.componentId === 'loaded-source')).toMatchObject({
      deviceHealth: 'normal',
      damageState: 'none',
      presentationState: 'normal',
    });
    expect(result.components.find((item) => item.componentId === 'open-source')).toMatchObject({
      current: 0,
      deviceHealth: 'normal',
      damageState: 'none',
      presentationState: 'normal',
    });
    const damagingDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.severity === 'error' || diagnostic.severity === 'warning',
    );
    expect(
      damagingDiagnostics.every(
        (diagnostic) =>
          !diagnostic.componentIds?.includes('loaded-source') &&
          !diagnostic.componentIds?.includes('open-source'),
      ),
    ).toBe(true);
  });

  it('uses the CR2032 source profile under load', () => {
    const battery = component('battery', 'source', 3, {
      componentTypeId: 'battery-3v',
      pinIds: ['negative', 'positive'],
    });
    const load = component('load', 'resistor', 987);
    const result = solveCircuit(
      doc(
        [battery, load],
        [
          connect('positive', 'battery', 'positive', 'load', 'a'),
          connect('negative', 'load', 'b', 'battery', 'negative'),
        ],
      ),
    );
    const sourceResult = result.components.find((item) => item.componentId === 'battery');

    expect(result.status).toBe('solved');
    expect(sourceResult).toMatchObject({
      internalResistanceOhm: 13,
      internalPower: 0.000117,
      stressState: 'warning',
    });
    expect(sourceResult?.current).toBeCloseTo(0.003, 9);
    expect(sourceResult?.voltageDrop).toBeCloseTo(2.961, 9);
    expect(sourceResult?.voltageSag).toBeCloseTo(0.039, 9);
  });

  it('reports a bounded numerical residual for a solved circuit', () => {
    const result = solveCircuit(
      series([component('r1', 'resistor', 220), component('led1', 'led', 2)], 5),
    );
    expect(result.status).toBe('solved');
    expect(result.numericalResidual).toBeLessThanOrEqual(result.numericalTolerance);
  });
  it('applies Ohm law', () => {
    const result = solveCircuit(series([component('r1', 'resistor', 1000)], 5));
    expect(result.solved).toBe(true);
    expect(result.current).toBeCloseTo(0.005, 6);
    expect(
      resultFor(series([component('r1', 'resistor', 1000)], 5), 'r1')?.voltageDrop,
    ).toBeCloseTo(5, 6);
  });

  it('solves series resistors', () => {
    const result = solveCircuit(
      series([component('r1', 'resistor', 100), component('r2', 'resistor', 200)], 6),
    );
    expect(result.current).toBeCloseTo(0.02, 6);
    expect(result.components.find((item) => item.componentId === 'r2')?.voltageDrop).toBeCloseTo(
      4,
      6,
    );
  });

  it('solves two parallel resistive branches', () => {
    const document = doc(
      [
        component('source', 'source', 6),
        component('r1', 'resistor', 300),
        component('r2', 'resistor', 600),
      ],
      [
        connect('w1', 'source', 'a', 'r1', 'a'),
        connect('w2', 'source', 'a', 'r2', 'a'),
        connect('w3', 'r1', 'b', 'source', 'b'),
        connect('w4', 'r2', 'b', 'source', 'b'),
      ],
    );
    const result = solveCircuit(document);
    expect(result.solved).toBe(true);
    expect(result.current).toBeCloseTo(0.03, 6);
    expect(result.components.find((item) => item.componentId === 'r1')?.current).toBeCloseTo(
      0.02,
      6,
    );
    expect(result.components.find((item) => item.componentId === 'r2')?.current).toBeCloseTo(
      0.01,
      6,
    );
    const sourcePower = result.components.find((item) => item.componentId === 'source')?.power ?? 0;
    const loadPower = result.components
      .filter((item) => item.componentId !== 'source')
      .reduce((sum, item) => sum + (item.power ?? 0), 0);
    expect(loadPower).toBeCloseTo(sourcePower, 9);
  });

  it('reports the midpoint voltage of a divider', () => {
    const document = series(
      [component('r1', 'resistor', 1000), component('r2', 'resistor', 1000)],
      10,
    );
    const r1 = resultFor(document, 'r1');
    expect(r1?.terminalVoltages.b).toBeCloseTo(5, 5);
  });

  it('opens and closes a switch', () => {
    const open = solveCircuit(
      series([component('s1', 'switch', 0, { state: false }), component('r1', 'resistor', 100)], 5),
    );
    const closed = solveCircuit(
      series([component('s1', 'switch', 0, { state: true }), component('r1', 'resistor', 100)], 5),
    );
    expect(open.current).toBe(0);
    expect(open.diagnostics.map((item) => item.code)).not.toContain('open_circuit');
    expect(open.diagnostics.map((item) => item.code)).toContain('circuit_ok');
    expect(closed.current).toBeCloseTo(0.05, 4);
  });

  it('models a Tinkercad-compatible zero-ohm resistor as a closed finite branch', () => {
    const result = solveCircuit(series([component('r1', 'resistor', 0)], 5));
    const resistor = result.components.find((item) => item.componentId === 'r1');

    expect(result).toMatchObject({ solved: true, status: 'solved' });
    expect(result.diagnostics.map((item) => item.code)).not.toContain('invalid_property');
    expect(resistor?.current).toBeGreaterThan(1_000);
    expect(Number.isFinite(resistor?.current)).toBe(true);
  });

  it('models a normally-open button', () => {
    const released = solveCircuit(
      series([component('b1', 'button', 0, { state: false }), component('r1', 'resistor', 200)], 5),
    );
    const pressed = solveCircuit(
      series([component('b1', 'button', 0, { state: true }), component('r1', 'resistor', 200)], 5),
    );
    expect(released.current).toBe(0);
    expect(pressed.current).toBeCloseTo(0.025, 5);
  });

  it('models all four physical button pins as two permanent sides and one momentary bridge', () => {
    const button = component('button', 'button', 0, {
      componentTypeId: 'button-tactile-6mm',
      pinIds: ['SW-A1', 'SW-A2', 'SW-B1', 'SW-B2'],
      internalConnections: [
        ['SW-A1', 'SW-A2'],
        ['SW-B1', 'SW-B2'],
      ],
    });
    const circuit = (pressed: boolean) =>
      doc(
        [
          component('source', 'source', 5),
          { ...button, state: pressed },
          component('r1', 'resistor', 200),
        ],
        [
          connect('w1', 'source', 'a', 'button', 'SW-A2'),
          connect('w2', 'button', 'SW-B2', 'r1', 'a'),
          connect('w3', 'r1', 'b', 'source', 'b'),
        ],
      );

    expect(solveCircuit(circuit(false)).current).toBe(0);
    expect(solveCircuit(circuit(true)).current).toBeCloseTo(0.025, 5);
  });

  it('lights an LED only while the physical four-pin button is pressed', () => {
    const circuit = (pressed: boolean) =>
      doc(
        [
          component('source', 'source', 3),
          component('button', 'button', 0, {
            componentTypeId: 'button-tactile-6mm',
            pinIds: ['SW-A1', 'SW-A2', 'SW-B1', 'SW-B2'],
            internalConnections: [
              ['SW-A1', 'SW-A2'],
              ['SW-B1', 'SW-B2'],
            ],
            state: pressed,
          }),
          component('resistor', 'resistor', 220, {
            componentTypeId: 'resistor-axial',
            pinIds: ['lead-1', 'lead-2'],
          }),
          component('led', 'led', 2, {
            componentTypeId: 'led-5mm',
            pinIds: ['anode', 'cathode'],
            stateProperties: { ledColour: 'red' },
          }),
        ],
        [
          connect('source-button', 'source', 'a', 'button', 'SW-A2'),
          connect('button-resistor', 'button', 'SW-B2', 'resistor', 'lead-1'),
          connect('resistor-led', 'resistor', 'lead-2', 'led', 'anode'),
          connect('led-return', 'led', 'cathode', 'source', 'b'),
        ],
      );

    expect(resultFor(circuit(false), 'led')).toMatchObject({ lit: false, current: 0 });
    expect(resultFor(circuit(true), 'led')).toMatchObject({ lit: true });
  });

  it.each([47.3, 137.42, 681.9, 2_200.5])(
    'keeps a physical button momentary for an arbitrary %s ohm LED branch',
    (resistance) => {
      const circuit = (pressed: boolean) =>
        doc(
          [
            component('source', 'source', 5),
            component('button', 'button', 0, {
              componentTypeId: 'button-tactile-6mm',
              pinIds: ['SW-A1', 'SW-A2', 'SW-B1', 'SW-B2'],
              internalConnections: [
                ['SW-A1', 'SW-A2'],
                ['SW-B1', 'SW-B2'],
              ],
              state: pressed,
            }),
            component('resistor', 'resistor', resistance, {
              componentTypeId: 'resistor-axial',
              pinIds: ['lead-1', 'lead-2'],
            }),
            component('led', 'led', 2, {
              componentTypeId: 'led-5mm',
              pinIds: ['anode', 'cathode'],
              stateProperties: { ledColour: 'green' },
            }),
          ],
          [
            connect('source-button', 'source', 'a', 'button', 'SW-A2'),
            connect('button-resistor', 'button', 'SW-B2', 'resistor', 'lead-1'),
            connect('resistor-led', 'resistor', 'lead-2', 'led', 'anode'),
            connect('led-return', 'led', 'cathode', 'source', 'b'),
          ],
        );

      const released = resultFor(circuit(false), 'led');
      const pressed = resultFor(circuit(true), 'led');
      expect(released).toMatchObject({ current: 0, brightness: 0, lit: false });
      expect(pressed?.current).toBeGreaterThan(0);
      expect(pressed?.brightness).toBeGreaterThan(0);
      expect(pressed?.lit).toBe(true);
    },
  );

  it('connects an SPDT common terminal to exactly one selected throw', () => {
    const circuit = (right: boolean) =>
      doc(
        [
          component('source', 'source', 5),
          component('switch', 'switch', 0, {
            componentTypeId: 'switch-spdt',
            pinIds: ['throw-left', 'common', 'throw-right'],
            state: right,
          }),
          component('left-load', 'resistor', 500),
          component('right-load', 'resistor', 1000),
        ],
        [
          connect('source-common', 'source', 'a', 'switch', 'common'),
          connect('left', 'switch', 'throw-left', 'left-load', 'a'),
          connect('left-return', 'left-load', 'b', 'source', 'b'),
          connect('right', 'switch', 'throw-right', 'right-load', 'a'),
          connect('right-return', 'right-load', 'b', 'source', 'b'),
        ],
      );

    expect(solveCircuit(circuit(false)).current).toBeCloseTo(0.01, 5);
    expect(solveCircuit(circuit(true)).current).toBeCloseTo(0.005, 5);
  });

  it('routes an SPDT common pin to exactly one LED branch', () => {
    const circuit = (right: boolean) =>
      doc(
        [
          component('source', 'source', 5),
          component('switch', 'switch', 0, {
            componentTypeId: 'switch-spdt',
            pinIds: ['throw-left', 'common', 'throw-right'],
            state: right,
          }),
          component('left-resistor', 'resistor', 330),
          component('left-led', 'led', 2, { stateProperties: { ledColour: 'red' } }),
          component('right-resistor', 'resistor', 330),
          component('right-led', 'led', 2, { stateProperties: { ledColour: 'green' } }),
        ],
        [
          connect('source-common', 'source', 'a', 'switch', 'common'),
          connect('left-r', 'switch', 'throw-left', 'left-resistor', 'a'),
          connect('left-led', 'left-resistor', 'b', 'left-led', 'a'),
          connect('left-return', 'left-led', 'b', 'source', 'b'),
          connect('right-r', 'switch', 'throw-right', 'right-resistor', 'a'),
          connect('right-led', 'right-resistor', 'b', 'right-led', 'a'),
          connect('right-return', 'right-led', 'b', 'source', 'b'),
        ],
      );

    expect(resultFor(circuit(false), 'left-led')?.lit).toBe(true);
    expect(resultFor(circuit(false), 'right-led')?.lit).toBe(false);
    expect(resultFor(circuit(true), 'left-led')?.lit).toBe(false);
    expect(resultFor(circuit(true), 'right-led')?.lit).toBe(true);
  });

  it.each([73.25, 317.6, 999.9, 4_321.125])(
    'routes exactly one SPDT LED branch with arbitrary %s ohm loads',
    (resistance) => {
      const circuit = (right: boolean) =>
        doc(
          [
            component('source', 'source', 5),
            component('switch', 'switch', 0, {
              componentTypeId: 'switch-spdt',
              pinIds: ['throw-left', 'common', 'throw-right'],
              state: right,
            }),
            component('left-resistor', 'resistor', resistance),
            component('left-led', 'led', 2, { stateProperties: { ledColour: 'red' } }),
            component('right-resistor', 'resistor', resistance),
            component('right-led', 'led', 2, { stateProperties: { ledColour: 'blue' } }),
          ],
          [
            connect('source-common', 'source', 'a', 'switch', 'common'),
            connect('left-r', 'switch', 'throw-left', 'left-resistor', 'a'),
            connect('left-led', 'left-resistor', 'b', 'left-led', 'a'),
            connect('left-return', 'left-led', 'b', 'source', 'b'),
            connect('right-r', 'switch', 'throw-right', 'right-resistor', 'a'),
            connect('right-led', 'right-resistor', 'b', 'right-led', 'a'),
            connect('right-return', 'right-led', 'b', 'source', 'b'),
          ],
        );

      const leftSelected = {
        left: resultFor(circuit(false), 'left-led'),
        right: resultFor(circuit(false), 'right-led'),
      };
      const rightSelected = {
        left: resultFor(circuit(true), 'left-led'),
        right: resultFor(circuit(true), 'right-led'),
      };
      expect(leftSelected.left?.current).toBeGreaterThan(0);
      expect(leftSelected.left?.brightness).toBeGreaterThan(0);
      expect(leftSelected.right).toMatchObject({ current: 0, brightness: 0, lit: false });
      expect(rightSelected.right?.current).toBeGreaterThan(0);
      expect(rightSelected.right?.brightness).toBeGreaterThan(0);
      expect(rightSelected.left).toMatchObject({ current: 0, brightness: 0, lit: false });
    },
  );

  it.each([
    [0, 5],
    [0.5, 2.5],
    [1, 0],
  ])('solves potentiometer wiper position %s', (position, expectedVoltage) => {
    const document = doc(
      [
        component('source', 'source', 5),
        component('pot', 'potentiometer', 1000, { wiperPosition: position }),
      ],
      [connect('w1', 'source', 'a', 'pot', 'a'), connect('w2', 'pot', 'b', 'source', 'b')],
    );
    expect(resultFor(document, 'pot')?.terminalVoltages.wiper).toBeCloseTo(expectedVoltage, 3);
  });

  it('dims a red LED continuously across the usable travel of a 1 kOhm potentiometer', () => {
    const samples = Array.from({ length: 19 }, (_, index) => 0.1 + index * 0.05).map((position) => {
      const document = doc(
        [
          component('battery', 'source', 3, {
            componentTypeId: 'battery-holder-aa-2',
            pinIds: ['BAT-', 'BAT+'],
          }),
          component('led', 'led', 2, {
            componentTypeId: 'led-5mm',
            pinIds: ['anode', 'cathode'],
            stateProperties: { ledColour: 'red' },
          }),
          component('pot', 'potentiometer', 1000, {
            componentTypeId: 'potentiometer',
            pinIds: ['terminal-1', 'wiper', 'terminal-2'],
            wiperPosition: position,
          }),
        ],
        [
          connect('positive', 'battery', 'BAT+', 'led', 'anode'),
          connect('limited', 'led', 'cathode', 'pot', 'terminal-1'),
          connect('return', 'pot', 'wiper', 'battery', 'BAT-'),
        ],
      );
      const result = solveCircuit(document);
      const led = result.components.find((item) => item.componentId === 'led');
      expect(result).toMatchObject({ solved: true, status: 'solved' });
      expect(led?.lit).toBe(true);
      expect(Number.isFinite(led?.current)).toBe(true);
      expect(Number.isFinite(led?.brightness)).toBe(true);
      return led?.brightness ?? 0;
    });

    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeLessThan(samples[index - 1] ?? 0);
      expect((samples[index - 1] ?? 0) - (samples[index] ?? 0)).toBeLessThan(15);
    }
    expect(samples.at(-1)).toBeGreaterThan(20);
  });

  it('conducts a forward diode and treats safe reverse bias as a normal blocking state', () => {
    const forward = solveCircuit(
      series([component('r1', 'resistor', 430), component('d1', 'diode', 0.7)], 5),
    );
    const reverseDocument = doc(
      [
        component('source', 'source', 5),
        component('r1', 'resistor', 430),
        component('d1', 'diode', 0.7),
      ],
      [
        connect('w1', 'source', 'a', 'r1', 'a'),
        connect('w2', 'r1', 'b', 'd1', 'b'),
        connect('w3', 'd1', 'a', 'source', 'b'),
      ],
    );
    const reverse = solveCircuit(reverseDocument);
    expect(forward.current).toBeGreaterThan(0.009);
    expect(reverse.current).toBe(0);
    expect(forward.components.find((item) => item.componentId === 'd1')?.junctionState).toBe(
      'conducting',
    );
    expect(reverse.components.find((item) => item.componentId === 'd1')?.junctionState).toBe(
      'reverse_blocking',
    );
    expect(reverse.diagnostics.map((item) => item.code)).not.toContain('reverse_polarity');
    expect(reverse.diagnostics.map((item) => item.code)).not.toContain('diode_reverse_breakdown');
    expect(reverse.diagnostics.map((item) => item.code)).not.toContain('open_circuit');
    expect(reverse.diagnostics.map((item) => item.code)).toContain('circuit_ok');
  });

  it('uses distinct versioned DO-35 and DO-41 electrical profiles', () => {
    const do35 = nonlinearDcBranchesForComponent(
      component('do35', 'diode', 0.7, { componentTypeId: 'diode-do35' }),
    )[0];
    const do41 = nonlinearDcBranchesForComponent(
      component('do41', 'diode', 0.7, { componentTypeId: 'diode-do41' }),
    )[0];

    expect(do35).toMatchObject({
      nominalCurrentAmp: 0.2,
      repetitivePeakReverseVoltage: 100,
      emitsLight: false,
    });
    expect(do41).toMatchObject({
      nominalCurrentAmp: 1,
      repetitivePeakReverseVoltage: 1000,
      emitsLight: false,
    });
    expect(DIODE_JUNCTION_PROFILES['generic-signal-diode-do35']).not.toEqual(
      DIODE_JUNCTION_PROFILES['generic-rectifier-diode-do41'],
    );
    expect(canonicalNonlinearDcProfileRegistry()).toBe(canonicalNonlinearDcProfileRegistry());
    for (const profile of Object.values(DIODE_JUNCTION_PROFILES)) {
      for (let index = 1; index < profile.forwardSegments.length; index += 1) {
        const previous = profile.forwardSegments[index - 1]!;
        const current = profile.forwardSegments[index]!;
        const boundaryCurrent = current.minimumCurrentAmp;
        expect(previous.kneeVoltage + previous.dynamicResistanceOhm * boundaryCurrent).toBeCloseTo(
          current.kneeVoltage + current.dynamicResistanceOhm * boundaryCurrent,
          10,
        );
      }
    }
  });

  it('reports destructive reverse voltage only for the profile whose limit is exceeded', () => {
    const reverseCircuit = (componentTypeId: 'diode-do35' | 'diode-do41') =>
      doc(
        [
          component('source', 'source', 120),
          component('r1', 'resistor', 100_000),
          component('diode', 'diode', 0.7, {
            componentTypeId,
            pinIds: ['anode', 'cathode'],
          }),
        ],
        [
          connect('positive', 'source', 'a', 'r1', 'a'),
          connect('reverse', 'r1', 'b', 'diode', 'cathode'),
          connect('return', 'diode', 'anode', 'source', 'b'),
        ],
      );

    const do35 = solveCircuit(reverseCircuit('diode-do35'));
    const do41 = solveCircuit(reverseCircuit('diode-do41'));
    expect(do35).toMatchObject({ solved: true, status: 'solved' });
    expect(resultFor(reverseCircuit('diode-do35'), 'diode')).toMatchObject({
      stressState: 'burned',
      deviceHealth: 'reverse_damaged',
      damageState: 'destructive_preview',
      presentationState: 'destructive',
      continuousCurrentLimitAmp: 0.2,
      reverseVoltageLimitVolt: 100,
      junctionState: 'reverse_breakdown',
    });
    expect(do35.diagnostics.map((item) => item.code)).toContain('diode_reverse_breakdown');
    expect(do41.diagnostics.map((item) => item.code)).not.toContain('diode_reverse_breakdown');
  });

  it('solves NPN cutoff, active and saturation regions with real B/C/E currents', () => {
    const transistor = component('q1', 'transistor', 100, {
      componentTypeId: 'transistor-npn',
      pinIds: ['collector', 'base', 'emitter'],
      stateProperties: {
        currentGain: 100,
        baseEmitterVoltage: 0.7,
        saturationVoltage: 0.2,
        maxCollectorCurrent: 0.2,
      },
    });
    const circuit = (baseResistance: number, collectorResistance = 470) =>
      doc(
        [
          component('source', 'source', 5),
          component('rb', 'resistor', baseResistance),
          component('rc', 'resistor', collectorResistance),
          transistor,
        ],
        [
          connect('s-rc', 'source', 'a', 'rc', 'a'),
          connect('rc-c', 'rc', 'b', 'q1', 'collector'),
          connect('s-rb', 'source', 'a', 'rb', 'a'),
          connect('rb-b', 'rb', 'b', 'q1', 'base'),
          connect('e-s', 'q1', 'emitter', 'source', 'b'),
        ],
      );
    const cutoffDocument = doc(
      [
        component('source', 'source', 5),
        component('rb', 'resistor', 10_000),
        component('rc', 'resistor', 470),
        transistor,
      ],
      [
        connect('s-rc', 'source', 'a', 'rc', 'a'),
        connect('rc-c', 'rc', 'b', 'q1', 'collector'),
        connect('b-rb', 'q1', 'base', 'rb', 'a'),
        connect('rb-gnd', 'rb', 'b', 'source', 'b'),
        connect('e-s', 'q1', 'emitter', 'source', 'b'),
      ],
    );

    const cutoff = resultFor(cutoffDocument, 'q1');
    const active = resultFor(circuit(100_000), 'q1');
    const saturation = resultFor(circuit(1_000, 220), 'q1');

    expect(cutoff).toMatchObject({
      operatingRegion: 'cutoff',
      baseCurrent: 0,
      collectorCurrent: 0,
      emitterCurrent: 0,
    });
    expect(active?.operatingRegion).toBe('active');
    expect(active?.baseCurrent ?? 0).toBeGreaterThan(0.00004);
    expect(active?.collectorCurrent ?? 0).toBeGreaterThan((active?.baseCurrent ?? 0) * 100);
    expect(active?.collectorCurrent).toBeCloseTo(
      (active?.baseCurrent ?? 0) * (active?.effectiveCurrentGain ?? 0),
      6,
    );
    expect(active?.effectiveCurrentGain ?? 0).toBeGreaterThan(100);
    expect(active?.earlyVoltage).toBe(100);
    expect(active?.emitterCurrent).toBeCloseTo(
      (active?.baseCurrent ?? 0) + (active?.collectorCurrent ?? 0),
      6,
    );
    expect(active?.terminalVoltages).toMatchObject({ emitter: 0 });
    expect(
      (active?.terminalCurrents?.base ?? 0) +
        (active?.terminalCurrents?.collector ?? 0) +
        (active?.terminalCurrents?.emitter ?? 0),
    ).toBeCloseTo(0, 8);
    expect(saturation?.operatingRegion).toBe('saturation');
    expect(saturation?.voltageDrop ?? 1).toBeGreaterThanOrEqual(0.2);
    expect(saturation?.voltageDrop ?? 1).toBeLessThan(0.25);
    expect(saturation?.collectorCurrent ?? 0).toBeGreaterThan(0.02);
  });

  it('diagnoses unsafe reverse base bias and collector overcurrent', () => {
    const transistor = component('q1', 'transistor', 100, {
      componentTypeId: 'transistor-npn',
      pinIds: ['collector', 'base', 'emitter'],
      stateProperties: { currentGain: 100, maxCollectorCurrent: 0.2 },
    });
    const reverse = solveCircuit(
      doc(
        [component('source', 'source', 9), component('r', 'resistor', 1_000), transistor],
        [
          connect('e-plus', 'source', 'a', 'q1', 'emitter'),
          connect('b-minus', 'q1', 'base', 'source', 'b'),
          connect('c-r', 'q1', 'collector', 'r', 'a'),
          connect('r-minus', 'r', 'b', 'source', 'b'),
        ],
      ),
    );
    const overloaded = solveCircuit(
      doc(
        [
          component('source', 'source', 5),
          component('rb', 'resistor', 100),
          component('rc', 'resistor', 10),
          transistor,
        ],
        [
          connect('s-rc', 'source', 'a', 'rc', 'a'),
          connect('rc-c', 'rc', 'b', 'q1', 'collector'),
          connect('s-rb', 'source', 'a', 'rb', 'a'),
          connect('rb-b', 'rb', 'b', 'q1', 'base'),
          connect('e-s', 'q1', 'emitter', 'source', 'b'),
        ],
      ),
    );
    expect(reverse.diagnostics.map((item) => item.code)).toContain('transistor_reverse_bias');
    expect(overloaded.diagnostics.map((item) => item.code)).toContain('transistor_overcurrent');
    expect(overloaded.components.find((item) => item.componentId === 'q1')).toMatchObject({
      presentationState: 'destructive',
      damageState: 'destructive_preview',
    });
  });

  it('lights an LED at normal current and diagnoses overcurrent', () => {
    const normal = solveCircuit(
      series([component('r1', 'resistor', 300), component('led1', 'led', 2)], 5),
    );
    const unsafe = solveCircuit(
      series([component('r1', 'resistor', 20), component('led1', 'led', 2)], 5),
    );
    expect(normal.components.find((item) => item.componentId === 'led1')?.lit).toBe(true);
    expect(normal.diagnostics.map((item) => item.code)).toContain('circuit_ok');
    expect(unsafe.diagnostics.map((item) => item.code)).toContain('led_overcurrent');
  });

  it('matches safe, overcurrent and destructive ordinary LED operating points', () => {
    const operatingPoint = (resistance: number) =>
      solveCircuit(
        series([component('r1', 'resistor', resistance), component('led', 'led', 2)], 5),
      );
    const safe = operatingPoint(220);
    const overcurrent = operatingPoint(100);
    const burned = operatingPoint(0);
    const ledResult = (result: ReturnType<typeof solveCircuit>) =>
      result.components.find((item) => item.componentId === 'led');

    expect(ledResult(safe)).toMatchObject({
      junctionState: 'conducting',
      continuousCurrentLimitAmp: 0.02,
      destructiveCurrentLimitAmp: 0.12,
      reverseVoltageLimitVolt: 5,
      stressState: 'normal',
      deviceHealth: 'normal',
      damageState: 'none',
      presentationState: 'normal',
    });
    expect(safe.diagnostics.map((item) => item.code)).not.toContain('led_near_limit');
    expect(ledResult(overcurrent)).toMatchObject({
      stressState: 'overcurrent',
      deviceHealth: 'warning',
      damageState: 'destructive_preview',
      presentationState: 'destructive',
    });
    expect(overcurrent.diagnostics.map((item) => item.code)).toContain('led_overcurrent');
    expect(overcurrent.diagnostics.map((item) => item.code)).not.toContain('led_burnout');
    expect(ledResult(burned)).toMatchObject({
      stressState: 'burned',
      deviceHealth: 'overheated',
      damageState: 'destructive_preview',
      presentationState: 'destructive',
    });
    expect(burned.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['led_overcurrent', 'led_burnout']),
    );
    expect(burned.diagnostics.find((item) => item.code === 'led_burnout')?.message).toContain(
      'разрушительный предел',
    );
  });

  it('solves LEDs in series and independent parallel resistor branches', () => {
    const seriesResult = solveCircuit(
      series(
        [
          component('r-series', 'resistor', 220),
          component('led-series-1', 'led', 2),
          component('led-series-2', 'led', 2),
        ],
        5,
      ),
    );
    const parallelDocument = doc(
      [
        component('source', 'source', 5),
        component('r-left', 'resistor', 220),
        component('led-left', 'led', 2),
        component('r-right', 'resistor', 470),
        component('led-right', 'led', 2),
      ],
      [
        connect('left-positive', 'source', 'a', 'r-left', 'a'),
        connect('left-led', 'r-left', 'b', 'led-left', 'a'),
        connect('left-negative', 'led-left', 'b', 'source', 'b'),
        connect('right-positive', 'source', 'a', 'r-right', 'a'),
        connect('right-led', 'r-right', 'b', 'led-right', 'a'),
        connect('right-negative', 'led-right', 'b', 'source', 'b'),
      ],
    );
    const parallelResult = solveCircuit(parallelDocument);
    const seriesLed1 = seriesResult.components.find((item) => item.componentId === 'led-series-1');
    const seriesLed2 = seriesResult.components.find((item) => item.componentId === 'led-series-2');
    const left = parallelResult.components.find((item) => item.componentId === 'led-left');
    const right = parallelResult.components.find((item) => item.componentId === 'led-right');

    expect(seriesLed1?.current).toBeCloseTo(seriesLed2?.current ?? 0, 8);
    expect(seriesLed1?.lit).toBe(true);
    expect(seriesLed2?.lit).toBe(true);
    expect(left?.current ?? 0).toBeGreaterThan(right?.current ?? 0);
    expect(parallelResult.current).toBeCloseTo((left?.current ?? 0) + (right?.current ?? 0), 5);
  });

  it('derives ordinary LED brightness from current and colour-specific forward voltage', () => {
    const red = solveCircuit(
      series(
        [
          component('r1', 'resistor', 220),
          component('led1', 'led', 2, {
            stateProperties: { ledColour: 'red' },
          }),
        ],
        5,
      ),
    );
    const led = red.components.find((item) => item.componentId === 'led1');
    expect(led?.current).toBeGreaterThan(0.012);
    expect(led?.brightness).toBeGreaterThan(70);
    expect(led?.branchBrightness?.led).toBe(led?.brightness);
  });

  it('keeps every ordinary LED colour electrically distinct and brightness continuous', () => {
    expect(ORDINARY_LED_PROFILES.red.kneeVoltage).toBeLessThan(
      ORDINARY_LED_PROFILES.green.kneeVoltage,
    );
    expect(ORDINARY_LED_PROFILES.green.kneeVoltage).toBeLessThan(
      ORDINARY_LED_PROFILES.blue.kneeVoltage,
    );
    const profile = ordinaryLedProfile('red');
    const currents = [0, 1e-9, 1e-7, 1e-5, 1e-4, 1e-3, 5e-3, 1e-2, 2e-2];
    const brightness = currents.map((current) => ledBrightnessPercent(current, profile));

    expect(brightness[0]).toBe(0);
    expect(brightness[1]).toBeGreaterThan(0);
    for (let index = 1; index < brightness.length; index += 1) {
      expect(brightness[index]).toBeGreaterThan(brightness[index - 1] ?? -1);
    }
    expect(brightness.at(-1)).toBe(100);
    for (const ledProfile of Object.values(ORDINARY_LED_PROFILES)) {
      const segments = ledProfile.linearSegments ?? [];
      for (let index = 1; index < segments.length; index += 1) {
        const previous = segments[index - 1]!;
        const current = segments[index]!;
        const boundaryCurrent = current.minimumCurrentAmp;
        expect(previous.kneeVoltage + previous.dynamicResistanceOhm * boundaryCurrent).toBeCloseTo(
          current.kneeVoltage + current.dynamicResistanceOhm * boundaryCurrent,
          10,
        );
      }
    }
  });

  it.each(Object.keys(ORDINARY_LED_PROFILES) as OrdinaryLedColour[])(
    'solves arbitrary decimal resistance values continuously for a %s LED',
    (colour) => {
      const profile = ordinaryLedProfile(colour);
      const resistances = deterministicResistanceSamples(64);
      const samples = resistances.map((resistance) => {
        const document = series(
          [
            component('resistor', 'resistor', resistance),
            component('led', 'led', 2, { stateProperties: { ledColour: colour } }),
          ],
          5,
        );
        const result = solveCircuit(document);
        const resistor = result.components.find((item) => item.componentId === 'resistor');
        const led = result.components.find((item) => item.componentId === 'led');
        const expectedCurrent = ledCurrentForSeriesResistance(5, resistance, profile);
        const expectedBrightness = ledBrightnessPercent(expectedCurrent, profile);

        expect(result).toMatchObject({ solved: true, status: 'solved' });
        expect(Number.isFinite(resistor?.current)).toBe(true);
        expect(Number.isFinite(led?.current)).toBe(true);
        expect(Number.isFinite(led?.brightness)).toBe(true);
        // The matrix includes the solver's closed-contact and GMIN terms. At a
        // literal 0 ohm input their combined numerical contribution remains
        // below 10 microamps, while the owner-observed values are reported to
        // 0.1 mA. Non-zero arbitrary values retain the tighter tolerance.
        const currentTolerance = resistance === 0 ? 1e-5 : 5.1e-7;
        expect(Math.abs((led?.current ?? 0) - expectedCurrent)).toBeLessThanOrEqual(
          currentTolerance,
        );
        expect(Math.abs((resistor?.current ?? 0) - (led?.current ?? 0))).toBeLessThanOrEqual(1e-6);
        expect(led?.brightness).toBeCloseTo(expectedBrightness, 1);
        expect((resistor?.voltageDrop ?? 0) + (led?.voltageDrop ?? 0)).toBeCloseTo(5, 5);
        return { current: led?.current ?? 0, brightness: led?.brightness ?? 0 };
      });

      for (let index = 1; index < samples.length; index += 1) {
        expect(samples[index]?.current).toBeLessThanOrEqual(samples[index - 1]?.current ?? 0);
        expect(samples[index]?.brightness).toBeLessThanOrEqual(samples[index - 1]?.brightness ?? 0);
      }
    },
  );

  it('keeps a 3 V blue LED visibly dim through a 1 kOhm resistor', () => {
    const result = solveCircuit(
      series(
        [
          component('r1', 'resistor', 1000),
          component('led1', 'led', 2, {
            stateProperties: { ledColour: 'blue' },
          }),
        ],
        3,
      ),
    );
    const led = result.components.find((item) => item.componentId === 'led1');

    expect(led?.current).toBeGreaterThan(0.0001);
    expect(led?.current).toBeLessThan(0.001);
    expect(led?.lit).toBe(true);
    expect(led?.brightness).toBeGreaterThan(0);
    expect(led?.brightness).toBeLessThan(20);
  });

  it('keeps a 3 V red LED faintly visible through a 1 kOhm resistor', () => {
    const result = solveCircuit(
      series(
        [
          component('r1', 'resistor', 1000),
          component('led1', 'led', 2, {
            stateProperties: { ledColour: 'red' },
          }),
        ],
        3,
      ),
    );
    const led = result.components.find((item) => item.componentId === 'led1');

    expect(led?.lit).toBe(true);
    expect(led?.brightness).toBeGreaterThan(15);
    expect(led?.brightness).toBeLessThan(35);
  });

  it('drives the owner AA holder and LED pins with real polarity', () => {
    const source = component('battery', 'source', 3, {
      componentTypeId: 'battery-holder-aa-2',
      pinIds: ['BAT-', 'BAT+'],
    });
    const led = component('led', 'led', 2, {
      componentTypeId: 'led-5mm',
      pinIds: ['anode', 'cathode'],
      stateProperties: { ledColour: 'red' },
    });
    const forward = solveCircuit(
      doc(
        [source, led],
        [
          connect('positive', 'battery', 'BAT+', 'led', 'anode'),
          connect('negative', 'led', 'cathode', 'battery', 'BAT-'),
        ],
      ),
    );
    const reverse = solveCircuit(
      doc(
        [source, led],
        [
          connect('negative', 'battery', 'BAT-', 'led', 'anode'),
          connect('positive', 'led', 'cathode', 'battery', 'BAT+'),
        ],
      ),
    );

    expect(forward.components.find((item) => item.componentId === 'led')).toMatchObject({
      lit: true,
      brightness: 100,
    });
    expect(forward.diagnostics.map((item) => item.code)).toContain('led_overcurrent');
    expect(reverse.components.find((item) => item.componentId === 'led')).toMatchObject({
      lit: false,
      brightness: 0,
      junctionState: 'reverse_blocking',
    });
    expect(reverse.diagnostics.map((item) => item.code)).not.toContain('reverse_polarity');
  });

  it.each([
    [1, 1.5],
    [2, 3],
    [3, 4.5],
    [4, 6],
    [6, 9],
    [8, 12],
  ] as const)('applies %d AA cells as a real %.1f V series source', (cells, voltage) => {
    const source = component('battery', 'source', voltage, {
      componentTypeId: `battery-holder-aa-${cells}`,
      pinIds: ['BAT-', 'BAT+'],
      stateProperties: { cells },
    });
    const resistor = component('resistor', 'resistor', 220, {
      componentTypeId: 'resistor-axial',
      pinIds: ['lead-1', 'lead-2'],
      stateProperties: { powerRatingWatt: 0.25 },
    });
    const led = component('led', 'led', 2, {
      componentTypeId: 'led-5mm',
      pinIds: ['anode', 'cathode'],
      stateProperties: { ledColour: 'red' },
    });
    const result = solveCircuit(
      doc(
        [source, resistor, led],
        [
          connect('positive', 'battery', 'BAT+', 'resistor', 'lead-1'),
          connect('limited', 'resistor', 'lead-2', 'led', 'anode'),
          connect('negative', 'led', 'cathode', 'battery', 'BAT-'),
        ],
      ),
    );
    const sourceResult = result.components.find((item) => item.componentId === 'battery');
    const resistorResult = result.components.find((item) => item.componentId === 'resistor');
    const ledResult = result.components.find((item) => item.componentId === 'led');

    expect(result).toMatchObject({ solved: true, status: 'solved' });
    expect(sourceResult?.internalResistanceOhm).toBeCloseTo(cells * 0.225, 9);
    expect((sourceResult?.voltageDrop ?? 0) + (sourceResult?.voltageSag ?? 0)).toBeCloseTo(
      voltage,
      9,
    );
    expect(resistorResult?.current).toBeCloseTo(ledResult?.current ?? 0, 6);
    expect(sourceResult?.current).toBeCloseTo(resistorResult?.current ?? 0, 6);
    expect((resistorResult?.voltageDrop ?? 0) + (ledResult?.voltageDrop ?? 0)).toBeCloseTo(
      sourceResult?.voltageDrop ?? 0,
      6,
    );
  });

  it('reports quarter-watt resistor loading and clears it for a higher rated part', () => {
    const nearLimit = solveCircuit(
      series(
        [
          component('resistor', 'resistor', 220, {
            stateProperties: { powerRatingWatt: 0.25 },
          }),
        ],
        7.2,
      ),
    );
    const overloaded = solveCircuit(
      series(
        [
          component('resistor', 'resistor', 220, {
            stateProperties: { powerRatingWatt: 0.25 },
          }),
        ],
        12,
      ),
    );
    const uprated = solveCircuit(
      series(
        [
          component('resistor', 'resistor', 220, {
            stateProperties: { powerRatingWatt: 1 },
          }),
        ],
        12,
      ),
    );
    const overloadedResistor = overloaded.components.find(
      (item) => item.componentId === 'resistor',
    );
    const nearLimitResistor = nearLimit.components.find((item) => item.componentId === 'resistor');
    const upratedResistor = uprated.components.find((item) => item.componentId === 'resistor');

    expect(nearLimitResistor).toMatchObject({
      stressState: 'warning',
      deviceHealth: 'warning',
      presentationState: 'warning',
    });
    expect(nearLimit.diagnostics.map((item) => item.code)).toContain('resistor_near_limit');
    expect(overloadedResistor?.power).toBeCloseTo(144 / 220, 9);
    expect(overloadedResistor?.powerUtilizationPercent).toBeCloseTo((144 / 220 / 0.25) * 100, 2);
    expect(overloadedResistor).toMatchObject({
      stressState: 'burned',
      deviceHealth: 'overheated',
      damageState: 'destructive_preview',
      presentationState: 'destructive',
    });
    expect(overloaded.diagnostics.map((item) => item.code)).toContain('resistor_overload');
    expect(upratedResistor).toMatchObject({ stressState: 'normal' });
    expect(uprated.diagnostics.map((item) => item.code)).not.toContain('resistor_overload');
  });

  it('solves a complete LED circuit through breadboard contact groups', () => {
    const board = component('board', 'breadboard', 0, {
      componentTypeId: 'breadboard-small',
      pinIds: ['P1', 'P2', 'N1', 'N2', 'J1', 'I1', 'J2', 'I2'],
      internalConnections: [
        ['P1', 'P2'],
        ['N1', 'N2'],
        ['J1', 'I1'],
        ['J2', 'I2'],
      ],
    });
    const source = component('battery', 'source', 5, {
      componentTypeId: 'battery-holder-aa-3',
      pinIds: ['BAT-', 'BAT+'],
      holeBindings: {
        'BAT+': { breadboardComponentId: 'board', holeId: 'P1' },
        'BAT-': { breadboardComponentId: 'board', holeId: 'N1' },
      },
    });
    const resistor = component('resistor', 'resistor', 220, {
      componentTypeId: 'resistor-axial',
      pinIds: ['lead-1', 'lead-2'],
      holeBindings: {
        'lead-1': { breadboardComponentId: 'board', holeId: 'J1' },
        'lead-2': { breadboardComponentId: 'board', holeId: 'J2' },
      },
    });
    const led = component('led', 'led', 2, {
      componentTypeId: 'led-5mm',
      pinIds: ['anode', 'cathode'],
      stateProperties: { ledColour: 'red' },
      holeBindings: {
        anode: { breadboardComponentId: 'board', holeId: 'I2' },
        cathode: { breadboardComponentId: 'board', holeId: 'N2' },
      },
    });
    const result = solveCircuit(
      doc([board, source, resistor, led], [connect('rail-to-row', 'board', 'P2', 'board', 'I1')]),
    );

    expect(result.status).toBe('solved');
    expect(result.current).toBeGreaterThan(0.012);
    expect(
      resultFor(
        doc([board, source, resistor, led], [connect('rail-to-row', 'board', 'P2', 'board', 'I1')]),
        'led',
      )?.lit,
    ).toBe(true);
  });

  it('keeps an isolated LED dark without inventing terminal voltage', () => {
    const isolated = solveCircuit(
      doc(
        [
          component('source', 'source', 5),
          component('led', 'led', 2, {
            componentTypeId: 'led-5mm',
            pinIds: ['anode', 'cathode'],
            stateProperties: { ledColour: 'red' },
          }),
        ],
        [],
      ),
    );
    const led = isolated.components.find((item) => item.componentId === 'led');
    expect(led?.terminalVoltages['anode']).toBe(0);
    expect(led?.terminalVoltages['cathode']).toBe(0);
    expect(led?.voltageDrop).toBe(0);
    expect(led?.current).toBe(0);
    expect(led?.brightness).toBe(0);
    expect(led?.lit).toBe(false);
  });

  it('solves RGB channels electrically and leaves unpowered channels dark', () => {
    const document = doc(
      [
        component('source', 'source', 5),
        component('r-red', 'resistor', 220),
        component('rgb', 'rgb-led', 0, {
          componentTypeId: 'rgb-led',
          pinIds: ['red', 'common', 'green', 'blue'],
          stateProperties: { commonMode: 'common-cathode' },
        }),
      ],
      [
        connect('w1', 'source', 'a', 'r-red', 'a'),
        connect('w2', 'r-red', 'b', 'rgb', 'red'),
        connect('w3', 'rgb', 'common', 'source', 'b'),
      ],
    );
    const rgb = resultFor(document, 'rgb');
    expect(rgb?.branchCurrents?.red).toBeGreaterThan(0.013);
    expect(rgb?.branchBrightness?.red).toBeGreaterThan(70);
    expect(rgb?.branchBrightness?.green).toBe(0);
    expect(rgb?.branchBrightness?.blue).toBe(0);
  });

  it('matches the Tinkercad 3 V direct-red RGB burnout current', () => {
    const circuit = doc(
      [
        component('source', 'source', 3),
        component('rgb', 'rgb-led', 0, {
          componentTypeId: 'rgb-led',
          pinIds: ['red', 'common', 'green', 'blue'],
          stateProperties: { commonMode: 'common-cathode' },
        }),
      ],
      [
        connect('positive', 'source', 'a', 'rgb', 'red'),
        connect('common', 'rgb', 'common', 'source', 'b'),
      ],
    );
    const result = solveCircuit(circuit);
    const rgb = resultFor(circuit, 'rgb');

    expect(result).toMatchObject({ solved: true, status: 'solved' });
    expect(rgb?.branchCurrents?.red).toBeCloseTo(1.07, 2);
    expect(rgb?.branchBrightness?.red).toBe(100);
    expect(rgb?.branchBrightness?.green).toBe(0);
    expect(rgb?.branchBrightness?.blue).toBe(0);
    expect(rgb?.stressState).toBe('burned');
    expect(result.diagnostics.map((item) => item.code)).toContain('led_burnout');
  });

  it('mixes red and blue in the 3 V RCBG owner wiring', () => {
    const circuit = doc(
      [
        component('source', 'source', 3),
        component('r-red', 'resistor', 220),
        component('rgb', 'rgb-led', 0, {
          componentTypeId: 'rgb-led',
          pinIds: ['red', 'common', 'green', 'blue'],
          stateProperties: { commonMode: 'common-cathode', pinLayout: 'RCBG' },
        }),
      ],
      [
        connect('positive-red', 'source', 'a', 'r-red', 'a'),
        connect('red-channel', 'r-red', 'b', 'rgb', 'red'),
        connect('positive-blue', 'source', 'a', 'rgb', 'blue'),
        connect('common-return', 'rgb', 'common', 'source', 'b'),
      ],
    );
    const result = solveCircuit(circuit);
    const rgb = resultFor(circuit, 'rgb');

    expect(result).toMatchObject({ solved: true, status: 'solved' });
    expect(rgb?.branchCurrents?.red).toBeGreaterThan(0);
    expect(rgb?.branchCurrents?.blue).toBeGreaterThan(0);
    expect(rgb?.branchCurrents?.green).toBe(0);
    expect(rgb?.branchBrightness?.red).toBeGreaterThan(0);
    expect(rgb?.branchBrightness?.blue).toBeGreaterThan(rgb?.branchBrightness?.red ?? 100);
    expect(rgb?.stressState).toBe('warning');
    expect(result.diagnostics.map((item) => item.code)).toContain('led_near_limit');
    expect(result.diagnostics.map((item) => item.code)).not.toContain('led_burnout');
  });

  it.each(['red', 'green', 'blue'] as const)(
    'changes only the %s RGB channel monotonically across the resistor sweep',
    (channel) => {
      const sample = (resistance: number) =>
        solveCircuit(
          doc(
            [
              component('source', 'source', 5),
              component('resistor', 'resistor', resistance),
              component('rgb', 'rgb-led', 0, {
                componentTypeId: 'rgb-led',
                pinIds: ['red', 'common', 'green', 'blue'],
                stateProperties: { commonMode: 'common-cathode' },
              }),
            ],
            [
              connect('positive', 'source', 'a', 'resistor', 'a'),
              connect('channel', 'resistor', 'b', 'rgb', channel),
              connect('common', 'rgb', 'common', 'source', 'b'),
            ],
          ),
        );
      const results = [10_000, 1_000, 330, 220, 100, 0].map(sample);
      const brightness = results.map(
        (result) =>
          result.components.find((item) => item.componentId === 'rgb')?.branchBrightness?.[
            channel
          ] ?? 0,
      );

      for (const result of results) {
        const rgb = result.components.find((item) => item.componentId === 'rgb');
        expect(result).toMatchObject({ solved: true, status: 'solved' });
        expect(result.diagnostics.map((item) => item.code)).not.toContain('invalid_property');
        expect(Number.isFinite(rgb?.branchCurrents?.[channel])).toBe(true);
        for (const other of ['red', 'green', 'blue'] as const) {
          if (other !== channel) expect(rgb?.branchBrightness?.[other]).toBe(0);
        }
      }
      for (let index = 1; index < brightness.length; index += 1) {
        expect(brightness[index]).toBeGreaterThanOrEqual(brightness[index - 1] ?? 0);
      }
      expect(brightness[0]).toBeGreaterThan(0);
      expect(brightness.at(-1)).toBe(100);
    },
  );

  it.each(['red', 'green', 'blue'] as RgbLedChannel[])(
    'calculates the %s RGB channel for arbitrary decimal resistance values',
    (channel) => {
      const profile = rgbLedProfile(channel);
      const samples = deterministicResistanceSamples(48).map((resistance) => {
        const document = doc(
          [
            component('source', 'source', 5),
            component('resistor', 'resistor', resistance),
            component('rgb', 'rgb-led', 0, {
              componentTypeId: 'rgb-led',
              pinIds: ['red', 'common', 'green', 'blue'],
              stateProperties: { commonMode: 'common-cathode' },
            }),
          ],
          [
            connect('positive', 'source', 'a', 'resistor', 'a'),
            connect('channel', 'resistor', 'b', 'rgb', channel),
            connect('common', 'rgb', 'common', 'source', 'b'),
          ],
        );
        const result = solveCircuit(document);
        const rgb = result.components.find((item) => item.componentId === 'rgb');
        const current = rgb?.branchCurrents?.[channel] ?? 0;
        const brightness = rgb?.branchBrightness?.[channel] ?? 0;
        const expectedCurrent =
          (5 - profile.kneeVoltage) / (Math.max(0.0001, resistance) + profile.dynamicResistanceOhm);

        expect(result).toMatchObject({ solved: true, status: 'solved' });
        expect(Math.abs(current - expectedCurrent)).toBeLessThanOrEqual(5.1e-7);
        expect(brightness).toBeCloseTo(ledBrightnessPercent(expectedCurrent, profile), 1);
        for (const other of ['red', 'green', 'blue'] as const) {
          if (other !== channel) {
            expect(rgb?.branchCurrents?.[other]).toBe(0);
            expect(rgb?.branchBrightness?.[other]).toBe(0);
          }
        }
        return { current, brightness };
      });

      for (let index = 1; index < samples.length; index += 1) {
        expect(samples[index]?.current).toBeLessThanOrEqual(samples[index - 1]?.current ?? 0);
        expect(samples[index]?.brightness).toBeLessThanOrEqual(samples[index - 1]?.brightness ?? 0);
      }
    },
  );

  it('keeps equal 220 ohm green and blue branches visibly mixed from a 3 V AA holder', () => {
    const document = doc(
      [
        component('source', 'source', 3),
        component('r-green', 'resistor', 220),
        component('r-blue', 'resistor', 220),
        component('rgb', 'rgb-led', 0, {
          componentTypeId: 'rgb-led',
          pinIds: ['red', 'common', 'green', 'blue'],
          stateProperties: { commonMode: 'common-cathode', pinLayout: 'RCBG' },
        }),
      ],
      [
        connect('positive-green', 'source', 'a', 'r-green', 'a'),
        connect('green-channel', 'r-green', 'b', 'rgb', 'green'),
        connect('positive-blue', 'source', 'a', 'r-blue', 'a'),
        connect('blue-channel', 'r-blue', 'b', 'rgb', 'blue'),
        connect('common-return', 'rgb', 'common', 'source', 'b'),
      ],
    );

    const result = solveCircuit(document);
    const rgb = result.components.find((item) => item.componentId === 'rgb');
    const greenBrightness = rgb?.branchBrightness?.green ?? 0;
    const blueBrightness = rgb?.branchBrightness?.blue ?? 0;

    expect(result).toMatchObject({ solved: true, status: 'solved' });
    expect(rgb?.branchBrightness?.red).toBe(0);
    expect(greenBrightness).toBeGreaterThan(0);
    expect(blueBrightness).toBeGreaterThanOrEqual(greenBrightness * 0.45);
    expect(blueBrightness).toBeLessThan(greenBrightness);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['circuit_ok']);
  });

  it('mixes all RGB channels for common-cathode and common-anode wiring', () => {
    for (const commonMode of ['common-cathode', 'common-anode'] as const) {
      const components = [
        component('source', 'source', 5),
        component('r-red', 'resistor', 220),
        component('r-green', 'resistor', 220),
        component('r-blue', 'resistor', 220),
        component('rgb', 'rgb-led', 0, {
          componentTypeId: 'rgb-led',
          pinIds: ['red', 'common', 'green', 'blue'],
          stateProperties: { commonMode },
        }),
      ];
      const connections =
        commonMode === 'common-cathode'
          ? [
              connect('positive-red', 'source', 'a', 'r-red', 'a'),
              connect('red-channel', 'r-red', 'b', 'rgb', 'red'),
              connect('positive-green', 'source', 'a', 'r-green', 'a'),
              connect('green-channel', 'r-green', 'b', 'rgb', 'green'),
              connect('positive-blue', 'source', 'a', 'r-blue', 'a'),
              connect('blue-channel', 'r-blue', 'b', 'rgb', 'blue'),
              connect('common-return', 'rgb', 'common', 'source', 'b'),
            ]
          : [
              connect('common-positive', 'source', 'a', 'rgb', 'common'),
              connect('red-channel', 'rgb', 'red', 'r-red', 'a'),
              connect('red-return', 'r-red', 'b', 'source', 'b'),
              connect('green-channel', 'rgb', 'green', 'r-green', 'a'),
              connect('green-return', 'r-green', 'b', 'source', 'b'),
              connect('blue-channel', 'rgb', 'blue', 'r-blue', 'a'),
              connect('blue-return', 'r-blue', 'b', 'source', 'b'),
            ];

      const rgb = resultFor(doc(components, connections), 'rgb');
      expect(rgb?.lit, commonMode).toBe(true);
      expect(rgb?.branchCurrents?.red, commonMode).toBeGreaterThan(0);
      expect(rgb?.branchCurrents?.green, commonMode).toBeGreaterThan(0);
      expect(rgb?.branchCurrents?.blue, commonMode).toBeGreaterThan(0);
      expect(rgb?.branchCurrents?.red, commonMode).toBeGreaterThan(
        rgb?.branchCurrents?.green ?? Number.POSITIVE_INFINITY,
      );
      expect(rgb?.branchCurrents?.green, commonMode).toBeGreaterThan(
        rgb?.branchCurrents?.blue ?? Number.POSITIVE_INFINITY,
      );
      expect(rgb?.branchBrightness?.red, commonMode).toBeGreaterThan(0);
      expect(rgb?.branchBrightness?.green, commonMode).toBeGreaterThan(0);
      expect(rgb?.branchBrightness?.blue, commonMode).toBeGreaterThan(0);
    }
  });

  it('drives each seven-segment cell from its real pin and never invents a glyph', () => {
    const display = component('display', 'seven-segment', 0, {
      componentTypeId: 'seven-segment-display',
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
      stateProperties: { commonMode: 'common-cathode' },
    });
    const powered = doc(
      [component('source', 'source', 5), component('r-a', 'resistor', 330), display],
      [
        connect('w1', 'source', 'a', 'r-a', 'a'),
        connect('w2', 'r-a', 'b', 'display', 'top-4'),
        connect('w3', 'display', 'top-3', 'source', 'b'),
      ],
    );
    const unpowered = doc([component('source', 'source', 5), display], []);
    const poweredResult = resultFor(powered, 'display');
    const unpoweredResult = resultFor(unpowered, 'display');
    expect(poweredResult?.branchBrightness?.a).toBeGreaterThan(0);
    expect(poweredResult?.branchBrightness?.b).toBe(0);
    expect(poweredResult?.terminalVoltages['top-3']).toBeCloseTo(
      poweredResult?.terminalVoltages['bottom-3'] ?? Number.NaN,
      12,
    );
    expect(Object.values(unpoweredResult?.branchBrightness ?? {})).toEqual(
      expect.arrayContaining([0, 0, 0, 0, 0, 0, 0, 0]),
    );
    expect(unpoweredResult?.lit).toBe(false);
  });

  it('drives a common-anode seven-segment branch with the opposite polarity', () => {
    const display = component('display', 'seven-segment', 0, {
      componentTypeId: 'seven-segment-display',
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
      stateProperties: { commonMode: 'common-anode' },
    });
    const circuit = doc(
      [component('source', 'source', 5), component('r-dp', 'resistor', 330), display],
      [
        connect('common-positive', 'source', 'a', 'display', 'top-3'),
        connect('dp-resistor', 'display', 'bottom-5', 'r-dp', 'a'),
        connect('return', 'r-dp', 'b', 'source', 'b'),
      ],
    );
    const result = resultFor(circuit, 'display');

    expect(result?.branchBrightness?.dp).toBeGreaterThan(0);
    for (const segment of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      expect(result?.branchBrightness?.[segment]).toBe(0);
    }
    expect(result?.terminalVoltages['top-3']).toBeCloseTo(
      result?.terminalVoltages['bottom-3'] ?? Number.NaN,
      12,
    );
  });

  it('uses one deterministic T-1 6 V electrothermal lamp profile', () => {
    expect(JSON.parse(canonicalIncandescentLampProfileRegistry())).toEqual({
      registryVersion: 1,
      profiles: [INCANDESCENT_LAMP_PROFILE],
    });
    expect(INCANDESCENT_LAMP_PROFILE.ratedPowerWatt).toBeCloseTo(
      INCANDESCENT_LAMP_PROFILE.ratedVoltageVolt * INCANDESCENT_LAMP_PROFILE.ratedCurrentAmp,
      12,
    );
    expect(incandescentLampResistanceOhm(INCANDESCENT_LAMP_PROFILE.ambientCelsius)).toBeCloseTo(
      INCANDESCENT_LAMP_PROFILE.coldResistanceOhm,
      12,
    );
    expect(
      incandescentLampResistanceOhm(INCANDESCENT_LAMP_PROFILE.ratedFilamentTemperatureCelsius),
    ).toBeCloseTo(INCANDESCENT_LAMP_PROFILE.hotResistanceOhm, 12);
  });

  it('warms smoothly, raises filament resistance and cools after disconnection', () => {
    const lamp = component('lamp1', 'lamp', 6, {
      componentTypeId: 'incandescent-lamp',
      pinIds: ['L1', 'L2'],
    });
    const button = component('button', 'button', 0, { state: true });
    const source = component('source', 'source', 6);
    const circuit = (buttonState: boolean) =>
      doc(
        [source, { ...button, state: buttonState }, lamp],
        [
          connect('w1', 'source', 'a', 'button', 'a'),
          connect('w2', 'button', 'b', 'lamp1', 'L1'),
          connect('w3', 'lamp1', 'L2', 'source', 'b'),
        ],
      );
    const powered = circuit(true);
    const cold = solveCircuit(powered, { simulationTimeMs: 1 });
    const warm = solveCircuit(powered, { simulationTimeMs: 500 });
    const coldLamp = cold.components.find((item) => item.componentId === 'lamp1');
    const warmLamp = warm.components.find((item) => item.componentId === 'lamp1');
    expect(coldLamp?.brightness).toBeLessThan(1);
    expect(warmLamp).toMatchObject({
      lit: true,
      filamentState: 'lit',
      ratedVoltageVolt: 6,
      ratedCurrentAmp: 0.25,
      ratedPowerWatt: 1.5,
    });
    expect(warmLamp?.brightness).toBeGreaterThan(90);
    expect(warmLamp?.effectiveResistanceOhm).toBeGreaterThan(
      coldLamp?.effectiveResistanceOhm ?? Number.POSITIVE_INFINITY,
    );
    expect(warmLamp?.current).toBeGreaterThan(0.24);
    expect(warmLamp?.current).toBeLessThan(0.27);

    const disconnected = circuit(false);
    const cooling = solveCircuit(disconnected, {
      simulationTimeMs: 650,
      transientState: warm.transientState,
    });
    const cool = solveCircuit(disconnected, {
      simulationTimeMs: 2_500,
      transientState: cooling.transientState,
    });
    const coolingLamp = cooling.components.find((item) => item.componentId === 'lamp1');
    const coolLamp = cool.components.find((item) => item.componentId === 'lamp1');
    expect(coolingLamp?.brightness).toBeGreaterThan(coolLamp?.brightness ?? 100);
    expect(coolLamp).toMatchObject({ lit: false, filamentState: 'cold', current: 0 });
  });

  it('warns on overvoltage and opens the circuit after visible filament burnout', () => {
    const overloadedLamp = component('lamp1', 'lamp', 6, {
      componentTypeId: 'incandescent-lamp',
      pinIds: ['L1', 'L2'],
    });
    const overloaded = doc(
      [component('source', 'source', 12), overloadedLamp],
      [connect('w1', 'source', 'a', 'lamp1', 'L1'), connect('w2', 'lamp1', 'L2', 'source', 'b')],
    );
    const warning = solveCircuit(overloaded, { simulationTimeMs: 100 });
    expect(warning.diagnostics.map((item) => item.code)).toContain('lamp_overvoltage');
    expect(warning.components.find((item) => item.componentId === 'lamp1')?.filamentState).not.toBe(
      'burned',
    );
    const failed = solveCircuit(overloaded, { simulationTimeMs: 2_000 });
    expect(failed.diagnostics.map((item) => item.code)).toContain('lamp_burnout');
    expect(failed.components.find((item) => item.componentId === 'lamp1')).toMatchObject({
      current: 0,
      brightness: 0,
      lit: false,
      deviceHealth: 'failed_open',
      filamentState: 'burned',
    });
  });

  it('calculates a finite destructive preview for a direct source short', () => {
    const short = solveCircuit(
      doc(
        [
          component('source', 'source', 3, {
            componentTypeId: 'battery-holder-aa-2',
            pinIds: ['BAT-', 'BAT+'],
          }),
        ],
        [connect('w1', 'source', 'BAT+', 'source', 'BAT-')],
      ),
    );

    expect(short.status).toBe('solved');
    const sourceResult = short.components.find((item) => item.componentId === 'source');
    expect(sourceResult).toMatchObject({
      voltageDrop: 0,
      internalResistanceOhm: 0.45,
      internalPower: 20,
      voltageSag: 3,
      deviceHealth: 'overheated',
      damageState: 'destructive_preview',
      presentationState: 'destructive',
    });
    expect(sourceResult?.current).toBeCloseTo(6.666667, 6);
    expect(short.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['short_circuit', 'source_overload']),
    );
  });

  it('keeps an open circuit neutral while diagnosing no source and invalid property', () => {
    const open = solveCircuit(
      doc(
        [component('source', 'source', 5), component('r1', 'resistor', 100)],
        [connect('w1', 'source', 'a', 'r1', 'a')],
      ),
    );
    const noSource = solveCircuit(doc([component('r1', 'resistor', 100)], []));
    const invalid = solveCircuit(series([component('pot1', 'potentiometer', 0)], 5));
    expect(open.diagnostics.map((item) => item.code)).not.toContain('open_circuit');
    expect(open.diagnostics.map((item) => item.code)).toContain('circuit_ok');
    expect(noSource.diagnostics.map((item) => item.code)).toContain('no_source');
    expect(invalid.diagnostics.map((item) => item.code)).toContain('invalid_property');
  });

  it('returns byte-for-byte deterministic results', () => {
    const document = series([component('r1', 'resistor', 470), component('led1', 'led', 2)], 9);
    expect(JSON.stringify(solveCircuit(document))).toBe(JSON.stringify(solveCircuit(document)));
  });

  it('solves the maximum supported 300-component document without losing numerical validity', () => {
    const resistors = Array.from({ length: 299 }, (_, index) =>
      component(`r-${String(index).padStart(3, '0')}`, 'resistor', 1000),
    );
    const result = solveCircuit(series(resistors, 5));
    expect(result.status).toBe('solved');
    expect(result.current).toBeCloseTo(5 / 299_000, 6);
    expect(result.numericalResidual).toBeLessThanOrEqual(result.numericalTolerance);
  });
});
