import { describe, expect, it } from 'vitest';
import {
  advanceArduinoRuntime,
  advanceClockedArduinoRuntime,
  analyseArduinoProgramSyntax,
  arduinoRuntimeStateMatchesProgram,
  type ArduinoRuntimeState,
} from '../domain/arduino-program-runtime.js';
import { analyseArduinoSourceSupport } from '../domain/arduino-capabilities.js';

function through(source: string, horizon = 20, budget = 16384, serialized = true) {
  let state: ArduinoRuntimeState | undefined;
  const events = [];
  for (let slice = 0; slice < 100000; slice++) {
    const result = advanceClockedArduinoRuntime(source, {}, horizon, state, undefined, {
      instructionBudget: budget,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.state.virtualTimeMs).toBeLessThanOrEqual(horizon);
    expect(arduinoRuntimeStateMatchesProgram(source, result.state)).toBe(true);
    events.push(...result.events);
    if (result.executionStatus !== 'yielded') return { state: result.state, events };
    state = serialized ? JSON.parse(JSON.stringify(result.state)) : result.state;
  }
  throw new Error('Loop did not reach horizon');
}

const sketch = (body: string) => `int total=0; void setup(){${body}} void loop(){delay(100);}`;

describe('Arduino loop control semantics', () => {
  it.each([
    ['for(int i=0;i<3;i++) total += i;', 3],
    ['while(total<6) total++;', 6],
    ['for(int i=0;i<4;i++){if(i==1)continue; if(i==3)break; total+=i;}', 2],
    ['for(int i=0;i<3;i++) for(int j=0;j<3;j++) {if(j==1)break; total++;}', 3],
    ['for(int i=0;i<3;i++) if(i==1) total+=10; else total++;', 12],
    ['for(int i=3;i>0;i-=1){total+=i;}', 6],
    ['for(int i=0;i<0;i++)total++; while(false)total++;', 0],
    ['for(;total<3;)total++;', 3],
    ['for(;;){total++;if(total==3)break;}', 3],
    ['for(int i=0;i<3;i++);', 0],
    ['while(false);', 0],
    ['int i=0;while(i<5){i++;if(i==2)continue;if(i==4)break;total+=i;}', 4],
    ['for(int i=0;i<3;i++){int j=0;while(j<3){j++;if(j<3)continue;total++;}}', 3],
    ['for(int i=0;i<2;i++)if(i==0)if(false)total=99;else total++;else total+=10;', 11],
    ['for(int i=0;i<3;i++){if(i==0){total++;}else if(i==1){total+=10;}else{total+=100;}}', 111],
    ['int i=7;for(int i=0;i<2;i++){{int i=10;total+=i;}if(i==0)continue;}total+=i;', 27],
    [
      'for(int i=0;i<3;i++){ {int local=8;if(i==1)continue;if(i==2)break;total+=local;} }int local=2;total+=local;',
      10,
    ],
  ])('executes %s', (body, total) => {
    const source = sketch(body);
    expect(analyseArduinoProgramSyntax(source)).toEqual([]);
    expect(analyseArduinoSourceSupport(source).filter((d) => d.status === 'unsupported')).toEqual(
      [],
    );
    const result = advanceArduinoRuntime(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.state.variables.total).toBe(total);
    const clocked = through(source);
    expect(clocked.state.variables.total).toBe(total);
    expect(through(source, 20, 1)).toEqual(clocked);
    expect(through(source, 20, 7, false)).toEqual(clocked);
  });

  it('preserves delay position and exact GPIO / Serial order across budgets and JSON', () => {
    const source = `int total=0;void setup(){pinMode(13,OUTPUT);Serial.begin(9600);
      for(int i=0;i<3;i++){if(i==1)continue;for(int j=0;j<3;j++){
        if(j==2)break; Serial.println(i*10+j);digitalWrite(13,j);delay(1);delayMicroseconds(3);total++;}}
      Serial.println(total);}void loop(){delay(100);}`;
    const expected = through(source);
    expect(expected.state.variables.total).toBe(4);
    expect(expected.state.serial!.tx.map((e) => e.text)).toEqual([
      '0\n',
      '1\n',
      '20\n',
      '21\n',
      '4\n',
    ]);
    expect(expected.events.filter((e) => e.kind === 'output-change').map((e) => e.voltage)).toEqual(
      [0, 5, 0, 5],
    );
    for (const budget of [1, 2, 5, 17, 100]) expect(through(source, 20, budget)).toEqual(expected);
  });

  it.each([
    'for(;;);',
    'while(true){}',
    'for(;;){continue;}',
    'while(true){for(;;){break;}continue;}',
  ])('yields infinite %s without advancing beyond horizon', (body) => {
    const source = sketch(body);
    const first = advanceClockedArduinoRuntime(source, {}, 1, undefined, undefined, {
      instructionBudget: 1,
    });
    expect(first.executionStatus).toBe('yielded');
    expect(first.state.virtualTimeMs).toBeLessThan(1);
    const expected = through(source, 1);
    expect(through(source, 1, 1)).toEqual(expected);
    expect(expected.state.variables.total).toBe(0);
  });

  it.each([
    'break;',
    'int break=1;',
    'int continue=1;',
    'continue;',
    'for(int i=0;i<2;i++){int i=3;}',
    'for(;;){break;}int x=i;',
    'do {total++;}while(total<2);',
    'switch(total){case 0:break;}',
    'for(int i=0;i<2;i++)unknown();',
    'while(false){unknown();}',
    'for(int i=0;i<2;i++ )',
    'while(true) else total++;',
  ])('fails closed on %s', (body) => {
    const source = sketch(`pinMode(13,OUTPUT);digitalWrite(13,HIGH);${body}`);
    expect(analyseArduinoProgramSyntax(source).length).toBeGreaterThan(0);
    const result = advanceClockedArduinoRuntime(source, {}, 10);
    expect(result.executionStatus).toBe('fault');
    expect(result.events).toEqual([]);
    expect(result.state.outputVoltages).toEqual({});
  });

  it('finishes a valid long loop without an iteration cap', () => {
    const source = sketch('for(long i=0;i<2000;i++){total++;}');
    const expected = through(source, 100);
    expect(expected.state.variables.total).toBe(2000);
    expect(through(source, 100, 37)).toEqual(expected);
  });
});
