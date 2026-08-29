import { describe, expect, it } from 'vitest';
import type {
  ComponentKind,
  ElectronicsDocument,
  SchematicComponent,
  Terminal,
} from '../domain/document';
import { parseElectronicsDocument } from '../domain/document';
import { analyseCircuit } from '../domain/simulation';

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
    color: '#159447',
    vertices: [],
  };
}

function document(
  components: readonly SchematicComponent[],
  connections: readonly ReturnType<typeof connect>[],
): ElectronicsDocument {
  const parsed = parseElectronicsDocument({
    schemaVersion: 4,
    components,
    connections,
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: true, maxIterations: 32 },
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

describe('MATH-4B2 adaptive thermal transient', () => {
  it('rejects an inaccurate large step and remains close to the analytical RC curve', () => {
    const circuit = document(
      [
        component('source', 'source', 5),
        component('r1', 'resistor', 100),
        component('c1', 'visual', 1, {
          componentTypeId: 'electrolytic-capacitor',
          pinIds: ['negative', 'positive'],
          stateProperties: { voltageRatingVolt: 25, initialVoltageVolt: 0 },
        }),
      ],
      [
        connect('w1', 'source', 'a', 'r1', 'a'),
        connect('w2', 'r1', 'b', 'c1', 'positive'),
        connect('w3', 'c1', 'negative', 'source', 'b'),
      ],
    );

    const result = analyseCircuit(circuit, { simulationTimeMs: 1 });
    const voltage = result.components.find((entry) => entry.componentId === 'c1')?.voltageDrop;

    expect(result).toMatchObject({
      solved: true,
      quality: { finite: true, passed: true },
      transientAnalysis: { rejectedSteps: expect.any(Number) },
    });
    expect(result.transientAnalysis?.rejectedSteps).toBeGreaterThan(0);
    expect(voltage).toBeCloseTo(5 * (1 - Math.exp(-10)), 1);
    expect(JSON.stringify(result)).toBe(
      JSON.stringify(analyseCircuit(circuit, { simulationTimeMs: 1 })),
    );
  });

  it('accumulates overload before failure, opens the failed LED and recalculates the circuit', () => {
    const circuit = document(
      [
        component('source', 'source', 3, {
          stateProperties: { internalResistanceOhm: 0.1, maxContinuousCurrentAmp: 100 },
        }),
        component('led', 'led', 2, {
          componentTypeId: 'led-5mm',
          pinIds: ['cathode', 'anode'],
          stateProperties: { ledColour: 'red' },
        }),
      ],
      [
        connect('w1', 'source', 'a', 'led', 'anode'),
        connect('w2', 'led', 'cathode', 'source', 'b'),
      ],
    );
    const beforeFailure = analyseCircuit(circuit, { simulationTimeMs: 10 });
    if (!beforeFailure.transientState) throw new Error('transient state missing');
    const overheated = analyseCircuit(circuit, {
      simulationTimeMs: 2_500,
      transientState: beforeFailure.transientState,
    });
    if (!overheated.transientState) throw new Error('overheated transient state missing');
    const afterFailure = analyseCircuit(circuit, {
      simulationTimeMs: 4_500,
      transientState: overheated.transientState,
    });
    const beforeLed = beforeFailure.components.find((entry) => entry.componentId === 'led');
    const overheatedLed = overheated.components.find((entry) => entry.componentId === 'led');
    const failedLed = afterFailure.components.find((entry) => entry.componentId === 'led');

    expect(beforeLed).toMatchObject({ damageState: 'none', presentationState: 'warning' });
    expect(beforeLed?.current).toBeGreaterThan(0);
    expect(overheatedLed).toMatchObject({
      damageState: 'none',
      presentationState: 'destructive',
      deviceHealth: 'overheated',
    });
    expect(failedLed).toMatchObject({
      current: 0,
      power: 0,
      brightness: 0,
      deviceHealth: 'failed_open',
      damageState: 'failed',
      presentationState: 'failed',
      accumulatedDamagePercent: 100,
    });
    expect(afterFailure.solved).toBe(true);
    expect(afterFailure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'led_burnout', componentIds: ['led'] }),
      ]),
    );
  });

  it('does not persist runtime damage into a new simulation start', () => {
    const circuit = document(
      [
        component('source', 'source', 12, {
          stateProperties: { internalResistanceOhm: 0.01, maxContinuousCurrentAmp: 1_000 },
        }),
        component('r1', 'resistor', 1, { stateProperties: { powerRatingWatt: 0.25 } }),
      ],
      [connect('w1', 'source', 'a', 'r1', 'a'), connect('w2', 'r1', 'b', 'source', 'b')],
    );
    const failed = analyseCircuit(circuit, { simulationTimeMs: 1_000 });
    const restarted = analyseCircuit(circuit, { simulationTimeMs: 1 });

    expect(failed.components.find((entry) => entry.componentId === 'r1')).toMatchObject({
      damageState: 'failed',
      current: 0,
    });
    expect(restarted.components.find((entry) => entry.componentId === 'r1')).toMatchObject({
      damageState: 'none',
    });
  });

  it('keeps an asymmetric two-NPN astable changing state on deterministic model time', () => {
    const npn = (id: string): SchematicComponent =>
      component(id, 'transistor', 100, {
        componentTypeId: 'transistor-npn',
        pinIds: ['collector', 'base', 'emitter'],
        stateProperties: { transistorType: 'npn', currentGain: 100 },
      });
    const cap = (id: string, initialVoltageVolt: number): SchematicComponent =>
      component(id, 'visual', 10, {
        componentTypeId: 'electrolytic-capacitor',
        pinIds: ['negative', 'positive'],
        stateProperties: { voltageRatingVolt: 25, initialVoltageVolt },
      });
    const circuit = document(
      [
        component('source', 'source', 5, {
          stateProperties: { internalResistanceOhm: 0.1, maxContinuousCurrentAmp: 5 },
        }),
        component('rc1', 'resistor', 1_000),
        component('rc2', 'resistor', 1_000),
        component('rb1', 'resistor', 10_000),
        component('rb2', 'resistor', 10_000),
        npn('q1'),
        npn('q2'),
        cap('c1', 0),
        cap('c2', 4),
      ],
      [
        connect('w1', 'source', 'a', 'rc1', 'a'),
        connect('w2', 'rc1', 'b', 'q1', 'collector'),
        connect('w3', 'source', 'a', 'rc2', 'a'),
        connect('w4', 'rc2', 'b', 'q2', 'collector'),
        connect('w5', 'source', 'a', 'rb1', 'a'),
        connect('w6', 'rb1', 'b', 'q1', 'base'),
        connect('w7', 'source', 'a', 'rb2', 'a'),
        connect('w8', 'rb2', 'b', 'q2', 'base'),
        connect('w9', 'q1', 'emitter', 'source', 'b'),
        connect('w10', 'q2', 'emitter', 'source', 'b'),
        connect('w11', 'c1', 'positive', 'q1', 'collector'),
        connect('w12', 'c1', 'negative', 'q2', 'base'),
        connect('w13', 'c2', 'positive', 'q2', 'collector'),
        connect('w14', 'c2', 'negative', 'q1', 'base'),
      ],
    );
    let previous = analyseCircuit(circuit, { simulationTimeMs: 1 });
    const states: string[] = [];
    for (let timeMs = 21; timeMs <= 2_001; timeMs += 20) {
      previous = analyseCircuit(circuit, {
        simulationTimeMs: timeMs,
        ...(previous.transientState ? { transientState: previous.transientState } : {}),
      });
      const q1 = previous.components.find((entry) => entry.componentId === 'q1');
      const q2 = previous.components.find((entry) => entry.componentId === 'q2');
      states.push(
        `${q1?.operatingRegion}:${q1?.voltageDrop.toFixed(2)}/${q2?.operatingRegion}:${q2?.voltageDrop.toFixed(2)}`,
      );
    }

    expect(previous).toMatchObject({ solved: true, quality: { finite: true, passed: true } });
    expect(new Set(states).size).toBeGreaterThan(1);
    expect(
      states.some((state) => state.startsWith('saturation:') && !state.includes('/saturation:')),
    ).toBe(true);
    expect(
      states.some((state) => !state.startsWith('saturation:') && state.includes('/saturation:')),
    ).toBe(true);
  });
});
