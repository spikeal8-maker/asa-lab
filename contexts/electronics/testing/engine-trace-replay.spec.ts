import { describe, expect, it } from 'vitest';
import {
  advanceElectronicsToHorizon,
  parseElectronicsEngineDocument,
  resetElectronicsTimedState,
  type ElectronicsEngineDocument,
  type ElectronicsTimedAdvanceResult,
  type ElectronicsTimedInputEvent,
  type ElectronicsTimedState,
} from '../engine';

type ReadyResult = Extract<ElectronicsTimedAdvanceResult, { executionStatus: 'ready' }>;

interface ReplayFixture {
  readonly name: string;
  readonly document: ElectronicsEngineDocument;
  readonly horizon: number;
  readonly trace: readonly ElectronicsTimedInputEvent[];
}

interface ReplayResult {
  readonly final: ReadyResult;
  readonly yieldSequence: readonly number[];
}

function parseDocument(value: unknown): ElectronicsEngineDocument {
  const parsed = parseElectronicsEngineDocument(value);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

function source(id: string, value = 5) {
  return {
    id,
    kind: 'source' as const,
    value,
    position: { x: 0, y: 0 },
  };
}

function resistor(id: string, value = 1000) {
  return {
    id,
    kind: 'resistor' as const,
    value,
    position: { x: 100, y: 0 },
  };
}

function board(sourceCode: string) {
  return {
    id: 'uno',
    kind: 'visual' as const,
    value: 5,
    position: { x: 0, y: 0 },
    componentTypeId: 'arduino-uno',
    pinIds: ['d2', 'd3', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
    stateProperties: { arduinoSource: sourceCode },
  };
}

function button(id: string) {
  return {
    id,
    kind: 'button' as const,
    value: 1,
    position: { x: 60, y: 0 },
    state: false,
  };
}

function pirSensor() {
  return {
    id: 'pir',
    kind: 'visual' as const,
    value: 0,
    position: { x: 60, y: 0 },
    componentTypeId: 'pir-sensor',
    variantId: 'pir-sensor',
    pinIds: ['vcc', 'signal', 'gnd'],
    stateProperties: { motionDetected: false },
  };
}

function physicalFixture(): ReplayFixture {
  return {
    name: 'physical-rc',
    horizon: 160_000,
    trace: [],
    document: parseDocument({
      schemaVersion: 4,
      components: [
        source('source'),
        resistor('r1'),
        {
          id: 'c1',
          kind: 'visual',
          value: 100,
          position: { x: 200, y: 0 },
          componentTypeId: 'electrolytic-capacitor',
          pinIds: ['negative', 'positive'],
          stateProperties: { initialVoltageVolt: 0, voltageRatingVolt: 25 },
        },
      ],
      connections: [
        {
          id: 'w1',
          from: { componentId: 'source', terminal: 'a' },
          to: { componentId: 'r1', terminal: 'a' },
        },
        {
          id: 'w2',
          from: { componentId: 'r1', terminal: 'b' },
          to: { componentId: 'c1', terminal: 'positive' },
        },
        {
          id: 'w3',
          from: { componentId: 'c1', terminal: 'negative' },
          to: { componentId: 'source', terminal: 'b' },
        },
      ],
    }),
  };
}

function arduinoFixture(): ReplayFixture {
  return {
    name: 'arduino-gpio',
    horizon: 160_000,
    trace: [],
    document: parseDocument({
      schemaVersion: 4,
      components: [
        board(
          'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(20);digitalWrite(13,LOW);delay(20);}',
        ),
        resistor('load'),
      ],
      connections: [
        {
          id: 'w1',
          from: { componentId: 'uno', terminal: 'd13' },
          to: { componentId: 'load', terminal: 'a' },
        },
        {
          id: 'w2',
          from: { componentId: 'load', terminal: 'b' },
          to: { componentId: 'uno', terminal: 'power-gnd-1' },
        },
      ],
    }),
  };
}

const CANONICAL_TRACE: readonly ElectronicsTimedInputEvent[] = Object.freeze([
  Object.freeze({
    atMicroseconds: 50_000,
    targetId: 'two',
    operation: 'state',
    payload: true,
  }),
  Object.freeze({
    atMicroseconds: 50_000,
    targetId: 'one',
    operation: 'state',
    payload: true,
  }),
  Object.freeze({
    atMicroseconds: 125_000,
    targetId: 'one',
    operation: 'state',
    payload: false,
  }),
]);

function inputTraceFixture(): ReplayFixture {
  return {
    name: 'canonical-input-trace',
    horizon: 160_000,
    trace: CANONICAL_TRACE,
    document: parseDocument({
      schemaVersion: 4,
      components: [
        board(
          'int left=1;int right=1;void setup(){pinMode(2,INPUT_PULLUP);pinMode(3,INPUT_PULLUP);pinMode(13,OUTPUT);}void loop(){left=digitalRead(2);right=digitalRead(3);if(left==right){digitalWrite(13,HIGH);}else{digitalWrite(13,LOW);}delay(20);}',
        ),
        button('one'),
        button('two'),
        resistor('load'),
      ],
      connections: [
        {
          id: 'b1',
          from: { componentId: 'uno', terminal: 'd2' },
          to: { componentId: 'one', terminal: 'a' },
        },
        {
          id: 'b2',
          from: { componentId: 'one', terminal: 'b' },
          to: { componentId: 'uno', terminal: 'power-gnd-1' },
        },
        {
          id: 'b3',
          from: { componentId: 'uno', terminal: 'd3' },
          to: { componentId: 'two', terminal: 'a' },
        },
        {
          id: 'b4',
          from: { componentId: 'two', terminal: 'b' },
          to: { componentId: 'uno', terminal: 'power-gnd-1' },
        },
        {
          id: 'out1',
          from: { componentId: 'uno', terminal: 'd13' },
          to: { componentId: 'load', terminal: 'a' },
        },
        {
          id: 'out2',
          from: { componentId: 'load', terminal: 'b' },
          to: { componentId: 'uno', terminal: 'power-gnd-1' },
        },
      ],
    }),
  };
}

function pirMotionFixture(): ReplayFixture {
  return {
    name: 'pir-motion',
    horizon: 60_000,
    trace: [
      { atMicroseconds: 15_000, targetId: 'pir', operation: 'motionDetected', payload: true },
      { atMicroseconds: 45_000, targetId: 'pir', operation: 'motionDetected', payload: false },
    ],
    document: parseDocument({
      schemaVersion: 4,
      components: [
        board(
          'int motion=0;void setup(){pinMode(2,INPUT);}void loop(){motion=digitalRead(2);delay(10);}',
        ),
        pirSensor(),
      ],
      connections: [
        {
          id: 'vcc',
          from: { componentId: 'uno', terminal: 'power-5v' },
          to: { componentId: 'pir', terminal: 'vcc' },
        },
        {
          id: 'gnd',
          from: { componentId: 'uno', terminal: 'power-gnd-1' },
          to: { componentId: 'pir', terminal: 'gnd' },
        },
        {
          id: 'signal',
          from: { componentId: 'pir', terminal: 'signal' },
          to: { componentId: 'uno', terminal: 'd2' },
        },
      ],
    }),
  };
}

const FIXTURES = [
  physicalFixture(),
  arduinoFixture(),
  inputTraceFixture(),
  pirMotionFixture(),
] as const;

function steppedTargets(
  horizon: number,
  step: number,
  trace: readonly ElectronicsTimedInputEvent[],
) {
  const targets: number[] = [];
  for (let value = step; value < horizon; value += step) targets.push(value);
  return [...new Set([...targets, ...trace.map((event) => event.atMicroseconds), horizon])]
    .filter((value) => value > 0 && value <= horizon)
    .sort((left, right) => left - right);
}

function profileTargets(fixture: ReplayFixture) {
  const { horizon, trace } = fixture;
  const withTrace = (values: readonly number[]) =>
    [...new Set([...values, ...trace.map((event) => event.atMicroseconds), horizon])]
      .filter((value) => value > 0 && value <= horizon)
      .sort((left, right) => left - right);
  return {
    'single-shot': [horizon],
    '16ms-partition': steppedTargets(horizon, 16_000, trace),
    '33ms-partition': steppedTargets(horizon, 33_000, trace),
    '100ms-partition': steppedTargets(horizon, 100_000, trace),
    'irregular-stalled': withTrace([7_000, 23_000, 91_000, 145_000]),
  } as const;
}

function replay(
  fixture: ReplayFixture,
  targets: readonly number[],
  maxEvents: number | undefined,
): ReplayResult {
  let state: ElectronicsTimedState = resetElectronicsTimedState();
  let sent = 0;
  let final: ReadyResult | undefined;
  const yieldSequence: number[] = [];

  for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
    const target = targets[targetIndex]!;
    const newlyAccepted: ElectronicsTimedInputEvent[] = [];
    if (targets.length === 1 && targetIndex === 0) {
      newlyAccepted.push(...fixture.trace);
      sent = fixture.trace.length;
    } else {
      while (sent < fixture.trace.length && fixture.trace[sent]!.atMicroseconds <= target) {
        newlyAccepted.push(fixture.trace[sent]!);
        sent++;
      }
    }
    const nextUnsent = fixture.trace[sent];
    if (nextUnsent && nextUnsent.atMicroseconds < target) {
      throw new Error(`profile committed past unsent input at ${nextUnsent.atMicroseconds}`);
    }

    let result = advanceElectronicsToHorizon(fixture.document, {
      requestedHorizonMicroseconds: target,
      state,
      ...(newlyAccepted.length > 0 ? { inputEvents: newlyAccepted } : {}),
      ...(maxEvents === undefined ? {} : { maxEvents }),
    });
    for (let resume = 0; result.executionStatus === 'yielded'; resume++) {
      if (resume > 20_000) throw new Error(`yield did not converge for ${fixture.name}`);
      yieldSequence.push(result.committedHorizonMicroseconds);
      state = result.state;
      result = advanceElectronicsToHorizon(fixture.document, {
        requestedHorizonMicroseconds: target,
        state,
        ...(maxEvents === undefined ? {} : { maxEvents }),
      });
    }
    if (result.executionStatus === 'fault') {
      throw new Error(
        `${fixture.name} fault at target ${target}: ${JSON.stringify(result.diagnostics)}`,
      );
    }
    expect(result.committedHorizonMicroseconds).toBe(target);
    state = result.state;
    final = result;
  }

  expect(sent).toBe(fixture.trace.length);
  if (!final) throw new Error(`${fixture.name} produced no ready result`);
  return { final, yieldSequence };
}

function semanticPayload(result: ReadyResult) {
  return {
    executionStatus: result.executionStatus,
    requestedHorizonMicroseconds: result.requestedHorizonMicroseconds,
    committedHorizonMicroseconds: result.committedHorizonMicroseconds,
    state: result.state,
    observation: result.observation,
    diagnostics: result.diagnostics,
  };
}

describe('E-OPT-3E canonical trace/replay equivalence', () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.name}: converges across host request partitions`, () => {
      const profiles = profileTargets(fixture);
      const reference = replay(fixture, profiles['single-shot'], 1024);
      for (const [name, targets] of Object.entries(profiles)) {
        const actual = replay(fixture, targets, 1024);
        expect(semanticPayload(actual.final), `${fixture.name}/${name}`).toEqual(
          semanticPayload(reference.final),
        );
      }
    });

    it(`${fixture.name}: converges across bounded-yield partitions`, () => {
      const targets = profileTargets(fixture)['single-shot'];
      const reference = replay(fixture, targets, 1024);
      for (const budget of [undefined, 1, 2, 7] as const) {
        const actual = replay(fixture, targets, budget);
        expect(
          semanticPayload(actual.final),
          `${fixture.name}/budget-${budget ?? 'default'}`,
        ).toEqual(semanticPayload(reference.final));
      }
    });
  }

  it('physical fixture proves bounded yield and physical continuation equivalence', () => {
    const fixture = physicalFixture();
    const bounded = replay(fixture, [fixture.horizon], 1);
    expect(bounded.yieldSequence.length).toBeGreaterThan(0);
    const continuation = JSON.parse(bounded.final.state.continuation!.serializedState);
    expect(continuation.profile).toBe('rc-inputs-v2');
    expect(continuation.physicalState).toBeDefined();
  });

  it('Arduino fixture retains canonical instruction-us runtime state', () => {
    const fixture = arduinoFixture();
    const done = replay(fixture, [fixture.horizon], 2);
    const continuation = JSON.parse(done.final.state.continuation!.serializedState);
    expect(continuation.boards).toHaveLength(1);
    expect(continuation.boards[0].runtime.clockProfile).toBe('instruction-us-v1');
    expect(continuation.boards[0].runtime.faults).toEqual([]);
  });

  it('input fixture preserves identical same-time order and append-only history', () => {
    const fixture = inputTraceFixture();
    const sameTimeTargets = fixture.trace
      .filter((event) => event.atMicroseconds === 50_000)
      .map((event) => event.targetId);
    expect(sameTimeTargets).toEqual(['two', 'one']);
    expect([...sameTimeTargets].sort()).not.toEqual(sameTimeTargets);

    const done = replay(fixture, profileTargets(fixture)['16ms-partition'], 2);
    const continuation = JSON.parse(done.final.state.continuation!.serializedState);
    expect(continuation.inputs).toEqual([
      { atMicroseconds: 50_000, componentId: 'two', property: 'state', value: true },
      { atMicroseconds: 50_000, componentId: 'one', property: 'state', value: true },
      { atMicroseconds: 125_000, componentId: 'one', property: 'state', value: false },
    ]);
    expect(continuation.nextInputIndex).toBe(3);
    expect(continuation.reachedMicroseconds).toBe(fixture.horizon);
  });
});
