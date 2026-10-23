import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import {
  createElectronicsAdvanceSession,
  parseElectronicsEngineDocument,
  type ElectronicsTimedState,
  type ElectronicsLedTemporalComponent,
  type ElectronicsLedTemporalObservation,
  type ElectronicsLedTemporalSample,
} from '@asa-lab/electronics/engine';
import type { SolveResult } from '../../api';
import {
  LedTemporalPresentation,
  ELECTRONICS_CLASSROOM_PACE,
  ELECTRONICS_CLASSROOM_LOOKAHEAD_MICROSECONDS,
  LED_PRESENTATION_PHASE_LIMIT_MICROSECONDS,
  classroomRequestedHorizon,
  sameOpticalFrame,
} from '../led-temporal-presentation';

function channel(
  componentId: string,
  samples: readonly ElectronicsLedTemporalSample[],
): ElectronicsLedTemporalComponent {
  let brightnessIntegral = 0;
  let litDurationMicroseconds = 0;
  let transitionCount = 0;
  for (let index = 1; index < samples.length; index++) {
    const before = samples[index - 1]!;
    const elapsed = samples[index]!.atMicroseconds - before.atMicroseconds;
    brightnessIntegral += before.brightness * elapsed;
    if (before.brightness > 0) litDurationMicroseconds += elapsed;
    if (before.brightness !== samples[index]!.brightness) transitionCount++;
  }
  return {
    componentId,
    samples,
    brightnessIntegral,
    litDurationMicroseconds,
    transitionCount,
    truncated: false,
  };
}

function point(atMicroseconds: number, brightness: number): ElectronicsLedTemporalSample {
  return { atMicroseconds, brightness, current: brightness > 0 ? 0.01 : 0 };
}

function square(from: number, to: number, half: number, brightness = 80, id = 'led') {
  const at = (time: number) => point(time, Math.floor(time / half) % 2 === 0 ? brightness : 0);
  const samples = [at(from)];
  for (let time = (Math.floor(from / half) + 1) * half; time < to; time += half)
    samples.push(at(time));
  if (to !== from) samples.push(at(to));
  return channel(id, samples);
}

function window(
  fromMicroseconds: number,
  toMicroseconds: number,
  components = [square(fromMicroseconds, toMicroseconds, 1000)],
): ElectronicsLedTemporalObservation {
  return { profile: 'ordinary-led-held-v1', fromMicroseconds, toMicroseconds, components };
}

// A deterministic renderer harness: only explicit frame ticks prepare values,
// then this synchronous test renderer acknowledges the actual requested frame.
// Delayed/error/native resource proofs have separate barrier/renderer cases.
const lastDraw = new WeakMap<LedTemporalPresentation, number>();
function drawFrame(presentation: LedTemporalPresentation, wallMicroseconds: number) {
  const frame = presentation.prepareFrame(wallMicroseconds);
  if (frame) expect(presentation.acknowledgeFrame(frame, wallMicroseconds)).toBe(true);
  lastDraw.set(presentation, wallMicroseconds);
  return presentation.sample();
}

function drawUntil(presentation: LedTemporalPresentation, wallMicroseconds: number) {
  if (!lastDraw.has(presentation)) drawFrame(presentation, 0);
  for (let wall = lastDraw.get(presentation)! + 5_000; wall < wallMicroseconds; wall += 5_000)
    drawFrame(presentation, wall);
  if (lastDraw.get(presentation)! < wallMicroseconds) drawFrame(presentation, wallMicroseconds);
  return presentation.sample();
}

// These optical signals are deliberately analytic. Actual solver/current provenance
// and transport are challenged in the domain and Worker integration tests.
function electrical(observation: ElectronicsLedTemporalObservation): SolveResult {
  return {
    solved: true,
    status: 'solved',
    current: 0,
    nodes: [],
    diagnostics: [],
    iterations: 1,
    numericalResidual: 0,
    numericalTolerance: 1e-9,
    quality: {
      passed: true,
      finite: true,
      maxKclResidualAmp: 0,
      maxSourceVoltageResidualVolt: 0,
      powerBalanceResidualWatt: 0,
      powerBalanceToleranceWatt: 1e-9,
      kclToleranceAmp: 1e-9,
      sourceVoltageToleranceVolt: 1e-9,
    },
    components: observation.components.map((component) => {
      const final = component.samples.at(-1)!;
      return {
        componentId: component.componentId,
        brightness: final.brightness,
        current: final.current,
        voltageDrop: 0,
        lit: final.brightness > 0,
        terminalVoltages: {},
      };
    }),
  };
}

// Execute the real pure browser-oracle functions without importing a Playwright
// suite (which initializes database fixtures). These are counterexamples, not
// substitutes for the actual Worker/browser journeys.
const oracleSource = ts.createSourceFile(
  'electronics-ready-cadence.spec.ts',
  readFileSync(
    new URL('../../../../../e2e/electronics-ready-cadence.spec.ts', import.meta.url),
    'utf8',
  ),
  ts.ScriptTarget.Latest,
  true,
);
const oracleNames = new Set([
  'validTemporalPaint',
  'temporalPhysicalBrightness',
  'temporalJointWitness',
  'temporalStartupBoundary',
  'temporalPaintCausality',
]);
const oracleDeclarations = oracleSource.statements
  .filter(
    (statement) =>
      (ts.isFunctionDeclaration(statement) &&
        statement.name &&
        oracleNames.has(statement.name.text)) ||
      (ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(
          (declaration) =>
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === 'OWNER_TEMPORAL_PUBLICATION_LAG_MS',
        )),
  )
  .map((statement) => statement.getText(oracleSource));
if (oracleDeclarations.length !== 6)
  throw new Error('actual browser joint oracle declarations not found');
const oracle = runInNewContext(
  ts.transpileModule(
    `${oracleDeclarations.join('\n')}\n({ joint: temporalJointWitness, paint: temporalPaintCausality });`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
  ).outputText,
) as {
  joint: (frame: Record<string, unknown>, brightness: readonly number[]) => number | undefined;
  paint: (
    raw: Record<string, unknown>,
    source: string,
    generation: number,
    from: number,
  ) => {
    witnesses: Array<{ modelTimeMicroseconds: number; supersededAt: number | null }>;
    violations: Array<{ reason: string }>;
  };
};

function oracleFrame(
  observation: ElectronicsLedTemporalObservation,
  at = observation.toMicroseconds / 1000,
) {
  return {
    source: 'analytic',
    generationId: 1,
    responseGenerationId: 1,
    requestAt: Math.max(0, at - 1),
    at,
    executionStatus: 'ready',
    solved: true,
    qualityPassed: true,
    requestedHorizonMicroseconds: observation.toMicroseconds,
    committedHorizonMicroseconds: observation.toMicroseconds,
    continuationHorizonMicroseconds: observation.toMicroseconds,
    components: electrical(observation).components,
    ledTemporal: observation,
  };
}

function oraclePaint(frames: ReturnType<typeof oracleFrame>[], at: number, brightness: number[]) {
  // These are post-H0 counterexamples: include the accepted analytic dark start,
  // then retain every supplied receipt and the original paint time/vector.
  const initial = oracleFrame(
    window(
      0,
      0,
      ['led0', 'led1', 'led2'].map((id) => channel(id, [point(0, 0)])),
    ),
  );
  return {
    frames: [initial, ...frames],
    paintRuns: [
      {
        first: {
          previousFrameAt: at - 16,
          brightness,
          images: brightness.map((value) => ({
            decoded: true,
            visible: true,
            unoccluded: true,
            opacity: 1,
            lit: value > 0,
          })),
        },
        lastAt: at,
        witnessAt: [at],
      },
    ],
  };
}

