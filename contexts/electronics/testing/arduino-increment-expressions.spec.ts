import { createHash } from 'node:crypto';
import { it, expect } from 'vitest';
import {
  advanceArduinoRuntime,
  analyseArduinoProgramSyntax,
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

function through(source: string, budget = 16384) {
  let state: ArduinoRuntimeState | undefined;
  const events = [];
  for (let slice = 0; slice < 10000; slice++) {
    const result = advanceClockedArduinoRuntime(source, {}, 20, state, undefined, {
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
