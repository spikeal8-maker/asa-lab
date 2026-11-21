import {
  ELECTRONICS_TIMED_ENGINE_CONTRACT_VERSION,
  resetElectronicsTimedState,
} from './timed-state.js';
export {
  ELECTRONICS_TIMED_ENGINE_CONTRACT_VERSION,
  resetElectronicsTimedState,
} from './timed-state.js';
import {
  advanceArduinoCircuitClock,
  createArduinoCircuitHcSr04TestClock,
  createArduinoCircuitShaftTestClock,
  createOwnedArduinoCircuitClockRequest,
  type ArduinoCircuitClockAdvance,
  type ArduinoCircuitClockState,
  type ArduinoCircuitHcSr04Barrier,
  type ArduinoCircuitInputEvent,
  type ArduinoCircuitShaftBarrier,
  type ArduinoCircuitShaftSample,
} from './domain/arduino-circuit-scheduler.js';
import {
  EMPTY_DOCUMENT,
  parseElectronicsDocument,
  type DocumentParseResult,
  type ElectronicsDocument,
} from './domain/document.js';
import {
  analyseCircuit,
  compileCircuit,
  simulationModelSetDigest,
  type SimulationQuality,
  type SimulationResult,
  type SimulationStatus,
} from './domain/simulation.js';
import { sha256Hex, simulationInputDigest } from './domain/simulation-input-digest.js';
import {
  isHcSr04DistanceMeters,
  type HcSr04EnvironmentSample,
} from './domain/models/hc-sr04-runtime.js';
import type { BrushedMotorExternalShaftState } from './domain/models/brushed-motor-transient-model.js';
import type { ComponentResult, Diagnostic, NodeResult } from './domain/solver.js';
import { type ElectronicsLedTemporalObservation } from './domain/led-temporal-observation.js';
export type {
  ElectronicsLedTemporalObservation,
  ElectronicsLedTemporalComponent,
  ElectronicsLedTemporalSample,
  ElectronicsSevenSegmentTemporal,
  ElectronicsArduinoIndicatorSample,
  ElectronicsArduinoIndicatorTemporal,
} from './domain/led-temporal-observation.js';

export const ELECTRONICS_ENGINE_CONTRACT_VERSION = 1 as const;

export const ELECTRONICS_ENGINE_CAPABILITIES = [
  'parse-document',
  'prepare-topology',
  'analyse-snapshot',
  'advance-timed',
  'manage-timed-state',
] as const;

export type ElectronicsEngineCapability = (typeof ELECTRONICS_ENGINE_CAPABILITIES)[number];
export interface ElectronicsEngineDescriptor {
  readonly contractVersion: typeof ELECTRONICS_ENGINE_CONTRACT_VERSION;
  readonly documentSchemaVersion: ElectronicsDocument['schemaVersion'];
  readonly capabilities: readonly ElectronicsEngineCapability[];
}

export const ELECTRONICS_ENGINE_DESCRIPTOR: ElectronicsEngineDescriptor = Object.freeze({
  contractVersion: ELECTRONICS_ENGINE_CONTRACT_VERSION,
  documentSchemaVersion: EMPTY_DOCUMENT.schemaVersion,
  capabilities: ELECTRONICS_ENGINE_CAPABILITIES,
});

export type ElectronicsEngineDocument = ElectronicsDocument;
export type ElectronicsEngineDocumentParseResult = DocumentParseResult;

/** Canonical logical simulation time. Values are non-negative integer microseconds. */
export type ElectronicsCanonicalMicroseconds = number;

/**
 * One accepted append-only input event. Same-time events are ordered by their accepted array order,
 * never by host arrival timing.
 */
export interface ElectronicsTimedInputEvent {
  readonly atMicroseconds: ElectronicsCanonicalMicroseconds;
  readonly targetId: string;
  readonly operation: string;
  readonly payload: unknown;
}

/** Environment observed by the shared HC-SR04 model at the next accepted Trig pulse. */
export type ElectronicsHcSr04EnvironmentSample = HcSr04EnvironmentSample;

/**
 * Stable serializable continuation envelope. The serialized state is engine-owned and opaque to
 * consumers so later scheduler convergence can preserve this public boundary.
 */
export interface ElectronicsTimedContinuation {
  readonly version: typeof ELECTRONICS_TIMED_ENGINE_CONTRACT_VERSION;
  readonly clockContractVersion: 1;
  readonly engineContractVersion: typeof ELECTRONICS_ENGINE_CONTRACT_VERSION;
  readonly clockProfileId: string;
  readonly documentDigest: string;
  readonly modelSetDigest: string;
  readonly committedHorizonMicroseconds: ElectronicsCanonicalMicroseconds;
  readonly serializedState: string;
}

