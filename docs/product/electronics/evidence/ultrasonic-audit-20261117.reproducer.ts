import { describe, it, expect } from 'vitest';
import {
  advanceElectronicsToHorizon,
  parseElectronicsEngineDocument,
} from '../../../../contexts/electronics/engine';
import {
  initialPingUltrasonicRuntimeState,
  observePingUltrasonicSignal,
} from '../../../../contexts/electronics/domain/models/ping-ultrasonic-runtime';
import { solveCircuitWithHeldArduino } from '../../../../contexts/electronics/domain/solver';
import {
  compileCircuit,
  verifyCircuitQuality,
} from '../../../../contexts/electronics/domain/simulation';
import { arduinoSnapshotFromState } from '../../../../contexts/electronics/domain/arduino-model';
import { advanceHcSr04Due } from '../../../../contexts/electronics/domain/models/hc-sr04-runtime';
import { advancePingUltrasonicDue } from '../../../../contexts/electronics/domain/models/ping-ultrasonic-runtime';

function document(
  kind: 'hc' | 'ping',
  options: {
    omit?: string;
    source?: string;
    distance?: number;
    echoAvailable?: boolean;
    supply?: string;
  } = {},
) {
  const id = 'sensor';
  const source =
    options.source ??
    (kind === 'hc'
      ? 'unsigned long duration=999;void setup(){pinMode(13,OUTPUT);pinMode(2,INPUT);digitalWrite(13,LOW);delayMicroseconds(2);digitalWrite(13,HIGH);delayMicroseconds(10);digitalWrite(13,LOW);duration=pulseIn(2,HIGH,30000);}void loop(){delay(100);}'
      : 'unsigned long duration=999;void setup(){pinMode(13,OUTPUT);digitalWrite(13,LOW);delayMicroseconds(2);digitalWrite(13,HIGH);delayMicroseconds(2);digitalWrite(13,LOW);pinMode(13,INPUT);duration=pulseIn(13,HIGH,30000);}void loop(){delay(100);}');
  const type = kind === 'hc' ? 'ultrasonic-hc-sr04' : 'ultrasonic-sensor';
  const wires = [
    {
      id: 'vcc',
      from: { componentId: 'uno', terminal: options.supply ?? 'power-5v' },
      to: { componentId: id, terminal: 'vcc' },
    },
    {
      id: 'gnd',
      from: { componentId: 'uno', terminal: 'power-gnd-1' },
      to: { componentId: id, terminal: 'gnd' },
    },
    ...(kind === 'hc'
      ? [
          {
            id: 'trigger',
            from: { componentId: 'uno', terminal: 'd13' },
            to: { componentId: id, terminal: 'trigger' },
          },
          {
            id: 'echo',
            from: { componentId: id, terminal: 'echo' },
            to: { componentId: 'uno', terminal: 'd2' },
          },
        ]
      : [
          {
            id: 'signal',
            from: { componentId: 'uno', terminal: 'd13' },
            to: { componentId: id, terminal: 'signal' },
          },
        ]),
  ].filter((w) => w.id !== options.omit);
  const result = parseElectronicsEngineDocument({
    schemaVersion: 4,
    components: [
      {
        id: 'uno',
        kind: 'visual',
        value: 5,
        position: { x: 0, y: 0 },
        componentTypeId: 'arduino-uno',
        pinIds: ['d2', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
        stateProperties: { arduinoSource: source },
      },
      {
        id,
        kind: 'visual',
        value: 0,
        position: { x: 80, y: 0 },
        componentTypeId: type,
        variantId: type,
        pinIds: kind === 'hc' ? ['vcc', 'trigger', 'echo', 'gnd'] : ['gnd', 'vcc', 'signal'],
        stateProperties: {
          distanceMeters: options.distance ?? 1,
          ...(options.echoAvailable === undefined ? {} : { echoAvailable: options.echoAvailable }),
        },
      },
    ],
    connections: wires,
  });
  if (!result.ok) throw new Error(result.message);
  return result.document;
}
function run(doc: ReturnType<typeof document>, horizon = 40000, inputEvents: any[] = []) {
  let result = advanceElectronicsToHorizon(doc, {
    requestedHorizonMicroseconds: horizon,
    maxEvents: 1024,
    inputEvents,
  });
  let loops = 0;
  while (result.executionStatus === 'yielded' && loops++ < 100)
    result = advanceElectronicsToHorizon(doc, {
      requestedHorizonMicroseconds: horizon,
      maxEvents: 1024,
      state: result.state,
    });
  if (result.executionStatus !== 'ready')
    return { status: result.executionStatus, diagnostics: result.diagnostics };
  const clock = JSON.parse(result.state.continuation!.serializedState);
  return {
    status: result.executionStatus,
    variables: clock.boards[0].runtime.variables,
    sensor: clock.hcSr04?.[0]?.runtime ?? clock.pingUltrasonic?.[0]?.runtime,
    diagnostics: result.diagnostics,
  };
}
describe('independent ultrasonic runtime diagnostic observations', () => {
  it('records correct and missing power wire cases', () => {
    for (const kind of ['hc', 'ping'] as const) {
      for (const options of [
        {},
        { omit: 'gnd' },
        { omit: 'vcc' },
        { supply: 'power-3v3' },
        { echoAvailable: false },
      ])
        console.log(JSON.stringify({ kind, options, result: run(document(kind, options)) }));
    }
    expect(run(document('hc')).variables.duration).toBe(5800);
    expect(run(document('ping')).variables.duration).toBe(5800);
  });
  it('checks PING direct runtime maximum distance', () => {
    let state = initialPingUltrasonicRuntimeState();
    state = observePingUltrasonicSignal(state, 0, true, false, 4).state;
    state = observePingUltrasonicSignal(state, 1, true, true, 4).state;
    state = observePingUltrasonicSignal(state, 3, true, false, 4).state;
    console.log(JSON.stringify({ directPingDistance4: state }));
    console.log(JSON.stringify({ documentPingDistance4: run(document('ping', { distance: 4 })) }));
  });
  it('records supply loss at exact echo edge', () => {
    for (const kind of ['hc', 'ping'] as const) {
      const base = document(kind);
      const parsed = parseElectronicsEngineDocument({
        ...base,
        components: [
          ...base.components,
          { id: 'powerSwitch', kind: 'switch', value: 0, position: { x: 0, y: 30 }, state: true },
        ],
        connections: [
          ...base.connections.filter((w) => w.id !== 'vcc'),
          {
            id: 'sw1',
            from: { componentId: 'uno', terminal: 'power-5v' },
            to: { componentId: 'powerSwitch', terminal: 'a' },
          },
          {
            id: 'sw2',
            from: { componentId: 'powerSwitch', terminal: 'b' },
            to: { componentId: 'sensor', terminal: 'vcc' },
          },
        ],
      });
      if (!parsed.ok) throw new Error(parsed.message);
      const baseline = run(parsed.document);
      const edge = baseline.sensor.lastEchoStartMicroseconds;
      console.log(JSON.stringify({ kind, switchBaseline: baseline, edge }));
      for (const atMicroseconds of [edge - 1, edge, edge + 1])
        console.log(
          JSON.stringify({
            kind,
            supplyLossAt: atMicroseconds,
            result: run(parsed.document, 40000, [
              { atMicroseconds, targetId: 'powerSwitch', operation: 'state', payload: false },
            ]),
          }),
        );
    }
  });
  it('records miswiring and setup versus loop', () => {
    for (const kind of ['hc', 'ping'] as const) {
      const base = document(kind);
      for (const wiring of [
        'reversed-supply',
        'signal-grounded',
        ...(kind === 'hc' ? ['swapped-trigger-echo'] : []),
      ]) {
        const wires = base.connections.map((w) => {
          if (wiring === 'reversed-supply' && (w.id === 'gnd' || w.id === 'vcc'))
            return { ...w, to: { ...w.to, terminal: w.to.terminal === 'gnd' ? 'vcc' : 'gnd' } };
          if (wiring === 'signal-grounded' && (w.id === 'trigger' || w.id === 'signal'))
            return { ...w, from: { componentId: 'uno', terminal: 'power-gnd-1' } };
          if (wiring === 'swapped-trigger-echo' && w.id === 'trigger')
            return { ...w, to: { ...w.to, terminal: 'echo' } };
          if (wiring === 'swapped-trigger-echo' && w.id === 'echo')
            return { ...w, from: { ...w.from, terminal: 'trigger' } };
          return w;
        });
        const parsed = parseElectronicsEngineDocument({ ...base, connections: wires });
        if (!parsed.ok) throw new Error(parsed.message);
        console.log(JSON.stringify({ kind, wiring, result: run(parsed.document) }));
      }
      const setupSource = String(base.components[0].stateProperties!.arduinoSource);
      const loopSource = setupSource
        .replace('void setup(){', 'void setup(){}void loop(){')
        .replace('}void loop(){delay(100);}', 'delay(100);}');
      console.log(
        JSON.stringify({
          kind,
          program: 'measurement-in-loop',
          result: run(document(kind, { source: loopSource })),
        }),
      );
    }
  });
  it.each(['hc', 'ping'] as const)(
    'REGRESSION correct-behaviour oracle: %s must not measure without a GND wire',
    (kind) => {
      expect(run(document(kind, { omit: 'gnd' })).variables.duration).toBe(0);
    },
  );
  it('records a benign ten kilohm output load', () => {
    for (const kind of ['hc', 'ping'] as const) {
      const base = document(kind);
      const parsed = parseElectronicsEngineDocument({
        ...base,
        components: [
          ...base.components,
          { id: 'load', kind: 'resistor', value: 10000, position: { x: 0, y: 50 } },
        ],
        connections: [
          ...base.connections,
          {
            id: 'loadA',
            from: { componentId: 'sensor', terminal: kind === 'hc' ? 'echo' : 'signal' },
            to: { componentId: 'load', terminal: 'a' },
          },
          {
            id: 'loadB',
            from: { componentId: 'load', terminal: 'b' },
            to: { componentId: 'uno', terminal: 'power-gnd-1' },
          },
        ],
      });
      if (!parsed.ok) throw new Error(parsed.message);
      console.log(JSON.stringify({ kind, loadOhms: 10000, result: run(parsed.document) }));
      const before = advanceElectronicsToHorizon(parsed.document, {
        requestedHorizonMicroseconds: 100,
        maxEvents: 1024,
      });
      if (before.executionStatus !== 'ready') throw new Error('Expected ready before Echo');
      const clock = JSON.parse(before.state.continuation!.serializedState);
      const sensor = (clock.hcSr04 ?? clock.pingUltrasonic)[0].runtime;
      const at = sensor.echoStartMicroseconds;
      const high =
        kind === 'hc'
          ? advanceHcSr04Due(sensor, at).state
          : advancePingUltrasonicDue(sensor, at).state;
      const raw = solveCircuitWithHeldArduino(
        parsed.document as any,
        at / 1000,
        new Map([['uno', arduinoSnapshotFromState(clock.boards[0].runtime)]]),
        kind === 'hc' ? new Map([['sensor', high as any]]) : undefined,
        kind === 'ping' ? new Map([['sensor', high as any]]) : undefined,
      );
      const quality = verifyCircuitQuality(
        parsed.document as any,
        compileCircuit(parsed.document as any),
        raw,
        { simulationTimeMs: at / 1000 },
      );
      console.log(
        JSON.stringify({
          kind,
          loadOhms: 10000,
          atMicroseconds: at,
          rawSolved: raw.solved,
          quality,
          components: raw.components.filter(
            (x) => x.componentId === 'sensor' || x.componentId === 'load',
          ),
        }),
      );
    }
  });
  it.each(['hc', 'ping'] as const)(
    'REGRESSION correct-behaviour oracle: %s must measure with a ten kilohm output load',
    (kind) => {
      const base = document(kind);
      const parsed = parseElectronicsEngineDocument({
        ...base,
        components: [
          ...base.components,
          { id: 'load', kind: 'resistor', value: 10000, position: { x: 0, y: 50 } },
        ],
        connections: [
          ...base.connections,
          {
            id: 'loadA',
            from: { componentId: 'sensor', terminal: kind === 'hc' ? 'echo' : 'signal' },
            to: { componentId: 'load', terminal: 'a' },
          },
          {
            id: 'loadB',
            from: { componentId: 'load', terminal: 'b' },
            to: { componentId: 'uno', terminal: 'power-gnd-1' },
          },
        ],
      });
      if (!parsed.ok) throw new Error(parsed.message);
      const result = run(parsed.document);
      expect(result.status).toBe('ready');
      expect(result.variables.duration).toBeCloseTo(5800, 0);
    },
  );
  it.each(['hc', 'ping'] as const)(
    'REGRESSION correct-behaviour oracle: %s must cancel echo when power is cut at its start',
    (kind) => {
      const base = document(kind);
      const parsed = parseElectronicsEngineDocument({
        ...base,
        components: [
          ...base.components,
          { id: 'powerSwitch', kind: 'switch', value: 0, position: { x: 0, y: 30 }, state: true },
        ],
        connections: [
          ...base.connections.filter((w) => w.id !== 'vcc'),
          {
            id: 'sw1',
            from: { componentId: 'uno', terminal: 'power-5v' },
            to: { componentId: 'powerSwitch', terminal: 'a' },
          },
          {
            id: 'sw2',
            from: { componentId: 'powerSwitch', terminal: 'b' },
            to: { componentId: 'sensor', terminal: 'vcc' },
          },
        ],
      });
      if (!parsed.ok) throw new Error(parsed.message);
      const baseline = run(parsed.document);
      expect(baseline.variables.duration).toBe(5800);
      const atMicroseconds = baseline.sensor.lastEchoStartMicroseconds;
      const result = run(parsed.document, 40000, [
        { atMicroseconds, targetId: 'powerSwitch', operation: 'state', payload: false },
      ]);
      expect(result.status).toBe('ready');
      expect(result.variables.duration).toBe(0);
    },
  );
});
