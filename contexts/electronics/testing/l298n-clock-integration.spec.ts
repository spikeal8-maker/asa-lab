import { describe, expect, it } from 'vitest';
import {
  advanceArduinoCircuitClock,
  createArduinoCircuitShaftTestClock,
  type ArduinoCircuitClockAdvance,
  type ArduinoCircuitClockState,
  type ArduinoCircuitShaftBarrier,
} from '../domain/arduino-circuit-scheduler.js';
import {
  parseElectronicsDocument,
  type ElectronicsDocument,
  type SchematicComponent,
  type SchematicConnection,
} from '../domain/document.js';
import { L298N_TERMINALS } from '../domain/models/l298n-dc-model.js';
import { analyseCircuit } from '../domain/simulation.js';

type Loads = 'resistors' | 'motors' | 'external-tt';
type Ready = ArduinoCircuitClockAdvance & {
  readonly state: ArduinoCircuitClockState;
  readonly result: NonNullable<ArduinoCircuitClockAdvance['result']>;
};

const configurePins = [
  'pinMode(2,OUTPUT);',
  'pinMode(3,OUTPUT);',
  'pinMode(4,OUTPUT);',
  'pinMode(5,OUTPUT);',
  'pinMode(7,OUTPUT);',
  'pinMode(8,OUTPUT);',
].join('');
const oppositeDirections = [
  'digitalWrite(2,HIGH);digitalWrite(4,LOW);',
  'digitalWrite(7,LOW);digitalWrite(8,HIGH);',
].join('');

function steadySource(dutyA = 255, dutyB = 255): string {
  return (
    'void setup(){' +
    configurePins +
    oppositeDirections +
    'analogWrite(3,' +
    dutyA +
    ');analogWrite(5,' +
    dutyB +
    ');}' +
    'void loop(){delay(1000);}'
  );
}

function board(id: string, source: string): SchematicComponent {
  return {
    id,
    kind: 'visual',
    value: 5,
    componentTypeId: 'arduino-uno',
    position: { x: 0, y: 0 },
    pinIds: [
      'd13',
      'd2',
      'd3',
      'd4',
      'd5',
      'd7',
      'd8',
      'd9',
      'power-5v',
      'power-3v3',
      'power-gnd-1',
    ],
    stateProperties: { arduinoSource: source },
  };
}

function part(id: string, kind: SchematicComponent['kind'], value: number): SchematicComponent {
  return { id, kind, value, position: { x: 0, y: 0 } };
}

function wire(id: string, from: string, a: string, to: string, b: string): SchematicConnection {
  return {
    id,
    from: { componentId: from, terminal: a },
    to: { componentId: to, terminal: b },
  };
}

function parsed(
  components: readonly SchematicComponent[],
  connections: readonly SchematicConnection[],
) {
  const result = parseElectronicsDocument({
    schemaVersion: 4,
    components,
    connections,
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  });
  if (!result.ok) throw new Error(result.message);
  return result.document;
}

function circuit(loads: Loads, source = steadySource()): ElectronicsDocument {
  const load = (id: string, tt: boolean, real: boolean): SchematicComponent =>
    real
      ? {
          ...part(id, 'visual', 6),
          componentTypeId: tt ? 'gearmotor' : 'dc-motor',
          pinIds: ['positive', 'negative'],
          stateProperties: {
            motorAssemblyProfileId: tt ? 'adafruit-3777-tt-48to1' : 'pololu-1117-130-6v',
          },
        }
      : part(id, 'resistor', id === 'load-a' ? 27 : 39);
  const realA = loads !== 'resistors';
  const realB = loads === 'motors';
  const components: SchematicComponent[] = [
    part('vs', 'source', 6),
    part('logic', 'source', 5),
    {
      ...part('driver', 'visual', 0),
      componentTypeId: 'l298n-motor-driver',
      pinIds: [...L298N_TERMINALS, 'ENA', 'ENB'],
      stateProperties: {
        enaJumperInstalled: false,
        enbJumperInstalled: false,
        regulatorJumperInstalled: false,
      },
    },
    load('load-a', loads === 'external-tt', realA),
    load('load-b', true, realB),
    board('uno', source),
  ];
  const connections: SchematicConnection[] = [
    wire('vs-positive', 'vs', 'a', 'driver', '+12V'),
    wire('vs-ground', 'vs', 'b', 'driver', 'GND'),
    wire('logic-positive', 'logic', 'a', 'driver', '+5V'),
    wire('logic-ground', 'logic', 'b', 'driver', 'GND'),
    wire('uno-ground', 'uno', 'power-gnd-1', 'driver', 'GND'),
    wire('a-positive', 'driver', 'OUT1', 'load-a', realA ? 'positive' : 'a'),
    wire('a-negative', 'driver', 'OUT2', 'load-a', realA ? 'negative' : 'b'),
    wire('b-positive', 'driver', 'OUT3', 'load-b', realB ? 'positive' : 'a'),
    wire('b-negative', 'driver', 'OUT4', 'load-b', realB ? 'negative' : 'b'),
    wire('a-first', 'uno', 'd2', 'driver', 'IN1'),
    wire('a-second', 'uno', 'd4', 'driver', 'IN2'),
    wire('a-enable', 'uno', 'd3', 'driver', 'ENA'),
    wire('b-first', 'uno', 'd7', 'driver', 'IN3'),
    wire('b-second', 'uno', 'd8', 'driver', 'IN4'),
    wire('b-enable', 'uno', 'd5', 'driver', 'ENB'),
  ];
  return parsed(components, connections);
}

