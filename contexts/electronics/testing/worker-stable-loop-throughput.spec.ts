import { describe, expect, it, vi } from 'vitest';
import {
  createElectronicsAdvanceSession,
  parseElectronicsEngineDocument,
  type ElectronicsEngineDocument,
  type ElectronicsTimedAdvanceRequest,
} from '../engine';
import * as arduinoRuntime from '../domain/arduino-program-runtime';
import * as solver from '../domain/solver';

function eventCircuit(source: string): ElectronicsEngineDocument {
  const parsed = parseElectronicsEngineDocument({
    schemaVersion: 4,
    components: [
      {
        id: 'uno',
        kind: 'visual',
        value: 5,
        position: { x: 0, y: 0 },
        componentTypeId: 'arduino-uno',
        pinIds: ['d13', 'power-5v', 'power-3v3', 'power-gnd-1'],
        stateProperties: { arduinoSource: source },
      },
      {
        id: 'r',
        kind: 'resistor',
        value: 330,
        position: { x: 100, y: 0 },
        componentTypeId: 'resistor-axial',
        pinIds: ['lead-1', 'lead-2'],
      },
    ],
    connections: [
      {
        id: 'w0',
        from: { componentId: 'uno', terminal: 'd13' },
        to: { componentId: 'r', terminal: 'lead-1' },
      },
      {
        id: 'w1',
        from: { componentId: 'r', terminal: 'lead-2' },
        to: { componentId: 'uno', terminal: 'power-gnd-1' },
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

function finish(
  document: ElectronicsEngineDocument,
  request: ElectronicsTimedAdvanceRequest,
  options: Parameters<typeof createElectronicsAdvanceSession>[2],
) {
  const session = createElectronicsAdvanceSession(document, request, options);
  try {
    for (let steps = 1; steps <= 100_000; steps += 1) {
      const result = session.step();
      if (result) return { result, steps };
    }
    throw new Error('Electronics advance session did not finish');
  } finally {
    session.dispose();
  }
}

describe('Worker stable-loop throughput', () => {
  it('coalesces latched literal loops with the same continuation and thermal checkpoints', () => {
    const document = eventCircuit(
      'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);}',
    );
    const solve = vi.spyOn(solver, 'solveRcCircuitWithHeldArduino');
    try {
      const request = { requestedHorizonMicroseconds: 3_333 };
      const optical = { observeLedTemporal: true, observeSevenSegmentTemporal: true };
      const before = finish(document, request, optical);
      const solveTimes = solve.mock.calls.map(([, time]) => time);
      expect(solveTimes).toEqual(expect.arrayContaining([0, 1, 2, 3, 3.333]));
      solve.mockClear();
      const worker = { ...optical, coalesceStableLoopInstructions: true };
      const after = finish(document, request, worker);
      expect(after.result).toStrictEqual(before.result);
      expect(after.steps).toBeLessThan(before.steps);
      expect(solve.mock.calls.map(([, time]) => time)).toEqual(solveTimes);

      const explicitBudget = { ...request, maxEvents: 256 };
      expect(finish(document, explicitBudget, worker)).toStrictEqual(
        finish(document, explicitBudget, optical),
      );

      const withInput = {
        ...request,
        inputEvents: [
          { atMicroseconds: 1_000, targetId: 'uno', operation: 'serialRx', payload: 'A' },
        ],
      };
      const inputResult = finish(document, withInput, worker);
      expect(inputResult.result.executionStatus).toBe('ready');
      expect(inputResult).toStrictEqual(finish(document, withInput, optical));
      const continued = { requestedHorizonMicroseconds: 5_000, state: inputResult.result.state };
      expect(finish(document, continued, worker)).toStrictEqual(
        finish(document, continued, optical),
      );
    } finally {
      solve.mockRestore();
    }
  });

  it('coalesces stable millis loops without crossing GPIO or thermal boundaries', () => {
    const document = eventCircuit(`
      unsigned long nextChange = 1;
      bool high = LOW;
      void setup() { pinMode(13, OUTPUT); }
      void loop() {
        unsigned long now = millis();
        if (now >= nextChange) {
          nextChange += 2;
          high = !high;
          digitalWrite(13, high);
        }
      }
    `);
    const solve = vi.spyOn(solver, 'solveRcCircuitWithHeldArduino');
    try {
      const request = { requestedHorizonMicroseconds: 3_333 };
      const optical = { observeLedTemporal: true, observeSevenSegmentTemporal: true };
      const before = finish(document, request, optical);
      expect(before.result.executionStatus).toBe('ready');
      const solveTimes = solve.mock.calls.map(([, time]) => time);
      solve.mockClear();
      const worker = { ...optical, coalesceStableLoopInstructions: true };
      const after = finish(document, request, worker);
      expect(after.result).toStrictEqual(before.result);
      expect(after.steps).toBeLessThan(before.steps);
      expect(solve.mock.calls.map(([, time]) => time)).toEqual(solveTimes);
      const samples = after.result.observation?.ledTemporal?.arduinoIndicators?.[0]?.samples;
      expect(
        samples?.map(({ atMicroseconds, voltage }) => [atMicroseconds, voltage >= 2.5]),
      ).toEqual([
        [0, false],
        [1_006, true],
        [3_006, false],
        [3_333, false],
      ]);
      const explicitBudget = { ...request, maxEvents: 256 };
      expect(finish(document, explicitBudget, worker)).toStrictEqual(
        finish(document, explicitBudget, optical),
      );
    } finally {
      solve.mockRestore();
    }
  });

  it('keeps a millis partial iteration within the ordinary instruction budget', () => {
    const source = `void setup(){}void loop(){unsigned long now=millis();${'now += 0;'.repeat(178)}}`;
    const initial = arduinoRuntime.advanceClockedArduinoRuntime(source, {}, 0).state;
    const runtime = () =>
      arduinoRuntime.createOwnedClockedArduinoRuntime(source, initial, {
        accountForStableLoops: true,
      })!;
    const reference = runtime();
    const candidate = runtime();
    try {
      const before = reference.advance(0.999, 256, true);
      const after = candidate.advance(0.999, 256, true, 1_000);
      expect(after).toStrictEqual(before);
      expect(after.executionStatus).toBe('yielded');
      expect(after.executedInstructions).toBe(256);
    } finally {
      reference.dispose();
      candidate.dispose();
    }
  });

  it.each([5, -0])('executes a literal write with an unlatched output %s', (voltage) => {
    const source = 'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,LOW);}';
    const initial = arduinoRuntime.advanceClockedArduinoRuntime(source, {}, 0.05).state;
    const unlatched = { ...initial, outputVoltages: { ...initial.outputVoltages, d13: voltage } };
    const reference = arduinoRuntime.createOwnedClockedArduinoRuntime(source, unlatched, {
      accountForStableLoops: true,
    })!;
    const candidate = arduinoRuntime.createOwnedClockedArduinoRuntime(source, unlatched, {
      accountForStableLoops: true,
    })!;
    const result = candidate.advance(0.9, 256, true, 1_000);
    expect(result).toStrictEqual(reference.advance(0.9, 1024, true));
    expect(result.loopActions).toContainEqual({ kind: 'write', terminal: 'd13', targetVoltage: 0 });
    expect(result.events).toHaveLength(voltage === 5 ? 1 : 0);
    expect(Object.is(result.state.outputVoltages.d13, 0)).toBe(true);
    reference.dispose();
    candidate.dispose();
  });
});
