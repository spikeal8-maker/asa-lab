import { createHash } from 'node:crypto';
import { it, expect } from 'vitest';
import { enqueueArduinoSerialRx } from '../domain/arduino-serial-runtime.js';
import {
  advanceArduinoRuntime,
  analyseArduinoProgramSyntax,
  arduinoRuntimeStateMatchesProgram,
  createOwnedClockedArduinoRuntime,
  advanceClockedArduinoRuntime,
  resetArduinoRuntime,
  type ArduinoRuntimeState,
} from '../domain/arduino-program-runtime.js';
// Captured before the repair on bfb6037d; hashes every complete result/state/event stream.
it('preserves the pre-repair complete old-valid output bytes', () => {
  const sources = [
    'int n=0;void setup(){for(int i=0;i<3;i++){n++;}++n;n--;}void loop(){n+=2;delay(2);}',
    'int n=1;void setup(){pinMode(13,OUTPUT);Serial.begin(9600);while(n<3){Serial.println(n);digitalWrite(13,n%2);n++;delayMicroseconds(3);}}void loop(){delay(1);}',
    'int n=3;void setup(){int n=8;n+=2;int x=+ +n;int y=- -n;}void loop(){n+=millis()/2;delay(2);}',
  ];
  const output = sources.map((source) => [
    resetArduinoRuntime(source),
    ...[advanceArduinoRuntime, advanceClockedArduinoRuntime].map((advance) => {
      let state: ArduinoRuntimeState | undefined;
      return [0, 0.01, 1, 10].map((t) => {
        const result = advance(source, {}, t, state);
        expect(result.diagnostics).toEqual([]);
        state = JSON.parse(JSON.stringify(result.state));
        return result;
      });
    }),
  ]);
  const json = JSON.stringify(output);
  expect(createHash('sha256').update(json).digest('hex')).toBe(
    '40b6c548561f1a20d8613d1bd936316a01edd6f1cfe1a72423e058939c4ea24d',
  );
});

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
  }
  throw new Error('No horizon');
}
const sketch = (body: string, globals = 'int n=1;int value=0;') =>
  `${globals}void setup(){${body}}void loop(){delay(100);}`;
