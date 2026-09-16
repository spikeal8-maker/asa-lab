import { describe, expect, it } from 'vitest';
import {
  advanceElectronicsToHorizon,
  parseElectronicsEngineDocument,
  pauseElectronicsTimedState,
  resetElectronicsTimedState,
  resumeElectronicsTimedState,
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
    expect(result.state.continuation!.committedHorizonMicroseconds).toBe(10);
    expect(result.state.continuation!.clockContractVersion).toBe(1);
    expect(result.observation.solved).toBe(true);
    expect(result.observation.quality.passed).toBe(true);
    expect(() => JSON.parse(result.state.continuation!.serializedState)).not.toThrow();
    expect(JSON.parse(JSON.stringify(result.state))).toEqual(result.state);
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
        state: current.state,
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
      state: ready.state,
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
      state: ready.state,
      observation: null,
      diagnostics: [{ code: 'unsupported_timed_input' }],
    });
  });

  it('freezes canonical time while paused, resumes from the same state and resets to time zero', () => {
    const document = circuit(`void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}${IDLE}`);
    const ready = advanceElectronicsToHorizon(document, { requestedHorizonMicroseconds: 10 });
    expect(ready.executionStatus).toBe('ready');
    if (ready.executionStatus !== 'ready') return;

    const paused = pauseElectronicsTimedState(ready.state);
    expect(paused.lifecycle).toBe('paused');
    expect(paused.continuation).toEqual(ready.state.continuation);
    const blocked = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: 20,
      state: paused,
    });
    expect(blocked).toMatchObject({
      executionStatus: 'fault',
      committedHorizonMicroseconds: 10,
      state: paused,
      diagnostics: [{ code: 'timed_state_paused' }],
    });

    const resumed = resumeElectronicsTimedState(paused);
    const advanced = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: 20,
      state: resumed,
    });
    expect(advanced.executionStatus).toBe('ready');
    expect(advanced.committedHorizonMicroseconds).toBe(20);
    expect(resetElectronicsTimedState()).toEqual({
      version: 1,
      lifecycle: 'running',
      continuation: null,
    });
  });

  it('advances a circuit-only profile without requiring an Arduino board', () => {
    const parsed = parseElectronicsEngineDocument({
      schemaVersion: 4,
      components: [
        { id: 'source', kind: 'source', value: 5, position: { x: 0, y: 0 } },
        { id: 'r', kind: 'resistor', value: 1000, position: { x: 100, y: 0 } },
      ],
      connections: [
        {
          id: 'positive',
          from: { componentId: 'source', terminal: 'a' },
          to: { componentId: 'r', terminal: 'a' },
        },
        {
          id: 'negative',
          from: { componentId: 'r', terminal: 'b' },
          to: { componentId: 'source', terminal: 'b' },
        },
      ],
    });
    if (!parsed.ok) throw new Error(parsed.message);

    const result = advanceElectronicsToHorizon(parsed.document, {
      requestedHorizonMicroseconds: 1000,
    });
    expect(result.executionStatus).toBe('ready');
    if (result.executionStatus !== 'ready') return;
    expect(result.committedHorizonMicroseconds).toBe(1000);
    expect(result.observation.solved).toBe(true);
    expect(result.observation.quality.passed).toBe(true);
    expect(JSON.parse(result.state.continuation!.serializedState).boards).toEqual([]);
  });

  it('advances circuit-only RC physics through canonical barriers and resumes deterministically', () => {
    const parsed = parseElectronicsEngineDocument({
      schemaVersion: 4,
      components: [
        { id: 'source', kind: 'source', value: 5, position: { x: 0, y: 0 } },
        { id: 'r1', kind: 'resistor', value: 1000, position: { x: 100, y: 0 } },
        {
          id: 'c1',
          kind: 'visual',
          value: 100,
          position: { x: 200, y: 0 },
          componentTypeId: 'electrolytic-capacitor',
          pinIds: ['negative', 'positive'],
          stateProperties: { initialVoltageVolt: 0, voltageRatingVolt: 25 },
        },
      ],
      connections: [
        {
          id: 'w1',
          from: { componentId: 'source', terminal: 'a' },
          to: { componentId: 'r1', terminal: 'a' },
        },
        {
          id: 'w2',
          from: { componentId: 'r1', terminal: 'b' },
          to: { componentId: 'c1', terminal: 'positive' },
        },
        {
          id: 'w3',
          from: { componentId: 'c1', terminal: 'negative' },
          to: { componentId: 'source', terminal: 'b' },
        },
      ],
    });
    if (!parsed.ok) throw new Error(parsed.message);

    const pending = advanceElectronicsToHorizon(parsed.document, {
      requestedHorizonMicroseconds: 100_000,
      maxEvents: 8,
    });
    expect(pending.executionStatus).toBe('yielded');
    if (pending.executionStatus !== 'yielded') return;
    expect(pending.observation).toBeNull();
    expect(pending.committedHorizonMicroseconds).toBeLessThan(100_000);

    const resumed = advanceElectronicsToHorizon(parsed.document, {
      requestedHorizonMicroseconds: 100_000,
      state: pending.state,
      maxEvents: 1024,
    });
    const direct = advanceElectronicsToHorizon(parsed.document, {
      requestedHorizonMicroseconds: 100_000,
      maxEvents: 1024,
    });
    expect(resumed.executionStatus).toBe('ready');
    expect(direct.executionStatus).toBe('ready');
    if (resumed.executionStatus !== 'ready' || direct.executionStatus !== 'ready') return;

    const capacitorVoltage =
      resumed.observation.components.find((entry) => entry.componentId === 'c1')?.voltageDrop ?? 0;
    expect(capacitorVoltage).toBeCloseTo(5 * (1 - Math.exp(-1)), 1);
    expect(resumed.observation).toEqual(direct.observation);
    expect(resumed.state).toEqual(direct.state);
    expect(JSON.parse(resumed.state.continuation!.serializedState)).toMatchObject({
      profile: 'rc-inputs-v2',
      boards: [],
    });
  });
});