describe('actual browser joint provenance oracle counterexamples', () => {
  const observation = window(175_000, 200_000, [
    square(175_000, 200_000, 50_000, 80, 'led0'),
    channel('led1', [point(175_000, 0), point(190_000, 80), point(200_000, 80)]),
    channel('led2', [point(175_000, 0), point(200_000, 0)]),
  ]);

  it('uses one real190ms joint time in ready200 and expires it at200+50ms without a later receipt', () => {
    const frame = oracleFrame(observation);
    expect(oracle.joint(frame, [0, 80, 0])).toBe(190_000);
    const first = oracle.paint(oraclePaint([frame], 215, [0, 80, 0]), 'analytic', 1, 0);
    expect(first.violations).toEqual([]);
    expect(first.witnesses[0]).toMatchObject({ modelTimeMicroseconds: 190_000, supersededAt: 200 });
    expect(
      oracle.paint(oraclePaint([frame], 250, [0, 80, 0]), 'analytic', 1, 0).violations,
    ).toEqual([]);
    const expired = oracle.paint(oraclePaint([frame], 250.001, [0, 80, 0]), 'analytic', 1, 0);
    expect(expired.violations).toHaveLength(1);
    expect(expired.violations[0]!.reason).toBe('electrical state superseded more than 50 ms ago');
  });

  it('rejects individually present light values that never coexist at one time', () => {
    const neverJoint = window(0, 25_000, [
      channel('led0', [point(0, 80), point(12_500, 0), point(25_000, 0)]),
      channel('led1', [point(0, 0), point(12_500, 80), point(25_000, 80)]),
      channel('led2', [point(0, 0), point(25_000, 0)]),
    ]);
    expect(oracle.joint(oracleFrame(neverJoint), [80, 80, 0])).toBeUndefined();
    const painted = oracle.paint(
      oraclePaint([oracleFrame(neverJoint)], 30, [80, 80, 0]),
      'analytic',
      1,
      0,
    );
    expect(painted.violations).toHaveLength(1);
    expect(painted.violations[0]!.reason).toBe('no causally preceding electrical state');
  });

  it.each([
    'yielded',
    'fault',
    'quality',
    'unsolved',
    'horizon',
    'continuation',
    'generation',
    'failure',
    'future-sample',
  ])('withholds a %s optical witness', (reason) => {
    const frame = oracleFrame(structuredClone(observation));
    if (reason === 'yielded' || reason === 'fault') frame.executionStatus = reason;
    if (reason === 'quality') frame.qualityPassed = false;
    if (reason === 'unsolved') frame.solved = false;
    if (reason === 'horizon') frame.requestedHorizonMicroseconds++;
    if (reason === 'continuation') frame.continuationHorizonMicroseconds--;
    if (reason === 'generation') frame.responseGenerationId++;
    if (reason === 'failure') Object.assign(frame.components[0]!, { presentationState: 'failed' });
    if (reason === 'future-sample')
      Object.assign(frame.ledTemporal.components[0]!.samples.at(-1)!, { atMicroseconds: 200_001 });
    expect(oracle.joint(frame, [0, 80, 0])).toBeUndefined();
  });

  it('rejects receipts arriving in the future and a previously valid but inactive generation', () => {
    const future = oracleFrame(observation, 220);
    const futurePaint = oracle.paint(oraclePaint([future], 215, [0, 80, 0]), 'analytic', 1, 0);
    expect(futurePaint.violations).toHaveLength(1);
    expect(futurePaint.violations[0]!.reason).toBe('no causally preceding electrical state');
    const old = oracleFrame(observation);
    const active = {
      ...future,
      requestAt: 210,
      source: 'changed',
      generationId: 2,
      responseGenerationId: 2,
    };
    const stalePaint = oracle.paint(oraclePaint([old, active], 215, [0, 80, 0]), 'analytic', 1, 0);
    expect(stalePaint.violations).toHaveLength(1);
    expect(stalePaint.violations[0]!.reason).toBe('foreign source or inactive generation');
  });
});

