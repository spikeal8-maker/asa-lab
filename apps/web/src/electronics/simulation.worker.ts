import { evaluateSimulationWorkerRequest } from './simulation-worker-evaluator';
import {
  ELECTRONICS_SIMULATION_ENGINE_REVISION,
  ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
  type ElectronicsSimulationWorkerRequest,
  type ElectronicsSimulationWorkerResponse,
} from './simulation-worker-protocol';

interface ElectronicsSimulationWorkerScope {
  onmessage: ((event: MessageEvent<ElectronicsSimulationWorkerRequest>) => void) | null;
  postMessage(message: ElectronicsSimulationWorkerResponse): void;
}

const scope = self as unknown as ElectronicsSimulationWorkerScope;
let activeGeneration = 0;

scope.onmessage = (event): void => {
  const request = event.data;
  try {
    if (
      request.protocolVersion !== ELECTRONICS_SIMULATION_WORKER_PROTOCOL ||
      request.engineRevision !== ELECTRONICS_SIMULATION_ENGINE_REVISION
    ) {
      if (request.kind !== 'cancel-generation')
        scope.postMessage(evaluateSimulationWorkerRequest(request));
      return;
    }
    if (request.kind === 'cancel-generation') {
      activeGeneration = Math.max(activeGeneration, request.generationId + 1);
      return;
    }
    if (request.generationId < activeGeneration) return;
    activeGeneration = Math.max(activeGeneration, request.generationId);
    const response = evaluateSimulationWorkerRequest(request);
    if (request.generationId < activeGeneration) return;
    scope.postMessage(response);
  } catch (error) {
    if (request.kind === 'cancel-generation') return;
    scope.postMessage({
      protocolVersion: ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
      requestId: request.requestId,
      generationId: request.generationId,
      projectSessionId: request.projectSessionId,
      ok: false,
      code: 'internal',
      message: error instanceof Error ? error.message : 'Electronics Worker message failed.',
    });
  }
};
