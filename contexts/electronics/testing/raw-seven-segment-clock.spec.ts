import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElectronicsAdvanceSession } from '../engine.js';
import { parseElectronicsDocument } from '../domain/document.js';
import { createArduinoOperatingPointReuse, solveCircuitWithHeldArduino } from '../domain/solver.js';
import { arduinoSnapshotFromState } from '../domain/arduino-model.js';
import {
  SEVEN_SEGMENT_LED_PROFILE,
  SEVEN_SEGMENT_TERMINALS,
  SEVEN_SEGMENT_COMMON_TERMINALS,
} from '../domain/led-model.js';
import {
  advanceArduinoCircuitClock,
  createArduinoCircuitClockExecutor,
  type ArduinoCircuitClockState,
} from '../domain/arduino-circuit-scheduler.js';
import {
  OWNER_HIGH_WRITES,
  RAW_DISPLAY_DIGITS,
  RAW_DISPLAY_SEGMENTS,
  rawDisplayCircuit,
  rawDisplaySource,
} from './fixtures/raw-seven-segment.js';

function through(
  document: ReturnType<typeof rawDisplayCircuit>,
  target: number,
  budget = 256,
  json = false,
) {
  let state: ArduinoCircuitClockState | undefined;
  const events: unknown[] = [];
  for (let batch = 0; batch < 10_000; batch++) {
    const next = advanceArduinoCircuitClock(document, target, state, { maxClockEvents: budget });
    events.push(...next.events);
    if (next.executionStatus !== 'yielded') return { ...next, events };
    state = json ? JSON.parse(JSON.stringify(next.state)) : next.state!;
  }
  throw new Error('Raw display bounded clock did not reach the target');
}

