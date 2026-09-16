import {
  advanceElectronicsToHorizon,
  analyseElectronicsSnapshot,
  prepareElectronicsSnapshot,
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
    status: 'solved',
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
        computeMs: globalThis.performance.now() - startedAt,
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
  } catch (error) {
    return failure(
      request,
      'internal',
      error instanceof Error ? error.message : 'Electronics simulation evaluation failed.',
    );
  }
}
