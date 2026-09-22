import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  advanceElectronicsToHorizon,
  parseElectronicsEngineDocument,
  type ElectronicsEngineDocument,
  type ElectronicsTimedAdvanceResult,
} from '../engine';
import {
  ARDUINO_TEXT_COMMAND_SUPPORT,
  analyseArduinoSourceSupport,
  arduinoBlockSupport,
} from '../domain/arduino-capabilities';

const ULTRASONIC_HELPER = `float readUltrasonicCm(int triggerPin, int echoPin) {
  pinMode(triggerPin, OUTPUT);
  digitalWrite(triggerPin, LOW);
  delayMicroseconds(2);
  digitalWrite(triggerPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(triggerPin, LOW);
  pinMode(echoPin, INPUT);
  return pulseIn(echoPin, HIGH) * 0.01723;
}`;

function source(triggerPin: number, echoPin: number): string {
  return `float distanceCm = 0;
${ULTRASONIC_HELPER}
void setup() {
  distanceCm = readUltrasonicCm(${triggerPin}, ${echoPin});
}
void loop() { delay(100); }`;
}

function board(arduinoSource: string) {
  return {
    id: 'uno',
    kind: 'visual' as const,
    value: 5,
    position: { x: 0, y: 0 },
    componentTypeId: 'arduino-uno',
    pinIds: ['d2', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
    stateProperties: { arduinoSource },
  };
}

function parseDocument(value: unknown): ElectronicsEngineDocument {
  const parsed = parseElectronicsEngineDocument(value);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

function readyDistance(result: ElectronicsTimedAdvanceResult): number {
  expect(result.executionStatus, JSON.stringify(result.diagnostics)).toBe('ready');
  if (result.executionStatus !== 'ready') throw new Error('Expected ready timed result.');
  const serialized = result.state.continuation?.serializedState;
  if (!serialized) throw new Error('Expected timed continuation.');
  const clock = JSON.parse(serialized) as {
    readonly boards: readonly {
      readonly componentId: string;
      readonly runtime: { readonly variables: Readonly<Record<string, number>> };
    }[];
  };
  return clock.boards.find((entry) => entry.componentId === 'uno')!.runtime.variables.distanceCm!;
}

function hcSr04Document(): ElectronicsEngineDocument {
  return parseDocument({
    schemaVersion: 4,
    components: [
      board(source(13, 2)),
      {
        id: 'sonar',
        kind: 'visual',
        value: 0,
        position: { x: 80, y: 0 },
        componentTypeId: 'ultrasonic-hc-sr04',
        variantId: 'ultrasonic-hc-sr04',
        pinIds: ['vcc', 'trigger', 'echo', 'gnd'],
        stateProperties: { distanceMeters: 1 },
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

function pingDocument(): ElectronicsEngineDocument {
  return parseDocument({
    schemaVersion: 4,
    components: [
      board(source(13, 13)),
      {
        id: 'ping',
        kind: 'visual',
        value: 0,
        position: { x: 80, y: 0 },
        componentTypeId: 'ultrasonic-sensor',
        variantId: 'ultrasonic-sensor',
        pinIds: ['gnd', 'vcc', 'signal'],
        stateProperties: { distanceMeters: 1 },
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

describe('Ultrasonic block runtime adapter', () => {
  it('publishes only the exact helper as a limited supported adapter', () => {
    expect(arduinoBlockSupport('asa_ultrasonic').status).toBe('limited');
    expect(ARDUINO_TEXT_COMMAND_SUPPORT.readUltrasonicCm.status).toBe('limited');
    expect(
      analyseArduinoSourceSupport(source(13, 2)).some((entry) => entry.status === 'unsupported'),
    ).toBe(false);
    expect(
      analyseArduinoSourceSupport(
        'float customDistance(int pin) { return pin; } void setup(){ customDistance(2); }',
      ).some((entry) => entry.code === 'unknown-call' && entry.status === 'unsupported'),
    ).toBe(true);
  });

  it('keeps the exact asa_ultrasonic generated source contract', () => {
    const blocksSource = readFileSync(
      resolve(process.cwd(), 'apps/web/src/electronics/arduino-blocks.ts'),
      'utf8',
    );
    expect(blocksSource).toContain(
      "return `readUltrasonicCm(${field(block, 'TRIG', '7')}, ${field(block, 'ECHO', '8')})`",
    );
    expect(blocksSource).toContain('float readUltrasonicCm(int triggerPin, int echoPin) {');
    expect(blocksSource).toContain('return pulseIn(echoPin, HIGH) * 0.01723;');
  });

  it('runs the generated HC-SR04 helper at 1 m as approximately 100 cm', () => {
    const result = advanceElectronicsToHorizon(hcSr04Document(), {
      requestedHorizonMicroseconds: 20_000,
    });
    expect(readyDistance(result)).toBeCloseTo(99.934, 3);
  });

  it('runs the generated same-pin PING helper at 1 m as approximately 100 cm', () => {
    const result = advanceElectronicsToHorizon(pingDocument(), {
      requestedHorizonMicroseconds: 20_000,
    });
    expect(readyDistance(result)).toBeCloseTo(99.934, 3);
  });
});
