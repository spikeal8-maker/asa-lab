import { describe, expect, it } from 'vitest';
import {
  advanceArduinoRuntime,
  analyseArduinoProgramSyntax,
} from '../domain/arduino-program-runtime.js';
import {
  arduinoOutputBranchesFromSnapshot,
  arduinoProgrammedToneOutputsFromSnapshot,
  arduinoRuntimeSnapshot,
} from '../domain/arduino-model.js';
import { parseElectronicsDocument, type SchematicComponent } from '../domain/document.js';
import { solveCircuit } from '../domain/solver.js';

function board(source: string): SchematicComponent {
  return {
    id: 'uno',
    kind: 'visual',
    value: 5,
    position: { x: 0, y: 0 },
    componentTypeId: 'arduino-uno',
    pinIds: ['d2', 'd8', 'd9', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
    stateProperties: { arduinoSource: source },
  };
}

describe('Arduino correctness regressions', () => {
  it.each([
    ['int value = 5 / 2;', '', 2],
    ['int value = 2.9;', '', 2],
    ['byte value = 255;', 'value++;', 0],
    ['bool value = 2;', '', 1],
    ['long value = map(512, 0, 1023, 0, 255);', '', 127],
    ['int value = -5 / 2;', '', -2],
    ['int value = -5 % 2;', '', -1],
    ['float value = 5 / 2;', '', 2],
    ['float value = 5.0 / 2;', '', 2.5],
    ['byte value = 255;', 'value += 2;', 1],
    ['unsigned long value = 4294967295UL;', 'value++;', 0],
    ['int value = 0;', 'byte a = 255; value = a + 1;', 256],
    ['long value = 0;', 'value = map(-5, 0, 10, 0, 3);', -1],
    ['float value = 16777216.0;', 'value += 1.0;', 16777216],
  ])('uses Uno numeric semantics: %s %s', (globals, body, value) => {
    const result = advanceArduinoRuntime(
      `${globals} void setup(){${body}} void loop(){delay(100);}`,
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.state.variables.value).toBe(value);
  });

  it.each([
    'int divisor = 0; int value = 10 / divisor;',
    'int value = 10 % 0;',
    'int value = 32767; value++;',
    'long value = map(1, 0, 0, 0, 10);',
    'int value; digitalWrite(13, value);',
  ])('fails closed on undefined numeric execution: %s', (body) => {
    const source = `void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);${body}}void loop(){delay(100);}`;
    const result = advanceArduinoRuntime(source);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'arithmetic_error' }),
    );
    expect(result.state.outputVoltages).toEqual({});
    expect(result.events).toEqual([]);
  });

  it.each([
    'const int value = 1; value = 2;',
    'int value = 1; int value = 2;',
    'int value = high;',
    'for(int index=0;index<2;index++){} int value = index;',
    'if(HIGH){int hidden=1;} int value=hidden;',
    'for(int index=0;index<2;index++){int index=3;}',
  ])('rejects invalid declarations or scope before GPIO: %s', (body) => {
    const source = `void setup(){pinMode(13,OUTPUT);${body}}void loop(){delay(100);}`;
    expect(analyseArduinoProgramSyntax(source)).toContainEqual(
      expect.objectContaining({ code: 'compile_error' }),
    );
    expect(advanceArduinoRuntime(source).state.outputVoltages).toEqual({});
  });

  it('short circuits numeric faults without ignoring invalid names in skipped operands', () => {
    const result = advanceArduinoRuntime(`int value=0; void setup(){
      if (true || (1/0)) {value++;}
      if (false && (1/0)) {value=99;}
    } void loop(){delay(100);}`);
    expect(result.diagnostics).toEqual([]);
    expect(result.state.variables.value).toBe(1);
    expect(
      analyseArduinoProgramSyntax('void setup(){if(true || unknown){}}void loop(){}'),
    ).not.toEqual([]);
  });

  it('uses conditional Arduino macros without eagerly evaluating unused arguments', () => {
    const result = advanceArduinoRuntime(`int value=0; void setup(){
      value=constrain(-1,0,1/0);
      value+=abs(-3)+min(2,4)+max(2,4);
      for(int index=0;index<1;index++){{int index=2;value+=index;}}
    }void loop(){delay(100);}`);
    expect(result.diagnostics).toEqual([]);
    expect(result.state.variables.value).toBe(11);
  });

  it('repeats selected macro input reads as Arduino.h does', () => {
    let reads = 0;
    const result = advanceArduinoRuntime(
      'int value;void setup(){value=min(digitalRead(2),2);}void loop(){delay(100);}',
      {},
      0,
      undefined,
      () => {
        reads++;
        return { d2: 5 };
      },
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.state.variables.value).toBe(1);
    expect(reads).toBe(2);
  });

  it('does not execute numeric faults in an untaken branch during validation', () => {
    const source = `int value; void setup(){if(digitalRead(2)){value=1/0;}else{value=7;}}void loop(){delay(100);}`;
    expect(analyseArduinoProgramSyntax(source)).toEqual([]);
    expect(advanceArduinoRuntime(source, { d2: 0 }).state.variables.value).toBe(7);
    expect(advanceArduinoRuntime(source, { d2: 5 }).diagnostics[0]?.code).toBe('arithmetic_error');
  });

  it('samples each executed call once and never samples short-circuited calls', () => {
    let reads = 0;
    const result = advanceArduinoRuntime(
      `void setup(){pinMode(13,OUTPUT);
      if(false && digitalRead(2)){} if(true || digitalRead(3)){}
      digitalWrite(13,digitalRead(2));
    }void loop(){delay(100);}`,
      {},
      0,
      undefined,
      () => {
        reads++;
        return { d2: 5 };
      },
    );
    expect(result.diagnostics).toEqual([]);
    expect(reads).toBe(1);
    expect(result.state.outputVoltages.d13).toBe(5);
  });

  it('reports the arithmetic source line and retains the fault until reset', () => {
    const source = `void setup(){
      pinMode(13,OUTPUT);
      int value=analogRead(A0);
      value=10/value;
    }void loop(){delay(100);}`;
    const failed = advanceArduinoRuntime(source, { a0: 0 });
    expect(failed.diagnostics[0]).toMatchObject({ code: 'arithmetic_error', line: 4 });
    const later = advanceArduinoRuntime(
      source,
      { a0: 5 },
      100,
      JSON.parse(JSON.stringify(failed.state)),
    );
    expect(later.diagnostics).toEqual(failed.diagnostics);
    expect(later.state.outputVoltages).toEqual({});
    expect(advanceArduinoRuntime(source, { a0: 5 }).diagnostics).toEqual([]);
  });

  it('retains a failed const initializer instead of restarting it on the next tick', () => {
    const source = 'void setup(){const int value=10/analogRead(A0);}void loop(){delay(100);}';
    const failed = advanceArduinoRuntime(source, { a0: 0 });
    const later = advanceArduinoRuntime(
      source,
      { a0: 5 },
      100,
      JSON.parse(JSON.stringify(failed.state)),
    );
    expect(failed.diagnostics[0]?.code).toBe('arithmetic_error');
    expect(later.diagnostics).toEqual(failed.diagnostics);
    expect(advanceArduinoRuntime(source, { a0: 5 }).diagnostics).toEqual([]);
  });

  it('surfaces arithmetic failure through the shared circuit solver with no partial voltages', () => {
    const uno = board(
      'void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);int zero=0;int value=1/zero;}void loop(){}',
    );
    const parsed = parseElectronicsDocument({
      schemaVersion: 2,
      components: [uno],
      connections: [],
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const result = solveCircuit(parsed.document);
    expect(result.status).toBe('invalid');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'arduino_arithmetic_error' }),
    );
    expect(result.components).toEqual([]);
  });

  it.each([
    'digitalWrite(13, HIGH)\ndelay(100);',
    'digitalWrite(13, missingVariable); delay(100);',
    'digitalWrite(13, HIGH LOW); delay(100);',
    'digitalWrite(13); delay(100);',
    'digitalWrite(13,HIGH,); delay(100);',
    'digitalWrite(99,missingVariable); delay(100);',
  ])('fails closed before executing invalid code: %s', (body) => {
    const source = `void setup(){pinMode(13, OUTPUT);} void loop(){${body}}`;
    expect(analyseArduinoProgramSyntax(source)).toContainEqual(
      expect.objectContaining({ code: 'compile_error' }),
    );
    const result = advanceArduinoRuntime(source);
    expect(result.state.outputVoltages).toEqual({});
    expect(result.events).toEqual([]);
  });

  it('executes multiline calls and consumes both sides of logical expressions', () => {
    const result = advanceArduinoRuntime(`void setup(){pinMode(13,OUTPUT);} void loop(){
      if ((HIGH || LOW) && HIGH) { digitalWrite(\n13,\nHIGH\n); } delay(100);
    }`);
    expect(result.diagnostics).toEqual([]);
    expect(result.state.outputVoltages.d13).toBe(5);
  });

  it('does not invent a waveform while setup is waiting', () => {
    const uno = board(
      'void setup(){pinMode(13,OUTPUT);delay(1000);}void loop(){digitalWrite(13,HIGH);delay(1);digitalWrite(13,LOW);delay(1);}',
    );
    const snapshot = arduinoRuntimeSnapshot(uno, 10)!;
    expect(snapshot.state.phase).toBe('setup');
    expect([...arduinoProgrammedToneOutputsFromSnapshot(uno, snapshot, 10)]).toEqual([]);
    expect(
      arduinoOutputBranchesFromSnapshot(uno, snapshot, 10).find((b) => b.terminal === 'd13')
        ?.targetVoltage,
    ).toBe(0);
  });

  it('does not turn a single burst into continuous sound', () => {
    const uno = board(
      'int emitted=0;void setup(){pinMode(13,OUTPUT);}void loop(){if(emitted==0){digitalWrite(13,HIGH);delay(1);digitalWrite(13,LOW);delay(1);emitted=1;}delay(1);}',
    );
    const start = arduinoRuntimeSnapshot(uno, 0)!;
    const snapshot = arduinoRuntimeSnapshot(uno, 50, {}, start.state)!;
    expect(snapshot.state.variables.emitted).toBe(1);
    expect([...arduinoProgrammedToneOutputsFromSnapshot(uno, snapshot, 50)]).toEqual([]);
    expect(
      arduinoOutputBranchesFromSnapshot(uno, snapshot, 50).find((b) => b.terminal === 'd13')
        ?.targetVoltage,
    ).toBe(0);
  });

  it('observes an executed periodic signal without replacing the GPIO latch', () => {
    const uno = board(
      'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(1);digitalWrite(13,LOW);delay(1);}',
    );
    const snapshot = arduinoRuntimeSnapshot(uno, 9)!;
    expect([...arduinoProgrammedToneOutputsFromSnapshot(uno, snapshot, 9)]).toEqual([
      ['d13', { terminal: 'd13', frequencyHz: 500, source: 'digital-toggle' }],
    ]);
    expect(
      arduinoOutputBranchesFromSnapshot(uno, snapshot, 9).find((b) => b.terminal === 'd13')
        ?.targetVoltage,
    ).toBe(snapshot.state.outputVoltages.d13);
  });

  it.each(['INPUT', 'INPUT_PULLUP'])('releases the output driver when switching to %s', (mode) => {
    const uno = board(
      `void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);pinMode(13,${mode});}void loop(){delay(100);}`,
    );
    const snapshot = arduinoRuntimeSnapshot(uno)!;
    const branch = arduinoOutputBranchesFromSnapshot(uno, snapshot).find(
      (b) => b.terminal === 'd13',
    );
    if (mode === 'INPUT') expect(branch).toBeUndefined();
    else expect(branch).toMatchObject({ targetVoltage: 5, resistanceOhm: 20_000 });
  });

  it('preserves the output latch on repeated pinMode OUTPUT', () => {
    const result = advanceArduinoRuntime(
      'void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);pinMode(13,OUTPUT);}void loop(){delay(100);}',
    );
    expect(result.state.outputVoltages.d13).toBe(5);
  });

  it('digitalWrite HIGH on an input enables only the pullup', () => {
    const uno = board(
      'void setup(){pinMode(13,INPUT);digitalWrite(13,HIGH);}void loop(){delay(100);}',
    );
    const snapshot = arduinoRuntimeSnapshot(uno)!;
    expect(
      arduinoOutputBranchesFromSnapshot(uno, snapshot).find((b) => b.terminal === 'd13'),
    ).toMatchObject({ targetVoltage: 5, resistanceOhm: 20_000 });
  });

  it('orders timer expirations identically across sampling partitions', () => {
    const source = 'void setup(){tone(8,440,100);tone(9,500,50);}void loop(){delay(200);}';
    const start = advanceArduinoRuntime(source);
    const direct = advanceArduinoRuntime(source, {}, 150, start.state);
    const middle = advanceArduinoRuntime(source, {}, 75, start.state);
    const split = advanceArduinoRuntime(source, {}, 150, middle.state);
    expect(direct.state).toEqual(split.state);
    const times = direct.state.eventQueue.map((e) => e.atMicroseconds);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('executes delayed feedback causally instead of requiring a DC fixed point', () => {
    const uno = board(
      'void setup(){pinMode(13,OUTPUT);}void loop(){if(digitalRead(2)==HIGH){digitalWrite(13,LOW);}else{digitalWrite(13,HIGH);}delay(100);}',
    );
    const parsed = parseElectronicsDocument({
      schemaVersion: 2,
      components: [uno],
      connections: [
        {
          id: 'feedback',
          from: { componentId: 'uno', terminal: 'd13' },
          to: { componentId: 'uno', terminal: 'd2' },
          color: '#e3212b',
          vertices: [],
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      simulation: { running: false, maxIterations: 24 },
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const start = solveCircuit(parsed.document);
    expect(start.solved, JSON.stringify(start)).toBe(true);
    expect(start.components[0]?.terminalVoltages.d13).toBeCloseTo(5);
    const next = solveCircuit(parsed.document, {
      simulationTimeMs: 100,
      controllerState: start.controllerState!,
    });
    expect(next.solved).toBe(true);
    expect(next.components[0]?.terminalVoltages.d13).toBeCloseTo(0);
    const later = solveCircuit(parsed.document, {
      simulationTimeMs: 200,
      controllerState: next.controllerState!,
    });
    expect(later.solved).toBe(true);
    expect(later.components[0]?.terminalVoltages.d13).toBeCloseTo(5);
  });
});
