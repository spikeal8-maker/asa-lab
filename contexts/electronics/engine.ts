import {
  advanceArduinoCircuitClock,
  type ArduinoCircuitClockAdvance,
  type ArduinoCircuitClockState,
  type ArduinoCircuitInputEvent,
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
  type SimulationQuality,
  type SimulationResult,
  type SimulationStatus,
} from './domain/simulation.js';
import type { ComponentResult, Diagnostic, NodeResult } from './domain/solver.js';

export const ELECTRONICS_ENGINE_CONTRACT_VERSION = 1 as const;
export const ELECTRONICS_TIMED_ENGINE_CONTRACT_VERSION = 1 as const;

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
    ['wiperPosition', 'temperatureCelsius', 'moisturePercent'].includes(event.operation) &&
    typeof event.payload === 'number'
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

export function resetElectronicsTimedState(): ElectronicsTimedState {
  return {
    version: ELECTRONICS_TIMED_ENGINE_CONTRACT_VERSION,
    lifecycle: 'running',
    continuation: null,
  };
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

  const modelSetDigest = analyseCircuit(document).modelSetDigest;
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
  const advanced = advanceArduinoCircuitClock(
    document,
    request.requestedHorizonMicroseconds,
    previous,
    {
      inputs,
      ...(request.maxEvents === undefined ? {} : { maxClockEvents: request.maxEvents }),
    },
  );

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
    observation: timedObservation(advanced.result),
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
