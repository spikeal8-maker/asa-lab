import { describe, expect, it } from 'vitest';
import {
  advanceArduinoCircuitClock,
  type ArduinoCircuitClockState,
} from '../domain/arduino-circuit-scheduler.js';
import { parseElectronicsDocument } from '../domain/document.js';

export function analogFixture(
  source = 'void setup(){Serial.begin(9600);}void loop(){Serial.println(analogRead(A0));delay(1);}',
) {
  const parsed = parseElectronicsDocument({
    schemaVersion: 2,
    components: [
      {
        id: 'uno',
        kind: 'visual',
        value: 5,
        position: { x: 0, y: 0 },
        componentTypeId: 'arduino-uno',
        pinIds: ['d13', 'power-3v3', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'power-5v', 'power-gnd-1'],
        stateProperties: { arduinoSource: source },
      },
      { id: 'top', kind: 'resistor', value: 1000, position: { x: 0, y: 0 } },
      { id: 'bottom', kind: 'resistor', value: 1000, position: { x: 0, y: 0 } },
    ],
    connections: [
      ['uno', 'power-5v', 'top', 'a'],
      ['top', 'b', 'bottom', 'a'],
      ['bottom', 'b', 'uno', 'power-gnd-1'],
      ['uno', 'a0', 'top', 'b'],
    ].map(([a, b, c, d], i) => ({
      id: 'w' + i,
      from: { componentId: a, terminal: b },
      to: { componentId: c, terminal: d },
    })),
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}
export function analogThrough(
  document: ReturnType<typeof analogFixture>,
  target = 4000,
  state?: ArduinoCircuitClockState,
  budget = 256,
) {
  for (let i = 0; i < 10000; i++) {
    const next = advanceArduinoCircuitClock(document, target, state, { maxClockEvents: budget });
    if (next.executionStatus !== 'yielded') return next;
    state = JSON.parse(JSON.stringify(next.state));
  }
  throw new Error('clock failed to converge');
}
describe('real analog Serial circuit', () => {
  it('prints the solved divider voltage as ADC codes', () => {
    const result = analogThrough(analogFixture());
    expect(result.executionStatus, JSON.stringify(result.diagnostics)).toBe('ready');
    expect(result.result?.solved).toBe(true);
    const voltage = result.result!.components.find((c) => c.componentId === 'uno')!.terminalVoltages
      .a0!;
    const code = Math.round((voltage / 5) * 1023);
    expect(code).toBe(511);
    expect(result.state!.boards[0]!.runtime.serial!.tx.map((e) => e.text)).toEqual(
      Array(4).fill(code + '\n'),
    );
  });
});

it.each([
  ['A0', 'a0'],
  ['0', 'a0'],
  ['14', 'a0'],
  ['A1', 'a1'],
  ['1', 'a1'],
  ['15', 'a1'],
  ['A2', 'a2'],
  ['2', 'a2'],
  ['16', 'a2'],
  ['A3', 'a3'],
  ['3', 'a3'],
  ['17', 'a3'],
  ['A4', 'a4'],
  ['4', 'a4'],
  ['18', 'a4'],
  ['A5', 'a5'],
  ['5', 'a5'],
  ['19', 'a5'],
])('measures %s with an actual grounded/supplied/divider net', (selector, pin) => {
  for (const [terminal, expected] of [
    ['power-gnd-1', 0],
    ['power-5v', 1023],
    ['a0', 511],
  ] as const) {
    let doc = analogFixture(
      `void setup(){Serial.begin(9600);Serial.println(analogRead(${selector}));}void loop(){delay(100);}`,
    );
    if (pin !== 'a0')
      doc = {
        ...doc,
        connections: [
          ...doc.connections,
          {
            id: 'test',
            from: { componentId: 'uno', terminal: pin! },
            to: { componentId: 'uno', terminal },
          },
        ],
      };
    else if (terminal !== 'a0')
      doc = {
        ...doc,
        connections: [
          ...doc.connections.slice(0, -1),
          {
            id: 'test',
            from: { componentId: 'uno', terminal: pin },
            to: { componentId: 'uno', terminal },
          },
        ],
      };
    const result = analogThrough(doc);
    expect(result.executionStatus, JSON.stringify(result.diagnostics)).toBe('ready');
    expect(result.state!.boards[0]!.runtime.serial!.tx.map((e) => e.text)).toEqual([
      expected + '\n',
    ]);
  }
});

it('varies only unconnected ADC observations deterministically without changing electrical frames', () => {
  const doc0 = analogFixture();
  const doc = { ...doc0, connections: doc0.connections.slice(0, -1) };
  const result = analogThrough(doc, 9000);
  const tx = result.state!.boards[0]!.runtime.serial!.tx.map((e) => Number(e.text));
  expect(new Set(tx).size).toBeGreaterThan(3);
  expect(tx.every((n) => Number.isInteger(n) && n >= 0 && n <= 1023)).toBe(true);
  for (const budget of [1, 7]) expect(analogThrough(doc, 9000, undefined, budget)).toEqual(result);
  const first = analogThrough(doc, 2123, undefined, 1);
  const split = analogThrough(doc, 9000, JSON.parse(JSON.stringify(first.state)), 7);
  expect(split.state).toEqual(result.state);
  expect(split.result).toEqual(result.result);
  const idle = {
    ...doc,
    components: doc.components.map((c) =>
      c.id === 'uno'
        ? { ...c, stateProperties: { arduinoSource: 'void setup(){}void loop(){delay(1);}' } }
        : c,
    ),
  };
  const electricalA = { ...analogThrough(idle, 9000).result! };
  delete electricalA.controllerState;
  const electricalB = { ...result.result! };
  delete electricalB.controllerState;
  expect(JSON.stringify(electricalA)).toBe(JSON.stringify(electricalB));
});

it.each(['INPUT_PULLUP', 'OUTPUT'] as const)(
  'suppresses educational ADC for %s and an attached INPUT',
  (mode) => {
    const base = analogFixture(
      `void setup(){Serial.begin(9600);pinMode(A1,${mode});${mode === 'OUTPUT' ? 'digitalWrite(A1,HIGH);' : ''}}void loop(){Serial.println(analogRead(A0));delay(1);}`,
    );
    const doc = {
      ...base,
      connections: [
        ...base.connections.slice(0, -1),
        {
          id: 'pins',
          from: { componentId: 'uno', terminal: 'a0' },
          to: { componentId: 'uno', terminal: 'a1' },
        },
      ],
    };
    const result = analogThrough(doc);
    expect(result.executionStatus, JSON.stringify(result.diagnostics)).toBe('ready');
    expect(result.state!.boards[0]!.runtime.serial!.tx.map((e) => e.text)).toEqual(
      Array(4).fill('1023\n'),
    );
  },
);
it('classifies dangling A0-A1 and breadboard contacts from prepared nets, not solver islands', () => {
  const base = analogFixture();
  const doc = {
    ...base,
    components: [
      ...base.components,
      {
        id: 'breadboard',
        kind: 'breadboard' as const,
        value: 0,
        position: { x: 0, y: 0 },
        pinIds: ['h1', 'h2'],
        internalConnections: [['h1', 'h2']] as const,
      },
    ],
    connections: [
      ...base.connections.slice(0, -1),
      {
        id: 'pins',
        from: { componentId: 'uno', terminal: 'a0' },
        to: { componentId: 'uno', terminal: 'a1' },
      },
      {
        id: 'hole',
        from: { componentId: 'uno', terminal: 'a1' },
        to: { componentId: 'breadboard', terminal: 'h1' },
      },
    ],
  };
  const result = analogThrough(doc);
  expect(result.executionStatus, JSON.stringify(result.diagnostics)).toBe('ready');
  expect(new Set(result.state!.boards[0]!.runtime.serial!.tx.map((e) => e.text)).size).toBe(4);
});
it('never models an external passive/open-switch net as unconnected', () => {
  const base = analogFixture();
  const doc = {
    ...base,
    connections: base.connections.slice(0, -1).concat([
      {
        id: 'passive',
        from: { componentId: 'uno', terminal: 'a0' },
        to: { componentId: 'top', terminal: 'b' },
      },
    ]),
  };
  expect(
    new Set(analogThrough(doc).state!.boards[0]!.runtime.serial!.tx.map((e) => e.text)),
  ).toEqual(new Set(['511\n']));
});

it('retains legacy raw numeric behavior and owned ADC fallback', async () => {
  const { arduinoAnalogReading, createOwnedClockedArduinoRuntime } =
    await import('../domain/arduino-program-runtime.js');
  const { createArduinoCircuitClockExecutor } =
    await import('../domain/arduino-circuit-scheduler.js');
  expect(arduinoAnalogReading({ a0: 0 }, 'a0')).toBe(0);
  expect(arduinoAnalogReading({ a0: 2.5 }, 'a0')).toBe(512);
  const base = analogFixture();
  const doc = { ...base, connections: base.connections.slice(0, -1) };
  expect(
    createOwnedClockedArduinoRuntime(doc.components[0]!.stateProperties!.arduinoSource as string),
  ).toBeNull();
  const executor = createArduinoCircuitClockExecutor(doc);
  let actual;
  do {
    actual = executor(9000, actual?.state ?? undefined, { maxClockEvents: 7 });
  } while (actual.executionStatus === 'yielded');
  expect(actual.state).toEqual(analogThrough(doc, 9000).state);
  expect(actual.result).toEqual(analogThrough(doc, 9000).result);
});

it('prints timed wiper, diode and four-button resistor ladder voltages from real solves', () => {
  const base = analogFixture();
  const uno = base.components[0]!;
  const connect = (rows: string[][]) =>
    rows.map(([a, b, c, d], i) => ({
      id: 'w' + i,
      from: { componentId: a!, terminal: b! },
      to: { componentId: c!, terminal: d! },
    }));
  const pot = {
    ...base,
    components: [
      uno,
      {
        id: 'pot',
        kind: 'potentiometer' as const,
        value: 10000,
        position: { x: 0, y: 0 },
        wiperPosition: 0.5,
      },
    ],
    connections: connect([
      ['uno', 'power-5v', 'pot', 'a'],
      ['uno', 'power-gnd-1', 'pot', 'b'],
      ['uno', 'a0', 'pot', 'wiper'],
    ]),
  };
  const inputs = [
    { atMicroseconds: 1500, componentId: 'pot', property: 'wiperPosition' as const, value: 0.75 },
  ];
  let result = advanceArduinoCircuitClock(pot, 4000, undefined, { inputs });
  expect(result.executionStatus, JSON.stringify(result.diagnostics)).toBe('ready');
  expect(result.state!.boards[0]!.runtime.serial!.tx.map((e) => e.text)).toEqual([
    '511\n',
    '511\n',
    '256\n',
    '256\n',
  ]);
  const diode = {
    ...base,
    components: [
      uno,
      base.components[1]!,
      { id: 'diode', kind: 'diode' as const, value: 0.7, position: { x: 0, y: 0 } },
    ],
    connections: connect([
      ['uno', 'power-5v', 'top', 'a'],
      ['top', 'b', 'diode', 'a'],
      ['diode', 'b', 'uno', 'power-gnd-1'],
      ['uno', 'a0', 'diode', 'a'],
    ]),
  };
  result = analogThrough(diode);
  expect(result.executionStatus, JSON.stringify(result.diagnostics)).toBe('ready');
  const voltage = result.result!.components.find((c) => c.componentId === 'uno')!.terminalVoltages
    .a0!;
  expect(voltage).toBeGreaterThan(0.4);
  expect(voltage).toBeLessThan(0.9);
  expect(result.state!.boards[0]!.runtime.serial!.tx.map((e) => e.text)).toEqual(
    Array(4).fill(Math.round((voltage / 5) * 1023) + '\n'),
  );
  const resistances = [100, 1000, 3000, 10000];
  const ladder = {
    ...base,
    components: [
      uno,
      base.components[1]!,
      ...resistances.flatMap((value, i) => [
        { id: 'r' + i, kind: 'resistor' as const, value, position: { x: 0, y: 0 } },
        {
          id: 'key' + i,
          kind: 'button' as const,
          value: 0,
          state: false,
          position: { x: 0, y: 0 },
        },
      ]),
    ],
    connections: connect([
      ['uno', 'power-5v', 'top', 'a'],
      ['uno', 'a0', 'top', 'b'],
      ...resistances.flatMap((_, i) => [
        ['top', 'b', 'r' + i, 'a'],
        ['r' + i, 'b', 'key' + i, 'a'],
        ['key' + i, 'b', 'uno', 'power-gnd-1'],
      ]),
    ]),
  };
  const events = resistances.flatMap((_, i) => [
    {
      atMicroseconds: 500 + i * 1000,
      componentId: 'key' + i,
      property: 'state' as const,
      value: true,
    },
    ...(i
      ? [
          {
            atMicroseconds: 500 + i * 1000,
            componentId: 'key' + (i - 1),
            property: 'state' as const,
            value: false,
          },
        ]
      : []),
  ]);
  result = advanceArduinoCircuitClock(ladder, 4500, undefined, { inputs: events });
  expect(result.executionStatus, JSON.stringify(result.diagnostics)).toBe('ready');
  expect(result.state!.boards[0]!.runtime.serial!.tx.map((e) => e.text)).toEqual([
    '1023\n',
    '93\n',
    '512\n',
    '767\n',
    '930\n',
  ]);
});

it('uses a documented fixed 1ms coordinate bucket, stable board/pin identities and no legacy inference', async () => {
  const { unconnectedAdcReading } = await import('../domain/arduino-adc-observation.js');
  const { arduinoAnalogReading } = await import('../domain/arduino-program-runtime.js');
  const context = {
    boardId: 'uno',
    atMicroseconds: 0,
    unconnected: new Set(['a0', 'a1', 'a2', 'a3', 'a4', 'a5']),
  };
  expect(unconnectedAdcReading(context, 'a0')).toBe(
    unconnectedAdcReading({ ...context, atMicroseconds: 999 }, 'a0'),
  );
  expect(unconnectedAdcReading(context, 'a0')).not.toBe(
    unconnectedAdcReading({ ...context, atMicroseconds: 1000 }, 'a0'),
  );
  expect(
    new Set([...context.unconnected].map((pin) => unconnectedAdcReading(context, pin))).size,
  ).toBe(6);
  expect(unconnectedAdcReading(context, 'a0')).not.toBe(
    unconnectedAdcReading({ ...context, boardId: 'second' }, 'a0'),
  );
  for (let bucket = 0; bucket < 2000; bucket++) {
    const reading = unconnectedAdcReading({ ...context, atMicroseconds: bucket * 1000 }, 'a5');
    expect(Number.isInteger(reading) && reading >= 0 && reading <= 1023).toBe(true);
  }
  expect(arduinoAnalogReading({}, 'a0')).toBe(0);
});

it('classifies the live reset MCU modes rather than its previous OUTPUT state', () => {
  const base = analogFixture(
    'void setup(){pinMode(A0,OUTPUT);digitalWrite(A0,HIGH);}void loop(){delay(1);}',
  );
  const old = { ...base, connections: base.connections.slice(0, -1) };
  const before = analogThrough(old, 1000);
  const reset = {
    ...old,
    components: old.components.map((c) =>
      c.id === 'uno'
        ? {
            ...c,
            stateProperties: {
              arduinoSource:
                'void setup(){Serial.begin(9600);}void loop(){Serial.println(analogRead(A0));delay(1);}',
            },
          }
        : c,
    ),
  };
  const after = analogThrough(reset, 5000, JSON.parse(JSON.stringify(before.state)), 1);
  expect(after.executionStatus, JSON.stringify(after.diagnostics)).toBe('ready');
  const values = after.state!.boards[0]!.runtime.serial!.tx.map((e) => Number(e.text));
  expect(new Set(values).size).toBeGreaterThan(2);
  expect(values[0]).not.toBe(1023);
});
