import { describe, expect, it } from 'vitest';
import {
  advanceElectronicsToHorizon,
  createElectronicsAdvanceSession,
  createElectronicsHcSr04QueryTestSession,
  parseElectronicsEngineDocument,
  type ElectronicsEngineDocument,
  type ElectronicsHcSr04EnvironmentSample,
  type ElectronicsHcSr04TestQuery,
  type ElectronicsHcSr04TestResponse,
  type ElectronicsTimedInputEvent,
} from '../engine.js';
import { sha256Hex } from '../domain/simulation-input-digest.js';

const SENSOR = 'sonar';
const INITIAL_DURATION = 777;

function sketch(delay = 4986, highDelay = 8, timeout = 30000) {
  // Instruction barriers add two microseconds around this 8 µs delay. The test
  // checks the actual Uno GPIO edges against independently frozen timestamps.
  return `unsigned long duration=${INITIAL_DURATION};
    void setup() {
      pinMode(13,OUTPUT); pinMode(2,INPUT); digitalWrite(13,LOW);
      delayMicroseconds(${delay}); digitalWrite(13,HIGH);
      delayMicroseconds(${highDelay}); digitalWrite(13,LOW);
      duration=pulseIn(2,HIGH,${timeout});
    }
    void loop() { delay(100); }`;
}

const passiveTriggerSketch = `unsigned long duration=${INITIAL_DURATION};
  void setup() { pinMode(2,INPUT); duration=pulseIn(2,HIGH,30000); }
  void loop() { delay(100); }`;

