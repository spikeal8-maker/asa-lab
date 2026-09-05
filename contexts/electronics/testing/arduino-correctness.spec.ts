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
