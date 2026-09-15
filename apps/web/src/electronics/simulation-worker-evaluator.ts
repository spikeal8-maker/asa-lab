import { analyseElectronicsSnapshot } from '@asa-lab/electronics/engine';
import { advanceLiveSimulation, calculateSimulationPreflight } from './live-simulation';
import {
  ELECTRONICS_SIMULATION_ENGINE_REVISION,
  ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
  type ElectronicsSimulationWorkerResponse,
  type SimulationAdvanceRequest,
  type SimulationPreflightRequest,
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
  if (!Number.isFinite(request.simulationTimeMs)) {
    return failure(request, 'invalid-request', 'Simulation time must be finite.');
  }

  const startedAt = globalThis.performance.now();
  try {
    // Production preflight starts at zero. Execute the stable non-temporal facade
    // there, while preserving the legacy timed result until E-OPT-3 owns clock semantics.
    const stableSnapshot =
      request.kind === 'preflight' && request.simulationTimeMs === 0
        ? analyseElectronicsSnapshot(request.document)
        : null;
    const result =
      request.kind === 'preflight'
        ? calculateSimulationPreflight(request.document, request.simulationTimeMs)
        : advanceLiveSimulation(request.document, request.previousResult, request.simulationTimeMs);

    if (!result.simulationInputDigest || !result.topologySignature) {
      return failure(request, 'internal', 'Electronics solver omitted required result metadata.');
    }

    if (result.solverRevision !== ELECTRONICS_SIMULATION_ENGINE_REVISION) {
      return failure(
        request,
        'solver-mismatch',
        'Electronics solver returned an unexpected revision.',
      );
    }

    if (
      stableSnapshot &&
      (stableSnapshot.solverRevision !== result.solverRevision ||
        stableSnapshot.modelSetDigest !== result.modelSetDigest ||
        stableSnapshot.topologySignature !== result.topologySignature ||
        stableSnapshot.simulationInputDigest !== result.simulationInputDigest)
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
      result,
      metrics: {
        computeMs: globalThis.performance.now() - startedAt,
        solverRevision: stableSnapshot?.solverRevision ?? result.solverRevision,
        simulationInputDigest:
          stableSnapshot?.simulationInputDigest ?? result.simulationInputDigest,
        topologySignature: stableSnapshot?.topologySignature ?? result.topologySignature,
        status: result.status,
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
