import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { enqueueArduinoSerialRx } from '../domain/arduino-serial-runtime.js';
import {
  advanceArduinoRuntime,
  advanceClockedArduinoRuntime,
  resetArduinoRuntime,
  analyseArduinoProgramSyntax,
  arduinoRuntimeStateMatchesProgram,
  createOwnedClockedArduinoRuntime,
  type ArduinoRuntimeState,
} from '../domain/arduino-program-runtime.js';

it('preserves complete pre-random streams, states, events and JSON continuation', () => {
  const sources = [
    'long n=0;void setup(){Serial.begin(9600);pinMode(13,OUTPUT);}void loop(){n+=1;Serial.println(n);digitalWrite(13,n%2);delay(1);}',
    'int n=0;void setup(){while(++n<3){delayMicroseconds(3);}}void loop(){n+=millis()/2;delay(2);}',
    'long n=0;void setup(){n=pulseIn(2,HIGH,100);}void loop(){delay(2);}',
  ];
  const output = sources.map((source) => [
    resetArduinoRuntime(source),
    ...[advanceArduinoRuntime, advanceClockedArduinoRuntime].map((advance) => {
      let state: ArduinoRuntimeState | undefined;
      return [0, 0.01, 0.1, 1, 10].map((time) => {
        const result = advance(source, {}, time, state);
        expect(result.diagnostics).toEqual([]);
        state = JSON.parse(JSON.stringify(result.state));
        return result;
      });
    }),
  ]);
  expect(createHash('sha256').update(JSON.stringify(output)).digest('hex')).toBe(
    '67f230cb0174dc9b275f44b27b850cc113572b3dc69c7582329ed45688b9ebd5',
  );
});

const sketch = (body: string, globals = 'long value=0;') =>
  `${globals}void setup(){${body}}void loop(){delay(100);}`;
