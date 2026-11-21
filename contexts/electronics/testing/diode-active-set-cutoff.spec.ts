import { describe, expect, it } from 'vitest';
import { parseElectronicsDocument, type ElectronicsDocument } from '../domain/document.js';
import { solveCircuit } from '../domain/solver.js';
import { compileCircuit, verifyCircuitQuality } from '../domain/simulation.js';
import { NPN_DEVICE_MODEL, classifyNpnOperatingRegion } from '../domain/models/npn-dc-model.js';
import { createArduinoCircuitClockExecutor } from '../domain/arduino-circuit-scheduler.js';
import { arduinoSevenSegmentMatrix } from './fixtures/arduino-seven-segment-matrix.js';

function parsed(
  components: ElectronicsDocument['components'],
  connections: ElectronicsDocument['connections'],
) {
  const result = parseElectronicsDocument({
    schemaVersion: 4,
    components,
    connections,
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  });
  if (!result.ok) throw new Error(result.message);
  return result.document;
}

function baseCircuit(knee: number, voltage: number) {
  return parsed(
    [
      { id: 'collector-supply', kind: 'source', value: 5, position: { x: 0, y: 0 } },
      { id: 'base-supply', kind: 'source', value: voltage, position: { x: 0, y: 0 } },
      { id: 'load', kind: 'resistor', value: 470, position: { x: 0, y: 0 } },
      {
        id: 'q',
        kind: 'transistor',
        componentTypeId: 'transistor-npn',
        value: 100,
        pinIds: ['base', 'collector', 'emitter'],
        position: { x: 0, y: 0 },
        stateProperties: { baseEmitterVoltage: knee },
      },
    ],
    [
      {
        id: 's-r',
        from: { componentId: 'collector-supply', terminal: 'a' },
        to: { componentId: 'load', terminal: 'a' },
      },
      {
        id: 'r-c',
        from: { componentId: 'load', terminal: 'b' },
        to: { componentId: 'q', terminal: 'collector' },
      },
      {
        id: 's-b',
        from: { componentId: 'base-supply', terminal: 'a' },
        to: { componentId: 'q', terminal: 'base' },
      },
      {
        id: 'e-g',
        from: { componentId: 'q', terminal: 'emitter' },
        to: { componentId: 'collector-supply', terminal: 'b' },
      },
      {
        id: 'g-g',
        from: { componentId: 'base-supply', terminal: 'b' },
        to: { componentId: 'collector-supply', terminal: 'b' },
      },
    ],
  );
}

function checked(document: ElectronicsDocument) {
  const result = solveCircuit(document);
  const quality = verifyCircuitQuality(document, compileCircuit(document), result);
  expect(result.solved, JSON.stringify(result.diagnostics)).toBe(true);
  expect(quality.passed, JSON.stringify(quality)).toBe(true);
  expect(quality.maxKclResidualAmp).toBeLessThanOrEqual(1e-6);
  expect(quality.maxSourceVoltageResidualVolt).toBeLessThanOrEqual(1e-9);
  return result;
}

