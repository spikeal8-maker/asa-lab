import { describe, expect, it } from 'vitest';
import {
  advanceElectronicsToHorizon,
  parseElectronicsEngineDocument,
  type ElectronicsEngineDocument,
  type ElectronicsTimedAdvanceResult,
  type ElectronicsTimedInputEvent,
  type ElectronicsTimedState,
} from '../engine';
import type { ArduinoCircuitClockState } from '../domain/arduino-circuit-scheduler';

function parseDocument(value: unknown): ElectronicsEngineDocument {
  const parsed = parseElectronicsEngineDocument(value);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

function board(source: string) {
  return {
    id: 'uno',
    kind: 'visual' as const,
    value: 5,
    position: { x: 0, y: 0 },
    componentTypeId: 'arduino-uno',
    pinIds: ['d2', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
    stateProperties: { arduinoSource: source },
  };
}

function pingDocument(initialDistanceMeters = 0.5): ElectronicsEngineDocument {
  const source = `unsigned long duration=0;void setup(){pinMode(13,OUTPUT);
    digitalWrite(13,LOW);delayMicroseconds(2);digitalWrite(13,HIGH);
    delayMicroseconds(2);digitalWrite(13,LOW);pinMode(13,INPUT);
    duration=pulseIn(13,HIGH,30000);}void loop(){delay(100);}`;
  return parseDocument({
    schemaVersion: 4,
    components: [
      board(source),
      {
        id: 'ping',
        kind: 'visual',
        value: 0,
        position: { x: 80, y: 0 },
        componentTypeId: 'ultrasonic-sensor',
        variantId: 'ultrasonic-sensor',
        pinIds: ['gnd', 'vcc', 'signal'],
        stateProperties: { distanceMeters: initialDistanceMeters },
      },
    ],
    connections: [
      {
        id: 'vcc',
        from: { componentId: 'uno', terminal: 'power-5v' },
        to: { componentId: 'ping', terminal: 'vcc' },
      },
      {
        id: 'gnd',
        from: { componentId: 'uno', terminal: 'power-gnd-1' },
        to: { componentId: 'ping', terminal: 'gnd' },
      },
      {
        id: 'signal',
        from: { componentId: 'uno', terminal: 'd13' },
        to: { componentId: 'ping', terminal: 'signal' },
      },
    ],
  });
}

function hcSr04Document(
  initialDistanceMeters = 0.5,
  options: { readonly source?: string; readonly echoAvailable?: boolean | number | string } = {},
): ElectronicsEngineDocument {
  const source =
    options.source ??
    `unsigned long duration=0;void setup(){pinMode(13,OUTPUT);pinMode(2,INPUT);
    digitalWrite(13,LOW);delayMicroseconds(2);digitalWrite(13,HIGH);
    delayMicroseconds(10);digitalWrite(13,LOW);duration=pulseIn(2,HIGH,30000);}
    void loop(){delay(100);}`;
  return parseDocument({
    schemaVersion: 4,
    components: [
      board(source),
      {
        id: 'sonar',
        kind: 'visual',
        value: 0,
        position: { x: 80, y: 0 },
        componentTypeId: 'ultrasonic-hc-sr04',
        variantId: 'ultrasonic-hc-sr04',
        pinIds: ['vcc', 'trigger', 'echo', 'gnd'],
        stateProperties: {
          distanceMeters: initialDistanceMeters,
          ...(options.echoAvailable === undefined ? {} : { echoAvailable: options.echoAvailable }),
        },
      },
    ],
    connections: [
      {
        id: 'vcc',
        from: { componentId: 'uno', terminal: 'power-5v' },
        to: { componentId: 'sonar', terminal: 'vcc' },
      },
      {
        id: 'gnd',
        from: { componentId: 'uno', terminal: 'power-gnd-1' },
        to: { componentId: 'sonar', terminal: 'gnd' },
      },
      {
        id: 'trigger',
        from: { componentId: 'uno', terminal: 'd13' },
        to: { componentId: 'sonar', terminal: 'trigger' },
      },
      {
        id: 'echo',
        from: { componentId: 'sonar', terminal: 'echo' },
        to: { componentId: 'uno', terminal: 'd2' },
      },
    ],
  });
}

function readyClock(result: ElectronicsTimedAdvanceResult): ArduinoCircuitClockState {
  expect(result.executionStatus, JSON.stringify(result.diagnostics)).toBe('ready');
  if (result.executionStatus !== 'ready') throw new Error('Expected ready timed result.');
  const serialized = result.state.continuation?.serializedState;
  if (!serialized) throw new Error('Expected timed continuation.');
  return JSON.parse(serialized);
}

describe('ultrasonic canonical timed distance input', () => {
  it('applies a PING UI distance event through the canonical timed path before echo scheduling', () => {
    const result = advanceElectronicsToHorizon(pingDocument(), {
      requestedHorizonMicroseconds: 10_000,
      inputEvents: [
        {
          atMicroseconds: 1,
          targetId: 'ping',
          operation: 'distanceMeters',
          payload: 1,
        },
      ],
    });
    const clock = readyClock(result);
    expect(clock.inputs).toContainEqual({
      atMicroseconds: 1,
      componentId: 'ping',
      property: 'distanceMeters',
      value: 1,
    });
    expect(
      clock.boards.find((entry) => entry.componentId === 'uno')!.runtime.variables.duration,
    ).toBe(5800);
  });

  it('applies an HC-SR04 UI distance event through the same canonical timed path', () => {
    const result = advanceElectronicsToHorizon(hcSr04Document(), {
      requestedHorizonMicroseconds: 10_000,
      inputEvents: [
        {
          atMicroseconds: 1,
          targetId: 'sonar',
          operation: 'distanceMeters',
          payload: 1,
        },
      ],
    });
    const clock = readyClock(result);
    expect(clock.inputs).toContainEqual({
      atMicroseconds: 1,
      componentId: 'sonar',
      property: 'distanceMeters',
      value: 1,
    });
    expect(
      clock.boards.find((entry) => entry.componentId === 'uno')!.runtime.variables.duration,
    ).toBe(5800);
  });
});

const twoMeasurements = `unsigned long first=999;unsigned long second=999;
void setup(){pinMode(13,OUTPUT);pinMode(2,INPUT);digitalWrite(13,LOW);delayMicroseconds(2);
digitalWrite(13,HIGH);delayMicroseconds(10);digitalWrite(13,LOW);
first=pulseIn(2,HIGH,30000);delay(20);
digitalWrite(13,HIGH);delayMicroseconds(10);digitalWrite(13,LOW);
second=pulseIn(2,HIGH,30000);}void loop(){delay(100);}`;

function reflectionEvents(
  atMicroseconds: number,
  distanceMeters: number,
): ElectronicsTimedInputEvent[] {
  return [
    { atMicroseconds, targetId: 'sonar', operation: 'distanceMeters', payload: distanceMeters },
    { atMicroseconds, targetId: 'sonar', operation: 'echoAvailable', payload: true },
  ];
}

describe('HC-SR04 canonical no-echo environment input', () => {
  it('keeps the powered Echo low until the actual pulseIn deadline and returns zero there', () => {
    const document = hcSr04Document(0.5, { echoAvailable: false, source: twoMeasurements });
    const waiting = advanceElectronicsToHorizon(document, { requestedHorizonMicroseconds: 1000 });
    const clock = readyClock(waiting);
    const runtime = clock.boards[0]!.runtime;
    expect(runtime.variables.first).toBe(999);
    expect(runtime.pulseWait).toMatchObject({ phase: 'wait-pulse-start' });
    expect(clock.hcSr04![0]!.runtime).toMatchObject({ powered: true, phase: 'idle' });
    expect(clock.hcSr04![0]!.runtime.lastEchoStartMicroseconds).toBeUndefined();
    const deadline = runtime.pulseWait!.deadlineMicroseconds;
    const before = advanceElectronicsToHorizon(document, {
      state: JSON.parse(JSON.stringify(waiting.state)),
      requestedHorizonMicroseconds: deadline - 1,
    });
    expect(readyClock(before).boards[0]!.runtime.variables.first).toBe(999);
    const expired = advanceElectronicsToHorizon(document, {
      state: JSON.parse(JSON.stringify(before.state)),
      requestedHorizonMicroseconds: deadline,
    });
    expect(readyClock(expired).boards[0]!.runtime.variables.first).toBe(0);
    expect(readyClock(expired).boards[0]!.runtime.pulseWait).toBeUndefined();
  });

  it('does not cancel an accepted echo, then times out the next no-echo measurement', () => {
    const result = advanceElectronicsToHorizon(hcSr04Document(0.5, { source: twoMeasurements }), {
      requestedHorizonMicroseconds: 65_000,
      inputEvents: [
        { atMicroseconds: 1000, targetId: 'sonar', operation: 'echoAvailable', payload: false },
      ],
    });
    const clock = readyClock(result);
    expect(clock.boards[0]!.runtime.variables).toMatchObject({ first: 2900, second: 0 });
    const sonar = clock.hcSr04![0]!.runtime;
    expect(sonar.lastEchoEndMicroseconds! - sonar.lastEchoStartMicroseconds!).toBe(2900);
    expect(sonar.phase).toBe('idle');
  });

  it('restores reflection with its distance atomically but never invents a pulse before a new Trig', () => {
    const document = hcSr04Document(0.5, { echoAvailable: false, source: twoMeasurements });
    const restored = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: 10_000,
      inputEvents: reflectionEvents(1000, 1),
    });
    const waiting = readyClock(restored);
    expect(waiting.boards[0]!.runtime.variables.first).toBe(999);
    expect(waiting.hcSr04![0]!.runtime.lastEchoStartMicroseconds).toBeUndefined();
    const completed = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: 65_000,
      state: JSON.parse(JSON.stringify(restored.state)),
    });
    expect(readyClock(completed).boards[0]!.runtime.variables).toMatchObject({
      first: 0,
      second: 5800,
    });
  });

  it('observes a whole environment batch before a same-time falling Trig edge in either order', () => {
    const baseline = readyClock(
      advanceElectronicsToHorizon(hcSr04Document(), { requestedHorizonMicroseconds: 1000 }),
    );
    const fallingTrig = baseline.hcSr04![0]!.runtime.echoStartMicroseconds! - 200;
    expect(fallingTrig).toBeGreaterThan(0);
    const events = reflectionEvents(fallingTrig, 1);
    for (const inputEvents of [events, [...events].reverse()]) {
      const result = advanceElectronicsToHorizon(hcSr04Document(0.5, { echoAvailable: false }), {
        requestedHorizonMicroseconds: 10_000,
        inputEvents,
      });
      expect(readyClock(result).boards[0]!.runtime.variables.duration).toBe(5800);
    }
  });

  it('preserves the complete result across partitions, bounded yields and JSON resumes', () => {
    const document = hcSr04Document(0.5, { echoAvailable: false, source: twoMeasurements });
    const inputEvents = reflectionEvents(40_000, 1);
    const whole = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: 65_000,
      inputEvents,
      maxEvents: 1024,
    });
    expect(readyClock(whole).boards[0]!.runtime.variables).toMatchObject({
      first: 0,
      second: 5800,
    });
    for (const maxEvents of [1, 7, 1024]) {
      let state: ElectronicsTimedState | undefined;
      let partition: ElectronicsTimedAdvanceResult | undefined;
      for (const horizon of [1, 1000, 30_000, 40_000, 50_000, 65_000]) {
        partition = advanceElectronicsToHorizon(document, {
          requestedHorizonMicroseconds: horizon,
          state,
          ...(state ? {} : { inputEvents }),
          maxEvents,
        });
        let resumes = 0;
        while (partition.executionStatus === 'yielded' && resumes++ < 200) {
          expect(partition.observation).toBeNull();
          partition = advanceElectronicsToHorizon(document, {
            requestedHorizonMicroseconds: horizon,
            state: JSON.parse(JSON.stringify(partition.state)),
            maxEvents,
          });
        }
        readyClock(partition);
        state = JSON.parse(JSON.stringify(partition.state));
      }
      expect(partition).toStrictEqual(whole);
    }
  });

  it('rejects malformed flags, wrong targets and invalid distances without partial input admission', () => {
    const document = hcSr04Document(0.5, { echoAvailable: false });
    const initial = advanceElectronicsToHorizon(document, { requestedHorizonMicroseconds: 0 });
    readyClock(initial);
    const invalid: ElectronicsTimedInputEvent[] = [
      ...[0, 1, 'false', null].map((payload) => ({
        atMicroseconds: 1,
        targetId: 'sonar',
        operation: 'echoAvailable',
        payload,
      })),
      { atMicroseconds: 1, targetId: 'uno', operation: 'echoAvailable', payload: false },
      ...[-1, 0.019, 4.001, 6, NaN, Infinity].map((payload) => ({
        atMicroseconds: 1,
        targetId: 'sonar',
        operation: 'distanceMeters',
        payload,
      })),
    ];
    for (const event of invalid) {
      const rejected = advanceElectronicsToHorizon(document, {
        requestedHorizonMicroseconds: 1000,
        state: initial.state,
        inputEvents: [
          { atMicroseconds: 1, targetId: 'sonar', operation: 'echoAvailable', payload: true },
          event,
        ],
      });
      expect(rejected.executionStatus).toBe('fault');
      expect(rejected.observation).toBeNull();
      expect(rejected.state).toStrictEqual(initial.state);
    }
    const ping = advanceElectronicsToHorizon(pingDocument(), {
      requestedHorizonMicroseconds: 1000,
      inputEvents: [
        { atMicroseconds: 1, targetId: 'ping', operation: 'echoAvailable', payload: false },
      ],
    });
    expect(ping.executionStatus).toBe('fault');
    for (const echoAvailable of [0, 'false']) {
      const malformed = advanceElectronicsToHorizon(hcSr04Document(0.5, { echoAvailable }), {
        requestedHorizonMicroseconds: 1000,
      });
      expect(malformed.executionStatus).toBe('fault');
      expect(malformed.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'invalid_hc_sr04_echo_available' }),
      );
    }
    for (const distance of [0.019, 4.001, 6]) {
      const malformed = advanceElectronicsToHorizon(
        hcSr04Document(distance, { echoAvailable: false }),
        {
          requestedHorizonMicroseconds: 1000,
        },
      );
      expect(malformed.executionStatus).toBe('fault');
      expect(malformed.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'invalid_hc_sr04_distance' }),
      );
    }
  });

  it('rejects a retroactive reflection change after a committed horizon', () => {
    const document = hcSr04Document(0.5, { echoAvailable: false });
    const previous = advanceElectronicsToHorizon(document, { requestedHorizonMicroseconds: 1000 });
    readyClock(previous);
    for (const atMicroseconds of [999, 1000]) {
      const rejected = advanceElectronicsToHorizon(document, {
        requestedHorizonMicroseconds: 2000,
        state: JSON.parse(JSON.stringify(previous.state)),
        inputEvents: reflectionEvents(atMicroseconds, 1),
      });
      expect(rejected.executionStatus).toBe('fault');
      expect(rejected.state).toStrictEqual(previous.state);
    }
  });
});
