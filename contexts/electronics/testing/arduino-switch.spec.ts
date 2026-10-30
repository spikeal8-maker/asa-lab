import { describe, expect, it } from 'vitest';
import {
  advanceClockedArduinoRuntime,
  analyseArduinoProgramSyntax,
  arduinoRuntimeStateMatchesProgram,
  createOwnedClockedArduinoRuntime,
  type ArduinoRuntimeState,
} from '../domain/arduino-program-runtime.js';
import { analyseArduinoSourceSupport } from '../domain/arduino-capabilities.js';
import { enqueueArduinoSerialRx } from '../domain/arduino-serial-runtime.js';

function run(source: string, budget = 7) {
  let state: ArduinoRuntimeState | undefined;
  for (let i = 0; i < 10000; i++) {
    const next = advanceClockedArduinoRuntime(source, {}, 10, state, undefined, {
      instructionBudget: budget,
    });
    expect(next.diagnostics).toEqual([]);
    expect(arduinoRuntimeStateMatchesProgram(source, next.state)).toBe(true);
    if (next.executionStatus !== 'yielded') return next.state;
    state = JSON.parse(JSON.stringify(next.state));
  }
  throw new Error('Switch did not reach bounded target');
}
const sketch = (body: string, globals = '') =>
  `int result=0;${globals}void setup(){${body}}void loop(){delay(1000);}`;
function drive(
  source: string,
  target: number,
  budget: number,
  inputs: { a0?: number } = {},
  state?: ArduinoRuntimeState,
) {
  for (let i = 0; i < 1000; i++) {
    const next = advanceClockedArduinoRuntime(source, inputs, target, state, undefined, {
      instructionBudget: budget,
    });
    expect(next.diagnostics).toEqual([]);
    expect(arduinoRuntimeStateMatchesProgram(source, next.state)).toBe(true);
    state = JSON.parse(JSON.stringify(next.state)) as ArduinoRuntimeState;
    if (next.executionStatus !== 'yielded') return state;
  }
  throw new Error('Switch advance budget limit');
}