export type ElectronicsTimedLifecycle = 'running' | 'paused';

export interface ElectronicsTimedState {
  readonly version: typeof ELECTRONICS_TIMED_ENGINE_CONTRACT_VERSION;
  readonly lifecycle: ElectronicsTimedLifecycle;
  readonly continuation: ElectronicsTimedContinuation | null;
}

export interface ElectronicsTimedAdvanceRequest {
  readonly requestedHorizonMicroseconds: ElectronicsCanonicalMicroseconds;
  readonly state?: ElectronicsTimedState;
  /** Newly appended canonical events only; past events live inside the continuation. */
  readonly inputEvents?: readonly ElectronicsTimedInputEvent[];
  /** Optional bounded-work budget. It never changes the requested logical horizon. */
  readonly maxEvents?: number;
}

export interface ElectronicsTimedDiagnostic {
  readonly code: string;
  readonly message: string;
}

export interface ElectronicsArduinoSerialProjection {
  readonly componentId: string;
  readonly begun: boolean;
  readonly baudRate?: number;
  readonly tx: readonly {
    readonly sequence: number;
    readonly atMicroseconds: number;
    readonly text: string;
  }[];
  readonly rxPendingBytes: number;
}

export interface ElectronicsTimedObservation {
  readonly solved: boolean;
  readonly current: number;
  readonly components: readonly ComponentResult[];
  readonly nodes: readonly NodeResult[];
  readonly diagnostics: readonly Diagnostic[];
  readonly iterations: number;
  readonly numericalResidual: number;
  readonly numericalTolerance: number;
  readonly quality: SimulationQuality;
  readonly ledTemporal?: ElectronicsLedTemporalObservation;
}

export type ElectronicsTimedAdvanceResult =
  | {
      readonly executionStatus: 'ready';
      readonly requestedHorizonMicroseconds: ElectronicsCanonicalMicroseconds;
      readonly committedHorizonMicroseconds: ElectronicsCanonicalMicroseconds;
      readonly state: ElectronicsTimedState;
      readonly observation: ElectronicsTimedObservation;
      readonly diagnostics: readonly ElectronicsTimedDiagnostic[];
    }
  | {
      readonly executionStatus: 'yielded';
      readonly requestedHorizonMicroseconds: ElectronicsCanonicalMicroseconds;
      readonly committedHorizonMicroseconds: ElectronicsCanonicalMicroseconds;
      readonly state: ElectronicsTimedState;
      readonly observation: null;
      readonly diagnostics: readonly ElectronicsTimedDiagnostic[];
    }
  | {
      readonly executionStatus: 'fault';
      readonly requestedHorizonMicroseconds: ElectronicsCanonicalMicroseconds;
      readonly committedHorizonMicroseconds: ElectronicsCanonicalMicroseconds;
      /** Last accepted timed state remains authoritative when a future advance faults. */
      readonly state: ElectronicsTimedState;
      readonly observation: null;
      readonly diagnostics: readonly ElectronicsTimedDiagnostic[];
    };

export interface ElectronicsPreparedSnapshot {
  readonly topologySignature: string;
  readonly componentIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly unsupportedComponentIds: readonly string[];
  readonly netCount: number;
}
export interface ElectronicsSnapshotAnalysis {
  readonly solved: boolean;
  readonly status: SimulationStatus;
  readonly current: number;
  readonly components: readonly ComponentResult[];
  readonly nodes: readonly NodeResult[];
  readonly diagnostics: readonly Diagnostic[];
  readonly iterations: number;
  readonly numericalResidual: number;
  readonly numericalTolerance: number;
  readonly quality: SimulationQuality;
  readonly topologySignature: string;
  readonly simulationInputDigest: string;
  readonly solverRevision: SimulationResult['solverRevision'];
  readonly modelSetDigest: string;
  readonly analysis: SimulationResult['analysis'];
}

