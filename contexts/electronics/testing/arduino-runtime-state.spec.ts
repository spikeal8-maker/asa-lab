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
    expect(atStart.state).toMatchObject({
      phase: 'loop',
      programCounter: 2,
      resumeAtMs: 100,
    });
    expect(beforeLow.state.outputVoltages.d13).toBe(5);
    expect(atLow.state.outputVoltages.d13).toBe(0);
    expect(beforeNextLoop.state.outputVoltages.d13).toBe(0);
    expect(atNextLoop.state.outputVoltages.d13).toBe(5);
    expect(atNextLoop.state.loopIterations).toBe(2);
  });

  it('emits ordered GPIO events and carries a bounded serializable queue', () => {
    const source = `
      void setup() { pinMode(13, OUTPUT); }
      void loop() {
        digitalWrite(13, HIGH);
        delay(100);
        digitalWrite(13, LOW);
        delay(100);
      }
    `;

    const atStart = advanceArduinoRuntime(source, {}, 0);
    const duplicate = advanceArduinoRuntime(source, {}, 0, atStart.state);
    const atLow = advanceArduinoRuntime(source, {}, 100, duplicate.state);

    expect(atStart.events).toEqual([
      expect.objectContaining({
        sequence: 0,
        atMicroseconds: 0,
        kind: 'pin-mode-change',
        terminal: 'd13',
        mode: 'OUTPUT',
      }),
      expect.objectContaining({
        sequence: 1,
        atMicroseconds: 0,
        kind: 'output-change',
        terminal: 'd13',
        voltage: 0,
      }),
      expect.objectContaining({
        sequence: 2,
        atMicroseconds: 0,
        kind: 'output-change',
        terminal: 'd13',
        voltage: 5,
      }),
    ]);
    expect(duplicate.events).toEqual([]);
    expect(atLow.events).toEqual([
      expect.objectContaining({
        sequence: 3,
        atMicroseconds: 100_000,
        kind: 'output-change',
        voltage: 0,
      }),
    ]);
    expect(atLow.state.nextEventSequence).toBe(4);
    expect(atLow.state.eventQueue).toEqual([...atStart.events, ...atLow.events]);
  });

  it('resumes after delay before mutating globals or evaluating the next branch', () => {
    const source = `
      int count = 0;
      long observedAt = -1;
      void setup() { pinMode(13, OUTPUT); }
      void loop() {
        count++;
        digitalWrite(13, HIGH);
        delay(100);
        count += 10;
        observedAt = millis();
        if (count == 11) {
          digitalWrite(13, LOW);
        } else {
          digitalWrite(13, HIGH);
        }
        delay(100);
      }
    `;

    const atStart = advanceArduinoRuntime(source, {}, 0);
    const beforeResume = advanceArduinoRuntime(source, {}, 99, atStart.state);
    const atResume = advanceArduinoRuntime(source, {}, 100, beforeResume.state);
    const beforeNextIteration = advanceArduinoRuntime(source, {}, 199, atResume.state);
    const nextIteration = advanceArduinoRuntime(source, {}, 200, beforeNextIteration.state);

    expect(atStart.state.variables).toMatchObject({ count: 1, observedAt: -1 });
    expect(beforeResume.state.variables).toMatchObject({ count: 1, observedAt: -1 });
    expect(atResume.state.variables).toMatchObject({ count: 11, observedAt: 100 });
    expect(atResume.state.outputVoltages.d13).toBe(0);
    expect(beforeNextIteration.state.variables.count).toBe(11);
    expect(nextIteration.state.variables.count).toBe(12);
    expect(nextIteration.state.outputVoltages.d13).toBe(5);
  });

  it('keeps loop locals and control flow suspended across a delay', () => {
    const source = `
      int total = 0;
      void loop() {
        for (int index = 0; index < 3; index++) {
          delay(10);
          total += index + 1;
        }
        delay(100);
      }
    `;

    const atStart = advanceArduinoRuntime(source, {}, 0);
    const afterFirstDelay = advanceArduinoRuntime(source, {}, 10, atStart.state);
    const afterSecondDelay = advanceArduinoRuntime(source, {}, 20, afterFirstDelay.state);
    const afterThirdDelay = advanceArduinoRuntime(source, {}, 30, afterSecondDelay.state);

    expect(atStart.state.variables.total).toBe(0);
    expect(atStart.state.locals.index).toBe(0);
    expect(afterFirstDelay.state.variables.total).toBe(1);
    expect(afterFirstDelay.state.locals.index).toBe(1);
    expect(afterSecondDelay.state.variables.total).toBe(3);
    expect(afterSecondDelay.state.locals.index).toBe(2);
    expect(afterThirdDelay.state.variables.total).toBe(6);
    expect(afterThirdDelay.state.locals.index).toBe(3);
  });

  it('samples a changed digital input when execution actually resumes', () => {
    const source = `
      void setup() { pinMode(13, OUTPUT); }
      void loop() {
        delay(100);
        digitalWrite(13, digitalRead(2));
        delay(100);
      }
    `;
    const lowInput = { d2: 0, 'power-5v': 5, 'power-gnd-1': 0 } as const;
    const highInput = { d2: 5, 'power-5v': 5, 'power-gnd-1': 0 } as const;

    const atStart = advanceArduinoRuntime(source, lowInput, 0);
    const atResume = advanceArduinoRuntime(source, highInput, 100, atStart.state);

    expect(atStart.state.outputVoltages.d13).toBe(0);
    expect(atResume.state.outputVoltages.d13).toBe(5);
  });

  it('finishes a delayed setup before starting the first loop iteration', () => {
    const source = `
      int phaseValue = 0;
      void setup() {
        pinMode(13, OUTPUT);
        phaseValue = 1;
        delay(50);
        phaseValue = 2;
        digitalWrite(13, HIGH);
      }
      void loop() {
        phaseValue += 1;
        delay(100);
      }
    `;

    const atStart = advanceArduinoRuntime(source, {}, 0);
    const beforeSetupResume = advanceArduinoRuntime(source, {}, 49, atStart.state);
    const afterSetupResume = advanceArduinoRuntime(source, {}, 50, beforeSetupResume.state);

    expect(atStart.state).toMatchObject({
      phase: 'setup',
      loopIterations: 0,
      variables: { phaseValue: 1 },
      outputVoltages: { d13: 0 },
    });
    expect(beforeSetupResume.state.variables.phaseValue).toBe(1);
    expect(afterSetupResume.state).toMatchObject({
      phase: 'loop',
      loopIterations: 1,
      variables: { phaseValue: 3 },
      outputVoltages: { d13: 5 },
    });
  });

  it('expires a duration-limited tone while the sketch is suspended', () => {
    const source = `
      void loop() {
        tone(8, 440, 50);
        delay(100);
        noTone(8);
        delay(100);
      }
    `;

    const atStart = advanceArduinoRuntime(source, {}, 0);
    const beforeExpiry = advanceArduinoRuntime(source, {}, 49, atStart.state);
    const atExpiry = advanceArduinoRuntime(source, {}, 50, beforeExpiry.state);

    expect(atStart.state.tones.d8?.frequencyHz).toBe(440);
    expect(beforeExpiry.state.tones.d8?.frequencyHz).toBe(440);
    expect(atExpiry.state.tones.d8).toBeUndefined();
    expect(atStart.events).toContainEqual(
      expect.objectContaining({ kind: 'tone-start', terminal: 'd8', frequencyHz: 440 }),
    );
    expect(atExpiry.events).toContainEqual(
      expect.objectContaining({
        kind: 'tone-stop',
        terminal: 'd8',
        atMicroseconds: 50_000,
      }),
    );
  });

  it('bounds the persistent event queue without reordering new events', () => {
    const writes = Array.from(
      { length: 300 },
      (_, index) => `digitalWrite(13, ${index % 2 === 0 ? 'LOW' : 'HIGH'});`,
    ).join('\n');
    const result = advanceArduinoRuntime(
      `void setup() { pinMode(13, OUTPUT); } void loop() { ${writes} delay(100); }`,
      {},
      0,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.events.length).toBeGreaterThan(256);
    expect(result.state.eventQueue).toHaveLength(256);
    expect(result.state.eventQueue.at(-1)?.sequence).toBe(result.state.nextEventSequence - 1);
    expect(result.state.eventQueue[0]?.sequence).toBe(result.state.nextEventSequence - 256);
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

  it('fails closed instead of partially executing a command without a semicolon', () => {
    const result = advanceArduinoRuntime(
      `
        void setup() { pinMode(13, OUTPUT); }
        void loop() {
          digitalWrite(13, HIGH)
        }
      `,
      {},
      0,
    );

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'compile_error',
        severity: 'error',
        message: expect.stringContaining('точкой с запятой'),
      }),
    ]);
    expect(result.setupActions).toEqual([]);
    expect(result.loopActions).toEqual([]);
    expect(result.state).toMatchObject({
      phase: 'setup',
      loopIterations: 0,
      variables: {},
      pinModes: {},
      outputVoltages: {},
    });
  });

  it('fails closed on unmatched source delimiters', () => {
    const result = advanceArduinoRuntime(
      'void loop() { if (digitalRead(2) == HIGH) { digitalWrite(13, HIGH); }',
      {},
      0,
    );

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'compile_error',
        message: expect.stringContaining('закрывающая скобка'),
      }),
    ]);
    expect(result.state.outputVoltages).toEqual({});
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
