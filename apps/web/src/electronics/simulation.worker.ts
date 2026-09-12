import { evaluateSimulationWorkerRequest } from './simulation-worker-evaluator';
import {
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
    if (request.kind === 'cancel-generation') {
      if (request.protocolVersion !== ELECTRONICS_SIMULATION_WORKER_PROTOCOL) return;
      activeGeneration = Math.max(activeGeneration, request.generationId + 1);
      return;
    }

    activeGeneration = Math.max(activeGeneration, request.generationId);
    if (request.generationId < activeGeneration) return;
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
