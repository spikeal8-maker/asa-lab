import { createElectronicsWorkerElectricalTemplateOwner } from '@asa-lab/electronics/engine';
import {
  evaluateDedicatedSimulationWorkerRequest,
  evaluateSimulationWorkerRequest,
} from './simulation-worker-evaluator';
import {
  ELECTRONICS_SIMULATION_ENGINE_REVISION,
  ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
  type SimulationPrepareRequest,
  type SimulationAdvanceRequest,
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

type PreparedWake = {
  readonly request: SimulationPrepareRequest;
  result: Promise<ElectronicsSimulationWorkerResponse | null>;
};
let preparedWake: PreparedWake | undefined;
let evaluating = false;

/** Accept only byte-equivalent plain transport data. Unknown object shapes take the ordinary path. */
function sameMessageData(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const stack: [object, object][] = [[left, right]];
  const leftVisited = new WeakSet<object>();
  const rightVisited = new WeakSet<object>();
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (leftVisited.has(a) || rightVisited.has(b)) return false;
    leftVisited.add(a);
    rightVisited.add(b);
    const prototype = Object.getPrototypeOf(a);
    if (
      (prototype !== Object.prototype && prototype !== Array.prototype) ||
      Object.getPrototypeOf(b) !== prototype
    )
      return false;
    if (Array.isArray(a) && (!Array.isArray(b) || a.length !== b.length)) return false;
    const keys = Object.keys(a),
      otherKeys = Object.keys(b);
    if (keys.length !== otherKeys.length) return false;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      if (key !== otherKeys[i]) return false;
      const x = (a as Record<string, unknown>)[key],
        y = (b as Record<string, unknown>)[key];
      if (Object.is(x, y)) continue;
      if (!x || !y || typeof x !== 'object' || typeof y !== 'object') return false;
      stack.push([x, y]);
    }
  }
  return true;
}

function prepareWake(request: SimulationPrepareRequest): void {
  const continuation = request.state?.continuation;
  if (
    request.state.lifecycle !== 'running' ||
    !continuation ||
    continuation.clockProfileId !== 'electrothermal-events-v2' ||
    !Number.isSafeInteger(request.requestedHorizonMicroseconds) ||
    request.requestedHorizonMicroseconds <= continuation.committedHorizonMicroseconds ||
    request.requestedHorizonMicroseconds - continuation.committedHorizonMicroseconds > 25_000
  )
    return;
  const entry: PreparedWake = { request, result: Promise.resolve(null) };
  preparedWake = entry;
  const owns = () => preparedWake === entry;
  const owner = createElectronicsWorkerElectricalTemplateOwner();
  entry.result = evaluateDedicatedSimulationWorkerRequest(
    { ...request, kind: 'advance', inputEvents: [] },
    owns,
    owner,
  ).finally(() => owner.dispose());
}

function matchesWake(entry: PreparedWake, request: SimulationAdvanceRequest): boolean {
  if (
    request.preparedRequestId !== entry.request.requestId ||
    request.projectSessionId !== entry.request.projectSessionId ||
    request.generationId !== entry.request.generationId ||
    request.requestedHorizonMicroseconds !== entry.request.requestedHorizonMicroseconds ||
    (request.inputEvents !== undefined &&
      (!Array.isArray(request.inputEvents) || request.inputEvents.length > 0)) ||
    !sameMessageData(entry.request.document, request.document) ||
    !sameMessageData(entry.request.state, request.state)
  )
    return false;
  return true;
}

scope.onmessage = async (event): Promise<void> => {
  const request = event.data;
  const previousWake = preparedWake;
  try {
    if (request.kind === 'discard-preparation') {
      if (
        previousWake &&
        !evaluating &&
        previousWake.request.requestId === request.preparedRequestId &&
        previousWake.request.generationId === request.generationId &&
        previousWake.request.projectSessionId === request.projectSessionId
      )
        preparedWake = undefined;
      return;
    }
    if (request.kind === 'prepare-advance') {
      if (evaluating) return;
      preparedWake = undefined;
      if (
        request.protocolVersion === ELECTRONICS_SIMULATION_WORKER_PROTOCOL &&
        request.engineRevision === ELECTRONICS_SIMULATION_ENGINE_REVISION &&
        request.generationId === activeGeneration &&
        !templateOwner?.pending
      )
        prepareWake(request);
      return;
    }
    if (
      request.protocolVersion !== ELECTRONICS_SIMULATION_WORKER_PROTOCOL ||
      request.engineRevision !== ELECTRONICS_SIMULATION_ENGINE_REVISION
    ) {
      preparedWake = undefined;
      disposeTemplateOwner();
      if (request.kind !== 'cancel-generation')
        scope.postMessage(evaluateSimulationWorkerRequest(request));
      return;
    }
    if (request.kind === 'cancel-generation') {
      preparedWake = undefined;
      disposeTemplateOwner();
      activeGeneration = Math.max(activeGeneration, request.generationId + 1);
      return;
    }
    if (request.generationId < activeGeneration) return;
    activeGeneration = Math.max(activeGeneration, request.generationId);
    const token = ++activeRequest;
    if (request.kind === 'preflight') {
      preparedWake = undefined;
      evaluating = false;
      disposeTemplateOwner();
      scope.postMessage(evaluateSimulationWorkerRequest(request));
      return;
    }
    evaluating = true;
    if (previousWake && matchesWake(previousWake, request)) {
      const ready = await previousWake.result;
      if (token !== activeRequest || request.generationId < activeGeneration) return;
      if (
        ready?.ok &&
        ready.kind === 'advance' &&
        ready.advance.executionStatus === 'ready' &&
        ready.advance.committedHorizonMicroseconds === request.requestedHorizonMicroseconds
      ) {
        preparedWake = undefined;
        evaluating = false;
        scope.postMessage({
          ...ready,
          requestId: request.requestId,
          metrics: { ...ready.metrics, preparedComputeMs: ready.metrics.computeMs },
        });
        return;
      }
    }
    preparedWake = undefined;
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
      if (request.generationId >= activeGeneration && token === activeRequest) {
        evaluating = false;
        if (response) scope.postMessage(response);
      }
    });
  } catch (error) {
    if (
      request.kind === 'cancel-generation' ||
      request.kind === 'prepare-advance' ||
      request.kind === 'discard-preparation'
    )
      return;
    evaluating = false;
    disposeTemplateOwner();
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