function schedulerInputEvent(event: ElectronicsTimedInputEvent): ArduinoCircuitInputEvent | null {
  if (event.operation === 'state' && typeof event.payload === 'boolean') {
    return {
      atMicroseconds: event.atMicroseconds,
      componentId: event.targetId,
      property: 'state',
      value: event.payload,
    };
  }
  if (
    [
      'wiperPosition',
      'illumination',
      'temperatureCelsius',
      'moisturePercent',
      'distanceMeters',
    ].includes(event.operation) &&
    typeof event.payload === 'number'
  ) {
    return {
      atMicroseconds: event.atMicroseconds,
      componentId: event.targetId,
      property: event.operation as ArduinoCircuitInputEvent['property'],
      value: event.payload,
    };
  }
  if (event.operation === 'motionDetected' && typeof event.payload === 'boolean') {
    return {
      atMicroseconds: event.atMicroseconds,
      componentId: event.targetId,
      property: 'motionDetected',
      value: event.payload,
    };
  }
  if (event.operation === 'echoAvailable' && typeof event.payload === 'boolean') {
    return {
      atMicroseconds: event.atMicroseconds,
      componentId: event.targetId,
      property: 'echoAvailable',
      value: event.payload,
    };
  }
  if (event.operation === 'serialRx' && typeof event.payload === 'string') {
    return {
      atMicroseconds: event.atMicroseconds,
      componentId: event.targetId,
      property: 'serialRx',
      value: event.payload,
    };
  }
  if (
    [
      'voltageSetpointVolt',
      'currentLimitAmp',
      'outputEnabled',
      'waveform',
      'frequencyHz',
      'amplitudeVpp',
      'dcOffsetVolt',
      'voltsPerDivision',
      'timePerDivisionMs',
      'triggerLevelVolt',
      'displayEnabled',
      'measurementMode',
    ].includes(event.operation) &&
    (typeof event.payload === 'boolean' ||
      typeof event.payload === 'string' ||
      (typeof event.payload === 'number' && Number.isFinite(event.payload)))
  ) {
    return {
      atMicroseconds: event.atMicroseconds,
      componentId: event.targetId,
      property: event.operation as ArduinoCircuitInputEvent['property'],
      value: event.payload,
    };
  }
  return null;
}

function decodeTimedContinuation(
  continuation: ElectronicsTimedContinuation,
  modelSetDigest: string,
): ArduinoCircuitClockState | null {
  if (
    continuation.version !== ELECTRONICS_TIMED_ENGINE_CONTRACT_VERSION ||
    continuation.clockContractVersion !== 1 ||
    continuation.engineContractVersion !== ELECTRONICS_ENGINE_CONTRACT_VERSION ||
    continuation.modelSetDigest !== modelSetDigest
  ) {
    return null;
  }
  try {
    const state = JSON.parse(continuation.serializedState) as ArduinoCircuitClockState;
    return state &&
      state.version === 1 &&
      state.profile === continuation.clockProfileId &&
      state.documentDigest === continuation.documentDigest &&
      state.reachedMicroseconds === continuation.committedHorizonMicroseconds
      ? state
      : null;
  } catch {
    return null;
  }
}

function timedContinuation(
  state: ArduinoCircuitClockState,
  modelSetDigest: string,
): ElectronicsTimedContinuation {
  return {
    version: ELECTRONICS_TIMED_ENGINE_CONTRACT_VERSION,
    clockContractVersion: 1,
    engineContractVersion: ELECTRONICS_ENGINE_CONTRACT_VERSION,
    clockProfileId: state.profile,
    documentDigest: state.documentDigest,
    modelSetDigest,
    committedHorizonMicroseconds: state.reachedMicroseconds,
    serializedState: JSON.stringify(state),
  };
}

function timedObservation(
  result: NonNullable<ArduinoCircuitClockAdvance['result']>,
): ElectronicsTimedObservation {
  return {
    solved: result.solved,
    current: result.current,
    components: result.components,
    nodes: result.nodes,
    diagnostics: result.diagnostics,
    iterations: result.iterations,
    numericalResidual: result.numericalResidual,
    numericalTolerance: result.numericalTolerance,
    quality: result.quality,
  };
}

export function projectElectronicsArduinoSerial(
  state: ElectronicsTimedState,
): readonly ElectronicsArduinoSerialProjection[] {
  const serialized = state.continuation?.serializedState;
  if (!serialized) return [];
  try {
    return (JSON.parse(serialized) as ArduinoCircuitClockState).boards.flatMap(
      ({ componentId, runtime }) => {
        const serial = runtime.serial;
        return serial
          ? [
              {
                componentId,
                begun: serial.begun,
                ...(serial.baudRate === undefined ? {} : { baudRate: serial.baudRate }),
                tx: serial.tx.map((entry: ElectronicsArduinoSerialProjection['tx'][number]) => ({
                  ...entry,
                })),
                rxPendingBytes: serial.rx?.length ?? 0,
              },
            ]
          : [];
      },
    );
  } catch {
    return [];
  }
}

export function pauseElectronicsTimedState(state: ElectronicsTimedState): ElectronicsTimedState {
  return state.lifecycle === 'paused' ? state : { ...state, lifecycle: 'paused' };
}

export function resumeElectronicsTimedState(state: ElectronicsTimedState): ElectronicsTimedState {
  return state.lifecycle === 'running' ? state : { ...state, lifecycle: 'running' };
}

export function advanceElectronicsToHorizon(
  document: ElectronicsEngineDocument,
  request: ElectronicsTimedAdvanceRequest,
): ElectronicsTimedAdvanceResult {
  return advanceElectronicsRequest(document, request, false).next().value!;
}

