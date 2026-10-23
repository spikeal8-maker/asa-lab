import { describe, expect, it } from 'vitest';
import {
  parseElectronicsDocument,
  type ComponentKind,
  type ElectronicsDocument,
  type SchematicComponent,
  type Terminal,
} from '../domain/document';
import { analyseCircuit, type SimulationResult } from '../domain/simulation';

const CURRENT_TOLERANCE_AMP = 1e-8;
const VOLTAGE_TOLERANCE_VOLT = 1e-5;

function component(
  id: string,
  kind: ComponentKind,
  value: number,
  options: Partial<SchematicComponent> = {},
): SchematicComponent {
  return { id, kind, value, position: { x: 0, y: 0 }, ...options };
}

function wire(id: string, from: string, fromTerminal: Terminal, to: string, toTerminal: Terminal) {
  return {
    id,
    from: { componentId: from, terminal: fromTerminal },
    to: { componentId: to, terminal: toTerminal },
    color: '#e3212b',
    vertices: [],
  };
}

function circuit({
  gateVoltage = 3,
  drainVoltage = 5,
  sourceResistance = 0,
  maxIterations = 24,
}: {
  gateVoltage?: number;
  drainVoltage?: number;
  sourceResistance?: number;
  maxIterations?: number;
} = {}): ElectronicsDocument {
  const components = [
    component('supply', 'source', drainVoltage),
    component('gate-supply', 'source', gateVoltage),
    component('fet', 'transistor', 0, {
      componentTypeId: 'transistor-fet',
      pinIds: ['gate', 'source', 'drain'],
      stateProperties: {
        transistorType: 'fet',
        thresholdVoltage: 2,
        transconductanceFactor: 0.01,
        maxDrainCurrent: 0.5,
      },
    }),
  ];
  const connections = [
    wire('drain', 'supply', 'a', 'fet', 'drain'),
    wire('gate', 'gate-supply', 'a', 'fet', 'gate'),
    wire('common-ground', 'gate-supply', 'b', 'supply', 'b'),
  ];
  if (sourceResistance === 0) connections.push(wire('source', 'fet', 'source', 'supply', 'b'));
  else {
    components.push(component('source-resistor', 'resistor', sourceResistance));
    connections.push(
      wire('source', 'fet', 'source', 'source-resistor', 'a'),
      wire('resistor-ground', 'source-resistor', 'b', 'supply', 'b'),
    );
  }
  const parsed = parseElectronicsDocument({
    schemaVersion: 3,
    components,
    connections,
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations },
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

function value(result: SimulationResult, id: string) {
  const found = result.components.find((entry) => entry.componentId === id);
  if (!found) throw new Error(`Missing result for ${id}`);
  return found;
}

function expectCurrent(actual: number | undefined, expected: number) {
  expect(actual).toBeTypeOf('number');
  expect(Math.abs(actual! - expected)).toBeLessThanOrEqual(CURRENT_TOLERANCE_AMP);
}

function expectAccepted(result: SimulationResult) {
  expect(result.status).toBe('solved');
  expect(result.solved).toBe(true);
  expect(result.quality.finite).toBe(true);
  expect(result.quality.passed).toBe(true);
  expect(result.quality.maxKclResidualAmp).toBeLessThanOrEqual(CURRENT_TOLERANCE_AMP);
}

describe('FET DC independent analytic references', () => {
  it('Q-FET-01: agrees with Id=k(Vgs-Vth)^2 without an undeclared drain shunt', () => {
    const result = analyseCircuit(circuit());
    expectAccepted(result);
    const fet = value(result, 'fet');
    expect(fet.operatingRegion).toBe('active');
    expectCurrent(fet.current, 0.01);
    expectCurrent(value(result, 'supply').current, 0.01);
    expectCurrent(value(result, 'gate-supply').current, 0);
    expectCurrent(fet.branchCurrents?.['gate'], 0);
    expectCurrent(fet.branchCurrents?.['drain'], 0.01);
    expectCurrent(fet.branchCurrents?.['source'], 0.01);
  });

  // Fixed before the repair. Solving Vs=100*k*(Vg-2-Vs)^2 gives
  // the physical root below; all three points satisfy Vds >= Vgs-Vth.
  it.each([
    [2.5, 0.13397459621556135, 0.001339745962155614],
    [3, 0.38196601125010515, 0.003819660112501052],
    [4, 1, 0.01],
  ])('Q-FET-02/Q-ROB-04: source feedback at Vg=%s V', (gateVoltage, sourceVoltage, current) => {
    const result = analyseCircuit(circuit({ gateVoltage, sourceResistance: 100 }));
    expectAccepted(result);
    const fet = value(result, 'fet');
    const resistor = value(result, 'source-resistor');
    expect(fet.operatingRegion).toBe('active');
    expect(Math.abs(resistor.voltageDrop - sourceVoltage)).toBeLessThanOrEqual(
      VOLTAGE_TOLERANCE_VOLT,
    );
    expectCurrent(fet.current, current);
    expectCurrent(fet.branchCurrents?.['drain'], current);
    expectCurrent(fet.branchCurrents?.['source'], current);
    expectCurrent(resistor.current, current);
    expectCurrent(value(result, 'supply').current, current);
    expectCurrent(value(result, 'gate-supply').current, 0);
    expectCurrent(resistor.voltageDrop / 100, current);
    expect(result.iterations).toBeGreaterThan(2);
    expect(result.iterations).toBeLessThanOrEqual(24);
  });

  it('preserves cutoff with no claimed load or gate current', () => {
    const result = analyseCircuit(circuit({ gateVoltage: 1 }));
    expectAccepted(result);
    const fet = value(result, 'fet');
    expect(fet.operatingRegion).toBe('cutoff');
    expectCurrent(fet.current, 0);
    expectCurrent(value(result, 'supply').current, 0);
    expectCurrent(value(result, 'gate-supply').current, 0);
  });

  it('preserves the existing ohmic law Id=k(Vgs-Vth)Vds', () => {
    const result = analyseCircuit(circuit({ drainVoltage: 0.2 }));
    expectAccepted(result);
    const fet = value(result, 'fet');
    expect(fet.operatingRegion).toBe('ohmic');
    expectCurrent(fet.current, 0.002);
    expectCurrent(value(result, 'supply').current, 0.002);
    expectCurrent(value(result, 'gate-supply').current, 0);
  });

  it('rejects a source-feedback solution before its continuous operating point converges', () => {
    const result = analyseCircuit(circuit({ sourceResistance: 100, maxIterations: 4 }));
    expect(result.status).toBe('nonconvergent');
    expect(result.solved).toBe(false);
    expect(result.iterations).toBeLessThanOrEqual(5);
    expect(result.diagnostics.some((entry) => entry.code === 'nonconvergent_topology')).toBe(true);
  });

  it('is deterministic and preserves the operating point when component and wire order change', () => {
    const document = circuit({ sourceResistance: 100 });
    const first = analyseCircuit(document);
    expectAccepted(first);
    expect(analyseCircuit(document)).toEqual(first);
    const reordered = analyseCircuit({
      ...document,
      components: [...document.components].reverse(),
      connections: [...document.connections].reverse(),
    });
    expectAccepted(reordered);
    for (const id of ['fet', 'supply', 'gate-supply', 'source-resistor']) {
      expect(value(reordered, id)).toEqual(value(first, id));
    }
  });
});
