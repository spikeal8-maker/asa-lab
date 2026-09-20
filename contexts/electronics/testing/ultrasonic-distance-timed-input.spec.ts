import { describe, expect, it } from 'vitest';
import {
  advanceElectronicsToHorizon,
  parseElectronicsEngineDocument,
  type ElectronicsEngineDocument,
  type ElectronicsTimedAdvanceResult,
} from '../engine';

function parseDocument(value: unknown): ElectronicsEngineDocument {
  const parsed = parseElectronicsEngineDocument(value);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

function board(source: string) {
  return {
    id: 'uno',
    kind: 'visual' as const,
    value: 5,
    position: { x: 0, y: 0 },
    componentTypeId: 'arduino-uno',
    pinIds: ['d2', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
    stateProperties: { arduinoSource: source },
  };
}

function pingDocument(initialDistanceMeters = 0.5): ElectronicsEngineDocument {
  const source = `unsigned long duration=0;void setup(){pinMode(13,OUTPUT);
    digitalWrite(13,LOW);delayMicroseconds(2);digitalWrite(13,HIGH);
    delayMicroseconds(2);digitalWrite(13,LOW);pinMode(13,INPUT);
    duration=pulseIn(13,HIGH,30000);}void loop(){delay(100);}`;
  return parseDocument({
    schemaVersion: 4,
    components: [
      board(source),
      {
        id: 'ping',
        kind: 'visual',
        value: 0,
        position: { x: 80, y: 0 },
        componentTypeId: 'ultrasonic-sensor',
        variantId: 'ultrasonic-sensor',
        pinIds: ['gnd', 'vcc', 'signal'],
        stateProperties: { distanceMeters: initialDistanceMeters },
      },
    ],
    connections: [
      {
        id: 'vcc',
        from: { componentId: 'uno', terminal: 'power-5v' },
        to: { componentId: 'ping', terminal: 'vcc' },
      },
      {
        id: 'gnd',
        from: { componentId: 'uno', terminal: 'power-gnd-1' },
        to: { componentId: 'ping', terminal: 'gnd' },
      },
      {
        id: 'signal',
        from: { componentId: 'uno', terminal: 'd13' },
        to: { componentId: 'ping', terminal: 'signal' },
      },
    ],
  });
}

function hcSr04Document(initialDistanceMeters = 0.5): ElectronicsEngineDocument {
  const source = `unsigned long duration=0;void setup(){pinMode(13,OUTPUT);pinMode(2,INPUT);
    digitalWrite(13,LOW);delayMicroseconds(2);digitalWrite(13,HIGH);
    delayMicroseconds(10);digitalWrite(13,LOW);duration=pulseIn(2,HIGH,30000);}
    void loop(){delay(100);}`;
  return parseDocument({
    schemaVersion: 4,
    components: [
      board(source),
      {
        id: 'sonar',
        kind: 'visual',
        value: 0,
        position: { x: 80, y: 0 },
        componentTypeId: 'ultrasonic-hc-sr04',
        variantId: 'ultrasonic-hc-sr04',
        pinIds: ['vcc', 'trigger', 'echo', 'gnd'],
        stateProperties: { distanceMeters: initialDistanceMeters },
      },
    ],
    connections: [
      {
        id: 'vcc',
        from: { componentId: 'uno', terminal: 'power-5v' },
        to: { componentId: 'sonar', terminal: 'vcc' },
      },
      {
        id: 'gnd',
        from: { componentId: 'uno', terminal: 'power-gnd-1' },
        to: { componentId: 'sonar', terminal: 'gnd' },
      },
      {
        id: 'trigger',
        from: { componentId: 'uno', terminal: 'd13' },
        to: { componentId: 'sonar', terminal: 'trigger' },
      },
      {
        id: 'echo',
        from: { componentId: 'sonar', terminal: 'echo' },
        to: { componentId: 'uno', terminal: 'd2' },
      },
    ],
  });
}

function readyClock(result: ElectronicsTimedAdvanceResult): {
  readonly inputs: readonly {
    readonly atMicroseconds: number;
    readonly componentId: string;
    readonly property: string;
    readonly value: unknown;
  }[];
  readonly boards: readonly {
    readonly componentId: string;
    readonly runtime: { readonly variables: Readonly<Record<string, number>> };
  }[];
} {
  expect(result.executionStatus, JSON.stringify(result.diagnostics)).toBe('ready');
  if (result.executionStatus !== 'ready') throw new Error('Expected ready timed result.');
  const serialized = result.state.continuation?.serializedState;
  if (!serialized) throw new Error('Expected timed continuation.');
  return JSON.parse(serialized);
}

describe('ultrasonic canonical timed distance input', () => {
  it('applies a PING UI distance event through the canonical timed path before echo scheduling', () => {
    const result = advanceElectronicsToHorizon(pingDocument(), {
      requestedHorizonMicroseconds: 10_000,
      inputEvents: [
        {
          atMicroseconds: 1,
          targetId: 'ping',
          operation: 'distanceMeters',
          payload: 1,
        },
      ],
    });
    const clock = readyClock(result);
    expect(clock.inputs).toContainEqual({
      atMicroseconds: 1,
      componentId: 'ping',
      property: 'distanceMeters',
      value: 1,
    });
    expect(
      clock.boards.find((entry) => entry.componentId === 'uno')!.runtime.variables.duration,
    ).toBe(5800);
  });

  it('applies an HC-SR04 UI distance event through the same canonical timed path', () => {
    const result = advanceElectronicsToHorizon(hcSr04Document(), {
      requestedHorizonMicroseconds: 10_000,
      inputEvents: [
        {
          atMicroseconds: 1,
          targetId: 'sonar',
          operation: 'distanceMeters',
          payload: 1,
        },
      ],
    });
    const clock = readyClock(result);
    expect(clock.inputs).toContainEqual({
      atMicroseconds: 1,
      componentId: 'sonar',
      property: 'distanceMeters',
      value: 1,
    });
    expect(
      clock.boards.find((entry) => entry.componentId === 'uno')!.runtime.variables.duration,
    ).toBe(5800);
  });
});
