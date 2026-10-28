import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
  createElectronicsAdvanceSession,
  parseElectronicsEngineDocument,
  type ElectronicsLedTemporalComponent,
  type ElectronicsLedTemporalObservation,
} from '@asa-lab/electronics/engine';
import { LedTemporalPresentation, sameOpticalFrame } from '../led-temporal-presentation';
import { NativeOpticalPresentation } from '../native-optical-presentation';
import type { SolveResult } from '../../api';

let result: SolveResult;
let observation: ElectronicsLedTemporalObservation;
const segments = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
function channel(
  componentId: string,
  samples: ElectronicsLedTemporalComponent['samples'],
): ElectronicsLedTemporalComponent {
  let brightnessIntegral = 0,
    litDurationMicroseconds = 0,
    transitionCount = 0;
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1]!;
    const next = samples[i]!;
    const duration = next.atMicroseconds - previous.atMicroseconds;
    brightnessIntegral += previous.brightness * duration;
    if (previous.brightness > 0) litDurationMicroseconds += duration;
    if (previous.brightness !== next.brightness) transitionCount++;
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
function create(input = result, history = observation) {
  const p = new LedTemporalPresentation();
  p.accept(input, history, 0);
  const initial = p.prepareInitialFrame() ?? p.prepareFrame(0);
  expect(initial).not.toBeNull();
  p.acknowledgeFrame(initial!, 0);
  return p;
}
beforeAll(() => {
  const saved = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          '../../../../../docs/product/electronics/examples/arduino-seven-segment-matrix/npn-4-before.json.gz',
          import.meta.url,
        ),
      ),
    ).toString('utf8'),
  ) as { document: unknown };
  const parsed = parseElectronicsEngineDocument(saved.document);
  if (!parsed.ok) throw new Error(parsed.message);
  const session = createElectronicsAdvanceSession(
    parsed.document,
    { requestedHorizonMicroseconds: 30000 },
    { observeSevenSegmentTemporal: true },
  );
  try {
    let value;
    do {
      value = session.step();
    } while (!value);
    if (value.executionStatus !== 'ready') throw new Error(JSON.stringify(value.diagnostics));
    result = { ...value.observation, status: 'solved' } as unknown as SolveResult;
    observation = value.observation.ledTemporal!;
  } finally {
    session.dispose();
  }
});

