import { describe, expect, it } from 'vitest';
import {
  advanceArduinoRuntime,
  advanceClockedArduinoRuntime,
  analyseArduinoProgramSyntax,
  resetArduinoRuntime,
  type ArduinoRuntimeState,
  type ArduinoRuntimeEvent,
} from '../domain/arduino-program-runtime.js';
import { binaryValue, numericValue, unaryValue } from '../domain/arduino-values.js';
import {
  analyseArduinoSourceSupport,
  ARDUINO_LANGUAGE_FEATURE_SUPPORT,
  ARDUINO_TEXT_COMMAND_SUPPORT,
} from '../domain/arduino-capabilities.js';

const serialSketch = `void setup() {
  Serial.begin(9600);
  for (int i = 0; i < 8; i++) {
    unsigned int mask = 1U << i;
    Serial.println(mask);
  }
}
void loop() {}`;
const gpioSketch = `void setup() {
  for (int pin = 2; pin <= 9; pin++) { pinMode(pin, OUTPUT); }
}
void loop() {
  for (int step = 0; step < 8; step++) {
    unsigned int mask = 1U << step;
    for (int bitIndex = 0; bitIndex < 8; bitIndex++) {
      digitalWrite(2 + bitIndex, (mask >> bitIndex) & 1U);
    }
    delay(250);
  }
}`;
function through(source: string, time: number, budget = 16_384, previous?: ArduinoRuntimeState) {
  const events: ArduinoRuntimeEvent[] = [];
  let yields = 0;
  for (let attempt = 0; attempt < 10_000; attempt++) {
    const result = advanceClockedArduinoRuntime(source, {}, time, previous, undefined, {
      instructionBudget: budget,
    });
    events.push(...result.events);
    if (result.executionStatus !== 'yielded') return { ...result, allEvents: events, yields };
    yields++;
    previous = JSON.parse(JSON.stringify(result.state)) as ArduinoRuntimeState;
  }
  throw new Error('Bitwise sketch did not reach its requested canonical horizon');
}