it.each([
  ['value=++n;', { n: 2, value: 2 }],
  ['value=n++;', { n: 2, value: 1 }],
  ['value=--n;', { n: 0, value: 0 }],
  ['value=n--;', { n: 0, value: 1 }],
  ['value=++((n))*3+2;', { n: 2, value: 8 }],
  ['value=3*((n)++)+2;', { n: 2, value: 5 }],
  ['value=-n++ + + +n;', { n: 2, value: 1 }],
  ['value=- -n+ + +n;', { n: 1, value: 2 }],
  ['value=n+++2;', { n: 2, value: 3 }],
  ['value=n---2;', { n: 0, value: -1 }],
  ['Serial.begin(9600);value=Serial.read()+n++;', { n: 2, value: 0 }],
  ['value=false && ++n;value=true || n--;', { n: 1, value: 1 }],
  ['value=0;while(++n<4 && value<3)value++;', { n: 4, value: 2 }],
  ['{byte n=255;value=++n;}value+=n;', { n: 1, value: 1 }],
  ['{byte n=255;value=n++;}value+=n;', { n: 1, value: 256 }],
  ['value=max(n++,10);', { n: 2, value: 10 }],
  ['value=min(n++,10);', { n: 3, value: 2 }],
  ['value=abs(n++);', { n: 3, value: 2 }],
  ['value=constrain(n++,0,10);', { n: 4, value: 3 }],
  ['for(int i=0;i<3;i++){n++;}++n;n--;value=n;', { n: 4, value: 4 }],
])('evaluates %s with typed prefix/postfix values and exact continuation', (body, values) => {
  const source = sketch(body);
  expect(analyseArduinoProgramSyntax(source)).toEqual([]);
  expect(advanceArduinoRuntime(source).state.variables).toMatchObject(values);
  const expected = through(source);
  expect(expected.state.variables).toMatchObject(values);
  for (const budget of [1, 2, 7]) expect(through(source, budget)).toEqual(expected);
});
it.each([
  ['byte n=255;', 'value=++n;', 0, 0],
  ['byte n=255;', 'value=n++;', 0, 255],
  ['unsigned int n=65535;', 'value=++n;', 0, 0],
  ['unsigned int n=0;', 'value=n--;', 65535, 0],
  ['float n=1.5;', 'value=++n;', 2.5, 2],
])(
  'converts the updated binding before exposing its value: %s %s',
  (declaration, body, n, value) => {
    const result = advanceArduinoRuntime(sketch(body, `${declaration}int value=0;`));
    expect(result.diagnostics).toEqual([]);
    expect(result.state.variables).toMatchObject({ n, value });
  },
);
it.each([
  'value=++1;',
  'value=1++;',
  'value=++(n+0);',
  'value=(n+0)++;',
  'value=++(n++);',
  'value=n++++;',
  'value=++++n;',
  'value=++missing;',
  'value=++HIGH;',
  'const int c=1;value=c++;',
  'const int c=1;value=false && ++c;',
  'bool b=false;value=b++;',
  'bool b=false;value=true || --b;',
  'value=++(abs(n));',
  'value=abs(n)++;',
])('rejects invalid or unwritable increment operand %s before side effects', (body) => {
  const source = sketch(`pinMode(13,OUTPUT);digitalWrite(13,HIGH);${body}`);
  expect(analyseArduinoProgramSyntax(source).length).toBeGreaterThan(0);
  const result = advanceClockedArduinoRuntime(source, {}, 20);
  expect(result.executionStatus).toBe('fault');
  expect(result.events).toEqual([]);
  expect(result.state.outputVoltages).toEqual({});
});
it('does not read uninitialized or overflow skipped operands, but faults on evaluated operands', () => {
  const skipped = advanceArduinoRuntime(
    sketch('int x;value=false && x++;int y=32767;value=true || ++y;value=n;'),
  );
  expect(skipped.diagnostics).toEqual([]);
  expect(skipped.state.variables).toMatchObject({ n: 1, value: 1 });
  for (const body of ['int x;value=x++;', 'int x=32767;value=++x;', 'int x=-32768;value=x--;'])
    expect(advanceArduinoRuntime(sketch(body)).diagnostics.length).toBeGreaterThan(0);
});
it('uses the public interpreter fallback without altering the owned request clock', () => {
  expect(createOwnedClockedArduinoRuntime(sketch('value=++n;'))).toBeNull();
  const source = sketch('value=++n;delay(1);value+=n++;');
  const paused = advanceClockedArduinoRuntime(source, {}, 0.1);
  expect(paused.state.variables).toMatchObject({ n: 2, value: 2 });
  const resumed = advanceClockedArduinoRuntime(
    source,
    {},
    20,
    JSON.parse(JSON.stringify(paused.state)),
  );
  expect(resumed.state.variables).toMatchObject({ n: 3, value: 4 });
  expect(advanceClockedArduinoRuntime(source, {}, 20, resetArduinoRuntime(source))).toEqual(
    advanceClockedArduinoRuntime(source, {}, 20),
  );
  const edited = sketch('value=++n+10;');
  expect(advanceClockedArduinoRuntime(edited, {}, 20, resumed.state).state.variables).toMatchObject(
    { n: 2, value: 12 },
  );
});

it.each(['++n++', '++n--', '--n++', '--n--'])(
  'rejects double-ended standalone and for update %s',
  (invalid) => {
    for (const body of [`${invalid};`, `for(;n<2;${invalid}){value++;}`]) {
      const source = sketch(body);
      expect(analyseArduinoProgramSyntax(source).length).toBeGreaterThan(0);
      const result = advanceClockedArduinoRuntime(source, {}, 20);
      expect(result.executionStatus).toBe('fault');
      expect(result.events).toEqual([]);
    }
  },
);

