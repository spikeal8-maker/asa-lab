import { evaluateGeometryRequest } from './worker-evaluator';
import {
  THREE_D_GEOMETRY_WORKER_PROTOCOL,
  type GeometryWorkerRequest,
  type GeometryWorkerResponse,
} from './worker-protocol';

interface GeometryWorkerScope {
  onmessage: ((event: MessageEvent<GeometryWorkerRequest>) => void) | null;
  postMessage(message: GeometryWorkerResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as GeometryWorkerScope;
let activeGeneration = 0;

scope.onmessage = (event): void => {
  const request = event.data;
  try {
    if (request.kind === 'cancel-generation') {
      activeGeneration = Math.max(activeGeneration, request.generationId + 1);
      return;
    }
    if (request.protocolVersion !== THREE_D_GEOMETRY_WORKER_PROTOCOL) return;
    activeGeneration = Math.max(activeGeneration, request.generationId);
    if (request.generationId < activeGeneration) return;

    const response = evaluateGeometryRequest(request);
    if (request.generationId < activeGeneration) return;
    const transfer = response.ok
      ? [response.positions, response.normals, response.featureEdges]
      : [];
    scope.postMessage(response, transfer);
  } catch (error) {
    if (request.kind !== 'evaluate-boolean') return;
    scope.postMessage(
      {
        protocolVersion: THREE_D_GEOMETRY_WORKER_PROTOCOL,
        requestId: request.requestId,
        generationId: request.generationId,
        ok: false,
        code: 'internal',
        message: error instanceof Error ? error.message : 'Geometry Worker message failed.',
      },
      [],
    );
  }
};
