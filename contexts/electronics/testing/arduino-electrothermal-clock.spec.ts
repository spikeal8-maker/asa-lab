import { describe, expect, it } from 'vitest';
import {
  parseElectronicsDocument,
  type ElectronicsDocument,
  type SchematicComponent,
} from '../domain/document.js';
import {
  advanceArduinoCircuitClock,
  type ArduinoCircuitClockState,
} from '../domain/arduino-circuit-scheduler.js';
import {
  solveRcCircuitWithHeldArduino,
  clockedPhysicalStateIsCompatible,
} from '../domain/solver.js';
import { compileCircuit, verifyCircuitQuality } from '../domain/simulation.js';

const part = (id: string, kind: SchematicComponent['kind'], value: number): SchematicComponent => ({
  id,
  kind,
  value,
  position: { x: 0, y: 0 },
});
function circuit(parts: SchematicComponent[], wires: string[][]): ElectronicsDocument {
  const parsed = parseElectronicsDocument({
    schemaVersion: 4,
    components: parts,
    connections: wires.map(([from, a, to, b], i) => ({
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
  time: number,
  previous?: ArduinoCircuitClockState,
  budget = 256,
) {
  for (let count = 0; count < 10000; count++) {
    const next = advanceArduinoCircuitClock(doc, time, previous, { maxClockEvents: budget });
    expect(next.diagnostics, JSON.stringify({ target: time, previous })).toEqual([]);
    if (next.executionStatus === 'ready') return next;
    expect(next.executionStatus).toBe('yielded');
    previous = JSON.parse(JSON.stringify(next.state));
  }
  throw new Error('Clock did not converge');
}
const uno: SchematicComponent = {
  ...part('uno', 'visual', 5),
  componentTypeId: 'arduino-uno',
  pinIds: ['d13', 'power-gnd-1', 'power-5v', 'power-3v3'],
  stateProperties: {
    arduinoSource:
      'void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}void loop(){delay(100);}',
  },
};
const motor: SchematicComponent = {
  ...part('motor', 'visual', 6),
  componentTypeId: 'dc-motor',
  pinIds: ['positive', 'negative'],
};

describe('shared clock electrothermal phase', () => {
  it.each(['npn', 'pnp'])(
    'carries %s driver regions and motor history between clock quanta',
    (type) => {
      const controller = {
        ...uno,
        stateProperties: {
          arduinoSource: `void setup(){pinMode(13,OUTPUT);digitalWrite(13,${type === 'npn' ? 'HIGH' : 'LOW'});}void loop(){delay(100);}`,
        },
      };
      const transistor: SchematicComponent = {
        ...part('driver', 'transistor', 100),
        componentTypeId: `transistor-${type}`,
        pinIds: ['base', 'collector', 'emitter'],
        stateProperties: { transistorType: type },
      };
      const wires =
        type === 'npn'
          ? [
              ['source', 'a', 'motor', 'positive'],
              ['motor', 'negative', 'driver', 'collector'],
              ['driver', 'emitter', 'source', 'b'],
            ]
          : [
              ['source', 'a', 'driver', 'emitter'],
              ['driver', 'collector', 'motor', 'positive'],
              ['motor', 'negative', 'source', 'b'],
            ];
      const doc = circuit(
        [
          controller,
          part('source', 'source', 5),
          part('base-r', 'resistor', 1000),
          motor,
          transistor,
        ],
        [
          ...wires,
          ['uno', 'power-gnd-1', 'source', 'b'],
          ['uno', 'd13', 'base-r', 'a'],
          ['base-r', 'b', 'driver', 'base'],
        ],
      );
      const first = through(doc, 777);
      const continued = through(doc, 5000, JSON.parse(JSON.stringify(first.state)), 1);
      const direct = through(doc, 5000);
      expect(continued.result).toEqual(direct.result);
      expect(continued.state).toEqual(direct.state);
      expect(
        direct.result!.components.find((p) => p.componentId === 'motor')!.motorRpm,
      ).toBeGreaterThan(0);
    },
  );
  it.each(['rgb-led', 'seven-segment-display'])(
    'advances the %s electrical and thermal branches on one clock',
    (type) => {
      const rgb = type === 'rgb-led';
      const load: SchematicComponent = {
        ...part('indicator', rgb ? 'rgb-led' : 'seven-segment', 2),
        componentTypeId: type,
        pinIds: rgb
          ? ['red', 'green', 'blue', 'common']
          : [
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
      };
      const doc = circuit(
        [uno, part('r', 'resistor', 330), load],
        [
          ['uno', 'd13', 'r', 'a'],
          ['r', 'b', 'indicator', rgb ? 'red' : 'top-4'],
          ['indicator', rgb ? 'common' : 'top-3', 'uno', 'power-gnd-1'],
        ],
      );
      const initial = through(doc, 113);
      const continued = through(doc, 2500, initial.state!, 1);
      expect(continued.result).toEqual(through(doc, 2500).result);
      expect(
        continued.result!.components.find((p) => p.componentId === 'indicator')!.current,
      ).toBeGreaterThan(0.005);
    },
  );
  it('carries the regulated supply and actual meter without a separate clock', () => {
    const supply: SchematicComponent = {
      ...part('supply', 'source', 5),
      componentTypeId: 'regulated-power-supply',
      pinIds: ['positive', 'negative'],
      stateProperties: {
        voltageSetpointVolt: 5,
        currentLimitAmp: 1,
        outputEnabled: true,
        outputResistanceOhm: 0.05,
      },
    };
    const meter: SchematicComponent = {
      ...part('meter', 'visual', 0),
      componentTypeId: 'multimeter',
      pinIds: ['v-ohm-ma', 'com'],
      stateProperties: { measurementMode: 'dc-voltage' },
    };
    const doc = circuit(
      [uno, supply, part('r', 'resistor', 1000), meter],
      [
        ['supply', 'positive', 'r', 'a'],
        ['supply', 'negative', 'r', 'b'],
        ['supply', 'positive', 'meter', 'v-ohm-ma'],
        ['supply', 'negative', 'meter', 'com'],
      ],
    );
    const initial = through(doc, 600);
    const done = through(doc, 2000, initial.state!, 2);
    expect(done.result).toEqual(through(doc, 2000).result);
    expect(
      done.result!.components.find((p) => p.componentId === 'meter')!.measuredValue,
    ).toBeCloseTo(5, 3);
  });
  it('never advances motor current, shaft or temperature in a zero-duration observation', () => {
    const doc = circuit(
      [part('source', 'source', 6), motor],
      [
        ['source', 'a', 'motor', 'positive'],
        ['source', 'b', 'motor', 'negative'],
      ],
    );
    const start = solveRcCircuitWithHeldArduino(doc, 0, new Map());
    expect(start.components.find((p) => p.componentId === 'motor')!.current).toBe(0);
    const advanced = solveRcCircuitWithHeldArduino(doc, 20, new Map(), start.transientState);
    const observed = solveRcCircuitWithHeldArduino(doc, 20, new Map(), advanced.transientState);
    expect(observed.solved).toBe(true);
    expect(observed.transientState).toEqual(advanced.transientState);
    const state = advanced.transientState!.motors![0]!;
    expect(observed.components.find((p) => p.componentId === 'motor')!.current).toBeCloseTo(
      state.currentAmp,
      8,
    );
    expect(observed.components.find((p) => p.componentId === 'motor')!.motorRpm).toBeCloseTo(
      advanced.components.find((p) => p.componentId === 'motor')!.motorRpm!,
      1,
    );
    expect(verifyCircuitQuality(doc, compileCircuit(doc), observed).passed).toBe(true);
    expect(clockedPhysicalStateIsCompatible(doc, observed.transientState!, 20)).toBe(true);
  });
  it('preserves hot filament resistance when observing the same instant again', () => {
    const doc = circuit(
      [
        part('source', 'source', 6),
        { ...part('lamp', 'lamp', 6), componentTypeId: 'incandescent-lamp', pinIds: ['L1', 'L2'] },
      ],
      [
        ['source', 'a', 'lamp', 'L1'],
        ['source', 'b', 'lamp', 'L2'],
      ],
    );
    const advanced = solveRcCircuitWithHeldArduino(doc, 100, new Map());
    const observed = solveRcCircuitWithHeldArduino(doc, 100, new Map(), advanced.transientState);
    expect(observed.solved).toBe(true);
    expect(observed.transientState).toEqual(advanced.transientState);
    const temperature = advanced.transientState!.thermal.find(
      (p) => p.componentId === 'lamp',
    )!.temperatureCelsius;
    expect(temperature).toBeGreaterThan(25);
    const expectedResistance = 2.4 + (24 - 2.4) * Math.min(1.5, (temperature - 25) / (2450 - 25));
    expect(observed.components.find((p) => p.componentId === 'lamp')!.current).toBeCloseTo(
      6 / expectedResistance,
      8,
    );
    expect(
      observed.components.find((p) => p.componentId === 'lamp')!.effectiveResistanceOhm,
    ).toBeGreaterThan(5);
    expect(verifyCircuitQuality(doc, compileCircuit(doc), observed).passed).toBe(true);
  });
  it('keeps a blown meter fuse open in a same-time frame', () => {
    const meter: SchematicComponent = {
      ...part('meter', 'visual', 0),
      componentTypeId: 'multimeter',
      pinIds: ['v-ohm-ma', 'com'],
      stateProperties: { measurementMode: 'dc-current' },
    };
    const doc = circuit(
      [part('source', 'source', 5), part('r', 'resistor', 1000), meter],
      [
        ['source', 'a', 'r', 'a'],
        ['r', 'b', 'meter', 'v-ohm-ma'],
        ['meter', 'com', 'source', 'b'],
      ],
    );
    const start = solveRcCircuitWithHeldArduino(doc, 0, new Map());
    const state = {
      ...start.transientState!,
      multimeterFuses: start.transientState!.multimeterFuses!.map((p) => ({
        ...p,
        fuseState: 'blown' as const,
        accumulatedI2tAmpSquaredSecond: 1,
      })),
    };
    const observed = solveRcCircuitWithHeldArduino(doc, 0, new Map(), state);
    expect(observed.solved).toBe(true);
    expect(
      Math.abs(observed.components.find((p) => p.componentId === 'meter')!.current),
    ).toBeLessThan(1e-8);
    expect(observed.transientState!.multimeterFuses![0]!.fuseState).toBe('blown');
  });
  it('runs an LED on the shared clock with identical JSON resumes and arbitrary horizons', () => {
    const doc = circuit(
      [
        uno,
        part('r', 'resistor', 330),
        { ...part('led', 'led', 2), componentTypeId: 'led-5mm', pinIds: ['anode', 'cathode'] },
      ],
      [
        ['uno', 'd13', 'r', 'a'],
        ['r', 'b', 'led', 'anode'],
        ['led', 'cathode', 'uno', 'power-gnd-1'],
      ],
    );
    const direct = through(doc, 10000);
    expect(direct.state!.profile).toBe('electrothermal-v1');
    expect(direct.result!.components.find((p) => p.componentId === 'led')!.current).toBeGreaterThan(
      0.005,
    );
    let previous: ArduinoCircuitClockState | undefined;
    for (const time of [0, 1, 5, 113, 800, 1000, 1743, 3211, 10000])
      previous = JSON.parse(JSON.stringify(through(doc, time, previous, 3).state));
    expect(previous).toEqual(direct.state);
    expect(through(doc, 10000, previous).result).toEqual(direct.result);
  });
  it('couples GPIO to a real FET driver and motor flyback without time jumps', () => {
    const controller = {
      ...uno,
      stateProperties: {
        arduinoSource:
          'void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);delay(10);digitalWrite(13,LOW);}void loop(){delay(100);}',
      },
    };
    const fet: SchematicComponent = {
      ...part('fet', 'transistor', 100),
      componentTypeId: 'transistor-fet',
      pinIds: ['gate', 'drain', 'source'],
      stateProperties: { transistorType: 'fet' },
    };
    const diode: SchematicComponent = {
      ...part('flyback', 'diode', 0.7),
      componentTypeId: 'diode-do41',
      pinIds: ['anode', 'cathode'],
    };
    const doc = circuit(
      [controller, part('source', 'source', 6), motor, fet, diode],
      [
        ['source', 'a', 'motor', 'positive'],
        ['motor', 'negative', 'fet', 'drain'],
        ['fet', 'source', 'source', 'b'],
        ['uno', 'power-gnd-1', 'source', 'b'],
        ['uno', 'd13', 'fet', 'gate'],
        ['flyback', 'anode', 'motor', 'negative'],
        ['flyback', 'cathode', 'motor', 'positive'],
      ],
    );
    const active = through(doc, 5000);
    expect(
      active.result!.components.find((p) => p.componentId === 'motor')!.motorRpm,
    ).toBeGreaterThan(0);
    expect(active.result!.components.find((p) => p.componentId === 'uno')!.current).toBeLessThan(
      0.001,
    );
    const direct = through(doc, 12000);
    const state = through(doc, 10137, active.state!, 3);
    const continued = through(doc, 12000, JSON.parse(JSON.stringify(state.state)), 1);
    expect(continued.state).toEqual(direct.state);
    expect(continued.result).toEqual(direct.result);
    expect(
      direct.result!.components.find((p) => p.componentId === 'motor')!.motorRpm,
    ).toBeGreaterThan(0);
    expect(direct.result!.quality.passed).toBe(true);
    const broken = {
      ...direct.state!,
      physicalState: {
        ...direct.state!.physicalState!,
        motors: direct.state!.physicalState!.motors!.map((entry) => ({
          ...entry,
          simulationTimeSeconds: 1,
        })),
      },
    };
    expect(advanceArduinoCircuitClock(doc, 13000, broken).executionStatus).toBe('fault');
  });
});