/** Each next() performs at most maxEvents canonical MCU/barrier work; null means pending. */
export function createElectronicsAdvanceSession(
  document: ElectronicsEngineDocument,
  request: ElectronicsTimedAdvanceRequest,
  options: {
    readonly observeLedTemporal?: boolean;
    readonly observeSevenSegmentTemporal?: boolean;
  } = {},
) {
  // The caller can change its document/state while the Worker yields; own this request snapshot.
  const ownedDocument = structuredClone(document);
  const ownedRequest = structuredClone(request);
  const ownership = createOwnedArduinoCircuitClockRequest(ownedDocument, ownedRequest);
  const iterator = advanceElectronicsRequest(
    ownedDocument,
    ownedRequest,
    true,
    options.observeLedTemporal === true,
    ownership,
    options.observeSevenSegmentTemporal === true,
  );
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    iterator.return(undefined as never);
  };
  return {
    step: () => (disposed ? undefined : iterator.next().value!),
    dispose,
  };
}

interface HcSr04TestIdentity {
  readonly componentId: string;
  readonly atMicroseconds: number;
  readonly runId: string;
  readonly generation: number;
  readonly sequence: number;
  /** In-process ownership. Even matching labels cannot authorize another live query. */
  readonly token: symbol;
}

export type ElectronicsHcSr04TestQuery = HcSr04TestIdentity & ArduinoCircuitHcSr04Barrier;
export type ElectronicsHcSr04TestResponse = HcSr04TestIdentity & {
  readonly geometryAtMicroseconds: number;
  readonly sample: ElectronicsHcSr04EnvironmentSample;
};

type HcSr04TestRequest = Omit<ElectronicsTimedAdvanceRequest, 'state'> & {
  readonly componentId: string;
  readonly runId: string;
  readonly generation: number;
};

type HcSr04TestStep =
  | ElectronicsHcSr04TestQuery
  | {
      readonly kind: 'working' | 'paused';
      readonly committedHorizonMicroseconds: number;
    }
  | {
      readonly kind: 'fault';
      readonly committedHorizonMicroseconds: number;
      readonly diagnostics: readonly ElectronicsTimedDiagnostic[];
    }
  | {
      readonly kind: 'complete';
      readonly committedHorizonMicroseconds: number;
      readonly clockState: ArduinoCircuitClockState;
      readonly clockStateDigest: string;
      readonly events: ArduinoCircuitClockAdvance['events'];
      readonly observation: ElectronicsTimedObservation;
    };

function ownTestData(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const properties = Object.entries(descriptors);
  if (
    Object.getOwnPropertySymbols(descriptors).length > 0 ||
    properties.some(([, property]) => !Object.hasOwn(property, 'value'))
  )
    return undefined;
  return Object.fromEntries(properties.map(([key, property]) => [key, property.value]));
}

function acceptedHcSr04TestSample(
  value: unknown,
  query: ElectronicsHcSr04TestQuery,
): ElectronicsHcSr04EnvironmentSample | undefined {
  try {
    const response = ownTestData(value);
    if (
      !response ||
      response['token'] !== query.token ||
      response['componentId'] !== query.componentId ||
      response['runId'] !== query.runId ||
      response['generation'] !== query.generation ||
      response['sequence'] !== query.sequence ||
      response['atMicroseconds'] !== query.atMicroseconds ||
      response['geometryAtMicroseconds'] !== query.atMicroseconds
    )
      return undefined;
    const sample = ownTestData(response['sample']);
    if (!sample) return undefined;
    if (sample['kind'] === 'no-echo' && Object.keys(sample).length === 1)
      return { kind: 'no-echo' };
    if (
      sample['kind'] === 'echo' &&
      Object.keys(sample).length === 2 &&
      isHcSr04DistanceMeters(sample['distanceMeters'])
    )
      return { kind: 'echo', distanceMeters: sample['distanceMeters'] };
  } catch {
    // An unreadable input is a rejected reply, never a failed clock transaction.
  }
  return undefined;
}

function ownHcSr04TestRun(document: ElectronicsEngineDocument, request: HcSr04TestRequest) {
  const ownedRequest = structuredClone(request);
  if (
    !ownedRequest.runId ||
    !ownedRequest.componentId ||
    !Number.isSafeInteger(ownedRequest.generation) ||
    ownedRequest.generation < 1
  )
    throw new TypeError('The HC-SR04 test run needs valid identity labels.');

  const inputs = (ownedRequest.inputEvents ?? []).map((event) => {
    const input = schedulerInputEvent(event);
    if (!input) throw new TypeError('Unsupported HC-SR04 test input operation.');
    return input;
  });
  return {
    document: structuredClone(document),
    runId: ownedRequest.runId,
    generation: ownedRequest.generation,
    componentId: ownedRequest.componentId,
    requestedHorizonMicroseconds: ownedRequest.requestedHorizonMicroseconds,
    options: {
      inputs,
      ...(ownedRequest.maxEvents === undefined ? {} : { maxClockEvents: ownedRequest.maxEvents }),
    },
  };
}

