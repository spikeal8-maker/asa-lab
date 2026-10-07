import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
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

// Temporary #523 passive probe; removed from the report-only candidate.
function diagnosticResources() {
  return {
    memory: process.memoryUsage(),
    resource: process.resourceUsage(),
    linuxStatus: readFileSync('/proc/self/status', 'utf8'),
    linuxSchedstat: readFileSync('/proc/self/schedstat', 'utf8'),
  };
}

function diagnosticProbe() {
  const worker = (
    globalThis as typeof globalThis & {
      __vitest_worker__?: {
        config?: {
          maxWorkers?: number;
          minWorkers?: number;
          pool?: string;
          fileParallelism?: boolean;
          testTimeout?: number;
        };
      };
    }
  ).__vitest_worker__;
  const phases: unknown[] = [];
  const calls: unknown[] = [];
  const initial = diagnosticResources();
  const begin = performance.now();
  const cpuBegin = process.cpuUsage();
  let outcome = 'incomplete';
  let details: unknown;
  const calibrationBegin = performance.now();
  for (let i = 0; i < 20; i++) {
    const wall = performance.now();
    const cpu = process.cpuUsage();
    void (performance.now() - wall);
    process.cpuUsage(cpu);
  }
  const emptyCountersWallMs = performance.now() - calibrationBegin;
  function measure<T>(name: string, operation: () => T): T {
    const wall = performance.now();
    const cpu = process.cpuUsage();
    try {
      return operation();
    } finally {
      const usage = process.cpuUsage(cpu);
      phases.push({
        name,
        wallMs: performance.now() - wall,
        cpuUserUs: usage.user,
        cpuSystemUs: usage.system,
      });
    }
  }
  function advance(
    document: ElectronicsEngineDocument,
    request: Parameters<typeof advanceElectronicsToHorizon>[1],
  ) {
    const wall = performance.now();
    const cpu = process.cpuUsage();
    const result = advanceElectronicsToHorizon(document, request);
    const usage = process.cpuUsage(cpu);
    const wallMs = performance.now() - wall;
    calls.push({
      requested: request.requestedHorizonMicroseconds,
      budget: request.maxEvents,
      previousCommitted: request.state?.continuation?.committedHorizonMicroseconds ?? 0,
      committed: result.committedHorizonMicroseconds,
      status: result.executionStatus,
      continuationChars: result.state.continuation?.serializedState.length ?? 0,
      wallMs,
      cpuUserUs: usage.user,
      cpuSystemUs: usage.system,
    });
    return result;
  }
  return {
    measure,
    advance,
    complete(value: unknown) {
      outcome = 'assertions-completed';
      details = value;
    },
    flush() {
      const usage = process.cpuUsage(cpuBegin);
      const wallMs = performance.now() - begin;
      const final = diagnosticResources();
      writeFileSync(
        process.env.ASA_CONFORMANCE_PROFILE!,
        JSON.stringify(
          {
            schema: 'asa-523-passive-v1',
            stage: process.env.ASA_DIAGNOSTIC_STAGE,
            sha: process.env.GITHUB_SHA,
            pid: process.pid,
            node: process.version,
            workerId: process.env.VITEST_WORKER_ID,
            poolId: process.env.VITEST_POOL_ID,
            observedWorkerConfig: worker?.config && {
              maxWorkers: worker.config.maxWorkers,
              minWorkers: worker.config.minWorkers,
              pool: worker.config.pool,
              fileParallelism: worker.config.fileParallelism,
              testTimeout: worker.config.testTimeout,
            },
            beginEpochMs: performance.timeOrigin + begin,
            endEpochMs: performance.timeOrigin + performance.now(),
            wallMs,
            cpuUserUs: usage.user,
            cpuSystemUs: usage.system,
            initial,
            final,
            phases,
            calls,
            outcome,
            details,
            emptyCountersWallMs,
            limits:
              'CPU aggregates all process threads. No GC pause attribution. Counter calibration is a lower bound; probe bookkeeping and flush are not subtracted. Profile flush follows the measured body but remains within the original test guard.',
          },
          null,
          2,
        ),
      );
    },
  };
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
  probe?: ReturnType<typeof diagnosticProbe>,
): ReplayResult {
  const advance = probe?.advance ?? advanceElectronicsToHorizon;
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

    let result = advance(fixture.document, {
      requestedHorizonMicroseconds: target,
      state,
      ...(newlyAccepted.length > 0 ? { inputEvents: newlyAccepted } : {}),
      ...(maxEvents === undefined ? {} : { maxEvents }),
    });
    for (let resume = 0; result.executionStatus === 'yielded'; resume++) {
      if (resume > 20_000) throw new Error(`yield did not converge for ${fixture.name}`);
      yieldSequence.push(result.committedHorizonMicroseconds);
      state = result.state;
      result = advance(fixture.document, {
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

function electrothermalFixture(load: 'motor' | 'damage' | 'arduino-led'): ReplayFixture {
  const components =
    load === 'damage'
      ? [
          {
            ...source('battery', 3),
            componentTypeId: 'battery-holder-aa-2',
            pinIds: ['BAT-', 'BAT+'],
          },
        ]
      : load === 'motor'
        ? [
            source('supply', 6),
            {
              id: 'motor',
              kind: 'visual',
              value: 6,
              position: { x: 0, y: 0 },
              componentTypeId: 'dc-motor',
              pinIds: ['positive', 'negative'],
            },
          ]
        : [
            board(
              'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(20);digitalWrite(13,LOW);delay(20);}',
            ),
            resistor('load', 330),
            {
              id: 'rgb',
              kind: 'rgb-led',
              value: 2,
              position: { x: 0, y: 0 },
              componentTypeId: 'rgb-led',
              pinIds: ['red', 'green', 'blue', 'common'],
            },
          ];
  const wires =
    load === 'damage'
      ? [['battery', 'BAT+', 'battery', 'BAT-']]
      : load === 'motor'
        ? [
            ['supply', 'a', 'motor', 'positive'],
            ['motor', 'negative', 'supply', 'b'],
          ]
        : [
            ['uno', 'd13', 'load', 'a'],
            ['load', 'b', 'rgb', 'red'],
            ['rgb', 'common', 'uno', 'power-gnd-1'],
          ];
  return {
    name: `observation-${load}`,
    horizon: load === 'damage' ? 2_500_000 : 1_100_000,
    trace: [],
    document: parseDocument({
      schemaVersion: 4,
      components,
      connections: wires.map(([from, a, to, b], index) => ({
        id: `w${index}`,
        from: { componentId: from, terminal: a },
        to: { componentId: to, terminal: b },
      })),
    }),
  };
}

describe('complete observation chunk physical state conformance', () => {
  it('retains future canonical inputs across complete observation requests', () => {
    const base = inputTraceFixture();
    const fixture = {
      ...base,
      horizon: 1_100_000,
      trace: base.trace.map((event, index) =>
        index === 2 ? { ...event, atMicroseconds: 800_000 } : event,
      ),
    };
    const first = advanceElectronicsToHorizon(fixture.document, {
      requestedHorizonMicroseconds: 500_000,
      inputEvents: fixture.trace,
      maxEvents: 1024,
    });
    expect(first.executionStatus).toBe('ready');
    expect(JSON.parse(first.state.continuation!.serializedState)).toMatchObject({
      nextInputIndex: 2,
    });
    const final = advanceElectronicsToHorizon(fixture.document, {
      requestedHorizonMicroseconds: fixture.horizon,
      state: first.state,
      maxEvents: 1024,
    });
    expect(final.executionStatus).toBe('ready');
    if (final.executionStatus !== 'ready') return;
    expect(JSON.stringify(semanticPayload(final))).toBe(
      JSON.stringify(semanticPayload(replay(fixture, [fixture.horizon], 1024).final)),
    );
  });
  for (const fixture of [
    { ...physicalFixture(), horizon: 1_100_000 },
    electrothermalFixture('arduino-led'),
    electrothermalFixture('motor'),
    electrothermalFixture('damage'),
  ]) {
    it(`${fixture.name}: preserves full state and result through bounded complete horizons`, () => {
      const probe =
        fixture.name === 'observation-arduino-led' && process.env.ASA_CONFORMANCE_PROFILE
          ? diagnosticProbe()
          : undefined;
      const measure = probe?.measure ?? (<T>(_name: string, operation: () => T) => operation());
      try {
        const reference = measure('reference-1024', () =>
          replay(fixture, [fixture.horizon], 1024, probe),
        );
        const targets = steppedTargets(fixture.horizon, 500_000, fixture.trace);
        const chunked = measure('chunked-256', () => replay(fixture, [0, ...targets], 256, probe));
        const chunkedJson = measure('serialize-chunked', () =>
          JSON.stringify(semanticPayload(chunked.final)),
        );
        const referenceJson = measure('serialize-reference', () =>
          JSON.stringify(semanticPayload(reference.final)),
        );
        measure('complete-semantic-equality', () => expect(chunkedJson).toBe(referenceJson));
        measure('canonical-parse-and-physical-assertions', () => {
          const canonical = JSON.parse(chunked.final.state.continuation!.serializedState);
          expect(canonical.physicalState).toBeDefined();
          if (fixture.name === 'observation-arduino-led') {
            expect(canonical.boards[0].runtime.clockProfile).toBe('instruction-us-v1');
            expect(canonical.physicalState.thermal.length).toBeGreaterThan(0);
          }
          if (fixture.name === 'observation-motor') {
            expect(
              canonical.physicalState.motors[0].motorAngularVelocityRadPerSecond,
            ).toBeGreaterThan(0);
            expect(canonical.physicalState.motors[0].simulationTimeSeconds).toBeGreaterThan(0);
          }
          if (fixture.name === 'observation-damage') {
            expect(
              chunked.final.observation.components.find(
                (component) => component.componentId === 'battery',
              ),
            ).toMatchObject({ damageState: 'failed', deviceHealth: 'failed_open' });
            expect(canonical.physicalState.thermal[0].accumulatedDamage).toBeGreaterThan(0);
          }
          probe?.complete({
            horizon: fixture.horizon,
            targets: [0, ...targets],
            referenceChars: referenceJson.length,
            chunkedChars: chunkedJson.length,
            finalStatus: chunked.final.executionStatus,
            committed: chunked.final.committedHorizonMicroseconds,
            canonicalReached: canonical.reachedMicroseconds,
            arduinoVirtualTimeMs: canonical.boards[0]?.runtime.virtualTimeMs,
            referenceYieldSequence: reference.yieldSequence,
            chunkedYieldSequence: chunked.yieldSequence,
          });
        });
      } finally {
        probe?.flush();
      }
    });
  }
});

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
