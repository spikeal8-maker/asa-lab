import { describe, expect, it, vi } from 'vitest';
import type {
  ComponentKind,
  ElectronicsDocument,
  SchematicComponent,
  Terminal,
} from '../domain/document';
import {
  analyseCircuit,
  compileCircuit,
  createArduinoQualityTraversal,
  simulationModelSetDigest,
  verifyCircuitQuality,
} from '../domain/simulation';

import * as solver from '../domain/solver';
import { arduinoSnapshotFromState } from '../domain/arduino-model';
import { advanceArduinoRuntime } from '../domain/arduino-program-runtime';

function component(
  id: string,
  kind: ComponentKind,
  value: number,
  options: Partial<SchematicComponent> = {},
): SchematicComponent {
  return { id, kind, position: { x: 0, y: 0 }, value, ...options };
}

function connect(
  id: string,
  from: string,
  fromTerminal: Terminal,
  to: string,
  toTerminal: Terminal,
  vertices: readonly { x: number; y: number }[] = [],
) {
  return {
    id,
    from: { componentId: from, terminal: fromTerminal },
    to: { componentId: to, terminal: toTerminal },
    color: '#149447',
    vertices,
  };
}

function document(
  components: readonly SchematicComponent[],
  connections: ElectronicsDocument['connections'],
): ElectronicsDocument {
  return {
    schemaVersion: 4,
    components,
    connections,
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: true, maxIterations: 24 },
  };
}

function simpleOhmLaw(vertices: readonly { x: number; y: number }[] = []): ElectronicsDocument {
  return document(
    [component('source', 'source', 5), component('resistor', 'resistor', 1000)],
    [
      connect('positive', 'source', 'a', 'resistor', 'a', vertices),
      connect('negative', 'resistor', 'b', 'source', 'b', vertices),
    ],
  );
}

