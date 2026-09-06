import { describe, expect, it } from 'vitest';
import {
  advanceArduinoRuntime,
  advanceClockedArduinoRuntime,
  type ArduinoInputReader,
  type ArduinoRuntimeEvent,
  type ArduinoRuntimeState,
} from '../domain/arduino-program-runtime.js';

/** Drain only in the test harness. Production must yield to its shared scheduler. */
function through(
  source: string,
  time: number,
  previous?: ArduinoRuntimeState,
  readInputs?: ArduinoInputReader,
  instructionBudget = 16_384,
) {
  const events: ArduinoRuntimeEvent[] = [];
  for (let quantum = 0; quantum < 100_000; quantum++) {
    const result = advanceClockedArduinoRuntime(source, {}, time, previous, readInputs, {
      instructionBudget,
    });
    events.push(...result.events);
    if (result.executionStatus !== 'yielded') return { ...result, events };
    expect(result.diagnostics).toEqual([]);
    expect(result.state.virtualTimeMs).toBeLessThan(time);
    previous = JSON.parse(JSON.stringify(result.state));
  }
  throw new Error('Clock did not reach its requested horizon');
}

describe('Arduino instruction-us-v1 execution clock (scheduler foundation)', () => {
  it('finishes millis busy-wait instead of treating it as an infinite program', () => {
    const source = `void setup(){pinMode(13,OUTPUT);while(millis()<10){}
      digitalWrite(13,HIGH);}void loop(){delay(100);}`;
    const before = through(source, 9.999);
    expect(before.diagnostics).toEqual([]);
    expect(before.state.outputVoltages.d13).toBe(0);
    const done = through(source, 20, before.state);
    expect(done.executionStatus).toBe('ready');
    expect(done.diagnostics).toEqual([]);
    expect(done.state.outputVoltages.d13).toBe(5);
    expect(done.events.find((event) => event.voltage === 5)?.atMicroseconds).toBeGreaterThanOrEqual(
      10_000,
    );
  });

  it('assigns successive GPIO instructions distinct integer-microsecond timestamps', () => {
    const source =
      'void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}void loop(){delay(100);}';
    const start = advanceClockedArduinoRuntime(source);
    expect(start.state.outputVoltages.d13).toBe(0);
    expect(start.state.resumeAtMs).toBe(0.001);
    const next = advanceClockedArduinoRuntime(source, {}, 0.001, start.state);
    expect(next.state.outputVoltages.d13).toBe(5);
    expect(next.events).toEqual([
      expect.objectContaining({ kind: 'output-change', atMicroseconds: 1, voltage: 5 }),
    ]);
    expect(advanceClockedArduinoRuntime(source, {}, 0.001, next.state).state).toEqual(next.state);
    expect(advanceClockedArduinoRuntime(source, {}, 0.001, next.state).events).toEqual([]);
  });

  it('suspends on a work quantum without clearing GPIO, scopes or reporting a program error', () => {
    const source = `unsigned long count=0;void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);
      {byte local=7;while(millis()<2){count+=local;}}}void loop(){delay(100);}`;
    const first = advanceClockedArduinoRuntime(source, {}, 3, undefined, undefined, {
      instructionBudget: 8,
    });
    expect(first.executionStatus).toBe('yielded');
    expect(first.diagnostics).toEqual([]);
    expect(first.state.outputVoltages.d13).toBe(5);
    expect(first.state.locals.local).toBe(7);
    expect(first.state.resumeAtMs).toBe(0.008);
    expect(first.state.virtualTimeMs).toBe(0.007);
    const resumed = through(source, 3, first.state, undefined, 8);
    const direct = through(source, 3);
    expect(resumed.state).toEqual(direct.state);
    expect([...first.events, ...resumed.events]).toEqual(direct.events);
  });

  it('bounds an infinite loop and allows its caller to cancel by discarding the continuation', () => {
    const source = 'unsigned long count=0;void setup(){while(true){count++;}}void loop(){}';
    const first = advanceClockedArduinoRuntime(source, {}, 100);
    expect(first.executionStatus).toBe('yielded');
    expect(first.diagnostics).toEqual([]);
    expect(first.state.virtualTimeMs).toBeLessThan(100);
    const second = advanceClockedArduinoRuntime(source, {}, 100, first.state);
    expect(second.state.variables.count).toBeGreaterThan(first.state.variables.count!);
    expect(second.state.virtualTimeMs).toBeGreaterThan(first.state.virtualTimeMs);
    const reset = advanceClockedArduinoRuntime(source, {}, 100);
    expect(reset).toEqual(first);
  });

  it.each([1, 7, 31, 1024])('is partition invariant with work quantum %i', (instructionBudget) => {
    const source = `unsigned long count=0;void setup(){pinMode(13,OUTPUT);}
      void loop(){for(int i=0;i<3;i++){count++;digitalWrite(13,count%2);}
      delayMicroseconds(10);}`;
    const whole = through(source, 0.3);
    let previous: ArduinoRuntimeState | undefined;
    const events: ArduinoRuntimeEvent[] = [];
    for (const time of [0, 0.003, 0.011, 0.099, 0.3]) {
      const part = through(source, time, previous, undefined, instructionBudget);
      expect(part.diagnostics).toEqual([]);
      events.push(...part.events);
      previous = part.state;
    }
    expect(JSON.stringify(previous)).toBe(JSON.stringify(whole.state));
    expect(events).toEqual(whole.events);
  });

  it('uses timestamped input history at execution time, not the final input value', () => {
    const source = `void setup(){pinMode(13,OUTPUT);}void loop(){
      digitalWrite(13,digitalRead(2));delayMicroseconds(10);}`;
    const readInputs: ArduinoInputReader = ({ simulationTimeMs }) => ({
      d2: simulationTimeMs >= 0.03 && simulationTimeMs < 0.07 ? 5 : 0,
      'power-5v': 5,
      'power-gnd-1': 0,
    });
    const whole = through(source, 0.1, undefined, readInputs);
    const first = through(source, 0.04, undefined, readInputs, 3);
    const last = through(source, 0.1, first.state, readInputs, 3);
    expect(last.state).toEqual(whole.state);
    expect([...first.events, ...last.events]).toEqual(whole.events);
    const high = whole.events.find((event) => event.voltage === 5)!;
    expect(high.atMicroseconds).toBeGreaterThanOrEqual(30);
    expect(high.atMicroseconds).toBeLessThan(70);
    expect(whole.events.at(-1)).toMatchObject({ voltage: 0 });
  });

  it('does not expire a tone in the future when the MCU yields behind the requested horizon', () => {
    const source = 'void setup(){tone(8,440,10);while(millis()<20){}}void loop(){delay(100);}';
    const first = advanceClockedArduinoRuntime(source, {}, 30, undefined, undefined, {
      instructionBudget: 8,
    });
    expect(first.executionStatus).toBe('yielded');
    expect(first.state.tones.d8).toBeDefined();
    expect(first.events.some((event) => event.kind === 'tone-stop')).toBe(false);
    const last = through(source, 30, first.state);
    expect(last.events.filter((event) => event.kind === 'tone-stop')).toEqual([
      expect.objectContaining({ atMicroseconds: 10_000 }),
    ]);
  });

  it('preserves the complete event stream across quanta beyond the rolling history window', () => {
    const source = `void setup(){pinMode(13,OUTPUT);for(int i=0;i<300;i++){
      digitalWrite(13,i%2);}}void loop(){delay(100);}`;
    const whole = through(source, 3);
    const small = through(source, 3, undefined, undefined, 7);
    expect(small.events.length).toBeGreaterThan(256);
    expect(small.events).toEqual(whole.events);
    expect(small.state).toEqual(whole.state);
    expect(small.state.eventQueue).toEqual(small.events.slice(-256));
    expect(small.events.map((event) => event.sequence)).toEqual(
      Array.from({ length: small.events.length }, (_, index) => index),
    );
  });

  it('keeps arithmetic faults sticky and fail-closed, distinct from scheduler yield', () => {
    const source = 'int value=32767;void setup(){pinMode(13,OUTPUT);value++;}void loop(){}';
    const result = through(source, 1);
    expect(result.executionStatus).toBe('fault');
    expect(result.diagnostics[0]?.code).toBe('arithmetic_error');
    expect(result.state.outputVoltages).toEqual({});
    expect(result.events).toEqual([]);
    expect(advanceClockedArduinoRuntime(source, {}, 2, result.state).executionStatus).toBe('fault');
  });

  it('does not carry an execution state between incompatible clock profiles', () => {
    const source =
      'void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}void loop(){delay(100);}';
    const legacy = advanceArduinoRuntime(source);
    expect(legacy.state.outputVoltages.d13).toBe(5);
    const restarted = advanceClockedArduinoRuntime(source, {}, 100, legacy.state);
    expect(restarted.state.outputVoltages.d13).toBe(0);
    expect(restarted.state.resumeAtMs).toBe(100.001);
    expect(restarted.state.clockProfile).toBe('instruction-us-v1');
  });

  it('advances empty loops and delay(0) without a zero-time CPU spin', () => {
    for (const source of ['void setup(){}void loop(){}', 'void loop(){delay(0);}']) {
      const first = advanceClockedArduinoRuntime(source, {}, 100, undefined, undefined, {
        instructionBudget: 5,
      });
      expect(first.executionStatus).toBe('yielded');
      expect(first.state.resumeAtMs).toBe(0.005);
      expect(first.diagnostics).toEqual([]);
      expect(through(source, 0.01, undefined, undefined, 2).state).toEqual(
        through(source, 0.01).state,
      );
    }
  });

  it('round-trips a 1.001 ms horizon without resetting or dropping an instruction', () => {
    const source = 'unsigned long count=0;void loop(){count++;}';
    const first = through(source, 1.001);
    expect(first.state.virtualTimeMs).toBe(1.001);
    const repeated = advanceClockedArduinoRuntime(source, {}, 1.001, first.state);
    expect(repeated.events).toEqual([]);
    expect(repeated.state).toEqual(first.state);
    expect(through(source, 1.009, first.state).state).toEqual(through(source, 1.009).state);
    expect(through(source, 1.0009).state.virtualTimeMs).toBe(1);
  });

  it('wraps millis as uint32 after a long delay without executing the waiting interval', () => {
    const source = `unsigned long observed=99;void setup(){delay(4294967295UL);
      delay(1);observed=millis();}void loop(){delay(100);}`;
    const first = through(source, 0);
    const last = through(source, 4294967296.01, first.state);
    expect(last.diagnostics).toEqual([]);
    expect(last.state.variables.observed).toBe(0);
    expect(last.executionStatus).toBe('ready');
  });

  it.each([1.001, 1.0009, 4294967296.0005, 1e12 + 0.00075])(
    'never rounds the horizon %s ms into the future',
    (time) => {
      const source = 'void loop(){delay(100);}';
      const seed = advanceClockedArduinoRuntime(source).state;
      const suspended = {
        ...seed,
        virtualTimeMs: Math.floor((time - 1) * 1000) / 1000,
        resumeAtMs: Math.round((time + 10) * 1000) / 1000,
      };
      const result = advanceClockedArduinoRuntime(source, {}, time, suspended);
      expect(result.executionStatus).toBe('ready');
      expect(result.state.virtualTimeMs).toBeLessThanOrEqual(time);
      expect(result.state.resumeAtMs).toBe(suspended.resumeAtMs);
      expect(
        advanceClockedArduinoRuntime(source, {}, result.state.virtualTimeMs, result.state).state,
      ).toEqual(result.state);
    },
  );

  it.each([NaN, Infinity, -1, Number.MAX_VALUE])('rejects invalid clock horizon %s', (time) => {
    const source = 'void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}void loop(){}';
    const result = advanceClockedArduinoRuntime(source, {}, time);
    expect(result.executionStatus).toBe('fault');
    expect(result.diagnostics[0]?.code).toBe('clock_range_exceeded');
    expect(result.state.outputVoltages).toEqual({});
    expect(result.events).toEqual([]);
    expect(Number.isFinite(result.state.virtualTimeMs)).toBe(true);
  });

  it('restarts rather than trusting a fractional-microsecond continuation', () => {
    const source =
      'void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}void loop(){delay(100);}';
    const state = through(source, 1).state;
    const result = advanceClockedArduinoRuntime(source, {}, 2, { ...state, resumeAtMs: 1.0005 });
    expect(result.state.outputVoltages.d13).toBe(0);
    expect(result.state.resumeAtMs).toBe(2.001);
  });
});