function cloneState(state: ArduinoCircuitClockState): ArduinoCircuitClockState {
  return JSON.parse(JSON.stringify(state)) as ArduinoCircuitClockState;
}

function through(
  document: ElectronicsDocument,
  time: number,
  previous?: ArduinoCircuitClockState,
  budget = 256,
): ArduinoCircuitClockAdvance {
  const events: ArduinoCircuitClockAdvance['events'][number][] = [];
  for (let batch = 0; batch < 10_000; batch++) {
    const next = advanceArduinoCircuitClock(document, time, previous, { maxClockEvents: budget });
    events.push(...next.events);
    if (next.executionStatus !== 'yielded') return { ...next, events };
    expect(next.result).toBeNull();
    expect(next.state).not.toBeNull();
    previous = cloneState(next.state!);
  }
  throw new Error('L298N native clock did not reach the bounded test horizon.');
}

function healthy(value: ArduinoCircuitClockAdvance): Ready {
  expect(value.executionStatus, JSON.stringify(value.diagnostics)).toBe('ready');
  expect(value.state).not.toBeNull();
  expect(value.result).not.toBeNull();
  const result = value.result!;
  expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
  expect(result.solved).toBe(true);
  expect(result.quality.finite).toBe(true);
  expect(result.quality.passed, JSON.stringify(result.quality)).toBe(true);
  expect(result.quality.maxKclResidualAmp).toBeLessThanOrEqual(result.quality.kclToleranceAmp);
  expect(result.quality.powerBalanceResidualWatt).toBeLessThanOrEqual(
    result.quality.powerBalanceToleranceWatt,
  );
  return value as Ready;
}

function component(value: Ready, id: string) {
  const found = value.result.components.find((entry) => entry.componentId === id);
  if (!found) throw new Error('Missing solved component: ' + id);
  return found;
}

function pin(value: Ready, terminal: string): number {
  const volts = component(value, 'driver').terminalVoltages;
  const voltage = volts[terminal];
  if (voltage === undefined || volts.GND === undefined)
    throw new Error('Missing L298N voltage: ' + terminal);
  return voltage - volts.GND;
}

function motorState(value: Ready, id: string, committed: boolean) {
  const state = committed ? value.state.physicalState : value.result.transientState;
  const motor = state?.motors?.find((entry) => entry.componentId === id);
  if (!motor) throw new Error('Missing motor history: ' + id);
  return motor;
}

function runtime(value: Ready, id = 'uno') {
  const entry = value.state.boards.find((item) => item.componentId === id);
  if (!entry) throw new Error('Missing native runtime: ' + id);
  return entry.runtime;
}