describe('R4-M1 simulation implementation contract', () => {
  it('uses one registry identity for supported, unsupported and rejected-quality analysis', () => {
    const supported = simpleOhmLaw();
    const unsupported = document([component('unknown', 'visual', 0)], []);
    const expected = simulationModelSetDigest();
    expect(expected).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(analyseCircuit(supported)).toMatchObject({ status: 'solved', modelSetDigest: expected });
    expect(analyseCircuit(unsupported)).toMatchObject({
      status: 'unsupported',
      modelSetDigest: expected,
      solved: false,
    });
    const frame = solver.solveCircuit(supported);
    const corrupt = vi.spyOn(solver, 'solveCircuit').mockReturnValue({
      ...frame,
      components: frame.components.map((entry) => ({
        ...entry,
        terminalCurrents: Object.fromEntries(
          Object.keys(entry.terminalCurrents ?? {}).map((key) => [key, 1]),
        ),
      })),
    });
    try {
      expect(analyseCircuit(supported)).toMatchObject({
        status: 'nonconvergent',
        modelSetDigest: expected,
        solved: false,
        quality: { passed: false },
      });
    } finally {
      corrupt.mockRestore();
    }
  });
  it('compiles a deterministic electrical topology independent of wire geometry', () => {
    const straight = compileCircuit(simpleOhmLaw());
    const bent = compileCircuit(
      simpleOhmLaw([
        { x: 120, y: 240 },
        { x: 420, y: 240 },
      ]),
    );
    expect(bent.topologySignature).toBe(straight.topologySignature);
    expect(straight.nets).toHaveLength(2);
    expect(straight.componentIds).toEqual(['resistor', 'source']);
  });

  it('solves Ohm law and proves finite Kirchhoff residuals', () => {
    const result = analyseCircuit(simpleOhmLaw());
    expect(result.status).toBe('solved');
    expect(result.solved).toBe(true);
    expect(result.current).toBeCloseTo(0.005, 6);
    const sourceCurrents = result.components.find(
      (entry) => entry.componentId === 'source',
    )?.terminalCurrents;
    const resistorCurrents = result.components.find(
      (entry) => entry.componentId === 'resistor',
    )?.terminalCurrents;
    expect(sourceCurrents?.['a']).toBeCloseTo(-0.005, 9);
    expect(sourceCurrents?.['b']).toBeCloseTo(0.005, 9);
    expect(resistorCurrents?.['a']).toBeCloseTo(0.005, 9);
    expect(resistorCurrents?.['b']).toBeCloseTo(-0.005, 9);
    expect(result.quality).toMatchObject({ finite: true, passed: true });
    expect(result.quality.maxKclResidualAmp).toBeLessThanOrEqual(result.quality.kclToleranceAmp);
    expect(result.quality.maxSourceVoltageResidualVolt).toBeLessThanOrEqual(
      result.quality.sourceVoltageToleranceVolt,
    );
    expect(result.quality.powerBalanceResidualWatt).toBeLessThanOrEqual(
      result.quality.powerBalanceToleranceWatt,
    );
  });

  it('checks Kirchhoff residuals across parallel branches', () => {
    const circuit = document(
      [
        component('source', 'source', 6),
        component('r300', 'resistor', 300),
        component('r600', 'resistor', 600),
      ],
      [
        connect('p1', 'source', 'a', 'r300', 'a'),
        connect('p2', 'source', 'a', 'r600', 'a'),
        connect('n1', 'r300', 'b', 'source', 'b'),
        connect('n2', 'r600', 'b', 'source', 'b'),
      ],
    );
    const result = analyseCircuit(circuit);
    expect(result.status).toBe('solved');
    expect(result.current).toBeCloseTo(0.03, 6);
    expect(result.quality.passed).toBe(true);
  });

  it.each([NaN, Infinity, -Infinity])(
    'rejects nonfinite component observations after earlier finite components: %s',
    (invalid) => {
      const circuit = simpleOhmLaw();
      const compiled = compileCircuit(circuit);
      const solved = analyseCircuit(circuit);
      // Dynamic observations remain mandatory even when unrelated to this circuit's load.
      for (const field of [
        'internalPower',
        'voltageSetpointVolt',
        'sensorOutputCurrentAmp',
        'temperatureCelsius',
        'accumulatedDamagePercent',
        'motorMechanicalPowerWatt',
        'voltageConstraintResidual',
      ] as const) {
        const components = solved.components.map((entry, index) =>
          index === solved.components.length - 1 ? { ...entry, [field]: invalid } : entry,
        );
        expect(
          verifyCircuitQuality(circuit, compiled, { ...solved, components }, {}),
        ).toMatchObject({
          finite: false,
          passed: false,
        });
      }
    },
  );

  it.each([NaN, Infinity, -Infinity])(
    'rejects nonfinite terminal and branch observations without omitting any record: %s',
    (invalid) => {
      const circuit = simpleOhmLaw();
      const compiled = compileCircuit(circuit);
      const solved = analyseCircuit(circuit);
      for (const field of [
        'terminalVoltages',
        'terminalCurrents',
        'branchCurrents',
        'branchBrightness',
      ] as const) {
        const components = solved.components.map((entry) => ({
          ...entry,
          [field]: { ...entry[field], a: invalid },
        }));
        expect(
          verifyCircuitQuality(circuit, compiled, { ...solved, components }, {}),
        ).toMatchObject({
          finite: false,
          passed: false,
        });
      }
    },
  );

  it('retains optional terminal filtering while checking every present branch value', () => {
    const circuit = simpleOhmLaw();
    const compiled = compileCircuit(circuit);
    const solved = analyseCircuit(circuit);
    const components = solved.components.map((entry) => ({
      ...entry,
      terminalVoltages: { ...entry.terminalVoltages, wiper: undefined },
      terminalCurrents: { ...entry.terminalCurrents, wiper: undefined },
      branchCurrents: { measured: -0 },
      branchBrightness: { measured: 0 },
    }));
    expect(verifyCircuitQuality(circuit, compiled, { ...solved, components }, {}).finite).toBe(
      true,
    );
    expect(
      verifyCircuitQuality(
        circuit,
        compiled,
        {
          ...solved,
          components: components.map((entry) => ({
            ...entry,
            branchCurrents: { measured: undefined as unknown as number },
          })),
        },
        {},
      ).finite,
    ).toBe(false);
  });

  it('fails closed when any component has no electrical model', () => {
    const circuit = document(
      [component('source', 'source', 5), component('unsupported', 'visual', 0)],
      [connect('wire', 'source', 'a', 'unsupported', 'a')],
    );
    const result = analyseCircuit(circuit);
    expect(result).toMatchObject({
      solved: false,
      status: 'unsupported',
      current: 0,
      components: [],
      nodes: [],
      iterations: 0,
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'unsupported_component',
        severity: 'error',
        componentIds: ['unsupported'],
      }),
    );
  });

  it('accepts Arduino as a finite source and verifies KCL for a D13 LED overload', () => {
    const circuit = document(
      [
        component('uno', 'visual', 5, {
          componentTypeId: 'arduino-uno',
          pinIds: ['d13', 'power-5v', 'power-3v3', 'power-gnd-1', 'gnd-top'],
        }),
        component('led', 'led', 2, {
          componentTypeId: 'led-5mm',
          pinIds: ['anode', 'cathode'],
        }),
      ],
      [
        connect('d13-anode', 'uno', 'd13', 'led', 'anode'),
        connect('cathode-ground', 'led', 'cathode', 'uno', 'gnd-top'),
      ],
    );
    const result = analyseCircuit(circuit);

    expect(result.status).toBe('solved');
    expect(result.solved).toBe(true);
    expect(result.quality).toMatchObject({ finite: true, passed: true });
    expect(result.components.find((item) => item.componentId === 'led')).toMatchObject({
      lit: true,
      stressState: 'burned',
      deviceHealth: 'overheated',
      damageState: 'destructive_preview',
      presentationState: 'destructive',
    });
    expect(result.diagnostics.map((item) => item.code)).toContain('led_burnout');
  });

  it('runs the default Arduino blink program over time without flagging a free board', () => {
    const circuit = document(
      [
        component('uno', 'visual', 5, {
          componentTypeId: 'arduino-uno',
          pinIds: ['d13', 'power-5v', 'power-3v3', 'power-gnd-1', 'gnd-top'],
        }),
      ],
      [],
    );
    const unoAt = (simulationTimeMs: number) =>
      analyseCircuit(circuit, { simulationTimeMs }).components.find(
        (item) => item.componentId === 'uno',
      );

    expect(unoAt(0)?.terminalVoltages['d13']).toBeCloseTo(5, 6);
    expect(unoAt(0)?.terminalVoltages['power-5v']).toBeCloseTo(5, 6);
    expect(unoAt(0)?.terminalVoltages['power-3v3']).toBeCloseTo(3.3, 6);
    expect(unoAt(0)?.terminalVoltages['power-gnd-1']).toBeCloseTo(0, 6);
    expect(unoAt(999)?.terminalVoltages['d13']).toBeCloseTo(5, 6);
    expect(unoAt(1_000)?.terminalVoltages['d13']).toBeCloseTo(0, 6);
    expect(unoAt(1_999)?.terminalVoltages['d13']).toBeCloseTo(0, 6);
    expect(unoAt(2_000)?.terminalVoltages['d13']).toBeCloseTo(5, 6);
    expect(analyseCircuit(circuit).diagnostics.map((item) => item.code)).not.toContain(
      'open_circuit',
    );
  });

  it('drives a passive piezo at the programmed Arduino tone frequency', () => {
    const circuit = document(
      [
        component('uno', 'visual', 5, {
          componentTypeId: 'arduino-uno',
          pinIds: ['d8', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1', 'gnd-top'],
          stateProperties: {
            arduinoSource: 'void setup() {} void loop() { tone(8, 440); delay(1000); }',
          },
        }),
        component('sounder', 'piezo', 0, {
          componentTypeId: 'piezo-passive-buzzer',
          pinIds: ['positive', 'negative'],
        }),
      ],
      [
        connect('tone-positive', 'uno', 'd8', 'sounder', 'positive'),
        connect('tone-ground', 'sounder', 'negative', 'uno', 'gnd-top'),
      ],
    );
    const result = analyseCircuit(circuit, { simulationTimeMs: 1 });
    expect(result.status).toBe('solved');
    expect(result.quality).toMatchObject({ finite: true, passed: true });
    expect(result.components.find((item) => item.componentId === 'sounder')).toMatchObject({
      energized: true,
      frequencyHz: 440,
      soundLevel: 0.8,
    });
    expect(
      result.components.find((item) => item.componentId === 'uno')?.terminalVoltages['d8'],
    ).toBeCloseTo(5, 5);
  });

  it('keeps a passive piezo silent on a slow default Blink signal', () => {
    const circuit = document(
      [
        component('uno', 'visual', 5, {
          componentTypeId: 'arduino-uno',
          pinIds: ['d13', 'power-5v', 'power-3v3', 'power-gnd-1', 'gnd-top'],
        }),
        component('disc', 'piezo', 0, {
          componentTypeId: 'piezo-disc',
          pinIds: ['positive', 'negative'],
        }),
      ],
      [
        connect('blink-positive', 'uno', 'd13', 'disc', 'positive'),
        connect('blink-ground', 'disc', 'negative', 'uno', 'gnd-top'),
      ],
    );
    expect(
      analyseCircuit(circuit, { simulationTimeMs: 100 }).components.find(
        (item) => item.componentId === 'disc',
      ),
    ).toMatchObject({ energized: false, frequencyHz: 0, soundLevel: 0 });
  });

  it('calculates a finite destructive preview for conflicting legacy sources', () => {
    const circuit = document(
      [component('source-5v', 'source', 5), component('source-9v', 'source', 9)],
      [
        connect('positive', 'source-5v', 'a', 'source-9v', 'a'),
        connect('negative', 'source-5v', 'b', 'source-9v', 'b'),
      ],
    );
    const result = analyseCircuit(circuit);
    expect(result.solved).toBe(true);
    expect(result.status).toBe('solved');
    expect(result.quality.passed).toBe(true);
    expect(result.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          componentId: 'source-5v',
          sourceOperatingMode: 'absorbing',
          stressState: 'burned',
          damageState: 'destructive_preview',
        }),
        expect.objectContaining({
          componentId: 'source-9v',
          sourceOperatingMode: 'delivering',
          stressState: 'burned',
          damageState: 'destructive_preview',
        }),
      ]),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'conflicting_sources',
        severity: 'error',
        componentIds: ['source-5v', 'source-9v'],
      }),
    );
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it('accepts single-cell batteries and the bench supply on positive/negative pins', () => {
    // Holders carry BAT+/BAT-, but catalog batteries carry positive/negative.
    // A contract that only knew the holder pair rejected every battery before
    // the simulation ever looked at the circuit.
    const circuit = document(
      [
        component('battery', 'source', 9, {
          componentTypeId: 'battery-9v',
          pinIds: ['positive', 'negative'],
        }),
        component('load', 'resistor', 1000),
      ],
      [
        connect('positive', 'battery', 'positive', 'load', 'a'),
        connect('negative', 'load', 'b', 'battery', 'negative'),
      ],
    );
    const result = analyseCircuit(circuit);
    expect(result.status).toBe('solved');
    expect(result.quality.passed).toBe(true);
  });

  it('returns byte-for-byte deterministic simulation evidence', () => {
    const circuit = simpleOhmLaw([{ x: 10, y: 20 }]);
    expect(JSON.stringify(analyseCircuit(circuit))).toBe(JSON.stringify(analyseCircuit(circuit)));
  });

  it('passes quality verification with all eight seven-segment branches lit', () => {
    // Regression: every branch current rounds with a sub-microamp error, so the
    // KCL check used to accumulate ~0.5 µA per lit segment and reject a fully
    // wired display as nonconvergent even though the solve itself was exact.
    const display = component('display', 'seven-segment', 0, {
      componentTypeId: 'seven-segment-display',
      pinIds: [
        'top-1',
        'top-2',
        'top-3',
        'top-4',
        'top-5',
        'bottom-1',
        'bottom-2',
        'bottom-3',
        'bottom-4',
        'bottom-5',
      ],
      internalConnections: [['top-3', 'bottom-3']],
      stateProperties: { commonMode: 'common-cathode' },
    });
    const segmentPins: Readonly<Record<string, Terminal>> = {
      a: 'top-4',
      b: 'top-5',
      c: 'bottom-4',
      d: 'bottom-2',
      e: 'bottom-1',
      f: 'top-2',
      g: 'top-1',
      dp: 'bottom-5',
    };
    const components: SchematicComponent[] = [component('source', 'source', 3), display];
    const connections: ElectronicsDocument['connections'] = [];
    for (const [segment, pin] of Object.entries(segmentPins)) {
      components.push(component(`r-${segment}`, 'resistor', 220));
      connections.push(
        connect(`p-${segment}`, 'source', 'a', `r-${segment}`, 'a'),
        connect(`s-${segment}`, `r-${segment}`, 'b', 'display', pin),
      );
    }
    connections.push(connect('common', 'display', 'bottom-3', 'source', 'b'));

    const result = analyseCircuit(document(components, connections));
    expect(result.status).toBe('solved');
    expect(result.quality.passed).toBe(true);
    const solved = result.components.find((entry) => entry.componentId === 'display');
    for (const segment of Object.keys(segmentPins)) {
      expect(solved?.branchCurrents?.[segment], segment).toBeGreaterThan(0);
      expect(solved?.branchBrightness?.[segment], segment).toBeGreaterThan(0);
    }
    expect(solved?.lit).toBe(true);
  });
});

