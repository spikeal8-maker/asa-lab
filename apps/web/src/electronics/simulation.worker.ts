import {
  evaluateSimulationWorkerRequest,
  evaluateSimulationWorkerRequestBatched,
} from './simulation-worker-evaluator';
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
// Diagnostic only: read the opt-in once; the normal path never reads a clock.
export function createWorkerPhaseProbe(locationHref: string, timeline: Performance) {
  let instance = '';
  try {
    const url = new URL(locationHref);
    if (url.searchParams.get('asa682phase') === 'v1')
      instance = url.searchParams.get('asa682instance') ?? '';
  } catch {
    /* Invalid opt-in is disabled. */
  }
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(instance)) return null;
  return (
    phase: string,
    request: ElectronicsSimulationWorkerRequest | ElectronicsSimulationWorkerResponse,
  ) => {
    try {
      const { projectSessionId: session, generationId: generation, requestId: id } = request;
      if (
        typeof session !== 'string' ||
        session.length > 160 ||
        typeof id !== 'string' ||
        id.length > 160 ||
        !Number.isSafeInteger(generation)
      )
        return;
      const epoch = timeline.timeOrigin + timeline.now();
      const name =
        'asa682:v1:' +
        encodeURIComponent(JSON.stringify({ phase, instance, session, generation, id, epoch }));
      try {
        timeline.mark(name);
      } finally {
        timeline.clearMarks(name);
      }
    } catch {
      /* Instrumentation cannot change transport or evaluator behavior. */
    }
  };
}
const phaseProbe = createWorkerPhaseProbe(self.location?.href ?? '', performance);
const send = (response: ElectronicsSimulationWorkerResponse): void => {
  if (!phaseProbe) {
    scope.postMessage(response);
    return;
  }
  phaseProbe('response-ready', response);
  phaseProbe('send-call', response);
  scope.postMessage(response);
  phaseProbe('send-return', response);
};
let activeGeneration = 0;
let activeRequest = 0;

scope.onmessage = (event): void => {
  const request = event.data;
  try {
    if (phaseProbe && request.kind !== 'cancel-generation') phaseProbe('request-received', request);
    if (
      request.protocolVersion !== ELECTRONICS_SIMULATION_WORKER_PROTOCOL ||
      request.engineRevision !== ELECTRONICS_SIMULATION_ENGINE_REVISION
    ) {
      if (request.kind !== 'cancel-generation') send(evaluateSimulationWorkerRequest(request));
      return;
    }
    if (request.kind === 'cancel-generation') {
      activeGeneration = Math.max(activeGeneration, request.generationId + 1);
      return;
    }
    if (request.generationId < activeGeneration) return;
    activeGeneration = Math.max(activeGeneration, request.generationId);
    const token = ++activeRequest;
    if (request.kind === 'preflight') {
      send(evaluateSimulationWorkerRequest(request));
      return;
    }
    void evaluateSimulationWorkerRequestBatched(
      request,
      () => request.generationId >= activeGeneration && token === activeRequest,
    ).then((response) => {
      if (response && request.generationId >= activeGeneration && token === activeRequest)
        send(response);
    });
  } catch (error) {
    if (request.kind === 'cancel-generation') return;
    send({
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
