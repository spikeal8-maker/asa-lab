import { describe, expect, it } from 'vitest';
import {
  advanceArduinoCircuitClock,
  type ArduinoCircuitClockState,
  type ArduinoCircuitInputEvent,
} from '../domain/arduino-circuit-scheduler.js';
import {
  parseElectronicsDocument,
  type ElectronicsDocument,
  type SchematicComponent,
} from '../domain/document.js';
import { analyseCircuit } from '../domain/simulation.js';
import {
  arduinoWaveformEdgeMicroseconds,
  isArduinoTimedWaveformState,
} from '../domain/arduino-waveform-runtime.js';

const bodies = ['piezo-passive-buzzer', 'piezo-disc'] as const;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function part(id: string, kind: SchematicComponent['kind'], value = 0): SchematicComponent {
  return { id, kind, value, position: { x: 0, y: 0 } };
}
function piezo(
  id: string,
  body: (typeof bodies)[number],
  mode: 'active' | 'passive',
): SchematicComponent {
  return {
    ...part(id, 'piezo'),
    componentTypeId: body,
    pinIds: ['positive', 'negative'],
    stateProperties: { piezoMode: mode },
  };
}
function board(id: string, source: string): SchematicComponent {
  return {
    ...part(id, 'visual', 5),
    componentTypeId: 'arduino-uno',
    pinIds: ['d8', 'd13', 'power-gnd-1', 'power-5v', 'power-3v3'],
    stateProperties: { arduinoSource: source },
  };
}
function circuit(components: SchematicComponent[], wires: string[][]): ElectronicsDocument {
  const parsed = parseElectronicsDocument({
    schemaVersion: 4,
    components,
    connections: wires.map(([from, a, to, b], i) => ({
      id: `w${i}`,
      from: { componentId: from, terminal: a },
      to: { componentId: to, terminal: b },
    })),
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}
function driven(body: (typeof bodies)[number], source: string) {
  return circuit(
    [board('uno', source), piezo('sounder', body, 'passive')],
    [
      ['uno', 'd8', 'sounder', 'positive'],
      ['sounder', 'negative', 'uno', 'power-gnd-1'],
    ],
  );
}
function through(
  document: ElectronicsDocument,
  horizon: number,
  previous?: ArduinoCircuitClockState,
  budget = 256,
  inputs?: readonly ArduinoCircuitInputEvent[],
) {
  const events = [] as ReturnType<typeof advanceArduinoCircuitClock>['events'][number][];
  for (let i = 0; i < 10000; i++) {
    const next = advanceArduinoCircuitClock(document, horizon, previous, {
      maxClockEvents: budget,
      ...(inputs ? { inputs } : {}),
    });
    events.push(...next.events);
    expect(next.diagnostics).toEqual([]);
    if (next.executionStatus !== 'yielded') {
      expect(next.executionStatus).toBe('ready');
      expect(next.state!.reachedMicroseconds).toBe(horizon);
      expect(next.result!.quality).toMatchObject({ finite: true, passed: true });
      return { ...next, events };
    }
    expect(next.result).toBeNull();
    expect(next.state!.reachedMicroseconds).toBeLessThan(horizon);
    previous = clone(next.state!);
  }
  throw new Error('Directed canonical fixture did not converge');
}
const sound = (done: ReturnType<typeof through>, id = 'sounder') =>
  done.result!.components.find((entry) => entry.componentId === id)!;
const toneSource =
  'int count=0;void setup(){Serial.begin(9600);tone(8,1000);}void loop(){count++;Serial.println(count);delay(100);}';

describe('installed piezo canonical clock coupling', () => {
  it.each(bodies)('%s keeps both approved DC modes and operating diagnostics', (body) => {
    for (const mode of ['active', 'passive'] as const) {
      for (const voltage of [2.5, 3, 5, 15, -5]) {
        const doc = circuit(
          [part('source', 'source', Math.abs(voltage)), piezo('sounder', body, mode)],
          [
            ['source', 'a', 'sounder', voltage < 0 ? 'negative' : 'positive'],
            ['source', 'b', 'sounder', voltage < 0 ? 'positive' : 'negative'],
          ],
        );
        const actual = sound(through(doc, 2000));
        const expected = analyseCircuit(doc).components.find(
          (entry) => entry.componentId === 'sounder',
        )!;
        for (const field of [
          'current',
          'power',
          'frequencyHz',
          'soundLevel',
          'piezoDriveState',
          'damageState',
        ] as const)
          expect(actual[field]).toEqual(expected[field]);
        expect(actual.current).toBeCloseTo(
          voltage / (mode === 'active' ? 5 / 0.015 : 100_000_000),
          8,
        );
        expect(actual.frequencyHz).toBe(mode === 'active' && voltage >= 3 ? 2300 : 0);
      }
    }
  });

  it.each(bodies)('%s uses actual tone edges, JSON continuation and bounded work', (body) => {
    const doc = driven(body, toneSource);
    const direct = through(doc, 5000);
    const small = through(doc, 5000, undefined, 1);
    const initial = through(doc, 777);
    const partitioned = through(doc, 5000, clone(initial.state!), 1);
    expect(small.result).toEqual(direct.result);
    expect(small.state).toEqual(direct.state);
    expect(partitioned.result).toEqual(direct.result);
    expect(partitioned.state).toEqual(direct.state);
    const reordered = through(
      {
        ...doc,
        components: [...doc.components].reverse(),
        connections: [...doc.connections].reverse(),
      },
      5000,
    );
    expect(reordered.result).toEqual(direct.result);
    expect(reordered.state).toEqual(direct.state);
    expect(sound(direct)).toMatchObject({ frequencyHz: 1000, energized: true });
    const start = direct.events.find((event) => event.kind === 'tone-start')!;
    const waveform = direct.state!.boards[0]!.runtime.tones.d8!;
    expect(isArduinoTimedWaveformState(waveform)).toBe(true);
    if (!isArduinoTimedWaveformState(waveform)) throw new Error('Missing canonical waveform');
    expect(arduinoWaveformEdgeMicroseconds(waveform, 0)).toBe(start.atMicroseconds);
    expect(
      arduinoWaveformEdgeMicroseconds(waveform, 1) - arduinoWaveformEdgeMicroseconds(waveform, 0),
    ).toBe(500);
    expect(direct.state!.boards[0]!.loadedSource).toBe(toneSource);
    expect(direct.state!.boards[0]!.runtime.variables.count).toBe(1);
  });

  it.each(bodies)('%s leaves constant HIGH and slow Blink silent', (body) => {
    for (const source of [
      'void setup(){pinMode(8,OUTPUT);digitalWrite(8,HIGH);}void loop(){delay(100);}',
      'void setup(){pinMode(8,OUTPUT);}void loop(){digitalWrite(8,HIGH);delay(1000);digitalWrite(8,LOW);delay(1000);}',
    ]) {
      expect(sound(through(driven(body, source), 5_000_000))).toMatchObject({
        frequencyHz: 0,
        soundLevel: 0,
        energized: false,
      });
    }
  });

  it('expires observed fast digital toggles after switching stops, independent of observation partitions', () => {
    const source =
      'void setup(){pinMode(8,OUTPUT);digitalWrite(8,HIGH);delayMicroseconds(500);digitalWrite(8,LOW);delayMicroseconds(500);digitalWrite(8,HIGH);delayMicroseconds(500);digitalWrite(8,LOW);delayMicroseconds(500);digitalWrite(8,HIGH);delayMicroseconds(500);digitalWrite(8,LOW);delay(100);}void loop(){delay(100);}';
    const doc = driven('piezo-disc', source);
    const early = through(doc, 2800);
    expect(sound(early).frequencyHz).toBeGreaterThan(900);
    const direct = through(doc, 5000);
    const partitioned = through(doc, 5000, clone(early.state!));
    expect(sound(direct)).toMatchObject({ frequencyHz: 0, soundLevel: 0 });
    expect(direct.result).toEqual(partitioned.result);
    expect(direct.state).toEqual(partitioned.state);
  });

  it('ends a duration tone at its canonical timestamp and isolates two independent sources', () => {
    const a = board('a', 'void setup(){tone(8,1000,2);delay(10);}void loop(){delay(100);}');
    const b = board('b', 'void setup(){tone(8,440);}void loop(){delay(100);}');
    const doc = circuit(
      [
        a,
        b,
        piezo('sounder', 'piezo-disc', 'passive'),
        piezo('second', 'piezo-passive-buzzer', 'passive'),
      ],
      [
        ['a', 'd8', 'sounder', 'positive'],
        ['a', 'power-gnd-1', 'sounder', 'negative'],
        ['b', 'd8', 'second', 'positive'],
        ['b', 'power-gnd-1', 'second', 'negative'],
      ],
    );
    const done = through(doc, 5000, undefined, 1);
    const start = done.events.find(
      (event) => event.kind === 'tone-start' && event.componentId === 'a',
    )!;
    const stop = done.events.find(
      (event) => event.kind === 'tone-stop' && event.componentId === 'a',
    )!;
    expect(stop.atMicroseconds - start.atMicroseconds).toBe(2000);
    expect(sound(done)).toMatchObject({ frequencyHz: 0, soundLevel: 0 });
    expect(sound(done, 'second')).toMatchObject({ frequencyHz: 440, energized: true });
  });

  it('noTone uses its real instruction timestamp and releases GPIO before a natural edge', () => {
    const done = through(
      driven(
        'piezo-disc',
        'void setup(){tone(8,1000);delayMicroseconds(750);noTone(8);delay(10);}void loop(){delay(100);}',
      ),
      3000,
    );
    const start = done.events.find((event) => event.kind === 'tone-start')!;
    const stop = done.events.find((event) => event.kind === 'tone-stop')!;
    expect(stop.atMicroseconds - start.atMicroseconds).toBeGreaterThan(500);
    expect(stop.atMicroseconds - start.atMicroseconds).toBeLessThan(1000);
    expect(sound(done)).toMatchObject({ frequencyHz: 0, soundLevel: 0 });
    expect(done.state!.boards[0]!.runtime.tones.d8).toBeUndefined();
    expect(
      done.result!.components.find((entry) => entry.componentId === 'uno')!.terminalVoltages.d8,
    ).toBeCloseTo(0, 8);
  });

  it('retains fail-closed rejection for unknown/visual piezo and disabled speaker identities', () => {
    for (const component of [
      { ...piezo('bad', 'piezo-disc', 'passive'), kind: 'visual' as const },
      { ...part('bad', 'visual'), componentTypeId: 'small-speaker' },
    ]) {
      const done = advanceArduinoCircuitClock(circuit([component], []), 0);
      expect(done.executionStatus).toBe('fault');
      expect(done.result).toBeNull();
      expect(done.diagnostics[0]!.code).toBe('clocked_profile_unsupported');
    }
  });

  it('preserves mixed RC, thermal, motor, damage, fuse and Arduino state through live inputs and JSON work partitions', () => {
    const doc = circuit(
      [
        board('uno', toneSource),
        piezo('sounder', 'piezo-disc', 'passive'),
        part('source', 'source', 5),
        part('rc-r', 'resistor', 1000),
        {
          ...part('cap', 'visual', 100),
          componentTypeId: 'electrolytic-capacitor',
          pinIds: ['positive', 'negative'],
          stateProperties: { initialVoltageVolt: 0, voltageRatingVolt: 25 },
        },
        { ...part('lamp', 'lamp', 6), componentTypeId: 'incandescent-lamp', pinIds: ['L1', 'L2'] },
        {
          ...part('motor', 'visual', 6),
          componentTypeId: 'dc-motor',
          pinIds: ['positive', 'negative'],
        },
        part('meter-r', 'resistor', 1000),
        {
          ...part('meter', 'visual'),
          componentTypeId: 'multimeter',
          pinIds: ['v-ohm-ma', 'com'],
          stateProperties: { measurementMode: 'dc-voltage' },
        },
      ],
      [
        ['uno', 'd8', 'sounder', 'positive'],
        ['uno', 'power-gnd-1', 'sounder', 'negative'],
        ['source', 'a', 'rc-r', 'a'],
        ['rc-r', 'b', 'cap', 'positive'],
        ['cap', 'negative', 'source', 'b'],
        ['source', 'a', 'lamp', 'L1'],
        ['source', 'b', 'lamp', 'L2'],
        ['source', 'a', 'motor', 'positive'],
        ['source', 'b', 'motor', 'negative'],
        ['source', 'a', 'meter-r', 'a'],
        ['meter-r', 'b', 'meter', 'v-ohm-ma'],
        ['meter', 'com', 'source', 'b'],
      ],
    );
    const initial = through(doc, 2000);
    const events: ArduinoCircuitInputEvent[] = [
      {
        atMicroseconds: 2001,
        componentId: 'meter',
        property: 'measurementMode',
        value: 'dc-current',
      },
      {
        atMicroseconds: 4001,
        componentId: 'meter',
        property: 'measurementMode',
        value: 'dc-voltage',
      },
    ];
    const direct = through(doc, 8000, undefined, 256, events);
    const middle = through(doc, 3333, clone(initial.state!), 1, events);
    const continued = through(doc, 8000, clone(middle.state!), 1, events);
    expect(continued.state).toEqual(direct.state);
    expect(continued.result).toEqual(direct.result);
    expect(direct.state!.profile).toBe('electrothermal-v1');
    const physical = direct.state!.physicalState!;
    expect(physical.capacitors[0]!.voltageVolt).toBeGreaterThan(0);
    expect(physical.motors![0]!.motorAngularVelocityRadPerSecond).toBeGreaterThan(0);
    expect(
      physical.thermal.find((entry) => entry.componentId === 'lamp')!.temperatureCelsius,
    ).toBeGreaterThan(25);
    expect(physical.thermal.every((entry) => Number.isFinite(entry.accumulatedDamage))).toBe(true);
    expect(physical.multimeterFuses![0]!.fuseState).toBe('intact');
    expect(direct.state!.boards[0]!.runtime.variables.count).toBe(1);
    expect(direct.state!.boards[0]!.runtime.tones.d8?.frequencyHz).toBe(1000);
    expect(direct.state!.boards[0]!.loadedSource).toBe(toneSource);
    const fresh = through(doc, 0);
    expect(fresh.state!.reachedMicroseconds).toBe(0);
    expect(fresh.state!.physicalState!.capacitors[0]!.voltageVolt).toBe(0);
    expect(fresh.state!.boards[0]!.runtime.tones.d8).toBeUndefined();
  });
});
