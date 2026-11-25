import { createElectronicsWorkerElectricalTemplateOwner } from '@asa-lab/electronics/engine';
import {
  evaluateDedicatedSimulationWorkerRequest,
  evaluateSimulationWorkerRequest,
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
let activeGeneration = 0;
let activeRequest = 0;
let templateOwner:
  | {
      generation: number;
      projectSessionId: string;
      pending: boolean;
      reuse: ReturnType<typeof createElectronicsWorkerElectricalTemplateOwner>;
    }
  | undefined;

function disposeTemplateOwner() {
  templateOwner?.reuse.dispose();
  templateOwner = undefined;
}

scope.onmessage = (event): void => {
  const request = event.data;
  try {
    if (
      request.protocolVersion !== ELECTRONICS_SIMULATION_WORKER_PROTOCOL ||
      request.engineRevision !== ELECTRONICS_SIMULATION_ENGINE_REVISION
    ) {
      disposeTemplateOwner();
      if (request.kind !== 'cancel-generation')
        scope.postMessage(evaluateSimulationWorkerRequest(request));
      return;
    }
    if (request.kind === 'cancel-generation') {
      disposeTemplateOwner();
      activeGeneration = Math.max(activeGeneration, request.generationId + 1);
      return;
    }
    if (request.generationId < activeGeneration) return;
    activeGeneration = Math.max(activeGeneration, request.generationId);
    const token = ++activeRequest;
    if (request.kind === 'preflight') {
      disposeTemplateOwner();
      scope.postMessage(evaluateSimulationWorkerRequest(request));
      return;
    }
    const canRetainTemplates =
      request.state?.lifecycle === 'running' &&
      (request.inputEvents === undefined ||
        (Array.isArray(request.inputEvents) && request.inputEvents.length === 0));
    if (
      templateOwner?.pending ||
      templateOwner?.generation !== request.generationId ||
      templateOwner?.projectSessionId !== request.projectSessionId ||
      !request.state?.continuation ||
      !canRetainTemplates
    )
      disposeTemplateOwner();
    if (canRetainTemplates) {
      templateOwner ??= {
        generation: request.generationId,
        projectSessionId: request.projectSessionId,
        pending: true,
        reuse: createElectronicsWorkerElectricalTemplateOwner(),
      };
      templateOwner.pending = true;
    }
    const owner = templateOwner;
    void evaluateDedicatedSimulationWorkerRequest(
      request,
      () => request.generationId >= activeGeneration && token === activeRequest,
      owner?.reuse,
    ).then((response) => {
      if (owner && templateOwner === owner) {
        if (
          !response?.ok ||
          response.kind !== 'advance' ||
          response.advance.executionStatus !== 'ready'
        )
          disposeTemplateOwner();
        else owner.pending = false;
      }
      if (response && request.generationId >= activeGeneration && token === activeRequest)
        scope.postMessage(response);
    });
  } catch (error) {
    disposeTemplateOwner();
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
