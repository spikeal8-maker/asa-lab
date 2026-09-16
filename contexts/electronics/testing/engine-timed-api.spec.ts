import { describe, expect, it } from 'vitest';
import {
  advanceElectronicsToHorizon,
  parseElectronicsEngineDocument,
  type ElectronicsEngineDocument,
} from '../engine';

function circuit(source: string): ElectronicsEngineDocument {
  const parsed = parseElectronicsEngineDocument({
    schemaVersion: 2,
    components: [
      {
        id: 'uno',
        kind: 'visual',
        value: 5,
        position: { x: 0, y: 0 },
        componentTypeId: 'arduino-uno',
        pinIds: ['d13', 'power-5v', 'power-3v3', 'power-gnd-1'],
        stateProperties: { arduinoSource: source },
      },
      { id: 'r', kind: 'resistor', value: 1000, position: { x: 100, y: 0 } },
    ],
    connections: [
      {
        id: 'w0',
        from: { componentId: 'uno', terminal: 'd13' },
        to: { componentId: 'r', terminal: 'a' },
      },
      {
        id: 'w1',
        from: { componentId: 'r', terminal: 'b' },
        to: { componentId: 'uno', terminal: 'power-gnd-1' },
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

const IDLE = 'void loop(){delay(100);}';

describe('Electronics canonical timed engine facade', () => {
  it('returns a serializable ready continuation at the requested microsecond horizon', () => {
    const document = circuit(`void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}${IDLE}`);
    const result = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: 10,
    });

    expect(result.executionStatus).toBe('ready');
    if (result.executionStatus !== 'ready') return;
    expect(result.committedHorizonMicroseconds).toBe(10);
    expect(result.continuation.committedHorizonMicroseconds).toBe(10);
    expect(result.continuation.clockContractVersion).toBe(1);
    expect(result.observation.solved).toBe(true);
    expect(result.observation.quality.passed).toBe(true);
    expect(() => JSON.parse(result.continuation.serializedState)).not.toThrow();
    expect(JSON.parse(JSON.stringify(result.continuation))).toEqual(result.continuation);
  });

  it('distinguishes yielded progress from a completed horizon and resumes deterministically', () => {
    const document = circuit(
      `void setup(){pinMode(13,OUTPUT);while(millis()<1){}digitalWrite(13,HIGH);}${IDLE}`,
    );
    const pending = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: 2000,
      maxEvents: 1,
    });

    expect(pending.executionStatus).toBe('yielded');
    if (pending.executionStatus !== 'yielded') return;
    expect(pending.observation).toBeNull();
    expect(pending.committedHorizonMicroseconds).toBeLessThan(2000);

    let current = pending;
    for (let iteration = 0; iteration < 8 && current.executionStatus === 'yielded'; iteration++) {
      current = advanceElectronicsToHorizon(document, {
        requestedHorizonMicroseconds: 2000,
        continuation: current.continuation,
        maxEvents: 1024,
      });
    }
    expect(current.executionStatus).toBe('ready');
    if (current.executionStatus === 'ready') {
      expect(current.committedHorizonMicroseconds).toBe(2000);
      expect(current.observation.quality.passed).toBe(true);
    }
  });

  it('preserves the last committed continuation when a new input operation is rejected', () => {
    const document = circuit(`void setup(){pinMode(13,OUTPUT);}${IDLE}`);
    const ready = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: 10,
    });
    expect(ready.executionStatus).toBe('ready');
    if (ready.executionStatus !== 'ready') return;

    const fault = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: 20,
      continuation: ready.continuation,
      inputEvents: [
        {
          atMicroseconds: 15,
          targetId: 'future-device',
          operation: 'future-operation',
          payload: true,
        },
      ],
    });
    expect(fault).toMatchObject({
      executionStatus: 'fault',
      committedHorizonMicroseconds: 10,
      continuation: ready.continuation,
      observation: null,
      diagnostics: [{ code: 'unsupported_timed_input' }],
    });
  });

  it('fails closed for timed profiles that remain owned by E-OPT-3C convergence', () => {
    const parsed = parseElectronicsEngineDocument({
      schemaVersion: 2,
      components: [
        { id: 'source', kind: 'source', value: 5, position: { x: 0, y: 0 } },
        { id: 'r', kind: 'resistor', value: 1000, position: { x: 100, y: 0 } },
      ],
      connections: [],
    });
    if (!parsed.ok) throw new Error(parsed.message);

    const result = advanceElectronicsToHorizon(parsed.document, {
      requestedHorizonMicroseconds: 1000,
    });
    expect(result.executionStatus).toBe('fault');
    expect(result.continuation).toBeNull();
    expect(result.diagnostics[0]?.code).toBe('invalid_board_count');
  });
});
