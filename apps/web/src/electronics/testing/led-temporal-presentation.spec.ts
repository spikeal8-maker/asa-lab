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
import { LedTemporalPresentation } from '../led-temporal-presentation';

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
if (oracleDeclarations.length !== 5)
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
  return {
    frames,
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
    expect(
      oracle.paint(oraclePaint([frame], 250.001, [0, 80, 0]), 'analytic', 1, 0).violations,
    ).toHaveLength(1);
  });

  it('rejects individually present light values that never coexist at one time', () => {
    const neverJoint = window(0, 25_000, [
      channel('led0', [point(0, 80), point(12_500, 0), point(25_000, 0)]),
      channel('led1', [point(0, 0), point(12_500, 80), point(25_000, 80)]),
      channel('led2', [point(0, 0), point(25_000, 0)]),
    ]);
    expect(oracle.joint(oracleFrame(neverJoint), [80, 80, 0])).toBeUndefined();
    expect(
      oracle.paint(oraclePaint([oracleFrame(neverJoint)], 30, [80, 80, 0]), 'analytic', 1, 0)
        .violations,
    ).toHaveLength(1);
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
    expect(
      oracle.paint(oraclePaint([future], 215, [0, 80, 0]), 'analytic', 1, 0).violations,
    ).toHaveLength(1);
    const old = oracleFrame(observation);
    const active = {
      ...future,
      requestAt: 210,
      source: 'changed',
      generationId: 2,
      responseGenerationId: 2,
    };
    expect(
      oracle.paint(oraclePaint([old, active], 215, [0, 80, 0]), 'analytic', 1, 0).violations,
    ).toHaveLength(1);
  });
});

