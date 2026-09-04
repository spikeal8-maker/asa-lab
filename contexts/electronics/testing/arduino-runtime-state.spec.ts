import { describe, expect, it } from 'vitest';
import { advanceArduinoRuntime, resetArduinoRuntime } from '../domain/arduino-program-runtime.js';

describe('Arduino persistent runtime state', () => {
  it('runs setup once, repeats loop on virtual time and preserves globals', () => {
    const source = `
      int setupCount = 0;
      int loopCount = 0;
      long lastMillis = -1;

      void setup() {
        setupCount += 1;
        pinMode(13, OUTPUT);
      }

      void loop() {
        loopCount += 1;
        lastMillis = millis();
        delay(100);
      }
    `;

    const started = advanceArduinoRuntime(source, {}, 0);
    expect(started.state.variables).toMatchObject({
      setupCount: 1,
      loopCount: 1,
      lastMillis: 0,
    });
    expect(started.state.loopIterations).toBe(1);
    expect(started.setupActions).not.toHaveLength(0);

    const duplicateSample = advanceArduinoRuntime(source, {}, 0, started.state);
    expect(duplicateSample.state).toEqual(started.state);
    expect(duplicateSample.setupActions).toEqual([]);
    expect(duplicateSample.loopActions).toEqual([]);

    const beforeNextLoop = advanceArduinoRuntime(source, {}, 99, duplicateSample.state);
    expect(beforeNextLoop.state.variables).toMatchObject({
      setupCount: 1,
      loopCount: 1,
      lastMillis: 0,
    });
    expect(beforeNextLoop.state.loopIterations).toBe(1);

    const nextLoop = advanceArduinoRuntime(source, {}, 100, beforeNextLoop.state);
    expect(nextLoop.state.variables).toMatchObject({
      setupCount: 1,
      loopCount: 2,
      lastMillis: 100,
    });
    expect(nextLoop.state.loopIterations).toBe(2);
    expect(nextLoop.setupActions).toEqual([]);

    const reset = resetArduinoRuntime(source, {}, 0);
    expect(reset.state.variables).toMatchObject({ setupCount: 1, loopCount: 1 });
    expect(reset.state.loopIterations).toBe(1);
    expect(reset.setupActions).not.toHaveLength(0);
  });

  it('carries pin latches through delay boundaries without applying future writes early', () => {
    const source = `
      void setup() {
        pinMode(13, OUTPUT);
      }
      void loop() {
        digitalWrite(13, HIGH);
        delay(100);
        digitalWrite(13, LOW);
        delay(100);
      }
    `;

    const atStart = advanceArduinoRuntime(source, {}, 0);
    const beforeLow = advanceArduinoRuntime(source, {}, 99, atStart.state);
    const atLow = advanceArduinoRuntime(source, {}, 100, beforeLow.state);
    const beforeNextLoop = advanceArduinoRuntime(source, {}, 199, atLow.state);
    const atNextLoop = advanceArduinoRuntime(source, {}, 200, beforeNextLoop.state);

    expect(atStart.state.pinModes.d13).toBe('OUTPUT');
    expect(atStart.state.outputVoltages.d13).toBe(5);
    expect(atStart.state.pendingActions).toHaveLength(1);
    expect(beforeLow.state.outputVoltages.d13).toBe(5);
    expect(atLow.state.outputVoltages.d13).toBe(0);
    expect(beforeNextLoop.state.outputVoltages.d13).toBe(0);
    expect(atNextLoop.state.outputVoltages.d13).toBe(5);
    expect(atNextLoop.state.loopIterations).toBe(2);
  });

  it('executes finite for and while loops with bounded C++ semantics', () => {
    const result = advanceArduinoRuntime(
      `
        int counter = 0;
        void loop() {
          for (int index = 0; index < 3; index++) {
            counter += 1;
          }
          int remaining = 2;
          while (remaining > 0) {
            counter += 10;
            remaining--;
          }
          delay(10);
        }
      `,
      {},
      0,
    );

    expect(result.state.variables).toEqual({ counter: 23 });
    expect(result.diagnostics).toEqual([]);
  });

  it('recreates loop-local variables instead of persisting them as MCU globals', () => {
    const source = `
      int total = 0;
      void loop() {
        int local = 0;
        local++;
        total += local;
        delay(10);
      }
    `;

    const first = advanceArduinoRuntime(source, {}, 0);
    const second = advanceArduinoRuntime(source, {}, 10, first.state);

    expect(first.state.variables).toEqual({ total: 1 });
    expect(second.state.variables).toEqual({ total: 2 });
  });

  it('fails an infinite loop closed at the statement budget', () => {
    const result = advanceArduinoRuntime(
      `
        int counter = 0;
        void loop() {
          while (1) {
            counter++;
          }
        }
      `,
      {},
      0,
    );

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'statement_budget_exceeded',
        severity: 'error',
      }),
    ]);
    expect(Number.isFinite(result.state.variables.counter)).toBe(true);
  });

  it('bounds a large virtual-time jump across loop iterations', () => {
    const result = advanceArduinoRuntime(
      `
        int counter = 0;
        void loop() {
          counter++;
        }
      `,
      {},
      100_000,
    );

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'loop_advance_budget_exceeded',
        severity: 'error',
      }),
    ]);
    expect(result.state.loopIterations).toBe(4_096);
    expect(result.state.variables.counter).toBe(4_096);
  });

  it('resets on a changed sketch and remains byte-for-byte deterministic', () => {
    const firstSource = 'int count = 0; void loop() { count += 1; delay(5); }';
    const changedSource = 'int count = 40; void loop() { count += 2; delay(5); }';
    const first = advanceArduinoRuntime(firstSource, {}, 0);

    const left = advanceArduinoRuntime(firstSource, {}, 5, first.state);
    const right = advanceArduinoRuntime(firstSource, {}, 5, first.state);
    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
    expect(left.state.variables.count).toBe(2);

    const changed = advanceArduinoRuntime(changedSource, {}, 5, left.state);
    expect(changed.state.variables.count).toBe(42);
    expect(changed.state.loopIterations).toBe(1);
    expect(changed.state.programFingerprint).not.toBe(left.state.programFingerprint);
  });

  it('rejects forged carried output state instead of sourcing an impossible voltage', () => {
    const source = `
      int count = 0;
      void setup() { pinMode(13, OUTPUT); }
      void loop() {
        count++;
        digitalWrite(13, HIGH);
        delay(100);
      }
    `;
    const started = advanceArduinoRuntime(source, {}, 0);
    const forged = {
      ...started.state,
      outputVoltages: { ...started.state.outputVoltages, d13: 12 },
    };

    const restarted = advanceArduinoRuntime(source, {}, 100, forged);

    expect(restarted.state.loopIterations).toBe(1);
    expect(restarted.state.variables.count).toBe(1);
    expect(restarted.state.outputVoltages.d13).toBe(5);
  });
});