describe('raw display optical admission and joint native cursor', () => {
  it('projects all four physical glyphs at measured duty without altering electrical results', () => {
    const bytes = JSON.stringify(result);
    const p = create();
    const frame = p.prepareFrame(30000)!;
    expect(frame.sevenSegmentBrightness?.size).toBe(4);
    for (const [index, pattern] of ['bc', 'abdeg', 'abcdg', 'bcfg'].entries())
      for (const segment of segments) {
        const value = frame.sevenSegmentBrightness!.get('display-' + index)![segment]!;
        expect(value > 0).toBe(pattern.includes(segment));
        const branch = observation.sevenSegments![index]!.branches.find(
          (branch) => branch.componentId === segment,
        )!;
        const peak = Math.max(...branch.samples.map((sample) => sample.brightness));
        if (peak > 0) {
          expect(value).toBeGreaterThan(peak * 0.22);
          expect(value).toBeLessThan(peak * 0.27);
          expect(Math.abs(value - branch.brightnessIntegral / 30000)).toBeLessThan(peak * 0.05);
        }
      }
    expect(JSON.stringify(result)).toBe(bytes);
  });
  it('uses segment values in frame equality and waits for every displayed digit before acknowledgment', () => {
    const frame = create().prepareFrame(30000)!;
    const changed = { ...frame, sevenSegmentBrightness: new Map(frame.sevenSegmentBrightness) };
    changed.sevenSegmentBrightness.set('display-0', {
      ...changed.sevenSegmentBrightness.get('display-0'),
      b: 0,
    });
    expect(sameOpticalFrame(frame, changed)).toBe(false);
    const port = new NativeOpticalPresentation();
    let commits = 0;
    port.setBarrier(() => commits++);
    port.setObservation({ result, frame, ledAssets: new Map() }, true);
    const snapshot = port.getSnapshot();
    for (let i = 0; i < 3; i++) port.rendered('display-' + i, snapshot);
    port.afterLayout(snapshot);
    expect(commits).toBe(0);
    port.rendered('display-3', snapshot);
    port.afterLayout(snapshot);
    expect(commits).toBe(1);
    expect(port.getSnapshot().committed).toBeNull();
  });
  it.each([
    'missing-display',
    'missing-dp',
    'duplicate-display',
    'duplicate-branch',
    'nonfinite',
    'wrong-endpoint',
    'bad-integral',
    'null-branch',
    'sparse-branches',
  ] as const)('rejects %s rather than claiming complete optical coverage', (fault) => {
    const history = structuredClone(observation);
    const displays = history.sevenSegments! as {
      componentId: string;
      branches: ElectronicsLedTemporalComponent[];
    }[];
    if (fault === 'missing-display') displays.pop();
    if (fault === 'missing-dp') displays[0]!.branches.pop();
    if (fault === 'duplicate-display') displays[1]!.componentId = displays[0]!.componentId;
    if (fault === 'duplicate-branch') displays[0]!.branches[7] = displays[0]!.branches[0]!;
    if (fault === 'nonfinite')
      displays[0]!.branches[0] = { ...displays[0]!.branches[0]!, brightnessIntegral: Number.NaN };
    if (fault === 'wrong-endpoint') {
      const b = displays[0]!.branches[0]!;
      displays[0]!.branches[0] = channel(
        b.componentId,
        b.samples.map((sample, i) =>
          i === b.samples.length - 1 ? { ...sample, current: 0.01 } : sample,
        ),
      );
    }
    if (fault === 'bad-integral')
      displays[0]!.branches[0] = { ...displays[0]!.branches[0]!, brightnessIntegral: 100 };
    if (fault === 'null-branch')
      displays[0]!.branches[0] = null as unknown as ElectronicsLedTemporalComponent;
    if (fault === 'sparse-branches')
      displays[0]!.branches = Array(8) as ElectronicsLedTemporalComponent[];
    const p = create();
    p.accept(result, history, 30000);
    expect(p.prepareFrame(30000)).toBeNull();
    expect(p.displayedFrame).toBeNull();
  });
  it('retains the prior legitimate cursor but kills old mean emission at explicit whole-display thermal failure', () => {
    const history = structuredClone(observation);
    const display = history.sevenSegments![0]!;
    const branches = display.branches.map((branch) =>
      channel(branch.componentId, [
        ...branch.samples.filter((sample) => sample.atMicroseconds < 18000),
        { atMicroseconds: 18000, brightness: 0, current: 0 },
        { atMicroseconds: 30000, brightness: 0, current: 0 },
      ]),
    );
    const failed = {
      ...history,
      sevenSegments: history.sevenSegments!.map((entry, i) =>
        i === 0 ? { ...entry, branches, failedAtMicroseconds: 20000 } : entry,
      ),
    };
    const endpoint = {
      ...result,
      components: result.components.map((component) =>
        component.componentId === 'display-0'
          ? {
              ...component,
              deviceHealth: 'failed_open' as const,
              damageState: 'failed' as const,
              branchBrightness: Object.fromEntries(segments.map((s) => [s, 0])),
              branchCurrents: Object.fromEntries(segments.map((s) => [s, 0])),
            }
          : component,
      ),
    };
    const p = create(endpoint, failed);
    const earlier = p.prepareFrame(19000)!;
    expect(earlier.sevenSegmentBrightness!.get('display-0')!.b).toBeGreaterThan(0);
    p.acknowledgeFrame(earlier, 19000);
    const frame = p.prepareFrame(20000)!;
    expect(
      Object.values(frame.sevenSegmentBrightness!.get('display-0')!).every((value) => value === 0),
    ).toBe(true);
    expect(frame.sevenSegmentBrightness!.get('display-1')!.a).toBeGreaterThan(0);
    const missing = new LedTemporalPresentation();
    missing.accept(
      endpoint,
      {
        ...failed,
        sevenSegments: failed.sevenSegments!.map((entry, i) =>
          i === 0 ? { componentId: entry.componentId, branches: entry.branches } : entry,
        ),
      },
      0,
    );
    expect(missing.prepareFrame(30000)).toBeNull();
  });
  it('rejects nonfinite or out-of-window failed-health timestamps', () => {
    for (const failedAtMicroseconds of [Number.NaN, -1, 30001]) {
      const history = {
        ...observation,
        sevenSegments: observation.sevenSegments!.map((entry, i) =>
          i === 0 ? { ...entry, failedAtMicroseconds } : entry,
        ),
      };
      const p = create();
      p.accept(result, history, 30000);
      expect(p.prepareFrame(30000)).toBeNull();
    }
  });
  it('expires a normal constant-zero tail without inventing per-branch damage or retaining an old cycle forever', () => {
    const display = observation.sevenSegments![0]!;
    const branches = display.branches.map((branch) =>
      channel(branch.componentId, [
        ...branch.samples.filter((sample) => sample.atMicroseconds < 30000),
        { atMicroseconds: 30000, brightness: 0, current: 0 },
        { atMicroseconds: 60000, brightness: 0, current: 0 },
      ]),
    );
    const history = {
      ...observation,
      toMicroseconds: 60000,
      sevenSegments: [{ ...display, branches }],
    };
    const endpoint = {
      ...result,
      components: result.components
        .filter(
          (component) =>
            !component.componentId.startsWith('display-') || component.componentId === 'display-0',
        )
        .map((component) =>
          component.componentId === 'display-0'
            ? {
                ...component,
                branchBrightness: Object.fromEntries(segments.map((s) => [s, 0])),
                branchCurrents: Object.fromEntries(segments.map((s) => [s, 0])),
              }
            : component,
        ),
    };
    const p = create(endpoint, history);
    const frame = p.prepareFrame(60000)!;
    expect(
      Object.values(frame.sevenSegmentBrightness!.get('display-0')!).every((value) => value === 0),
    ).toBe(true);
  });
  it('clears segment history and proposed frames on reset and does not carry it into static snapshots', () => {
    const p = create();
    expect(p.prepareFrame(30000)?.sevenSegmentBrightness?.size).toBe(4);
    p.reset();
    expect(p.preparedFrame).toBeNull();
    expect(p.displayedFrame).toBeNull();
    p.acceptSnapshot(result, 30000);
    expect(p.prepareFrame(30000)?.sevenSegmentBrightness).toBeUndefined();
  });
});