it.each([
  ['value=pulseIn(n++,HIGH,5);', 3, 0],
  ['value=pulseIn(4,HIGH,5)+n++;', 3, 2],
  ['pinMode(2,OUTPUT);digitalWrite(pulseIn(4,HIGH,5),n++);', 3, 0],
  ['value=pulseIn(4,HIGH,5)+(true || n++);', 2, 1],
  ['value=pulseIn(++n,HIGH,5);', 3, 0],
  ['value=n++ + pulseIn(4,HIGH,5);', 3, 2],
  ['value=n + pulseIn(n++,HIGH,5);', 3, 2],
  ['pinMode(2,OUTPUT);digitalWrite(n++,pulseIn(4,HIGH,5));', 3, 0],
  ['value=pulseIn(n++,HIGH,5)+pulseIn(n++,HIGH,7);', 4, 0],
  ['value=max(n++,pulseIn(4,HIGH,5));', 4, 3],
  ['value=min(n++,pulseIn(4,HIGH,5));', 3, 0],
  ['value=abs(n++ +pulseIn(4,HIGH,5));', 4, 3],
  ['while(n++<3 && pulseIn(4,HIGH,5)==0)value++;', 4, 1],
  ['if(pulseIn(n++,HIGH,5)==0)value=n;', 3, 3],
  ['value=pulseIn(n++,HIGH,5)+readUltrasonicCm(n++,4);', 4, 0],
  ['value=readUltrasonicCm(n++,4);', 3, 0],
  ['value=n++ + readUltrasonicCm(5,4);', 3, 2],
  ['pinMode(2,OUTPUT);digitalWrite(n++,readUltrasonicCm(5,4));', 3, 0],
])('evaluates waiting instruction occurrences once: %s', (body, n, value) => {
  const source = sketch(body, 'int n=2;int value=0;');
  const horizon = body.includes('Ultrasonic') ? 1100 : 20;
  const expected = through(source, 16384, horizon);
  expect(expected.state.variables).toMatchObject({ n, value });
  expect(expected.state.pendingEvaluation).toBeUndefined();
  for (const budget of [1, 2, 7]) expect(through(source, budget, horizon)).toEqual(expected);
});
it('exposes the increment during a wait, retains exact old result, and clears its journal', () => {
  const source = sketch('value=n++ + pulseIn(4,HIGH,100);', 'int n=2;int value=-1;');
  const pending = advanceClockedArduinoRuntime(source, {}, 0.01);
  expect(pending.diagnostics).toEqual([]);
  expect(pending.state.variables).toMatchObject({ n: 3, value: -1 });
  expect(pending.state.pendingEvaluation?.entries.length).toBeGreaterThan(0);
  expect(arduinoRuntimeStateMatchesProgram(source, pending.state)).toBe(true);
  const resumed = advanceClockedArduinoRuntime(
    source,
    {},
    1,
    JSON.parse(JSON.stringify(pending.state)),
  );
  expect(resumed.diagnostics).toEqual([]);
  expect(resumed.state.variables).toMatchObject({ n: 3, value: 2 });
  expect(resumed.state.pendingEvaluation).toBeUndefined();
  const broken = JSON.parse(JSON.stringify(pending.state));
  delete broken.pendingEvaluation;
  expect(arduinoRuntimeStateMatchesProgram(source, broken)).toBe(false);
  const restarted = advanceClockedArduinoRuntime(source, {}, 1, broken);
  expect(restarted.state.variables).toMatchObject({ n: 3, value: -1 });
  expect(
    advanceClockedArduinoRuntime(source, {}, 2, restarted.state).state.variables,
  ).toMatchObject({ n: 3, value: 2 });
  expect(resetArduinoRuntime(source).pendingEvaluation).toBeUndefined();
  const edited = sketch('value=n++ + 40;', 'int n=2;int value=0;');
  expect(advanceClockedArduinoRuntime(edited, {}, 1, pending.state).state.variables).toMatchObject({
    n: 3,
    value: 42,
  });
});
it('latches preceding Serial consumption, ADC and micros values while later call waits', () => {
  const source = sketch(
    'Serial.begin(9600);delayMicroseconds(10);value=Serial.read()+analogRead(A0)+micros()+n++ +pulseIn(4,HIGH,100);',
    'int n=2;int value=-1;',
  );
  const initial = advanceClockedArduinoRuntime(source, {}, 0.005);
  const rx = { ...initial.state, serial: enqueueArduinoSerialRx(initial.state.serial!, 5, 'AB') };
  let adc = 0;
  const pending = advanceClockedArduinoRuntime(source, {}, 0.02, rx, (electrical) => {
    adc++;
    return { a0: electrical.simulationTimeMs < 0.03 ? 0.5 : 5 };
  });
  expect(pending.diagnostics).toEqual([]);
  expect(pending.state.variables.n).toBe(3);
  expect(pending.state.serial?.rx).toHaveLength(1);
  const after = advanceClockedArduinoRuntime(
    source,
    {},
    1,
    JSON.parse(JSON.stringify(pending.state)),
    () => ({ a0: 5 }),
  );
  expect(after.diagnostics).toEqual([]);
  expect(after.state.variables).toMatchObject({ n: 3, value: 181 });
  expect(after.state.serial?.rx).toHaveLength(1);
  expect(adc).toBeGreaterThan(0);
  for (const budget of [1, 2, 7]) {
    let state = JSON.parse(JSON.stringify(pending.state));
    let result;
    for (let slice = 0; slice < 100; slice++) {
      result = advanceClockedArduinoRuntime(source, {}, 1, state, () => ({ a0: 5 }), {
        instructionBudget: budget,
      });
      if (result.executionStatus !== 'yielded') break;
      state = JSON.parse(JSON.stringify(result.state));
    }
    expect(result?.diagnostics).toEqual([]);
    expect(result?.state).toEqual(after.state);
  }
});
it.each([
  ['journal', 'programCounter', 999],
  ['journal', 'phase', 'loop'],
  ['journal', 'programFingerprint', 'wrong'],
  ['value', 'value', Infinity],
  ['value', 'type', 'text'],
  ['value', 'type', 'float'],
  ['entry', 'stream', -1],
  ['entry', 'stream', 999],
  ['entry', 'start', 1],
  ['entry', 'end', 1],
  ['journal', 'streams', [['foreign']]],
  ['journal', 'parents', [-1]],
  ['entry', 'start', -1],
  ['entry', 'start', 1e9],
  ['entry', 'end', -1],
  ['entry', 'end', 1e9],
  ['entry', 'next', 0],
  ['entry', 'next', 1e9],
  ['journal', 'entries', []],
  ['journal', 'entries', new Array(16385).fill(null)],
])('rejects malformed pending evaluation journal %# %s.%s', (scope, key, value) => {
  const source = sketch('value=n++ +pulseIn(4,HIGH,100);', 'int n=2;int value=-1;');
  const pending = advanceClockedArduinoRuntime(source, {}, 0.01).state;
  const bad = JSON.parse(JSON.stringify(pending));
  const target =
    scope === 'journal'
      ? bad.pendingEvaluation
      : scope === 'entry'
        ? bad.pendingEvaluation.entries[0]
        : bad.pendingEvaluation.entries[0].value;
  target[key] = value;
  if (scope === 'value' && key === 'type' && value === 'float') target.value = 1e100;
  expect(arduinoRuntimeStateMatchesProgram(source, bad)).toBe(false);
});
it('clears a journal on arithmetic fault after the pending call completes', () => {
  const source = sketch('value=n++ +pulseIn(4,HIGH,5)+1/0;', 'int n=2;int value=0;');
  const result = advanceClockedArduinoRuntime(source, {}, 20);
  expect(result.executionStatus).toBe('fault');
  expect(result.state.pendingEvaluation).toBeUndefined();
});

