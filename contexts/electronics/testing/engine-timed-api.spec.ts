import { describe, expect, it, vi } from 'vitest';
import {
  advanceElectronicsToHorizon,
  createElectronicsAdvanceSession,
  parseElectronicsEngineDocument,
  pauseElectronicsTimedState,
  projectElectronicsArduinoSerial,
  resetElectronicsTimedState,
  resumeElectronicsTimedState,
  type ElectronicsEngineDocument,
} from '../engine';

import * as simulation from '../domain/simulation';
import * as inputDigest from '../domain/simulation-input-digest';
import * as solver from '../domain/solver';
import * as arduinoRuntime from '../domain/arduino-program-runtime';
import { ARDUINO_GROUND_TERMINALS } from '../domain/arduino-model';
import { ARDUINO_NUMERIC_TYPES } from '../domain/arduino-values';
import { electricalModelFor } from '../domain/model-registry';
import { resolveElectricalModelIdentity } from '../domain/model-identity';
import { ORDINARY_LED_PROFILES } from '../domain/led-model';
import { RESISTOR_DEVICE_MODEL, SOURCE_DEVICE_MODEL } from '../domain/models/linear-dc-models';
import { thermalProfileFor } from '../domain/models/thermal-transient-model';
import { NPN_DEVICE_MODEL } from '../domain/models/npn-dc-model';
import { PNP_DEVICE_MODEL } from '../domain/models/pnp-dc-model';
import { ARDUINO_TEXT_COMMAND_SUPPORT } from '../domain/arduino-capabilities';

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

