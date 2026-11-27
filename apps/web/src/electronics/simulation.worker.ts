import { createElectronicsWorkerElectricalTemplateOwner } from '@asa-lab/electronics/engine';
import {
  evaluateDedicatedSimulationWorkerRequest,
  prepareDedicatedSimulationWorkerWake,
  evaluateSimulationWorkerRequest,
} from './simulation-worker-evaluator';
import {
  ELECTRONICS_SIMULATION_ENGINE_REVISION,
  ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
  type ElectronicsSimulationWorkerMessage,
  type ElectronicsSimulationWorkerResponse,
} from './simulation-worker-protocol';

interface ElectronicsSimulationWorkerScope {
  onmessage: ((event: MessageEvent<ElectronicsSimulationWorkerMessage>) => void) | null;
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

let preparedWake: ReturnType<typeof prepareDedicatedSimulationWorkerWake> | undefined;

function releasePreparedWake() {
  preparedWake?.dispose();
  preparedWake = undefined;
}

scope.onmessage = (event): void => {
  const request = event.data;
  try {
    if (request.kind === 'discard-preparation') {
      if (preparedWake?.matchesDiscard(request)) releasePreparedWake();
      return;
    }
    if (request.kind === 'prepare-advance') {
      if (
        request.protocolVersion !== ELECTRONICS_SIMULATION_WORKER_PROTOCOL ||
        request.engineRevision !== ELECTRONICS_SIMULATION_ENGINE_REVISION ||
        request.generationId !== activeGeneration ||
        !templateOwner ||
        templateOwner.pending ||
        templateOwner.generation !== request.generationId ||
        templateOwner.projectSessionId !== request.projectSessionId
      )
        return;
      releasePreparedWake();
      preparedWake =
        prepareDedicatedSimulationWorkerWake(request, templateOwner.reuse) ?? undefined;
      return;
    }
    if (
      request.protocolVersion !== ELECTRONICS_SIMULATION_WORKER_PROTOCOL ||
      request.engineRevision !== ELECTRONICS_SIMULATION_ENGINE_REVISION
    ) {
      releasePreparedWake();
      disposeTemplateOwner();
      if (request.kind !== 'cancel-generation')
        scope.postMessage(evaluateSimulationWorkerRequest(request));
      return;
    }
    if (request.kind === 'cancel-generation') {
      releasePreparedWake();
      disposeTemplateOwner();
      activeGeneration = Math.max(activeGeneration, request.generationId + 1);
      return;
    }
    if (request.generationId < activeGeneration) return;
    activeGeneration = Math.max(activeGeneration, request.generationId);
    const token = ++activeRequest;
    if (request.kind === 'preflight') {
      releasePreparedWake();
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
    const isCurrent = () => request.generationId >= activeGeneration && token === activeRequest;
    const wake = preparedWake;
    preparedWake = undefined;
    const resumed = wake?.evaluate(request, isCurrent);
    if (!resumed) wake?.dispose();
    const evaluated =
      resumed ?? evaluateDedicatedSimulationWorkerRequest(request, isCurrent, owner?.reuse);
    void evaluated.then((response) => {
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
    releasePreparedWake();
    if (request.kind === 'prepare-advance' || request.kind === 'discard-preparation') return;
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
