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
import { advanceClockedArduinoRuntime } from '../domain/arduino-program-runtime.js';
import { arduinoSnapshotFromState } from '../domain/arduino-model.js';
import { solveRcCircuitWithHeldArduino } from '../domain/solver.js';
import { compileCircuit, verifyCircuitQuality } from '../domain/simulation.js';

const idle = 'void loop(){delay(100);}';
const pulse = `int before;int after;void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);delay(1);before=analogRead(A0);digitalWrite(13,LOW);after=analogRead(A0);}${idle}`;
function rc(source = pulse, capacitance = 1, initialVoltageVolt = 0): ElectronicsDocument {
  const components: SchematicComponent[] = [
    {
      id: 'uno',
      kind: 'visual',
      value: 5,
      componentTypeId: 'arduino-uno',
      pinIds: ['d13', 'a0', 'power-5v', 'power-3v3', 'power-gnd-1'],
      position: { x: 0, y: 0 },
      stateProperties: { arduinoSource: source },
    },
    { id: 'r', kind: 'resistor', value: 1000, position: { x: 0, y: 0 } },
    {
      id: 'c',
      kind: 'visual',
      value: capacitance,
      componentTypeId: 'electrolytic-capacitor',
      pinIds: ['positive', 'negative'],
      position: { x: 0, y: 0 },
      stateProperties: { initialVoltageVolt, voltageRatingVolt: 25 },
    },
  ];
  const parsed = parseElectronicsDocument({
    schemaVersion: 2,
    components,
    connections: [
      ['uno', 'd13', 'r', 'a'],
      ['r', 'b', 'c', 'positive'],
      ['c', 'negative', 'uno', 'power-gnd-1'],
      ['c', 'positive', 'uno', 'a0'],
    ].map(([from, a, to, b], i) => ({
      id: `w${i}`,
      from: { componentId: from, terminal: a },
      to: { componentId: to, terminal: b },
    })),
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}
function through(
  doc: ElectronicsDocument,
  target: number,
  previous?: ArduinoCircuitClockState,
  budget = 256,
  inputs?: readonly ArduinoCircuitInputEvent[],
): ArduinoCircuitClockAdvance {
  const events: ArduinoCircuitClockAdvance['events'][number][] = [];
  for (let iteration = 0; iteration < 10000; iteration++) {
    const step = advanceArduinoCircuitClock(doc, target, previous, {
      maxClockEvents: budget,
      inputs,
    });
    expect(
      step.diagnostics,
      `target ${target}, previous ${previous?.reachedMicroseconds}, physical ${previous?.physicalState?.simulationTimeMs}`,
    ).toEqual([]);
    events.push(...step.events);
    if (step.executionStatus === 'ready') {
      expect(step.result!.solved).toBe(true);
      expect(step.result!.quality.passed).toBe(true);
      return { ...step, events };
    }
    expect(step.executionStatus).toBe('yielded');
    expect(step.result).toBeNull();
    previous = JSON.parse(JSON.stringify(step.state));
  }
  throw new Error('RC scheduler did not finish');
}
const cap = (done: ArduinoCircuitClockAdvance) =>
  done.result!.components.find((part) => part.componentId === 'c')!;

function parallelRc(initialVoltageVolt = 0): ElectronicsDocument {
  const base = rc(undefined, 1, initialVoltageVolt);
  return {
    ...base,
    components: [...base.components, { ...base.components[2]!, id: 'c2', value: 3 }],
    connections: [
      ...base.connections,
      ...(['positive', 'negative'] as const).map((terminal) => ({
        id: `parallel-${terminal}`,
        from: { componentId: 'c', terminal },
        to: { componentId: 'c2', terminal },
      })),
    ],
  };
}

describe('Arduino clock with dependent capacitor constraints', () => {
  it('divides the current at the exact GPIO edge without advancing either charge', () => {
    const done = through(parallelRc(), 1);
    const second = done.result!.components.find((part) => part.componentId === 'c2')!;
    expect(cap(done).current).toBeCloseTo(5 / 1010 / 4, 10);
    expect(second.current).toBeCloseTo(((5 / 1010) * 3) / 4, 10);
    expect(cap(done).voltageDrop).toBe(0);
    expect(second.voltageDrop).toBe(0);
    expect(second.storedEnergyJoule).toBe(0);
  });
  it('charges like the sum of the capacitances and preserves each energy separately', () => {
    const done = through(parallelRc(), 1001);
    const second = done.result!.components.find((part) => part.componentId === 'c2')!;
    const single = through(rc(undefined, 4), 1001);
    expect(cap(done).voltageDrop).toBeCloseTo(5 * (1 - Math.exp(-1 / 4.04)), 1);
    expect(second.voltageDrop).toBe(cap(done).voltageDrop);
    expect(cap(done).voltageDrop).toBeCloseTo(cap(single).voltageDrop, 6);
    expect(second.current).toBeCloseTo(3 * cap(done).current, 10);
    expect(second.storedEnergyJoule).toBeCloseTo(3 * cap(done).storedEnergyJoule!, 10);
  });
  it('preserves consistent initial charge and rejects inconsistent charge without output', () => {
    const doc = parallelRc(2);
    const done = through(doc, 0);
    expect(cap(done).voltageDrop).toBe(2);
    expect(done.result!.components.find((part) => part.componentId === 'c2')!.voltageDrop).toBe(2);
    const invalid = {
      ...doc,
      components: doc.components.map((part) =>
        part.id === 'c2'
          ? { ...part, stateProperties: { ...part.stateProperties, initialVoltageVolt: 3 } }
          : part,
      ),
    };
    const fault = advanceArduinoCircuitClock(invalid, 1000);
    expect(fault.executionStatus).toBe('fault');
    expect(fault.state).toBeNull();
    expect(fault.result).toBeNull();
    expect(fault.events).toEqual([]);
  });
  it('handles a capacitor-only triangle without arbitrary circulating branch currents', () => {
    const base = rc();
    const doc: ElectronicsDocument = {
      ...base,
      components: [
        ...base.components,
        { ...base.components[2]!, id: 'c2' },
        { ...base.components[2]!, id: 'c3' },
      ],
      connections: [
        ...base.connections,
        {
          id: 'triangle-1',
          from: { componentId: 'c', terminal: 'positive' },
          to: { componentId: 'c2', terminal: 'positive' },
        },
        {
          id: 'triangle-2',
          from: { componentId: 'c2', terminal: 'negative' },
          to: { componentId: 'c3', terminal: 'positive' },
        },
        {
          id: 'triangle-3',
          from: { componentId: 'c3', terminal: 'negative' },
          to: { componentId: 'c', terminal: 'negative' },
        },
      ],
    };
    const edge = through(doc, 1);
    for (const id of ['c2', 'c3'])
      expect(edge.result!.components.find((part) => part.componentId === id)!.current).toBeCloseTo(
        5 / 1010 / 3,
        9,
      );
    expect(cap(edge).current).toBeCloseTo(((5 / 1010) * 2) / 3, 9);
    const charged = through(doc, 1001);
    expect(cap(charged).voltageDrop).toBeCloseTo(5 * (1 - Math.exp(-1 / 1.515)), 1);
    for (const id of ['c2', 'c3'])
      expect(
        charged.result!.components.find((part) => part.componentId === id)!.voltageDrop,
      ).toBeCloseTo(cap(charged).voltageDrop / 2, 8);
  });
  it('keeps an uncharged shorted capacitor harmless', () => {
    const base = rc();
    const doc: ElectronicsDocument = {
      ...base,
      connections: [
        ...base.connections,
        {
          id: 'short',
          from: { componentId: 'c', terminal: 'positive' },
          to: { componentId: 'c', terminal: 'negative' },
        },
      ],
    };
    const done = through(doc, 1001);
    expect(cap(done).voltageDrop).toBe(0);
    expect(cap(done).current).toBe(0);
  });
  it('is byte-identical under array permutation, yielding, JSON resumes and UI horizons', () => {
    const doc = parallelRc();
    const reference = through(doc, 3000);
    expect(
      through(
        {
          ...doc,
          components: [...doc.components].reverse(),
          connections: [...doc.connections].reverse(),
        },
        3000,
        undefined,
        1,
      ),
    ).toEqual(reference);
    let previous: ArduinoCircuitClockState | undefined;
    const events: ArduinoCircuitClockAdvance['events'][number][] = [];
    let last!: ArduinoCircuitClockAdvance;
    for (const target of [0, 1, 113, 1000, 1004, 1777, 3000]) {
      last = through(doc, target, previous, 3);
      events.push(...last.events);
      previous = JSON.parse(JSON.stringify(last.state));
    }
    expect(JSON.stringify({ ...last, events })).toBe(JSON.stringify(reference));
  });
});

describe('Arduino shared rc-inputs-v2 clock', () => {
  it('keeps a fractional-millisecond observation numerically valid', () => {
    const doc = rc();
    const start = through(doc, 7);
    const snapshots = new Map(
      start.state!.boards.map((board) => [
        board.componentId,
        arduinoSnapshotFromState(board.runtime),
      ]),
    );
    const frame = solveRcCircuitWithHeldArduino(doc, 0.113, snapshots, start.state!.physicalState);
    const quality = verifyCircuitQuality(doc, compileCircuit(doc), frame, {
      simulationTimeMs: 0.113,
    });
    expect(quality.passed, JSON.stringify({ quality, frame })).toBe(true);
    expect(frame.transientAnalysis!.minStepMs).toBeGreaterThan(1e-6);
  });
  it('resolves a microsecond RC transient instead of accepting the old 10 us minimum step', () => {
    const done = through(rc(undefined, 0.001), 2);
    expect(cap(done).voltageDrop).toBeCloseTo(5 * (1 - Math.exp(-1 / 1.01)), 1);
  });

  it('integrates the old input up to its timestamp, then observes the new switch without changing charge', () => {
    const base = rc(idle);
    const doc: ElectronicsDocument = {
      ...base,
      components: [
        ...base.components,
        { id: 'key', kind: 'button', value: 0, state: false, position: { x: 0, y: 0 } },
      ],
      connections: base.connections
        .map((wire) =>
          wire.id === 'w0'
            ? { ...wire, from: { componentId: 'key', terminal: 'b' as const } }
            : wire,
        )
        .concat([
          {
            id: 'wk',
            from: { componentId: 'uno', terminal: 'power-5v' },
            to: { componentId: 'key', terminal: 'a' },
          },
        ]),
    };
    const inputs: ArduinoCircuitInputEvent[] = [
      { atMicroseconds: 1500, componentId: 'key', property: 'state', value: true },
    ];
    const before = through(doc, 1499, undefined, 256, inputs);
    const edge = through(doc, 1500, before.state!, 1);
    expect(cap(before).voltageDrop).toBe(0);
    expect(cap(edge).voltageDrop).toBe(0);
    expect(cap(edge).current).toBeCloseTo(5 / 1000.1001, 8);
    const later = through(doc, 2500, edge.state!);
    const reference = through(doc, 2500, undefined, 256, inputs);
    expect(later.state).toEqual(reference.state);
    expect(later.result).toEqual(reference.result);
    expect(cap(later).voltageDrop).toBeCloseTo(5 * (1 - Math.exp(-1 / 1.0001001)), 1);
  });

  it('gives simultaneous boards the same pre-edge capacitor voltage', () => {
    const base = rc();
    const reader: SchematicComponent = {
      ...base.components[0]!,
      id: 'reader',
      stateProperties: {
        arduinoSource: `int before;int after;void setup(){delayMicroseconds(1003);before=analogRead(A0);after=analogRead(A0);}${idle}`,
      },
    };
    const doc: ElectronicsDocument = {
      ...base,
      components: [...base.components, reader],
      connections: [
        ...base.connections,
        {
          id: 'ra',
          from: { componentId: 'reader', terminal: 'a0' },
          to: { componentId: 'c', terminal: 'positive' },
        },
        {
          id: 'rg',
          from: { componentId: 'reader', terminal: 'power-gnd-1' },
          to: { componentId: 'c', terminal: 'negative' },
        },
      ],
    };
    const done = through(doc, 1010);
    const values = done.state!.boards.map((board) => board.runtime.variables);
    expect(values.every((value) => value.before! > 600 && value.after! > 600)).toBe(true);
    const reversed = { ...doc, components: [...doc.components].reverse() };
    expect(through(reversed, 1010, undefined, 1)).toEqual(done);
  });

  it('fails closed when ideal voltage constraints require an instantaneous jump of stored charge', () => {
    const base = rc(idle, 1, 2);
    const doc: ElectronicsDocument = {
      ...base,
      connections: [
        ...base.connections,
        {
          id: 'short',
          from: { componentId: 'c', terminal: 'positive' },
          to: { componentId: 'c', terminal: 'negative' },
        },
      ],
    };
    const done = advanceArduinoCircuitClock(doc, 0);
    expect(done.executionStatus).toBe('fault');
    expect(done.result).toBeNull();
    expect(done.state).toBeNull();
    expect(done.events).toEqual([]);
  });
  it('starts at exactly zero without charging or an implicit 1 ms step', () => {
    const done = through(rc(), 0);
    expect(done.state!.profile).toBe('rc-inputs-v2');
    expect(done.result!.transientState!.simulationTimeMs).toBe(0);
    expect(cap(done).voltageDrop).toBe(0);
    expect(cap(done).storedEnergyJoule).toBe(0);
    expect(done.result!.transientAnalysis!.acceptedSteps).toBe(0);
  });

  it('preserves declared initial charge and observes identical time without advancing energy', () => {
    const doc = rc(idle, 10, 2);
    const start = through(doc, 0);
    expect(cap(start).voltageDrop).toBe(2);
    expect(cap(start).storedEnergyJoule).toBeCloseTo(20e-6, 12);
    expect(through(doc, 0, start.state!).state).toEqual(start.state);
    expect(through(doc, 0, start.state!).result).toEqual(start.result);
  });

  it('preserves voltage at an output edge but instantly changes branch current', () => {
    const doc = rc();
    const start = through(doc, 0);
    const edge = through(doc, 1, start.state!);
    expect(cap(edge).voltageDrop).toBe(0);
    expect(cap(edge).current).toBeCloseTo(5 / 1010, 8);
    expect(cap(edge).chargeCoulomb).toBe(0);
    const next = through(doc, 2, edge.state!);
    expect(cap(next).voltageDrop).toBeGreaterThan(0);
    expect(cap(next).voltageDrop).toBeLessThan(0.006);
  });

  it('charges and discharges through the actual 1 kOhm plus 10 Ohm GPIO resistance', () => {
    const doc = rc(
      `void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);delay(5);digitalWrite(13,LOW);}${idle}`,
    );
    const charged = through(doc, 1001);
    expect(cap(charged).voltageDrop).toBeCloseTo(5 * (1 - Math.exp(-1 / 1.01)), 1);
    const end = through(doc, 8000);
    const falling = end.events.find(
      (event) => event.kind === 'output-change' && event.voltage === 0 && event.atMicroseconds > 1,
    )!;
    const atEdge = through(doc, falling.atMicroseconds);
    expect(cap(atEdge).voltageDrop).toBeGreaterThan(4.9);
    expect(cap(atEdge).current).toBeLessThan(0);
    expect(cap(end).voltageDrop).toBeCloseTo(
      cap(atEdge).voltageDrop * Math.exp(-(8000 - falling.atMicroseconds) / 1010),
      1,
    );
  });

  it('reads the stored capacitor voltage through ADC, not the new GPIO latch', () => {
    const done = through(rc(), 1010);
    const vars = done.state!.boards[0]!.runtime.variables;
    expect(vars.before).toBeGreaterThan(600);
    expect(vars.before).toBeLessThan(660);
    expect(Math.abs(vars.after! - vars.before!)).toBeLessThan(5);
  });

  it('is byte-identical after different budgets, JSON resumes and arbitrary UI horizons', () => {
    const doc = rc();
    const reference = through(doc, 5000);
    const small = through(doc, 5000, undefined, 1);
    expect(JSON.stringify(small)).toBe(JSON.stringify(reference));
    let previous: ArduinoCircuitClockState | undefined;
    const events: ArduinoCircuitClockAdvance['events'][number][] = [];
    let partitioned!: ArduinoCircuitClockAdvance;
    for (const horizon of [0, 1, 7, 113, 499, 999, 1000, 1001, 1004, 1077, 2314, 4897, 5000]) {
      partitioned = through(doc, horizon, previous, 3);
      events.push(...partitioned.events);
      previous = JSON.parse(JSON.stringify(partitioned.state));
    }
    expect(JSON.stringify({ ...partitioned, events })).toBe(JSON.stringify(reference));
  });

  it('replays identical physics after component and wire array reordering', () => {
    const doc = rc();
    const reordered = {
      ...doc,
      components: [...doc.components].reverse(),
      connections: [...doc.connections].reverse(),
    };
    expect(through(reordered, 2000)).toEqual(through(doc, 2000));
  });

  it('bounds physics work during long delays and never labels partial time ready', () => {
    const doc = rc();
    const pending = advanceArduinoCircuitClock(doc, 1_000_000, undefined, { maxClockEvents: 16 });
    expect(pending.executionStatus).toBe('yielded');
    expect(pending.result).toBeNull();
    expect(pending.state!.physicalState!.simulationTimeMs).toBeLessThan(20);
  });

  it('keeps stored history when a carried component has failed open', () => {
    const doc = rc(idle, 1, 2);
    const start = through(doc, 0);
    const state: ArduinoCircuitClockState = {
      ...start.state!,
      physicalState: {
        ...start.state!.physicalState!,
        thermal: start.state!.physicalState!.thermal.map((entry) =>
          entry.componentId === 'c'
            ? { ...entry, failureMode: 'open', accumulatedDamage: 1 }
            : entry,
        ),
      },
    };
    const done = through(doc, 2000, state);
    expect(done.state!.physicalState!.capacitors[0]!.voltageVolt).toBe(2);
    expect(cap(done).current).toBe(0);
    expect(cap(done).deviceHealth).toBe('failed_open');
  });

  it('holds MCU state throughout adaptive trial/rejection steps', () => {
    const doc = rc();
    const runtime = advanceClockedArduinoRuntime(
      doc.components[0]!.stateProperties!.arduinoSource as string,
      {},
      0.002,
    ).state;
    const snapshots = new Map([['uno', arduinoSnapshotFromState(runtime)]]);
    const start = solveRcCircuitWithHeldArduino(doc, 0, snapshots);
    const advanced = solveRcCircuitWithHeldArduino(doc, 1, snapshots, start.transientState);
    expect(advanced.solved).toBe(true);
    expect(advanced.transientAnalysis!.rejectedSteps).toBeGreaterThan(0);
    expect(advanced.controllerState!.boards[0]!.runtime).toEqual(runtime);
  });

  it('rejects damaged or mismatched physical continuation instead of resetting charge', () => {
    const doc = rc();
    const done = through(doc, 2000);
    for (const mutate of [
      (state: ArduinoCircuitClockState) => ({
        ...state,
        profile: 'rc-inputs-v1' as ArduinoCircuitClockState['profile'],
      }),
      (state: ArduinoCircuitClockState) => ({ ...state, physicalState: undefined }),
      (state: ArduinoCircuitClockState) => ({
        ...state,
        physicalState: { ...state.physicalState!, simulationTimeMs: 2.001 },
      }),
      (state: ArduinoCircuitClockState) => ({
        ...state,
        physicalState: {
          ...state.physicalState!,
          capacitors: [{ ...state.physicalState!.capacitors[0]!, voltageVolt: NaN }],
        },
      }),
      (state: ArduinoCircuitClockState) => ({
        ...state,
        physicalState: { ...state.physicalState!, thermal: [] },
      }),
    ]) {
      const result = advanceArduinoCircuitClock(doc, 3000, mutate(done.state!));
      expect(result.executionStatus).toBe('fault');
      expect(result.result).toBeNull();
      expect(result.state).toBeNull();
      expect(result.events).toEqual([]);
    }
  });
});
