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
  it.each([1, 7, 256])(
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
  it.each([1, 7, 256])(
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
