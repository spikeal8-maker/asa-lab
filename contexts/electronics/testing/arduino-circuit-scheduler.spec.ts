import { describe, expect, it } from 'vitest';
import {
  advanceArduinoCircuitClock,
  type ArduinoCircuitClockAdvance,
  type ArduinoCircuitClockState,
  type ArduinoCircuitInputEvent,
} from '../domain/arduino-circuit-scheduler.js';
import {
  parseElectronicsDocument,
  type ElectronicsDocument,
  type SchematicComponent,
} from '../domain/document.js';
import { arduinoRuntimeStateMatchesProgram } from '../domain/arduino-program-runtime.js';
import {
  arduinoWaveformEdgeMicroseconds,
  isArduinoTimedWaveformState,
} from '../domain/arduino-waveform-runtime.js';
import { analyseCircuit } from '../domain/simulation.js';

function board(id: string, source: string): SchematicComponent {
  return {
    id,
    kind: 'visual',
    value: 5,
    position: { x: 0, y: 0 },
    componentTypeId: 'arduino-uno',
    pinIds: ['d2', 'd3', 'd8', 'd9', 'd13', 'a0', 'power-5v', 'power-3v3', 'power-gnd-1'],
    stateProperties: { arduinoSource: source },
  };
}
function part(id: string, kind: SchematicComponent['kind'], value = 1000): SchematicComponent {
  return { id, kind, value, position: { x: 0, y: 0 } };
}
function servoMotor(id: string): SchematicComponent {
  return {
    id,
    kind: 'visual',
    value: 0,
    position: { x: 0, y: 0 },
    componentTypeId: 'servo-motor',
    variantId: 'servo-motor',
    pinIds: ['gnd', 'vcc', 'signal'],
    stateProperties: { angleDegrees: 90 },
  };
}
function hcSr04(id: string, distanceMeters = 1): SchematicComponent {
  return {
    id,
    kind: 'visual',
    value: 0,
    position: { x: 0, y: 0 },
    componentTypeId: 'ultrasonic-hc-sr04',
    variantId: 'ultrasonic-hc-sr04',
    pinIds: ['vcc', 'trigger', 'echo', 'gnd'],
    stateProperties: { distanceMeters },
  };
}
function circuit(
  components: SchematicComponent[],
  wires: [string, string, string, string][] = [],
): ElectronicsDocument {
  const parsed = parseElectronicsDocument({
    schemaVersion: 2,
    components,
    connections: wires.map(([from, a, to, b], index) => ({
      id: `w${index}`,
      from: { componentId: from, terminal: a },
      to: { componentId: to, terminal: b },
    })),
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}
function through(
  document: ElectronicsDocument,
  time: number,
  previous?: ArduinoCircuitClockState,
  inputs?: readonly ArduinoCircuitInputEvent[],
  budget = 256,
): ArduinoCircuitClockAdvance {
  const events: ArduinoCircuitClockAdvance['events'][number][] = [];
  for (let iteration = 0; iteration < 10000; iteration++) {
    const result = advanceArduinoCircuitClock(document, time, previous, {
      inputs,
      maxClockEvents: budget,
    });
    events.push(...result.events);
    if (result.executionStatus !== 'yielded') return { ...result, events };
    expect(result.result).toBeNull();
    expect(result.state!.reachedMicroseconds).toBeLessThan(time);
    previous = JSON.parse(JSON.stringify(result.state));
  }
  throw new Error('Scheduler did not reach target');
}
const idle = 'void loop(){delay(100);}';
const runtime = (result: ArduinoCircuitClockAdvance, id = 'uno') =>
  result.state!.boards.find((entry) => entry.componentId === id)!.runtime;
const hcRuntime = (result: ArduinoCircuitClockAdvance, id = 'sonar') =>
  result.state!.hcSr04!.find((entry) => entry.componentId === id)!.runtime;
const servoRuntime = (result: ArduinoCircuitClockAdvance, id = 'servo') =>
  result.state!.servoMotors!.find((entry) => entry.componentId === id)!.runtime;

function servoCircuit(angleDegrees: number, powered = true, reversed = false) {
  const source = `#include <Servo.h>\nServo motor;int readback=-1;
    void setup(){motor.attach(9);}void loop(){motor.write(${angleDegrees});readback=motor.read();delay(100);}`;
  const wires: [string, string, string, string][] = [
    ['uno', 'power-gnd-1', 'servo', 'gnd'],
    ['uno', 'd9', 'servo', 'signal'],
  ];
  if (powered) wires.unshift(['uno', 'power-5v', 'servo', 'vcc']);
  const components = reversed
    ? [servoMotor('servo'), board('uno', source)]
    : [board('uno', source), servoMotor('servo')];
  return circuit(components, reversed ? [...wires].reverse() : wires);
}

function hcSr04Circuit(distanceMeters: number, triggerDelayUs = 10, powered = true) {
  const source = `unsigned long duration=0;void setup(){pinMode(13,OUTPUT);pinMode(2,INPUT);
    digitalWrite(13,LOW);delayMicroseconds(2);digitalWrite(13,HIGH);
    delayMicroseconds(${triggerDelayUs});digitalWrite(13,LOW);duration=pulseIn(2,HIGH,30000);}
    void loop(){delay(100);}`;
  const wires: [string, string, string, string][] = [
    ['uno', 'power-gnd-1', 'sonar', 'gnd'],
    ['uno', 'd13', 'sonar', 'trigger'],
    ['sonar', 'echo', 'uno', 'd2'],
  ];
  if (powered) wires.unshift(['uno', 'power-5v', 'sonar', 'vcc']);
  return circuit([board('uno', source), hcSr04('sonar', distanceMeters)], wires);
}

describe('Arduino shared dc-inputs-v1 circuit clock', () => {
  it('verifies the existing DC path from committed GPIO, without replaying input-dependent code', () => {
    const doc = circuit(
      [
        board(
          'uno',
          `void setup(){pinMode(2,INPUT_PULLUP);pinMode(13,OUTPUT);digitalWrite(13,digitalRead(2));}${idle}`,
        ),
        part('r', 'resistor'),
      ],
      [
        ['uno', 'd13', 'r', 'a'],
        ['r', 'b', 'uno', 'power-gnd-1'],
      ],
    );
    const done = analyseCircuit(doc);
    expect(done.solved).toBe(true);
    expect(done.quality.passed).toBe(true);
    expect(done.components.find((entry) => entry.componentId === 'r')!.current).toBeCloseTo(
      5 / 1010,
      8,
    );
  });

  it('applies a same-time input before a digital read and supports independent digital roles on A0', () => {
    const doc = circuit(
      [
        board(
          'uno',
          `int digital;int analogPin;void setup(){pinMode(2,INPUT_PULLUP);pinMode(A0,INPUT_PULLUP);digital=digitalRead(2);analogPin=digitalRead(A0);}${idle}`,
        ),
        part('one', 'button'),
        part('two', 'button'),
      ],
      [
        ['uno', 'd2', 'one', 'a'],
        ['one', 'b', 'uno', 'power-gnd-1'],
        ['uno', 'a0', 'two', 'a'],
        ['two', 'b', 'uno', 'power-gnd-1'],
      ],
    );
    const inputs: ArduinoCircuitInputEvent[] = [
      { atMicroseconds: 2, componentId: 'one', property: 'state', value: true },
    ];
    const done = through(doc, 10, undefined, inputs, 1);
    expect(done.diagnostics).toEqual([]);
    expect(runtime(done).variables).toMatchObject({ digital: 0, analogPin: 1 });
    const both = through(doc, 10, undefined, [
      ...inputs,
      { atMicroseconds: 3, componentId: 'two', property: 'state', value: true },
    ]);
    expect(runtime(both).variables).toMatchObject({ digital: 0, analogPin: 0 });
  });

  it('solves GPIO through a resistive divider into ADC rather than copying its latch voltage', () => {
    const doc = circuit(
      [
        board(
          'uno',
          `int reading;void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);reading=analogRead(A0);}${idle}`,
        ),
        part('top', 'resistor', 1000),
        part('bottom', 'resistor', 1000),
      ],
      [
        ['uno', 'd13', 'top', 'a'],
        ['top', 'b', 'bottom', 'a'],
        ['bottom', 'b', 'uno', 'power-gnd-1'],
        ['bottom', 'a', 'uno', 'a0'],
      ],
    );
    const result = through(doc, 10);
    expect(result.diagnostics).toEqual([]);
    const voltage = result.result!.components.find((entry) => entry.componentId === 'uno')!
      .terminalVoltages.a0!;
    expect(voltage).toBeCloseTo((5 * 1000) / 2010, 7);
    expect(runtime(result).variables.reading).toBeGreaterThanOrEqual(508);
    expect(runtime(result).variables.reading).toBeLessThanOrEqual(510);
  });

  it('couples a millis busy-wait to a real resistor load without a fake final result on yield', () => {
    const doc = circuit(
      [
        board(
          'uno',
          `void setup(){pinMode(13,OUTPUT);while(millis()<10){}digitalWrite(13,HIGH);}${idle}`,
        ),
        part('r', 'resistor'),
      ],
      [
        ['uno', 'd13', 'r', 'a'],
        ['r', 'b', 'uno', 'power-gnd-1'],
      ],
    );
    const pending = advanceArduinoCircuitClock(doc, 20000, undefined, { maxClockEvents: 16 });
    expect(pending.executionStatus).toBe('yielded');
    expect(pending.result).toBeNull();
    expect(pending.state!.reachedMicroseconds).toBeLessThan(20000);
    const done = through(doc, 20000, pending.state!);
    expect(done.diagnostics).toEqual([]);
    expect(done.executionStatus).toBe('ready');
    expect(done.result!.solved).toBe(true);
    expect(runtime(done).outputVoltages.d13).toBe(5);
    const resistor = done.result!.components.find((entry) => entry.componentId === 'r')!;
    expect(Math.abs(resistor.voltageDrop)).toBeCloseTo((5 * 1000) / 1010, 6);
    expect(Math.abs(resistor.current)).toBeCloseTo(5 / 1010, 8);
    expect(done.result!.numericalResidual).toBeLessThanOrEqual(done.result!.numericalTolerance);
    expect(done.result!.quality.passed).toBe(true);
    expect(done.result!.quality.maxKclResidualAmp).toBeLessThanOrEqual(
      done.result!.quality.kclToleranceAmp,
    );
  });

  it.each([
    ['a', 'z'],
    ['z', 'a'],
  ])('samples simultaneous peers before committing either board (%s, %s)', (sender, receiver) => {
    const doc = circuit(
      [
        board(sender, `void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}${idle}`),
        board(
          receiver,
          `int first;int second;void setup(){pinMode(2,INPUT);first=digitalRead(2);second=digitalRead(2);}${idle}`,
        ),
      ],
      [
        [sender, 'd13', receiver, 'd2'],
        [sender, 'power-gnd-1', receiver, 'power-gnd-1'],
      ],
    );
    const done = through(doc, 10);
    expect(done.diagnostics).toEqual([]);
    expect(runtime(done, receiver).variables).toMatchObject({ first: 0, second: 1 });
    expect(
      through(
        {
          ...doc,
          components: [...doc.components].reverse(),
          connections: [...doc.connections].reverse(),
        },
        10,
      ),
    ).toEqual(done);
  });

  it('wakes a pending peer pulseIn from committed Arduino GPIO edges without order dependence', () => {
    const senderId = 'a-sender';
    const receiverId = 'b-receiver';
    const sender = board(
      senderId,
      `void setup(){pinMode(13,OUTPUT);delayMicroseconds(5);digitalWrite(13,HIGH);delayMicroseconds(20);digitalWrite(13,LOW);}void loop(){delay(100);}`,
    );
    const receiver = board(
      receiverId,
      `unsigned long duration=0;void setup(){pinMode(2,INPUT);duration=pulseIn(2,HIGH,200);}void loop(){delay(100);}`,
    );
    const run = (components: SchematicComponent[]) =>
      through(
        circuit(components, [
          [senderId, 'd13', receiverId, 'd2'],
          [senderId, 'power-gnd-1', receiverId, 'power-gnd-1'],
        ]),
        100,
        undefined,
        undefined,
        1,
      );

    const pulseWidthFromSenderEvents = (result: ArduinoCircuitClockAdvance) => {
      const senderEdges = result.events.filter(
        (event) =>
          event.componentId === senderId &&
          event.kind === 'output-change' &&
          event.terminal === 'd13',
      );
      const high = senderEdges.find((event) => event.voltage === 5);
      const low = senderEdges.find(
        (event) => event.voltage === 0 && high && event.atMicroseconds > high.atMicroseconds,
      );
      expect(high).toBeDefined();
      expect(low).toBeDefined();
      return low!.atMicroseconds - high!.atMicroseconds;
    };

    const forward = run([sender, receiver]);
    expect(forward.diagnostics).toEqual([]);
    const forwardWidth = pulseWidthFromSenderEvents(forward);
    expect(runtime(forward, receiverId).variables.duration).toBe(forwardWidth);

    const reversed = run([receiver, sender]);
    const reversedWidth = pulseWidthFromSenderEvents(reversed);
    expect(reversedWidth).toBe(forwardWidth);
    expect(runtime(reversed, receiverId).variables.duration).toBe(reversedWidth);
    expect(reversed.state).toEqual(forward.state);
    expect(reversed.result).toEqual(forward.result);
  });

  it.each([
    [0.02, 116],
    [1, 5800],
    [4, 23200],
  ])('drives HC-SR04 at %s m through Arduino trigger -> echo -> pulseIn', (distance, width) => {
    const done = through(hcSr04Circuit(distance), 25000);
    expect(done.diagnostics).toEqual([]);
    const sensor = hcRuntime(done);
    expect(sensor.lastEchoStartMicroseconds).toBeDefined();
    expect(sensor.lastEchoEndMicroseconds).toBeDefined();
    const generatedWidth = sensor.lastEchoEndMicroseconds! - sensor.lastEchoStartMicroseconds!;
    expect(generatedWidth).toBe(width);
    expect(runtime(done).variables.duration).toBe(generatedWidth);
  });

  it('ignores a sub-10us Arduino trigger and pulseIn times out cleanly', () => {
    const done = through(hcSr04Circuit(1, 5), 31000);
    const triggerEdges = done.events.filter(
      (event) =>
        event.componentId === 'uno' && event.kind === 'output-change' && event.terminal === 'd13',
    );
    const high = triggerEdges.find((event) => event.voltage === 5)!;
    const low = triggerEdges.find(
      (event) => event.voltage === 0 && event.atMicroseconds > high.atMicroseconds,
    )!;
    expect(low.atMicroseconds - high.atMicroseconds).toBeLessThan(10);
    expect(hcRuntime(done).lastEchoStartMicroseconds).toBeUndefined();
    expect(runtime(done).variables.duration).toBe(0);
  });

  it('does not generate echo when HC-SR04 is unpowered', () => {
    const done = through(hcSr04Circuit(1, 10, false), 31000);
    expect(done.diagnostics).toEqual([]);
    expect(hcRuntime(done).powered).toBe(false);
    expect(hcRuntime(done).lastEchoStartMicroseconds).toBeUndefined();
    expect(runtime(done).variables.duration).toBe(0);
  });

  it('keeps HC-SR04 result invariant across scheduler work quanta', () => {
    const doc = hcSr04Circuit(1);
    expect(through(doc, 7000, undefined, undefined, 1)).toEqual(
      through(doc, 7000, undefined, undefined, 256),
    );
  });

  it('resumes a JSON-serialized HC-SR04 pending echo identically', () => {
    const doc = hcSr04Circuit(1);
    const early = through(doc, 100, undefined, undefined, 3);
    expect(hcRuntime(early).phase).toBe('echo-delay');
    const resumed = through(doc, 7000, JSON.parse(JSON.stringify(early.state)), undefined, 3);
    const direct = through(doc, 7000);
    expect(resumed.state).toEqual(direct.state);
    expect(resumed.result).toEqual(direct.result);
    expect([...early.events, ...resumed.events]).toEqual(direct.events);
  });

  it('keeps HC-SR04 canonical result invariant under component and wire order', () => {
    const doc = hcSr04Circuit(1);
    const reference = through(doc, 7000);
    const reversed = through(
      {
        ...doc,
        components: [...doc.components].reverse(),
        connections: [...doc.connections].reverse(),
      },
      7000,
    );
    expect(reversed).toEqual(reference);
  });

  it('preserves the complete trace, final state and numerical result across quanta and time partitions', () => {
    const doc = circuit(
      [
        board(
          'uno',
          `void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);digitalWrite(13,LOW);}`,
        ),
        part('r', 'resistor'),
      ],
      [
        ['uno', 'd13', 'r', 'a'],
        ['r', 'b', 'uno', 'power-gnd-1'],
      ],
    );
    const direct = through(doc, 1200, undefined, undefined, 1024);
    expect(direct.diagnostics).toEqual([]);
    expect(direct.events.length).toBeGreaterThan(256);
    expect(through(doc, 1200, undefined, undefined, 7)).toEqual(direct);
    const start = through(doc, 701, undefined, undefined, 3);
    const end = through(doc, 1200, JSON.parse(JSON.stringify(start.state)), undefined, 5);
    expect(end.state).toEqual(direct.state);
    expect(end.result).toEqual(direct.result);
    expect([...start.events, ...end.events]).toEqual(direct.events);
    const repeated = through(doc, 1200, end.state!);
    expect(repeated.events).toEqual([]);
    expect(repeated.state).toEqual(end.state);
  });

  function buttonCircuit() {
    return circuit(
      [
        board(
          'uno',
          `int level;void setup(){pinMode(2,INPUT_PULLUP);}void loop(){level=digitalRead(2);delayMicroseconds(5);}`,
        ),
        part('key', 'button'),
      ],
      [
        ['uno', 'd2', 'key', 'a'],
        ['key', 'b', 'uno', 'power-gnd-1'],
      ],
    );
  }
  it('applies button changes by timestamp, not retrospectively over a catch-up interval', () => {
    const doc = buttonCircuit();
    const inputs: ArduinoCircuitInputEvent[] = [
      { atMicroseconds: 50, componentId: 'key', property: 'state', value: true },
    ];
    const early = through(doc, 40, undefined, inputs);
    expect(early.diagnostics).toEqual([]);
    expect(runtime(early).variables.level).toBe(1);
    const late = through(doc, 70, early.state!);
    expect(runtime(late).variables.level).toBe(0);
    expect(through(doc, 70, undefined, inputs).state).toEqual(late.state);
    expect(through(doc, 70, early.state!, inputs).state).toEqual(late.state);
  });

  it('measures pulseIn from timestamped canonical circuit input events', () => {
    const doc = circuit(
      [
        board(
          'uno',
          `unsigned long duration=0;void setup(){pinMode(2,INPUT_PULLUP);duration=pulseIn(2,LOW,100);}void loop(){delay(100);}`,
        ),
        part('key', 'button'),
      ],
      [
        ['uno', 'd2', 'key', 'a'],
        ['key', 'b', 'uno', 'power-gnd-1'],
      ],
    );
    const inputs: ArduinoCircuitInputEvent[] = [
      { atMicroseconds: 10, componentId: 'key', property: 'state', value: true },
      { atMicroseconds: 35, componentId: 'key', property: 'state', value: false },
    ];

    const done = through(doc, 50, undefined, inputs, 1);
    expect(done.diagnostics).toEqual([]);
    expect(runtime(done).variables.duration).toBe(25);
    expect(runtime(done).pulseWait).toBeUndefined();
    expect(through(doc, 50, undefined, inputs, 7).state).toEqual(done.state);
  });

  it('accepts events at startup and append-only retries; rejects late edits and changed electrical documents', () => {
    const doc = buttonCircuit();
    const input: ArduinoCircuitInputEvent = {
      atMicroseconds: 0,
      componentId: 'key',
      property: 'state',
      value: true,
    };
    const first = through(doc, 10, undefined, [input]);
    expect(runtime(first).variables.level).toBe(0);
    const future = { ...input, atMicroseconds: 20, value: false };
    expect(through(doc, 30, first.state!, [input, future]).diagnostics).toEqual([]);
    for (const inputs of [
      [],
      [{ ...input, value: false }],
      [input, { ...future, atMicroseconds: 10 }],
    ]) {
      const rejected = through(doc, 30, first.state!, inputs);
      expect(rejected.executionStatus).toBe('fault');
      expect(rejected.result).toBeNull();
      expect(rejected.events).toEqual([]);
    }
    const changed = {
      ...doc,
      components: doc.components.map((component) =>
        component.id === 'key' ? { ...component, state: true } : component,
      ),
    };
    expect(through(changed, 30, first.state!).diagnostics[0]!.code).toBe(
      'invalid_clock_continuation',
    );
    const moved = {
      ...doc,
      components: doc.components.map((component) => ({ ...component, position: { x: 900, y: 5 } })),
    };
    expect(through(moved, 30, first.state!).diagnostics).toEqual([]);
  });

  it('reads the actual potentiometer divider through ADC and applies its next position at the recorded time', () => {
    const doc = circuit(
      [
        board(
          'uno',
          'int reading;void setup(){}void loop(){reading=analogRead(A0);delayMicroseconds(5);}',
        ),
        { ...part('pot', 'potentiometer', 10000), wiperPosition: 0.5 },
      ],
      [
        ['uno', 'power-5v', 'pot', 'a'],
        ['uno', 'power-gnd-1', 'pot', 'b'],
        ['uno', 'a0', 'pot', 'wiper'],
      ],
    );
    const early = through(doc, 10, undefined, [
      { atMicroseconds: 20, componentId: 'pot', property: 'wiperPosition', value: 0.75 },
    ]);
    expect(early.diagnostics).toEqual([]);
    expect(runtime(early).variables.reading).toBeGreaterThanOrEqual(510);
    expect(runtime(early).variables.reading).toBeLessThanOrEqual(512);
    const late = through(doc, 30, early.state!);
    expect(runtime(late).variables.reading).toBeGreaterThanOrEqual(254);
    expect(runtime(late).variables.reading).toBeLessThanOrEqual(256);
  });

  it('publishes PWM electrical output after a timed potentiometer input', () => {
    const doc = circuit(
      [
        board(
          'uno',
          'void setup(){pinMode(9,OUTPUT);}void loop(){analogWrite(9,map(analogRead(A0),0,1023,0,255));delay(10);}',
        ),
        { ...part('pot', 'potentiometer', 10_000), wiperPosition: 0 },
        part('load', 'resistor', 330),
      ],
      [
        ['uno', 'power-5v', 'pot', 'a'],
        ['uno', 'power-gnd-1', 'pot', 'b'],
        ['pot', 'wiper', 'uno', 'a0'],
        ['uno', 'd9', 'load', 'a'],
        ['load', 'b', 'uno', 'power-gnd-1'],
      ],
    );
    const initial = through(doc, 100_000);
    expect(initial.executionStatus).toBe('ready');
    const initialOutput = initial.result!.components.find((entry) => entry.componentId === 'uno')!
      .terminalVoltages.d9!;
    const event: ArduinoCircuitInputEvent = {
      atMicroseconds: 100_001,
      componentId: 'pot',
      property: 'wiperPosition',
      value: 1,
    };
    const changed = through(doc, 200_000, initial.state!, [event]);
    expect(changed.executionStatus).toBe('ready');
    const changedOutput = changed.result!.components.find((entry) => entry.componentId === 'uno')!
      .terminalVoltages.d9!;
    expect(initialOutput).toBeGreaterThan(4.8);
    expect(changedOutput).toBeLessThan(0.1);
  });

  it('keeps a passive no-source circuit observable for runtime mode changes', () => {
    const doc = circuit(
      [
        part('load', 'resistor', 1_000),
        {
          id: 'meter',
          kind: 'visual',
          value: 0,
          position: { x: 0, y: 0 },
          componentTypeId: 'multimeter',
          pinIds: ['com', 'v-ohm-ma'],
          stateProperties: { measurementMode: 'dc-voltage', meterRange: 'auto' },
        },
      ],
      [
        ['meter', 'v-ohm-ma', 'load', 'a'],
        ['meter', 'com', 'load', 'b'],
      ],
    );
    const observed = through(doc, 0);
    expect(observed.executionStatus).toBe('ready');
    expect(observed.state?.profile).toBe('dc-inputs-v1');
    expect(observed.result?.solved).toBe(false);
    expect(observed.result?.diagnostics.map((entry) => entry.code)).toContain('no_source');
  });

  it('keeps unpowered resistance measurement on the algebraic meter source', () => {
    const doc = circuit(
      [
        {
          id: 'load',
          kind: 'resistor',
          value: 1_000,
          position: { x: 0, y: 0 },
          componentTypeId: 'resistor-axial',
          pinIds: ['lead-1', 'lead-2'],
          stateProperties: { powerRatingWatt: 0.25 },
        },
        {
          id: 'meter',
          kind: 'visual',
          value: 0,
          position: { x: 0, y: 0 },
          componentTypeId: 'multimeter',
          pinIds: ['com', 'v-ohm-ma'],
          stateProperties: { measurementMode: 'resistance', meterRange: 'auto' },
        },
      ],
      [
        ['meter', 'v-ohm-ma', 'load', 'lead-1'],
        ['meter', 'com', 'load', 'lead-2'],
      ],
    );
    const measured = through(doc, 0);
    expect(measured.executionStatus, JSON.stringify(measured.diagnostics)).toBe('ready');
    expect(measured.state?.profile).toBe('dc-inputs-v1');
    const meter = measured.result!.components.find((entry) => entry.componentId === 'meter');
    expect(meter).toMatchObject({
      measurementMode: 'resistance',
      meterOpenCircuit: false,
      meterExternalPowerPresent: false,
    });
    expect(meter?.measuredValue).toBeCloseTo(1_000, 3);
  });

  it('carries source thermal damage to a persistent failed state', () => {
    const doc = circuit(
      [
        {
          ...part('source', 'source', 3),
          componentTypeId: 'battery-holder-aa-2',
          pinIds: ['BAT-', 'BAT+'],
        },
      ],
      [['source', 'BAT+', 'source', 'BAT-']],
    );
    const early = through(doc, 100_000);
    expect(early.executionStatus).toBe('ready');
    expect(
      early.result!.components.find((entry) => entry.componentId === 'source')?.presentationState,
    ).not.toBe('failed');
    const failed = through(doc, 2_500_000, early.state!);
    expect(failed.executionStatus).toBe('ready');
    expect(failed.result!.components.find((entry) => entry.componentId === 'source')).toMatchObject(
      {
        deviceHealth: 'failed_open',
        damageState: 'failed',
        presentationState: 'failed',
      },
    );
    expect(failed.result!.diagnostics.map((entry) => entry.code)).toContain('component_failed');
  });

  it('rejects malformed continuation before any carried GPIO is used as a source', () => {
    const doc = buttonCircuit();
    const valid = through(doc, 10).state!;
    for (const corrupt of [
      { ...valid, nextInputIndex: 99 },
      { ...valid, boards: [] },
      {
        ...valid,
        boards: [
          {
            componentId: 'uno',
            runtime: { ...valid.boards[0]!.runtime, outputVoltages: { d13: NaN } },
          },
        ],
      },
      {
        ...valid,
        boards: [
          { componentId: 'uno', runtime: { ...valid.boards[0]!.runtime, programCounter: 999 } },
        ],
      },
    ]) {
      const result = through(doc, 30, corrupt);
      expect(result.executionStatus).toBe('fault');
      expect(result.state).toBeNull();
      expect(result.result).toBeNull();
      expect(result.events).toEqual([]);
    }
  });

  it('keeps a single-board syntax compile failure local and observable', () => {
    const doc = circuit([board('broken', 'void setup(){digitalWrite(13,);}void loop(){}')]);
    const done = through(doc, 10);
    const brokenState = done.state!.boards.find((entry) => entry.componentId === 'broken')!;

    expect(done.executionStatus, JSON.stringify(done.diagnostics)).toBe('ready');
    expect(done.result).not.toBeNull();
    expect(done.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'compile_error', componentId: 'broken' }),
    );
    expect(done.events.filter((event) => event.componentId === 'broken')).toEqual([]);
    expect(brokenState.loadedSource).toBeNull();
    expect(runtime(done, 'broken').faults).toEqual([]);
    expect(runtime(done, 'broken').eventQueue).toEqual([]);
    expect(runtime(done, 'broken').pinModes).toEqual({});
    expect(runtime(done, 'broken').outputVoltages).toEqual({});
  });

  it('keeps the last-good program running after the editor source becomes malformed', () => {
    const sourceA =
      'int count=0;void setup(){pinMode(13,OUTPUT);}void loop(){count++;digitalWrite(13,count%2);}';
    const malformedB = 'void setup(){digitalWrite(13,);}void loop(){}';
    const documentA = circuit([board('uno', sourceA)]);
    const loadedA = through(documentA, 10);
    const countAtA = runtime(loadedA).variables.count ?? 0;

    const documentB = circuit([board('uno', malformedB)]);
    const continued = through(documentB, 20, JSON.parse(JSON.stringify(loadedA.state)));
    const boardState = continued.state!.boards.find((entry) => entry.componentId === 'uno')!;

    expect(continued.executionStatus, JSON.stringify(continued.diagnostics)).toBe('ready');
    expect(continued.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'compile_error', componentId: 'uno' }),
    );
    expect(boardState.loadedSource).toBe(sourceA);
    expect(runtime(continued).variables.count).toBeGreaterThan(countAtA);
    expect(continued.events.some((event) => event.componentId === 'uno')).toBe(true);
  });

  it('rejects explicit loaded-source mismatches instead of applying legacy inference', () => {
    const sourceA = 'int marker=1;void setup(){pinMode(13,OUTPUT);}void loop(){marker=1;}';
    const sourceC = 'int marker=2;void setup(){pinMode(13,OUTPUT);}void loop(){marker=2;}';

    const loadedC = through(circuit([board('uno', sourceC)]), 10);
    const runtimeC = loadedC.state!.boards.find((entry) => entry.componentId === 'uno')!.runtime;

    for (const loadedSource of [sourceA, null] as const) {
      const forged = {
        ...loadedC.state!,
        boards: [{ componentId: 'uno', loadedSource, runtime: runtimeC }],
      };
      const rejected = through(
        circuit([board('uno', sourceC)]),
        20,
        JSON.parse(JSON.stringify(forged)),
      );

      expect(rejected.executionStatus).toBe('fault');
      expect(rejected.diagnostics[0]?.code).toBe('invalid_clock_continuation');
      expect(rejected.state).toBeNull();
      expect(rejected.result).toBeNull();
      expect(rejected.events).toEqual([]);
    }
  });

  it('replaces A with valid C and keeps C as last-good after malformed B', () => {
    const sourceA =
      'int marker=1;void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}void loop(){marker=1;}';
    const sourceC =
      'int marker=2;void setup(){pinMode(13,OUTPUT);digitalWrite(13,LOW);}void loop(){marker=2;}';
    const malformedB = 'void setup(){digitalWrite(13,);}void loop(){}';

    const loadedA = through(circuit([board('uno', sourceA)]), 10);
    const loadedC = through(
      circuit([board('uno', sourceC)]),
      20,
      JSON.parse(JSON.stringify(loadedA.state)),
    );
    const loopsAtC = runtime(loadedC).loopIterations;
    const cState = loadedC.state!.boards.find((entry) => entry.componentId === 'uno')!;

    expect(cState.loadedSource).toBe(sourceC);
    expect(runtime(loadedC).variables.marker).toBe(2);
    expect(runtime(loadedC).outputVoltages.d13).toBe(0);

    const continuedC = through(
      circuit([board('uno', malformedB)]),
      30,
      JSON.parse(JSON.stringify(loadedC.state)),
    );
    const continuedState = continuedC.state!.boards.find((entry) => entry.componentId === 'uno')!;

    expect(continuedC.executionStatus, JSON.stringify(continuedC.diagnostics)).toBe('ready');
    expect(continuedC.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'compile_error', componentId: 'uno' }),
    );
    expect(continuedState.loadedSource).toBe(sourceC);
    expect(runtime(continuedC).variables.marker).toBe(2);
    expect(runtime(continuedC).loopIterations).toBeGreaterThan(loopsAtC);
    expect(runtime(continuedC).outputVoltages.d13).toBe(0);
  });

  it('keeps a valid peer board running when another board has a syntax compile failure', () => {
    const doc = circuit([
      board(
        'a-valid',
        'void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}void loop(){delay(100);}',
      ),
      board('b-broken', 'void setup(){digitalWrite(13,);}void loop(){}'),
    ]);
    const done = through(doc, 10);

    expect(done.executionStatus, JSON.stringify(done.diagnostics)).toBe('ready');
    expect(done.result).not.toBeNull();
    expect(done.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'compile_error', componentId: 'b-broken' }),
    );
    expect(runtime(done, 'a-valid').outputVoltages.d13).toBe(5);
    expect(runtime(done, 'b-broken').outputVoltages).toEqual({});
    expect(done.events.some((event) => event.componentId === 'a-valid')).toBe(true);
    expect(done.events.some((event) => event.componentId === 'b-broken')).toBe(false);
  });

  it('continues the same invalid source across horizons without invalid_clock_continuation', () => {
    const doc = circuit([board('broken', 'void setup(){digitalWrite(13,);}void loop(){}')]);
    const first = through(doc, 10);
    const reset = runtime(first, 'broken');
    expect(arduinoRuntimeStateMatchesProgram('', reset)).toBe(true);
    expect(reset.faults).toEqual([]);
    expect(reset.eventQueue).toEqual([]);
    expect(reset.pinModes).toEqual({});
    expect(reset.outputVoltages).toEqual({});
    expect(reset.resumeAtMs).toBeGreaterThan(first.state!.reachedMicroseconds / 1000);

    const next = through(doc, 20, JSON.parse(JSON.stringify(first.state)));

    expect(next.executionStatus, JSON.stringify(next.diagnostics)).toBe('ready');
    expect(next.result).not.toBeNull();
    expect(next.state?.reachedMicroseconds).toBe(20);
    expect(next.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'compile_error', componentId: 'broken' }),
    );
    expect(next.diagnostics.map((entry) => entry.code)).not.toContain('invalid_clock_continuation');
    expect(next.events.filter((event) => event.componentId === 'broken')).toEqual([]);
  });

  it('delivers canonical Serial RX bytes to Serial.available/read in accepted order', () => {
    const source = `int count=0;int first=-2;int second=-2;
      void setup(){Serial.begin(9600);}void loop(){count=Serial.available();if(count>=2){first=Serial.read();second=Serial.read();delay(100);}}`;
    const inputs: ArduinoCircuitInputEvent[] = [
      { atMicroseconds: 5, componentId: 'uno', property: 'serialRx', value: 'AB' },
    ];
    const done = through(circuit([board('uno', source)]), 30, undefined, inputs, 1);

    expect(done.diagnostics).toEqual([]);
    expect(runtime(done).variables).toMatchObject({ count: 2, first: 65, second: 66 });
    expect(runtime(done).serial?.rx).toEqual([]);
  });

  it('preserves same-timestamp Serial RX array order', () => {
    const source = `int first=-2;int second=-2;
      void setup(){Serial.begin(9600);}void loop(){if(Serial.available()>=2){first=Serial.read();second=Serial.read();delay(100);}}`;
    const inputs: ArduinoCircuitInputEvent[] = [
      { atMicroseconds: 5, componentId: 'uno', property: 'serialRx', value: 'A' },
      { atMicroseconds: 5, componentId: 'uno', property: 'serialRx', value: 'B' },
    ];
    const done = through(circuit([board('uno', source)]), 30, undefined, inputs, 2);

    expect(runtime(done).variables).toMatchObject({ first: 65, second: 66 });
    expect(runtime(done).serial?.nextRxSequence).toBe(2);
  });

  it('ignores Serial RX before begin and returns -1 from an empty begun queue', () => {
    const source = `int value=-2;void setup(){Serial.begin(9600);}void loop(){value=Serial.read();delay(100);}`;
    const inputs: ArduinoCircuitInputEvent[] = [
      { atMicroseconds: 0, componentId: 'uno', property: 'serialRx', value: 'AB' },
    ];
    const done = through(circuit([board('uno', source)]), 20, undefined, inputs);

    expect(done.diagnostics).toEqual([]);
    expect(runtime(done).variables.value).toBe(-1);
    expect(runtime(done).serial?.rx).toEqual([]);
    expect(runtime(done).serial?.nextRxSequence).toBe(0);
  });

  it('keeps Serial RX isolated to the addressed Arduino', () => {
    const source = (baud: number) => `int value=-2;void setup(){Serial.begin(${baud});}
      void loop(){if(Serial.available()){value=Serial.read();delay(100);}}`;
    const inputs: ArduinoCircuitInputEvent[] = [
      { atMicroseconds: 5, componentId: 'b', property: 'serialRx', value: 'Z' },
    ];
    const done = through(
      circuit([board('a', source(9600)), board('b', source(115200))]),
      20,
      undefined,
      inputs,
      1,
    );

    expect(runtime(done, 'a').variables.value).toBe(-2);
    expect(runtime(done, 'a').serial?.rx).toEqual([]);
    expect(runtime(done, 'b').variables.value).toBe(90);
    expect(runtime(done, 'b').serial?.rx).toEqual([]);
  });

  it('preserves pending Serial RX through JSON continuation and work partitioning', () => {
    const source = `int first=-2;int remaining=-2;void setup(){Serial.begin(9600);}
      void loop(){delayMicroseconds(20);first=Serial.read();remaining=Serial.available();delay(100);}`;
    const inputs: ArduinoCircuitInputEvent[] = [
      { atMicroseconds: 5, componentId: 'uno', property: 'serialRx', value: 'AB' },
    ];
    const doc = circuit([board('uno', source)]);
    const pending = through(doc, 10, undefined, inputs, 1);
    expect(runtime(pending).serial?.rx?.map((entry) => entry.byte)).toEqual([65, 66]);

    const resumed = through(doc, 40, JSON.parse(JSON.stringify(pending.state)), inputs, 1);
    const whole = through(doc, 40, undefined, inputs, 256);
    expect(resumed.state).toEqual(whole.state);
    expect(resumed.result).toEqual(whole.result);
    expect(runtime(resumed).variables).toMatchObject({ first: 65, remaining: 1 });
    expect(runtime(resumed).serial).toEqual(runtime(whole).serial);
  });

  it('keeps Serial TX state isolated per Arduino board', () => {
    const done = through(
      circuit([
        board('a', 'void setup(){Serial.begin(9600);Serial.println(11);}void loop(){delay(100);}'),
        board(
          'b',
          'void setup(){Serial.begin(115200);Serial.println(22);}void loop(){delay(100);}',
        ),
      ]),
      10,
    );

    expect(done.executionStatus, JSON.stringify(done.diagnostics)).toBe('ready');
    expect(runtime(done, 'a').serial).toMatchObject({ baudRate: 9600, nextTxSequence: 1 });
    expect(runtime(done, 'a').serial?.tx.map((entry) => entry.text)).toEqual(['11\n']);
    expect(runtime(done, 'b').serial).toMatchObject({ baudRate: 115200, nextTxSequence: 1 });
    expect(runtime(done, 'b').serial?.tx.map((entry) => entry.text)).toEqual(['22\n']);
  });

  it('keeps unsupported member calls board-local with no previous loaded program', () => {
    const result = through(
      circuit([board('uno', 'void setup(){servo.write(90);}void loop(){}')]),
      10,
    );
    const boardState = result.state!.boards.find((entry) => entry.componentId === 'uno')!;

    expect(result.executionStatus, JSON.stringify(result.diagnostics)).toBe('ready');
    expect(result.result).not.toBeNull();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'member-call', componentId: 'uno' }),
    );
    expect(boardState.loadedSource).toBeNull();
    expect(runtime(result).faults).toEqual([]);
    expect(runtime(result).eventQueue).toEqual([]);
    expect(runtime(result).pinModes).toEqual({});
    expect(runtime(result).outputVoltages).toEqual({});
    expect(result.events.filter((event) => event.componentId === 'uno')).toEqual([]);
  });

  it('keeps last-good runtime running when editor source becomes unsupported', () => {
    const sourceA =
      'int count=0;void setup(){pinMode(13,OUTPUT);}void loop(){count++;digitalWrite(13,count%2);}';
    const unsupportedU = 'void setup(){servo.write(90);}void loop(){}';
    const loadedA = through(circuit([board('uno', sourceA)]), 10);
    const countAtA = runtime(loadedA).variables.count ?? 0;

    const continued = through(
      circuit([board('uno', unsupportedU)]),
      20,
      JSON.parse(JSON.stringify(loadedA.state)),
    );
    const boardState = continued.state!.boards.find((entry) => entry.componentId === 'uno')!;

    expect(continued.executionStatus, JSON.stringify(continued.diagnostics)).toBe('ready');
    expect(continued.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'member-call', componentId: 'uno' }),
    );
    expect(boardState.loadedSource).toBe(sourceA);
    expect(runtime(continued).variables.count).toBeGreaterThan(countAtA);
    expect(continued.events.some((event) => event.componentId === 'uno')).toBe(true);
  });

  it('keeps a valid peer running when another board uses an unsupported member call', () => {
    const doc = circuit([
      board(
        'a-valid',
        'void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}void loop(){delay(100);}',
      ),
      board('b-unsupported', 'void setup(){servo.write(90);}void loop(){}'),
    ]);
    const done = through(doc, 10);

    expect(done.executionStatus, JSON.stringify(done.diagnostics)).toBe('ready');
    expect(done.result).not.toBeNull();
    expect(done.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'member-call', componentId: 'b-unsupported' }),
    );
    expect(runtime(done, 'a-valid').outputVoltages.d13).toBe(5);
    expect(
      done.state!.boards.find((entry) => entry.componentId === 'b-unsupported')!.loadedSource,
    ).toBeNull();
    expect(done.events.some((event) => event.componentId === 'a-valid')).toBe(true);
    expect(done.events.some((event) => event.componentId === 'b-unsupported')).toBe(false);
  });

  it.each([
    ['unsupported-call', 'void setup(){random();}void loop(){}'],
    ['unsupported-syntax', 'void setup(){int x=1;switch(x){case 1:break;}}void loop(){}'],
    ['preprocessor', '#include <Unknown.h>\nvoid setup(){}\nvoid loop(){}'],
  ])('keeps known unsupported %s board-local without last-good', (code, source) => {
    const result = through(circuit([board('uno', source)]), 10);
    const boardState = result.state!.boards.find((entry) => entry.componentId === 'uno')!;

    expect(result.executionStatus, JSON.stringify(result.diagnostics)).toBe('ready');
    expect(result.result).not.toBeNull();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code, componentId: 'uno' }),
    );
    expect(boardState.loadedSource).toBeNull();
    expect(runtime(result).faults).toEqual([]);
    expect(runtime(result).eventQueue).toEqual([]);
    expect(runtime(result).pinModes).toEqual({});
    expect(runtime(result).outputVoltages).toEqual({});
    expect(result.events.filter((event) => event.componentId === 'uno')).toEqual([]);
  });

  it.each([
    ['unsupported-call', 'void setup(){random();}void loop(){}'],
    ['unsupported-syntax', 'void setup(){int x=1;switch(x){case 1:break;}}void loop(){}'],
    ['preprocessor', '#include <Unknown.h>\nvoid setup(){}\nvoid loop(){}'],
  ])('keeps last-good runtime through known unsupported %s editor source', (code, source) => {
    const sourceA =
      'int count=0;void setup(){pinMode(13,OUTPUT);}void loop(){count++;digitalWrite(13,count%2);}';
    const loadedA = through(circuit([board('uno', sourceA)]), 10);
    const countAtA = runtime(loadedA).variables.count ?? 0;

    const continued = through(
      circuit([board('uno', source)]),
      20,
      JSON.parse(JSON.stringify(loadedA.state)),
    );
    const boardState = continued.state!.boards.find((entry) => entry.componentId === 'uno')!;

    expect(continued.executionStatus, JSON.stringify(continued.diagnostics)).toBe('ready');
    expect(continued.diagnostics).toContainEqual(
      expect.objectContaining({ code, componentId: 'uno' }),
    );
    expect(boardState.loadedSource).toBe(sourceA);
    expect(runtime(continued).variables.count).toBeGreaterThan(countAtA);
    expect(continued.events.some((event) => event.componentId === 'uno')).toBe(true);
  });

  it('keeps a valid peer running beside a known unsupported-call board', () => {
    const done = through(
      circuit([
        board(
          'a-valid',
          'void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}void loop(){delay(100);}',
        ),
        board('b-unsupported', 'void setup(){random();}void loop(){}'),
      ]),
      10,
    );

    expect(done.executionStatus, JSON.stringify(done.diagnostics)).toBe('ready');
    expect(done.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unsupported-call', componentId: 'b-unsupported' }),
    );
    expect(runtime(done, 'a-valid').outputVoltages.d13).toBe(5);
    expect(done.events.some((event) => event.componentId === 'a-valid')).toBe(true);
    expect(done.events.some((event) => event.componentId === 'b-unsupported')).toBe(false);
  });

  it('drives peer pulseIn from canonical 1000 Hz tone independent of component order', () => {
    const sender = board('sender', 'void setup(){tone(13,1000);}void loop(){delay(100);}');
    const receiver = board(
      'receiver',
      'unsigned long duration=0;void setup(){pinMode(2,INPUT);duration=pulseIn(2,HIGH,5000);}void loop(){delay(100);}',
    );
    const wires: [string, string, string, string][] = [
      ['sender', 'd13', 'receiver', 'd2'],
      ['sender', 'power-gnd-1', 'receiver', 'power-gnd-1'],
    ];
    const forward = through(circuit([sender, receiver], wires), 4000, undefined, undefined, 1);
    const reversed = through(
      circuit([receiver, sender], [...wires].reverse()),
      4000,
      undefined,
      undefined,
      256,
    );

    const tone = runtime(forward, 'sender').tones.d13;
    expect(tone && isArduinoTimedWaveformState(tone)).toBe(true);
    if (!tone || !isArduinoTimedWaveformState(tone)) return;
    const highWidth =
      arduinoWaveformEdgeMicroseconds(tone, 1) - arduinoWaveformEdgeMicroseconds(tone, 0);
    expect(highWidth).toBe(500);
    expect(runtime(forward, 'receiver').variables.duration).toBe(highWidth);
    expect(runtime(reversed, 'receiver').variables.duration).toBe(highWidth);
    expect(runtime(reversed, 'sender')).toEqual(runtime(forward, 'sender'));
    expect(runtime(reversed, 'receiver')).toEqual(runtime(forward, 'receiver'));
    expect(reversed.result).toEqual(forward.result);
  });

  it('stops a duration-limited tone at its exact canonical end timestamp', () => {
    const done = through(
      circuit([board('uno', 'void setup(){tone(13,1000,2);delay(10);}void loop(){delay(100);}')]),
      5000,
      undefined,
      undefined,
      1,
    );
    const start = done.events.find((event) => event.kind === 'tone-start')!;
    const stop = done.events.find((event) => event.kind === 'tone-stop')!;
    expect(stop.atMicroseconds - start.atMicroseconds).toBe(2000);
    expect(runtime(done).tones.d13).toBeUndefined();
    expect(
      done.result?.components.find((entry) => entry.componentId === 'uno')?.terminalVoltages.d13,
    ).toBeCloseTo(0, 8);
  });

  it('noTone stops immediately instead of waiting for a natural waveform edge', () => {
    const done = through(
      circuit([
        board(
          'uno',
          'void setup(){tone(13,1000);delayMicroseconds(750);noTone(13);delay(10);}void loop(){delay(100);}',
        ),
      ]),
      3000,
    );
    const start = done.events.find((event) => event.kind === 'tone-start')!;
    const stop = done.events.find((event) => event.kind === 'tone-stop')!;
    const delta = stop.atMicroseconds - start.atMicroseconds;
    expect(delta).toBeGreaterThan(500);
    expect(delta).toBeLessThan(1000);
    expect(delta).not.toBe(500);
    expect(runtime(done).tones.d13).toBeUndefined();
    expect(
      done.result?.components.find((entry) => entry.componentId === 'uno')?.terminalVoltages.d13,
    ).toBeCloseTo(0, 8);
  });

  it('keeps active tones deterministic across JSON continuation, work quantum and boards', () => {
    const doc = circuit([
      board('a', 'void setup(){tone(13,1000);}void loop(){delay(100);}'),
      board('b', 'void setup(){tone(13,440);}void loop(){delay(100);}'),
    ]);
    const small = through(doc, 5000, undefined, undefined, 1);
    const large = through(doc, 5000, undefined, undefined, 256);
    expect(small.state).toEqual(large.state);
    expect(small.result).toEqual(large.result);
    expect(runtime(small, 'a').tones.d13?.frequencyHz).toBe(1000);
    expect(runtime(small, 'b').tones.d13?.frequencyHz).toBe(440);

    const mid = through(doc, 2500, undefined, undefined, 3);
    const resumed = through(doc, 5000, JSON.parse(JSON.stringify(mid.state)), undefined, 3);
    expect(resumed.state).toEqual(large.state);
    expect(resumed.result).toEqual(large.result);
  });

  it.each([
    [0, 544],
    [90, 1472],
    [180, 2400],
  ])('drives servo-motor through real 50 Hz electrical pulses for %i degrees', (angle, pulse) => {
    const done = through(servoCircuit(angle), 5000, undefined, undefined, 1);
    expect(done.executionStatus, JSON.stringify(done.diagnostics)).toBe('ready');
    expect(runtime(done).variables.readback).toBe(angle);
    expect(runtime(done).servo?.objects.motor).toMatchObject({
      attached: true,
      pin: 'd9',
      commandedAngle: angle,
      pulseWidthMicroseconds: pulse,
    });
    expect(runtime(done).servo?.objects.motor?.waveform).toMatchObject({
      frequencyHz: 50,
      dutyNumerator: pulse,
      dutyDenominator: 20_000,
    });
    expect(servoRuntime(done)).toMatchObject({
      powered: true,
      lastValidPulseWidthMicroseconds: pulse,
    });
    expect(servoRuntime(done).angleDegrees).toBeCloseTo(angle, 8);
    expect(
      done.result?.components.find((entry) => entry.componentId === 'servo')?.servoAngleDegrees,
    ).toBeCloseTo(angle, 8);
  });

  it('uses 1500 us immediately after attach before the first write', () => {
    const source =
      '#include <Servo.h>\nServo motor;void setup(){motor.attach(9);}void loop(){delay(100);}';
    const doc = circuit(
      [board('uno', source), servoMotor('servo')],
      [
        ['uno', 'power-5v', 'servo', 'vcc'],
        ['uno', 'power-gnd-1', 'servo', 'gnd'],
        ['uno', 'd9', 'servo', 'signal'],
      ],
    );
    const done = through(doc, 2500, undefined, undefined, 1);
    expect(runtime(done).servo?.objects.motor?.pulseWidthMicroseconds).toBe(1500);
    expect(servoRuntime(done).lastValidPulseWidthMicroseconds).toBe(1500);
  });

  it('ignores signal pulses while servo-motor is unpowered without faulting the lab', () => {
    const done = through(servoCircuit(180, false), 5000, undefined, undefined, 1);
    expect(done.executionStatus, JSON.stringify(done.diagnostics)).toBe('ready');
    expect(servoRuntime(done).powered).toBe(false);
    expect(servoRuntime(done).lastValidPulseWidthMicroseconds).toBeUndefined();
    expect(servoRuntime(done).angleDegrees).toBe(90);
  });

  it('preserves Servo state through JSON continuation and scheduler yield partitioning', () => {
    const doc = servoCircuit(180);
    const mid = through(doc, 1000, undefined, undefined, 1);
    expect(servoRuntime(mid).signalHigh).toBe(true);
    const resumed = through(doc, 5000, JSON.parse(JSON.stringify(mid.state)), undefined, 1);
    const whole = through(doc, 5000, undefined, undefined, 256);
    expect(runtime(resumed)).toEqual(runtime(whole));
    expect(servoRuntime(resumed)).toEqual(servoRuntime(whole));
    expect(
      resumed.result?.components.find((entry) => entry.componentId === 'servo')?.servoAngleDegrees,
    ).toEqual(
      whole.result?.components.find((entry) => entry.componentId === 'servo')?.servoAngleDegrees,
    );
  });

  it('keeps Servo result invariant under component and wire order reversal', () => {
    const forward = through(servoCircuit(30, true, false), 5000, undefined, undefined, 1);
    const reversed = through(servoCircuit(30, true, true), 5000, undefined, undefined, 256);
    expect(runtime(reversed)).toEqual(runtime(forward));
    expect(servoRuntime(reversed)).toEqual(servoRuntime(forward));
    expect(
      reversed.result?.components.find((entry) => entry.componentId === 'servo')?.servoAngleDegrees,
    ).toEqual(
      forward.result?.components.find((entry) => entry.componentId === 'servo')?.servoAngleDegrees,
    );
  });

  it('continues the last-good Servo program when editor source becomes unsupported', () => {
    const validDocument = servoCircuit(90);
    const loaded = through(validDocument, 5000, undefined, undefined, 1);
    const validSource = String(
      validDocument.components.find((component) => component.id === 'uno')!.stateProperties
        ?.arduinoSource,
    );
    const invalidDocument: ElectronicsDocument = {
      ...validDocument,
      components: validDocument.components.map((component) =>
        component.id === 'uno'
          ? {
              ...component,
              stateProperties: {
                ...component.stateProperties,
                arduinoSource: '#include <Unknown.h>\nvoid setup(){}\nvoid loop(){}',
              },
            }
          : component,
      ),
    };
    const continued = through(
      invalidDocument,
      25_000,
      JSON.parse(JSON.stringify(loaded.state)),
      undefined,
      1,
    );
    expect(continued.executionStatus, JSON.stringify(continued.diagnostics)).toBe('ready');
    expect(continued.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'preprocessor', componentId: 'uno' }),
    );
    expect(continued.state?.boards.find((entry) => entry.componentId === 'uno')?.loadedSource).toBe(
      validSource,
    );
    expect(runtime(continued).servo?.objects.motor?.commandedAngle).toBe(90);
    expect(servoRuntime(continued).angleDegrees).toBeCloseTo(90, 8);
  });

  it('keeps ambiguous unknown calls global in B1D', () => {
    const result = through(circuit([board('uno', 'void setup(){unknown();}void loop(){}')]), 10);

    expect(result.executionStatus).toBe('fault');
    expect(result.diagnostics[0]?.code).toBe('unknown-call');
    expect(result.result).toBeNull();
    expect(result.state).toBeNull();
    expect(result.events).toEqual([]);
  });

  it('fails closed on arithmetic errors', () => {
    const result = through(
      circuit([board('uno', 'void setup(){pinMode(13,OUTPUT);int x=1/0;}void loop(){}')]),
      10,
    );
    expect(result.executionStatus).toBe('fault');
    expect(result.result).toBeNull();
    expect(result.state).toBeNull();
    expect(result.events).toEqual([]);
  });

  it('does not silently freeze an unsupported protocol or unknown visual component', () => {
    for (const type of ['signal-generator', 'capacitor', 'piezo-disc', 'unknown-component']) {
      const doc = circuit([
        board('uno', `void setup(){}${idle}`),
        { ...part('physical', 'visual'), componentTypeId: type },
      ]);
      expect(through(doc, 10).diagnostics[0]!.code).toBe('clocked_profile_unsupported');
    }
  });

  it('bounds infinite loops, invalid time, input history capacity and work quanta explicitly', () => {
    const doc = buttonCircuit();
    for (const time of [-1, 0.1, Infinity, NaN, 2 ** 50])
      expect(through(doc, time).executionStatus).toBe('fault');
    for (const maxClockEvents of [0, 1025, Infinity, NaN])
      expect(
        advanceArduinoCircuitClock(doc, 10, undefined, { maxClockEvents }).executionStatus,
      ).toBe('fault');
    const inputs: ArduinoCircuitInputEvent[] = Array.from(
      { length: 1025 },
      (_, atMicroseconds) => ({
        atMicroseconds,
        componentId: 'key',
        property: 'state',
        value: true,
      }),
    );
    expect(through(doc, 10, undefined, inputs).diagnostics[0]!.code).toBe('invalid_input_history');
    const busy = circuit([board('uno', 'void setup(){while(true){}}void loop(){}')]);
    const first = advanceArduinoCircuitClock(busy, 100000, undefined, { maxClockEvents: 8 });
    expect(first.executionStatus).toBe('yielded');
    expect(first.state!.reachedMicroseconds).toBe(7);
    expect(first.result).toBeNull();
    expect(
      advanceArduinoCircuitClock(busy, 100000, first.state!, { maxClockEvents: 8 }).state!
        .reachedMicroseconds,
    ).toBe(15);
  });
});