describe('accepted per-LED temporal presentation', () => {
  it('publishes a ready joint HIGH on the next 40 ms RAF after native H0 ACK', () => {
    const presentation = new LedTemporalPresentation();
    const initial = window(
      0,
      0,
      ['d2', 'd3', 'd4'].map((id) => channel(id, [point(0, 0)])),
    );
    presentation.accept(electrical(initial), initial, 0);
    const h0 = presentation.prepareFrame(0)!;
    expect([...h0.brightness.values()]).toEqual([0, 0, 0]);
    // Only the real native/layout ACK permits progress, never preparation alone.
    expect(presentation.sample().size).toBe(0);
    expect(presentation.acknowledgeFrame(h0, 0, true)).toBe(true);
    expect(presentation.canPublishDistinctFrame).toBe(false);
    const observation = window(0, 6_250, [
      channel('d2', [point(0, 0), point(537, 70), point(6_250, 70)]),
      channel('d3', [point(0, 0), point(6_250, 0)]),
      channel('d4', [point(0, 0), point(6_250, 0)]),
    ]);
    presentation.accept(electrical(observation), observation, 1_000);
    expect(presentation.canPublishDistinctFrame).toBe(false);
    expect([...presentation.sample().values()]).toEqual([0, 0, 0]);
    const high = presentation.prepareFrame(40_000);
    expect(high).not.toBeNull();
    expect([...high!.brightness.values()]).toEqual([70, 0, 0]);
    expect(presentation.acknowledgeFrame(high!, 40_000, true)).toBe(true);
    expect(presentation.canPublishDistinctFrame).toBe(false);
    expect(40_000 - 1_000).toBeLessThanOrEqual(50_000);
  });

  it('ingests complete windows without publishing a frame or moving the acknowledged cursor', () => {
    const presentation = new LedTemporalPresentation();
    const first = window(0, 25_000, [square(0, 25_000, 100_000)]);
    presentation.accept(electrical(first), first, 0);
    expect(presentation.sample().size).toBe(0);
    expect(presentation.presentedMicroseconds).toBe(0);
    const initial = presentation.prepareFrame(10_000)!;
    expect(initial.atMicroseconds).toBe(0);
    expect(initial.brightness.get('led')).toBe(80);
    const next = window(25_000, 50_000, [square(25_000, 50_000, 100_000)]);
    presentation.accept(electrical(next), next, 20_000);
    expect(presentation.preparedFrame).toBe(initial);
    expect(presentation.sample().size).toBe(0);
    expect(presentation.prepareFrame(500_000)).toBe(initial);
    expect(presentation.presentedMicroseconds).toBe(0);
    expect(presentation.acknowledgeFrame(initial, 500_000)).toBe(true);
    expect(presentation.sample().get('led')).toBe(80);
    const after = presentation.prepareFrame(510_000)!;
    expect(after.atMicroseconds).toBe(50_000);
    expect(presentation.presentedMicroseconds).toBe(0);
  });

  it('recovers wall time only through complete accepted data after an underrun', () => {
    const presentation = new LedTemporalPresentation();
    const receive = (from: number, to: number, wall: number) => {
      const observation = window(from, to, [square(from, to, 100_000)]);
      presentation.accept(electrical(observation), observation, wall);
    };
    receive(0, 25_000, 0);
    drawFrame(presentation, 0);
    for (const wall of [40_000, 80_000, 120_000, 160_000, 200_000]) drawFrame(presentation, wall);
    expect(presentation.presentedMicroseconds).toBe(25_000);
    // Waiting for complete data does not permanently slow the physical clock.
    drawFrame(presentation, 1_000_000);
    receive(25_000, 50_000, 1_000_001);
    expect(presentation.presentedMicroseconds).toBe(25_000);
    drawFrame(presentation, 1_020_000);
    expect(presentation.presentedMicroseconds).toBe(50_000);
    for (let from = 50_000; from < 125_000; from += 25_000)
      receive(from, from + 25_000, 1_020_001 + from);
    for (let wall = 1_040_000; wall <= 1_600_000; wall += 20_000) drawFrame(presentation, wall);
    expect(presentation.presentedMicroseconds).toBe(125_000);
    expect(presentation.sample().get('led')).toBe(0);
    drawFrame(presentation, 1_620_000);
    expect(presentation.presentedMicroseconds).toBe(125_000);
    expect(presentation.reanchorCount).toBe(0);
  });

  it('prepares the first accepted native vector without publishing or skipping an intermediate phase', () => {
    const presentation = new LedTemporalPresentation();
    const observation: ElectronicsLedTemporalObservation = {
      ...window(0, 6_250, [
        channel('d2', [point(0, 0), point(7, 70), point(2_000, 0), point(6_250, 0)]),
        channel('d3', [point(0, 0), point(3_000, 70), point(6_250, 70)]),
        channel('d4', [point(0, 0), point(6_250, 0)]),
      ]),
      arduinoIndicators: [
        {
          componentId: 'uno',
          truncated: false,
          samples: [
            { atMicroseconds: 0, voltage: 0 },
            { atMicroseconds: 1_000, voltage: 5 },
            { atMicroseconds: 6_250, voltage: 0 },
          ],
        },
      ],
    };
    const result: SolveResult = {
      ...electrical(observation),
      components: [
        ...electrical(observation).components,
        { componentId: 'uno', current: 0, voltageDrop: 5, terminalVoltages: { d13: 0 } },
      ],
    };
    presentation.accept(result, observation, 0);
    drawFrame(presentation, 0);
    const next = presentation.nextNativeAssetFrame!;
    expect(next.atMicroseconds).toBe(7);
    expect([...next.brightness]).toEqual([
      ['d2', 70],
      ['d3', 0],
      ['d4', 0],
    ]);
    expect(next.arduinoLStates.get('uno')).toBe(false);
    // The endpoint is 010; the first future native need is the real 100 phase.
    expect(result.components[0]!.brightness).toBe(0);
    expect(result.components[1]!.brightness).toBe(70);
    expect(presentation.preparedFrame).toBeNull();
    expect(presentation.acknowledgeFrame({ ...next, token: 'native-preparation' }, 500)).toBe(
      false,
    );
    expect(presentation.presentedMicroseconds).toBe(0);
    expect([...presentation.sample().values()]).toEqual([0, 0, 0]);
    expect(classroomRequestedHorizon(0, 100_000, presentation.presentedMicroseconds)).toBe(50_000);
    // Repeated native preparation reads cannot count as shared RAFs.
    for (let read = 0; read < 10; read++) expect(presentation.nextNativeAssetFrame).toEqual(next);
    expect(presentation.canPublishDistinctFrame).toBe(false);
    const display = presentation.prepareFrame(1_000)!;
    expect(display.brightness.get('d2')).toBe(70);
    expect(presentation.acknowledgeFrame(display, 1_000)).toBe(true);
  });

  it('includes the accepted fast-cycle expiry when finding the next native asset', () => {
    const presentation = new LedTemporalPresentation();
    const fast = window(0, 25_000);
    presentation.accept(electrical(fast), fast, 0);
    drawUntil(presentation, 200_000);
    expect(presentation.sample().get('led')).toBe(40);
    const held = window(25_000, 50_000, [channel('led', [point(25_000, 0), point(50_000, 0)])]);
    presentation.accept(electrical(held), held, 200_000);
    expect(presentation.nextNativeAssetFrame?.atMicroseconds).toBe(50_000);
    expect(presentation.nextNativeAssetFrame?.brightness.get('led')).toBe(0);
    expect(presentation.sample().get('led')).toBe(40);
  });

  it('invalidates native preparation identity on Reset and rejected history', () => {
    const presentation = new LedTemporalPresentation();
    const observation = window(0, 0, [channel('led', [point(0, 80)])]);
    presentation.accept(electrical(observation), observation, 0);
    const first = presentation.nextNativeAssetFrame!;
    presentation.reset();
    expect(presentation.nextNativeAssetFrame).toBeNull();
    presentation.accept(electrical(observation), observation, 10_000);
    expect(presentation.nextNativeAssetFrame?.generation).not.toBe(first.generation);
    expect(presentation.presentedMicroseconds).toBe(0);
    expect(presentation.sample().size).toBe(0);
    presentation.accept({ ...electrical(observation), solved: false }, observation, 10_001);
    expect(presentation.nextNativeAssetFrame).toBeNull();
    expect(presentation.preparedFrame).toBeNull();
  });

  it('holds one immutable pending native frame while real ready data arrives', () => {
    const presentation = new LedTemporalPresentation();
    const first = window(0, 25_000, [
      channel('led', [point(0, 0), point(1, 80), point(25_000, 80)]),
    ]);
    presentation.accept(electrical(first), first, 0);
    drawFrame(presentation, 0);
    const high = presentation.prepareFrame(10_000)!;
    expect(high.brightness.get('led')).toBe(80);
    const next = window(25_000, 25_000, [channel('led', [point(25_000, 80)])]);
    presentation.accept(electrical(next), next, 50_000);
    for (const wall of [50_000, 100_000, 500_000]) {
      expect(presentation.prepareFrame(wall)).toBe(high);
      expect(presentation.sample().get('led')).toBe(0);
      expect(presentation.presentedMicroseconds).toBe(0);
      expect(
        classroomRequestedHorizon(0, wall, presentation.presentedMicroseconds),
      ).toBeLessThanOrEqual(50_000);
    }
    expect(presentation.acknowledgeFrame({ ...high }, 500_000)).toBe(false);
    expect(presentation.acknowledgeFrame(high, 500_000)).toBe(true);
    expect(presentation.sample().get('led')).toBe(80);
    const after = presentation.prepareFrame(510_000)!;
    expect(after.atMicroseconds).toBe(25_000);
  });

  it('requires the next shared RAF after an actual distinct DOM commit', () => {
    const presentation = new LedTemporalPresentation();
    const observation = window(0, 25_000, [
      channel('led', [point(0, 0), point(1, 80), point(25_000, 80)]),
    ]);
    presentation.accept(electrical(observation), observation, 0);
    const low = presentation.prepareFrame(0)!;
    expect(presentation.acknowledgeFrame(low, 1_000)).toBe(true);
    expect(presentation.canPublishDistinctFrame).toBe(false);
    const high = presentation.prepareFrame(17_000)!;
    expect(high.brightness.get('led')).toBe(80);
    expect(presentation.sample().get('led')).toBe(0);
    expect(presentation.acknowledgeFrame(high, 18_000)).toBe(true);
    expect(presentation.canPublishDistinctFrame).toBe(false);
    drawFrame(presentation, 34_000);
    expect(presentation.canPublishDistinctFrame).toBe(true);
  });

  it('keeps a single physical wall epoch across repeated delayed native ACKs', () => {
    const presentation = new LedTemporalPresentation();
    let from = 0;
    for (let wall = 0; wall <= 20_100_000; wall += 16_667) {
      const to = wall + 50_000;
      const observation = window(from, to, [square(from, to, 30_000)]);
      presentation.accept(electrical(observation), observation, wall);
      const frame = presentation.prepareFrame(wall)!;
      expect(frame.atMicroseconds).toBe(wall);
      // A 2ms React/native ACK cost on every frame must not accumulate drift.
      expect(presentation.acknowledgeFrame(frame, wall + 2_000)).toBe(true);
      expect(presentation.presentedMicroseconds).toBe(wall);
      from = to;
    }
  });

  it('samples independent staggered 30ms outputs at wall time without replay backlog', () => {
    const presentation = new LedTemporalPresentation();
    let from = 0;
    for (let wall = 0; wall <= 2_000_000; wall += 16_667) {
      const to = wall + 50_000;
      const offsets = [0, 10_000, 20_000];
      const components = offsets.map((offset, index) => {
        const at = (time: number) => point(time, Math.floor((time + offset) / 30_000) % 2 ? 0 : 80);
        const samples = [at(from)];
        for (
          let time = (Math.floor((from + offset) / 30_000) + 1) * 30_000 - offset;
          time < to;
          time += 30_000
        )
          samples.push(at(time));
        samples.push(at(to));
        return channel(`led${index}`, samples);
      });
      const observation = window(from, to, components);
      presentation.accept(electrical(observation), observation, wall);
      const frame = presentation.prepareFrame(wall)!;
      expect(frame.atMicroseconds).toBe(wall);
      for (const [index, offset] of offsets.entries())
        expect(frame.brightness.get(`led${index}`)).toBe(
          Math.floor((wall + offset) / 30_000) % 2 ? 0 : 80,
        );
      expect(presentation.acknowledgeFrame(frame, wall + 2_000)).toBe(true);
      from = to;
    }
  });

  it.each([0, 17_000, 1_000_000])(
    'bounds future model demand after a %i us host stall without a second clock',
    (stall) => {
      expect(ELECTRONICS_CLASSROOM_PACE).toBe(1);
      expect(ELECTRONICS_CLASSROOM_LOOKAHEAD_MICROSECONDS).toBe(50_000);
      expect(ELECTRONICS_CLASSROOM_LOOKAHEAD_MICROSECONDS / ELECTRONICS_CLASSROOM_PACE).toBe(
        50_000,
      );
      expect(LED_PRESENTATION_PHASE_LIMIT_MICROSECONDS).toBe(25_000);
      expect(classroomRequestedHorizon(70_000, 10_000, 0)).toBe(80_000);
      expect(classroomRequestedHorizon(70_000, 100_000 + stall, 0)).toBe(120_000);
      expect(classroomRequestedHorizon(70_000, 1_000_000 + stall, 100_000)).toBe(220_000);
      expect(classroomRequestedHorizon(70_000, -1, 0)).toBe(70_000);
    },
  );

  it.each(['reset', 'quality', 'unsolved', 'generation'] as const)(
    'cancels a pending native frame and its old ACK on %s',
    (reason) => {
      const presentation = new LedTemporalPresentation();
      const old = window(0, 25_000, [square(0, 25_000, 100_000)]);
      presentation.accept(electrical(old), old, 0);
      const pending = presentation.prepareFrame(0)!;
      if (reason === 'reset') presentation.reset();
      else if (reason === 'generation') {
        const seed = window(0, 0, [channel('led', [point(0, 0)])]);
        presentation.accept(electrical(seed), seed, 1_000_000);
      } else {
        const next = window(25_000, 25_000, [channel('led', [point(25_000, 0)])]);
        const result = electrical(next);
        if (reason === 'quality') result.quality!.passed = false;
        else result.solved = false;
        presentation.accept(result, next, 1_000_000);
      }
      expect(presentation.acknowledgeFrame(pending, 1_000_001)).toBe(false);
      expect(presentation.sample().size).toBe(0);
      expect(presentation.presentedMicroseconds).toBe(0);
      expect(presentation.arduinoLStates().size).toBe(0);
      const fresh = window(0, 25_000, [square(0, 25_000, 100_000, 0)]);
      presentation.accept(electrical(fresh), fresh, 1_010_000);
      const frame = presentation.prepareFrame(1_010_000)!;
      expect(frame.token).not.toBe(pending.token);
      expect(frame.atMicroseconds).toBe(0);
      expect(frame.brightness.get('led')).toBe(0);
    },
  );

  it.each([
    'neighbour edge',
    'reverted edge',
    'current only',
    'truncated',
    'missing prefix',
  ] as const)('does not borrow held time across a %s or fabricate missing coverage', (reason) => {
    const presentation = new LedTemporalPresentation();
    const first = window(0, 5_000, [
      channel('first', [point(0, 60), point(5_000, 60)]),
      channel('other', [point(0, 80), point(5_000, 80)]),
    ]);
    presentation.accept(electrical(first), first, 0);
    drawFrame(presentation, 0);
    drawFrame(presentation, 5_000);
    let other = channel('other', [
      point(5_000, 80),
      ...(reason === 'neighbour edge' ? [point(20_000, 0)] : []),
      ...(reason === 'reverted edge' ? [point(20_000, 0), point(21_000, 80)] : []),
      point(25_000, reason === 'neighbour edge' ? 0 : 80),
    ]);
    if (reason === 'current only')
      other = channel('other', [
        point(5_000, 80),
        { ...point(20_000, 80), current: 0.011 },
        { ...point(25_000, 80), current: 0.011 },
      ]);
    if (reason === 'truncated') other = { ...other, truncated: true };
    if (reason === 'missing prefix')
      other = { ...other, truncated: true, samples: [point(20_000, 80), point(25_000, 80)] };
    const next = window(5_000, 25_000, [
      channel('first', [point(5_000, 60), point(25_000, 60)]),
      other,
    ]);
    presentation.accept(electrical(next), next, 6_000);
    const frame = presentation.prepareFrame(6_000);
    if (reason === 'truncated' || reason === 'missing prefix') {
      expect(frame).toBeNull();
      expect(presentation.sample().size).toBe(0);
      expect(presentation.reanchorCount).toBe(1);
    } else {
      expect(frame!.atMicroseconds).toBe(6_000);
      expect([...frame!.brightness.values()]).toEqual([60, 80]);
      expect(presentation.reanchorCount).toBe(0);
    }
  });

  it.each([50_000, 100_000, 150_000, 200_000, 300_000])(
    'keeps complete joint order and half durations for an analytic %i us phase at the common pace',
    (half) => {
      const presentation = new LedTemporalPresentation();
      let committed = 0;
      const first = window(0, 0, [
        square(0, 0, half, 80, 'first'),
        square(0, 0, half * 2, 60, 'other'),
      ]);
      presentation.accept(electrical(first), first, 0);
      const edges: Array<{ at: number; lit: boolean }> = [];
      for (let wall = 0; wall <= half * 80; wall += 5_000) {
        const target = classroomRequestedHorizon(0, wall, presentation.presentedMicroseconds);
        if (target > committed) {
          const observation = window(committed, target, [
            square(committed, target, half, 80, 'first'),
            square(committed, target, half * 2, 60, 'other'),
          ]);
          presentation.accept(electrical(observation), observation, wall);
          committed = target;
        }
        drawFrame(presentation, wall);
        const frame = presentation.displayedFrame!;
        expect(frame.brightness.get('first')).toBe(
          Math.floor(frame.atMicroseconds / half) % 2 ? 0 : 80,
        );
        expect(frame.brightness.get('other')).toBe(
          Math.floor(frame.atMicroseconds / (half * 2)) % 2 ? 0 : 60,
        );
        const lit = frame.brightness.get('first')! > 0;
        if (!edges.length || edges.at(-1)!.lit !== lit) edges.push({ at: wall, lit });
        expect(committed - presentation.presentedMicroseconds).toBeLessThanOrEqual(50_000);
      }
      expect(edges.length).toBeGreaterThanOrEqual(9);
      for (let index = 1; index < edges.length; index++) {
        expect(edges[index]!.lit).not.toBe(edges[index - 1]!.lit);
        expect(edges[index]!.at - edges[index - 1]!.at).toBe(half / ELECTRONICS_CLASSROOM_PACE);
      }
      expect(presentation.reanchorCount).toBe(0);
    },
  );

  it('does not jump to the latest endpoint merely because the old 33.333ms receipt deadline elapsed', () => {
    const presentation = new LedTemporalPresentation();
    const observation = window(0, 25_000, [square(0, 25_000, 50_000)]);
    presentation.accept(electrical(observation), observation, 0);
    const prepared = presentation.prepareFrame(0)!;
    for (const wall of [33_333, 33_334, 50_000, 500_000]) {
      expect(presentation.prepareFrame(wall)).toBe(prepared);
      expect(presentation.presentedMicroseconds).toBe(0);
      expect(presentation.reanchorCount).toBe(0);
    }
    expect(presentation.acknowledgeFrame(prepared, 500_000)).toBe(true);
    expect(presentation.prepareFrame(510_000)!.atMicroseconds).toBe(25_000);
  });

  it('holds actual complete data on underrun and never advances a future edge', () => {
    const presentation = new LedTemporalPresentation();
    const first = window(0, 3_400, [channel('led', [point(0, 0), point(3, 80), point(3_400, 80)])]);
    presentation.accept(electrical(first), first, 0);
    for (let wall = 0; wall <= 100_000; wall += 5_000) drawFrame(presentation, wall);
    expect(presentation.presentedMicroseconds).toBe(3_400);
    expect(presentation.sample().get('led')).toBe(80);
    const next = window(3_400, 25_000, [
      channel('led', [point(3_400, 80), point(10_000, 0), point(25_000, 0)]),
    ]);
    presentation.accept(electrical(next), next, 100_001);
    drawFrame(presentation, 120_000);
    expect(presentation.presentedMicroseconds).toBe(25_000);
    expect(presentation.sample().get('led')).toBe(0);
    drawFrame(presentation, 140_000);
    expect(presentation.sample().get('led')).toBe(0);
    drawFrame(presentation, 160_000);
    expect(presentation.sample().get('led')).toBe(0);
  });

  it('retains fast-cycle integrals while the frame clock and native ACK remain independent', () => {
    const presentation = new LedTemporalPresentation();
    const observation = window(0, 25_000);
    expect(presentation.accept(electrical(observation), observation, 0).get('led')).toBe(40);
    drawFrame(presentation, 0);
    expect(presentation.sample().get('led')).toBe(80);
    for (const wall of [16_667, 33_334, 50_001]) drawFrame(presentation, wall);
    expect(presentation.sample().get('led')).toBe(40);
    // The actual fast-cycle mean is sampled on the real wall clock.
    expect(presentation.displayedFrame!.atMicroseconds).toBe(25_000);
    expect(presentation.reanchorCount).toBe(0);
  });

  it('publishes only real endpoints for circuits without a timed Arduino history', () => {
    const presentation = new LedTemporalPresentation();
    const first = window(0, 0, [channel('led', [point(0, 80)])]);
    presentation.acceptSnapshot(electrical(first), 0);
    expect(presentation.sample().size).toBe(0);
    drawFrame(presentation, 0);
    const next = window(25_000, 25_000, [channel('led', [point(25_000, 60)])]);
    presentation.acceptSnapshot(electrical(next), 25_000);
    expect(presentation.sample().get('led')).toBe(80);
    drawFrame(presentation, 20_000);
    drawFrame(presentation, 40_000);
    drawFrame(presentation, 60_000);
    expect(presentation.presentedMicroseconds).toBe(25_000);
    expect(presentation.sample().get('led')).toBe(60);
  });

  it.each(['failure', 'reverse history'] as const)(
    'invalidates an uncommitted positive asset when %s excludes its optical channel',
    (reason) => {
      const presentation = new LedTemporalPresentation();
      const first = window(0, 10_000, [
        channel('led', [point(0, 80), point(5_000, 0), point(10_000, 0)]),
      ]);
      presentation.accept(electrical(first), first, 0);
      const old = presentation.prepareFrame(0)!;
      expect(old.brightness.get('led')).toBe(80);
      const next = window(10_000, 25_000, [channel('led', [point(10_000, 0), point(25_000, 0)])]);
      const result = electrical(next);
      Object.assign(
        result.components[0]!,
        reason === 'failure'
          ? { presentationState: 'failed' }
          : { junctionState: 'reverse_blocking' },
      );
      const before = JSON.stringify(result);
      presentation.accept(result, next, 10_000);
      expect(presentation.acknowledgeFrame(old, 10_001)).toBe(false);
      const replacement = presentation.prepareFrame(20_000)!;
      expect(replacement.token).not.toBe(old.token);
      expect(replacement.brightness.has('led')).toBe(false);
      expect(JSON.stringify(result)).toBe(before);
    },
  );

  it('preserves the saved ed14 startup receipt/RAF prefix on the acknowledged classroom cursor', () => {
    // Original owner-blink-100 raw, relative to its actual H0 receipt2670.4ms.
    // Preserve every ready/RAF through the failed receipt3021.1ms; the original
    // expiry mark3021.3ms follows callback bookkeeping by0.2ms.
    const ready = [
      [0, 0],
      [31_100, 11_500],
      [50_800, 27_700],
      [76_900, 49_800],
      [91_200, 62_100],
      [113_100, 80_600],
      [133_200, 100_400],
      [154_100, 125_400],
      [165_800, 147_700],
      [179_400, 160_000],
      [193_000, 174_500],
      [204_700, 179_500],
      [216_100, 199_000],
      [225_500, 208_900],
      [233_500, 224_900],
      [248_700, 230_000],
      [264_000, 252_900],
      [270_300, 261_600],
      [278_600, 270_100],
      [290_600, 277_700],
      [299_500, 290_600],
      [307_500, 297_800],
      [317_000, 309_700],
      [329_100, 322_800],
      [332_800, 327_700],
      [350_700, 340_300],
    ];
    const raf = [
      7800, 19_200, 42_000, 53_400, 79_700, 88_900, 110_300, 123_200, 140_600, 152_300, 173_000,
      190_500, 202_700, 223_000, 245_200, 256_000, 269_000, 287_700, 306_100, 319_100, 338_300,
    ];
    const presentation = new LedTemporalPresentation();
    const events = [
      ...ready.map(([at, to]) => ({ at: at!, to })),
      ...raf.map((at) => ({ at, to: undefined })),
    ].sort((left, right) => left.at - right.at);
    let from = 0;
    const states: boolean[] = [];
    for (const event of events) {
      let display: ReadonlyMap<string, number>;
      if (event.to !== undefined) {
        const observation = window(from, event.to, [
          ...[0, 1, 2].map((index) => {
            const edges = [4, 100_008, 200_013, 300_017].map((at) => at + index);
            const at = (time: number) => {
              const brightness = edges.filter((edge) => edge <= time).length % 2 ? 70.02 : 0;
              return { atMicroseconds: time, brightness, current: brightness ? 0.009058135491 : 0 };
            };
            return channel(`led${index}`, [
              at(from),
              ...edges.filter((edge) => edge > from && edge < event.to!).map(at),
              ...(event.to !== from ? [at(event.to)] : []),
            ]);
          }),
          channel('led3', [
            point(from, 70.91),
            ...(event.to !== from ? [point(event.to, 70.91)] : []),
          ]),
        ]);
        presentation.accept(electrical(observation), observation, event.at);
        display = presentation.sample();
        from = event.to;
      } else display = drawFrame(presentation, event.at);
      const lit = display.get('led0')! > 0;
      if (!states.length || states.at(-1) !== lit) states.push(lit);
      expect(presentation.reanchorCount).toBe(0);
    }
    // Original complete windows are deliberately ingested at their old receipt
    // times, even though the new host caps future data more tightly. Drain the
    // retained physical prefix with declared 10 ms RAFs, without a new receipt.
    for (let wall = 360_000; wall <= 3_600_000; wall += 10_000) {
      const display = drawFrame(presentation, wall);
      const lit = (display.get('led0') ?? 0) > 0;
      if (states.at(-1) !== lit) states.push(lit);
    }
    expect(states).toEqual([false, true, false, true, false]);
    expect(presentation.presentedMicroseconds).toBe(340_300);
    expect(presentation.reanchorCount).toBe(0);
  });

  it.each([
    {
      name: 'no-delay9.6ms',
      edges: [4, 5, 6],
      ready: [
        [2898.1, 0],
        [2948.8, 9600],
        [3002.5, 34600],
        [3046.5, 59600],
        [3114.5, 84600],
      ],
      raf: [
        2904.9, 2921.2, 2937.7, 2958.3, 2975.1, 2987.4, 3021.3, 3028.2, 3049.6, 3070.6, 3077.1,
        3110.6, 3128,
      ],
    },
    {
      name: 'millis3.4/21.2ms',
      edges: [3, null, 5],
      ready: [
        [2486.5, 0],
        [2513.5, 3400],
        [2589.1, 21200],
        [2698.4, 46200],
      ],
      raf: [
        2499.5, 2516, 2532.9, 2550.5, 2574.6, 2587.7, 2599.3, 2618.4, 2633.2, 2648.9, 2665.4,
        2682.3, 2700.8,
      ],
    },
  ])(
    'preserves the saved393 $name startup receipts and RAFs on one acknowledged cursor',
    ({ edges, ready, raf }) => {
      // Original owner-execution-no-delay-realtime / owner-r18-millis-independent
      // raw receipts and RAFs, rounded only from browser milliseconds to integer
      // microseconds. These startup samples contain no later optical transitions.
      const presentation = new LedTemporalPresentation();
      const events = [
        ...ready.map(([at, to]) => ({ at: Math.round(at! * 1000), to })),
        ...raf.map((at) => ({ at: Math.round(at * 1000), to: undefined })),
      ].sort((left, right) => left.at - right.at);
      let from = 0;
      for (const event of events) {
        let display: ReadonlyMap<string, number>;
        if (event.to !== undefined) {
          const to = event.to;
          const observation = window(
            from,
            to,
            edges.map((edge, index) => {
              const at = (time: number) => {
                const brightness = edge !== null && time >= edge ? 70.02 : 0;
                return {
                  atMicroseconds: time,
                  brightness,
                  current: brightness > 0 ? 0.009058135491 : 0,
                };
              };
              const samples = [at(from)];
              if (edge !== null && edge > from && edge < to) samples.push(at(edge));
              if (to !== from) samples.push(at(to));
              return channel(`led${index}`, samples);
            }),
          );
          presentation.accept(electrical(observation), observation, event.at);
          display = presentation.sample();
          from = to;
        } else display = drawFrame(presentation, event.at);
        // A ready callback is ingestion only. Every displayed value must be
        // justified at the actual acknowledged model time, including startup.
        const acknowledged = presentation.displayedFrame;
        expect([...display.values()]).toEqual(
          acknowledged
            ? edges.map((edge) =>
                edge !== null && acknowledged.atMicroseconds >= edge ? 70.02 : 0,
              )
            : [],
        );
        expect(presentation.presentedMicroseconds).toBeLessThanOrEqual(from);
        expect(presentation.reanchorCount).toBe(0);
      }
    },
  );

  it('keeps a real 1ms neighbour visible before, at and after another LED thermally fails', () => {
    const parsed = parseElectronicsEngineDocument({
      schemaVersion: 4,
      components: [
        {
          id: 'uno',
          kind: 'visual',
          componentTypeId: 'arduino-uno',
          value: 5,
          position: { x: 0, y: 0 },
          pinIds: ['d13', 'd12', 'd11', 'power-5v', 'power-3v3', 'power-gnd-1'],
          stateProperties: {
            // The unprotected 5V LED heats from time zero. Let the real MCU
            // wait during warmup, then measure multiple actual 1ms cycles
            // before the failure boundary; earlier switching is not required.
            arduinoSource:
              'void setup(){pinMode(12,OUTPUT);delay(3990);}void loop(){digitalWrite(12,HIGH);delay(1);digitalWrite(12,LOW);delay(1);}',
          },
        },
        {
          id: 'overdriven',
          kind: 'led',
          componentTypeId: 'led-5mm',
          value: 2,
          position: { x: 50, y: 0 },
          pinIds: ['anode', 'cathode'],
        },
        {
          id: 'protected',
          kind: 'led',
          componentTypeId: 'led-5mm',
          value: 2,
          position: { x: 100, y: 0 },
          pinIds: ['anode', 'cathode'],
        },
        {
          id: 'resistor',
          kind: 'resistor',
          componentTypeId: 'resistor-axial',
          value: 330,
          position: { x: 100, y: 50 },
          pinIds: ['lead-1', 'lead-2'],
        },
      ],
      connections: [
        {
          id: 'overdrive',
          from: { componentId: 'uno', terminal: 'power-5v' },
          to: { componentId: 'overdriven', terminal: 'anode' },
        },
        {
          id: 'overground',
          from: { componentId: 'overdriven', terminal: 'cathode' },
          to: { componentId: 'uno', terminal: 'power-gnd-1' },
        },
        {
          id: 'drive',
          from: { componentId: 'uno', terminal: 'd12' },
          to: { componentId: 'resistor', terminal: 'lead-1' },
        },
        {
          id: 'series',
          from: { componentId: 'resistor', terminal: 'lead-2' },
          to: { componentId: 'protected', terminal: 'anode' },
        },
        {
          id: 'ground',
          from: { componentId: 'protected', terminal: 'cathode' },
          to: { componentId: 'uno', terminal: 'power-gnd-1' },
        },
      ],
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const presentation = new LedTemporalPresentation();
    let state: ElectronicsTimedState | undefined;
    let expectedMean = 0;
    for (const horizon of [3_999_999, 4_000_000, 4_000_001]) {
      const session = createElectronicsAdvanceSession(
        parsed.document,
        { requestedHorizonMicroseconds: horizon, ...(state ? { state } : {}) },
        { observeLedTemporal: true },
      );
      let done = session.step();
      for (let batch = 1; !done && batch < 100_000; batch++) done = session.step();
      if (!done) throw new Error('bounded mixed LED request did not finish');
      expect(done.executionStatus, JSON.stringify(done.diagnostics)).toBe('ready');
      const result = done.observation!;
      const damaged = result.components.find(
        (component) => component.componentId === 'overdriven',
      )!;
      if (horizon < 4_000_000) {
        // The destructive operating-point preview still conducts. stressState
        // alone must neither fabricate an open device nor silence its neighbour.
        expect(damaged).toMatchObject({
          lit: true,
          stressState: 'burned',
          damageState: 'none',
          presentationState: 'destructive',
        });
        expect(damaged.current).toBeGreaterThan(0.3);
      } else {
        expect(damaged).toMatchObject({
          lit: false,
          current: 0,
          brightness: 0,
          deviceHealth: 'failed_open',
          damageState: 'failed',
          presentationState: 'failed',
        });
      }
      expect(result.ledTemporal).toBeDefined();
      // Same structural status adapter as the Worker; all solved component,
      // node and quality values remain the actual engine observation.
      const presented = { ...result, status: 'solved' } as SolveResult;
      const projected = presentation.accept(presented, result.ledTemporal);
      const healthy = projected.get('protected');
      expect(healthy).toBeGreaterThan(0);
      expect(projected.has('overdriven')).toBe(false);
      if (horizon < 4_000_000) {
        const peak = Math.max(
          ...result
            .ledTemporal!.components.find((component) => component.componentId === 'protected')!
            .samples.map((sample) => sample.brightness),
        );
        expect(healthy! / peak).toBeCloseTo(0.5, 2);
        expectedMean = healthy!;
      } else expect(healthy).toBeCloseTo(expectedMean, 8);
      state = done.state;
    }
  });

  it.each([2_000_000, 100_000, 50_000])(
    'preserves instantaneous visible phases of %i us',
    (half) => {
      const presentation = new LedTemporalPresentation();
      for (let from = 0; from < half * 4; from += 25_000) {
        const observation = window(from, from + 25_000, [square(from, from + 25_000, half)]);
        expect(presentation.accept(electrical(observation), observation).size).toBe(0);
      }
    },
  );

  it.each([1000, 16_666, 24_999])(
    'shows a steady measured cycle mean at %i us phases without a window beat',
    (half) => {
      const presentation = new LedTemporalPresentation();
      let from = 0;
      const terminalBrightness = new Set<number>();
      for (let index = 1; index <= 30; index++) {
        const to = from + [11_137, 24_923, 17_003][index % 3]!;
        const observation = window(from, to, [square(from, to, half)]);
        const result = electrical(observation);
        const mean = presentation.accept(result, observation).get('led');
        if (to > half * 5) expect(mean).toBeCloseTo(40, 10);
        terminalBrightness.add(result.components[0]!.brightness!);
        from = to;
      }
      expect([...terminalBrightness].sort()).toEqual([0, 80]);
    },
  );

  it('integrates unequal actual optical phases instead of averaging their states or current', () => {
    const samples = [point(0, 80)];
    for (let cycle = 0; cycle < 4; cycle++) {
      samples.push(point(cycle * 4000 + 1000, 0));
      samples.push(point((cycle + 1) * 4000, 80));
    }
    const observation = window(0, 16_000, [channel('led', samples)]);
    expect(
      new LedTemporalPresentation().accept(electrical(observation), observation).get('led'),
    ).toBe(20);
  });

  it('keeps a fast, a slow and a constant output independent', () => {
    const presentation = new LedTemporalPresentation();
    let from = 0;
    for (const to of [17_003, 41_997, 67_001, 90_007]) {
      const observation = window(from, to, [
        square(from, to, 1000, 80, 'fast'),
        square(from, to, 50_000, 60, 'slow'),
        channel('steady', [point(from, 30), point(to, 30)]),
      ]);
      const projection = presentation.accept(electrical(observation), observation);
      expect([...projection]).toEqual([['fast', 40]]);
      from = to;
    }
  });

  it.each([0, 80])(
    'replaces the previous average promptly after the output holds at %i',
    (level) => {
      const presentation = new LedTemporalPresentation();
      const fast = window(0, 10_000);
      expect(presentation.accept(electrical(fast), fast).get('led')).toBe(40);
      const held = window(10_000, 36_000, [
        channel('led', [point(10_000, 80), point(10_001, level), point(36_000, level)]),
      ]);
      expect(presentation.accept(electrical(held), held).size).toBe(0);
      expect(electrical(held).components[0]!.brightness).toBe(level);
    },
  );

  it('forgets history on reset and on missing or noncontiguous observations', () => {
    const presentation = new LedTemporalPresentation();
    const fast = window(0, 10_000);
    expect(presentation.accept(electrical(fast), fast).get('led')).toBe(40);
    presentation.reset();
    const short = window(0, 500);
    expect(presentation.accept(electrical(short), short).size).toBe(0);
    presentation.accept(electrical(fast), fast);
    presentation.accept(electrical(fast));
    const next = window(10_000, 10_500);
    expect(presentation.accept(electrical(next), next).size).toBe(0);
    presentation.accept(electrical(fast), fast);
    const gap = window(11_000, 11_500);
    expect(presentation.accept(electrical(gap), gap).size).toBe(0);
  });

  it.each(['reverse', 'burned', 'disconnected'])(
    'cannot override an actual %s electrical state',
    (failure) => {
      const observation = window(0, 10_000);
      const result = electrical(observation);
      const component = result.components[0]!;
      const changed =
        failure === 'reverse'
          ? { ...component, junctionState: 'reverse_blocking' }
          : failure === 'burned'
            ? { ...component, presentationState: 'failed', stressState: 'burned' }
            : { ...component, brightness: 0, current: 0 };
      expect(
        new LedTemporalPresentation().accept(
          { ...result, components: [changed] } as SolveResult,
          observation,
        ).size,
      ).toBe(0);
    },
  );

  it('retains the true cycle mean even when the bounded raw trace has overflowed', () => {
    const full = square(0, 2000, 1);
    const component = { ...full, truncated: true, samples: full.samples.slice(-512) };
    const observation = window(0, 2000, [component]);
    expect(component.transitionCount).toBe(2000);
    expect(
      new LedTemporalPresentation().accept(electrical(observation), observation).get('led'),
    ).toBe(40);
  });

  it.each([0, 80])(
    'expires a former fast cycle exactly 25,000 us after the last edge, held %i',
    (level) => {
      for (const age of [24_999, 25_000]) {
        const presentation = new LedTemporalPresentation();
        // End at the existing edge into the requested held state, so no programme
        // change or structural reset is invented at an already committed time.
        const lastEdge = level === 0 ? 11_000 : 10_000;
        const fast = window(0, lastEdge);
        presentation.accept(electrical(fast), fast);
        const held = window(lastEdge, lastEdge + age, [
          channel('led', [point(lastEdge, level), point(lastEdge + age, level)]),
        ]);
        const mean = presentation.accept(electrical(held), held).get('led');
        if (age === 24_999) expect(mean).toBe(40);
        else expect(mean).toBeUndefined();
      }
    },
  );

  it.each(['reverse', 'burned', 'disconnected'])(
    'keeps a healthy fast neighbour when a second LED is %s',
    (failure) => {
      const observation = window(0, 10_000, [
        square(0, 10_000, 1000, 80, 'healthy'),
        channel('other', [point(0, 0), point(10_000, 0)]),
      ]);
      const result = electrical(observation);
      const other = result.components[1]!;
      const state =
        failure === 'reverse'
          ? { junctionState: 'reverse_blocking' }
          : failure === 'burned'
            ? { presentationState: 'failed', stressState: 'burned' }
            : {};
      const projection = new LedTemporalPresentation().accept(
        { ...result, components: [result.components[0]!, { ...other, ...state }] } as SolveResult,
        observation,
      );
      expect([...projection]).toEqual([['healthy', 40]]);
    },
  );

  it.each(['nan', 'integral', 'order', 'duplicate', 'end', 'summary', 'profile'])(
    'rejects malformed %s metadata and clears old history',
    (kind) => {
      const presentation = new LedTemporalPresentation();
      const initial = window(0, 10_000);
      presentation.accept(electrical(initial), initial);
      const valid = window(10_000, 20_000);
      const malformed = structuredClone(valid);
      const component = malformed.components[0]!;
      if (kind === 'nan') Object.assign(component.samples[1]!, { brightness: NaN });
      if (kind === 'integral') Object.assign(component, { brightnessIntegral: -1 });
      if (kind === 'order') Object.assign(component.samples[1]!, { atMicroseconds: 9000 });
      if (kind === 'duplicate') Object.assign(malformed, { components: [component, component] });
      if (kind === 'end') Object.assign(component.samples.at(-1)!, { atMicroseconds: 19_999 });
      if (kind === 'summary') Object.assign(component, { transitionCount: 1 });
      if (kind === 'profile') Object.assign(malformed, { profile: 'invented' });
      expect(presentation.accept(electrical(valid), malformed).size).toBe(0);
      const next = window(20_000, 20_500);
      expect(presentation.accept(electrical(next), next).size).toBe(0);
    },
  );
});

describe('Arduino L and ordinary LED share one presentation cursor', () => {
  it('uses the shared cursor for both canonical and legacy Uno identities', () => {
    // Execute the production selector so a variant-only saved board cannot silently
    // fall back to the newer electrical result while its LED uses the older cursor.
    const source = ts.createSourceFile(
      'use-electronics-workbench.ts',
      readFileSync(new URL('../use-electronics-workbench.ts', import.meta.url), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const declarations: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isFunctionDeclaration(node) &&
        (node.name?.text === 'componentArduinoLActive' || node.name?.text === 'isArduinoUno')
      )
        declarations.push(node.getText(source));
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(declarations).toHaveLength(2);
    const state = {
      simulationRunning: true,
      liveObservation: { frame: { arduinoLStates: new Map([['uno', true]]) } } as {
        frame: { arduinoLStates: ReadonlyMap<string, boolean> };
      } | null,
    };
    const active = runInNewContext(
      ts.transpileModule(`${declarations.join('\n')}\ncomponentArduinoLActive;`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText,
      state,
    ) as (component: Record<string, unknown>) => boolean | undefined;
    const canonical = { id: 'uno', componentTypeId: 'arduino-uno' };
    const legacy = { id: 'uno', variantId: 'arduino-uno' };
    expect(active(canonical)).toBe(true);
    expect(active(legacy)).toBe(true);
    expect(active({ id: 'uno', componentTypeId: 'led-5mm' })).toBeUndefined();
    expect(active({ id: 'other-uno', variantId: 'arduino-uno' })).toBeUndefined();
    state.liveObservation = { frame: { arduinoLStates: new Map([['uno', false]]) } };
    expect(active(canonical)).toBe(false);
    expect(active(legacy)).toBe(false);
    state.simulationRunning = false;
    expect(active(legacy)).toBeUndefined();
    state.simulationRunning = true;
    state.liveObservation = null;
    expect(active(legacy)).toBeUndefined();
  });

  function indicatorWindow(
    from: number,
    to: number,
    edges: readonly [number, number][],
    external: 'connected' | 'dark' | 'absent',
  ): ElectronicsLedTemporalObservation {
    const samples = edges.map(([atMicroseconds, voltage]) => ({ atMicroseconds, voltage }));
    return {
      profile: 'ordinary-led-held-v1',
      fromMicroseconds: from,
      toMicroseconds: to,
      components:
        external === 'absent'
          ? []
          : [
              channel(
                'led',
                edges.map(([at, voltage]) =>
                  point(at, external === 'connected' && voltage >= 2.5 ? 80 : 0),
                ),
              ),
            ],
      arduinoIndicators: [{ componentId: 'uno', samples, truncated: false }],
    };
  }

  function solved(observation: ElectronicsLedTemporalObservation): SolveResult {
    const result = electrical(observation);
    return {
      ...result,
      components: [
        ...result.components,
        {
          componentId: 'uno',
          current: 0,
          voltageDrop: 0,
          lit: false,
          terminalVoltages: { d13: observation.arduinoIndicators![0]!.samples.at(-1)!.voltage },
        },
      ],
    };
  }

  it.each(['connected', 'dark', 'absent'] as const)(
    'presents solved D13 at the LED cursor with an external LED that is %s',
    (external) => {
      const presenter = new LedTemporalPresentation();
      const first = indicatorWindow(
        0,
        25_000,
        [
          [0, 0],
          [20_000, 5],
          [25_000, 5],
        ],
        external,
      );
      const canonical = solved(first);
      const before = JSON.stringify(canonical);
      presenter.accept(canonical, first, 0);
      drawUntil(presenter, 10_000);
      expect(presenter.arduinoLStates().get('uno')).toBe(false);
      const high = drawUntil(presenter, 21_000);
      expect(presenter.arduinoLStates().get('uno')).toBe(true);
      expect(high.get('led')).toBe(
        external === 'absent' ? undefined : external === 'connected' ? 80 : 0,
      );
      const second = indicatorWindow(
        25_000,
        50_000,
        [
          [25_000, 5],
          [40_000, 0],
          [50_000, 0],
        ],
        external,
      );
      presenter.accept(solved(second), second, 25_000);
      expect(presenter.arduinoLStates().get('uno')).toBe(true);
      const low = drawUntil(presenter, 41_000);
      expect(presenter.arduinoLStates().get('uno')).toBe(false);
      expect(low.get('led')).toBe(external === 'absent' ? undefined : 0);
      expect(JSON.stringify(canonical)).toBe(before);
      presenter.reset();
      expect(presenter.sample().size).toBe(0);
      expect(presenter.arduinoLStates().size).toBe(0);
    },
  );

  it('retains a solved dark reverse channel across junction changes without moving the D13 cursor', () => {
    const presenter = new LedTemporalPresentation();
    const first = indicatorWindow(
      0,
      25_000,
      [
        [0, 0],
        [10_000, 5],
        [25_000, 5],
      ],
      'dark',
    );
    const reverse = solved(first);
    Object.assign(
      reverse.components.find((entry) => entry.componentId === 'led')!,
      {
        junctionState: 'reverse_blocking',
      },
    );
    const originalReverse = JSON.stringify(reverse);
    presenter.accept(reverse, first, 0);
    drawUntil(presenter, 15_000);
    expect(presenter.arduinoLStates().get('uno')).toBe(true);

    const second = indicatorWindow(
      25_000,
      50_000,
      [
        [25_000, 5],
        [40_000, 0],
        [50_000, 0],
      ],
      'dark',
    );
    const forward = solved(second);
    Object.assign(
      forward.components.find((entry) => entry.componentId === 'led')!,
      {
        junctionState: 'forward_blocking',
      },
    );
    const originalForward = JSON.stringify(forward);
    // This complete LOW-ending window arrives while the joint cursor is still
    // before its from25ms boundary. The LED stayed physically dark in both windows;
    // its junction label cannot erase the earlier coverage or shorten D13 HIGH.
    presenter.accept(forward, second, 16_000);
    expect(presenter.presentedMicroseconds).toBe(15_000);
    expect(presenter.sample().get('led')).toBe(0);
    expect(presenter.arduinoLStates().get('uno')).toBe(true);
    expect(presenter.reanchorCount).toBe(0);
    expect(drawUntil(presenter, 39_999).get('led')).toBe(0);
    expect(presenter.arduinoLStates().get('uno')).toBe(true);
    expect(drawUntil(presenter, 40_000).get('led')).toBe(0);
    expect(presenter.arduinoLStates().get('uno')).toBe(false);
    expect(JSON.stringify(reverse)).toBe(originalReverse);
    expect(JSON.stringify(forward)).toBe(originalForward);
  });

  it('does not carry a former fast-cycle mean into a dark reverse window', () => {
    const presenter = new LedTemporalPresentation();
    // A LOW endpoint is a continuous join, but the older accepted samples still
    // contain light. A newly reverse-blocking channel cannot inherit that mean.
    const fast = window(0, 11_000);
    expect(presenter.accept(electrical(fast), fast).get('led')).toBe(40);
    const dark = window(11_000, 12_000, [channel('led', [point(11_000, 0), point(12_000, 0)])]);
    const reverse = electrical(dark);
    Object.assign(reverse.components[0]!, { junctionState: 'reverse_blocking' });
    expect(presenter.accept(reverse, dark).has('led')).toBe(false);
  });

  it.each(['brightness', 'positive current'] as const)(
    'does not admit a reverse channel with historical %s even when its endpoint is dark',
    (inconsistent) => {
      const presenter = new LedTemporalPresentation();
      const observation = indicatorWindow(
        0,
        25_000,
        [
          [0, 0],
          [10_000, 5],
          [20_000, 0],
          [25_000, 0],
        ],
        'dark',
      );
      const led = channel('led', [
        point(0, 0),
        inconsistent === 'brightness' ? point(10_000, 80) : { ...point(10_000, 0), current: 0.01 },
        point(20_000, 0),
        point(25_000, 0),
      ]);
      const changed = { ...observation, components: [led] };
      const result = solved(changed);
      Object.assign(
        result.components.find((entry) => entry.componentId === 'led')!,
        {
          junctionState: 'reverse_blocking',
        },
      );
      presenter.accept(result, changed, 0);
      expect(drawUntil(presenter, 15_000).has('led')).toBe(false);
      // Rejecting that LED must not invent a dependency for the independent board.
      expect(presenter.arduinoLStates().get('uno')).toBe(true);
    },
  );

  it('does not recover a dark external LED hold across unpresented D13 edges', () => {
    const presenter = new LedTemporalPresentation();
    const first = indicatorWindow(
      0,
      10_000,
      [
        [0, 0],
        [10_000, 0],
      ],
      'dark',
    );
    presenter.accept(solved(first), first, 0);
    drawUntil(presenter, 25_000);
    const second = indicatorWindow(
      10_000,
      60_000,
      [
        [10_000, 0],
        [20_000, 5],
        [40_000, 0],
        [60_000, 0],
      ],
      'dark',
    );
    presenter.accept(solved(second), second, 25_000);
    expect(presenter.arduinoLStates().get('uno')).toBe(false);
    expect(drawUntil(presenter, 35_000).get('led')).toBe(0);
    expect(presenter.arduinoLStates().get('uno')).toBe(true);
  });

  it('rejects indicator metadata that disagrees with the quality-passed solved voltage', () => {
    const presenter = new LedTemporalPresentation();
    const observation = indicatorWindow(
      0,
      25_000,
      [
        [0, 0],
        [20_000, 5],
        [25_000, 5],
      ],
      'connected',
    );
    const inconsistent = solved(observation);
    Object.assign(
      inconsistent.components.find((entry) => entry.componentId === 'uno')!.terminalVoltages,
      { d13: 0 },
    );
    expect(presenter.accept(inconsistent, observation, 0).size).toBe(0);
    expect(presenter.arduinoLStates().size).toBe(0);
  });
});

describe('ordinary LED native readiness and the shared host publication barrier', () => {
  const host = ts.createSourceFile(
    'use-electronics-workbench.ts',
    readFileSync(new URL('../use-electronics-workbench.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const names = new Set([
    'recordOpticalAssetReadiness',
    'opticalAssetLeasesReady',
    'matchingOpticalValues',
    'matchingNativeAssets',
    'restorableOpticalObservation',
  ]);
  const functions = host.statements.filter(
    (statement) =>
      ts.isFunctionDeclaration(statement) && statement.name && names.has(statement.name.text),
  );
  if (functions.length !== names.size)
    throw new Error('actual host optical barrier declarations not found');
  const barrier = runInNewContext(
    ts.transpileModule(
      functions.map((fn) => fn.getText(host)).join('\n') +
        '\n({ record: recordOpticalAssetReadiness, ready: opticalAssetLeasesReady, same: matchingOpticalValues, rollback: restorableOpticalObservation });',
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
    ).outputText,
    { sameOpticalFrame },
  ) as {
    record: (pending: unknown, event: unknown) => boolean;
    ready: (pending: unknown, active?: boolean) => boolean;
    same: (previous: unknown, frame: unknown, assets: unknown) => boolean;
    rollback: (previous: unknown) => unknown;
  };

  // Read the actual nested RAF, parent layout decision and prop selector. These
  // tests do not duplicate their branches in a second host implementation.
  const hostClosures = new Map<string, string>();
  const visitHost = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'presentLeds' &&
      node.initializer &&
      ts.isArrowFunction(node.initializer)
    )
      hostClosures.set('raf', node.initializer.getText(host));
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'useLayoutEffect' &&
      node.arguments[0] &&
      ts.isArrowFunction(node.arguments[0]) &&
      node.arguments[0].getText(host).includes('const publication = opticalPublicationRef.current;')
    )
      hostClosures.set('layout', node.arguments[0].getText(host));
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'rollbackComponentLedAsset')
      hostClosures.set('rollbackSelector', node.getText(host));
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'clearDisplayedObservation')
      hostClosures.set('clearDisplay', node.getText(host));
    ts.forEachChild(node, visitHost);
  };
  visitHost(host);
  if (hostClosures.size !== 4)
    throw new Error('actual host rollback/RAF closure declarations not found');

  function fixture() {
    const frame = {
      token: 'generation-4:frame-7',
      atMicroseconds: 20_000,
      brightness: new Map([
        ['red', 80],
        ['green', 60],
      ]),
      arduinoLStates: new Map([['uno', true]]),
    };
    const assets = new Map([
      ['red', '/real-red.svg'],
      ['green', '/real-green.svg'],
    ]);
    const pending = {
      frame,
      result: {},
      assets,
      readiness: new Map<string, ReturnType<typeof lease>>(),
    };
    function lease(componentId: string) {
      const state = { current: true, active: false };
      return {
        token: frame.token,
        componentId,
        asset: assets.get(componentId)!,
        href: assets.get(componentId)!,
        element: { componentId },
        bindingRevision: 2,
        status: 'ready',
        state,
        isCurrent: () => state.current,
        isActive: () => state.current && state.active,
      };
    }
    return { frame, assets, pending, red: lease('red'), green: lease('green') };
  }

  it('requires every actual pending asset before preparation and every promoted node before layout ACK', () => {
    const { pending, red, green } = fixture();
    expect(barrier.ready(pending)).toBe(false);
    expect(barrier.record(pending, red)).toBe(true);
    expect(barrier.ready(pending)).toBe(false);
    expect(barrier.record(pending, green)).toBe(true);
    expect(barrier.ready(pending)).toBe(true);
    expect(barrier.ready(pending, true)).toBe(false);
    red.state.active = true;
    expect(barrier.ready(pending, true)).toBe(false);
    green.state.active = true;
    expect(barrier.ready(pending, true)).toBe(true);
    green.state.current = false;
    expect(barrier.ready(pending)).toBe(false);
    expect(barrier.ready(pending, true)).toBe(false);
  });

  it.each(['token', 'componentId', 'asset'] as const)(
    'rejects a ready/error callback whose %s belongs to a different pending binding',
    (field) => {
      const { pending, red } = fixture();
      expect(barrier.record(pending, red)).toBe(true);
      expect(barrier.record(pending, { ...red, [field]: 'stale', status: 'error' })).toBe(false);
      expect(pending.readiness.get('red')).toBe(red);
      expect(barrier.record(null, red)).toBe(false);
    },
  );

  it.each(['error', 'invalidated', 'stale native node'] as const)(
    'revokes only the matching pending lease on %s without granting an ACK',
    (reason) => {
      const { pending, red, green } = fixture();
      barrier.record(pending, red);
      barrier.record(pending, green);
      if (reason === 'stale native node') red.state.current = false;
      const invalid = { ...red, status: reason === 'stale native node' ? 'ready' : reason };
      expect(barrier.record(pending, invalid)).toBe(true);
      expect(pending.readiness.has('red')).toBe(false);
      expect(pending.readiness.get('green')).toBe(green);
      expect(barrier.ready(pending)).toBe(false);
    },
  );

  it('permits cursor-only progress only while the exact complete optical vector and native resources remain active', () => {
    const { frame, assets, red, green } = fixture();
    red.state.active = true;
    green.state.active = true;
    const previous = {
      frame,
      ledAssets: new Map([
        ['red', red],
        ['green', green],
      ]),
    };
    expect(
      barrier.same(previous, { ...frame, token: 'later', atMicroseconds: 21_000 }, assets),
    ).toBe(true);
    expect(
      barrier.same(previous, { ...frame, arduinoLStates: new Map([['uno', false]]) }, assets),
    ).toBe(false);
    expect(
      barrier.same(
        previous,
        {
          ...frame,
          brightness: new Map([
            ['red', 0],
            ['green', 60],
          ]),
        },
        assets,
      ),
    ).toBe(false);
    expect(
      barrier.same(
        previous,
        frame,
        new Map([
          ['red', '/different.svg'],
          ['green', '/real-green.svg'],
        ]),
      ),
    ).toBe(false);
    red.state.current = false;
    expect(barrier.same(previous, frame, assets)).toBe(false);
  });
  function executeHostClosure(name: 'raf' | 'layout', state: Record<string, unknown>): void {
    const text = `${hostClosures.get('clearDisplay')!}\nconst presentLeds = ${hostClosures.get(name)!}; presentLeds();`;
    runInNewContext(
      ts.transpileModule(text, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText,
      state,
    );
  }

  it.each(['accepted', 'rejected', 'invalid previous'] as const)(
    'finishes the actual parent layout with explicit rollback cleanup when %s',
    (outcome) => {
      const { frame, pending, red, green } = fixture();
      red.state.active = green.state.active = true;
      barrier.record(pending, red);
      barrier.record(pending, green);
      const previous = {
        frame,
        ledAssets: new Map([
          ['red', red],
          ['green', green],
        ]),
      };
      if (outcome === 'invalid previous') green.state.current = false;
      const next = { frame: { ...frame, token: 'next' } };
      const acknowledgements: number[] = [],
        rollbacks: unknown[] = [],
        live: unknown[] = [],
        retries: unknown[] = [];
      const publication = {
        next,
        previous,
        pending,
        acknowledge: (wall: number) => {
          acknowledgements.push(wall);
          return outcome === 'accepted';
        },
        retry: (value: unknown) => retries.push(value),
      };
      const ref = { current: publication as typeof publication | null };
      executeHostClosure('layout', {
        opticalPublicationRef: ref,
        liveObservation: next,
        opticalAssetLeasesReady: barrier.ready,
        restorableOpticalObservation: barrier.rollback,
        window: { performance: { now: () => 123 } },
        setRollbackLedAssets: (value: unknown) => rollbacks.push(value),
        setLiveObservation: (value: unknown) => live.push(value),
      });
      expect(ref.current).toBeNull();
      expect(rollbacks).toEqual([null]);
      expect(acknowledgements).toEqual(outcome === 'invalid previous' ? [] : [123_000]);
      if (outcome === 'accepted') {
        expect(live).toEqual([]);
        expect(retries).toEqual([]);
      } else {
        expect(live.length).toBe(1);
        expect(retries.length).toBe(1);
        expect(live[0]).toBe(outcome === 'rejected' ? previous : null);
        expect(retries[0]).toBe(live[0]);
      }
    },
  );

  it('exposes only the unacknowledged publication previous leases and releases them after ACK or Stop', () => {
    const { red } = fixture();
    const assets = new Map([['red', red]]);
    const publication = { next: {}, previous: { ledAssets: assets } };
    const state = {
      simulationRunning: true,
      liveObservation: publication.next,
      opticalPublicationRef: { current: publication as typeof publication | null },
      rollbackLedAssets: assets,
    };
    const select = runInNewContext(
      ts.transpileModule(`${hostClosures.get('rollbackSelector')!}; rollbackComponentLedAsset;`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText,
      state,
    ) as (component: { id: string }) => unknown;
    expect(select({ id: 'red' })).toBe(red);
    expect(select({ id: 'other' })).toBeUndefined();
    state.rollbackLedAssets = new Map([['red', red]]);
    expect(select({ id: 'red' })).toBeUndefined();
    state.rollbackLedAssets = assets;
    state.liveObservation = {};
    expect(select({ id: 'red' })).toBeUndefined();
    state.liveObservation = publication.next;
    state.opticalPublicationRef.current = null;
    expect(select({ id: 'red' })).toBeUndefined();
    state.opticalPublicationRef.current = publication;
    state.simulationRunning = false;
    expect(select({ id: 'red' })).toBeUndefined();
  });

  it.each(['quality', 'unsolved', 'truncated coverage'] as const)(
    'clears the actual host vector after %s resets a presenter with no pending asset',
    (reason) => {
      const presenter = new LedTemporalPresentation();
      const initial = window(0, 25_000, [square(0, 25_000, 100_000)]);
      presenter.accept(electrical(initial), initial, 0);
      drawFrame(presenter, 0);
      const oldFrame = presenter.displayedFrame!;
      expect(oldFrame.brightness.get('led')).toBe(80);
      if (reason === 'truncated coverage') {
        const next = window(25_000, 50_000, [
          { ...square(25_000, 50_000, 100_000), truncated: true },
        ]);
        presenter.accept(electrical(next), next, 10_000);
      } else {
        const rejected = electrical(initial);
        if (reason === 'quality') rejected.quality!.passed = false;
        else rejected.solved = false;
        // Non-temporal ready endpoints can be unpowered/nonfatal. They are not
        // protected by the Arduino omitted-temporal failure branch.
        presenter.acceptSnapshot(rejected, 25_000);
      }
      const live: unknown[] = [],
        rollback: unknown[] = [],
        preparation: unknown[] = [];
      const state = {
        currentSession: () => true,
        animationFrame: null,
        session: { active: true },
        window: { requestAnimationFrame: () => 1, performance: { now: () => 30 } },
        ledPresentation: presenter,
        observeReanchor: () => {},
        pending: null,
        displayed: { frame: oldFrame },
        publishing: false,
        opticalPublicationRef: { current: null },
        latestResult: null,
        setLiveObservation: (value: unknown) => live.push(value),
        setRollbackLedAssets: (value: unknown) => rollback.push(value),
        setLedAssetPreparation: (value: unknown) => preparation.push(value),
      };
      executeHostClosure('raf', state);
      expect(presenter.displayedFrame).toBeNull();
      expect(state.displayed).toBeNull();
      expect(live).toEqual([null]);
      expect(rollback).toEqual([null]);
      expect(preparation).toEqual([null]);
      expect(state.pending).toBeNull();
    },
  );

  it('keeps a valid committed vector until the host can publish the next frame', () => {
    const presenter = new LedTemporalPresentation();
    const initial = window(0, 25_000, [
      channel('led', [point(0, 0), point(1, 80), point(25_000, 80)]),
    ]);
    presenter.accept(electrical(initial), initial, 0);
    drawFrame(presenter, 0);
    const previous = { frame: presenter.displayedFrame };
    const live: unknown[] = [],
      rollback: unknown[] = [];
    const state = {
      currentSession: () => true,
      animationFrame: null,
      session: { active: true },
      window: { requestAnimationFrame: () => 1, performance: { now: () => 17 } },
      ledPresentation: presenter,
      observeReanchor: () => {},
      pending: null,
      displayed: previous,
      publishing: false,
      latestResult: null,
      opticalPublicationRef: { current: null },
      setLiveObservation: (value: unknown) => live.push(value),
      setRollbackLedAssets: (value: unknown) => rollback.push(value),
    };
    executeHostClosure('raf', state);
    expect(state.displayed).toBe(previous);
    expect(presenter.displayedFrame).toBe(previous.frame);
    expect(live).toEqual([]);
    expect(rollback).toEqual([]);
  });
});