it('rejects a journal next link that skips a completed sibling side effect', () => {
  const source = sketch(
    'pinMode(2,OUTPUT);digitalWrite(n++,n++ +pulseIn(4,HIGH,100));',
    'int n=2;int value=0;',
  );
  const pending = advanceClockedArduinoRuntime(source, {}, 0.01).state;
  expect(pending.variables.n).toBe(4);
  const bad = JSON.parse(JSON.stringify(pending));
  bad.pendingEvaluation.entries[0].next = bad.pendingEvaluation.entries.length;
  expect(arduinoRuntimeStateMatchesProgram(source, bad)).toBe(false);
});

it('rejects a completed ancestor forged over the unfinished wait frontier', () => {
  const source = sketch('value=(n++ +pulseIn(4,HIGH,100));', 'int n=2;int value=0;');
  const bad = JSON.parse(JSON.stringify(advanceClockedArduinoRuntime(source, {}, 0.01).state));
  bad.pendingEvaluation.entries[0] = {
    stream: 0,
    start: 0,
    end: bad.pendingEvaluation.streams[0].length,
    next: bad.pendingEvaluation.entries.length,
    value: { type: 'unsigned long', value: 0 },
  };
  expect(arduinoRuntimeStateMatchesProgram(source, bad)).toBe(false);
});