describe('Arduino integral switch dispatch', () => {
  it.each([
    ['switch(2){case 1:result=1;break;case 2:result=2;break;default:result=9;}', 2],
    ['switch(4){case 1:result=1;}', 0],
    ['switch(4){case 1:result=1;break;default:result=9;}', 9],
    ['switch(4){default:result=4;case 1:result+=1;case 2:result+=2;}', 7],
    ['switch(2){case 1:case 2:result=2;case 3:result+=3;break;default:result=9;}', 5],
    ['switch(1){case 1:switch(2){case 2:result=3;break;default:result=9;}result+=4;break;}', 7],
    [
      'for(int i=0;i<4;i++){switch(i){case 1:continue;case 2:break;default:result+=10;}result++;}',
      23,
    ],
    [
      'switch(1){case 1:for(int i=0;i<3;i++){if(i==1)continue;if(i==2)break;result++;}result+=4;break;}',
      5,
    ],
    [
      'int n=0;while(n<3){n++;switch(n){case 1:continue;case 2:break;default:result+=10;}result++;}',
      12,
    ],
    ['switch(1){case 1:{int n=7;result=n;}break;case 2:{int n=8;result=n;}break;}', 7],
    ['byte n=255;switch(n){case 255:result=8;break;}', 8],
    ['switch(4294967295UL){case 4294967295UL:result=8;break;}', 8],
    ['switch(3){case (true ? 3 : 2):result=8;break;}', 8],
    ['const int n=2;switch(3){case n+1:result=8;break;}', 8],
    ['switch(2){case min(2,3):result=8;break;}', 8],
    ['switch(2){Serial.println("case 1: { default: }");case 2:result=8;break;}', 8],
    ['switch(2){}result=8;', 8],
    [
      'int n=0;do{n++;switch(n){case 1:continue;case 2:break;default:result+=10;}result++;}while(n<3);',
      12,
    ],
  ] as const)('executes %s', (body, expected) => {
    const source = sketch(body);
    const normal = run(source);
    expect(normal.variables.result).toBe(expected);
    expect(run(source, 1)).toEqual(normal);
    expect(run(source, 2)).toEqual(normal);
    expect(createOwnedClockedArduinoRuntime(source)).toBeNull();
    expect(
      analyseArduinoSourceSupport(source).filter((item) => item.status === 'unsupported'),
    ).toEqual([]);
  });

  it('retains global constants and helper-local switch/return semantics', () => {
    const source = sketch(
      'show(2);',
      'const int choice=2;void show(int n){switch(n){case choice:result=8;delay(1);return;default:result=9;}result=99;}',
    );
    expect(run(source, 1).variables.result).toBe(8);
  });

  it('tracks preceding constant values, lexical shadowing and exact diagnostic label ranges', () => {
    expect(
      run(
        sketch(
          'const int a=3;switch(4){case a+1:result=8;break;}',
          'const int a=1;const int b=a+1;',
        ),
      ).variables.result,
    ).toBe(8);
    expect(
      run(sketch('switch(b){case a+1:result=8;break;}', 'const int a=1;const int b=a+1;')).variables
        .result,
    ).toBe(8);
    const source = 'void setup(){\nswitch(1){\ncase 1:break;\ncase 1U:break;\n}}';
    const diagnostic = analyseArduinoProgramSyntax(source)[0]!;
    expect(diagnostic.line).toBe(4);
    expect(source.slice(diagnostic.start, diagnostic.start + diagnostic.length)).toBe('case 1U:');
  });

  it.each(['analogRead(A0)', 'Serial.read()', 'n++'])(
    'evaluates selector effect %s once across a blocked pulse and JSON',
    (expression) => {
      const expected =
        expression === 'analogRead(A0)' ? 1023 : expression === 'Serial.read()' ? 65 : 1;
      const source = `int n=1;int result=0;void outer(){switch(${expression}+pulseIn(2,HIGH,100)){case ${expected}:result=7;break;default:result=99;}}void setup(){Serial.begin(9600);delay(1);outer();}void loop(){delay(1000);}`;
      let state = advanceClockedArduinoRuntime(source, { a0: 5 }, 0.1).state;
      state = { ...state, serial: enqueueArduinoSerialRx(state.serial!, 100, 'AB') };
      const waiting = advanceClockedArduinoRuntime(source, { a0: 5 }, 1.05, state).state;
      expect(waiting.pendingEvaluation).toBeDefined();
      expect(arduinoRuntimeStateMatchesProgram(source, waiting)).toBe(true);
      const done = advanceClockedArduinoRuntime(
        source,
        { a0: 0 },
        20,
        JSON.parse(JSON.stringify(waiting)),
      ).state;
      expect(done.variables.result).toBe(7);
      if (expression === 'Serial.read()')
        expect(done.serial!.rx!.map((entry) => entry.byte)).toEqual([66]);
      if (expression === 'n++') expect(done.variables.n).toBe(2);
      expect(arduinoRuntimeStateMatchesProgram(source, done)).toBe(true);
      for (const budget of [1, 2, 7]) {
        let initial = drive(source, 0.1, budget, { a0: 5 });
        initial = { ...initial, serial: enqueueArduinoSerialRx(initial.serial!, 100, 'AB') };
        const captured = drive(source, 1.05, budget, { a0: 5 }, initial);
        expect(captured.pendingEvaluation).toBeDefined();
        expect(captured).toEqual(waiting);
        let resumed = JSON.parse(JSON.stringify(waiting)) as ArduinoRuntimeState;
        for (let i = 0; i < 1000; i++) {
          const next = advanceClockedArduinoRuntime(source, { a0: 0 }, 20, resumed, undefined, {
            instructionBudget: budget,
          });
          expect(next.diagnostics).toEqual([]);
          expect(arduinoRuntimeStateMatchesProgram(source, next.state)).toBe(true);
          resumed = JSON.parse(JSON.stringify(next.state));
          if (next.executionStatus !== 'yielded') break;
          if (i === 999) throw new Error('Blocked switch budget limit');
        }
        expect(resumed).toEqual(done);
      }
    },
  );

  it('draws random before a blocked selector exactly once', () => {
    const control = run(
      'long result=0;void setup(){randomSeed(7);result=random(1,100);}void loop(){delay(1000);}',
    );
    const source = `int result=0;void setup(){randomSeed(7);delay(1);switch(random(1,100)+pulseIn(2,HIGH,100)){case ${control.variables.result}:result=7;break;default:result=99;}}void loop(){delay(1000);}`;
    const waiting = advanceClockedArduinoRuntime(source, {}, 1.05).state;
    expect(waiting.pendingEvaluation).toBeDefined();
    const done = advanceClockedArduinoRuntime(
      source,
      {},
      20,
      JSON.parse(JSON.stringify(waiting)),
    ).state;
    expect(done.variables.result).toBe(7);
    expect(done.randomState).toBe(control.randomState);
    for (const budget of [1, 2, 7]) {
      const captured = drive(source, 1.05, budget);
      expect(captured.pendingEvaluation).toBeDefined();
      expect(captured).toEqual(waiting);
      const resumed = drive(source, 20, budget, {}, captured);
      expect(resumed).toEqual(done);
    }
  });

  it.each([
    'switch(1.5){case 1:result=9;}',
    'switch(1){case 1.5:result=9;}',
    'switch(1){case 1:break;case 1U:break;}',
    'switch(1){default:break;default:break;}',
    'int n=1;switch(1){case n:break;}',
    'const int n=Serial.read();switch(1){case n:break;}',
    'unsigned int n=1;switch(n){case -1:break;}',
    'switch(1){case 65535L:break;}',
    'unsigned int n=1;switch(n){case 65535L:break;case 65535U:break;}',
    'switch(1){case 1:int x=2;case 2:result=x;}',
    'switch(1){case 1:continue;}',
    'switch(1){if(true)case 1:result=2;}',
    'const int n=1;{int n=2;switch(2){case n:result=9;}}',
    'const int a=b;const int b=2;switch(2){case a:result=9;}',
    'const int n=2;switch(2){case n++:result=9;}',
    'int switch=2;switch(2){case 2:result=9;}',
  ])('rejects before GPIO: %s', (body) => {
    const source = sketch('digitalWrite(13,HIGH);' + body);
    expect(analyseArduinoProgramSyntax(source).length).toBeGreaterThan(0);
    const next = advanceClockedArduinoRuntime(source, {}, 1);
    expect(next.state.outputVoltages).toEqual({});
  });

  it('retains case-sensitive legal identifiers Switch and SWITCH', () => {
    const source = sketch('result=Switch+SWITCH;', 'int Switch=1;int SWITCH=2;');
    expect(run(source).variables.result).toBe(3);
    expect(analyseArduinoSourceSupport(source)).toEqual([]);
  });

  it.each(['int switch=1;', 'const int switch=1;'])(
    'rejects newly exposed keyword binding %s without dispatch',
    (declaration) => {
      const source = `${declaration}void setup(){digitalWrite(13,HIGH);}void loop(){delay(1000);}`;
      expect(analyseArduinoProgramSyntax(source).length).toBeGreaterThan(0);
      const next = advanceClockedArduinoRuntime(source, {}, 1);
      expect(next.executionStatus).toBe('fault');
      expect(next.events).toEqual([]);
      expect(next.state.outputVoltages).toEqual({});
    },
  );
});