/** TEST_ONLY in-memory seam. This session neither takes nor returns a v1 continuation. */
export function createElectronicsHcSr04QueryTestSession(
  document: ElectronicsEngineDocument,
  request: HcSr04TestRequest,
) {
  type OwnedRun = ReturnType<typeof ownHcSr04TestRun>;
  const openClock = (run: OwnedRun) =>
    createArduinoCircuitHcSr04TestClock(
      run.document,
      run.requestedHorizonMicroseconds,
      run.options,
      run.componentId,
    );
  let ownedRun: OwnedRun | undefined = ownHcSr04TestRun(document, request);
  let clock: ReturnType<typeof openClock> | undefined = openClock(ownedRun);
  let generation = ownedRun.generation;
  let sequence = 0;
  let committedHorizonMicroseconds = 0;
  let pending: ElectronicsHcSr04TestQuery | undefined;
  let reply: ElectronicsHcSr04EnvironmentSample | undefined;
  let paused = false;

  function close() {
    const active = clock;
    clock = undefined;
    pending = undefined;
    reply = undefined;
    paused = false;
    active?.return(undefined as never);
  }

  return {
    step(): HcSr04TestStep | undefined {
      if (!clock || !ownedRun) return undefined;
      if (paused) return { kind: 'paused', committedHorizonMicroseconds };
      if (pending) return pending;
      const sample = reply;
      reply = undefined;
      let next: ReturnType<typeof clock.next>;
      try {
        next = clock.next(sample);
      } catch {
        close();
        return {
          kind: 'fault',
          committedHorizonMicroseconds,
          diagnostics: [
            { code: 'hc_sr04_test_clock_failed', message: 'The HC-SR04 test clock failed.' },
          ],
        };
      }
      if (!next.done) {
        const suspension = next.value;
        committedHorizonMicroseconds = suspension.committedHorizonMicroseconds;
        if (suspension.kind === 'working') return suspension;
        pending = Object.freeze({
          ...suspension,
          runId: ownedRun.runId,
          generation,
          sequence: ++sequence,
          token: Symbol(),
        });
        return pending;
      }

      close();
      const advance = next.value;
      if (advance.executionStatus !== 'ready' || !advance.state || !advance.result)
        return {
          kind: 'fault',
          committedHorizonMicroseconds,
          diagnostics: advance.diagnostics,
        };
      return {
        kind: 'complete',
        committedHorizonMicroseconds: advance.state.reachedMicroseconds,
        clockState: structuredClone(advance.state),
        clockStateDigest: sha256Hex(JSON.stringify(advance.state)),
        events: structuredClone(advance.events),
        observation: timedObservation(advance.result),
      };
    },
    respond(value: unknown): boolean {
      const query = pending;
      if (paused || !query) return false;
      const sample = acceptedHcSr04TestSample(value, query);
      if (!sample || pending !== query || paused) return false;
      pending = undefined;
      reply = sample;
      return true;
    },
    pause() {
      if (clock) paused = true;
    },
    resume() {
      paused = false;
    },
    cancel: close,
    reset(nextGeneration: number): boolean {
      if (!ownedRun || !Number.isSafeInteger(nextGeneration) || nextGeneration <= generation)
        return false;
      close();
      generation = nextGeneration;
      sequence = 0;
      committedHorizonMicroseconds = 0;
      clock = openClock(ownedRun);
      return true;
    },
    dispose() {
      ownedRun = undefined;
      close();
    },
  };
}

type TtNativeDriveTestRequest = Omit<ElectronicsTimedAdvanceRequest, 'state'> & {
  readonly componentId: string;
  readonly port: string;
  readonly runId: string;
  readonly generation: number;
};

type TtShaftIdentity = Pick<
  ArduinoCircuitShaftBarrier,
  'componentId' | 'port' | 'axis' | 'fromMicroseconds' | 'toMicroseconds'
> & {
  readonly runId: string;
  readonly generation: number;
  readonly sequence: number;
  readonly token: symbol;
};

export type ElectronicsTtNativeDriveTestQuery = TtShaftIdentity & ArduinoCircuitShaftBarrier;
export type ElectronicsTtNativeDriveTestResponse = TtShaftIdentity & ArduinoCircuitShaftSample;

type TtCheckpoint = {
  readonly committedHorizonMicroseconds: number;
  readonly shaft: ArduinoCircuitShaftSample | undefined;
  readonly winding: BrushedMotorExternalShaftState | undefined;
};

