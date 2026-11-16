import { describe, expect, it } from 'vitest';
import type {
  ElectronicsDocument,
  SchematicComponent,
  SchematicConnection,
} from '../domain/document.js';
import { parseElectronicsDocument } from '../domain/document.js';
import { analyseCircuit } from '../domain/simulation.js';
import { solveCircuit } from '../domain/solver.js';

const pinIds = ['+12V', 'GND', '+5V', 'OUT1', 'OUT2', 'OUT3', 'OUT4', 'IN1', 'IN2', 'IN3', 'IN4'];
const component = (
  id: string,
  kind: SchematicComponent['kind'],
  value: number,
): SchematicComponent => ({ id, kind, value, position: { x: 0, y: 0 } });
const edge = (
  id: string,
  fromId: string,
  fromTerminal: string,
  toId: string,
  toTerminal: string,
): SchematicConnection => ({
  id,
  from: { componentId: fromId, terminal: fromTerminal },
  to: { componentId: toId, terminal: toTerminal },
});

function multiDriverDocument(): ElectronicsDocument {
  const components: SchematicComponent[] = [
    component('vs', 'source', 9),
    component('logic', 'source', 5),
  ];
  const connections: SchematicConnection[] = [];
  for (const [driverNumber, reversed] of [
    [1, false],
    [2, true],
  ] as const) {
    const driver = 'driver-' + driverNumber;
    components.push({
      ...component(driver, 'visual', 0),
      componentTypeId: 'l298n-motor-driver',
      pinIds,
      stateProperties: {
        enaJumperInstalled: true,
        enbJumperInstalled: true,
        regulatorJumperInstalled: false,
      },
    });
    connections.push(
      edge(driver + '-vs', 'vs', 'a', driver, '+12V'),
      edge(driver + '-ground', 'vs', 'b', driver, 'GND'),
      edge(driver + '-logic', 'logic', 'a', driver, '+5V'),
      edge(driver + '-logic-ground', 'logic', 'b', driver, 'GND'),
    );
    const control = reversed
      ? { IN1: 'b', IN2: 'a', IN3: 'a', IN4: 'b' }
      : { IN1: 'a', IN2: 'b', IN3: 'b', IN4: 'a' };
    for (const [pin, sourcePin] of Object.entries(control)) {
      connections.push(
        edge(driver + '-' + pin, sourcePin === 'a' ? 'logic' : 'vs', sourcePin, driver, pin),
      );
    }
    for (const [channel, out1, out2, resistance] of [
      ['a', 'OUT1', 'OUT2', driverNumber === 1 ? 500 : 700],
      ['b', 'OUT3', 'OUT4', driverNumber === 1 ? 600 : 800],
    ] as const) {
      const load = 'load-' + driverNumber + '-' + channel;
      components.push(component(load, 'resistor', resistance));
      connections.push(
        edge(load + '-1', driver, out1, load, 'a'),
        edge(load + '-2', driver, out2, load, 'b'),
      );
    }
  }
  return {
    schemaVersion: 4,
    components,
    connections,
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

describe('two L298N instances share only canonical power nets, never bridge state', () => {
  it('drives four independent loads with signed outputs and complete KCL quality', () => {
    const document = multiDriverDocument();
    const result = analyseCircuit(document);
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
    expect(result.quality.passed).toBe(true);
    expect(result.quality.maxKclResidualAmp).toBeLessThanOrEqual(result.quality.kclToleranceAmp);
    for (const [load, sign] of [
      ['load-1-a', 1],
      ['load-1-b', -1],
      ['load-2-a', -1],
      ['load-2-b', 1],
    ] as const) {
      const solved = result.components.find((c) => c.componentId === load);
      expect(solved).toBeDefined();
      expect(Math.sign(solved!.current)).toBe(sign);
    }
    const a = result.components.find((c) => c.componentId === 'driver-1');
    const b = result.components.find((c) => c.componentId === 'driver-2');
    expect(a?.lit).toBe(true);
    expect(b?.lit).toBe(true);
    expect(a?.terminalVoltages.OUT1).not.toBeCloseTo(b!.terminalVoltages.OUT1, 1);
  });

  it('round-trips both distinct drivers without connection loss and remains deterministic', () => {
    const document = multiDriverDocument();
    const parsed = parseElectronicsDocument(JSON.parse(JSON.stringify(document)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(
      parsed.document.components.filter((item) => item.componentTypeId === 'l298n-motor-driver'),
    ).toHaveLength(2);
    expect(parsed.document.connections).toHaveLength(document.connections.length);
    expect(JSON.stringify(solveCircuit(parsed.document))).toBe(
      JSON.stringify(solveCircuit(document)),
    );
  });
});
