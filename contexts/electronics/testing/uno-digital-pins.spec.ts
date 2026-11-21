import { describe, expect, it } from 'vitest';
import {
  advanceArduinoRuntime,
  advanceClockedArduinoRuntime,
  type ArduinoRuntimeState,
} from '../domain/arduino-program-runtime.js';
import {
  arduinoOutputBranchesFromSnapshot,
  arduinoSnapshotFromState,
} from '../domain/arduino-model.js';
import { solveCircuit } from '../domain/solver.js';
import {
  unoDigitalDocument,
  unoDigitalSource,
  unoDigitalTerminals,
} from './uno-digital-pins.fixture.js';

describe('Uno twenty independent digital outputs (existing capability)', () => {
  it.each([0, 1, 2, 3, 4, 5])('A%i equals its numeric alias without touching D0-D5', (i) => {
    for (const level of ['LOW', 'HIGH']) {
      const source = (pin: string) =>
        `void setup(){pinMode(${pin},OUTPUT);digitalWrite(${pin},${level});}void loop(){delay(100);}`;
      const alias = advanceArduinoRuntime(source(`A${i}`));
      const numeric = advanceArduinoRuntime(source(String(14 + i)));
      const computed = advanceArduinoRuntime(
        `int port=14;void setup(){port+=${i};pinMode(port,OUTPUT);digitalWrite(port+0,${level});}void loop(){delay(100);}`,
      );
      expect(alias.diagnostics).toEqual([]);
      expect(numeric.diagnostics).toEqual([]);
      expect(computed.diagnostics).toEqual([]);
      const voltages = { [`a${i}`]: level === 'HIGH' ? 5 : 0 };
      for (const result of [alias, numeric, computed]) {
        expect(result.state.outputVoltages).toEqual(voltages);
        expect(result.state.pinModes).toEqual({ [`a${i}`]: 'OUTPUT' });
      }
    }
  });

  const patterns = [
    ...unoDigitalTerminals.map((_, i) => [i]),
    [],
    unoDigitalTerminals.map((_, i) => i),
    [0, 2, 4, 6, 8, 10, 12, 14, 16, 18],
    [1, 5, 13, 14, 19],
  ];
  it.each(patterns.map((high) => [high.join(',') || 'all LOW', high] as const))(
    'physical one-hot/mixed pattern %s',
    (_, high) => {
      const source = unoDigitalSource(high);
      const document = unoDigitalDocument(source);
      const runtime = advanceArduinoRuntime(source);
      const snapshot = arduinoSnapshotFromState(runtime.state);
      const branches = arduinoOutputBranchesFromSnapshot(document.components[0]!, snapshot).filter(
        (b) => unoDigitalTerminals.includes(b.terminal),
      );
      expect(branches).toHaveLength(20);
      for (const [i, terminal] of unoDigitalTerminals.entries())
        expect(branches.find((b) => b.terminal === terminal)?.targetVoltage).toBe(
          high.includes(i) ? 5 : 0,
        );
      const result = solveCircuit(document);
      expect(result.solved, JSON.stringify(result.diagnostics)).toBe(true);
      expect(result.status).toBe('solved');
      expect(result.numericalResidual).toBeLessThanOrEqual(result.numericalTolerance);
      expect(result.diagnostics.filter((d) => d.severity !== 'info')).toEqual([]);
      const board = result.components.find((c) => c.componentId === 'uno')!;
      for (const [i, terminal] of unoDigitalTerminals.entries()) {
        const led = result.components.find((c) => c.componentId === `led${i}`)!;
        const resistor = result.components.find((c) => c.componentId === `r${i}`)!;
        const current = Math.abs(led.current);
        expect(Number.isFinite(current)).toBe(true);
        expect(Math.abs(resistor.current)).toBeCloseTo(current, 8);
        const branch = branches.find((b) => b.terminal === terminal)!;
        const delivered =
          (branch.targetVoltage -
            (board.terminalVoltages[terminal]! - board.terminalVoltages[branch.ground]!)) /
          branch.resistanceOhm;
        expect(Math.abs(delivered)).toBeCloseTo(current, 7);
        expect(Math.abs(resistor.voltageDrop / 1000)).toBeCloseTo(current, 7);
        if (high.includes(i)) {
          expect(current).toBeGreaterThan(0.001);
          expect(current).toBeLessThan(0.005);
          expect(led.brightness).toBeGreaterThan(0);
        } else {
          expect(current).toBeLessThan(1e-8);
          expect(led.brightness).toBe(0);
        }
      }
      for (const node of result.nodes) expect(Number.isFinite(node.voltage)).toBe(true);
      expect(
        result.components
          .filter((c) => c.componentId.startsWith('led'))
          .reduce((sum, c) => sum + Math.abs(c.current), 0),
      ).toBeLessThan(0.1);
      expect(solveCircuit(document)).toEqual(result);
    },
  );

  it('preserves exact outputs/events with tiny budgets and JSON continuation', () => {
    const source = unoDigitalSource([0, 13, 14, 19]).replace(
      '}void loop()',
      'delay(1);digitalWrite(A0,LOW);digitalWrite(0,LOW);}void loop()',
    );
    const drain = (budget: number) => {
      let previous: ArduinoRuntimeState | undefined;
      const events = [];
      for (let slice = 0; slice < 10000; slice++) {
        const result = advanceClockedArduinoRuntime(source, {}, 10, previous, undefined, {
          instructionBudget: budget,
        });
        expect(result.diagnostics).toEqual([]);
        events.push(...result.events);
        if (result.executionStatus !== 'yielded') return { state: result.state, events };
        previous = JSON.parse(JSON.stringify(result.state));
      }
      throw new Error('Continuation did not finish');
    };
    const expected = drain(16384);
    expect(drain(1)).toEqual(expected);
    expect(drain(7)).toEqual(expected);
    expect(expected.state.outputVoltages).toMatchObject({ d0: 0, d13: 5, a0: 0, a5: 5 });
  });

  it('keeps analogRead, invalid-pin no-op, byte conversion and non-PWM threshold semantics', () => {
    const read = advanceArduinoRuntime(
      'int value=0;void setup(){value=analogRead(A0);}void loop(){delay(100);}',
      { a0: 2.5 },
    );
    expect(read.state.variables.value).toBe(512);
    expect(read.state.outputVoltages).toEqual({});
    for (const pin of [20, 255]) {
      const invalid = advanceArduinoRuntime(
        `void setup(){pinMode(${pin},OUTPUT);digitalWrite(${pin},HIGH);}void loop(){delay(100);}`,
      );
      expect(invalid.state.outputVoltages).toEqual({});
    }
    expect(
      advanceArduinoRuntime(
        'void setup(){pinMode(256,OUTPUT);digitalWrite(256,HIGH);}void loop(){delay(100);}',
      ).state.outputVoltages,
    ).toEqual({ d0: 5 });
    for (const value of [0, 127, 128, 255]) {
      const pwm = advanceArduinoRuntime(
        `void setup(){pinMode(A0,OUTPUT);analogWrite(A0,${value});}void loop(){delay(100);}`,
      );
      expect(pwm.diagnostics).toEqual([]);
      expect(pwm.state.outputVoltages).toEqual({ a0: value < 128 ? 0 : 5 });
    }
  });
});