function circuit({
  source = sketch(),
  externalTrigger = false,
  simultaneousPing = false,
  supply = 'power-5v',
} = {}): ElectronicsEngineDocument {
  const components = [
    {
      id: 'uno',
      kind: 'visual',
      value: 5,
      position: { x: 0, y: 0 },
      componentTypeId: 'arduino-uno',
      pinIds: ['d2', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
      stateProperties: { arduinoSource: source },
    },
    {
      id: SENSOR,
      kind: 'visual',
      value: 0,
      position: { x: 80, y: 0 },
      componentTypeId: 'ultrasonic-hc-sr04',
      variantId: 'ultrasonic-hc-sr04',
      pinIds: ['vcc', 'trigger', 'echo', 'gnd'],
      stateProperties: { distanceMeters: 0.5 },
    },
  ];
  const wires = [
    ['uno', supply, SENSOR, 'vcc'],
    ['uno', 'power-gnd-1', SENSOR, 'gnd'],
    [SENSOR, 'echo', 'uno', 'd2'],
    ...(externalTrigger ? [] : [['uno', 'd13', SENSOR, 'trigger']]),
    ...(simultaneousPing
      ? [
          ['uno', 'power-5v', 'ping', 'vcc'],
          ['uno', 'power-gnd-1', 'ping', 'gnd'],
          ['uno', 'd13', 'ping', 'signal'],
        ]
      : []),
  ];
  function buttonTrigger(id: string, sensor: string, terminal: string) {
    const resistor = `${id}-pulldown`;
    wires.push(
      ['uno', 'power-5v', id, 'a'],
      [id, 'b', sensor, terminal],
      [resistor, 'a', sensor, terminal],
      [resistor, 'b', 'uno', 'power-gnd-1'],
    );
    return [
      { id, kind: 'button', value: 0, state: false, position: { x: 40, y: 40 } },
      { id: resistor, kind: 'resistor', value: 10000, position: { x: 80, y: 40 } },
    ];
  }
  const extra = [
    ...(externalTrigger ? buttonTrigger('key', SENSOR, 'trigger') : []),
    ...(simultaneousPing
      ? [
          {
            id: 'ping',
            kind: 'visual',
            value: 0,
            position: { x: 160, y: 0 },
            componentTypeId: 'ultrasonic-sensor',
            variantId: 'ultrasonic-sensor',
            pinIds: ['gnd', 'vcc', 'signal'],
            stateProperties: { distanceMeters: 0.5 },
          },
        ]
      : []),
  ];
  const parsed = parseElectronicsEngineDocument({
    schemaVersion: 4,
    components: [...components, ...extra],
    connections: wires.map(([from, fromTerminal, to, toTerminal], index) => ({
      id: `wire-${index}`,
      from: { componentId: from, terminal: fromTerminal },
      to: { componentId: to, terminal: toTerminal },
    })),
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

function button(atMicroseconds: number, state: boolean): ElectronicsTimedInputEvent {
  return { atMicroseconds, targetId: 'key', operation: 'state', payload: state };
}

type Session = ReturnType<typeof createElectronicsHcSr04QueryTestSession>;
type Step = NonNullable<ReturnType<Session['step']>>;
type Complete = Extract<Step, { kind: 'complete' }>;

function testSession(
  document = circuit(),
  requestedHorizonMicroseconds = 10_000,
  maxEvents = 1024,
  inputEvents: readonly ElectronicsTimedInputEvent[] = [],
) {
  return createElectronicsHcSr04QueryTestSession(document, {
    componentId: SENSOR,
    runId: 'fixture',
    generation: 1,
    requestedHorizonMicroseconds,
    inputEvents,
    maxEvents,
  });
}

function nextBarrier(session: Session): Exclude<Step, { kind: 'working' | 'paused' }> {
  let lastCommit = 0;
  for (let i = 0; i < 2048; i++) {
    const step = session.step();
    if (!step) throw new Error('The clock closed before reaching a barrier.');
    expect(step.committedHorizonMicroseconds).toBeGreaterThanOrEqual(lastCommit);
    lastCommit = step.committedHorizonMicroseconds;
    if (step.kind === 'query' || step.kind === 'complete' || step.kind === 'fault') return step;
  }
  throw new Error('The clock did not make bounded progress.');
}

function queryAt(session: Session, time: number, phase: ElectronicsHcSr04TestQuery['phase']) {
  const query = nextBarrier(session);
  expect(query).toMatchObject({
    kind: 'query',
    componentId: SENSOR,
    atMicroseconds: time,
    triggerHighSinceMicroseconds: time - 10,
    phase,
    sequence: 1,
  });
  if (query.kind !== 'query') throw new Error('Expected the exact-time HC-SR04 query.');
  expect(query.committedHorizonMicroseconds).toBeLessThan(time);
  expect(query).not.toHaveProperty('observation');
  expect(query).not.toHaveProperty('state');
  expect(query).not.toHaveProperty('events');
  return query;
}

function response(
  query: ElectronicsHcSr04TestQuery,
  sample: ElectronicsHcSr04EnvironmentSample,
): ElectronicsHcSr04TestResponse {
  const { atMicroseconds, componentId, token, sequence, generation, runId } = query;
  return {
    atMicroseconds,
    geometryAtMicroseconds: atMicroseconds,
    componentId,
    token,
    sequence,
    generation,
    runId,
    sample,
  };
}

function completed(session: Session): Complete {
  const result = nextBarrier(session);
  expect(result.kind === 'fault' ? result.diagnostics : result.kind).toBe('complete');
  if (result.kind !== 'complete') throw new Error('Expected a completed HC-SR04 test clock.');
  expect(result.observation.quality.passed).toBe(true);
  expect(result.clockStateDigest).toBe(sha256Hex(JSON.stringify(result.clockState)));
  return result;
}

function echoTimes(result: Complete) {
  const state = result.clockState.hcSr04?.[0]?.runtime;
  return [state?.lastEchoStartMicroseconds, state?.lastEchoEndMicroseconds];
}

function uno(result: Complete) {
  return result.clockState.boards.find((entry) => entry.componentId === 'uno')!.runtime;
}

function trigEdges(result: Complete) {
  return result.events
    .filter((event) => event.kind === 'output-change' && event.terminal === 'd13')
    .map((event) => [event.atMicroseconds, event.voltage]);
}

function analyticalGeometry(contactTime: number) {
  let committedTime = 0;
  return (targetTime: number) => {
    if (targetTime < committedTime) throw new Error('The geometry witness cannot rewind.');
    committedTime = targetTime;
    // Test-only contact is committed before sampling at the contact timestamp.
    return {
      committedTime,
      contactCommitted: committedTime >= contactTime,
      distanceMeters:
        committedTime < contactTime ? 0.25 : committedTime === contactTime ? 0.5 : 0.75,
    };
  };
}

describe('HC-SR04 engine-owned TEST_ONLY query barrier', () => {
  it.each([
    { time: 5000, delay: 4986 },
    { time: 5063, delay: 5049 },
  ])('queries the committed geometry at the actual Uno Trig edge $time µs', ({ time, delay }) => {
    const document = circuit({ source: sketch(delay) });
    const session = testSession(document);
    const query = queryAt(session, time, 'post-gpio');
    const control = analyticalGeometry(time);
    const geometry = [time - 1, time, time + 1].map(control);
    expect(geometry.map((value) => [value.contactCommitted, value.distanceMeters])).toEqual([
      [false, 0.25],
      [true, 0.5],
      [true, 0.75],
    ]);
    const witness = analyticalGeometry(time)(query.atMicroseconds);
    const reply = {
      ...response(query, { kind: 'echo', distanceMeters: witness.distanceMeters }),
      geometryAtMicroseconds: witness.committedTime,
    };
    for (const at of [time - 1, time + 1]) {
      expect(session.respond({ ...reply, geometryAtMicroseconds: at })).toBe(false);
      expect(session.step()).toBe(query);
    }
    expect(session.respond(reply)).toBe(true);
    expect(session.respond(reply)).toBe(false);
    const result = completed(session);
    expect(trigEdges(result).slice(-2)).toEqual([
      [time - 10, 5],
      [time, 0],
    ]);
    const trace = {
      trigHigh: query.triggerHighSinceMicroseconds,
      trigLow: query.atMicroseconds,
      committedBeforeReply: query.committedHorizonMicroseconds,
      querySequence: query.sequence,
      replySequence: reply.sequence,
      witness,
      echo: echoTimes(result),
      measuredPulse: uno(result).variables['duration'],
      finalDigest: result.clockStateDigest,
    };
    expect(trace).toMatchObject({
      trigHigh: time - 10,
      trigLow: time,
      querySequence: 1,
      replySequence: 1,
      witness: { committedTime: time, contactCommitted: true, distanceMeters: 0.5 },
      echo: [time + 200, time + 3100],
      measuredPulse: 2900,
      finalDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(trace.committedBeforeReply).toBeLessThan(trace.trigLow);
    expect(result.committedHorizonMicroseconds).toBe(10_000);
    expect(session.step()).toBeUndefined();
    session.dispose();
  });

  it('observes the pre-MCU input barrier using ordinary same-time event order', () => {
    const document = circuit({ source: passiveTriggerSketch, externalTrigger: true });
    const opened = [button(4990, true), button(5000, true), button(5000, false)];
    const session = testSession(document, 10_000, 7, opened);
    const query = queryAt(session, 5000, 'pre-mcu');
    expect(session.respond(response(query, { kind: 'echo', distanceMeters: 0.5 }))).toBe(true);
    const result = completed(session);
    expect(echoTimes(result)).toEqual([5200, 8100]);
    expect(uno(result).variables['duration']).toBe(2900);
    expect(trigEdges(result)).toEqual([]);
    expect(result.clockState.inputs.map((input) => [input.atMicroseconds, input.value])).toEqual([
      [4990, true],
      [5000, true],
      [5000, false],
    ]);
    const heldHigh = testSession(document, 10_000, 7, [opened[0]!, opened[2]!, opened[1]!]);
    expect(echoTimes(completed(heldHigh))).toEqual([undefined, undefined]);
  });

  it('fails closed when an actual simultaneous PING output masks the pre-MCU Trig fall', () => {
    const document = circuit({
      source: `unsigned long duration=${INITIAL_DURATION};
        void setup() {
          pinMode(13,OUTPUT); pinMode(2,INPUT); digitalWrite(13,LOW);
          delayMicroseconds(4636); digitalWrite(13,HIGH);
          delayMicroseconds(8); digitalWrite(13,LOW); pinMode(13,INPUT);
          duration=pulseIn(2,HIGH,30000);
        }
        void loop() { delay(100); }`,
      externalTrigger: true,
      simultaneousPing: true,
    });
    const inputs = [button(4990, true), button(5000, false)];
    const legacy = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: 5000,
      inputEvents: inputs,
    });
    expect(legacy.executionStatus, JSON.stringify(legacy.diagnostics)).toBe('ready');
    const clock = JSON.parse(legacy.state.continuation!.serializedState);
    expect(clock.pingUltrasonic[0].runtime.lastEchoStartMicroseconds).toBe(5000);
    expect(clock.hcSr04[0].runtime.phase).toBe('trigger-high');
    const session = testSession(document, 5000, 7, inputs);
    const fault = nextBarrier(session);
    expect(fault).toMatchObject({
      kind: 'fault',
      diagnostics: [{ code: 'ambiguous_hc_sr04_query_order' }],
    });
    expect(fault.committedHorizonMicroseconds).toBeLessThan(5000);
    expect(session.step()).toBeUndefined();
  });

  it.each([
    { document: circuit({ source: sketch(4986, 7) }), highAt: 4990, lowAt: 4999 },
    { document: circuit({ supply: 'power-3v3' }), highAt: 4990, lowAt: 5000 },
  ])(
    'does not request geometry for the short or unpowered pulse ($lowAt µs)',
    ({ document, highAt, lowAt }) => {
      const result = completed(testSession(document));
      expect(trigEdges(result).slice(-2)).toEqual([
        [highAt, 5],
        [lowAt, 0],
      ]);
      expect(echoTimes(result)).toEqual([undefined, undefined]);
    },
  );

  it.each([
    { horizon: 35000, deadlineReached: false },
    { horizon: 35001, deadlineReached: true },
  ])(
    'resolves no-echo with the unchanged Uno deadline at horizon $horizon',
    ({ horizon, deadlineReached }) => {
      const session = testSession(circuit(), horizon);
      const query = queryAt(session, 5000, 'post-gpio');
      expect(session.respond(response(query, { kind: 'no-echo' }))).toBe(true);
      const result = completed(session);
      expect(echoTimes(result)).toEqual([undefined, undefined]);
      expect(
        result.observation.components.find((entry) => entry.componentId === SENSOR)
          ?.terminalVoltages.echo,
      ).toBeCloseTo(0, 8);
      expect(uno(result).variables['duration']).toBe(deadlineReached ? 0 : INITIAL_DURATION);
      if (!deadlineReached) expect(uno(result).pulseWait?.deadlineMicroseconds).toBe(35001);
    },
  );

  it.each([
    { timeout: 3098, expected: 0 },
    { timeout: 3099, expected: 2900 },
  ])(
    'preserves the Echo falling edge and pulseIn order at timeout $timeout',
    ({ timeout, expected }) => {
      const session = testSession(circuit({ source: sketch(4986, 8, timeout) }), 8100);
      const query = queryAt(session, 5000, 'post-gpio');
      expect(session.respond(response(query, { kind: 'echo', distanceMeters: 0.5 }))).toBe(true);
      const result = completed(session);
      expect(echoTimes(result)).toEqual([5200, 8100]);
      expect(uno(result).variables['duration']).toBe(expected);
    },
  );

  it('keeps the live query unchanged after malformed, stale, conflicting and paused replies', () => {
    const session = testSession();
    const query = queryAt(session, 5000, 'post-gpio');
    const reply = response(query, { kind: 'echo', distanceMeters: 0.5 });
    for (const invalid of [
      null,
      { ...reply, token: Symbol() },
      { ...reply, atMicroseconds: 5001 },
      { ...reply, componentId: 'other-sensor' },
      { ...reply, generation: 2 },
      { ...reply, runId: 'another-run' },
      { ...reply, sequence: 2 },
      { ...reply, sample: { kind: 'echo', distanceMeters: Number.NaN } },
      { ...reply, sample: { kind: 'echo', distanceMeters: Number.POSITIVE_INFINITY } },
      { ...reply, sample: { kind: 'echo', distanceMeters: 0.01 } },
      { ...reply, sample: { kind: 'echo', distanceMeters: 4.01 } },
      { ...reply, sample: { kind: 'no-echo', distanceMeters: 0.5 } },
      {
        ...reply,
        get sample() {
          throw new Error('untrusted getter');
        },
      },
    ]) {
      expect(session.respond(invalid)).toBe(false);
      expect(session.step()).toBe(query);
    }
    session.pause();
    for (let i = 0; i < 3; i++) {
      expect(session.step()).toEqual({
        kind: 'paused',
        committedHorizonMicroseconds: query.committedHorizonMicroseconds,
      });
      expect(session.respond(reply)).toBe(false);
    }
    session.resume();
    expect(session.step()).toBe(query);
    const mutableSample = { kind: 'echo', distanceMeters: 0.5 };
    expect(session.respond({ ...reply, sample: mutableSample })).toBe(true);
    mutableSample.distanceMeters = 1;
    expect(echoTimes(completed(session))).toEqual([5200, 8100]);
  });

  it('isolates identical labels and invalidates pending and accepted responses on lifecycle changes', () => {
    const first = testSession();
    const second = testSession();
    const a = queryAt(first, 5000, 'post-gpio');
    const b = queryAt(second, 5000, 'post-gpio');
    expect({ ...a, token: null }).toEqual({ ...b, token: null });
    const ar = response(a, { kind: 'echo', distanceMeters: 0.5 });
    const br = response(b, { kind: 'echo', distanceMeters: 0.25 });
    expect(first.respond(br)).toBe(false);
    expect(second.respond(ar)).toBe(false);
    expect(first.respond(ar)).toBe(true);
    first.cancel();
    expect(first.respond(ar)).toBe(false);
    expect(first.step()).toBeUndefined();
    expect(first.reset(1)).toBe(false);
    expect(first.reset(2)).toBe(true);
    const c = queryAt(first, 5000, 'post-gpio');
    expect(c.generation).toBe(2);
    expect(first.respond(ar)).toBe(false);
    expect(first.reset(3)).toBe(true);
    const e = queryAt(first, 5000, 'post-gpio');
    expect(e.generation).toBe(3);
    expect(first.respond(response(c, { kind: 'no-echo' }))).toBe(false);
    first.dispose();
    first.dispose();
    expect(first.step()).toBeUndefined();
    expect(first.reset(4)).toBe(false);
    expect(second.respond(br)).toBe(true);
    expect(echoTimes(completed(second))).toEqual([5200, 6650]);
  });

  it('matches v1 for identical known inputs and yields the same trace across budgets', () => {
    const document = circuit();
    const inputEvents = [
      { atMicroseconds: 5000, targetId: SENSOR, operation: 'distanceMeters', payload: 0.5 },
    ];
    const traces = [1, 7, 1024].map((budget) => {
      const session = testSession(document, 10_000, budget, inputEvents);
      const pending = queryAt(session, 5000, 'post-gpio');
      const query = { ...pending, token: null };
      expect(session.respond(response(pending, { kind: 'echo', distanceMeters: 0.5 }))).toBe(true);
      return { query, result: completed(session) };
    });
    expect(traces[0]).toEqual(traces[1]);
    expect(traces[0]).toEqual(traces[2]);
    const request = { requestedHorizonMicroseconds: 10_000, inputEvents };
    const direct = advanceElectronicsToHorizon(document, request);
    expect(direct.executionStatus).toBe('ready');
    const legacy = createElectronicsAdvanceSession(document, { ...request, maxEvents: 7 });
    let workerStep = legacy.step();
    for (let i = 0; workerStep === null && i < 2048; i++) workerStep = legacy.step();
    legacy.dispose();
    expect(workerStep).toEqual(direct);
    expect(JSON.stringify(traces[0]!.result.clockState)).toBe(
      direct.state.continuation?.serializedState,
    );
    expect(traces[0]!.result.observation).toEqual(direct.observation);
    const retroactive = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: 10001,
      state: direct.state,
      inputEvents: [{ ...inputEvents[0]!, atMicroseconds: 10000 }],
    });
    expect(retroactive.executionStatus).toBe('fault');
    expect(retroactive.committedHorizonMicroseconds).toBe(10000);
    expect(retroactive.state).toEqual(direct.state);
    expect(retroactive.observation).toBeNull();
  });
});
