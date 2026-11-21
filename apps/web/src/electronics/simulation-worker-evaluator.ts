import {
  advanceElectronicsToHorizon,
  createElectronicsAdvanceSession,
  analyseElectronicsSnapshot,
  prepareElectronicsSnapshot,
  projectElectronicsArduinoSerial,
  type ElectronicsTimedAdvanceResult,
} from '@asa-lab/electronics/engine';
import type { SchematicDocument, SolveResult } from '../api';
import { calculateSimulationPreflight } from './live-simulation';
import {
  ELECTRONICS_SIMULATION_ENGINE_REVISION,
  ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
  type ElectronicsSimulationWorkerResponse,
  type SimulationAdvanceRequest,
  type SimulationPreflightRequest,
  type SimulationTimedAdvancePayload,
} from './simulation-worker-protocol';

type EvaluationRequest = SimulationPreflightRequest | SimulationAdvanceRequest;

export interface SimulationWorkerPhaseTiming {
  readonly workerTimeOriginMs: number;
  readonly workerReceivedAt: number;
  prepareStartedAt?: number;
  prepareFinishedAt?: number;
  steps: number;
  stepMs: number;
  yields: number;
  yieldWaitMs: number;
  projectionStartedAt?: number;
  projectionFinishedAt?: number;
  workerPostAt?: number;
}

function failure(
  request: EvaluationRequest,
  code: Extract<ElectronicsSimulationWorkerResponse, { ok: false }>['code'],
  message: string,
): ElectronicsSimulationWorkerResponse {
  return {
    protocolVersion: ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
    requestId: request.requestId,
    generationId: request.generationId,
    projectSessionId: request.projectSessionId,
    ok: false,
    code,
    message,
  };
}

function presentationResult(
  document: SchematicDocument,
  timed: ElectronicsTimedAdvanceResult,
): SolveResult | null {
  if (timed.executionStatus !== 'ready' || !timed.observation) return null;
  const continuation = timed.state.continuation;
  const prepared = prepareElectronicsSnapshot(document);
  const transient = continuation?.clockProfileId !== 'dc-inputs-v1';
  return {
    solved: timed.observation.solved,
    status: timed.observation.solved ? 'solved' : 'invalid',
    current: timed.observation.current,
    components: structuredClone(timed.observation.components) as SolveResult['components'],
    nodes: timed.observation.nodes.map((node) => ({ ...node, terminals: [...node.terminals] })),
    diagnostics: structuredClone(timed.observation.diagnostics) as SolveResult['diagnostics'],
    iterations: timed.observation.iterations,
    numericalResidual: timed.observation.numericalResidual,
    numericalTolerance: timed.observation.numericalTolerance,
    quality: timed.observation.quality,
    topologySignature: prepared.topologySignature,
    ...(continuation ? { simulationInputDigest: continuation.documentDigest } : {}),
    solverRevision: ELECTRONICS_SIMULATION_ENGINE_REVISION,
    ...(continuation ? { modelSetDigest: continuation.modelSetDigest } : {}),
    analysis: {
      electricalMode: transient ? 'transient' : 'dc',
      controllerRuntime: document.components.some(
        (component) => component.componentTypeId === 'arduino-uno',
      )
        ? 'arduino'
        : 'none',
    },
  };
}

function advancePayload(
  document: SchematicDocument,
  timed: ElectronicsTimedAdvanceResult,
): SimulationTimedAdvancePayload {
  return {
    executionStatus: timed.executionStatus,
    requestedHorizonMicroseconds: timed.requestedHorizonMicroseconds,
    committedHorizonMicroseconds: timed.committedHorizonMicroseconds,
    state: timed.state,
    result: presentationResult(document, timed),
    ...(timed.observation?.ledTemporal ? { ledTemporal: timed.observation.ledTemporal } : {}),
    serial: projectElectronicsArduinoSerial(timed.state),
    diagnostics: timed.diagnostics,
  };
}

export function evaluateSimulationWorkerRequest(
  request: EvaluationRequest,
): ElectronicsSimulationWorkerResponse {
  if (request.protocolVersion !== ELECTRONICS_SIMULATION_WORKER_PROTOCOL) {
    return failure(request, 'protocol-mismatch', 'Electronics Worker protocol version mismatch.');
  }
  if (request.engineRevision !== ELECTRONICS_SIMULATION_ENGINE_REVISION) {
    return failure(
      request,
      'solver-mismatch',
      'Requested Electronics solver revision is unavailable.',
    );
  }
  if (
    request.kind === 'advance' &&
    (!Number.isSafeInteger(request.requestedHorizonMicroseconds) ||
      request.requestedHorizonMicroseconds < 0)
  ) {
    return failure(
      request,
      'invalid-request',
      'Requested Electronics horizon must be a non-negative safe integer microsecond value.',
    );
  }

  const startedAt = globalThis.performance.now();
  try {
    if (request.kind === 'preflight') {
      const stableSnapshot = analyseElectronicsSnapshot(request.document);
      const result = calculateSimulationPreflight(request.document, 0);
      if (!result.simulationInputDigest || !result.topologySignature) {
        return failure(request, 'internal', 'Electronics solver omitted required result metadata.');
      }
      if (
        stableSnapshot.solverRevision !== result.solverRevision ||
        stableSnapshot.modelSetDigest !== result.modelSetDigest ||
        stableSnapshot.topologySignature !== result.topologySignature ||
        stableSnapshot.simulationInputDigest !== result.simulationInputDigest
      ) {
        return failure(
          request,
          'internal',
          'Electronics engine facade diverged from Worker preflight identity.',
        );
      }
      return {
        protocolVersion: ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
        requestId: request.requestId,
        generationId: request.generationId,
        projectSessionId: request.projectSessionId,
        ok: true,
        kind: 'preflight',
        result,
        metrics: {
          computeMs: globalThis.performance.now() - startedAt,
          solverRevision: ELECTRONICS_SIMULATION_ENGINE_REVISION,
          executionStatus: 'preflight',
          simulationInputDigest: result.simulationInputDigest,
          topologySignature: result.topologySignature,
        },
      };
    }

    const timed = advanceElectronicsToHorizon(request.document, {
      requestedHorizonMicroseconds: request.requestedHorizonMicroseconds,
      state: request.state,
      ...(request.inputEvents ? { inputEvents: request.inputEvents } : {}),
    });
    return timedResponse(request, timed, globalThis.performance.now() - startedAt);
  } catch (error) {
    return failure(
      request,
      'internal',
      error instanceof Error ? error.message : 'Electronics simulation evaluation failed.',
    );
  }
}

