import { describe, expect, it } from 'vitest';
import type {
  ElectronicsDocument,
  SchematicComponent,
  SchematicConnection,
} from '../domain/document.js';
import { solveCircuit } from '../domain/solver.js';
import { analyseCircuit } from '../domain/simulation.js';
import { L298N_TERMINALS } from '../domain/models/l298n-dc-model.js';
import { l298nControlNetIndices } from '../domain/models/l298n-input-network.js';
import { buildNetlist } from '../domain/netlist.js';

type Line = 'high' | 'low' | 'floating';
type Channel = 'forward' | 'reverse' | 'brake-low' | 'brake-high' | 'coast';
interface Harness {
  readonly channelA?: Channel;
  readonly channelB?: Channel;
  readonly logicVolt?: number;
  readonly motorVolt?: number;
  readonly resistanceA?: number;
  readonly resistanceB?: number;
  readonly regulatorJumperInstalled?: boolean;
  readonly enaJumperInstalled?: boolean;
  readonly enbJumperInstalled?: boolean;
  readonly in1?: Line;
  readonly externalLogicSourcePresent?: boolean;
}
const base = (id: string, kind: SchematicComponent['kind'], value: number): SchematicComponent => ({
  id,
  kind,
  value,
  position: { x: 0, y: 0 },
});
function wire(
  id: string,
  from: string,
  fromTerminal: string,
  to: string,
  toTerminal: string,
): SchematicConnection {
  return {
    id,
    from: { componentId: from, terminal: fromTerminal },
    to: { componentId: to, terminal: toTerminal },
  };
}
function harness(options: Harness = {}): ElectronicsDocument {
  const a = options.channelA ?? 'forward',
    b = options.channelB ?? 'reverse';
  const signals: Record<Exclude<Channel, 'coast'>, readonly [Line, Line]> = {
    forward: ['high', 'low'],
    reverse: ['low', 'high'],
    'brake-low': ['low', 'low'],
    'brake-high': ['high', 'high'],
  };
  const config = {
    enaJumperInstalled: options.enaJumperInstalled ?? true,
    enbJumperInstalled: options.enbJumperInstalled ?? true,
    regulatorJumperInstalled: options.regulatorJumperInstalled ?? false,
  };
  const driver: SchematicComponent = {
    ...base('driver', 'visual', 0),
    componentTypeId: 'l298n-motor-driver',
    pinIds: [
      ...L298N_TERMINALS,
      ...(config.enaJumperInstalled ? [] : ['ENA']),
      ...(config.enbJumperInstalled ? [] : ['ENB']),
    ],
    stateProperties: config,
  };
  const hasExternalLogicSource =
    !config.regulatorJumperInstalled || options.externalLogicSourcePresent === true;
  const components = [
    base('vs', 'source', options.motorVolt ?? 9),
    ...(hasExternalLogicSource ? [base('vl', 'source', options.logicVolt ?? 5)] : []),
    driver,
    base('motor-a', 'resistor', options.resistanceA ?? 10),
    base('motor-b', 'resistor', options.resistanceB ?? 20),
  ];
  const connections: SchematicConnection[] = [
    wire('vs-p', 'vs', 'a', 'driver', '+12V'),
    wire('vs-n', 'vs', 'b', 'driver', 'GND'),
    ...(hasExternalLogicSource
      ? [wire('vl-p', 'vl', 'a', 'driver', '+5V'), wire('vl-n', 'vl', 'b', 'driver', 'GND')]
      : []),
    wire('out-a1', 'driver', 'OUT1', 'motor-a', 'a'),
    wire('out-a2', 'driver', 'OUT2', 'motor-a', 'b'),
    wire('out-b1', 'driver', 'OUT3', 'motor-b', 'a'),
    wire('out-b2', 'driver', 'OUT4', 'motor-b', 'b'),
  ];
  let counter = 0;
  const driven = (terminal: string, level: Line) => {
    if (level !== 'floating')
      connections.push(
        wire(
          'input-' + String(counter++),
          'driver',
          terminal,
          level === 'high' ? (config.regulatorJumperInstalled ? 'driver' : 'vl') : 'vs',
          level === 'high' ? (config.regulatorJumperInstalled ? '+5V' : 'a') : 'b',
        ),
      );
  };
  const [a1, a2] = signals[a === 'coast' ? 'forward' : a];
  const [b1, b2] = signals[b === 'coast' ? 'forward' : b];
  driven('IN1', options.in1 ?? a1);
  driven('IN2', a2);
  driven('IN3', b1);
  driven('IN4', b2);
  if (!config.enaJumperInstalled) driven('ENA', a === 'coast' ? 'low' : 'high');
  if (!config.enbJumperInstalled) driven('ENB', b === 'coast' ? 'low' : 'high');
  return {
    schemaVersion: 4,
    components,
    connections,
    viewport: { x: 0, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}

function solve(options: Harness = {}) {
  const result = solveCircuit(harness(options));
  const driver = result.components.find((c) => c.componentId === 'driver');
  const motorA = result.components.find((c) => c.componentId === 'motor-a');
  const motorB = result.components.find((c) => c.componentId === 'motor-b');
  return { result, driver, motorA, motorB };
}

describe('L298N real ASA Lab netlist -> shared DC solver', () => {
  it('drives both shunted bridges with rail-wired inputs and no PWM control nets', () => {
    const document = harness();
    expect(l298nControlNetIndices(document, buildNetlist(document).nodeOf).size).toBe(0);
    const result = solveCircuit(document);
    const driver = result.components.find((component) => component.componentId === 'driver');
    const motorA = result.components.find((component) => component.componentId === 'motor-a');
    const motorB = result.components.find((component) => component.componentId === 'motor-b');
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
    expect(driver?.lit).toBe(true);
    const va = (driver?.terminalVoltages.OUT1 ?? 0) - (driver?.terminalVoltages.OUT2 ?? 0);
    const vb = (driver?.terminalVoltages.OUT3 ?? 0) - (driver?.terminalVoltages.OUT4 ?? 0);
    expect(va).toBeCloseTo((9 * 10) / (10 + 2.4), 5);
    expect(vb).toBeCloseTo((-9 * 20) / (20 + 2.4), 5);
    expect(motorA?.current).toBeGreaterThan(0);
    expect(motorB?.current).toBeLessThan(0);
    expect(result.numericalResidual).toBeLessThanOrEqual(result.numericalTolerance);
  });

  it('reverses only the selected bridge without driving the other backwards', () => {
    const before = solve({ channelA: 'forward', channelB: 'forward' });
    const after = solve({ channelA: 'reverse', channelB: 'forward' });
    expect(before.result.status).toBe('solved');
    expect(after.result.status).toBe('solved');
    expect(Math.sign(before.motorA!.current)).toBe(1);
    expect(Math.sign(after.motorA!.current)).toBe(-1);
    expect(after.motorB?.current).toBeCloseTo(before.motorB!.current, 6);
  });

  it('supports shunt-removed enable changes without inventing average PWM voltage', () => {
    const high = solve({ channelA: 'forward', enaJumperInstalled: false });
    const low = solve({ channelA: 'coast', enaJumperInstalled: false });
    expect(high.result.status).toBe('solved');
    expect(low.result.status).toBe('solved');
    expect(high.motorA?.voltageDrop).toBeGreaterThan(0);
    expect(low.motorA?.current).toBeCloseTo(0, 7);
  });

  it('brakes both channels when their inputs agree; motor current is near zero', () => {
    const { result, motorA, motorB } = solve({ channelA: 'brake-low', channelB: 'brake-high' });
    expect(result.status).toBe('solved');
    expect(motorA?.voltageDrop).toBeCloseTo(0, 7);
    expect(motorB?.voltageDrop).toBeCloseTo(0, 7);
  });

  it('rejects unknown input wiring without inventing motion', () => {
    expect(solve({ in1: 'floating' }).result.status).toBe('unsupported');
  });

  it('drives both motors through onboard 78M05 with actual VS current draw', () => {
    const { result, driver, motorA, motorB } = solve({ regulatorJumperInstalled: true });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
    expect(driver?.lit).toBe(true);
    expect(motorA?.current).toBeGreaterThan(0);
    expect(motorB?.current).toBeLessThan(0);
    expect(driver?.terminalVoltages['+5V']).toBeCloseTo(5, 2);
    expect(driver?.terminalCurrents?.['+12V']).toBeGreaterThan(1);
    expect(result.numericalResidual).toBeLessThanOrEqual(result.numericalTolerance);
  });

  it('turns off regulator when VS drops below its 7 V headroom', () => {
    const { result, driver } = solve({ regulatorJumperInstalled: true, motorVolt: 6 });
    expect(result.status).not.toBe('unsupported');
    expect(driver?.lit).toBe(false);
    expect(driver?.terminalVoltages['+5V']).toBeLessThan(4.5);
  });

  it('rejects simultaneous external 5 V when 5V_EN is installed', () => {
    const { result } = solve({ regulatorJumperInstalled: true, externalLogicSourcePresent: true });
    expect(result.status).toBe('unsupported');
  });

  it('fails closed on >2 A overload rather than returning a normal motor state', () => {
    const unsafe = solve({ resistanceA: 0.3 });
    expect(unsafe.result.status).toBe('unsupported');
  });

  it('drives the existing DC motor and 1:48 gearmotor models through the real transient solver', () => {
    const fixture = harness({ motorVolt: 6 });
    const motorDocument: ElectronicsDocument = {
      ...fixture,
      components: fixture.components.map((component) => {
        if (component.id === 'motor-a') {
          return {
            ...component,
            kind: 'visual' as const,
            componentTypeId: 'dc-motor',
            value: 6,
            pinIds: ['positive', 'negative'],
          };
        }
        if (component.id === 'motor-b') {
          return {
            ...component,
            kind: 'visual' as const,
            componentTypeId: 'gearmotor',
            value: 6,
            pinIds: ['positive', 'negative'],
          };
        }
        return component;
      }),
      connections: fixture.connections.map((connection) => ({
        ...connection,
        to: ['motor-a', 'motor-b'].includes(connection.to.componentId)
          ? { ...connection.to, terminal: connection.to.terminal === 'a' ? 'positive' : 'negative' }
          : connection.to,
      })),
    };
    const result = solveCircuit(motorDocument, { simulationTimeMs: 500 });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
    const dcMotor = result.components.find((entry) => entry.componentId === 'motor-a');
    const gearmotor = result.components.find((entry) => entry.componentId === 'motor-b');
    expect(dcMotor?.motorRpm).toBeGreaterThan(0);
    expect(dcMotor?.direction).toBe('clockwise');
    expect(gearmotor?.motorRpm).toBeLessThan(0);
    expect(gearmotor?.direction).toBe('counterclockwise');
    expect(result.transientState?.motors).toHaveLength(2);
  });

  it('takes IN1–IN4 from the real Arduino Uno runtime output nets, not a second solver', () => {
    const fixture = harness({ motorVolt: 6 });
    const inputPins = ['IN1', 'IN2', 'IN3', 'IN4'];
    const makeDocument = (reverseA: boolean): ElectronicsDocument => ({
      ...fixture,
      components: [
        ...fixture.components,
        {
          ...base('arduino-uno', 'visual', 5),
          componentTypeId: 'arduino-uno',
          pinIds: ['d2', 'd3', 'd4', 'd5', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
          stateProperties: {
            arduinoSource:
              'void setup(){pinMode(2,OUTPUT);pinMode(3,OUTPUT);pinMode(4,OUTPUT);' +
              'pinMode(5,OUTPUT);digitalWrite(2,' +
              (reverseA ? 'LOW' : 'HIGH') +
              ');' +
              'digitalWrite(3,' +
              (reverseA ? 'HIGH' : 'LOW') +
              ');' +
              'digitalWrite(4,LOW);digitalWrite(5,HIGH);}' +
              'void loop(){delay(1000);}',
          },
        },
      ],
      connections: [
        ...fixture.connections.filter(
          (edge) => !(edge.from.componentId === 'driver' && inputPins.includes(edge.from.terminal)),
        ),
        ...inputPins.map((inputPin, index) =>
          wire('arduino-' + inputPin, 'arduino-uno', 'd' + (index + 2), 'driver', inputPin),
        ),
        wire('arduino-ground', 'arduino-uno', 'power-gnd-1', 'driver', 'GND'),
      ],
    });
    const forward = solveCircuit(makeDocument(false), { simulationTimeMs: 1 });
    const reversed = solveCircuit(makeDocument(true), { simulationTimeMs: 1 });
    expect(forward.status, JSON.stringify(forward.diagnostics)).toBe('solved');
    expect(reversed.status, JSON.stringify(reversed.diagnostics)).toBe('solved');
    const aForward = forward.components.find((entry) => entry.componentId === 'motor-a');
    const aReversed = reversed.components.find((entry) => entry.componentId === 'motor-a');
    const bForward = forward.components.find((entry) => entry.componentId === 'motor-b');
    const bReversed = reversed.components.find((entry) => entry.componentId === 'motor-b');
    expect(aForward?.current).toBeGreaterThan(0);
    expect(aReversed?.current).toBeLessThan(0);
    expect(bForward?.current).toBeLessThan(0);
    expect(bReversed?.current).toBeCloseTo(bForward!.current, 6);
    expect(
      forward.components.find((entry) => entry.componentId === 'arduino-uno')?.terminalVoltages.d2,
    ).toBeCloseTo(5, 6);
  });

  it('samples real Uno analogWrite PWM at canonical physical time on ENA, without a React timer', () => {
    const fixture = harness({ motorVolt: 6, enaJumperInstalled: false });
    const uno: SchematicComponent = {
      ...base('arduino-uno', 'visual', 5),
      componentTypeId: 'arduino-uno',
      pinIds: ['d3', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
      stateProperties: {
        arduinoSource:
          'void setup(){pinMode(3,OUTPUT);analogWrite(3,128);}' + 'void loop(){delay(1000);}',
      },
    };
    const document: ElectronicsDocument = {
      ...fixture,
      components: [...fixture.components, uno],
      connections: [
        ...fixture.connections.filter(
          (edge) => !(edge.from.componentId === 'driver' && edge.from.terminal === 'ENA'),
        ),
        wire('pwm-enable', 'arduino-uno', 'd3', 'driver', 'ENA'),
        wire('pwm-ground', 'arduino-uno', 'power-gnd-1', 'driver', 'GND'),
      ],
    };
    const high = solveCircuit(document, { simulationTimeMs: 0.25 });
    const low = solveCircuit(document, { simulationTimeMs: 1.5 });
    expect(high.status, JSON.stringify(high.diagnostics)).toBe('solved');
    expect(low.status, JSON.stringify(low.diagnostics)).toBe('solved');
    const highMotor = high.components.find((entry) => entry.componentId === 'motor-a');
    const lowMotor = low.components.find((entry) => entry.componentId === 'motor-a');
    const highMotorB = high.components.find((entry) => entry.componentId === 'motor-b');
    const lowMotorB = low.components.find((entry) => entry.componentId === 'motor-b');
    expect(highMotor?.voltageDrop).toBeGreaterThan(2);
    expect(lowMotor?.voltageDrop).toBeCloseTo(0, 5);
    expect(highMotorB?.voltageDrop).toBeCloseTo(lowMotorB!.voltageDrop, 6);
    const highUno = high.components.find((entry) => entry.componentId === 'arduino-uno');
    const lowUno = low.components.find((entry) => entry.componentId === 'arduino-uno');
    expect(highUno?.terminalVoltages.d3).toBeGreaterThan(4.5);
    expect(lowUno?.terminalVoltages.d3).toBeLessThan(0.5);
  });

  it('changes DC motor RPM under real canonical-time analogWrite PWM duty', () => {
    const fixture = harness({ motorVolt: 6, enaJumperInstalled: false });
    const makeDocument = (duty: number): ElectronicsDocument => ({
      ...fixture,
      components: [
        ...fixture.components.map((component) =>
          component.id === 'motor-a'
            ? {
                ...component,
                kind: 'visual' as const,
                componentTypeId: 'dc-motor',
                value: 6,
                pinIds: ['positive', 'negative'],
              }
            : component,
        ),
        {
          ...base('arduino-uno', 'visual', 5),
          componentTypeId: 'arduino-uno',
          pinIds: ['d3', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
          stateProperties: {
            arduinoSource:
              'void setup(){pinMode(3,OUTPUT);analogWrite(3,' +
              duty +
              ');}' +
              'void loop(){delay(1000);}',
          },
        },
      ],
      connections: [
        ...fixture.connections
          .filter((edge) => !(edge.from.componentId === 'driver' && edge.from.terminal === 'ENA'))
          .map((edge) => ({
            ...edge,
            to:
              edge.to.componentId === 'motor-a'
                ? { ...edge.to, terminal: edge.to.terminal === 'a' ? 'positive' : 'negative' }
                : edge.to,
          })),
        wire('pwm-enable', 'arduino-uno', 'd3', 'driver', 'ENA'),
        wire('pwm-ground', 'arduino-uno', 'power-gnd-1', 'driver', 'GND'),
      ],
    });
    const solveRpm = (duty: number) => {
      const result = solveCircuit(makeDocument(duty), { simulationTimeMs: 500 });
      expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
      return result.components.find((entry) => entry.componentId === 'motor-a')?.motorRpm ?? 0;
    };
    const stoppedRpm = solveRpm(0);
    const halfRpm = solveRpm(128);
    const fullRpm = solveRpm(255);
    expect(stoppedRpm).toBeCloseTo(0, 1);
    expect(halfRpm).toBeGreaterThan(0);
    expect(fullRpm).toBeGreaterThan(halfRpm);
  });

  it('returns byte-identical deterministic observations for the same graph', () => {
    const original = solve();
    expect(JSON.stringify(original.result)).toBe(JSON.stringify(solve().result));
  });
});

describe('L298N reviewed physical supply conflicts and voltage boundaries', () => {
  function regulatorFixture(): ElectronicsDocument {
    return harness({
      regulatorJumperInstalled: true,
      resistanceA: 1_000,
      resistanceB: 1_000,
    });
  }

  function withExternalLogic(options: {
    path: 'direct' | 'resistor' | 'closed-switch' | 'open-switch';
    enabled?: boolean;
    reverse?: boolean;
  }): ElectronicsDocument {
    const fixture = regulatorFixture();
    const enabled = options.enabled !== false;
    const external: SchematicComponent = enabled
      ? base('external-logic', 'source', 5)
      : {
          ...base('external-logic', 'source', 5),
          componentTypeId: 'regulated-power-supply',
          pinIds: ['positive', 'negative'],
          stateProperties: {
            outputEnabled: false,
            voltageSetpointVolt: 5,
            currentLimitAmp: 1,
            outputResistanceOhm: 0.05,
          },
        };
    const positive = enabled ? 'a' : 'positive';
    const negative = enabled ? 'b' : 'negative';
    const signal = options.reverse ? negative : positive;
    const reference = options.reverse ? positive : negative;
    const intermediate: SchematicComponent[] =
      options.path === 'direct'
        ? []
        : [
            options.path === 'resistor'
              ? base('external-path', 'resistor', 100)
              : {
                  ...base('external-path', 'switch', 0),
                  state: options.path === 'closed-switch',
                },
          ];
    return {
      ...fixture,
      components: [...fixture.components, external, ...intermediate],
      connections: [
        ...fixture.connections,
        wire('external-reference', 'external-logic', reference, 'driver', 'GND'),
        ...(options.path === 'direct'
          ? [wire('external-direct', 'external-logic', signal, 'driver', '+5V')]
          : [
              wire('external-series', 'external-logic', signal, 'external-path', 'a'),
              wire('external-to-logic', 'external-path', 'b', 'driver', '+5V'),
            ]),
      ],
    };
  }

  it.each([
    { path: 'resistor' as const, reverse: false },
    { path: 'closed-switch' as const, reverse: false },
    { path: 'resistor' as const, reverse: true },
  ])('rejects an active external source through $path (reverse=$reverse)', (options) => {
    const result = solveCircuit(withExternalLogic(options));
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('unsupported');
    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === 'unsupported_topology' && diagnostic.componentIds?.includes('driver'),
      ),
    ).toBe(true);
  });

  it('does not report a source beyond an open switch as a competing logic supply', () => {
    const result = solveCircuit(withExternalLogic({ path: 'open-switch' }));
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
    const driverResult = result.components.find((component) => component.componentId === 'driver');
    expect(driverResult?.lit).toBe(true);
    expect(driverResult?.terminalVoltages['+5V']).toBeCloseTo(5, 2);
  });

  it('does not disable the onboard regulator merely because an OFF bench source is connected', () => {
    const result = solveCircuit(withExternalLogic({ path: 'direct', enabled: false }));
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
    const driverResult = result.components.find((component) => component.componentId === 'driver');
    expect(driverResult?.lit).toBe(true);
    expect(driverResult?.terminalVoltages['+5V']).toBeCloseTo(5, 2);
    expect(driverResult?.terminalCurrents?.['+12V']).toBeGreaterThan(0);
  });

  function twoDrivers(peerRegulatorInstalled: boolean): ElectronicsDocument {
    const fixture = regulatorFixture();
    const original = fixture.components.find((component) => component.id === 'driver')!;
    const peer: SchematicComponent = {
      ...original,
      id: 'driver-peer',
      stateProperties: {
        ...original.stateProperties,
        regulatorJumperInstalled: peerRegulatorInstalled,
      },
    };
    return {
      ...fixture,
      components: [...fixture.components, peer],
      connections: [
        ...fixture.connections,
        wire('peer-vs', 'driver-peer', '+12V', 'driver', '+12V'),
        wire('peer-ground', 'driver-peer', 'GND', 'driver', 'GND'),
        wire('peer-logic', 'driver-peer', '+5V', 'driver', '+5V'),
        ...['IN1', 'IN2', 'IN3', 'IN4'].map((pin) =>
          wire('peer-' + pin, 'driver-peer', pin, 'driver-peer', 'GND'),
        ),
      ],
    };
  }

  it('rejects two enabled onboard regulators tied to the same physical logic rail', () => {
    const result = solveCircuit(twoDrivers(true));
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('unsupported');
    const affected = result.diagnostics.flatMap((diagnostic) =>
      diagnostic.code === 'unsupported_topology' ? (diagnostic.componentIds ?? []) : [],
    );
    expect(affected).toEqual(expect.arrayContaining(['driver', 'driver-peer']));
  });

  it('can power a second board from one regulator when the second regulator shunt is removed', () => {
    const result = solveCircuit(twoDrivers(false));
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
    for (const id of ['driver', 'driver-peer']) {
      const driverResult = result.components.find((component) => component.componentId === id);
      expect(driverResult?.lit).toBe(true);
      expect(driverResult?.terminalVoltages['+5V']).toBeCloseTo(5, 2);
    }
  });

  function gpioBoard(high: boolean): SchematicComponent {
    return {
      ...base('uno-pullup', 'visual', 5),
      componentTypeId: 'arduino-uno',
      pinIds: ['d2', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
      stateProperties: {
        arduinoSource:
          'void setup(){pinMode(2,OUTPUT);digitalWrite(2,' +
          (high ? 'HIGH' : 'LOW') +
          ');}void loop(){delay(1000);}',
      },
    };
  }

  it.each([false, true])(
    'accepts a normal input pull-up with a real GPIO HIGH=%s and the onboard regulator',
    (high) => {
      const fixture = regulatorFixture();
      const document: ElectronicsDocument = {
        ...fixture,
        components: [
          ...fixture.components,
          gpioBoard(high),
          base('input-pullup', 'resistor', 10_000),
        ],
        connections: [
          ...fixture.connections.filter(
            (edge) => !(edge.from.componentId === 'driver' && edge.from.terminal === 'IN1'),
          ),
          wire('gpio-ground', 'uno-pullup', 'power-gnd-1', 'driver', 'GND'),
          wire('gpio-input', 'uno-pullup', 'd2', 'driver', 'IN1'),
          wire('pullup-input', 'input-pullup', 'a', 'driver', 'IN1'),
          wire('pullup-rail', 'input-pullup', 'b', 'driver', '+5V'),
        ],
      };
      const result = analyseCircuit(document, { simulationTimeMs: 1 });
      expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
      expect(result.quality.passed, JSON.stringify(result.quality)).toBe(true);
      const observed = result.components.find((entry) => entry.componentId === 'driver');
      expect(observed?.lit).toBe(true);
      expect(observed?.terminalVoltages.IN1).toBeCloseTo(high ? 5 : 0, 2);
      const pullup = result.components.find((entry) => entry.componentId === 'input-pullup');
      expect(Math.abs(pullup?.current ?? Number.NaN)).toBeLessThanOrEqual(0.00051);
    },
  );

  it.each([
    { motorVolt: 0.001, valid: false },
    { motorVolt: 6, valid: false },
    { motorVolt: 6.99, valid: false },
    { motorVolt: 6.9999999, valid: false },
    { motorVolt: 7, valid: true },
    { motorVolt: 9, valid: true },
    { motorVolt: 12, valid: true },
    { motorVolt: 12.0000001, valid: false },
  ])(
    'permits a GPIO pull-up only with an operating regulator at VS=$motorVolt V',
    ({ motorVolt, valid }) => {
      const fixture = harness({
        regulatorJumperInstalled: true,
        motorVolt,
        resistanceA: 1_000,
        resistanceB: 1_000,
      });
      const document: ElectronicsDocument = {
        ...fixture,
        components: [...fixture.components, gpioBoard(true), base('input-pullup', 'resistor', 100)],
        connections: [
          ...fixture.connections.filter(
            (edge) => !(edge.from.componentId === 'driver' && edge.from.terminal === 'IN1'),
          ),
          wire('gpio-ground', 'uno-pullup', 'power-gnd-1', 'driver', 'GND'),
          wire('gpio-input', 'uno-pullup', 'd2', 'driver', 'IN1'),
          wire('pullup-input', 'input-pullup', 'a', 'driver', 'IN1'),
          wire('pullup-rail', 'input-pullup', 'b', 'driver', '+5V'),
        ],
      };
      const result = analyseCircuit(document, { simulationTimeMs: 1 });
      if (valid) {
        expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
        expect(result.quality.passed, JSON.stringify(result.quality)).toBe(true);
      } else {
        expect(result.solved).toBe(false);
        expect(result.status).toBe('invalid');
        expect(
          result.diagnostics.some(
            (entry) =>
              entry.code === 'unsupported_topology' && entry.componentIds?.includes('driver'),
          ),
        ).toBe(true);
      }
    },
  );

  it('still rejects a positive GPIO used as a parallel logic supply through a resistor', () => {
    const fixture = regulatorFixture();
    const document: ElectronicsDocument = {
      ...fixture,
      components: [...fixture.components, gpioBoard(true), base('gpio-feed', 'resistor', 10_000)],
      connections: [
        ...fixture.connections,
        wire('gpio-ground', 'uno-pullup', 'power-gnd-1', 'driver', 'GND'),
        wire('gpio-feed-from', 'uno-pullup', 'd2', 'gpio-feed', 'a'),
        wire('gpio-feed-to', 'gpio-feed', 'b', 'driver', '+5V'),
      ],
    };
    const result = solveCircuit(document, { simulationTimeMs: 1 });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('unsupported');
    expect(
      result.diagnostics.some(
        (entry) => entry.code === 'unsupported_topology' && entry.componentIds?.includes('driver'),
      ),
    ).toBe(true);
  });

  it('does not let a signal on board B exempt a parallel GPIO supply to board A', () => {
    const fixture = twoDrivers(false);
    const document: ElectronicsDocument = {
      ...fixture,
      components: [...fixture.components, gpioBoard(true)],
      connections: [
        ...fixture.connections.filter((edge) => edge.id !== 'peer-IN1'),
        wire('gpio-ground', 'uno-pullup', 'power-gnd-1', 'driver', 'GND'),
        wire('gpio-peer-input', 'uno-pullup', 'd2', 'driver-peer', 'IN1'),
      ],
    };
    const control = solveCircuit(document, { simulationTimeMs: 1 });
    expect(control.status, JSON.stringify(control.diagnostics)).toBe('solved');
    const crossFed: ElectronicsDocument = {
      ...document,
      components: [...document.components, base('cross-feed', 'resistor', 10_000)],
      connections: [
        ...document.connections,
        wire('cross-from', 'uno-pullup', 'd2', 'cross-feed', 'a'),
        wire('cross-to', 'cross-feed', 'b', 'driver', '+5V'),
      ],
    };
    const result = solveCircuit(crossFed, { simulationTimeMs: 1 });
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('unsupported');
    expect(
      result.diagnostics.some(
        (entry) => entry.code === 'unsupported_topology' && entry.componentIds?.includes('driver'),
      ),
    ).toBe(true);
  });

  it.each([7, 12])(
    'converges without GPIO assistance at the exact %s V regulator boundary',
    (motorVolt) => {
      const result = analyseCircuit(
        harness({
          regulatorJumperInstalled: true,
          motorVolt,
          resistanceA: 1_000,
          resistanceB: 1_000,
        }),
      );
      expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
      expect(result.quality.passed, JSON.stringify(result.quality)).toBe(true);
      expect(result.components.find((entry) => entry.componentId === 'driver')?.lit).toBe(true);
    },
  );

  function withInputVoltage(voltage: number, disabled = false): ElectronicsDocument {
    const fixture = harness({
      resistanceA: 1_000,
      resistanceB: 1_000,
      ...(disabled ? { channelA: 'coast' as const, enaJumperInstalled: false } : {}),
    });
    return {
      ...fixture,
      components: [...fixture.components, base('input-source', 'source', voltage)],
      connections: [
        ...fixture.connections.filter(
          (connection) =>
            !(connection.from.componentId === 'driver' && connection.from.terminal === 'IN1'),
        ),
        wire('external-input', 'input-source', 'a', 'driver', 'IN1'),
        wire('input-reference', 'input-source', 'b', 'driver', 'GND'),
      ],
    };
  }

  it.each([
    { label: '6 V logic', options: { logicVolt: 6 } },
    { label: '36 V motor supply', options: { motorVolt: 36 } },
  ])('rejects $label through the actual MNA solver', ({ options }) => {
    const result = solveCircuit(harness({ ...options, resistanceA: 1_000, resistanceB: 1_000 }));
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('unsupported');
  });

  it('rejects a driven 8 V input even when ENA is grounded', () => {
    const result = solveCircuit(withInputVoltage(8, true));
    expect(result.status, JSON.stringify(result.diagnostics)).toBe('unsupported');
  });

  it.each([
    { voltage: 1.5, status: 'solved', moving: false },
    { voltage: 2.1, status: 'unsupported', moving: false },
    { voltage: 2.3, status: 'solved', moving: true },
  ])(
    'uses the guaranteed input boundary at $voltage V in the physical netlist',
    ({ voltage, status, moving }) => {
      const result = solveCircuit(withInputVoltage(voltage));
      expect(result.status, JSON.stringify(result.diagnostics)).toBe(status);
      if (status === 'solved') {
        const motorA = result.components.find((component) => component.componentId === 'motor-a');
        if (moving) expect(motorA?.current).toBeGreaterThan(0);
        else expect(motorA?.current).toBeCloseTo(0, 8);
      }
    },
  );
});

describe('L298N voltage ratings from stored energy without a recognised input driver', () => {
  it.each([
    { voltage: 5, valid: true },
    { voltage: 8, valid: false },
    { voltage: -1, valid: false },
  ])(
    'checks a capacitor holding IN1 at $voltage V while both enables are LOW',
    ({ voltage, valid }) => {
      const fixture = harness({
        channelA: 'coast',
        channelB: 'coast',
        enaJumperInstalled: false,
        enbJumperInstalled: false,
        in1: 'floating',
        resistanceA: 1_000,
        resistanceB: 1_000,
      });
      const document: ElectronicsDocument = {
        ...fixture,
        components: [
          ...fixture.components,
          {
            ...base('stored-input', 'visual', 100),
            componentTypeId: 'electrolytic-capacitor',
            pinIds: ['positive', 'negative'],
            stateProperties: { initialVoltageVolt: voltage, voltageRatingVolt: 25 },
          },
        ],
        connections: [
          ...fixture.connections,
          wire('stored-input-positive', 'stored-input', 'positive', 'driver', 'IN1'),
          wire('stored-input-negative', 'stored-input', 'negative', 'driver', 'GND'),
        ],
      };
      const result = analyseCircuit(document, { simulationTimeMs: 1 });
      if (valid) {
        expect(result.status, JSON.stringify(result.diagnostics)).toBe('solved');
        expect(result.quality.passed, JSON.stringify(result.quality)).toBe(true);
        const observed = result.components.find((entry) => entry.componentId === 'driver');
        expect(observed?.terminalVoltages.IN1).toBeCloseTo(voltage, 6);
      } else {
        expect(result.solved).toBe(false);
        expect(result.status).toBe('invalid');
        expect(
          result.diagnostics.some(
            (entry) =>
              entry.code === 'unsupported_topology' && entry.componentIds?.includes('driver'),
          ),
        ).toBe(true);
      }
    },
  );
});