describe('E13 Arduino Uno bitwise expressions and actual sketch execution', () => {
  it.each([
    ['10 & 12', 8],
    ['10 | 12', 14],
    ['10 ^ 12', 6],
    ['~0x0001U', 65534],
    ['1U << 15', 32768],
    ['1UL << 31', 2147483648],
    ['128U >> 2', 32],
    ['1U << 1 + 2', 8],
    ['32U >> 1 + 2', 4],
    ['1U << 3 < 9', 1],
    ['4 & 2 == 0', 0],
    ['1 | 2 ^ 3 & 1', 3],
    ['2 & 3 || 0', 1],
    ['0 || 2 ^ 3 && 2', 1],
    ['(128U >> 7) & 1U', 1],
    ['bitRead(128U, 7)', 1],
    ['bit(31)', 2147483648],
  ])('executes %s with C++ precedence and Uno promotion', (expression, expected) => {
    const result = advanceArduinoRuntime(
      `unsigned long value = ${expression}; void setup(){} void loop(){delay(100);}`,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.state.variables.value).toBe(expected);
  });
  it('preserves type widths, promotions, signed right shift and unsigned left wrapping', () => {
    expect(unaryValue('~', numericValue('byte', 1))).toEqual({ type: 'int', value: -2 });
    expect(unaryValue('~', numericValue('unsigned int', 1))).toEqual({
      type: 'unsigned int',
      value: 65534,
    });
    expect(binaryValue('>>', numericValue('int', -8), numericValue('int', 2))).toEqual({
      type: 'int',
      value: -2,
    });
    expect(binaryValue('<<', numericValue('unsigned int', 32768), numericValue('long', 1))).toEqual(
      { type: 'unsigned int', value: 0 },
    );
    expect(binaryValue('<<', numericValue('int', 1), numericValue('int', 15))).toEqual({
      type: 'int',
      value: -32768,
    });
    expect(binaryValue('|', numericValue('long', 0), numericValue('unsigned int', 65535))).toEqual({
      type: 'long',
      value: 65535,
    });
  });
  it('executes every compound form and narrows back to the lvalue type', () => {
    const result = advanceArduinoRuntime(
      `byte value=255; unsigned long high=0; void setup(){value &= 15; value |= 128; value ^= 3; value <<= 1; value >>= 2; high |= 1UL << 31;}void loop(){delay(100);}`,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.state.variables).toEqual({ value: 6, high: 2147483648 });
    expect(result.state.scopes[0]?.value?.type).toBe('byte');
  });
  it('mutates only valid lvalues, returns converted values and uses the AVR unsigned-long bit mask', () => {
    const result = advanceArduinoRuntime(
      `unsigned long mask=0; byte narrow=0; int returned=0; void setup(){bitSet(mask,31);bitSet(narrow,8);bitWrite(narrow,7,2);returned=bitClear(narrow,7);bitToggle(narrow,0);bitWrite(mask,31,0);}void loop(){delay(100);}`,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.state.variables).toEqual({ mask: 0, narrow: 1, returned: 0 });
  });
  it('retains logical short circuit while validating bit mutations and evaluating the bitWrite condition first', () => {
    const result = advanceArduinoRuntime(
      `int value=0;int result=0;void setup(){if(false && bitSet(value,0)){}if(true || bitSet(value,1)){}result=bitWrite(value,bitSet(value,0),bitSet(value,1));}void loop(){delay(100);}`,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.state.variables).toEqual({ value: 11, result: 11 });
  });
  it.each(['1U << -1', '1U << 16', '1UL >> 32', '-1 << 1', '2 << 15'])(
    'fails closed on undefined shift %s',
    (expression) => {
      const result = advanceArduinoRuntime(
        `void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);long value=${expression};}void loop(){delay(100);}`,
      );
      expect(result.diagnostics[0]?.code).toBe('arithmetic_error');
      expect(result.state.outputVoltages).toEqual({});
      expect(result.events).toEqual([]);
    },
  );
  it.each([
    'float v=1.0; v &= 1;',
    'int v=~1.0;',
    'int v=1 << 1.0;',
    'bitSet(1,0);',
    'int v=0;bitSet(v+1,0);',
    'const int v=0;bitSet(v,0);',
    'const int v=0;v <<= 1;',
    'int v=bitRead(1);',
    'int v=BitRead(1,0);',
    'bitSet(missing,0);',
    'int v=0;bitSet(v,0,1);',
  ])('rejects unsupported or invalid operands before any GPIO: %s', (body) => {
    const source = `void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);${body}}void loop(){delay(100);}`;
    expect(analyseArduinoProgramSyntax(source)[0]?.code).toBe('compile_error');
    const result = advanceArduinoRuntime(source);
    expect(result.state.outputVoltages).toEqual({});
    expect(result.events).toEqual([]);
  });
  it('runs the full published Serial sketch exactly once with all eight mask values', () => {
    const result = through(serialSketch, 1);
    expect(result.executionStatus).toBe('ready');
    expect(result.diagnostics).toEqual([]);
    expect(result.state.serial?.tx.map((entry) => entry.text)).toEqual(
      [1, 2, 4, 8, 16, 32, 64, 128].map((value) => `${value}\n`),
    );
    const resumed = through(serialSketch, 2, 16_384, result.state);
    expect(resumed.state.serial).toEqual(result.state.serial);
  });
  it('runs the full eight-GPIO sketch, keeping exactly the corresponding pin high for each step', () => {
    let previous: ArduinoRuntimeState | undefined;
    for (let step = 0; step < 8; step++) {
      const result = through(gpioSketch, 125 + 250 * step, 16_384, previous);
      expect(result.executionStatus).toBe('ready');
      expect(result.diagnostics).toEqual([]);
      expect(
        Array.from(
          { length: 8 },
          (_, index) => result.state.outputVoltages[`d${index + 2}` as 'd2'],
        ),
      ).toEqual(Array.from({ length: 8 }, (_, index) => (index === step ? 5 : 0)));
      previous = result.state;
    }
  });
  it.each([serialSketch, gpioSketch])(
    'preserves the complete canonical state and ordered events across JSON yielded continuation',
    (source) => {
      const horizon = source === serialSketch ? 1 : 2001;
      const complete = through(source, horizon);
      const resumed = through(source, horizon, 3);
      expect(resumed.yields).toBeGreaterThan(0);
      expect(resumed.executionStatus).toBe('ready');
      expect(resumed.diagnostics).toEqual([]);
      expect(resumed.state).toEqual(complete.state);
      expect(resumed.allEvents).toEqual(complete.allEvents);
      const reset = resetArduinoRuntime(source, {}, 0);
      const fresh = advanceArduinoRuntime(source, {}, 0);
      expect(reset).toEqual(fresh);
    },
  );
  it('advertises exactly the implemented bit helpers and keeps malformed code blocked', () => {
    for (const name of ['bit', 'bitRead', 'bitSet', 'bitClear', 'bitToggle', 'bitWrite'] as const)
      expect(ARDUINO_TEXT_COMMAND_SUPPORT[name].status).toBe('supported');
    expect(ARDUINO_LANGUAGE_FEATURE_SUPPORT.bitwise.status).toBe('supported');
    expect(
      analyseArduinoSourceSupport(serialSketch).some((row) => row.status === 'unsupported'),
    ).toBe(false);
    expect(
      analyseArduinoSourceSupport(gpioSketch).some((row) => row.status === 'unsupported'),
    ).toBe(false);
    expect(
      analyseArduinoSourceSupport('void setup(){bitSet(1,0);}void loop(){}').some(
        (row) => row.status === 'unsupported',
      ),
    ).toBe(true);
  });
});