function timedResponse(
  request: SimulationAdvanceRequest,
  timed: ElectronicsTimedAdvanceResult,
  computeMs: number,
): ElectronicsSimulationWorkerResponse {
  const projectionStarted = globalThis.performance.now();
  const advance = advancePayload(request.document, timed);
  return {
    protocolVersion: ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
    requestId: request.requestId,
    generationId: request.generationId,
    projectSessionId: request.projectSessionId,
    ok: true,
    kind: 'advance',
    advance,
    metrics: {
      computeMs: computeMs + globalThis.performance.now() - projectionStarted,
      solverRevision: ELECTRONICS_SIMULATION_ENGINE_REVISION,
      executionStatus: timed.executionStatus,
      requestedHorizonMicroseconds: timed.requestedHorizonMicroseconds,
      committedHorizonMicroseconds: timed.committedHorizonMicroseconds,
      ...(timed.state.continuation
        ? { simulationInputDigest: timed.state.continuation.documentDigest }
        : {}),
      ...(advance.result?.topologySignature
        ? { topologySignature: advance.result.topologySignature }
        : {}),
    },
  };
}

/** Continue fixed canonical batches privately; only a complete request is published. */
export async function evaluateSimulationWorkerRequestBatched(
  request: EvaluationRequest,
  isCurrent: () => boolean,
  yieldControl: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0)),
  phaseTiming?: SimulationWorkerPhaseTiming,
): Promise<ElectronicsSimulationWorkerResponse | null> {
  if (
    request.kind !== 'advance' ||
    request.protocolVersion !== ELECTRONICS_SIMULATION_WORKER_PROTOCOL ||
    request.engineRevision !== ELECTRONICS_SIMULATION_ENGINE_REVISION ||
    !Number.isSafeInteger(request.requestedHorizonMicroseconds) ||
    request.requestedHorizonMicroseconds < 0
  )
    return isCurrent() ? evaluateSimulationWorkerRequest(request) : null;
  let session: ReturnType<typeof createElectronicsAdvanceSession> | undefined;
  try {
    const prepareStarted = globalThis.performance.now();
    if (phaseTiming) phaseTiming.prepareStartedAt = prepareStarted;
    const owned = structuredClone(request);
    session = createElectronicsAdvanceSession(
      owned.document,
      {
        requestedHorizonMicroseconds: owned.requestedHorizonMicroseconds,
        state: owned.state,
        ...(owned.inputEvents ? { inputEvents: owned.inputEvents } : {}),
      },
      { observeLedTemporal: true, observeSevenSegmentTemporal: true },
    );
    const prepareFinished = globalThis.performance.now();
    let computeMs = prepareFinished - prepareStarted;
    if (phaseTiming) phaseTiming.prepareFinishedAt = prepareFinished;
    let sliceStarted = globalThis.performance.now();
    while (isCurrent()) {
      const before = globalThis.performance.now();
      const timed = session.step();
      const now = globalThis.performance.now();
      computeMs += now - before;
      if (phaseTiming) {
        phaseTiming.steps += 1;
        phaseTiming.stepMs += now - before;
      }
      if (!isCurrent()) return null;
      if (timed) {
        if (!phaseTiming) return timedResponse(owned, timed, computeMs);
        phaseTiming.projectionStartedAt = globalThis.performance.now();
        const response = timedResponse(owned, timed, computeMs);
        phaseTiming.projectionFinishedAt = globalThis.performance.now();
        return response;
      }
      if (now - sliceStarted >= 8) {
        const yieldStartedAt = phaseTiming ? globalThis.performance.now() : 0;
        await yieldControl();
        sliceStarted = globalThis.performance.now();
        if (phaseTiming) {
          phaseTiming.yields += 1;
          phaseTiming.yieldWaitMs += sliceStarted - yieldStartedAt;
        }
      }
    }
    return null;
  } catch (error) {
    return isCurrent()
      ? failure(
          request,
          'internal',
          error instanceof Error ? error.message : 'Electronics execution failed.',
        )
      : null;
  } finally {
    session?.dispose();
  }
}