function through(source: string, budget = 16384, horizon = 20) {
  let state: ArduinoRuntimeState | undefined;
  const events = [];
  for (let slice = 0; slice < 10000; slice++) {
    const result = advanceClockedArduinoRuntime(source, {}, horizon, state, undefined, {
      instructionBudget: budget,
    });
    expect(result.diagnostics).toEqual([]);
    events.push(...result.events);
    if (result.executionStatus !== 'yielded') return { state: result.state, events };
    state = JSON.parse(JSON.stringify(result.state));
    expect(arduinoRuntimeStateMatchesProgram(source, state!)).toBe(true);
  }
  throw new Error('No horizon');
}
it('pins avr-libc 2.0.0 default vectors and reseeds independent runtime instances', () => {
  const source = sketch('Serial.begin(9600);for(int i=0;i<5;i++){Serial.println(random());}');
  const result = through(source);
  expect(result.state.serial!.tx.map((entry) => entry.text)).toEqual([
    '16807\n',
    '282475249\n',
    '1622650073\n',
    '984943658\n',
    '1144108930\n',
  ]);
  for (const budget of [1, 2, 7]) expect(through(source, budget)).toEqual(result);
  expect(through(source)).toEqual(result);
  expect(advanceArduinoRuntime(source).state.randomState).toBe(1144108930);
  const seeded = sketch('randomSeed(42);value=random();randomSeed(0);value=random();');
  expect(through(seeded).state.variables.value).toBe(1126542223);
  expect(
    through(sketch('randomSeed(42);value=random();randomSeed(42);value=random();')).state.variables
      .value,
  ).toBe(705894);
});
it.each([
  [2147483647, 0],
  [2147483648, 2147466840],
  [4294967295, 2147466840],
  [1, 16807],
  [0, 16807],
])('uses signed32 recurrence for unsigned seed %s', (seed, expected) => {
  const source = sketch(`randomSeed(${seed}UL);value=random();`);
  expect(through(source).state.variables.value).toBe(expected);
});
it('preserves valid zero state through JSON and skips zero reseeding', () => {
  const source = sketch(
    'randomSeed(2147483647UL);value=random();delay(1);randomSeed(0);value=random();',
  );
  const paused = advanceClockedArduinoRuntime(source, {}, 0.1).state;
  expect(paused.randomState).toBe(0);
  expect(arduinoRuntimeStateMatchesProgram(source, JSON.parse(JSON.stringify(paused)))).toBe(true);
  const resumed = advanceClockedArduinoRuntime(source, {}, 20, JSON.parse(JSON.stringify(paused)));
  expect(resumed.state.variables.value).toBe(520932930);
  expect(resumed.state).toEqual(through(source).state);
});
it.each([
  ['value=random(0);', 0, undefined],
  ['value=random(4,4);', 4, undefined],
  ['value=random(7,-3);', 7, undefined],
  ['value=random(-10);', 7, 16807],
  ['value=random(-10,-2);', -3, 16807],
  ['value=random(2.9,10.9);', 9, 16807],
  ['value=random(4294967295UL);', 0, 16807],
  ['randomSeed(-1);value=random();', 2147466840, 2147466840],
  ['value=false && random();value=true || random();', 1, undefined],
  ['value=max(random(10),0);', 9, 282475249],
  ['value=min(random(10),10);', 9, 282475249],
])('converts and draws exactly for %s', (body, value, state) => {
  const source = sketch(body);
  expect(analyseArduinoProgramSyntax(source)).toEqual([]);
  const result = through(source);
  expect(result.state.variables.value).toBe(value);
  expect(result.state.randomState).toBe(state);
  if (state === undefined) expect(Object.hasOwn(result.state, 'randomState')).toBe(false);
  for (const budget of [1, 2, 7]) expect(through(source, budget)).toEqual(result);
});
it('keeps global draws and once-only replay across random-only blocking instructions', () => {
  const source = sketch(
    'Serial.begin(9600);value=random()+pulseIn(2,HIGH,100);randomSeed(random()+pulseIn(3,HIGH,100));value=millis()+random(100)+pulseIn(4,HIGH,100);',
    'long value=random();',
  );
  const first = advanceClockedArduinoRuntime(source, {}, 0.05).state;
  expect(first.randomState).toBe(282475249);
  expect(first.pendingEvaluation).toBeDefined();
  expect(arduinoRuntimeStateMatchesProgram(source, JSON.parse(JSON.stringify(first)))).toBe(true);
  const result = through(source);
  for (const budget of [1, 2, 7]) expect(through(source, budget)).toEqual(result);
  expect(
    advanceClockedArduinoRuntime(source, {}, 20, JSON.parse(JSON.stringify(first))).state,
  ).toEqual(result.state);
  const afterSerial = sketch(
    'Serial.begin(9600);value=Serial.read()+random()+pulseIn(2,HIGH,100);',
  );
  expect(through(afterSerial, 1)).toEqual(through(afterSerial));
});
it('does not repeat Serial RX, micros or random across waiting JSON replay', () => {
  const source = sketch(
    'Serial.begin(9600);delay(1);value=Serial.read()+random()+micros()+pulseIn(2,HIGH,100);',
  );
  const paused = advanceClockedArduinoRuntime(source, {}, 0.1).state;
  const input = { ...paused, serial: enqueueArduinoSerialRx(paused.serial!, 100, 'AB') };
  const waiting = advanceClockedArduinoRuntime(source, {}, 1.05, input).state;
  expect(waiting.randomState).toBe(16807);
  expect(waiting.serial!.rx!.map((entry) => entry.byte)).toEqual([66]);
  expect(waiting.pendingEvaluation).toBeDefined();
  expect(arduinoRuntimeStateMatchesProgram(source, JSON.parse(JSON.stringify(waiting)))).toBe(true);
  const completed = advanceClockedArduinoRuntime(
    source,
    {},
    20,
    JSON.parse(JSON.stringify(waiting)),
  ).state;
  expect(completed.variables.value).toBe(65 + 16807 + 1002);
  expect(completed.serial!.rx!.map((entry) => entry.byte)).toEqual([66]);
  expect(completed.randomState).toBe(16807);
});
it('executes formerly unsupported loop random examples as deterministic programs', () => {
  const source = sketch('do {value++;} while(random(10));randomSeed(42);');
  expect(analyseArduinoProgramSyntax(source)).toEqual([]);
  const result = through(source);
  expect(result.state.variables.value).toBe(5);
  expect(result.state.randomState).toBe(42);
});
it('rejects void-expression/arities and numeric faults before exposing GPIO', () => {
  for (const body of [
    'value=randomSeed(1);',
    'randomSeed();',
    'randomSeed(1,2);',
    'random(1,2,3);',
  ])
    expect(analyseArduinoProgramSyntax(sketch(body)).length).toBeGreaterThan(0);
  for (const body of [
    'value=random((-2147483647L-1),2147483647L);',
    'randomSeed(-1.0);',
    'value=random(2147483648.0);',
  ]) {
    const result = throughFault(sketch(`pinMode(13,OUTPUT);digitalWrite(13,HIGH);${body}`));
    expect(result.state.outputVoltages).toEqual({});
    expect(result.diagnostics.some((entry) => entry.code === 'arithmetic_error')).toBe(true);
  }
});
function throughFault(source: string) {
  return advanceClockedArduinoRuntime(source, {}, 20);
}
it('resumes old state, resets incompatible sources, validates optional state and falls back from owned random', () => {
  const source = sketch('delayMicroseconds(1);value=random();delay(1);value=random();');
  const old = advanceClockedArduinoRuntime(source, {}, 0).state;
  expect(old.randomState).toBeUndefined();
  expect(through(source).state).toEqual(
    advanceClockedArduinoRuntime(source, {}, 20, JSON.parse(JSON.stringify(old))).state,
  );
  expect(createOwnedClockedArduinoRuntime(source)).toBeNull();
  const paused = advanceClockedArduinoRuntime(source, {}, 0.1).state;
  for (const malformed of [null, -1, 4294967296, 1.5, NaN, Infinity, '1', {}])
    expect(
      arduinoRuntimeStateMatchesProgram(source, {
        ...paused,
        randomState: malformed,
      } as ArduinoRuntimeState),
    ).toBe(false);
  const edited = source.replace('value=random();', 'value=random(100);');
  const changed = advanceClockedArduinoRuntime(edited, {}, 20, paused).state;
  expect(changed.randomState).toBeUndefined();
  expect(changed.variables.value).toBe(0);
  expect(advanceClockedArduinoRuntime(edited, {}, 40, changed).state.variables.value).toBe(
    282475249,
  );
  expect(resetArduinoRuntime(source).state.randomState).toBeUndefined();
});