type TtNativeDriveTestStep =
  | ElectronicsTtNativeDriveTestQuery
  | { readonly kind: 'working' | 'paused'; readonly committedHorizonMicroseconds: number }
  | (TtCheckpoint & {
      readonly kind: 'fault';
      readonly diagnostics: readonly ElectronicsTimedDiagnostic[];
    })
  | (TtCheckpoint & {
      readonly kind: 'complete';
      readonly events: ArduinoCircuitClockAdvance['events'];
      readonly observation: ElectronicsTimedObservation;
    });

function ownTtNativeDriveTestRun(
  document: ElectronicsEngineDocument,
  request: TtNativeDriveTestRequest,
) {
  const ownedRequest = structuredClone(request);
  const { componentId, port, runId, generation, requestedHorizonMicroseconds, maxEvents } =
    ownedRequest;
  if (
    [componentId, port, runId].some((label) => typeof label !== 'string' || !label.trim()) ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    !Number.isSafeInteger(requestedHorizonMicroseconds) ||
    requestedHorizonMicroseconds < 0 ||
    requestedHorizonMicroseconds > 10_000_000
  )
    throw new TypeError(
      'The TT test run needs valid identities and a horizon of at most 10 seconds.',
    );
  const inputs = (ownedRequest.inputEvents ?? []).map((event) => {
    const input = schedulerInputEvent(event);
    if (!input) throw new TypeError('Unsupported TT test input operation.');
    return input;
  });
  return {
    document: structuredClone(document),
    runId,
    generation,
    requestedHorizonMicroseconds,
    shaftPort: { componentId, port },
    options: { inputs, ...(maxEvents === undefined ? {} : { maxClockEvents: maxEvents }) },
  };
}

function acceptedTtShaftSample(
  value: unknown,
  query: ElectronicsTtNativeDriveTestQuery,
): ArduinoCircuitShaftSample | undefined {
  try {
    const response = ownTestData(value);
    if (
      !response ||
      response['token'] !== query.token ||
      response['runId'] !== query.runId ||
      response['generation'] !== query.generation ||
      response['sequence'] !== query.sequence ||
      response['componentId'] !== query.componentId ||
      response['port'] !== query.port ||
      response['axis'] !== query.axis ||
      response['fromMicroseconds'] !== query.fromMicroseconds ||
      response['toMicroseconds'] !== query.toMicroseconds ||
      response['measuredAtMicroseconds'] !== query.toMicroseconds
    )
      return undefined;
    const { angleRadian, angularVelocityRadPerSecond } = response;
    if (
      typeof angleRadian !== 'number' ||
      !Number.isFinite(angleRadian) ||
      typeof angularVelocityRadPerSecond !== 'number' ||
      !Number.isFinite(angularVelocityRadPerSecond)
    )
      return undefined;
    return {
      measuredAtMicroseconds: query.toMicroseconds,
      angleRadian,
      angularVelocityRadPerSecond,
    };
  } catch {
    return undefined;
  }
}