function pirCircuit(): ElectronicsEngineDocument {
  const parsed = parseElectronicsEngineDocument({
    schemaVersion: 4,
    components: [
      {
        id: 'uno',
        kind: 'visual',
        value: 5,
        position: { x: 0, y: 0 },
        componentTypeId: 'arduino-uno',
        pinIds: ['d2', 'd13', 'power-5v', 'power-3v3', 'power-gnd-1'],
        stateProperties: {
          arduinoSource:
            'int motion=0;void setup(){pinMode(2,INPUT);}void loop(){motion=digitalRead(2);delay(10);}',
        },
      },
      {
        id: 'pir',
        kind: 'visual',
        value: 0,
        position: { x: 40, y: 0 },
        componentTypeId: 'pir-sensor',
        variantId: 'pir-sensor',
        pinIds: ['vcc', 'signal', 'gnd'],
        stateProperties: { motionDetected: false },
      },
    ],
    connections: [
      {
        id: 'vcc',
        from: { componentId: 'uno', terminal: 'power-5v' },
        to: { componentId: 'pir', terminal: 'vcc' },
      },
      {
        id: 'gnd',
        from: { componentId: 'uno', terminal: 'power-gnd-1' },
        to: { componentId: 'pir', terminal: 'gnd' },
      },
      {
        id: 'signal',
        from: { componentId: 'pir', terminal: 'signal' },
        to: { componentId: 'uno', terminal: 'd2' },
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.document;
}

describe('Electronics canonical timed engine facade', () => {
  it('preserves complete timed returns with the former analysis-based registry lookup', () => {
    const supported = circuit(
      'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(1);digitalWrite(13,LOW);delay(1);}',
    );
    const unsupported = {
      ...supported,
      components: [
        ...supported.components,
        { id: 'unknown', kind: 'visual' as const, value: -0, position: { x: 0, y: 0 } },
      ],
    };
    for (const document of [supported, unsupported]) {
      const compare = (request: Parameters<typeof advanceElectronicsToHorizon>[1]) => {
        const candidate = advanceElectronicsToHorizon(document, request);
        const lookup = vi
          .spyOn(simulation, 'simulationModelSetDigest')
          .mockImplementation(() => simulation.analyseCircuit(document).modelSetDigest);
        try {
          expect(advanceElectronicsToHorizon(document, request)).toStrictEqual(candidate);
        } finally {
          lookup.mockRestore();
        }
        return candidate;
      };
      const whole = compare({ requestedHorizonMicroseconds: 2500, maxEvents: 1024 });
      let state;
      for (const horizon of [0, 500, 2500]) {
        const result = compare({ requestedHorizonMicroseconds: horizon, state, maxEvents: 1024 });
        state = JSON.parse(JSON.stringify(result.state));
        if (result.executionStatus === 'ready' && horizon === 2500) {
          expect(result).toStrictEqual(whole);
        }
      }
      let yielded = compare({ requestedHorizonMicroseconds: 2500, maxEvents: 1 });
      let resumes = 0;
      while (yielded.executionStatus === 'yielded' && resumes++ < 50) {
        expect(yielded.observation).toBeNull();
        yielded = compare({
          requestedHorizonMicroseconds: 2500,
          state: JSON.parse(JSON.stringify(yielded.state)),
          maxEvents: 1,
        });
      }
      expect(yielded.executionStatus).not.toBe('yielded');
      expect(yielded).toStrictEqual(whole);
      compare({ requestedHorizonMicroseconds: NaN });
      compare({ requestedHorizonMicroseconds: 2500, maxEvents: 0 });
      compare({
        requestedHorizonMicroseconds: 2500,
        state: pauseElectronicsTimedState(whole.state),
      });
    }
  });

  it('withholds the timed observation when the actual physical quality check rejects a frame', () => {
    const document = circuit(`void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}${IDLE}`);
    const verify = simulation.verifyCircuitQuality;
    const quality = vi.spyOn(simulation, 'verifyCircuitQuality').mockImplementation((...args) => ({
      ...verify(...args),
      passed: false,
      maxKclResidualAmp: 1,
    }));
    try {
      expect(
        advanceElectronicsToHorizon(document, { requestedHorizonMicroseconds: 10 }),
      ).toMatchObject({
        executionStatus: 'fault',
        committedHorizonMicroseconds: 0,
        observation: null,
      });
      expect(quality).toHaveBeenCalled();
    } finally {
      quality.mockRestore();
    }
  });

  it('advances with real physical quality but without standalone snapshot analysis', () => {
    const document = circuit(`void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}${IDLE}`);
    const analysis = vi.spyOn(simulation, 'analyseCircuit').mockImplementation(() => {
      throw new Error('A timed advance must not run standalone snapshot analysis for metadata');
    });
    const quality = vi.spyOn(simulation, 'verifyCircuitQuality');
    try {
      const ready = advanceElectronicsToHorizon(document, { requestedHorizonMicroseconds: 10 });
      expect(ready.executionStatus).toBe('ready');
      if (ready.executionStatus !== 'ready') return;
      expect(ready.observation.quality.passed).toBe(true);
      expect(quality).toHaveBeenCalled();
      expect(analysis).not.toHaveBeenCalled();
      expect(ready.state.continuation!.modelSetDigest).toBe(simulation.simulationModelSetDigest());
      const rejected = advanceElectronicsToHorizon(document, {
        requestedHorizonMicroseconds: 20,
        state: {
          ...ready.state,
          continuation: { ...ready.state.continuation!, modelSetDigest: 'sha256:stale-models' },
        },
      });
      expect(rejected).toMatchObject({
        executionStatus: 'fault',
        committedHorizonMicroseconds: 10,
        observation: null,
        diagnostics: [{ code: 'invalid_timed_continuation' }],
      });
      expect(rejected.state.continuation!.modelSetDigest).toBe('sha256:stale-models');
    } finally {
      quality.mockRestore();
      analysis.mockRestore();
    }
  });

  it('preserves structural exception priority ahead of bad timed guards', () => {
    const base = circuit(IDLE);
    const malformed = {
      ...base,
      components: base.components.map((entry) => ({ ...entry, value: NaN })),
    };
    const requests = [
      { requestedHorizonMicroseconds: 10 },
      { requestedHorizonMicroseconds: NaN },
      { requestedHorizonMicroseconds: 10, maxEvents: 0 },
      {
        requestedHorizonMicroseconds: 10,
        state: {
          version: 1 as const,
          lifecycle: 'running' as const,
          continuation: { modelSetDigest: 'bad' } as never,
        },
      },
      {
        requestedHorizonMicroseconds: 10,
        inputEvents: [{ atMicroseconds: 1, targetId: 'uno', operation: 'unknown', payload: true }],
      },
    ];
    for (const request of requests) {
      expect(() => advanceElectronicsToHorizon(malformed, request)).toThrow(TypeError);
      expect(() => advanceElectronicsToHorizon(malformed, request)).toThrow('must be finite');
    }
    const paused = advanceElectronicsToHorizon(malformed, {
      requestedHorizonMicroseconds: 10,
      state: { version: 1, lifecycle: 'paused', continuation: null },
    });
    expect(paused).toMatchObject({
      executionStatus: 'fault',
      observation: null,
      diagnostics: [{ code: 'timed_state_paused' }],
    });
  });
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

  it('projects bounded Arduino Serial state from canonical continuation without web decoding', () => {
    const document = circuit(
      'void setup(){Serial.begin(9600);Serial.println("one");Serial.println("two");}void loop(){delay(100);}',
    );
    const result = advanceElectronicsToHorizon(document, { requestedHorizonMicroseconds: 10 });
    expect(result.executionStatus).toBe('ready');
    expect(projectElectronicsArduinoSerial(result.state)).toEqual([
      {
        componentId: 'uno',
        begun: true,
        baudRate: 9600,
        tx: [
          expect.objectContaining({ sequence: 0, text: 'one\n' }),
          expect.objectContaining({ sequence: 1, text: 'two\n' }),
        ],
        rxPendingBytes: 0,
      },
    ]);
    expect(projectElectronicsArduinoSerial(resetElectronicsTimedState())).toEqual([]);
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

  it('delivers canonical serialRx timed input through the engine into Arduino Serial.read', () => {
    const document = circuit(`int count=0;int first=-2;int second=-2;
      void setup(){Serial.begin(9600);}void loop(){delayMicroseconds(20);count=Serial.available();
      if(count>=2){first=Serial.read();second=Serial.read();delay(100);}}`);
    const begun = advanceElectronicsToHorizon(document, { requestedHorizonMicroseconds: 5 });
    expect(begun.executionStatus).toBe('ready');
    if (begun.executionStatus !== 'ready') return;

    const received = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: 50,
      state: begun.state,
      inputEvents: [{ atMicroseconds: 10, targetId: 'uno', operation: 'serialRx', payload: 'AB' }],
    });
    expect(received.executionStatus).toBe('ready');
    if (received.executionStatus !== 'ready') return;

    const schedulerState = JSON.parse(received.state.continuation!.serializedState);
    const runtime = schedulerState.boards.find(
      (entry: { componentId: string }) => entry.componentId === 'uno',
    ).runtime;
    expect(runtime.variables).toMatchObject({ count: 2, first: 65, second: 66 });
    expect(runtime.serial.rx).toEqual([]);
    expect(runtime.serial.nextRxSequence).toBe(2);
  });

  it('delivers motionDetected through canonical engine input and survives JSON continuation', () => {
    const document = pirCircuit();
    const low = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: 4_000,
    });
    expect(low.executionStatus).toBe('ready');
    if (low.executionStatus !== 'ready') return;

    const detected = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: 12_000,
      state: JSON.parse(JSON.stringify(low.state)),
      inputEvents: [
        { atMicroseconds: 5_000, targetId: 'pir', operation: 'motionDetected', payload: true },
      ],
    });
    expect(detected.executionStatus).toBe('ready');
    if (detected.executionStatus !== 'ready') return;
    const detectedState = JSON.parse(detected.state.continuation!.serializedState);
    expect(
      detectedState.boards.find((entry: { componentId: string }) => entry.componentId === 'uno')
        .runtime.variables.motion,
    ).toBe(1);
    expect(
      detected.observation.components.find((entry) => entry.componentId === 'pir'),
    ).toMatchObject({
      sensorMotionDetected: true,
      sensorPowerState: 'powered',
      sensorOutputRegion: 'digital-high',
    });

    const cleared = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: 25_000,
      state: JSON.parse(JSON.stringify(detected.state)),
      inputEvents: [
        { atMicroseconds: 15_000, targetId: 'pir', operation: 'motionDetected', payload: false },
      ],
    });
    expect(cleared.executionStatus).toBe('ready');
    if (cleared.executionStatus !== 'ready') return;
    const clearedState = JSON.parse(cleared.state.continuation!.serializedState);
    expect(
      clearedState.boards.find((entry: { componentId: string }) => entry.componentId === 'uno')
        .runtime.variables.motion,
    ).toBe(0);
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

  it('resumes electrothermal circuit-only state after a zero-horizon observation', () => {
    const parsed = parseElectronicsEngineDocument({
      schemaVersion: 4,
      components: [
        {
          id: 'uno',
          kind: 'visual',
          value: 5,
          position: { x: 0, y: 0 },
          componentTypeId: 'arduino-uno',
          pinIds: ['d13', 'power-gnd-1', 'power-5v', 'power-3v3'],
          stateProperties: {
            arduinoSource:
              'void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}void loop(){delay(100);}',
          },
        },
        { id: 'r', kind: 'resistor', value: 330, position: { x: 100, y: 0 } },
        {
          id: 'rgb',
          kind: 'rgb-led',
          value: 2,
          position: { x: 200, y: 0 },
          componentTypeId: 'rgb-led',
          pinIds: ['red', 'green', 'blue', 'common'],
        },
      ],
      connections: [
        {
          id: 'w1',
          from: { componentId: 'uno', terminal: 'd13' },
          to: { componentId: 'r', terminal: 'a' },
        },
        {
          id: 'w2',
          from: { componentId: 'r', terminal: 'b' },
          to: { componentId: 'rgb', terminal: 'red' },
        },
        {
          id: 'w3',
          from: { componentId: 'rgb', terminal: 'common' },
          to: { componentId: 'uno', terminal: 'power-gnd-1' },
        },
      ],
    });
    if (!parsed.ok) throw new Error(parsed.message);

    const atZero = advanceElectronicsToHorizon(parsed.document, {
      requestedHorizonMicroseconds: 0,
    });
    expect(atZero.executionStatus).toBe('ready');
    if (atZero.executionStatus !== 'ready') return;
    expect(atZero.committedHorizonMicroseconds).toBe(0);

    const atOne = advanceElectronicsToHorizon(parsed.document, {
      requestedHorizonMicroseconds: 1,
      state: atZero.state,
    });
    expect(atOne.executionStatus).toBe('ready');
    if (atOne.executionStatus !== 'ready') return;
    expect(atOne.committedHorizonMicroseconds).toBe(1);

    const atQuantum = advanceElectronicsToHorizon(parsed.document, {
      requestedHorizonMicroseconds: 1000,
      state: atOne.state,
    });
    expect(atQuantum.executionStatus).toBe('ready');
    if (atQuantum.executionStatus !== 'ready') return;
    expect(atQuantum.committedHorizonMicroseconds).toBe(1000);
    expect(JSON.parse(atQuantum.state.continuation!.serializedState).physicalState).toBeDefined();
    expect(atQuantum.observation.components.find((entry) => entry.componentId === 'rgb')?.lit).toBe(
      true,
    );
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

describe('event execution request ownership and physical barriers', () => {
  const eventCircuit = (source: string): ElectronicsEngineDocument => {
    const base = circuit(source);
    const parsed = parseElectronicsEngineDocument({
      ...base,
      components: [
        base.components[0]!,
        {
          id: 'r',
          kind: 'resistor',
          value: 330,
          position: { x: 100, y: 0 },
          componentTypeId: 'resistor-axial',
          pinIds: ['lead-1', 'lead-2'],
        },
      ],
      connections: [
        {
          id: 'w0',
          from: { componentId: 'uno', terminal: 'd13' },
          to: { componentId: 'r', terminal: 'lead-1' },
        },
        {
          id: 'w1',
          from: { componentId: 'r', terminal: 'lead-2' },
          to: { componentId: 'uno', terminal: 'power-gnd-1' },
        },
      ],
    });
    if (!parsed.ok) throw new Error(parsed.message);
    return parsed.document;
  };
  const finish = (
    document: ElectronicsEngineDocument,
    request: Parameters<typeof advanceElectronicsToHorizon>[1],
  ) => {
    const session = createElectronicsAdvanceSession(document, request);
    let steps = 0;
    let result;
    do {
      result = session.step();
      steps++;
    } while (!result && steps < 100_000);
    expect(result).toBeTruthy();
    return { result: result!, steps };
  };
  const reference = (document: ElectronicsEngineDocument, horizon: number, budget: number) => {
    let state;
    for (let i = 0; i < 100_000; i++) {
      const result = advanceElectronicsToHorizon(document, {
        requestedHorizonMicroseconds: horizon,
        state,
        maxEvents: budget,
      });
      if (result.executionStatus !== 'yielded') return result;
      expect(result.observation).toBeNull();
      state = JSON.parse(JSON.stringify(result.state));
    }
    throw new Error('bounded reference did not finish');
  };
  it('hashes the immutable owned document once at the original engine validation boundary', () => {
    const document = eventCircuit(
      'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(20);digitalWrite(13,LOW);delay(20);}',
    );
    const digest = vi.spyOn(inputDigest, 'simulationInputDigest');
    try {
      const actual = finish(document, { requestedHorizonMicroseconds: 1000, maxEvents: 1024 });
      expect(actual.result.executionStatus).toBe('ready');
      expect(digest).toHaveBeenCalledTimes(1);
    } finally {
      digest.mockRestore();
    }
  });

  it('keeps direct public scheduler validation independent of the owned digest', () => {
    const document = eventCircuit(
      'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(20);}',
    );
    const digest = vi.spyOn(inputDigest, 'simulationInputDigest');
    try {
      const actual = advanceElectronicsToHorizon(document, {
        requestedHorizonMicroseconds: 1000,
        maxEvents: 1024,
      });
      expect(actual.executionStatus).toBe('ready');
      expect(digest).toHaveBeenCalledTimes(2);
    } finally {
      digest.mockRestore();
    }
  });

  it('does not reuse the validation digest for a request with live inputs', () => {
    const document = eventCircuit('void setup(){Serial.begin(9600);}void loop(){delay(1);}');
    const request = {
      requestedHorizonMicroseconds: 1000,
      maxEvents: 1024,
      inputEvents: [
        { atMicroseconds: 500, targetId: 'uno', operation: 'serialRx' as const, payload: 'A' },
      ],
    };
    const expected = advanceElectronicsToHorizon(document, request);
    const digest = vi.spyOn(inputDigest, 'simulationInputDigest');
    try {
      expect(finish(document, request).result).toEqual(expected);
      expect(digest).toHaveBeenCalledTimes(2);
    } finally {
      digest.mockRestore();
    }
  });

  it('revalidates edited source and inputs for every independently owned request', () => {
    const document = eventCircuit(
      'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(20);}',
    );
    const digest = vi.spyOn(inputDigest, 'simulationInputDigest');
    try {
      const first = finish(document, {
        requestedHorizonMicroseconds: 1000,
        maxEvents: 1024,
      }).result;
      (document.components[0]!.stateProperties as Record<string, unknown>).arduinoSource =
        'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,LOW);delay(20);}';
      Object.assign(document.components[1]!, { value: 220 });
      const second = finish(document, {
        requestedHorizonMicroseconds: 1000,
        maxEvents: 1024,
      }).result;
      expect(digest).toHaveBeenCalledTimes(2);
      expect(digest.mock.results[0]!.value).not.toBe(digest.mock.results[1]!.value);
      expect(second.state.continuation!.documentDigest).not.toBe(
        first.state.continuation!.documentDigest,
      );
      digest.mockClear();
      expect(second).toEqual(
        advanceElectronicsToHorizon(document, {
          requestedHorizonMicroseconds: 1000,
          maxEvents: 1024,
        }),
      );
    } finally {
      digest.mockRestore();
    }
  });

  it.each([7, 256])(
    'retains owned execution across public requests with committed GPIO history, budget %i',
    (budget) => {
      const document = eventCircuit(
        'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(1);digitalWrite(13,LOW);delay(1);}',
      );
      let state = advanceElectronicsToHorizon(document, {
        requestedHorizonMicroseconds: 0,
      }).state;
      const create = vi.spyOn(arduinoRuntime, 'createOwnedClockedArduinoRuntime');
      try {
        for (const horizon of [500, 1500, 2500, 3500]) {
          const before = JSON.stringify(state);
          const previousRuntime = JSON.parse(state.continuation!.serializedState).boards[0]
            .runtime as arduinoRuntime.ArduinoRuntimeState;
          expect(previousRuntime.eventQueue.length).toBeGreaterThan(0);
          create.mockClear();
          const actual = finish(document, {
            requestedHorizonMicroseconds: horizon,
            state,
            maxEvents: budget,
          }).result;
          expect(actual.executionStatus).toBe('ready');
          expect(create.mock.results.some((result) => result.value !== null)).toBe(true);
          let expected = advanceElectronicsToHorizon(document, {
            requestedHorizonMicroseconds: horizon,
            state,
            maxEvents: budget,
          });
          for (
            let attempt = 0;
            expected.executionStatus === 'yielded' && attempt < 100;
            attempt++
          ) {
            expected = advanceElectronicsToHorizon(document, {
              requestedHorizonMicroseconds: horizon,
              state: expected.state,
              maxEvents: budget,
            });
          }
          expect(actual).toStrictEqual(expected);
          expect(JSON.stringify(state)).toBe(before);
          const runtime = JSON.parse(actual.state.continuation!.serializedState).boards[0]
            .runtime as arduinoRuntime.ArduinoRuntimeState;
          expect(runtime.eventQueue.slice(0, previousRuntime.eventQueue.length)).toEqual(
            previousRuntime.eventQueue,
          );
          state = JSON.parse(JSON.stringify(actual.state));
        }
      } finally {
        create.mockRestore();
      }
    },
  );

  it('retains owned execution after the committed GPIO history reaches its 256-event cap', () => {
    const document = eventCircuit(
      'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delayMicroseconds(1);digitalWrite(13,LOW);delayMicroseconds(1);}',
    );
    const initial = reference(document, 1500, 1024)!;
    expect(initial.executionStatus).toBe('ready');
    const previousRuntime = JSON.parse(initial.state.continuation!.serializedState).boards[0]
      .runtime as arduinoRuntime.ArduinoRuntimeState;
    expect(previousRuntime.eventQueue).toHaveLength(
      arduinoRuntime.ARDUINO_RUNTIME_EVENT_QUEUE_LIMIT,
    );
    expect(previousRuntime.eventQueue[0]!.sequence).toBeGreaterThan(0);
    const before = JSON.stringify(initial.state);
    const create = vi.spyOn(arduinoRuntime, 'createOwnedClockedArduinoRuntime');
    try {
      const actual = finish(document, {
        requestedHorizonMicroseconds: 2000,
        state: initial.state,
        maxEvents: 256,
      }).result;
      expect(actual.executionStatus).toBe('ready');
      expect(create.mock.results.some((result) => result.value !== null)).toBe(true);
      expect(actual).toStrictEqual(reference(document, 2000, 256));
      expect(JSON.stringify(initial.state)).toBe(before);
      const runtime = JSON.parse(actual.state.continuation!.serializedState).boards[0]
        .runtime as arduinoRuntime.ArduinoRuntimeState;
      expect(runtime.eventQueue).toHaveLength(arduinoRuntime.ARDUINO_RUNTIME_EVENT_QUEUE_LIMIT);
      expect(runtime.nextEventSequence).toBeGreaterThan(previousRuntime.nextEventSequence);
      expect(runtime.eventQueue[0]!.sequence).toBeGreaterThan(
        previousRuntime.eventQueue[0]!.sequence,
      );
    } finally {
      create.mockRestore();
    }
  });

  it('rejects malformed committed GPIO history before constructing an owned context', () => {
    const document = eventCircuit(
      'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(1);digitalWrite(13,LOW);delay(1);}',
    );
    const initial = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: 500,
    });
    expect(initial.executionStatus).toBe('ready');
    const create = vi.spyOn(arduinoRuntime, 'createOwnedClockedArduinoRuntime');
    try {
      for (const field of ['sequence', 'atMicroseconds', 'voltage'] as const) {
        const state = structuredClone(initial.state);
        const decoded = JSON.parse(state.continuation!.serializedState);
        expect(decoded.boards[0].runtime.eventQueue.length).toBeGreaterThan(1);
        decoded.boards[0].runtime.eventQueue[1][field] = -1;
        Object.assign(state.continuation!, { serializedState: JSON.stringify(decoded) });
        const before = JSON.stringify(state);
        const actual = finish(document, {
          requestedHorizonMicroseconds: 1500,
          state,
          maxEvents: 7,
        }).result;
        expect(actual).toStrictEqual(
          advanceElectronicsToHorizon(document, {
            requestedHorizonMicroseconds: 1500,
            state,
            maxEvents: 7,
          }),
        );
        expect(actual).toMatchObject({
          executionStatus: 'fault',
          diagnostics: [{ code: 'invalid_clock_continuation' }],
        });
        expect(JSON.stringify(state)).toBe(before);
      }
      expect(create).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
    }
  });

  it('enables prepared quality only after the real owned AST and preserves every quality call', () => {
    const document = eventCircuit(
      'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(1);digitalWrite(13,LOW);delay(1);}',
    );
    const order: string[] = [];
    const createRuntime = arduinoRuntime.createOwnedClockedArduinoRuntime;
    const createTraversal = simulation.createArduinoQualityTraversal;
    const publicVerify = simulation.verifyCircuitQuality;
    const runtime = vi
      .spyOn(arduinoRuntime, 'createOwnedClockedArduinoRuntime')
      .mockImplementation((...args) => {
        const result = createRuntime(...args);
        if (result) order.push('runtime');
        return result;
      });
    let preparedCalls = 0;
    const quality = vi
      .spyOn(simulation, 'createArduinoQualityTraversal')
      .mockImplementation((...args) => {
        order.push('factory');
        const result = createTraversal(...args);
        return {
          ...result,
          verify(...parameters) {
            preparedCalls++;
            return result.verify(...parameters);
          },
        };
      });
    const generic = vi.spyOn(simulation, 'verifyCircuitQuality').mockImplementation((...args) => {
      order.push('generic');
      return publicVerify(...args);
    });
    const keys = vi.spyOn(solver, 'arduinoQualityDictionaryKeys');
    try {
      const actual = finish(document, { requestedHorizonMicroseconds: 4008, maxEvents: 7 }).result;
      expect(actual.executionStatus).toBe('ready');
      expect(order[0]).toBe('generic');
      expect(order.indexOf('runtime')).toBeLessThan(order.indexOf('factory'));
      expect(quality).toHaveBeenCalledTimes(1);
      expect(keys).toHaveBeenCalled();
      expect(preparedCalls).toBeGreaterThan(0);
      const calls = preparedCalls + generic.mock.calls.length;
      generic.mockClear();
      quality.mockImplementation((...args) => {
        const result = createTraversal(...args);
        return {
          ...result,
          verify(frame, options) {
            return simulation.verifyCircuitQuality(args[0], args[1], frame, options);
          },
        };
      });
      expect(actual).toStrictEqual(
        finish(document, { requestedHorizonMicroseconds: 4008, maxEvents: 7 }).result,
      );
      expect(generic).toHaveBeenCalledTimes(calls);
    } finally {
      keys.mockRestore();
      generic.mockRestore();
      quality.mockRestore();
      runtime.mockRestore();
    }
  });

  it.each([
    'int value=0;void setup(){pinMode(13,OUTPUT);}void loop(){value=digitalRead(13);delay(1);}',
    'void setup(){Serial.begin(9600);}void loop(){Serial.println(1);delay(1);}',
  ])('keeps unproved runtime AST quality generic for %s', (source) => {
    const quality = vi.spyOn(simulation, 'createArduinoQualityTraversal');
    try {
      const document = eventCircuit(source);
      expect(
        finish(document, { requestedHorizonMicroseconds: 1010, maxEvents: 7 }).result,
      ).toStrictEqual(reference(document, 1010, 7));
      expect(quality).not.toHaveBeenCalled();
    } finally {
      quality.mockRestore();
    }
  });

  it('revokes quality before a foreign model callback and never promotes after restoration', () => {
    const document = eventCircuit(
      'int count=0;void setup(){pinMode(13,OUTPUT);}void loop(){count++;digitalWrite(13,count%2);}',
    );
    const observe = Object.getOwnPropertyDescriptor(RESISTOR_DEVICE_MODEL, 'observe')!;
    const create = simulation.createArduinoQualityTraversal;
    let revoked = false;
    let callbacks = 0;
    const quality = vi
      .spyOn(simulation, 'createArduinoQualityTraversal')
      .mockImplementation((...args) => {
        const result = create(...args);
        return {
          ...result,
          dispose() {
            revoked = true;
            result.dispose();
          },
        };
      });
    const keys = vi.spyOn(solver, 'arduinoQualityDictionaryKeys');
    const session = createElectronicsAdvanceSession(document, {
      requestedHorizonMicroseconds: 2010,
      maxEvents: 7,
    });
    try {
      let actual = session.step();
      while (!actual && quality.mock.calls.length === 0) actual = session.step();
      expect(actual).toBeNull();
      expect(quality).toHaveBeenCalledTimes(1);
      Object.defineProperty(RESISTOR_DEVICE_MODEL, 'observe', {
        ...observe,
        value: (...args: Parameters<NonNullable<typeof RESISTOR_DEVICE_MODEL.observe>>) => {
          expect(revoked).toBe(true);
          callbacks++;
          return observe.value(...args);
        },
      });
      keys.mockClear();
      actual = session.step();
      while (!actual && callbacks === 0) actual = session.step();
      expect(callbacks).toBeGreaterThan(0);
      Object.defineProperty(RESISTOR_DEVICE_MODEL, 'observe', observe);
      while (!actual) actual = session.step();
      expect(keys).not.toHaveBeenCalled();
      expect(quality).toHaveBeenCalledTimes(1);
      expect(actual).toStrictEqual(reference(document, 2010, 7));
    } finally {
      Object.defineProperty(RESISTOR_DEVICE_MODEL, 'observe', observe);
      session.dispose();
      keys.mockRestore();
      quality.mockRestore();
    }
  });

  it.each([1, 7, 256, 1024])(
    'detaches every owned runtime view and preserves null boundaries, budget %i',
    (budget) => {
      const source = `int z=0;unsigned long a=0;float zero=-0.0;
      void setup(){pinMode(13,OUTPUT);}void loop(){int pending;byte local=255;
      if(z<2000){int a=3;local++;z+=a;}a++;digitalWrite(13,z%2);}`;
      const document = eventCircuit(source);
      const saved: { state: arduinoRuntime.ArduinoRuntimeState; bytes: string }[] = [];
      let last: arduinoRuntime.ArduinoRuntimeState | undefined;
      let contexts = 0;
      const originalCreate = arduinoRuntime.createOwnedClockedArduinoRuntime;
      const originalAdvance = arduinoRuntime.advanceClockedArduinoRuntime;
      const create = vi
        .spyOn(arduinoRuntime, 'createOwnedClockedArduinoRuntime')
        .mockImplementation((...args) => {
          const context = originalCreate(...args);
          if (!context) return context;
          contexts++;
          return {
            ...context,
            advance(...parameters) {
              const advanced = context.advance(...parameters);
              // Validate and materialize every view at the original boundary.
              // Allocate a matcher only when that exact boolean check fails.
              const matchesProgram = arduinoRuntime.arduinoRuntimeStateMatchesProgram(
                source,
                advanced.state,
              );
              if (matchesProgram !== true) expect(matchesProgram).toBe(true);
              last = advanced.state;
              saved.push({ state: advanced.state, bytes: JSON.stringify(advanced.state) });
              return advanced;
            },
          };
        });
      const advance = vi
        .spyOn(arduinoRuntime, 'advanceClockedArduinoRuntime')
        .mockImplementation((...args) => {
          const advanced = originalAdvance(...args);
          if (args[0] === source) last = advanced.state;
          return advanced;
        });
      try {
        const session = createElectronicsAdvanceSession(document, {
          requestedHorizonMicroseconds: 2050,
          maxEvents: budget,
        });
        const actualBoundaries: string[] = [];
        let result;
        do {
          result = session.step();
          if (result === null) actualBoundaries.push(JSON.stringify(last));
          // The test observes returned states, not Vitest's retained call history.
          advance.mockClear();
        } while (!result);
        session.dispose();
        session.dispose();
        const expectedBoundaries: string[] = [];
        let state;
        let expected;
        do {
          expected = advanceElectronicsToHorizon(document, {
            requestedHorizonMicroseconds: 2050,
            maxEvents: budget,
            state,
          });
          state = expected.state;
          if (expected.executionStatus === 'yielded')
            expectedBoundaries.push(
              JSON.stringify(JSON.parse(state.continuation!.serializedState).boards[0].runtime),
            );
          // Release only spy metadata after the complete public resume boundary.
          advance.mockClear();
        } while (expected.executionStatus === 'yielded');
        expect(contexts).toBe(1);
        expect(actualBoundaries).toEqual(expectedBoundaries);
        expect(result).toStrictEqual(expected);
        expect(JSON.stringify(result)).toBe(JSON.stringify(expected));
        expect(saved.length).toBeGreaterThan(1);
        // Check every view at the same point, without creating a matcher context
        // for each property of every instruction-budget snapshot.
        const snapshotFailures: string[] = [];
        for (const [index, snapshot] of saved.entries()) {
          if (JSON.stringify(snapshot.state) !== snapshot.bytes)
            snapshotFailures.push(`${index}: serialized state changed`);
          for (const key of ['variables', 'locals', 'scopes'] as const) {
            if (!Object.is(snapshot.state[key], snapshot.state[key]))
              snapshotFailures.push(`${index}: ${key} identity changed`);
            const descriptor = Object.getOwnPropertyDescriptor(snapshot.state, key);
            if (
              descriptor?.writable !== true ||
              descriptor.enumerable !== true ||
              descriptor.configurable !== true
            )
              snapshotFailures.push(`${index}: ${key} descriptor changed`);
          }
        }
        expect(snapshotFailures).toEqual([]);
        expect(
          saved.some(({ state }) => state.scopes.some((scope) => scope.pending?.value === null)),
        ).toBe(true);
        const first = saved[0]!.state;
        Object.assign(first.variables, { zero: 123 });
        Object.assign(first.scopes[0]!.zero!, { value: 123 });
        expect(first.variables).toBe(first.variables);
        expect(first.scopes).toBe(first.scopes);
        // Every saved byte string was freshly verified above after both APIs
        // finished. Compare every later state freshly again after the mutation,
        // without retaining another complete array of those serialized views.
        const mutationFailures: number[] = [];
        for (let index = 1; index < saved.length; index++) {
          const snapshot = saved[index]!;
          if (JSON.stringify(snapshot.state) !== snapshot.bytes) mutationFailures.push(index);
        }
        expect(mutationFailures).toEqual([]);
      } finally {
        create.mockRestore();
        advance.mockRestore();
      }
    },
  );

  it.each([
    'ground',
    'terminals',
    'identity',
    'thermal',
    'numeric',
    'resistor',
    'linear-selector',
    'led',
    'npn',
    'pnp',
  ] as const)('keeps a customized %s producer generic without an admission getter read', (kind) => {
    const document = eventCircuit(
      'int count=0;void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(1);}',
    );
    const target: readonly [object, PropertyKey] =
      kind === 'ground'
        ? [ARDUINO_GROUND_TERMINALS, 'filter']
        : kind === 'terminals'
          ? [electricalModelFor(document.components[0]!).requiredTerminals, 'filter']
          : kind === 'identity'
            ? [resolveElectricalModelIdentity(document.components[0]!), 'electricalModelId']
            : kind === 'thermal'
              ? [thermalProfileFor(document.components[1]!)!, 'id']
              : kind === 'numeric'
                ? [ARDUINO_NUMERIC_TYPES, 'includes']
                : kind === 'resistor'
                  ? [RESISTOR_DEVICE_MODEL, 'observe']
                  : kind === 'linear-selector'
                    ? [SOURCE_DEVICE_MODEL, 'id']
                    : kind === 'led'
                      ? [ORDINARY_LED_PROFILES.red.linearSegments, 'entries']
                      : kind === 'npn'
                        ? [NPN_DEVICE_MODEL, 'id']
                        : [PNP_DEVICE_MODEL, 'id'];
    const [object, key] = target;
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    const original = Reflect.get(object, key);
    let reads = 0;
    Object.defineProperty(object, key, {
      configurable: true,
      enumerable: descriptor?.enumerable ?? false,
      get() {
        reads++;
        return original;
      },
    });
    const create = vi.spyOn(arduinoRuntime, 'createOwnedClockedArduinoRuntime');
    try {
      const session = createElectronicsAdvanceSession(document, {
        requestedHorizonMicroseconds: 1005,
        maxEvents: 7,
      });
      expect(reads).toBe(0);
      let actual;
      do {
        actual = session.step();
      } while (!actual);
      session.dispose();
      expect(actual).toStrictEqual(reference(document, 1005, 7));
      expect(create).not.toHaveBeenCalled();
      // LED is absent in this fixture, but its definition still blocks admission.
      if (kind !== 'led') expect(reads).toBeGreaterThan(0);
    } finally {
      if (descriptor) Object.defineProperty(object, key, descriptor);
      else Reflect.deleteProperty(object, key);
      create.mockRestore();
    }
  });

  it.each([1, 7, 256, 1024])(
    'transfers the exact completed batch once on origin loss, budget %i',
    (budget) => {
      const source =
        'int count=0;void setup(){pinMode(13,OUTPUT);}void loop(){count++;digitalWrite(13,count%2);}';
      const document = eventCircuit(source);
      const originalCreate = arduinoRuntime.createOwnedClockedArduinoRuntime;
      const originalAdvance = arduinoRuntime.advanceClockedArduinoRuntime;
      const observe = Object.getOwnPropertyDescriptor(RESISTOR_DEVICE_MODEL, 'observe')!;
      let last: arduinoRuntime.ArduinoRuntimeState | undefined;
      let contexts = 0;
      let ownedAdvances = 0;
      let replacements = 0;
      const create = vi
        .spyOn(arduinoRuntime, 'createOwnedClockedArduinoRuntime')
        .mockImplementation((...args) => {
          const context = originalCreate(...args);
          if (!context) return context;
          contexts++;
          return {
            ...context,
            advance(...parameters) {
              ownedAdvances++;
              const result = context.advance(...parameters);
              last = result.state;
              return result;
            },
          };
        });
      const advance = vi
        .spyOn(arduinoRuntime, 'advanceClockedArduinoRuntime')
        .mockImplementation((...args) => {
          const result = originalAdvance(...args);
          if (args[0] === source) last = result.state;
          return result;
        });
      try {
        const session = createElectronicsAdvanceSession(document, {
          requestedHorizonMicroseconds: 2050,
          maxEvents: budget,
        });
        expect(session.step()).toBeNull();
        const boundaries = [JSON.stringify(last)];
        const ownedBeforeLoss = ownedAdvances;
        Object.defineProperty(RESISTOR_DEVICE_MODEL, 'observe', {
          ...observe,
          value: (...args: Parameters<NonNullable<typeof RESISTOR_DEVICE_MODEL.observe>>) => {
            replacements++;
            return observe.value(...args);
          },
        });
        let actual = session.step();
        if (actual === null) boundaries.push(JSON.stringify(last));
        let restored = false;
        while (!actual) {
          if (replacements > 0 && !restored) {
            Object.defineProperty(RESISTOR_DEVICE_MODEL, 'observe', observe);
            restored = true;
          }
          actual = session.step();
          if (actual === null) boundaries.push(JSON.stringify(last));
        }
        session.dispose();
        expect(contexts).toBe(1);
        expect(ownedAdvances).toBe(ownedBeforeLoss);
        expect(replacements).toBeGreaterThan(0);
        expect(restored).toBe(true);
        Object.defineProperty(RESISTOR_DEVICE_MODEL, 'observe', observe);
        const expectedBoundaries: string[] = [];
        let expected;
        let state;
        do {
          expected = advanceElectronicsToHorizon(document, {
            requestedHorizonMicroseconds: 2050,
            state,
            maxEvents: budget,
          });
          state = expected.state;
          if (expected.executionStatus === 'yielded')
            expectedBoundaries.push(
              JSON.stringify(JSON.parse(state.continuation!.serializedState).boards[0].runtime),
            );
        } while (expected.executionStatus === 'yielded');
        expect(boundaries).toEqual(expectedBoundaries);
        expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
      } finally {
        Object.defineProperty(RESISTOR_DEVICE_MODEL, 'observe', observe);
        create.mockRestore();
        advance.mockRestore();
      }
    },
  );

  it('never promotes a clone after an initial customized callback captured it', () => {
    const document = eventCircuit(
      'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(1);}',
    );
    const descriptor = Object.getOwnPropertyDescriptor(RESISTOR_DEVICE_MODEL, 'observe')!;
    let captured: object | undefined;
    Object.defineProperty(RESISTOR_DEVICE_MODEL, 'observe', {
      ...descriptor,
      value: (...args: Parameters<NonNullable<typeof RESISTOR_DEVICE_MODEL.observe>>) => {
        captured = args[0].component;
        return descriptor.value(...args);
      },
    });
    const create = vi.spyOn(arduinoRuntime, 'createOwnedClockedArduinoRuntime');
    const session = createElectronicsAdvanceSession(document, {
      requestedHorizonMicroseconds: 2050,
      maxEvents: 7,
    });
    try {
      expect(session.step()).toBeNull();
      expect(captured).toBeDefined();
      expect(captured).not.toBe(document.components[1]);
      Object.defineProperty(RESISTOR_DEVICE_MODEL, 'observe', descriptor);
      Object.assign(captured!, { name: 'captured generic component' });
      while (!session.step()) {
        /* complete the existing generic request */
      }
      expect(create).not.toHaveBeenCalled();
    } finally {
      session.dispose();
      Object.defineProperty(RESISTOR_DEVICE_MODEL, 'observe', descriptor);
      create.mockRestore();
    }
  });

  it('rechecks origins before the first step after session construction', () => {
    const document = eventCircuit('void setup(){pinMode(13,OUTPUT);}void loop(){delay(1);}');
    const session = createElectronicsAdvanceSession(document, {
      requestedHorizonMicroseconds: 1005,
      maxEvents: 1,
    });
    const descriptor = Object.getOwnPropertyDescriptor(RESISTOR_DEVICE_MODEL, 'observe')!;
    const create = vi.spyOn(arduinoRuntime, 'createOwnedClockedArduinoRuntime');
    let reads = 0;
    Object.defineProperty(RESISTOR_DEVICE_MODEL, 'observe', {
      configurable: true,
      enumerable: true,
      get() {
        reads++;
        return descriptor.value;
      },
    });
    try {
      expect(reads).toBe(0);
      expect(session.step()).toBeNull();
      expect(reads).toBeGreaterThan(0);
      Object.defineProperty(RESISTOR_DEVICE_MODEL, 'observe', descriptor);
      let actual;
      do {
        actual = session.step();
      } while (!actual);
      expect(actual).toStrictEqual(reference(document, 1005, 1));
      expect(create).not.toHaveBeenCalled();
    } finally {
      session.dispose();
      Object.defineProperty(RESISTOR_DEVICE_MODEL, 'observe', descriptor);
      create.mockRestore();
    }
  });

  it('keeps accepted imported binding extensions on the generic importer', () => {
    const document = eventCircuit(
      'int count=0;void setup(){pinMode(13,OUTPUT);}void loop(){count++;}',
    );
    const state = structuredClone(
      advanceElectronicsToHorizon(document, { requestedHorizonMicroseconds: 10 }).state,
    );
    const decoded = JSON.parse(state.continuation!.serializedState);
    decoded.boards[0].runtime.scopes[0].count.extension = { callerData: 7 };
    Object.assign(state.continuation!, { serializedState: JSON.stringify(decoded) });
    const create = vi.spyOn(arduinoRuntime, 'createOwnedClockedArduinoRuntime');
    try {
      const actual = finish(document, {
        requestedHorizonMicroseconds: 1005,
        state,
        maxEvents: 7,
      }).result;
      let expected;
      let prior = state;
      do {
        expected = advanceElectronicsToHorizon(document, {
          requestedHorizonMicroseconds: 1005,
          state: prior,
          maxEvents: 7,
        });
        prior = expected.state;
      } while (expected.executionStatus === 'yielded');
      expect(actual).toStrictEqual(expected);
      for (const result of create.mock.results) expect(result.value).toBeNull();
    } finally {
      create.mockRestore();
    }
  });

  it.each([undefined, 'red', 'orange', 'yellow', 'green', 'blue', 'white', 'ultraviolet'])(
    'admits only the six ordinary own LED colours or absent red: %s',
    (colour) => {
      const base = eventCircuit(
        'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(1);}',
      );
      const parsed = parseElectronicsEngineDocument({
        ...base,
        components: [
          ...base.components,
          {
            id: 'led',
            kind: 'led',
            value: 2,
            position: { x: 150, y: 0 },
            componentTypeId: 'led-5mm',
            pinIds: ['anode', 'cathode'],
            stateProperties: colour === undefined ? {} : { ledColour: colour },
          },
        ],
        connections: [
          base.connections[0],
          {
            id: 'w1',
            from: { componentId: 'r', terminal: 'lead-2' },
            to: { componentId: 'led', terminal: 'anode' },
          },
          {
            id: 'w2',
            from: { componentId: 'led', terminal: 'cathode' },
            to: { componentId: 'uno', terminal: 'power-gnd-1' },
          },
        ],
      });
      if (!parsed.ok) throw new Error(parsed.message);
      const create = vi.spyOn(arduinoRuntime, 'createOwnedClockedArduinoRuntime');
      try {
        const actual = finish(parsed.document, {
          requestedHorizonMicroseconds: 1005,
          maxEvents: 7,
        }).result;
        const admitted = create.mock.results.some((result) => result.value !== null);
        expect(admitted).toBe(colour !== 'ultraviolet');
        expect(actual).toStrictEqual(reference(parsed.document, 1005, 7));
      } finally {
        create.mockRestore();
      }
    },
  );

  it.each([
    '#include <Servo.h>\nServo motor;void setup(){motor.attach(13);}void loop(){delay(1);}',
    'void setup(){Serial.begin(9600);Serial.println(7);}void loop(){delay(1);}',
    '#define OUTPUT_PIN 13\nvoid loop(){digitalWrite(OUTPUT_PIN,HIGH);}',
  ])('excludes source support-table routes before any support getter: %s', (source) => {
    const document = eventCircuit(source);
    const support = source.includes('Servo')
      ? ARDUINO_TEXT_COMMAND_SUPPORT['Servo.h']
      : ARDUINO_TEXT_COMMAND_SUPPORT['Serial.println'];
    const descriptor = Object.getOwnPropertyDescriptor(support, 'summary')!;
    let reads = 0;
    Object.defineProperty(support, 'summary', {
      configurable: true,
      enumerable: true,
      get() {
        reads++;
        return descriptor.value;
      },
    });
    const create = vi.spyOn(arduinoRuntime, 'createOwnedClockedArduinoRuntime');
    try {
      const session = createElectronicsAdvanceSession(document, {
        requestedHorizonMicroseconds: 1005,
        maxEvents: 7,
      });
      expect(reads).toBe(0);
      let actual;
      do {
        actual = session.step();
      } while (!actual);
      session.dispose();
      expect(actual).toStrictEqual(reference(document, 1005, 7));
      expect(create).not.toHaveBeenCalled();
      if (!source.includes('#define')) expect(reads).toBeGreaterThan(0);
    } finally {
      Object.defineProperty(support, 'summary', descriptor);
      create.mockRestore();
    }
  });

  it.each(['uninitialized', 'overflow', 'nonfinite'] as const)(
    'keeps owned %s faults at the original instruction and rolls back',
    (kind) => {
      const body =
        kind === 'uninitialized'
          ? 'int pending;int result=pending;'
          : kind === 'overflow'
            ? 'int value=32767;value++;'
            : 'float value=3e38;value*=3e38;';
      const document = eventCircuit(
        `void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);${body}}`,
      );
      const initial = advanceElectronicsToHorizon(document, { requestedHorizonMicroseconds: 0 });
      const before = JSON.stringify(initial.state);
      const expected = advanceElectronicsToHorizon(document, {
        requestedHorizonMicroseconds: 1000,
        state: initial.state,
        maxEvents: 1024,
      });
      for (const budget of [1, 7, 256, 1024]) {
        const actual = finish(document, {
          requestedHorizonMicroseconds: 1000,
          state: initial.state,
          maxEvents: budget,
        }).result;
        expect(actual).toStrictEqual(expected);
        expect(actual).toMatchObject({
          executionStatus: 'fault',
          observation: null,
          state: initial.state,
          committedHorizonMicroseconds: 0,
        });
        expect(actual.diagnostics[0]!.code).toBe('arduino_execution_failed');
      }
      expect(JSON.stringify(initial.state)).toBe(before);
    },
  );

  it('falls back for shared/exotic clone graphs and terminates ordinary cyclic admission', () => {
    const source = 'int count=0;void setup(){pinMode(13,OUTPUT);}void loop(){count++;}';
    const create = vi.spyOn(arduinoRuntime, 'createOwnedClockedArduinoRuntime');
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const shared = new SharedArrayBuffer(8);
    try {
      for (const [probe, admitted] of [
        [new Date(0), false],
        [new Map(), false],
        [shared, false],
        [new Uint8Array(shared), false],
        [cycle, true],
      ] as const) {
        create.mockClear();
        const document = Object.assign(eventCircuit(source), { requestProbe: probe });
        const actual = finish(document, {
          requestedHorizonMicroseconds: 1005,
          maxEvents: 7,
        }).result;
        expect(actual).toStrictEqual(reference(document, 1005, 7));
        expect(create.mock.calls.length > 0).toBe(admitted);
      }
    } finally {
      create.mockRestore();
    }
  });

  it('rejects malformed imported scopes and counters before constructing an owned context', () => {
    const document = eventCircuit(
      'int count=0;void setup(){pinMode(13,OUTPUT);}void loop(){count++;}',
    );
    const initial = advanceElectronicsToHorizon(document, { requestedHorizonMicroseconds: 0 });
    const create = vi.spyOn(arduinoRuntime, 'createOwnedClockedArduinoRuntime');
    const changes = [
      (runtime: arduinoRuntime.ArduinoRuntimeState) => {
        Object.assign(runtime, { programCounter: 10000 });
      },
      (runtime: arduinoRuntime.ArduinoRuntimeState) => {
        Object.assign(runtime, { scopes: [...runtime.scopes, {}] });
      },
      (runtime: arduinoRuntime.ArduinoRuntimeState) => {
        Object.assign(runtime.scopes[0]!, { count: { type: 'byte', constant: false, value: 256 } });
      },
      (runtime: arduinoRuntime.ArduinoRuntimeState) => {
        Object.assign(runtime.scopes[0]!, { count: { type: 'int', constant: true, value: null } });
      },
      (runtime: arduinoRuntime.ArduinoRuntimeState) => {
        Object.assign(runtime, { nextEventSequence: -1 });
      },
    ];
    try {
      for (const change of changes) {
        const state = structuredClone(initial.state);
        const decoded = JSON.parse(state.continuation!.serializedState);
        change(decoded.boards[0].runtime);
        Object.assign(state.continuation!, { serializedState: JSON.stringify(decoded) });
        const before = JSON.stringify(state);
        const expected = advanceElectronicsToHorizon(document, {
          requestedHorizonMicroseconds: 1000,
          state,
        });
        const actual = finish(document, { requestedHorizonMicroseconds: 1000, state }).result;
        expect(actual).toStrictEqual(expected);
        expect(actual).toMatchObject({
          executionStatus: 'fault',
          diagnostics: [{ code: 'invalid_clock_continuation' }],
        });
        expect(JSON.stringify(state)).toBe(before);
      }
      expect(create).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
    }
  });

  it.each([
    'void setup(){pinMode(13,OUTPUT);tone(13,1000);}void loop(){delay(1);}',
    'void setup(){Serial.begin(9600);Serial.println(7);pinMode(13,OUTPUT);}void loop(){delay(1);}',
    'int seen=0;void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);seen=digitalRead(13);}void loop(){delay(1);}',
  ])('keeps the first peripheral/read action on the generic importer: %s', (source) => {
    const document = eventCircuit(source);
    const create = vi.spyOn(arduinoRuntime, 'createOwnedClockedArduinoRuntime');
    try {
      for (const budget of [1, 7, 256, 1024]) {
        const actual = finish(document, {
          requestedHorizonMicroseconds: 1251,
          maxEvents: budget,
        }).result;
        expect(actual).toStrictEqual(reference(document, 1251, budget));
        expect(actual.executionStatus).toBe('ready');
      }
      for (const result of create.mock.results) expect(result.value).toBeNull();
    } finally {
      create.mockRestore();
    }
  });

  it('disposes a pending session without another interpreter or physical step', () => {
    const document = eventCircuit(
      'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);}',
    );
    const solve = vi.spyOn(solver, 'solveRcCircuitWithHeldArduino');
    const session = createElectronicsAdvanceSession(document, {
      requestedHorizonMicroseconds: 5000,
      maxEvents: 7,
    });
    try {
      expect(session.step()).toBeNull();
      const calls = solve.mock.calls.length;
      session.dispose();
      session.dispose();
      expect(session.step()).toBeUndefined();
      expect(solve.mock.calls).toHaveLength(calls);
    } finally {
      session.dispose();
      solve.mockRestore();
    }
  });
  it.each([1, 7, 256, 1024])(
    'preserves every instruction and full public result with budget %i',
    (budget) => {
      const doc = eventCircuit(
        'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);}',
      );
      const before = structuredClone(doc);
      const actual = finish(doc, { requestedHorizonMicroseconds: 2048, maxEvents: budget });
      expect(actual.result.state.continuation?.clockProfileId).toBe('electrothermal-events-v2');
      expect(actual.result).toStrictEqual(reference(doc, 2048, budget));
      expect(actual.steps).toBeGreaterThan(2048 / budget);
      expect(doc).toStrictEqual(before);
    },
  );
  it.each([1, 7, 256, 1024])(
    'samples a wake/read and delivers input exactly on a physics barrier with budget %i',
    (budget) => {
      const cases = [
        {
          source:
            'int seen=0;void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);delayMicroseconds(997);seen=digitalRead(13);digitalWrite(13,LOW);}void loop(){delay(1);}',
          expected: 1,
          inputEvents: [],
        },
        {
          source:
            'int seen=0;void setup(){Serial.begin(9600);delayMicroseconds(998);seen=Serial.read();}void loop(){delay(1);}',
          expected: 65,
          inputEvents: [
            { atMicroseconds: 1000, targetId: 'uno', operation: 'serialRx', payload: 'A' },
          ],
        },
      ];
      for (const scenario of cases) {
        const doc = eventCircuit(scenario.source);
        const before = finish(doc, {
          requestedHorizonMicroseconds: 999,
          maxEvents: budget,
          inputEvents: scenario.inputEvents,
        }).result;
        expect(before.executionStatus).toBe('ready');
        expect(
          JSON.parse(before.state.continuation!.serializedState).boards[0].runtime.variables.seen,
        ).toBe(0);
        const at = finish(doc, {
          requestedHorizonMicroseconds: 1000,
          maxEvents: budget,
          state: JSON.parse(JSON.stringify(before.state)),
        }).result;
        expect(at.executionStatus).toBe('ready');
        expect(at.observation!.quality.passed).toBe(true);
        expect(
          JSON.parse(at.state.continuation!.serializedState).boards[0].runtime.variables.seen,
        ).toBe(scenario.expected);
        expect(at).toStrictEqual(
          finish(doc, {
            requestedHorizonMicroseconds: 1000,
            maxEvents: budget,
            inputEvents: scenario.inputEvents,
          }).result,
        );
      }
    },
  );

  it.each([1, 7, 256, 1024])(
    'preserves changed and unchanged output at a physical boundary before the next read, budget %i',
    (budget) => {
      for (const level of ['LOW', 'HIGH']) {
        const doc = eventCircuit(
          `int seen=-1;void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);delayMicroseconds(997);digitalWrite(13,${level});seen=digitalRead(13);}void loop(){delay(1);}`,
        );
        const before = finish(doc, {
          requestedHorizonMicroseconds: 999,
          maxEvents: budget,
        }).result;
        const saved = JSON.stringify(before.state);
        const after = finish(doc, {
          requestedHorizonMicroseconds: 1001,
          maxEvents: budget,
          state: JSON.parse(saved),
        }).result;
        expect(JSON.stringify(before.state)).toBe(saved);
        expect(after.executionStatus).toBe('ready');
        expect(after.observation!.quality.passed).toBe(true);
        const runtime = JSON.parse(after.state.continuation!.serializedState).boards[0].runtime;
        expect(runtime.variables.seen).toBe(level === 'HIGH' ? 1 : 0);
        expect(runtime.outputVoltages.d13).toBe(level === 'HIGH' ? 5 : 0);
        const boundaryEvents = runtime.eventQueue.filter(
          (event: { atMicroseconds: number; kind: string }) =>
            event.atMicroseconds === 1000 && event.kind === 'output-change',
        );
        expect(boundaryEvents).toHaveLength(level === 'HIGH' ? 0 : 1);
        expect(after).toStrictEqual(
          finish(doc, { requestedHorizonMicroseconds: 1001, maxEvents: budget }).result,
        );
      }
    },
  );

  it.each(['sample', 'quality'] as const)(
    'rolls back the request when the electrical %s used by a boundary read fails',
    (kind) => {
      const doc = eventCircuit(
        'int seen=0;void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);delayMicroseconds(997);seen=digitalRead(13);}void loop(){delay(1);}',
      );
      const before = finish(doc, { requestedHorizonMicroseconds: 999 }).result;
      const saved = structuredClone(before.state);
      let atBoundary = 0;
      const solve = solver.solveRcCircuitWithHeldArduino;
      const verify = simulation.verifyCircuitQuality;
      // Let the real 1ms physical commit pass, then reject the electrical frame
      // consumed by digitalRead. The whole request must retain its old state.
      const check =
        kind === 'sample'
          ? vi.spyOn(solver, 'solveRcCircuitWithHeldArduino').mockImplementation((...args) => {
              const result = solve(...args);
              return args[1] === 1 && ++atBoundary === 2 ? { ...result, solved: false } : result;
            })
          : vi.spyOn(simulation, 'verifyCircuitQuality').mockImplementation((...args) => {
              const result = verify(...args);
              return args[3]?.simulationTimeMs === 1 && ++atBoundary === 2
                ? { ...result, passed: false }
                : result;
            });
      try {
        const failed = finish(doc, {
          requestedHorizonMicroseconds: 1000,
          state: before.state,
        }).result;
        expect(atBoundary).toBe(2);
        expect(failed).toMatchObject({
          executionStatus: 'fault',
          committedHorizonMicroseconds: 999,
          observation: null,
          state: saved,
          diagnostics: [{ code: `electrical_${kind}_failed` }],
        });
        expect(before.state).toStrictEqual(saved);
      } finally {
        check.mockRestore();
      }
    },
  );

  it('owns document and continuation before the first step and rolls back the entire request fault', () => {
    const source =
      'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(1);int n=0;int bad=1/n;}';
    const doc = eventCircuit(source);
    const initial = advanceElectronicsToHorizon(doc, { requestedHorizonMicroseconds: 0 });
    const request = { requestedHorizonMicroseconds: 5000, state: initial.state, maxEvents: 1 };
    const owned = structuredClone(request);
    const session = createElectronicsAdvanceSession(doc, request);
    (doc.components[0]!.stateProperties as Record<string, unknown>)['arduinoSource'] =
      'void loop(){}';
    Object.assign(request.state, { lifecycle: 'paused' });
    let result,
      steps = 0;
    do {
      result = session.step();
      steps++;
    } while (!result && steps < 1000);
    expect(steps).toBeGreaterThan(3);
    expect(result).toMatchObject({
      executionStatus: 'fault',
      observation: null,
      state: owned.state,
      committedHorizonMicroseconds: 0,
    });
  });
  it('appends Serial input once across many private batches', () => {
    const doc = eventCircuit(
      'int x=0;void setup(){Serial.begin(9600);}void loop(){if(Serial.available()>0){x+=Serial.read();}}',
    );
    const initial = advanceElectronicsToHorizon(doc, { requestedHorizonMicroseconds: 0 });
    const request = {
      requestedHorizonMicroseconds: 2000,
      state: initial.state,
      maxEvents: 7,
      inputEvents: [{ atMicroseconds: 10, targetId: 'uno', operation: 'serialRx', payload: 'A' }],
    } as const;
    const result = finish(doc, request).result;
    expect(result.executionStatus).toBe('ready');
    const raw = JSON.parse(result.state.continuation!.serializedState);
    expect(raw.inputs).toHaveLength(1);
    expect(raw.boards[0].runtime.variables.x).toBe(65);
  });
  it('samples actual driven terminal voltage at a read instruction inside a grouped batch', () => {
    const doc = eventCircuit(
      'int seen=0;void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);seen=digitalRead(13);delay(1000);}',
    );
    const result = finish(doc, { requestedHorizonMicroseconds: 5000, maxEvents: 7 }).result;
    expect(result.executionStatus).toBe('ready');
    const state = JSON.parse(result.state.continuation!.serializedState);
    expect(state.profile).toBe('electrothermal-events-v2');
    expect(state.boards[0].runtime.variables.seen).toBe(1);
    expect(result).toStrictEqual(reference(doc, 5000, 1));
  });
  it('starts the cooling epoch at the exact falling GPIO edge without applying LOW to past heating', () => {
    const base = circuit(
      'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(100);digitalWrite(13,LOW);delay(100);}',
    );
    const parsed = parseElectronicsEngineDocument({
      ...base,
      components: [
        base.components[0]!,
        {
          id: 'r',
          kind: 'resistor',
          value: 100,
          position: { x: 100, y: 0 },
          componentTypeId: 'resistor-axial',
          pinIds: ['lead-1', 'lead-2'],
          stateProperties: { powerRatingWatt: 0.01 },
        },
      ],
      connections: [
        {
          id: 'w0',
          from: { componentId: 'uno', terminal: 'd13' },
          to: { componentId: 'r', terminal: 'lead-1' },
        },
        {
          id: 'w1',
          from: { componentId: 'r', terminal: 'lead-2' },
          to: { componentId: 'uno', terminal: 'power-gnd-1' },
        },
      ],
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const doc = parsed.document;
    const high = finish(doc, { requestedHorizonMicroseconds: 100003 }).result;
    const before = JSON.parse(high.state.continuation!.serializedState);
    const epoch = before.thermalEpochs[0];
    expect(epoch.atMicroseconds).toBe(2);
    const low = finish(doc, { requestedHorizonMicroseconds: 100004, state: high.state }).result;
    const after = JSON.parse(low.state.continuation!.serializedState);
    expect(after.thermalEpochs[0]).toMatchObject({ atMicroseconds: 100004, loadRatio: 0 });
    const heated = 25 + 55 * Math.min(epoch.loadRatio, 4) * (1 - Math.exp(-0.100002 / 4));
    expect(after.thermalEpochs[0].temperatureCelsius).toBeCloseTo(heated, 9);
    const cool = finish(doc, { requestedHorizonMicroseconds: 150000, state: low.state }).result;
    const cooled = JSON.parse(cool.state.continuation!.serializedState);
    expect(cooled.thermalEpochs).toEqual(after.thermalEpochs);
    expect(cooled.physicalState.thermal[0].temperatureCelsius).toBeCloseTo(
      25 + (heated - 25) * Math.exp(-0.049996 / 4),
      9,
    );
    expect(finish(doc, { requestedHorizonMicroseconds: 150000 }).result).toStrictEqual(cool);
  });
  it('keeps a constant-load thermal epoch through UI tails and fails at the first exact integer microsecond', () => {
    const base = circuit(IDLE);
    const resistor = {
      id: 'r',
      kind: 'resistor' as const,
      position: { x: 100, y: 0 },
      componentTypeId: 'resistor-axial',
      pinIds: ['lead-1', 'lead-2'],
      value: 100,
      stateProperties: { powerRatingWatt: 0.01 },
    };
    const parsed = parseElectronicsEngineDocument({
      ...base,
      components: [
        base.components[0]!,
        resistor,
        { ...resistor, id: 'neighbor', stateProperties: { powerRatingWatt: 1 } },
      ],
      connections: ['r', 'neighbor'].flatMap((id) => [
        {
          id: id + 'a',
          from: { componentId: 'uno', terminal: 'power-5v' },
          to: { componentId: id, terminal: 'lead-1' },
        },
        {
          id: id + 'b',
          from: { componentId: id, terminal: 'lead-2' },
          to: { componentId: 'uno', terminal: 'power-gnd-1' },
        },
      ]),
    });
    if (!parsed.ok) throw new Error(parsed.message);
    const doc = parsed.document;
    const before = finish(doc, { requestedHorizonMicroseconds: 799999 }).result;
    expect(before.executionStatus, JSON.stringify(before.diagnostics)).toBe('ready');
    const prior = JSON.parse(before.state.continuation!.serializedState);
    expect(prior.profile).toBe('electrothermal-events-v2');
    expect(
      prior.physicalState.thermal.find(
        (entry: { componentId: string }) => entry.componentId === 'r',
      ).failureMode,
    ).toBe('none');
    const at = finish(doc, { requestedHorizonMicroseconds: 800000, state: before.state }).result;
    const whole = finish(doc, { requestedHorizonMicroseconds: 800000 }).result;
    expect(at).toStrictEqual(whole);
    const carried = JSON.parse(at.state.continuation!.serializedState);
    expect(
      carried.physicalState.thermal.find(
        (entry: { componentId: string }) => entry.componentId === 'r',
      ).failureMode,
    ).toBe('open');
    expect(
      at.observation!.components.find((entry) => entry.componentId === 'neighbor')!.current,
    ).toBeCloseTo(5 / 100.1, 10);
    const after = finish(doc, { requestedHorizonMicroseconds: 800001, state: at.state }).result;
    expect(after.executionStatus).toBe('ready');
    expect(after.observation!.quality.passed).toBe(true);
  });
});
