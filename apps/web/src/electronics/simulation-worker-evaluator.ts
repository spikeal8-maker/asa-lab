import {
  advanceElectronicsToHorizon,
  createElectronicsAdvanceSession,
  openDedicatedElectronicsAdvanceSession,
  prepareDedicatedElectronicsSleepingWake,
  analyseElectronicsSnapshot,
  prepareElectronicsSnapshot,
  projectElectronicsArduinoSerial,
  type createElectronicsWorkerElectricalTemplateOwner,
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
  type SimulationPrepareRequest,
  type SimulationDiscardPreparation,
  type SimulationTimedAdvancePayload,
} from './simulation-worker-protocol';

type EvaluationRequest = SimulationPreflightRequest | SimulationAdvanceRequest;
type ElectricalTemplateOwner = ReturnType<typeof createElectronicsWorkerElectricalTemplateOwner>;
const yieldWorkerTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
  preparedComputeMs?: number,
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
      ...(preparedComputeMs === undefined ? {} : { preparedComputeMs }),
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
export function evaluateSimulationWorkerRequestBatched(
  request: EvaluationRequest,
  isCurrent: () => boolean,
  yieldControl: () => Promise<void> = yieldWorkerTask,
  electricalTemplateOwner?: ElectricalTemplateOwner,
): Promise<ElectronicsSimulationWorkerResponse | null> {
  return evaluateBatches(request, isCurrent, yieldControl, electricalTemplateOwner);
}

interface PreparedWorkerAdvance {
  readonly session: NonNullable<ReturnType<typeof openDedicatedElectronicsAdvanceSession>>;
  readonly computeMs: number;
}

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

/** A one-use prepared session can only evaluate its matching ordinary transport request. */
export function prepareDedicatedSimulationWorkerWake(
  original: SimulationPrepareRequest,
  electricalTemplateOwner: ElectricalTemplateOwner,
) {
  const started = performance.now();
  const expected = structuredClone(original);
  const prefix = prepareDedicatedElectronicsSleepingWake(
    expected.document,
    {
      requestedHorizonMicroseconds: expected.requestedHorizonMicroseconds,
      state: expected.state,
    },
    { observeLedTemporal: true, observeSevenSegmentTemporal: true, electricalTemplateOwner },
  );
  if (!prefix) return null;
  const computeMs = performance.now() - started;
  return {
    dispose: prefix.dispose,
    matchesDiscard: (message: SimulationDiscardPreparation) =>
      message.generationId === expected.generationId &&
      message.projectSessionId === expected.projectSessionId &&
      message.preparedRequestId === expected.requestId,
    evaluate(request: SimulationAdvanceRequest, isCurrent: () => boolean) {
      if (!(
        request.kind === 'advance' &&
        request.protocolVersion === ELECTRONICS_SIMULATION_WORKER_PROTOCOL &&
        request.engineRevision === ELECTRONICS_SIMULATION_ENGINE_REVISION &&
        request.preparedRequestId === expected.requestId &&
        request.generationId === expected.generationId &&
        request.projectSessionId === expected.projectSessionId &&
        (request.inputEvents === undefined ||
          (Array.isArray(request.inputEvents) && request.inputEvents.length === 0)) &&
        sameMessageData(request.document, expected.document) &&
        sameMessageData(request.state, expected.state)
      ))
        return null;
      const session = prefix.claim(request.requestedHorizonMicroseconds);
      return session
        ? evaluateBatches(
            request,
            isCurrent,
            yieldWorkerTask,
            undefined,
            openDedicatedElectronicsAdvanceSession,
            { session, computeMs },
          )
        : null;
    },
  };
}

/** Only the dedicated Worker message loop supplies this entry's cancellation callback. */
export function evaluateDedicatedSimulationWorkerRequest(
  request: EvaluationRequest,
  isCurrent: () => boolean,
  electricalTemplateOwner?: ElectricalTemplateOwner,
): Promise<ElectronicsSimulationWorkerResponse | null> {
  return evaluateBatches(
    request,
    isCurrent,
    yieldWorkerTask,
    electricalTemplateOwner,
    openDedicatedElectronicsAdvanceSession,
  );
}

async function evaluateBatches(
  request: EvaluationRequest,
  isCurrent: () => boolean,
  yieldControl: () => Promise<void>,
  electricalTemplateOwner?: ElectricalTemplateOwner,
  openDedicatedSession?: typeof openDedicatedElectronicsAdvanceSession,
  prepared?: PreparedWorkerAdvance,
): Promise<ElectronicsSimulationWorkerResponse | null> {
  if (
    request.kind !== 'advance' ||
    request.protocolVersion !== ELECTRONICS_SIMULATION_WORKER_PROTOCOL ||
    request.engineRevision !== ELECTRONICS_SIMULATION_ENGINE_REVISION ||
    !Number.isSafeInteger(request.requestedHorizonMicroseconds) ||
    request.requestedHorizonMicroseconds < 0
  )
    return isCurrent() ? evaluateSimulationWorkerRequest(request) : null;
  let session: ReturnType<typeof createElectronicsAdvanceSession> | undefined = prepared?.session;
  try {
    const prepareStarted = globalThis.performance.now();
    const owned = structuredClone(request);
    const advance = {
      requestedHorizonMicroseconds: owned.requestedHorizonMicroseconds,
      state: owned.state,
      ...(owned.inputEvents ? { inputEvents: owned.inputEvents } : {}),
    };
    const observations = {
      observeLedTemporal: true,
      observeSevenSegmentTemporal: true,
      ...(electricalTemplateOwner ? { electricalTemplateOwner } : {}),
    };
    const dedicated =
      prepared?.session ?? openDedicatedSession?.(owned.document, advance, observations);
    session = dedicated ?? createElectronicsAdvanceSession(owned.document, advance, observations);
    let computeMs = (prepared?.computeMs ?? 0) + globalThis.performance.now() - prepareStarted;
    let sliceStarted = globalThis.performance.now();
    let continuedInTurn = false;
    while (isCurrent()) {
      const before = globalThis.performance.now();
      const batch =
        dedicated && continuedInTurn ? dedicated.stepThroughOwnedPauses(sliceStarted + 8) : null;
      const timed = batch ? batch.timed : session.step();
      const now = globalThis.performance.now();
      computeMs += now - before;
      if (!isCurrent()) return null;
      if (timed) return timedResponse(owned, timed, computeMs, prepared?.computeMs);
      if (batch?.sliceExhausted || now - sliceStarted >= 8) {
        await yieldControl();
        sliceStarted = globalThis.performance.now();
        continuedInTurn = false;
      } else continuedInTurn = true;
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