describe('accepted per-LED temporal presentation', () => {
  it('recovers only counted constant joint hold time and keeps a later edge at its actual cursor', () => {
    const presentation = new LedTemporalPresentation();
    const receive = (from: number, to: number, wall: number, edge?: number) => {
      const observation = window(from, to, [
        channel('first', [
          point(from, 80),
          ...(edge !== undefined ? [point(edge, 0)] : []),
          ...(to !== from ? [point(to, edge === undefined ? 80 : 0)] : []),
        ]),
        channel('other', [point(from, 60), ...(to !== from ? [point(to, 60)] : [])]),
      ]);
      return presentation.accept(electrical(observation), observation, wall);
    };
    receive(0, 0, 0);
    receive(0, 5000, 30_000);
    presentation.sample(50_000);
    expect([...receive(5000, 25_000, 60_000).values()]).toEqual([80, 60]);
    expect(presentation.heldRecoveryCount).toBe(1);
    expect(presentation.heldRecoveredMicroseconds).toBe(10_000);
    // The next complete window contains a real edge. The desired clock cannot
    // pull it forward through the unchanged prefix at cursor25.002ms.
    expect(receive(25_000, 50_000, 60_002, 30_000).get('first')).toBe(80);
    expect(presentation.sample(64_999).get('first')).toBe(80);
    expect(presentation.heldRecoveryCount).toBe(1);
    expect(presentation.heldRecoveredMicroseconds).toBe(10_000);
    expect(presentation.sample(65_000).get('first')).toBe(0);
    // After ordinary1x pacing crosses the real front, the new constant LOW
    // interval may recover its own held time. The front itself was not skipped.
    expect(presentation.heldRecoveryCount).toBe(2);
    expect(presentation.heldRecoveredMicroseconds).toBe(20_000);
    expect(presentation.reanchorCount).toBe(0);
  });

  it.each(['neighbour edge', 'reverted edge', 'current only', 'truncated', 'missing prefix'])(
    'cannot recover clamp debt across a %s even when final brightness matches',
    (reason) => {
      const presentation = new LedTemporalPresentation();
      let from = 0;
      const receive = (to: number, wall: number) => {
        let other = channel('other', [
          point(from, 80),
          ...(from === 5000 && reason === 'neighbour edge' ? [point(20_000, 0)] : []),
          ...(from === 5000 && reason === 'reverted edge'
            ? [point(20_000, 0), point(21_000, 80)]
            : []),
          ...(to !== from
            ? [point(to, reason === 'neighbour edge' && from === 5000 ? 0 : 80)]
            : []),
        ]);
        if (from === 5000 && reason === 'current only')
          other = channel('other', [
            point(from, 80),
            { ...point(20_000, 80), current: 0.011 },
            { ...point(to, 80), current: 0.011 },
          ]);
        if (from === 5000 && reason === 'truncated') other = { ...other, truncated: true };
        if (from === 5000 && reason === 'missing prefix')
          other = {
            ...other,
            truncated: true,
            samples: [point(20_000, 80), point(to, 80)],
          };
        const observation = window(from, to, [
          channel('first', [point(from, 60), ...(to !== from ? [point(to, 60)] : [])]),
          other,
        ]);
        presentation.accept(electrical(observation), observation, wall);
        from = to;
      };
      receive(0, 0);
      receive(5000, 30_000);
      presentation.sample(50_000);
      receive(25_000, 60_000);
      expect(presentation.heldRecoveryCount).toBe(0);
      expect(presentation.heldRecoveredMicroseconds).toBe(0);
      expect(presentation.reanchorCount).toBe(reason === 'missing prefix' ? 1 : 0);
    },
  );

  it.each(['reset', 'quality', 'generation'])(
    'clears the desired epoch and coverage on %s without hiding lifetime recovery accounting',
    (reason) => {
      const presentation = new LedTemporalPresentation();
      const receive = (from: number, to: number, wall: number) => {
        const observation = window(from, to, [
          channel('led', [point(from, 80), ...(to !== from ? [point(to, 80)] : [])]),
        ]);
        presentation.accept(electrical(observation), observation, wall);
      };
      receive(0, 0, 0);
      receive(0, 5000, 30_000);
      presentation.sample(50_000);
      receive(5000, 25_000, 60_000);
      expect(presentation.heldRecoveredMicroseconds).toBe(10_000);
      if (reason === 'reset') presentation.reset();
      if (reason === 'quality') {
        const invalid = window(25_000, 25_000, [channel('led', [point(25_000, 80)])]);
        const result = electrical(invalid);
        result.quality!.passed = false;
        presentation.accept(result, invalid, 70_000);
      }
      const seed = window(0, 0, [channel('led', [point(0, 0)])]);
      presentation.accept(electrical(seed), seed, 1_000_000);
      const partial = window(0, 5000, [
        channel('led', [point(0, 0), point(4000, 80), point(5000, 80)]),
      ]);
      expect(presentation.accept(electrical(partial), partial, 1_001_000).get('led')).toBe(0);
      expect(presentation.sample(1_004_000).get('led')).toBe(80);
      expect(presentation.heldRecoveryCount).toBe(1);
      expect(presentation.heldRecoveredMicroseconds).toBe(10_000);
      expect(presentation.reanchorCount).toBe(0);
    },
  );

  it('replays original ed14 100ms startup debt and the first three real fronts without a reanchor', () => {
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
        display = presentation.accept(electrical(observation), observation, event.at);
        from = event.to;
      } else display = presentation.sample(event.at);
      const lit = display.get('led0')! > 0;
      if (!states.length || states.at(-1) !== lit) states.push(lit);
      expect(presentation.reanchorCount).toBe(0);
    }
    expect(states).toEqual([false, true, false, true, false]);
    expect(presentation.heldRecoveryCount).toBeGreaterThan(0);
    expect(presentation.heldRecoveredMicroseconds).toBeGreaterThan(0);
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
    'paces the saved393 $name startup receipts and RAFs without a reanchor',
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
          display = presentation.accept(electrical(observation), observation, event.at);
          from = to;
        } else display = presentation.sample(event.at);
        const receivedHigh = event.at >= Math.round(ready[1]![0]! * 1000);
        expect([...display.values()]).toEqual(
          edges.map((edge) => (receivedHigh && edge !== null ? 70.02 : 0)),
        );
        expect(presentation.reanchorCount).toBe(0);
      }
    },
  );

  it('paces partial completed startup at1x and holds its actual end on underrun', () => {
    const presentation = new LedTemporalPresentation();
    const seed = window(0, 0, [channel('led', [point(0, 0)])]);
    presentation.accept(electrical(seed), seed, 0);
    const partial = window(0, 3400, [
      channel('led', [
        point(0, 0),
        point(3, 80),
        point(1000, 60),
        point(2000, 40),
        point(3400, 20),
      ]),
    ]);
    // The whole actual trace is available at wall2, but its future edges must
    // not be painted before the common cursor reaches them at wall1x.
    expect(presentation.accept(electrical(partial), partial, 2).get('led')).toBe(0);
    for (const [wall, value] of [
      [3, 80],
      [999, 80],
      [1000, 60],
      [1999, 60],
      [2000, 40],
      [3399, 40],
      [3400, 20],
      [20_000, 20],
    ])
      expect(presentation.sample(wall!).get('led')).toBe(value);
    expect(presentation.reanchorCount).toBe(0);
  });

  it('does not discard elapsed phase time when progressed startup first obtains25ms head', () => {
    const presentation = new LedTemporalPresentation();
    const seed = window(0, 0, [channel('led', [point(0, 0)])]);
    presentation.accept(electrical(seed), seed, 0);
    const partial = window(0, 10_000, [
      channel('led', [point(0, 0), point(3, 80), point(10_000, 80)]),
    ]);
    expect(presentation.accept(electrical(partial), partial, 10_000).get('led')).toBe(80);
    const full = window(10_000, 35_000, [
      channel('led', [point(10_000, 80), point(15_000, 0), point(25_000, 80), point(35_000, 80)]),
    ]);
    expect(presentation.accept(electrical(full), full, 20_000).get('led')).toBe(0);
    expect(presentation.sample(24_999).get('led')).toBe(0);
    expect(presentation.sample(25_000).get('led')).toBe(80);
    expect(presentation.reanchorCount).toBe(0);
  });

  it('keeps independent50/100ms phases at1x after partial startup joins buffered playout', () => {
    const presentation = new LedTemporalPresentation();
    const ready = [
      [0, 0],
      [10_000, 10_000],
      [20_000, 35_000],
    ];
    for (let to = 60_000; to <= 210_000; to += 25_000) ready.push([to - 15_000, to]);
    const boundaries = [
      [49_999, 80, 60],
      [50_000, 0, 60],
      [99_999, 0, 60],
      [100_000, 80, 0],
      [149_999, 80, 0],
      [150_000, 0, 0],
      [199_999, 0, 0],
      [200_000, 80, 60],
    ];
    const events = [
      ...ready.map(([at, to]) => ({ at: at!, to, expected: undefined })),
      ...boundaries.map(([at, first, other]) => ({
        at: at!,
        to: undefined,
        expected: [first, other],
      })),
    ].sort((left, right) => left.at - right.at);
    let from = 0;
    for (const event of events) {
      if (event.to !== undefined) {
        const observation = window(from, event.to, [
          square(from, event.to, 50_000, 80, 'first'),
          square(from, event.to, 100_000, 60, 'other'),
        ]);
        presentation.accept(electrical(observation), observation, event.at);
        from = event.to;
      } else {
        expect([...presentation.sample(event.at).values()]).toEqual(event.expected);
      }
      expect(presentation.reanchorCount).toBe(0);
    }
  });

  it.each(['reset', 'quality', 'generation'])(
    'rearms partial startup pacing after %s clears an already primed generation',
    (reason) => {
      const presentation = new LedTemporalPresentation();
      const primed = window(0, 25_000, [square(0, 25_000, 50_000)]);
      presentation.accept(electrical(primed), primed, 0);
      if (reason === 'reset') presentation.reset();
      if (reason === 'quality') {
        const result = electrical(primed);
        result.quality!.passed = false;
        expect(presentation.accept(result, primed, 80_000).size).toBe(0);
      }
      const seed = window(0, 0, [channel('led', [point(0, 0)])]);
      presentation.accept(electrical(seed), seed, 100_000);
      const partial = window(0, 3400, [
        channel('led', [point(0, 0), point(3, 80), point(3400, 80)]),
      ]);
      expect(presentation.accept(electrical(partial), partial, 127_000).get('led')).toBe(80);
      expect(presentation.reanchorCount).toBe(0);
    },
  );

  it.each([15_000, 17_000])(
    'paces 50ms phases with a %i us burst gap or reports the bounded discontinuity',
    (gap) => {
      const presentation = new LedTemporalPresentation();
      // A window for the independent neighbour must describe its exact edge.
      const receiveWindow = (from: number, to: number, wall: number) => {
        const observation = window(from, to, [
          square(from, to, 50_000, 80, 'first'),
          square(from, to, 100_000, 60, 'other'),
        ]);
        return presentation.accept(electrical(observation), observation, wall);
      };
      // LOW is inside ready100, but that window closes HIGH. Supersession is
      // receipt90/92 itself: at124.999 its age34.999/32.999ms lies either side
      // of the unchanged33.333ms pre-RAF allowance.
      expect(receiveWindow(0, 25_000, 25_000).get('first')).toBe(80);
      receiveWindow(25_000, 50_000, 50_000);
      expect(receiveWindow(50_000, 75_000, 75_000).get('first')).toBe(0);
      expect(receiveWindow(75_000, 100_000, 75_000 + gap).get('first')).toBe(0);
      receiveWindow(100_000, 125_000, 115_000);
      expect(presentation.sample(124_999).get('first')).toBe(gap === 17_000 ? 0 : 80);
      expect([...presentation.sample(125_000)]).toEqual([
        ['first', 80],
        ['other', 0],
      ]);
      expect(presentation.reanchorCount).toBe(gap === 17_000 ? 0 : 1);
    },
  );

  it('witnesses the joint190ms vector inside ready200 rather than the old final75ms vector', () => {
    const presentation = new LedTemporalPresentation();
    let lastMatchingFinal = -1;
    for (let to = 0; to <= 200_000; to += 25_000) {
      const from = Math.max(0, to - 25_000);
      const observation = window(from, to, [
        square(from, to, 50_000, 80, 'led0'),
        channel(
          'led1',
          square(from + 10_000, to + 10_000, 100_000).samples.map((sample) => ({
            ...sample,
            atMicroseconds: sample.atMicroseconds - 10_000,
          })),
        ),
        square(from, to, 100_000, 0, 'led2'),
      ]);
      const result = electrical(observation);
      if (result.components.every((component, index) => component.brightness === [0, 80, 0][index]))
        lastMatchingFinal = to;
      presentation.accept(result, observation, to);
    }
    expect(lastMatchingFinal).toBe(75_000);
    expect([...presentation.sample(215_000).values()]).toEqual([0, 80, 0]);
    expect(presentation.reanchorCount).toBe(0);
  });

  it('rejects individually recent channels when their joint state is genuinely stale', () => {
    const presentation = new LedTemporalPresentation();
    let from = 0;
    const receive = (to: number, wall: number) => {
      const times = [from, ...[250_000, 275_000, 325_000].filter((at) => at > from && at < to)];
      if (to !== from) times.push(to);
      const observation = window(
        from,
        to,
        [0, 1, 2].map((index) =>
          channel(
            `led${index}`,
            times.map((at) => {
              const brightness =
                index === 0
                  ? at >= 250_000 && at < 325_000
                    ? 80
                    : 0
                  : index === 1
                    ? at < 250_000 || (at >= 275_000 && at < 325_000)
                      ? 80
                      : 0
                    : 0;
              return point(at, brightness);
            }),
          ),
        ),
      );
      presentation.accept(electrical(observation), observation, wall);
      from = to;
    };
    for (let to = 0; to <= 200_000; to += 25_000) receive(to, to);
    presentation.sample(215_000);
    for (const [to, wall] of [
      [225_000, 216_000],
      [250_000, 217_000],
      [275_000, 218_000],
      [300_000, 248_000],
      [325_000, 249_000],
      [350_000, 250_000],
    ])
      receive(to!, wall!);
    // A=0 arrived250ms, B=80 arrived249ms, but they never coexist after250ms
    // model time. The last joint receipt217ms already closes a different vector.
    expect([...presentation.sample(250_333).values()]).toEqual([0, 80, 0]);
    expect(presentation.reanchorCount).toBe(0);
    expect([...presentation.sample(250_334).values()]).toEqual([0, 0, 0]);
    expect(presentation.reanchorCount).toBe(1);
  });

  it('expires an intermediate-only witness at its own receipt even with no later receipt', () => {
    const presentation = new LedTemporalPresentation();
    for (let to = 0; to <= 150_000; to += 25_000) {
      const from = Math.max(0, to - 25_000);
      const observation = window(from, to, [square(from, to, 50_000)]);
      presentation.accept(electrical(observation), observation, 0);
    }
    // Ready150 contains HIGH125..150, closes LOW, and is the last receipt.
    expect(presentation.sample(33_333).get('led')).toBe(80);
    expect(presentation.reanchorCount).toBe(0);
    expect(presentation.sample(33_334).get('led')).toBe(0);
    expect(presentation.reanchorCount).toBe(1);
  });

  it.each(['quality', 'unsolved', 'generation', 'failure'])(
    'cannot retain old joint receipt authority after %s invalidation',
    (reason) => {
      const presentation = new LedTemporalPresentation();
      const old = window(0, 25_000, [square(0, 25_000, 50_000)]);
      presentation.accept(electrical(old), old, 0);
      const fresh = window(reason === 'generation' ? 0 : 25_000, 50_000, [
        channel('led', [point(reason === 'generation' ? 0 : 25_000, 0), point(50_000, 0)]),
      ]);
      const result = electrical(fresh);
      if (reason === 'quality')
        Object.assign(result, { quality: { ...result.quality!, passed: false } });
      if (reason === 'unsolved') Object.assign(result, { solved: false });
      if (reason === 'failure')
        Object.assign(result.components[0]!, { presentationState: 'failed' });
      const display = presentation.accept(result, fresh, 10_000);
      if (reason === 'generation') expect(display.get('led')).toBe(0);
      else expect(display.size).toBe(0);
      expect([...presentation.sample(11_000).values()]).not.toContain(80);
    },
  );

  it('holds computed data on underrun and reports an optical discontinuity before stale replay', () => {
    const presentation = new LedTemporalPresentation();
    const first = window(0, 25_000, [square(0, 25_000, 50_000)]);
    presentation.accept(electrical(first), first, 0);
    expect(presentation.sample(80_000).get('led')).toBe(80);
    for (let from = 25_000; from < 150_000; from += 25_000) {
      const observation = window(from, from + 25_000, [square(from, from + 25_000, 50_000)]);
      presentation.accept(electrical(observation), observation, 80_000);
    }
    expect(presentation.sample(80_001).get('led')).toBe(80);
    expect(presentation.sample(113_334).get('led')).toBe(0);
    expect(presentation.sample(155_000).get('led')).toBe(0);
    expect(presentation.reanchorCount).toBe(1);
    presentation.reset();
    expect(presentation.sample(114_000).size).toBe(0);
  });

  it('retains the original25ms rebuffer hold after a genuine bounded overrun', () => {
    const presentation = new LedTemporalPresentation();
    const first = window(0, 25_000, [square(0, 25_000, 50_000)]);
    presentation.accept(electrical(first), first, 0);
    presentation.sample(80_000);
    for (let from = 25_000; from < 150_000; from += 25_000) {
      const observation = window(from, from + 25_000, [square(from, from + 25_000, 50_000)]);
      presentation.accept(electrical(observation), observation, 80_000);
    }
    expect(presentation.sample(113_334).get('led')).toBe(0);
    // This LOW still has a fresh final witness. Continuing to155ms reaches
    // a superseded HIGH and forces the unchanged bounded reanchor to ready150.
    expect(presentation.reanchorCount).toBe(0);
    expect(presentation.sample(155_000).get('led')).toBe(0);
    expect(presentation.reanchorCount).toBe(1);
    const partial = window(150_000, 160_000, [
      channel('led', [point(150_000, 0), point(150_001, 80), point(160_000, 80)]),
    ]);
    expect(presentation.accept(electrical(partial), partial, 155_666).get('led')).toBe(0);
    expect(presentation.sample(161_666).get('led')).toBe(0);
    const full = window(160_000, 175_000, [
      channel('led', [point(160_000, 80), point(175_000, 80)]),
    ]);
    expect(presentation.accept(electrical(full), full, 162_666).get('led')).toBe(0);
    expect(presentation.sample(162_667).get('led')).toBe(80);
    expect(presentation.reanchorCount).toBe(1);
  });

  it('never samples a future edge and preserves the existing fast-cycle mean at the cursor', () => {
    const presentation = new LedTemporalPresentation();
    const observation = window(0, 25_000);
    presentation.accept(electrical(observation), observation, 0);
    expect(presentation.sample(999).get('led')).toBe(80);
    expect(presentation.sample(1000).get('led')).toBe(0);
    expect(presentation.sample(5000).get('led')).toBe(40);
    expect(presentation.reanchorCount).toBe(0);
  });

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