/** TEST_ONLY. A fresh, in-memory TT session leaves the public timed clock unchanged. */
export function createElectronicsTtNativeDriveTestSession(
  document: ElectronicsEngineDocument,
  request: TtNativeDriveTestRequest,
) {
  type OwnedRun = ReturnType<typeof ownTtNativeDriveTestRun>;
  const openClock = (run: OwnedRun) =>
    createArduinoCircuitShaftTestClock(
      run.document,
      run.requestedHorizonMicroseconds,
      run.options,
      { ...run.shaftPort, onCheckpoint: retain },
    );
  let ownedRun: OwnedRun | undefined = ownTtNativeDriveTestRun(document, request);
  let clock: ReturnType<typeof openClock> | undefined = openClock(ownedRun);
  let generation = ownedRun.generation;
  let sequence = 0;
  let pending: ElectronicsTtNativeDriveTestQuery | undefined;
  let reply: ArduinoCircuitShaftSample | undefined;
  let pendingWinding: BrushedMotorExternalShaftState | undefined;
  let candidate: TtCheckpoint | undefined;
  let committed: TtCheckpoint = {
    committedHorizonMicroseconds: 0,
    shaft: undefined,
    winding: undefined,
  };
  let paused = false;

  const close = () => {
    const active = clock;
    clock = undefined;
    pending = undefined;
    reply = undefined;
    pendingWinding = undefined;
    candidate = undefined;
    paused = false;
    active?.return(undefined as never);
  };
  function retain(time: number) {
    if (candidate?.committedHorizonMicroseconds === time) {
      committed = candidate;
      candidate = undefined;
    } else if (time !== committed.committedHorizonMicroseconds) {
      throw new Error('A closed TT checkpoint has no matching shaft sample.');
    }
  }
  return {
    step(): TtNativeDriveTestStep | undefined {
      if (!clock || !ownedRun) return undefined;
      if (paused)
        return {
          kind: 'paused',
          committedHorizonMicroseconds: committed.committedHorizonMicroseconds,
        };
      if (pending) return pending;
      const sample = reply;
      reply = undefined;
      try {
        const next = clock.next(sample);
        if (!next.done) {
          const suspension = next.value;
          if (suspension.kind === 'working') return suspension;
          pendingWinding =
            suspension.kind === 'shaft-interval' ? suspension.winding.state : undefined;
          pending = Object.freeze({
            ...structuredClone(suspension),
            runId: ownedRun.runId,
            generation,
            sequence: ++sequence,
            token: Symbol(),
          });
          return pending;
        }
        const advance = next.value;
        if (advance.executionStatus !== 'ready' || !advance.state || !advance.result) {
          close();
          return { kind: 'fault', ...structuredClone(committed), diagnostics: advance.diagnostics };
        }
        close();
        return {
          kind: 'complete',
          ...structuredClone(committed),
          events: structuredClone(advance.events),
          observation: timedObservation(advance.result),
        };
      } catch (error) {
        close();
        return {
          kind: 'fault',
          ...structuredClone(committed),
          diagnostics: [
            {
              code: 'tt_native_drive_test_clock_failed',
              message: error instanceof Error ? error.message : 'The TT test clock failed.',
            },
          ],
        };
      }
    },
    respond(value: unknown): boolean {
      const query = pending;
      if (paused || !query) return false;
      const sample = acceptedTtShaftSample(value, query);
      if (!sample || pending !== query || paused) return false;
      pending = undefined;
      reply = sample;
      candidate = {
        committedHorizonMicroseconds: sample.measuredAtMicroseconds,
        shaft: sample,
        winding: pendingWinding,
      };
      pendingWinding = undefined;
      return true;
    },
    lastCommitted: () => structuredClone(committed),
    pause() {
      if (clock) paused = true;
    },
    resume() {
      paused = false;
    },
    cancel: close,
    reset(nextGeneration: number): boolean {
      if (!ownedRun || !Number.isSafeInteger(nextGeneration) || nextGeneration <= generation)
        return false;
      close();
      generation = nextGeneration;
      sequence = 0;
      committed = { committedHorizonMicroseconds: 0, shaft: undefined, winding: undefined };
      clock = openClock(ownedRun);
      return true;
    },
    dispose() {
      ownedRun = undefined;
      close();
      committed = { committedHorizonMicroseconds: 0, shaft: undefined, winding: undefined };
    },
  };
}

