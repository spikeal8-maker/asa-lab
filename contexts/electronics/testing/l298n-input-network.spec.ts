import { describe, expect, it } from 'vitest';
import type {
  ElectronicsDocument,
  SchematicComponent,
  SchematicConnection,
  Terminal,
} from '../domain/document.js';
import {
  arduinoOutputBranchesFromSnapshot,
  arduinoSnapshotFromState,
  type ArduinoRuntimeSnapshot,
} from '../domain/arduino-model.js';
import { advanceClockedArduinoRuntime } from '../domain/arduino-program-runtime.js';
import { buildNetlist, terminalKey } from '../domain/netlist.js';
import { L298N_TERMINALS } from '../domain/models/l298n-dc-model.js';
import { createL298nArduinoCurrentSampler } from '../domain/models/l298n-pwm-model.js';
import {
  createL298nInputDriveResolver,
  l298nArduinoSetupHighImpedance,
  l298nControlNetIndices,
} from '../domain/models/l298n-input-network.js';

const CONTROL_PINS: readonly Terminal[] = ['IN1', 'IN2', 'IN3', 'IN4', 'ENA', 'ENB'];
const base = (id: string, kind: SchematicComponent['kind'], value = 0): SchematicComponent => ({
  id,
  kind,
  value,
  position: { x: 0, y: 0 },
});
const driver: SchematicComponent = {
  ...base('driver', 'visual'),
  componentTypeId: 'l298n-motor-driver',
  pinIds: [...L298N_TERMINALS, 'ENA', 'ENB'],
  stateProperties: {
    enaJumperInstalled: false,
    enbJumperInstalled: false,
    regulatorJumperInstalled: false,
  },
};
const wire = (
  id: string,
  from: string,
  fromTerminal: Terminal,
  to: string,
  toTerminal: Terminal,
): SchematicConnection => ({
  id,
  from: { componentId: from, terminal: fromTerminal },
  to: { componentId: to, terminal: toTerminal },
});
function circuit(
  components: readonly SchematicComponent[] = [],
  connections: readonly SchematicConnection[] = [],
): ElectronicsDocument {
  return {
    schemaVersion: 4,
    components: [
      driver,
      base('logic', 'source', 5),
      base('motor-supply', 'source', 6),
      ...components,
    ],
    connections: [
      wire('logic-positive', 'logic', 'a', 'driver', '+5V'),
      wire('logic-ground', 'logic', 'b', 'driver', 'GND'),
      wire('motor-positive', 'motor-supply', 'a', 'driver', '+12V'),
      wire('motor-ground', 'motor-supply', 'b', 'driver', 'GND'),
      ...connections,
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}
function uno(id = 'uno'): SchematicComponent {
  return {
    ...base(id, 'visual', 5),
    componentTypeId: 'arduino-uno',
    pinIds: [
      'd2',
      'd3',
      'd4',
      'd5',
      'd7',
      'd8',
      'd13',
      'a0',
      'power-5v',
      'power-3v3',
      'power-gnd-1',
      'power-gnd-2',
    ],
  };
}
/** Use the production instruction clock and its pure GPIO projection, never invented snapshots. */
function snapshot(source: string, timeMs: number): ArduinoRuntimeSnapshot {
  const result = advanceClockedArduinoRuntime(source, {}, timeMs);
  expect(result.executionStatus, JSON.stringify(result.diagnostics)).toBe('ready');
  expect(result.diagnostics).toEqual([]);
  return arduinoSnapshotFromState(result.state);
}
function inputs(
  document: ElectronicsDocument,
  snapshots: ReadonlyMap<string, ArduinoRuntimeSnapshot> = new Map(),
  failedComponentIds: ReadonlySet<string> = new Set(),
) {
  const { nodeOf } = buildNetlist(document);
  const physicalNode = (component: SchematicComponent, terminal: Terminal) =>
    nodeOf.get(terminalKey(component.id, terminal));
  const resolver = createL298nInputDriveResolver({
    document,
    nodeOf,
    sources: document.components.filter((component) => component.kind === 'source'),
    arduinoBranches: document.components.flatMap((component) => {
      const state = snapshots.get(component.id);
      return state
        ? arduinoOutputBranchesFromSnapshot(component, state).map((branch) => ({
            ...branch,
            component,
          }))
        : [];
    }),
    failedComponentIds,
    logicalNode: (component, terminal) =>
      physicalNode(
        component,
        component.kind === 'source' && component.componentTypeId
          ? terminal === 'a'
            ? 'positive'
            : 'negative'
          : terminal,
      ),
    physicalNode,
  });
  return resolver(driver, CONTROL_PINS);
}
const SETUP_SOURCE = 'void setup(){delay(100);}void loop(){delay(1000);}';
const LOOP_SOURCE = 'void setup(){}void loop(){delay(1000);}';
function gpioDocument(
  commonGround = true,
  component: SchematicComponent = uno(),
): ElectronicsDocument {
  return circuit(
    [component],
    [
      wire('in1-gpio', component.id, 'd2', 'driver', 'IN1'),
      wire('in2-gpio', component.id, 'd3', 'driver', 'IN2'),
      ...(commonGround ? [wire('uno-ground', component.id, 'power-gnd-2', 'driver', 'GND')] : []),
    ],
  );
}
function canWait(
  document: ElectronicsDocument,
  state: ArduinoRuntimeSnapshot,
  timeMs: number,
  missing: readonly Terminal[] = ['IN1', 'IN2'],
  boardId = 'uno',
) {
  return l298nArduinoSetupHighImpedance(
    driver,
    missing,
    document,
    buildNetlist(document).nodeOf,
    new Map([[boardId, state]]),
    timeMs,
  );
}

describe('L298N input references on real netlists', () => {
  it('does not turn a wire to an otherwise floating resistor into a known input', () => {
    const document = circuit(
      [base('dangling', 'resistor', 10_000)],
      [wire('floating-input', 'driver', 'IN1', 'dangling', 'a')],
    );
    expect(inputs(document).has('IN1')).toBe(false);
    expect(inputs(document).size).toBe(0);
  });

  it.each(['GND', '+5V'] as const)('recognizes a physical connection to %s', (reference) => {
    const document = circuit([], [wire('reference', 'driver', 'IN1', 'driver', reference)]);
    expect(inputs(document).has('IN1')).toBe(true);
    expect(inputs(document).has('IN2')).toBe(false);
  });

  it.each(['resistor', 'photoresistor'] as const)(
    'follows a %s pull-up to the logic supply',
    (kind) => {
      const document = circuit(
        [base('pullup', kind, 10_000)],
        [
          wire('input-resistor', 'driver', 'IN1', 'pullup', 'a'),
          wire('resistor-logic', 'pullup', 'b', 'logic', 'a'),
        ],
      );
      expect(inputs(document).has('IN1')).toBe(true);
      expect(inputs(document, new Map(), new Set(['pullup'])).has('IN1')).toBe(false);
    },
  );

  it('follows physical resistor pins and a potentiometer wiper', () => {
    const resistor: SchematicComponent = {
      ...base('pullup', 'resistor', 10_000),
      componentTypeId: 'resistor',
      pinIds: ['lead-1', 'lead-2'],
    };
    const pot: SchematicComponent = {
      ...base('pot', 'potentiometer', 10_000),
      componentTypeId: 'potentiometer',
      pinIds: ['terminal-1', 'terminal-2', 'wiper'],
      wiperPosition: 0.5,
    };
    const document = circuit(
      [resistor, pot],
      [
        wire('input-resistor', 'driver', 'IN1', 'pullup', 'lead-1'),
        wire('resistor-wiper', 'pullup', 'lead-2', 'pot', 'wiper'),
        wire('pot-reference', 'pot', 'terminal-1', 'logic', 'a'),
        wire('pot-ground', 'pot', 'terminal-2', 'driver', 'GND'),
      ],
    );
    expect(inputs(document).has('IN1')).toBe(true);
    expect(inputs(document, new Map(), new Set(['pot'])).has('IN1')).toBe(false);
  });

  it.each([false, true])('requires the generic switch to be closed (closed=%s)', (closed) => {
    const document = circuit(
      [{ ...base('switch', 'switch'), state: closed }],
      [
        wire('input-switch', 'driver', 'IN1', 'switch', 'a'),
        wire('switch-reference', 'switch', 'b', 'logic', 'a'),
      ],
    );
    expect(inputs(document).has('IN1')).toBe(closed);
  });

  it.each([false, true])('uses the selected SPDT throw (right=%s)', (right) => {
    const document = circuit(
      [
        {
          ...base('switch', 'switch'),
          componentTypeId: 'switch-spdt',
          pinIds: ['common', 'throw-left', 'throw-right'],
          state: right,
        },
      ],
      [
        wire('input-switch', 'driver', 'IN1', 'switch', 'common'),
        wire('left-reference', 'switch', 'throw-left', 'logic', 'a'),
      ],
    );
    expect(inputs(document).has('IN1')).toBe(!right);
  });

  it.each([false, true])(
    'crosses tactile-button sides only when pressed (pressed=%s)',
    (pressed) => {
      const document = circuit(
        [
          {
            ...base('button', 'button'),
            componentTypeId: 'pushbutton',
            pinIds: ['SW-A1', 'SW-A2', 'SW-B1', 'SW-B2'],
            state: pressed,
          },
        ],
        [
          wire('input-button', 'driver', 'IN1', 'button', 'SW-A2'),
          wire('button-reference', 'button', 'SW-B2', 'logic', 'a'),
        ],
      );
      expect(inputs(document).has('IN1')).toBe(pressed);
    },
  );

  it('recognizes a source only when its other pole has a path to the driver reference', () => {
    const detached = circuit(
      [base('signal-battery', 'source', 5)],
      [wire('battery-input', 'signal-battery', 'a', 'driver', 'IN1')],
    );
    expect(inputs(detached).has('IN1')).toBe(false);
    const connected = {
      ...detached,
      connections: [
        ...detached.connections,
        wire('battery-ground', 'signal-battery', 'b', 'driver', 'GND'),
      ],
    };
    expect(inputs(connected).has('IN1')).toBe(true);
    expect(inputs(connected, new Map(), new Set(['signal-battery'])).has('IN1')).toBe(false);
  });

  it.each([
    { outputEnabled: false, currentLimitAmp: 1, known: false },
    { outputEnabled: true, currentLimitAmp: 0, known: false },
    { outputEnabled: true, currentLimitAmp: 1, known: true },
  ])('respects bench-source enable and current limit: %o', (settings) => {
    const supply: SchematicComponent = {
      ...base('signal-supply', 'source', 5),
      componentTypeId: 'regulated-power-supply',
      pinIds: ['positive', 'negative'],
      stateProperties: {
        outputEnabled: settings.outputEnabled,
        currentLimitAmp: settings.currentLimitAmp,
        voltageSetpointVolt: 5,
        outputResistanceOhm: 0.05,
      },
    };
    const document = circuit(
      [supply],
      [
        wire('supply-input', 'signal-supply', 'positive', 'driver', 'IN1'),
        wire('supply-ground', 'signal-supply', 'negative', 'driver', 'GND'),
      ],
    );
    expect(inputs(document).has('IN1')).toBe(settings.known);
  });

  it.each([
    { statement: 'pinMode(2,OUTPUT);digitalWrite(2,HIGH);', known: true },
    { statement: 'pinMode(2,OUTPUT);digitalWrite(2,LOW);', known: true },
    { statement: 'pinMode(2,INPUT_PULLUP);', known: true },
    { statement: 'pinMode(2,INPUT);', known: false },
  ])('uses actual runtime GPIO branches: $statement', ({ statement, known }) => {
    const state = snapshot('void setup(){' + statement + '}void loop(){delay(1000);}', 1);
    const document = gpioDocument();
    expect(inputs(document, new Map([['uno', state]])).has('IN1')).toBe(known);
    expect(inputs(document, new Map([['uno', state]])).has('IN2')).toBe(false);
  });

  it('rejects a detached or failed Arduino output as a driver reference', () => {
    const state = snapshot(
      'void setup(){pinMode(2,OUTPUT);digitalWrite(2,HIGH);}void loop(){delay(1000);}',
      1,
    );
    expect(inputs(gpioDocument(false), new Map([['uno', state]])).has('IN1')).toBe(false);
    expect(inputs(gpioDocument(), new Map([['uno', state]]), new Set(['uno'])).has('IN1')).toBe(
      false,
    );
  });

  it('finds only PWM nets that reach controls through the actual passive graph', () => {
    const board = uno();
    const document = circuit(
      [board, base('series', 'resistor', 1_000), { ...base('open', 'switch'), state: false }],
      [
        wire('gpio-series', 'uno', 'd3', 'series', 'a'),
        wire('series-enable', 'series', 'b', 'driver', 'ENA'),
        wire('gpio-open', 'uno', 'd5', 'open', 'a'),
        wire('open-enable', 'open', 'b', 'driver', 'ENB'),
        wire('uno-ground', 'uno', 'power-gnd-1', 'driver', 'GND'),
      ],
    );
    const { nodeOf } = buildNetlist(document);
    const controls = l298nControlNetIndices(document, nodeOf);
    expect(controls.has(nodeOf.get(terminalKey('uno', 'd3'))!)).toBe(true);
    expect(controls.has(nodeOf.get(terminalKey('uno', 'd5'))!)).toBe(false);
    expect(controls.has(nodeOf.get(terminalKey('uno', 'power-gnd-1'))!)).toBe(false);
    expect(
      l298nControlNetIndices(
        { ...document, components: [board], connections: [] },
        buildNetlist({
          ...document,
          components: [board],
          connections: [],
        }).nodeOf,
      ).size,
    ).toBe(0);
  });
  it.each(['GND', '+5V', '+12V'] as const)(
    'does not spread control reachability across a shared %s rail',
    (rail) => {
      const document = circuit(
        [
          uno(),
          base('control-pull', 'resistor', 10_000),
          base('unrelated-load', 'resistor', 1_000),
        ],
        [
          wire('control-pull', 'driver', 'IN1', 'control-pull', 'a'),
          wire('control-rail', 'control-pull', 'b', 'driver', rail),
          wire('unrelated-gpio', 'uno', 'd5', 'unrelated-load', 'a'),
          wire('unrelated-rail', 'unrelated-load', 'b', 'driver', rail),
          wire('direct-enable', 'uno', 'd3', 'driver', 'ENA'),
          wire('uno-ground', 'uno', 'power-gnd-1', 'driver', 'GND'),
        ],
      );
      const { nodeOf } = buildNetlist(document);
      const controls = l298nControlNetIndices(document, nodeOf);
      expect(controls.has(nodeOf.get(terminalKey('uno', 'd3'))!)).toBe(true);
      expect(controls.has(nodeOf.get(terminalKey('uno', 'd5'))!)).toBe(false);
      expect(controls.has(nodeOf.get(terminalKey('driver', rail))!)).toBe(false);
    },
  );

  it('does not make every grounded consumer a control when an input is tied directly to ground', () => {
    const document = circuit(
      [uno(), base('unrelated-load', 'resistor', 1_000)],
      [
        wire('grounded-input', 'driver', 'IN1', 'driver', 'GND'),
        wire('unrelated-gpio', 'uno', 'd5', 'unrelated-load', 'a'),
        wire('unrelated-ground', 'unrelated-load', 'b', 'driver', 'GND'),
        wire('uno-ground', 'uno', 'power-gnd-1', 'driver', 'GND'),
      ],
    );
    const { nodeOf } = buildNetlist(document);
    const controls = l298nControlNetIndices(document, nodeOf);
    expect(controls.has(nodeOf.get(terminalKey('uno', 'd5'))!)).toBe(false);
    expect(controls.has(nodeOf.get(terminalKey('driver', 'GND'))!)).toBe(false);
  });

  it.each(['ENA', 'ENB'] as const)(
    'does not expose %s as an external PWM control with its shunt installed',
    (enable) => {
      const document = circuit([uno()], [wire('legacy-enable', 'uno', 'd3', 'driver', enable)]);
      const withShunt: ElectronicsDocument = {
        ...document,
        components: document.components.map((component) =>
          component.id === 'driver'
            ? {
                ...component,
                stateProperties: {
                  ...component.stateProperties,
                  [enable === 'ENA' ? 'enaJumperInstalled' : 'enbJumperInstalled']: true,
                },
              }
            : component,
        ),
      };
      for (const [candidate, expected] of [
        [document, true],
        [withShunt, false],
      ] as const) {
        const { nodeOf } = buildNetlist(candidate);
        expect(
          l298nControlNetIndices(candidate, nodeOf).has(nodeOf.get(terminalKey('uno', 'd3'))!),
        ).toBe(expected);
      }
    },
  );
});

describe('L298N Arduino current projection without connected controls', () => {
  it.each(['no L298N', 'rail-wired L298N'] as const)(
    'preserves ordinary branch current for %s at both PWM phases',
    (configuration) => {
      const board = uno();
      const fixture = circuit(
        [board],
        [
          wire('in1-high', 'driver', 'IN1', 'driver', '+5V'),
          wire('in2-low', 'driver', 'IN2', 'driver', 'GND'),
          wire('in3-low', 'driver', 'IN3', 'driver', 'GND'),
          wire('in4-high', 'driver', 'IN4', 'driver', '+5V'),
          wire('uno-ground', 'uno', 'power-gnd-1', 'driver', 'GND'),
        ],
      );
      const document: ElectronicsDocument =
        configuration === 'no L298N'
          ? { ...fixture, components: [board], connections: [] }
          : {
              ...fixture,
              components: fixture.components.map((component) =>
                component.id === 'driver'
                  ? {
                      ...component,
                      pinIds: [...L298N_TERMINALS],
                      stateProperties: {
                        ...component.stateProperties,
                        enaJumperInstalled: true,
                        enbJumperInstalled: true,
                      },
                    }
                  : component,
              ),
            };
      const state = snapshot('void setup(){analogWrite(3,102);}void loop(){delay(1000);}', 1);
      const branch = arduinoOutputBranchesFromSnapshot(board, state).find(
        (candidate) => candidate.terminal === 'd3',
      )!;
      expect(branch.targetVoltage).toBe(2);
      expect(branch.resistanceOhm).toBe(10);
      const { nodeOf } = buildNetlist(document);
      expect(l298nControlNetIndices(document, nodeOf).size).toBe(0);
      const sample = createL298nArduinoCurrentSampler(document, nodeOf);
      for (const simulationTimeMs of [0, 1.5]) {
        const options = { simulationTimeMs };
        // I = (Vpin - Vground - 2 V) / 10 ohm, independent of PWM phase.
        expect(sample('uno', { d3: 4.75, 'power-gnd-1': 0.25 }, branch, options)).toBe(0.25);
        expect(sample('uno', { d3: 4.75 }, branch, options)).toBe(0.275);
        expect(sample('uno', { 'power-gnd-1': 0.25 }, branch, options)).toBe(-0.225);
        expect(sample('uno', {}, branch, options)).toBe(-0.2);
      }
    },
  );

  it('rechecks current component presence when recreating a sampler for caller-owned arrays', () => {
    const board = uno();
    const components: SchematicComponent[] = [board];
    const connections: SchematicConnection[] = [];
    const document: ElectronicsDocument = { ...circuit(), components, connections };
    const state = snapshot('void setup(){analogWrite(3,102);}void loop(){delay(1000);}', 1);
    const branch = arduinoOutputBranchesFromSnapshot(board, state).find(
      (candidate) => candidate.terminal === 'd3',
    )!;
    const voltages = { d3: 4.75, 'power-gnd-1': 0.25 };
    const before = createL298nArduinoCurrentSampler(document, buildNetlist(document).nodeOf);
    expect(before('uno', voltages, branch, { simulationTimeMs: 0 })).toBe(0.25);

    components.push(driver);
    connections.push(
      wire('gpio-enable', 'uno', 'd3', 'driver', 'ENA'),
      wire('uno-ground', 'uno', 'power-gnd-1', 'driver', 'GND'),
    );
    const { nodeOf } = buildNetlist(document);
    expect(
      l298nControlNetIndices(document, nodeOf).has(nodeOf.get(terminalKey('uno', 'd3'))!),
    ).toBe(true);
    const connected = createL298nArduinoCurrentSampler(document, nodeOf);
    // The same 2 V mean duty now drives the H-bridge as physical 5 V / 0 V levels.
    expect(connected('uno', voltages, branch, { simulationTimeMs: 0 })).toBe(-0.05);
    expect(connected('uno', voltages, branch, { simulationTimeMs: 1.5 })).toBe(0.45);

    components.splice(components.indexOf(driver), 1);
    connections.splice(0, connections.length);
    const removed = createL298nArduinoCurrentSampler(document, buildNetlist(document).nodeOf);
    expect(document.components).toBe(components);
    expect(document.connections).toBe(connections);
    expect(removed('uno', voltages, branch, { simulationTimeMs: 0 })).toBe(0.25);
    expect(removed('uno', voltages, branch, { simulationTimeMs: 1.5 })).toBe(0.25);
  });
});

describe('L298N temporary high-impedance bootstrap boundary', () => {
  it('allows only the real empty cold runtime at physical time zero', () => {
    const cold = snapshot('', 0);
    expect(cold.state.phase).toBe('loop');
    expect(cold.pinModes.size).toBe(0);
    expect(canWait(gpioDocument(), cold, 0)).toBe(true);
    expect(canWait(gpioDocument(), cold, 0.001)).toBe(false);
  });

  it('permits unconfigured GPIO while the same board is executing setup', () => {
    const setup = snapshot(SETUP_SOURCE, 1);
    expect(setup.state.phase).toBe('setup');
    expect(canWait(gpioDocument(), setup, 1)).toBe(true);
    expect(inputs(gpioDocument(), new Map([['uno', setup]])).has('IN1')).toBe(false);
  });

  it('expires on transition into loop even when pinModes remains empty', () => {
    const loop = snapshot(LOOP_SOURCE, 1);
    expect(loop.state.phase).toBe('loop');
    expect(loop.pinModes.size).toBe(0);
    expect(canWait(gpioDocument(), loop, 1)).toBe(false);
    expect(canWait(gpioDocument(), loop, 0)).toBe(false);
  });

  it.each(['cold', 'setup'] as const)(
    'requires the controlling Arduino common ground in %s',
    (phase) => {
      const state = phase === 'cold' ? snapshot('', 0) : snapshot(SETUP_SOURCE, 1);
      expect(canWait(gpioDocument(false), state, phase === 'cold' ? 0 : 1)).toBe(false);
    },
  );

  it('does not exempt a dangling passive input, an unwired control, or an empty missing set', () => {
    const setup = snapshot(SETUP_SOURCE, 1);
    const document = gpioDocument();
    expect(canWait(document, setup, 1, ['IN1', 'IN3'])).toBe(false);
    expect(canWait(document, setup, 1, [])).toBe(false);
    const passive = circuit(
      [uno(), base('dangling', 'resistor', 10_000)],
      [
        wire('uno-ground', 'uno', 'power-gnd-1', 'driver', 'GND'),
        wire('floating-input', 'driver', 'IN1', 'dangling', 'a'),
      ],
    );
    expect(canWait(passive, setup, 1, ['IN1'])).toBe(false);
  });

  it.each(['OUTPUT', 'INPUT_PULLUP'] as const)(
    'does not call configured %s GPIO high-impedance',
    (mode) => {
      const state = snapshot(
        'void setup(){pinMode(2,' + mode + ');delay(100);}void loop(){delay(1000);}',
        1,
      );
      expect(state.state.phase).toBe('setup');
      expect(canWait(gpioDocument(), state, 1, ['IN1'])).toBe(false);
    },
  );

  it('does not borrow the setup state of another Arduino for a loop-phase control', () => {
    const first = uno('first'),
      second = uno('second');
    const document = circuit(
      [first, second],
      [
        wire('first-input', 'first', 'd2', 'driver', 'IN1'),
        wire('first-ground', 'first', 'power-gnd-1', 'driver', 'GND'),
        wire('second-ground', 'second', 'power-gnd-1', 'driver', 'GND'),
      ],
    );
    const states = new Map([
      ['first', snapshot(LOOP_SOURCE, 1)],
      ['second', snapshot(SETUP_SOURCE, 1)],
    ]);
    expect(
      l298nArduinoSetupHighImpedance(
        driver,
        ['IN1'],
        document,
        buildNetlist(document).nodeOf,
        states,
        1,
      ),
    ).toBe(false);
  });
});
