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
import { analyseCircuit } from '../domain/simulation.js';

function board(id: string, source: string): SchematicComponent {
  return {
    id,
    kind: 'visual',
    value: 5,
    position: { x: 0, y: 0 },
    componentTypeId: 'arduino-uno',
    pinIds: ['d2', 'd3', 'd8', 'd13', 'a0', 'power-5v', 'power-3v3', 'power-gnd-1'],
    stateProperties: { arduinoSource: source },
  };
}
function part(id: string, kind: SchematicComponent['kind'], value = 1000): SchematicComponent {
  return { id, kind, value, position: { x: 0, y: 0 } };
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

  it.each([
    'void setup(){pinMode(13,OUTPUT);int x=1/0;}void loop(){}',
    'void setup(){tone(13,440);}void loop(){}',
    'void setup(){unknown();}void loop(){}',
  ])('fails closed on errors or unscheduled peripherals: %s', (source) => {
    const result = through(circuit([board('uno', source)]), 10);
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