describe('forward companion cutoff consistency', () => {
  it.each([0.5, 0.7, 1])(
    'does not retain a zero/negative base-current saturation latch at VBE knee %f',
    (knee) => {
      const component = baseCircuit(knee, knee).components.find((c) => c.id === 'q')!;
      const instance = NPN_DEVICE_MODEL.normalize(component);
      for (const delta of [-0.019, -0.006862745105, 0, 0.0001]) {
        const point = { baseEmitterDropVolt: knee + delta, collectorEmitterDropVolt: 0.2 };
        const evaluated = NPN_DEVICE_MODEL.evaluateIteration(
          instance,
          { region: 'saturation', earlyConductanceSiemens: 0 },
          point,
        );
        const observed = NPN_DEVICE_MODEL.observe(instance, evaluated.state, point);
        const shouldConduct = delta > 0;
        expect(classifyNpnOperatingRegion(instance.parameters, point)).toBe(
          shouldConduct ? 'saturation' : 'cutoff',
        );
        expect(evaluated.state.region).toBe(shouldConduct ? 'saturation' : 'cutoff');
        if (shouldConduct) expect(observed.baseCurrentAmp).toBeCloseTo(delta / 10, 12);
        else {
          expect(observed.baseCurrentAmp).toBe(0);
          expect(observed.collectorCurrentAmp).toBe(0);
          expect(observed.emitterCurrentAmp).toBe(0);
        }
      }
    },
  );

  it.each([0.5, 0.7, 1])(
    'matches physical source/load currents below, at and above configured base knee %f',
    (knee) => {
      for (const delta of [-0.01, 0, 0.001]) {
        const result = checked(baseCircuit(knee, knee + delta));
        const transistor = result.components.find((c) => c.componentId === 'q')!;
        const expectedBase = Math.max(0, delta / 10);
        expect(transistor.baseCurrent).toBeCloseTo(expectedBase, 10);
        if (delta <= 0) expect(transistor.collectorCurrent).toBeLessThan(1e-9);
        else {
          // beta=100 and Early conductance beta*Ib/100V, with a 470-ohm load.
          const betaIb = 100 * expectedBase;
          const expectedCollector = (betaIb * 1.05) / (1 + (470 * betaIb) / 100);
          expect(transistor.collectorCurrent).toBeCloseTo(expectedCollector, 8);
        }
        expect(transistor.baseCurrent).toBeGreaterThanOrEqual(0);
        expect(transistor.collectorCurrent).toBeGreaterThanOrEqual(0);
      }
    },
  );

  it.each([-0.01, 0, 0.0001, 0.02])(
    'matches the DO35 series-current equation around the knee (%f V)',
    (delta) => {
      const document = parsed(
        [
          { id: 's', kind: 'source', value: 0.58 + delta, position: { x: 0, y: 0 } },
          { id: 'r', kind: 'resistor', value: 1000, position: { x: 0, y: 0 } },
          {
            id: 'd',
            kind: 'diode',
            componentTypeId: 'diode-do35',
            value: 0.58,
            pinIds: ['anode', 'cathode'],
            position: { x: 0, y: 0 },
          },
        ],
        [
          {
            id: 's-r',
            from: { componentId: 's', terminal: 'a' },
            to: { componentId: 'r', terminal: 'a' },
          },
          {
            id: 'r-d',
            from: { componentId: 'r', terminal: 'b' },
            to: { componentId: 'd', terminal: 'anode' },
          },
          {
            id: 'd-s',
            from: { componentId: 'd', terminal: 'cathode' },
            to: { componentId: 's', terminal: 'b' },
          },
        ],
      );
      const result = checked(document);
      const diode = result.components.find((c) => c.componentId === 'd')!;
      expect(diode.current).toBeCloseTo(Math.max(0, delta / 1012), 10);
      expect(diode.current).toBeGreaterThanOrEqual(0);
    },
  );

  it.each([1, 4] as const)(
    'preserves falling-edge scans through JSON continuation for %i displays',
    (count) => {
      const document = arduinoSevenSegmentMatrix(count);
      const run = createArduinoCircuitClockExecutor(document);
      let state;
      for (const target of [2000, 2100, 4100, 8200, 20000]) {
        const actual = run(target, state);
        expect(actual.executionStatus, JSON.stringify(actual.diagnostics)).toBe('ready');
        expect(actual.result?.quality.passed).toBe(true);
        state = JSON.parse(JSON.stringify(actual.state));
      }
      const fresh = createArduinoCircuitClockExecutor(document)(20000);
      expect(JSON.stringify(state)).toBe(JSON.stringify(fresh.state));
      const reversed = {
        ...document,
        components: [...document.components].reverse(),
        connections: [...document.connections].reverse(),
      };
      const reordered = createArduinoCircuitClockExecutor(reversed)(20000);
      expect(reordered.executionStatus).toBe('ready');
      expect(reordered.result?.quality.passed).toBe(true);
      const byId = (result: typeof fresh.result) =>
        [...result!.components]
          .sort((a, b) =>
            a.componentId < b.componentId ? -1 : a.componentId > b.componentId ? 1 : 0,
          )
          .map((c) => [
            c.componentId,
            c.current,
            c.branchCurrents,
            c.baseCurrent,
            c.collectorCurrent,
          ]);
      expect(byId(reordered.result)).toEqual(byId(fresh.result));
    },
  );
});