describe('request-owned current quality traversal', () => {
  const source = 'void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}void loop(){delay(1);}';
  const fixture = () =>
    document(
      [
        component('uno', 'visual', 5, {
          componentTypeId: 'arduino-uno',
          pinIds: ['d13', 'power-5v', 'power-3v3', 'power-gnd-1'],
          stateProperties: { arduinoSource: source },
        }),
        component('r', 'resistor', 330, {
          componentTypeId: 'resistor-axial',
          pinIds: ['lead-1', 'lead-2'],
        }),
        component('led', 'led', 2, { componentTypeId: 'led-5mm', pinIds: ['anode', 'cathode'] }),
      ],
      [
        connect('a', 'uno', 'd13', 'r', 'lead-1'),
        connect('b', 'r', 'lead-2', 'led', 'anode'),
        connect('c', 'led', 'cathode', 'uno', 'power-gnd-1'),
      ],
    );
  const harness = (doc = fixture()) => {
    const compiled = compileCircuit(doc);
    const reuse = solver.createArduinoOperatingPointReuse();
    const layout = solver.createArduinoQualityLayoutOwner(reuse);
    const prepared = createArduinoQualityTraversal(doc, compiled, layout.owner);
    const runtime = advanceArduinoRuntime(source).state;
    const solve = (time = 1, state = runtime) =>
      solver.solveCircuitWithHeldArduino(
        doc,
        time,
        new Map([['uno', arduinoSnapshotFromState(state)]]),
        undefined,
        undefined,
        undefined,
        undefined,
        reuse,
      );
    return {
      doc,
      compiled,
      reuse,
      layout,
      prepared,
      runtime,
      solve,
      compare(frame: solver.SolveResult, time = 1) {
        const expected = verifyCircuitQuality(doc, compiled, frame, { simulationTimeMs: time });
        const actual = prepared.verify(frame, { simulationTimeMs: time });
        expect(actual).toStrictEqual(expected);
        return actual;
      },
      dispose() {
        prepared.dispose();
        layout.dispose();
      },
    };
  };

  it('checks every live scalar and retained dictionary again, without changing retained frames', () => {
    const h = harness();
    const layouts = vi.spyOn(solver, 'arduinoQualityDictionaryKeys');
    try {
      const first = h.solve();
      const saved = JSON.stringify(first);
      expect(h.compare(first).passed).toBe(true);
      expect(layouts).toHaveBeenCalled();
      for (const value of [NaN, Infinity, -Infinity, -0, 0, 0.125]) {
        const frame = h.solve(2, { ...h.runtime, variables: { value }, locals: { local: -0 } });
        const actual = h.compare(frame, 2);
        expect(actual.finite).toBe(Number.isFinite(value));
      }
      const changed = h.solve(3);
      Reflect.set(changed.components[0]!, 'voltageConstraintResidual', 1);
      expect(h.compare(changed, 3).passed).toBe(false);
      expect(JSON.stringify(first)).toBe(saved);
      expect(h.compare(h.solve(4), 4).passed).toBe(true);
    } finally {
      layouts.mockRestore();
      h.dispose();
    }
  });

  it.each(['current', 'iterations', 'numericalResidual', 'numericalTolerance'] as const)(
    'reads fresh root %s, including signed zero and all nonfinite values',
    (field) => {
      const h = harness();
      try {
        for (const value of [-0, 0, NaN, Infinity, -Infinity]) {
          const frame = h.solve();
          Reflect.set(frame, field, value);
          expect(h.compare(frame).finite).toBe(Number.isFinite(value));
        }
      } finally {
        h.dispose();
      }
    },
  );

  it('reads every current component numeric category and current node voltages', () => {
    const h = harness();
    const fields = [
      'voltageDrop',
      'current',
      'power',
      'internalResistanceOhm',
      'internalPower',
      'voltageSag',
      'voltageSetpointVolt',
      'currentLimitAmp',
      'brightness',
      'baseCurrent',
      'collectorCurrent',
      'emitterCurrent',
      'currentGain',
      'frequencyHz',
      'soundLevel',
      'motorRpm',
      'outputRpm',
      'motorAngularPhaseRadian',
      'electromagneticTorqueNewtonMeter',
      'outputTorqueNewtonMeter',
      'outputLoadTorqueNewtonMeter',
      'transmissionEfficiency',
      'copperLossWatt',
      'motorMechanicalPowerWatt',
      'outputMechanicalPowerWatt',
      'capacitanceFarad',
      'chargeCoulomb',
      'storedEnergyJoule',
      'voltageRatingVolt',
      'temperatureCelsius',
      'sensorTemperatureCelsius',
      'sensorMoisturePercent',
      'sensorResistanceOhm',
      'sensorOutputVoltageVolt',
      'sensorSupplyVoltageVolt',
      'sensorOutputCurrentAmp',
      'thermalLoadPercent',
      'accumulatedDamagePercent',
      'voltageConstraintResidual',
    ];
    try {
      const initial = h.solve();
      Reflect.set(initial.nodes[0]!, 'voltage', NaN);
      expect(h.compare(initial).finite).toBe(false);
      for (const field of fields) {
        const frame = h.solve();
        Reflect.set(frame.components[0]!, field, NaN);
        expect(h.compare(frame).finite, field).toBe(false);
      }
    } finally {
      h.dispose();
    }
  });

  it.each(['terminalVoltages', 'terminalCurrents', 'branchCurrents', 'branchBrightness'] as const)(
    'uses current %s replacements and preserves enumeration/getter/throw priority',
    (field) => {
      const h = harness();
      const reads: string[] = [];
      try {
        const frame = h.solve();
        const dictionary = { '10': -0, '2': undefined, extra: NaN };
        Object.defineProperty(dictionary, 'later', {
          enumerable: true,
          get() {
            reads.push('later');
            return Infinity;
          },
        });
        Reflect.set(frame.components[0]!, field, dictionary);
        const expected = verifyCircuitQuality(h.doc, h.compiled, frame, {});
        const expectedReads = [...reads];
        reads.length = 0;
        expect(h.prepared.verify(frame, {})).toStrictEqual(expected);
        expect(reads).toStrictEqual(expectedReads);
        // An exception after an earlier nonfinite value is still observed.
        const next = h.solve();
        Reflect.set(next.components[0]!, field, {
          bad: NaN,
          get later() {
            throw new Error('later wins');
          },
        });
        expect(() => h.prepared.verify(next, {})).toThrow('later wins');
        expect(h.compare(h.solve()).passed).toBe(true);
      } finally {
        h.dispose();
      }
    },
  );

  it('keeps original values/entries observations for fresh producer dictionaries without retained layouts', () => {
    const h = harness(simpleOhmLaw());
    const reads: string[] = [];
    const prepare = () => {
      const frame = h.solve();
      const values = frame.components[0]!.terminalCurrents!;
      const [first, second] = Object.keys(values);
      Object.defineProperty(values, first!, {
        configurable: true,
        enumerable: true,
        get() {
          reads.push(first!);
          Object.defineProperty(values, second!, {
            configurable: true,
            enumerable: false,
            value: 0,
          });
          return 0;
        },
      });
      return frame;
    };
    try {
      const expected = verifyCircuitQuality(h.doc, h.compiled, prepare(), {});
      const expectedReads = [...reads];
      reads.length = 0;
      const frame = prepare();
      const keys = vi.spyOn(solver, 'arduinoQualityDictionaryKeys');
      try {
        expect(h.prepared.verify(frame, {})).toStrictEqual(expected);
        expect(reads).toStrictEqual(expectedReads);
        expect(keys).toHaveBeenCalled();
      } finally {
        keys.mockRestore();
      }
    } finally {
      h.dispose();
    }
  });

  it('checks current controller, transient, damage and analysis numeric categories independently', () => {
    const h = harness();
    const physical = () =>
      solver.solveRcCircuitWithHeldArduino(
        h.doc,
        0,
        new Map([['uno', arduinoSnapshotFromState(h.runtime)]]),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        h.reuse,
      );
    const mutate: ((frame: solver.SolveResult) => void)[] = [
      (frame) => Reflect.set(frame.transientState!, 'simulationTimeMs', NaN),
      ...['temperatureCelsius', 'loadRatio', 'accumulatedDamage'].map(
        (field) => (frame: solver.SolveResult) => {
          Reflect.set(frame.transientState!.thermal[0]!, field, NaN);
        },
      ),
      ...['capacitanceFarad', 'initialVoltageVolt', 'voltageRatingVolt', 'voltageVolt'].map(
        (field) => (frame: solver.SolveResult) => {
          Reflect.set(frame.transientState!, 'capacitors', [
            {
              capacitanceFarad: 0,
              initialVoltageVolt: 0,
              voltageRatingVolt: 0,
              voltageVolt: 0,
              [field]: NaN,
            },
          ]);
        },
      ),
      ...[
        'simulationTimeSeconds',
        'currentAmp',
        'motorAngularVelocityRadPerSecond',
        'motorAngularPhaseRadian',
        'temperatureCelsius',
        'accumulatedDamage',
      ].map((field) => (frame: solver.SolveResult) => {
        Reflect.set(frame.transientState!, 'motors', [
          {
            simulationTimeSeconds: 0,
            currentAmp: 0,
            motorAngularVelocityRadPerSecond: 0,
            motorAngularPhaseRadian: 0,
            temperatureCelsius: 0,
            accumulatedDamage: 0,
            [field]: NaN,
          },
        ]);
      }),
      (frame) =>
        Reflect.set(frame.transientState!, 'multimeterFuses', [
          { accumulatedI2tAmpSquaredSecond: NaN },
        ]),
      ...['acceptedSteps', 'rejectedSteps', 'minStepMs', 'maxStepMs'].map(
        (field) => (frame: solver.SolveResult) => {
          Reflect.set(frame.transientAnalysis!, field, NaN);
        },
      ),
      (frame) => Reflect.set(frame.controllerState!, 'simulationTimeMs', NaN),
      ...['virtualTimeMs', 'resumeAtMs', 'programCounter', 'loopStartedAtMs', 'loopIterations'].map(
        (field) => (frame: solver.SolveResult) => {
          Reflect.set(frame.controllerState!.boards[0]!.runtime, field, NaN);
        },
      ),
      (frame) => Reflect.set(frame.controllerState!.boards[0]!.runtime, 'variables', { bad: NaN }),
      (frame) => Reflect.set(frame.controllerState!.boards[0]!.runtime, 'locals', { bad: NaN }),
      (frame) =>
        Reflect.set(frame.controllerState!.boards[0]!.runtime, 'outputVoltages', {
          bad: NaN,
          absent: undefined,
        }),
      (frame) =>
        Reflect.set(frame.controllerState!.boards[0]!.runtime, 'tones', {
          bad: { frequencyHz: NaN },
        }),
      (frame) =>
        Reflect.set(frame.controllerState!.boards[0]!.runtime, 'tones', {
          bad: { frequencyHz: 1, expiresAtMs: NaN },
        }),
    ];
    const keys = vi.spyOn(solver, 'arduinoQualityDictionaryKeys');
    try {
      for (const change of mutate) {
        const frame = physical();
        keys.mockClear();
        change(frame);
        const expected = verifyCircuitQuality(h.doc, h.compiled, frame, { simulationTimeMs: 0 });
        expect(h.prepared.verify(frame, { simulationTimeMs: 0 })).toStrictEqual(expected);
        expect(expected.finite).toBe(false);
        expect(keys).toHaveBeenCalled();
      }
    } finally {
      keys.mockRestore();
      h.dispose();
    }
  });

  it('rejects a getter substituted for an absent dictionary without probing it', () => {
    const h = harness();
    const reads: string[] = [];
    const frame = h.solve();
    const component = frame.components.find((entry) => entry.branchBrightness === undefined)!;
    Object.defineProperty(component, 'branchBrightness', {
      enumerable: true,
      configurable: true,
      get() {
        reads.push('brightness');
        return { value: 0 };
      },
    });
    const expected = verifyCircuitQuality(h.doc, h.compiled, frame, {});
    const expectedReads = [...reads];
    reads.length = 0;
    const keys = vi.spyOn(solver, 'arduinoQualityDictionaryKeys');
    try {
      expect(h.prepared.verify(frame, {})).toStrictEqual(expected);
      expect(reads).toStrictEqual(expectedReads);
      expect(keys).not.toHaveBeenCalled();
    } finally {
      keys.mockRestore();
      h.dispose();
    }
  });

  it('does not inspect an unknown outer Proxy before the original verifier', () => {
    const h = harness();
    try {
      const frame = h.solve();
      const observations: string[] = [];
      const proxy = new Proxy(frame, {
        get(target, key, receiver) {
          observations.push(String(key));
          return Reflect.get(target, key, receiver);
        },
        getOwnPropertyDescriptor() {
          throw new Error('unexpected receipt probe');
        },
      });
      const expected = verifyCircuitQuality(h.doc, h.compiled, proxy, {});
      const expectedReads = [...observations];
      observations.length = 0;
      expect(h.prepared.verify(proxy, {})).toStrictEqual(expected);
      expect(observations).toStrictEqual(expectedReads);
    } finally {
      h.dispose();
    }
  });

  it('consumes one exact-result receipt, rejects replaced components and ignores frozen claims', () => {
    const h = harness();
    const layouts = vi.spyOn(solver, 'arduinoQualityDictionaryKeys');
    try {
      const frame = h.solve();
      h.compare(frame);
      expect(layouts).toHaveBeenCalled();
      layouts.mockClear();
      h.compare(frame);
      expect(layouts).not.toHaveBeenCalled();
      const next = h.solve();
      Reflect.set(
        next,
        'components',
        next.components.map((entry) => Object.freeze({ ...entry })),
      );
      h.compare(next);
      expect(layouts).not.toHaveBeenCalled();
      const unknown = createArduinoQualityTraversal(h.doc, h.compiled, Object.freeze({}));
      expect(unknown.verify(h.solve(), {})).toStrictEqual(
        verifyCircuitQuality(h.doc, h.compiled, h.solve(), {}),
      );
      expect(layouts).not.toHaveBeenCalled();
      unknown.dispose();
    } finally {
      layouts.mockRestore();
      h.dispose();
    }
  });

  it('preserves last duplicate result ID and the original grouped power additions', () => {
    const h = harness();
    try {
      const frame = h.solve();
      Reflect.set(frame.components[0]!, 'componentId', frame.components[1]!.componentId);
      expect(h.compare(frame)).toStrictEqual(verifyCircuitQuality(h.doc, h.compiled, frame, {}));
      const grouped = simpleOhmLaw();
      const g = harness(grouped);
      try {
        const result = g.solve();
        for (let index = 0; index < result.components.length; index++) {
          const entry = result.components[index]!;
          expect(entry.terminalCurrents).toBeDefined();
          for (const key of Object.keys(entry.terminalCurrents!))
            Reflect.deleteProperty(entry.terminalCurrents!, key);
          for (const key of Object.keys(entry.terminalVoltages))
            Reflect.deleteProperty(entry.terminalVoltages, key);
          Object.assign(entry.terminalCurrents!, { '10': 1, '2': 1, tail: 1, absent: undefined });
          Object.assign(
            entry.terminalVoltages,
            index === 0 ? { '10': 0, '2': 1e16, tail: -0 } : { '10': 1, '2': -1e16, tail: 0 },
          );
        }
        const layouts = vi.spyOn(solver, 'arduinoQualityDictionaryKeys');
        try {
          expect(g.compare(result).powerBalanceResidualWatt).toBe(0);
          expect(layouts).toHaveBeenCalled();
        } finally {
          layouts.mockRestore();
        }
      } finally {
        g.dispose();
      }
    } finally {
      h.dispose();
    }
  });

  it('keeps generic supplied Maps, species callbacks, reentry and callback errors unchanged', () => {
    const h = harness();
    const events: string[] = [];
    try {
      const frame = h.solve();
      const components = [...frame.components];
      Object.defineProperty(components, 'constructor', {
        get() {
          events.push('species');
          return { [Symbol.species]: Array };
        },
      });
      const publicFrame = { ...frame, components };
      const compiled = compileCircuit(h.doc);
      const get = compiled.netlist.nodeOf.get.bind(compiled.netlist.nodeOf);
      Reflect.set(compiled.netlist.nodeOf, 'get', (key: string) => {
        events.push(key);
        return get(key);
      });
      verifyCircuitQuality(h.doc, compiled, publicFrame, {});
      const expected = [...events];
      events.length = 0;
      // A substituted outer frame uses public mutable Maps and Array semantics.
      const traversal = createArduinoQualityTraversal(h.doc, compiled, {});
      traversal.verify(publicFrame, {});
      expect(events).toStrictEqual(expected);
      traversal.dispose();
      let nested = false;
      const reenter = vi.spyOn(solver, 'arduinoQualityDictionaryKeys').mockImplementation(() => {
        if (!nested) {
          nested = true;
          const inner = h.solve(2);
          expect(h.prepared.verify(inner, {})).toStrictEqual(
            verifyCircuitQuality(h.doc, h.compiled, inner, {}),
          );
        }
        return undefined;
      });
      try {
        h.compare(h.solve());
        expect(nested).toBe(true);
      } finally {
        reenter.mockRestore();
      }
      const throws = vi.spyOn(solver, 'arduinoQualityDictionaryKeys').mockImplementationOnce(() => {
        throw new Error('quality throw');
      });
      try {
        expect(() => h.prepared.verify(h.solve(), {})).toThrow('quality throw');
      } finally {
        throws.mockRestore();
      }
      expect(h.compare(h.solve()).passed).toBe(true);
    } finally {
      h.dispose();
    }
  });
});
