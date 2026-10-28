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

function through(source: string, budget = 7, target = 10, initial?: ArduinoRuntimeState) {
  let state = initial;
  const events = [];
  for (let i = 0; i < 10000; i++) {
    const next = advanceClockedArduinoRuntime(source, {}, target, state, undefined, {
      instructionBudget: budget,
    });
    expect(next.diagnostics).toEqual([]);
    expect(arduinoRuntimeStateMatchesProgram(source, next.state)).toBe(true);
    events.push(...next.events);
    if (next.executionStatus !== 'yielded') return { state: next.state, events };
    state = JSON.parse(JSON.stringify(next.state));
  }
  throw new Error('Function execution did not reach its bounded target');
}

describe('real Arduino scalar void helper frames', () => {
  it('isolates globals from caller locals, restores caller locals, and nests calls', () => {
    const source = `int total=0;int restored=0;
void leaf(int n){total+=n;delay(1);}
void middle(byte n){int total=77;leaf(n);restored=total;}
void setup(){int total=99;middle(258);restored+=total;}
void loop(){delay(1000);}`;
    const actual = through(source);
    expect(actual.state.variables).toEqual({ total: 2, restored: 176 });
    for (const budget of [1, 2]) expect(through(source, budget)).toEqual(actual);
    expect(actual.state.activeFunction).toBeUndefined();
    expect(actual.state.functionFrames).toBeUndefined();
    expect(createOwnedClockedArduinoRuntime(source)).toBeNull();
    expect(analyseArduinoSourceSupport(source)).toEqual([]);
  });

  it('supports forward signatures, compatible repeated prototypes and definition const', () => {
    const source =
      'void show(int);void show(const int other);int value=0;void setup(){show(9);}void loop(){delay(1000);}void show(const int n){value=n;}';
    expect(through(source).state.variables.value).toBe(9);
    expect(
      analyseArduinoProgramSyntax('void f(const int n){n++;}void setup(){f(1);}').length,
    ).toBeGreaterThan(0);
  });

  it('unwinds helper-local loops/scopes on early return without affecting caller control', () => {
    const source =
      'int total=0;void f(int n){for(int i=0;i<n;i++){if(i==1)continue;if(i==4)break;total+=i;}if(total==5){return;}total=999;}void setup(){for(int k=0;k<2;k++){f(9);}}void loop(){delay(1000);}';
    expect(through(source, 1).state.variables.total).toBe(999);
    const once = source.replace('k<2', 'k<1');
    expect(through(once, 1).state.variables.total).toBe(5);
  });

  it('does not parse declarations/braces inside comments or Serial strings', () => {
    const source =
      'int value=0;/*void fake(int x){}*/void setup(){Serial.begin(9600);Serial.println("} void fake(int x) { ?");real();}void real(){value=7;}void loop(){delay(1000);}';
    expect(through(source).state.variables.value).toBe(7);
    const fakeRoot =
      'int value=0;void log(){Serial.println("void loop() { } void setup() { }");}void setup(){Serial.begin(9600);log();value=9;}void loop(){delay(1000);}';
    expect(through(fakeRoot).state.variables.value).toBe(9);
  });

  it('suspends inside a helper and validates/restores its frame through JSON', () => {
    const source =
      'int result=0;void f(int n){int local=n+2;delay(2);result=local;}void setup(){f(3);}void loop(){delay(1000);}';
    const waiting = through(source, 1, 1).state;
    expect(waiting.activeFunction).toBe('f');
    expect(waiting.functionFrames).toHaveLength(1);
    expect(waiting.scopes[1]!.local.value).toBe(5);
    expect(
      through(source, 1, 10, JSON.parse(JSON.stringify(waiting)) as ArduinoRuntimeState).state
        .variables.result,
    ).toBe(5);
    for (const patch of [
      { activeFunction: 'constructor' },
      { activeFunction: 'missing' },
      { functionFrames: [] },
      { functionFrames: new Array(1) },
      { functionFrames: [null] },
      { functionFrames: [{ ...waiting.functionFrames![0], returnProgramCounter: 0 }] },
      { functionFrames: [{ ...waiting.functionFrames![0], callerFunction: 'f' }] },
      {
        scopes: [
          waiting.scopes[0],
          { ...waiting.scopes[1], n: { type: 'long', constant: false, value: 3 } },
        ],
      },
    ])
      expect(
        arduinoRuntimeStateMatchesProgram(source, { ...waiting, ...patch } as ArduinoRuntimeState),
      ).toBe(false);
    const sparseScopes = [...waiting.scopes];
    delete sparseScopes[0];
    expect(arduinoRuntimeStateMatchesProgram(source, { ...waiting, scopes: sparseScopes })).toBe(
      false,
    );
  });

  it.each(['analogRead(A0)', 'Serial.read()', 'n++'])(
    'evaluates %s once before a blocked later argument inside a helper',
    (expression) => {
      const source = `int n=1;long captured=0;void take(int first,long duration){captured=first;}void outer(){take(${expression},pulseIn(2,HIGH,100));}void setup(){Serial.begin(9600);delay(1);outer();}void loop(){delay(1000);}`;
      let state = advanceClockedArduinoRuntime(source, { a0: 5 }, 0.1).state;
      state = { ...state, serial: enqueueArduinoSerialRx(state.serial!, 100, 'AB') };
      const waiting = advanceClockedArduinoRuntime(source, { a0: 5 }, 1.05, state).state;
      expect(waiting.pendingEvaluation).toBeDefined();
      expect(waiting.activeFunction).toBe('outer');
      expect(arduinoRuntimeStateMatchesProgram(source, waiting)).toBe(true);
      const changed = JSON.parse(JSON.stringify(waiting)) as ArduinoRuntimeState;
      const done = advanceClockedArduinoRuntime(source, { a0: 0 }, 20, changed).state;
      expect(done.variables.captured).toBe(
        expression === 'analogRead(A0)' ? 1023 : expression === 'Serial.read()' ? 65 : 1,
      );
      if (expression === 'Serial.read()') expect(done.serial!.rx!.map((e) => e.byte)).toEqual([66]);
      if (expression === 'n++') expect(done.variables.n).toBe(2);
      expect(
        arduinoRuntimeStateMatchesProgram(source, {
          ...waiting,
          pendingEvaluation: { ...waiting.pendingEvaluation!, callContext: 'forged' },
        }),
      ).toBe(false);
    },
  );

  it('retains a coherent faulted function snapshot instead of resetting on re-advance', () => {
    const source =
      'void f(){int uninitialized;digitalWrite(13,uninitialized);}void setup(){f();}void loop(){delay(1);}';
    const fault = advanceClockedArduinoRuntime(source, {}, 10);
    expect(fault.executionStatus).toBe('fault');
    expect(fault.state.activeFunction).toBe('f');
    expect(arduinoRuntimeStateMatchesProgram(source, fault.state)).toBe(true);
    const again = advanceClockedArduinoRuntime(
      source,
      {},
      20,
      JSON.parse(JSON.stringify(fault.state)),
    );
    expect(again.executionStatus).toBe('fault');
    expect(again.state.faults).toEqual(fault.state.faults);
    expect(again.state.outputVoltages).toEqual({});
  });

  it.each([
    'void if(){}',
    'void f(){break;}',
    'void f(){continue;}',
    'void HIGH(){}',
    'void f(int return){}',
    'void f(int A0){}',
    'void f(int D13){}',
    'void f(){int D13=2;}',
    'void f(){f();}',
    'void f(){g();}void g(){f();}',
    'void f(int n){}void f(long n){}',
    'void f(int n=1){}',
    'void f(int &n){}',
    'void f(int n[]){}',
    'int f(){return 1;}',
    'void f(int n){}void setup(){f();}',
    'void f(){}void setup(){int x=f();}',
    'void f(int);void f(long n){}',
    'void f(){unknown();}',
    'float readUltrasonicCm(int a,int b){return 0;}',
    'void digitalWrite(int p,int v){}',
  ])('rejects unavailable or inconsistent function source before GPIO: %s', (definitions) => {
    const source = definitions + 'void loop(){digitalWrite(13,HIGH);delay(1);}';
    expect(analyseArduinoProgramSyntax(source).length).toBeGreaterThan(0);
    const actual = advanceClockedArduinoRuntime(source, {}, 1);
    expect(actual.executionStatus).toBe('fault');
    expect(actual.state.outputVoltages).toEqual({});
    expect(actual.events).toEqual([]);
  });

  it('keeps independent boards and their caller scopes isolated', () => {
    const source =
      'int count=0;void step(int n){count+=n;delay(2);}void loop(){step(digitalRead(2)?1:2);}';
    const a = advanceClockedArduinoRuntime(source, { d2: 5 }, 5).state;
    const b = advanceClockedArduinoRuntime(source, { d2: 0 }, 5).state;
    expect(a.variables.count).toBe(3);
    expect(b.variables.count).toBe(6);
    expect(
      advanceClockedArduinoRuntime(source, { d2: 5 }, 10, JSON.parse(JSON.stringify(a))).state
        .variables.count,
    ).toBe(5);
    expect(b.variables.count).toBe(6);
  });

  it('charges real call/return instructions while preserving the requested helper delay', () => {
    const source =
      'void f(){digitalWrite(13,HIGH);delayMicroseconds(3);digitalWrite(13,LOW);}void setup(){pinMode(13,OUTPUT);f();}void loop(){delay(1000);}';
    const actual = through(source, 1);
    expect(
      actual.events
        .filter((event) => event.kind === 'output-change' && event.voltage === 5)
        .map((event) => event.atMicroseconds),
    ).toEqual([2]);
    expect(
      actual.events
        .filter((event) => event.kind === 'output-change' && event.voltage === 0)
        .map((event) => event.atMicroseconds),
    ).toEqual([0, 7]);
  });
  it('rejects helper scope depth that could not be restored from a valid snapshot', () => {
    const source = `void f(){${'{'.repeat(127)}delay(1);${'}'.repeat(127)}}void setup(){f();}`;
    expect(analyseArduinoProgramSyntax(source).length).toBeGreaterThan(0);
    expect(advanceClockedArduinoRuntime(source, {}, 10).state.outputVoltages).toEqual({});
  });
});