describe('raw ten-pin seven-segment electrical and clock reference', () => {
  it('preserves complete pre-repair engine observations and saved thermal/runtime bytes', () => {
    const golden = JSON.parse(
      readFileSync(new URL('./fixtures/raw-seven-segment-before.json', import.meta.url), 'utf8'),
    ) as {
      cases: {
        options: { commonAnode: boolean; legacyResistors?: boolean };
        horizon: number;
        result: unknown;
      }[];
    };
    for (const entry of golden.cases) {
      const session = createElectronicsAdvanceSession(
        rawDisplayCircuit(entry.options),
        {
          requestedHorizonMicroseconds: entry.horizon,
        },
        { observeLedTemporal: true },
      );
      try {
        let result;
        do {
          result = session.step();
        } while (!result);
        expect(result, `${entry.options.commonAnode}:${entry.horizon}`).toEqual(entry.result);
        expect(JSON.stringify(result)).toBe(JSON.stringify(entry.result));
      } finally {
        session.dispose();
      }
    }
  }, 15_000);

  it.each([
    [false, 'top-3'],
    [false, 'bottom-3'],
    [true, 'top-3'],
    [true, 'bottom-3'],
  ] as const)(
    'has independent all-eight reference branches (common anode: %s, leg: %s)',
    (commonAnode, commonTerminal) => {
      const document = rawDisplayCircuit({ commonAnode, commonTerminal });
      const next = through(document, 100);
      expect(next.executionStatus, JSON.stringify(next.diagnostics)).toBe('ready');
      const result = next.result!;
      expect(result.solved, JSON.stringify(result.diagnostics)).toBe(true);
      expect(result.quality.passed).toBe(true);
      const display = result.components.find((entry) => entry.componentId === 'display')!;
      for (const segment of RAW_DISPLAY_SEGMENTS) {
        expect(display.branchCurrents?.[segment], segment).toBeGreaterThan(0);
        expect(display.branchCurrents?.[segment], segment).toBeLessThan(0.02);
        expect(display.branchBrightness?.[segment], segment).toBeGreaterThan(0);
      }
    },
  );

  it.each([false, true])('preserves raw segment patterns 0–9 (common anode: %s)', (commonAnode) => {
    for (const active of RAW_DISPLAY_DIGITS) {
      const next = through(rawDisplayCircuit({ active, commonAnode }), 100);
      expect(next.executionStatus, JSON.stringify(next.diagnostics)).toBe('ready');
      expect(next.result?.quality.passed).toBe(true);
      const display = next.result!.components.find((entry) => entry.componentId === 'display')!;
      for (const segment of RAW_DISPLAY_SEGMENTS) {
        expect((display.branchBrightness?.[segment] ?? 0) > 0, `${active}:${segment}`).toBe(
          segment !== 'dp' && active.includes(segment),
        );
      }
    }
  });

  it('keeps the exact nine-write no-delay program state/events across budget and JSON boundaries', () => {
    const document = rawDisplayCircuit();
    const direct = through(document, 101, 256);
    const split = through(document, 101, 1, true);
    expect(direct.executionStatus, JSON.stringify(direct.diagnostics)).toBe('ready');
    expect(split).toEqual(direct);
    expect(document.components[0]!.stateProperties?.arduinoSource).toBe(
      rawDisplaySource(OWNER_HIGH_WRITES),
    );
  });

  it.each([
    [SEVEN_SEGMENT_LED_PROFILE, 'kneeVoltage', 2.1],
    [SEVEN_SEGMENT_TERMINALS, 'a', 'top-1'],
    [SEVEN_SEGMENT_COMMON_TERMINALS, '0', 'bottom-3'],
  ] as const)(
    'rejects changed original raw display definition %s.%s',
    (object, key, replacement) => {
      const document = rawDisplayCircuit();
      const reuse = createArduinoOperatingPointReuse();
      const original = Object.getOwnPropertyDescriptor(object, key)!;
      const initial = reuse(document, [], new Map(), new Set());
      expect(initial).toBeDefined();
      try {
        Object.defineProperty(object, key, { ...original, value: replacement });
        expect(reuse(document, [], new Map(), new Set())).toBeUndefined();
      } finally {
        Object.defineProperty(object, key, original);
      }
      expect(reuse(document, [], new Map(), new Set())).not.toBe(initial);
    },
  );

  it('rejects a profile mutated before the solver module imports it', async () => {
    vi.resetModules();
    const profile = await import('../domain/led-model.js');
    const original = Object.getOwnPropertyDescriptor(
      profile.SEVEN_SEGMENT_LED_PROFILE,
      'kneeVoltage',
    )!;
    try {
      Object.defineProperty(profile.SEVEN_SEGMENT_LED_PROFILE, 'kneeVoltage', {
        ...original,
        value: 2.1,
      });
      const solver = await import('../domain/solver.js');
      expect(
        solver.createArduinoOperatingPointReuse()(rawDisplayCircuit(), [], new Map(), new Set()),
      ).toBeUndefined();
    } finally {
      Object.defineProperty(profile.SEVEN_SEGMENT_LED_PROFILE, 'kneeVoltage', original);
      vi.resetModules();
    }
  });

  it('keeps anchored near-limit warnings private from earlier public result mutation', () => {
    const document = rawDisplayCircuit();
    const clock = through(document, 100);
    const snapshots = new Map([['uno', arduinoSnapshotFromState(clock.state!.boards[0]!.runtime)]]);
    const reuse = createArduinoOperatingPointReuse();
    let reused = 0;
    const traced = (...args: Parameters<typeof reuse>) => {
      const slot = reuse(...args);
      if (slot?.point) reused++;
      return slot;
    };
    const run = () =>
      solveCircuitWithHeldArduino(
        document,
        0.1,
        snapshots,
        undefined,
        undefined,
        undefined,
        undefined,
        traced,
      );
    const first = run();
    const original = structuredClone(first.diagnostics);
    expect(original.map((entry) => entry.code)).toEqual(['led_near_limit']);
    const mutable = first.diagnostics as {
      message: string;
      componentIds: string[];
      anchors: { id: string }[];
    }[];
    mutable[0]!.message = 'poison';
    mutable[0]!.componentIds[0] = 'foreign-component';
    mutable[0]!.anchors[0]!.id = 'foreign-anchor';
    const next = run();
    expect(next.solved).toBe(true);
    expect(reused).toBeGreaterThan(0);
    expect(next.diagnostics).toEqual(original);
  });

  it('retains actual overcurrent and destructive branch diagnostics instead of cached success', () => {
    const document = rawDisplayCircuit({ resistanceOhm: 0 });
    const run = createArduinoCircuitClockExecutor(document);
    const first = run(100);
    expect(first.executionStatus).toBe('ready');
    const next = run(101, first.state!);
    expect(next.result!.diagnostics.map((entry) => entry.code)).toEqual([
      'led_overcurrent',
      'led_burnout',
    ]);
    const display = next.result!.components.find((entry) => entry.componentId === 'display')!;
    expect(display.stressState).toBe('burned');
    expect(display.branchCurrents!.a).toBeGreaterThan(0.02);
  });

  it('retains reverse damage and does not retain a successful electrical template', () => {
    const base = rawDisplayCircuit({ source: rawDisplaySource(OWNER_HIGH_WRITES, '') });
    const parsed = parseElectronicsDocument({
      ...base,
      components: [
        ...base.components,
        { id: 'reverse-source', kind: 'source', value: 9, position: { x: 0, y: 0 } },
      ],
      connections: [
        ...base.connections.filter((entry) => entry.id !== 'common'),
        {
          id: 'reverse-positive',
          from: { componentId: 'reverse-source', terminal: 'a' },
          to: { componentId: 'display', terminal: 'top-3' },
        },
        {
          id: 'reverse-return',
          from: { componentId: 'reverse-source', terminal: 'b' },
          to: { componentId: 'uno', terminal: 'power-gnd-1' },
        },
      ],
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const next = through(parsed.document, 100);
    expect(next.executionStatus).toBe('ready');
    expect(next.result!.diagnostics.some((entry) => entry.code === 'reverse_polarity')).toBe(true);
    expect(
      next.result!.components.find((entry) => entry.componentId === 'display')!.stressState,
    ).toBe('burned');
    expect(
      createArduinoOperatingPointReuse()(parsed.document, [], new Map(), new Set()),
    ).toBeUndefined();
  });

  it('does not replay the cached conducting branch after a resistor fails open', () => {
    const document = rawDisplayCircuit();
    const run = createArduinoCircuitClockExecutor(document);
    const first = run(100);
    const state = structuredClone(first.state!);
    const failed = state.physicalState!.thermal.find((entry) => entry.componentId === 'r-a')! as {
      failureMode: string;
      accumulatedDamage: number;
    };
    failed.failureMode = 'open';
    failed.accumulatedDamage = 1;
    const next = run(101, state);
    expect(next.executionStatus).toBe('ready');
    expect(
      next.result!.components.find((entry) => entry.componentId === 'display')!.branchBrightness!.a,
    ).toBe(0);
    expect(next.result!.diagnostics.some((entry) => entry.code === 'component_failed')).toBe(true);
  });

  it('does not extend template retention to another component family warning', () => {
    const source = rawDisplaySource().replace(
      'void setup() {',
      'void setup() {pinMode(13,OUTPUT);digitalWrite(13,HIGH);',
    );
    const base = rawDisplayCircuit({ source });
    const parsed = parseElectronicsDocument({
      ...base,
      components: [
        ...base.components,
        {
          id: 'other-led',
          kind: 'led',
          value: 2,
          componentTypeId: 'led-5mm',
          pinIds: ['anode', 'cathode'],
          position: { x: 0, y: 0 },
        },
        {
          id: 'other-r',
          kind: 'resistor',
          value: 100,
          componentTypeId: 'resistor-axial',
          pinIds: ['lead-1', 'lead-2'],
          position: { x: 0, y: 0 },
        },
      ],
      connections: [
        ...base.connections,
        {
          id: 'other-pin',
          from: { componentId: 'uno', terminal: 'd13' },
          to: { componentId: 'other-r', terminal: 'lead-1' },
        },
        {
          id: 'other-anode',
          from: { componentId: 'other-r', terminal: 'lead-2' },
          to: { componentId: 'other-led', terminal: 'anode' },
        },
        {
          id: 'other-return',
          from: { componentId: 'other-led', terminal: 'cathode' },
          to: { componentId: 'uno', terminal: 'power-gnd-1' },
        },
      ],
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const clock = through(parsed.document, 100);
    expect(clock.executionStatus).toBe('ready');
    const snapshots = new Map([['uno', arduinoSnapshotFromState(clock.state!.boards[0]!.runtime)]]);
    const reuse = createArduinoOperatingPointReuse();
    let retained = false;
    const traced = (...args: Parameters<typeof reuse>) => {
      const slot = reuse(...args);
      retained ||= !!slot?.point;
      return slot;
    };
    const run = () =>
      solveCircuitWithHeldArduino(
        parsed.document,
        0.1,
        snapshots,
        undefined,
        undefined,
        undefined,
        undefined,
        traced,
      );
    const first = run();
    expect(
      first.diagnostics.some(
        (entry) => entry.code === 'led_overcurrent' && entry.componentIds?.includes('other-led'),
      ),
    ).toBe(true);
    expect(run()).toEqual(first);
    expect(retained).toBe(false);
  });

  it('rejects future raw display profiles and foreign peripheral topologies', () => {
    const base = rawDisplayCircuit();
    const future = {
      ...base,
      components: base.components.map((entry) =>
        entry.id === 'display' ? { ...entry, modelProfileVersion: 3 } : entry,
      ),
    };
    const foreign = {
      ...base,
      components: [
        ...base.components,
        {
          id: 'foreign',
          kind: 'visual' as const,
          value: 0,
          componentTypeId: 'servo-motor',
          position: { x: 0, y: 0 },
          pinIds: ['vcc', 'gnd', 'signal'],
        },
      ],
    };
    for (const document of [future, foreign])
      expect(
        createArduinoOperatingPointReuse()(document, [], new Map(), new Set()),
      ).toBeUndefined();
  });
});
