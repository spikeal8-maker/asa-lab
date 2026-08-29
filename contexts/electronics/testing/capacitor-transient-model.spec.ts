import { describe, expect, it } from 'vitest';
import type {
  ComponentKind,
  ElectronicsDocument,
  SchematicComponent,
  Terminal,
} from '../domain/document';
import { parseElectronicsDocument } from '../domain/document';
import { analyseCircuit } from '../domain/simulation';
import {
  capacitorCompanion,
  capacitorParameters,
  observeCapacitor,
} from '../domain/models/capacitor-transient-model';

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

function document(
  components: readonly SchematicComponent[],
  connections: readonly ReturnType<typeof connect>[],
): ElectronicsDocument {
  const parsed = parseElectronicsDocument({
    schemaVersion: 3,
    components,
    connections,
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: true, maxIterations: 24 },
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

function capacitor(initialVoltageVolt = 0): SchematicComponent {
  return component('c1', 'visual', 100, {
    componentTypeId: 'electrolytic-capacitor',
    pinIds: ['negative', 'positive'],
    stateProperties: { initialVoltageVolt, voltageRatingVolt: 25 },
  });
}

describe('electrolytic capacitor transient model', () => {
  it('builds the finite Backward Euler companion and observation', () => {
    const parameters = capacitorParameters(capacitor());
    const companion = capacitorCompanion(parameters, 2, 0.01);
    const observation = observeCapacitor(parameters, 2, 2.5, 0.01);

    expect(parameters.capacitanceFarad).toBeCloseTo(100e-6, 12);
    expect(companion.conductanceSiemens).toBeCloseTo(0.01, 12);
    expect(companion.historyCurrentAmp).toBeCloseTo(0.02, 12);
    expect(observation.currentAmp).toBeCloseTo(0.005, 12);
    expect(observation.chargeCoulomb).toBeCloseTo(0.00025, 12);
    expect(observation.storedEnergyJoule).toBeCloseTo(0.0003125, 12);
  });

  it('charges a 100 uF capacitor through 1 kOhm monotonically on deterministic model time', () => {
    const circuit = document(
      [component('source', 'source', 5), component('r1', 'resistor', 1_000), capacitor()],
      [
        connect('w1', 'source', 'a', 'r1', 'a'),
        connect('w2', 'r1', 'b', 'c1', 'positive'),
        connect('w3', 'c1', 'negative', 'source', 'b'),
      ],
    );
    const at20ms = analyseCircuit(circuit, { simulationTimeMs: 20 });
    const at100ms = analyseCircuit(circuit, { simulationTimeMs: 100 });
    const at500ms = analyseCircuit(circuit, { simulationTimeMs: 500 });
    const voltage = (result: typeof at20ms) =>
      result.components.find((entry) => entry.componentId === 'c1')?.voltageDrop ?? 0;

    expect(at100ms).toMatchObject({
      solved: true,
      status: 'solved',
      quality: { finite: true, passed: true },
      analysis: { electricalMode: 'transient' },
    });
    expect(voltage(at20ms)).toBeGreaterThan(0);
    expect(voltage(at100ms)).toBeGreaterThan(voltage(at20ms));
    expect(voltage(at500ms)).toBeGreaterThan(voltage(at100ms));
    expect(voltage(at100ms)).toBeCloseTo(5 * (1 - Math.exp(-1)), 1);
    expect(voltage(at500ms)).toBeCloseTo(5 * (1 - Math.exp(-5)), 1);
    expect(JSON.stringify(at100ms)).toBe(
      JSON.stringify(analyseCircuit(circuit, { simulationTimeMs: 100 })),
    );
  });

  it('discharges a precharged capacitor through a resistor without inventing a DC source', () => {
    const circuit = document(
      [component('r1', 'resistor', 1_000), capacitor(5)],
      [connect('w1', 'c1', 'positive', 'r1', 'a'), connect('w2', 'r1', 'b', 'c1', 'negative')],
    );
    const result = analyseCircuit(circuit, { simulationTimeMs: 100 });
    const solvedCapacitor = result.components.find((entry) => entry.componentId === 'c1');

    expect(result).toMatchObject({
      solved: true,
      status: 'solved',
      quality: { finite: true, passed: true },
    });
    expect(solvedCapacitor?.voltageDrop).toBeCloseTo(5 * Math.exp(-1), 1);
    expect(solvedCapacitor?.current).toBeLessThan(0);
    expect(solvedCapacitor?.storedEnergyJoule).toBeGreaterThan(0);
  });

  it('carries accumulated voltage across a topology switch and remains deterministic', () => {
    const charging = document(
      [component('source', 'source', 5), component('r1', 'resistor', 1_000), capacitor()],
      [
        connect('w1', 'source', 'a', 'r1', 'a'),
        connect('w2', 'r1', 'b', 'c1', 'positive'),
        connect('w3', 'c1', 'negative', 'source', 'b'),
      ],
    );
    const discharging = document(
      [component('r1', 'resistor', 1_000), capacitor()],
      [connect('w1', 'c1', 'positive', 'r1', 'a'), connect('w2', 'r1', 'b', 'c1', 'negative')],
    );
    const charged = analyseCircuit(charging, { simulationTimeMs: 100 });
    if (!charged.transientState) throw new Error('charged capacitor state missing');
    const switched = analyseCircuit(discharging, {
      simulationTimeMs: 200,
      transientState: charged.transientState,
    });
    const repeated = analyseCircuit(discharging, {
      simulationTimeMs: 200,
      transientState: charged.transientState,
    });
    const chargedVoltage =
      charged.components.find((entry) => entry.componentId === 'c1')?.voltageDrop ?? 0;
    const switchedVoltage =
      switched.components.find((entry) => entry.componentId === 'c1')?.voltageDrop ?? 0;

    expect(charged.transientState).toMatchObject({ version: 2, simulationTimeMs: 100 });
    expect(switched).toMatchObject({
      solved: true,
      status: 'solved',
      solverRevision: 'asa-electronics-solver-v5',
      quality: { finite: true, passed: true },
      transientState: { version: 2, simulationTimeMs: 200 },
    });
    expect(switchedVoltage).toBeGreaterThan(0);
    expect(switchedVoltage).toBeLessThan(chargedVoltage);
    expect(switchedVoltage).toBeCloseTo(chargedVoltage * Math.exp(-1), 1);
    expect(JSON.stringify(switched)).toBe(JSON.stringify(repeated));
  });

  it('resets incompatible carried state when capacitor parameters change', () => {
    const charging = document(
      [component('source', 'source', 5), component('r1', 'resistor', 1_000), capacitor()],
      [
        connect('w1', 'source', 'a', 'r1', 'a'),
        connect('w2', 'r1', 'b', 'c1', 'positive'),
        connect('w3', 'c1', 'negative', 'source', 'b'),
      ],
    );
    const changedCapacitor = component('c1', 'visual', 220, {
      componentTypeId: 'electrolytic-capacitor',
      pinIds: ['negative', 'positive'],
      stateProperties: { initialVoltageVolt: 0, voltageRatingVolt: 25 },
    });
    const discharging = document(
      [component('r1', 'resistor', 1_000), changedCapacitor],
      [connect('w1', 'c1', 'positive', 'r1', 'a'), connect('w2', 'r1', 'b', 'c1', 'negative')],
    );
    const charged = analyseCircuit(charging, { simulationTimeMs: 100 });
    if (!charged.transientState) throw new Error('charged capacitor state missing');
    const result = analyseCircuit(discharging, {
      simulationTimeMs: 200,
      transientState: charged.transientState,
    });

    expect(result.components.find((entry) => entry.componentId === 'c1')?.voltageDrop).toBeCloseTo(
      0,
      9,
    );
    expect(result.transientState?.capacitors[0]).toMatchObject({
      componentId: 'c1',
      voltageVolt: 0,
    });
    expect(result.transientState?.capacitors[0]?.capacitanceFarad).toBeCloseTo(220e-6, 12);
  });
});