describe('L298N shared Arduino clock and physical motor integration', () => {
  it.each(['resistors', 'motors'] as const)(
    'takes cold GPIO through setup into loop with %s and checks every returned frame',
    (loads) => {
      const document = circuit(loads);
      const cold = healthy(through(document, 0, undefined, 1));
      expect(component(cold, 'load-a').current).toBeCloseTo(0, 8);
      expect(component(cold, 'load-b').current).toBeCloseTo(0, 8);
      const running = healthy(through(document, 10_000, cloneState(cold.state), 7));
      expect(runtime(running).phase).toBe('loop');
      expect(component(running, 'driver').lit).toBe(true);
      expect(component(running, 'load-a').current).toBeGreaterThan(0);
      expect(component(running, 'load-b').current).toBeLessThan(0);
      expect(pin(running, 'OUT1') - pin(running, 'OUT2')).toBeGreaterThan(0);
      expect(pin(running, 'OUT3') - pin(running, 'OUT4')).toBeLessThan(0);
      if (loads === 'motors') {
        expect(component(running, 'load-a').motorRpm).toBeGreaterThan(0);
        expect(component(running, 'load-b').motorRpm).toBeLessThan(0);
        expect(running.result.transientState?.motors).toHaveLength(2);
      }
    },
  );

  it('switches the two actual enable voltages immediately before, on and after rational PWM fronts', () => {
    const document = circuit('resistors', steadySource(128, 64));
    // Uno educational timer profile: D3 = 490 Hz, D5 = 980 Hz, origin t=0.
    // These are independently calculated integer-us front expectations.
    const cases = [
      { time: 255, a: 5, b: 5 },
      { time: 256, a: 5, b: 0 },
      { time: 257, a: 5, b: 0 },
      { time: 1019, a: 5, b: 0 },
      { time: 1020, a: 5, b: 5 },
      { time: 1021, a: 5, b: 5 },
      { time: 1023, a: 5, b: 5 },
      { time: 1024, a: 0, b: 5 },
      { time: 1025, a: 0, b: 5 },
      { time: 1276, a: 0, b: 5 },
      { time: 1277, a: 0, b: 0 },
      { time: 1278, a: 0, b: 0 },
      { time: 2040, a: 0, b: 0 },
      { time: 2041, a: 5, b: 5 },
      { time: 2042, a: 5, b: 5 },
    ];
    let previous: ArduinoCircuitClockState | undefined;
    for (const expected of cases) {
      const value = healthy(through(document, expected.time, previous, 7));
      expect(pin(value, 'ENA'), String(expected.time)).toBeCloseTo(expected.a, 6);
      expect(pin(value, 'ENB'), String(expected.time)).toBeCloseTo(expected.b, 6);
      expect(component(value, 'load-a').voltageDrop).toBeCloseTo(
        expected.a === 5 ? (6 * 27) / (27 + 2.4) : 0,
        6,
      );
      expect(component(value, 'load-b').voltageDrop).toBeCloseTo(
        expected.b === 5 ? (-6 * 39) / (39 + 2.4) : 0,
        6,
      );
      previous = cloneState(value.state);
    }
  });

  it('keeps both winding currents and shaft speeds continuous at an enable falling edge', () => {
    const document = circuit('motors', steadySource(128, 255));
    const before = healthy(through(document, 1023));
    expect(pin(before, 'ENA')).toBeCloseTo(5, 6);
    const edge = healthy(through(document, 1024, cloneState(before.state)));
    expect(pin(edge, 'ENA')).toBeCloseTo(0, 6);
    expect(edge.state.physicalState?.simulationTimeMs).toBe(1.024);
    // The canonical checkpoint integrates the old level up to the boundary.
    // Its right-hand observation may change voltage, never stored current/speed.
    for (const id of ['load-a', 'load-b']) {
      const left = motorState(edge, id, true);
      const right = motorState(edge, id, false);
      expect(right.currentAmp).toBe(left.currentAmp);
      expect(right.motorAngularVelocityRadPerSecond).toBe(left.motorAngularVelocityRadPerSecond);
      expect(right.motorAngularPhaseRadian).toBe(left.motorAngularPhaseRadian);
      expect(right.failureMode).toBe('none');
    }
    expect(motorState(edge, 'load-a', false).currentAmp).toBeGreaterThan(0);
    expect(component(edge, 'load-a').voltageDrop).toBeLessThan(-6);
    expect(component(edge, 'load-b').voltageDrop).toBeLessThan(0);
    const after = healthy(through(document, 1025, cloneState(edge.state)));
    expect(motorState(after, 'load-a', false).currentAmp).toBeGreaterThan(0);
    expect(motorState(after, 'load-a', false).currentAmp).toBeLessThan(
      motorState(edge, 'load-a', false).currentAmp,
    );
  });

  it.each([1, 7] as const)(
    'preserves canonical state, result and events through JSON partitions with budget %i',
    (budget) => {
      const document = circuit('motors', steadySource(128, 64));
      const whole = healthy(through(document, 25_000, undefined, 1024));
      const events: ArduinoCircuitClockAdvance['events'][number][] = [];
      let previous: ArduinoCircuitClockState | undefined;
      let split: Ready | undefined;
      for (const horizon of [
        0, 1, 11, 99, 255, 256, 257, 1000, 1023, 1024, 1025, 2040, 2041, 4099, 12_345, 25_000,
      ]) {
        split = healthy(through(document, horizon, previous, budget));
        events.push(...split.events);
        previous = cloneState(split.state);
      }
      expect(JSON.stringify(split!.state)).toBe(JSON.stringify(whole.state));
      expect(JSON.stringify(split!.result)).toBe(JSON.stringify(whole.result));
      expect(events).toStrictEqual(whole.events);
    },
  );

  it('changes A through forward, coast, both brake states and reverse while B stays independent', () => {
    const source =
      'void setup(){' +
      configurePins +
      oppositeDirections +
      'digitalWrite(3,HIGH);digitalWrite(5,HIGH);}' +
      'void loop(){' +
      'delay(2);digitalWrite(3,LOW);' +
      'delay(2);digitalWrite(2,LOW);digitalWrite(4,LOW);digitalWrite(3,HIGH);' +
      'delay(2);digitalWrite(2,HIGH);digitalWrite(4,HIGH);' +
      'delay(2);digitalWrite(2,LOW);delay(1000);}';
    const document = circuit('resistors', source);
    const forward = healthy(through(document, 1000));
    const coast = healthy(through(document, 3000, cloneState(forward.state)));
    const low = healthy(through(document, 5000, cloneState(coast.state)));
    const high = healthy(through(document, 7000, cloneState(low.state)));
    const reverse = healthy(through(document, 9000, cloneState(high.state)));
    expect(component(forward, 'load-a').current).toBeGreaterThan(0);
    expect(pin(coast, 'ENA')).toBeCloseTo(0, 6);
    expect(component(coast, 'load-a').current).toBeCloseTo(0, 8);
    expect(pin(low, 'ENA')).toBeCloseTo(5, 6);
    expect(pin(low, 'OUT1')).toBeCloseTo(0, 6);
    expect(pin(low, 'OUT2')).toBeCloseTo(0, 6);
    expect(pin(high, 'OUT1')).toBeCloseTo(6, 6);
    expect(pin(high, 'OUT2')).toBeCloseTo(6, 6);
    expect(component(reverse, 'load-a').current).toBeLessThan(0);
    for (const value of [coast, low, high, reverse]) {
      expect(component(value, 'load-b').current).toBeCloseTo(
        component(forward, 'load-b').current,
        8,
      );
      expect(component(value, 'load-b').voltageDrop).toBeCloseTo(
        component(forward, 'load-b').voltageDrop,
        8,
      );
    }
  });

  it('expires the startup allowance when a control remains INPUT on entry to loop', () => {
    const source = steadySource()
      .replace('pinMode(2,OUTPUT);', '')
      .replace('digitalWrite(2,HIGH);', '');
    const document = circuit('resistors', source);
    const cold = healthy(through(document, 0, undefined, 1));
    const invalid = through(document, 1000, cloneState(cold.state), 7);
    expect(invalid.executionStatus).toBe('fault');
    expect(invalid.result).toBeNull();
    expect(invalid.state).toBeNull();
    expect(invalid.diagnostics.some((entry) => entry.message.includes('L298N'))).toBe(true);
  });

  it('lets a second Uno measure a complete PWM pulse whose edges miss the 1 ms physics grid', () => {
    const base = circuit('resistors', steadySource(255, 64));
    const receiver = board(
      'receiver',
      'unsigned long duration=0;void setup(){pinMode(2,INPUT);' +
        'delayMicroseconds(300);duration=pulseIn(2,HIGH,5000);}' +
        'void loop(){delay(1000);}',
    );
    const document = parsed(
      [...base.components, receiver],
      [
        ...base.connections,
        wire('receiver-signal', 'uno', 'd5', 'receiver', 'd2'),
        wire('receiver-ground', 'driver', 'GND', 'receiver', 'power-gnd-1'),
      ],
    );
    const small = healthy(through(document, 3000, undefined, 1));
    const large = healthy(through(document, 3000, undefined, 1024));
    // D5/64 has the next complete HIGH pulse at 1020..1277 us.
    // Waiting after 300 us avoids measuring the initial program-created partial pulse.
    expect(runtime(small, 'receiver').variables.duration).toBe(257);
    expect(runtime(large, 'receiver').variables.duration).toBe(257);
    expect(small.state).toStrictEqual(large.state);
    expect(small.result).toStrictEqual(large.result);
  });

  it('does not introduce stale analogWrite barriers after Servo owns that enable pin', () => {
    const source =
      '#include <Servo.h>\nServo gate;\nvoid setup(){' +
      configurePins +
      oppositeDirections +
      'analogWrite(3,128);digitalWrite(5,HIGH);gate.attach(3);}' +
      'void loop(){delay(1000);}';
    const value = healthy(through(circuit('motors', source), 2500, undefined, 7));
    expect(runtime(value).servo?.objects.gate).toMatchObject({ attached: true, pin: 'd3' });
    expect(runtime(value).outputVoltages.d3).toBeCloseTo((5 * 128) / 255, 12);
    expect(pin(value, 'ENA')).toBeCloseTo(0, 6);
    // The Servo falling edge is before 2 ms; its next edge is near 20 ms.
    // A stale 490 Hz analogWrite edge would wrongly commit physics at 2041 us.
    expect(value.state.physicalState?.simulationTimeMs).toBe(2);
    expect(value.result.transientState?.simulationTimeMs).toBe(2.5);
  });

  it('holds the old PWM level through the native external TT shaft interval ending at a front', () => {
    const document = circuit('external-tt', steadySource(128, 255));
    const intervals: Extract<ArduinoCircuitShaftBarrier, { kind: 'shaft-interval' }>[] = [];
    const checkpoints: number[] = [];
    const clock = createArduinoCircuitShaftTestClock(
      document,
      1024,
      { inputs: [], maxClockEvents: 7 },
      { componentId: 'load-a', port: 'shaft', onCheckpoint: (time) => checkpoints.push(time) },
    );
    let next = clock.next();
    for (let count = 0; count < 10_000 && !next.done; count++) {
      const barrier = next.value;
      if (barrier.kind === 'working') {
        next = clock.next();
      } else {
        if (barrier.kind === 'shaft-interval') {
          expect(barrier.quality.passed, JSON.stringify(barrier.quality)).toBe(true);
          intervals.push(barrier);
        }
        next = clock.next({
          measuredAtMicroseconds: barrier.toMicroseconds,
          angleRadian: 0,
          angularVelocityRadPerSecond: 0,
        });
      }
    }
    expect(next.done).toBe(true);
    if (!next.done) throw new Error('External TT clock did not reach its bounded front.');
    const result = healthy(next.value);
    const left = intervals.find((entry) => entry.toMicroseconds === 1024);
    expect(left).toBeDefined();
    expect(left!.fromMicroseconds).toBeLessThan(1024);
    expect(left!.windingVoltageVolt).toBeGreaterThan(0);
    expect(left!.winding.state.currentAmp).toBeGreaterThan(0);
    expect(pin(result, 'ENA')).toBeCloseTo(0, 6);
    expect(component(result, 'load-a').voltageDrop).toBeLessThan(-6);
    expect(component(result, 'load-a').current).toBeCloseTo(left!.winding.state.currentAmp, 8);
    expect(checkpoints).toContain(1024);
  });
});

describe('L298N preflight uses the solved physical timestamp', () => {
  it.each([undefined, 0, 1])(
    'keeps motor preflight KCL exact at requested time %s',
    (simulationTimeMs) => {
      const document = circuit('motors', steadySource(128, 192));
      const result = analyseCircuit(
        document,
        simulationTimeMs === undefined ? {} : { simulationTimeMs },
      );
      expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
      expect(result.solved).toBe(true);
      expect(result.transientState?.simulationTimeMs).toBe(1);
      expect(result.quality.passed).toBe(true);
      expect(result.quality.maxKclResidualAmp).toBeLessThan(1e-8);
      expect(result.quality.powerBalanceResidualWatt).toBeLessThanOrEqual(
        result.quality.powerBalanceToleranceWatt,
      );
      const driver = result.components.find((entry) => entry.componentId === 'driver')!;
      expect(driver.terminalVoltages?.['ENA']).toBeCloseTo(5, 8);
      expect(driver.terminalVoltages?.['ENB']).toBeCloseTo(0, 8);
    },
  );
});