function* advanceElectronicsRequest(
  document: ElectronicsEngineDocument,
  request: ElectronicsTimedAdvanceRequest,
  internalBatches: boolean,
  observeLedTemporal = false,
  ownership?: ReturnType<typeof createOwnedArduinoCircuitClockRequest>,
  observeSevenSegmentTemporal = false,
): Generator<null, ElectronicsTimedAdvanceResult, void> {
  // Recheck before even the initial structural/model guards can call a producer.
  ownership?.check();
  const state = request.state ?? resetElectronicsTimedState();
  const previousContinuation = state.continuation;
  const previousCommitted = previousContinuation?.committedHorizonMicroseconds ?? 0;
  if (state.lifecycle === 'paused') {
    return {
      executionStatus: 'fault',
      requestedHorizonMicroseconds: request.requestedHorizonMicroseconds,
      committedHorizonMicroseconds: previousCommitted,
      state,
      observation: null,
      diagnostics: [
        { code: 'timed_state_paused', message: 'Resume the timed state before advancing.' },
      ],
    };
  }

  // Preserve the old structural validation and exception priority before continuation guards.
  // The registry identity itself does not require a separate numerical solve/quality check.
  compileCircuit(document);
  if (ownership) ownership.validateDigest();
  else simulationInputDigest(document, 0);
  const modelSetDigest = simulationModelSetDigest();
  let previous: ArduinoCircuitClockState | undefined;
  if (previousContinuation) {
    const decoded = decodeTimedContinuation(previousContinuation, modelSetDigest);
    if (!decoded) {
      return {
        executionStatus: 'fault',
        requestedHorizonMicroseconds: request.requestedHorizonMicroseconds,
        committedHorizonMicroseconds: previousCommitted,
        state,
        observation: null,
        diagnostics: [
          {
            code: 'invalid_timed_continuation',
            message: 'Timed continuation is incompatible with this engine, document or model set.',
          },
        ],
      };
    }
    previous = decoded;
  }

  const appendedInputs: ArduinoCircuitInputEvent[] = [];
  for (const event of request.inputEvents ?? []) {
    const mapped = schedulerInputEvent(event);
    if (!mapped) {
      return {
        executionStatus: 'fault',
        requestedHorizonMicroseconds: request.requestedHorizonMicroseconds,
        committedHorizonMicroseconds: previousCommitted,
        state,
        observation: null,
        diagnostics: [
          {
            code: 'unsupported_timed_input',
            message: `Unsupported timed input operation: ${event.operation}.`,
          },
        ],
      };
    }
    appendedInputs.push(mapped);
  }

  const inputs = [...(previous?.inputs ?? []), ...appendedInputs];
  const options = {
    inputs,
    ...(request.maxEvents === undefined ? {} : { maxClockEvents: request.maxEvents }),
  };
  const driver =
    internalBatches && ownership
      ? ownership.create(
          request.requestedHorizonMicroseconds,
          previous,
          options,
          observeLedTemporal,
          observeSevenSegmentTemporal,
        )
      : null;
  let opticalObservation: ElectronicsLedTemporalObservation | null | undefined;
  let advanced: ArduinoCircuitClockAdvance;
  try {
    do {
      if (driver) {
        const next = driver.step()!;
        advanced = next.advanced;
        opticalObservation = next.ledTemporal;
      } else
        advanced = advanceArduinoCircuitClock(
          document,
          request.requestedHorizonMicroseconds,
          previous,
          options,
        );
      if (!internalBatches || advanced.executionStatus !== 'yielded') break;
      previous = advanced.state ?? undefined;
      yield null;
    } while (true);
  } finally {
    driver?.dispose();
  }

  if (advanced.executionStatus === 'fault' || !advanced.state) {
    return {
      executionStatus: 'fault',
      requestedHorizonMicroseconds: request.requestedHorizonMicroseconds,
      committedHorizonMicroseconds: previousCommitted,
      state,
      observation: null,
      diagnostics: advanced.diagnostics,
    };
  }

  const continuation = timedContinuation(advanced.state, modelSetDigest);
  const nextState: ElectronicsTimedState = {
    version: ELECTRONICS_TIMED_ENGINE_CONTRACT_VERSION,
    lifecycle: 'running',
    continuation,
  };
  if (advanced.executionStatus === 'yielded') {
    return {
      executionStatus: 'yielded',
      requestedHorizonMicroseconds: request.requestedHorizonMicroseconds,
      committedHorizonMicroseconds: advanced.state.reachedMicroseconds,
      state: nextState,
      observation: null,
      diagnostics: advanced.diagnostics,
    };
  }

  if (!advanced.result) {
    return {
      executionStatus: 'fault',
      requestedHorizonMicroseconds: request.requestedHorizonMicroseconds,
      committedHorizonMicroseconds: previousCommitted,
      state,
      observation: null,
      diagnostics: [
        {
          code: 'missing_timed_observation',
          message: 'Ready timed advance omitted its observation.',
        },
      ],
    };
  }

  return {
    executionStatus: 'ready',
    requestedHorizonMicroseconds: request.requestedHorizonMicroseconds,
    committedHorizonMicroseconds: advanced.state.reachedMicroseconds,
    state: nextState,
    observation: {
      ...timedObservation(advanced.result),
      ...(opticalObservation ? { ledTemporal: opticalObservation } : {}),
    },
    diagnostics: advanced.diagnostics,
  };
}
export function parseElectronicsEngineDocument(
  value: unknown,
): ElectronicsEngineDocumentParseResult {
  return parseElectronicsDocument(value);
}

export function prepareElectronicsSnapshot(
  document: ElectronicsEngineDocument,
): ElectronicsPreparedSnapshot {
  const compiled = compileCircuit(document);
  return {
    topologySignature: compiled.topologySignature,
    componentIds: compiled.componentIds,
    sourceIds: compiled.sourceIds,
    unsupportedComponentIds: compiled.unsupportedComponentIds,
    netCount: compiled.netlist.nodeCount,
  };
}

export function analyseElectronicsSnapshot(
  document: ElectronicsEngineDocument,
): ElectronicsSnapshotAnalysis {
  const result = analyseCircuit(document);
  return {
    solved: result.solved,
    status: result.status,
    current: result.current,
    components: result.components,
    nodes: result.nodes,
    diagnostics: result.diagnostics,
    iterations: result.iterations,
    numericalResidual: result.numericalResidual,
    numericalTolerance: result.numericalTolerance,
    quality: result.quality,
    topologySignature: result.topologySignature,
    simulationInputDigest: result.simulationInputDigest,
    solverRevision: result.solverRevision,
    modelSetDigest: result.modelSetDigest,
    analysis: result.analysis,
  };
}
