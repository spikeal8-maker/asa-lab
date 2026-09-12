import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SchematicDocument } from '../../api';
import { advanceLiveSimulation, calculateSimulationPreflight } from '../live-simulation';
import {
  ElectronicsSimulationWorkerClient,
  type ElectronicsSimulationWorkerLike,
} from '../simulation-worker-client';
import { evaluateSimulationWorkerRequest } from '../simulation-worker-evaluator';
import {
  ELECTRONICS_SIMULATION_ENGINE_REVISION,
  ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
  type ElectronicsSimulationWorkerRequest,
  type ElectronicsSimulationWorkerResponse,
  type SimulationPreflightRequest,
} from '../simulation-worker-protocol';

const circuit: SchematicDocument = {
  schemaVersion: 4,
  components: [
    { id: 'source', kind: 'source', position: { x: 0, y: 0 }, value: 5 },
    { id: 'resistor', kind: 'resistor', position: { x: 20, y: 0 }, value: 1000 },
  ],
  connections: [
    {
      id: 'positive',
      from: { componentId: 'source', terminal: 'a' },
      to: { componentId: 'resistor', terminal: 'a' },
    },
    {
      id: 'negative',
      from: { componentId: 'resistor', terminal: 'b' },
      to: { componentId: 'source', terminal: 'b' },
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: true, maxIterations: 24 },
};

const arduinoCircuit: SchematicDocument = {
  ...circuit,
  components: [
    {
      id: 'uno',
      kind: 'visual',
      componentTypeId: 'arduino-uno',
      pinIds: ['d13', 'power-5v', 'power-3v3', 'power-gnd-1'],
      position: { x: 0, y: 0 },
      value: 5,
      stateProperties: {
        arduinoSource: `
          int count = 0;
          void setup() { pinMode(13, OUTPUT); }
          void loop() {
            count++;
            digitalWrite(13, count % 2 == 1 ? HIGH : LOW);
            delay(100);
          }
        `,
      },
    },
  ],
  connections: [],
};

function preflightRequest(
  requestId = 'preflight-1',
  generationId = 1,
  projectSessionId = 'project-session-a',
): SimulationPreflightRequest {
  return {
    protocolVersion: ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
    engineRevision: ELECTRONICS_SIMULATION_ENGINE_REVISION,
    requestId,
    generationId,
    projectSessionId,
    kind: 'preflight',
    document: circuit,
    simulationTimeMs: 0,
  };
}
class FakeWorker implements ElectronicsSimulationWorkerLike {
  onmessage: ((event: MessageEvent<ElectronicsSimulationWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly messages: ElectronicsSimulationWorkerRequest[] = [];
  terminated = false;

  postMessage(message: ElectronicsSimulationWorkerRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: ElectronicsSimulationWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<ElectronicsSimulationWorkerResponse>);
  }

  respondTo(index = this.messages.length - 1): void {
    const request = this.messages[index];
    if (!request || request.kind === 'cancel-generation') throw new Error('No evaluation request.');
    this.respond(evaluateSimulationWorkerRequest(request));
  }

  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}
describe('ASA Electronics E-OPT-1 Worker boundary', () => {
  afterEach(() => vi.useRealTimers());

  it('matches the synchronous preflight result exactly', () => {
    const expected = calculateSimulationPreflight(circuit, 0);
    const response = evaluateSimulationWorkerRequest(preflightRequest());

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.result).toEqual(expected);
    expect(structuredClone(response.result)).toEqual(expected);
    expect(response.metrics).toMatchObject({
      solverRevision: ELECTRONICS_SIMULATION_ENGINE_REVISION,
      simulationInputDigest: expected.simulationInputDigest,
      topologySignature: expected.topologySignature,
      status: expected.status,
    });
  });

  it('preserves exact Arduino state across successive advance requests', () => {
    const expectedFirst = advanceLiveSimulation(arduinoCircuit, null, 1);
    const expectedSecond = advanceLiveSimulation(arduinoCircuit, expectedFirst, 100);
    const first = evaluateSimulationWorkerRequest({
      ...preflightRequest('advance-1'),
      kind: 'advance',
      document: arduinoCircuit,
      previousResult: null,
      simulationTimeMs: 1,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.result).toEqual(expectedFirst);

    const second = evaluateSimulationWorkerRequest({
      ...preflightRequest('advance-2'),
      kind: 'advance',
      document: arduinoCircuit,
      previousResult: first.result,
      simulationTimeMs: 100,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.result).toEqual(expectedSecond);
    expect(second.result.controllerState).toEqual(expectedSecond.controllerState);
  });

  it('fails closed on protocol and solver revision mismatches', () => {
    const wrongProtocol = evaluateSimulationWorkerRequest({
      ...preflightRequest(),
      protocolVersion: 999,
    } as unknown as SimulationPreflightRequest);
    const wrongSolver = evaluateSimulationWorkerRequest({
      ...preflightRequest(),
      engineRevision: 'missing-solver',
    } as unknown as SimulationPreflightRequest);

    expect(wrongProtocol).toMatchObject({ ok: false, code: 'protocol-mismatch' });
    expect(wrongSolver).toMatchObject({ ok: false, code: 'solver-mismatch' });
  });
  it('resolves a client request through the Worker message boundary', async () => {
    const worker = new FakeWorker();
    const client = new ElectronicsSimulationWorkerClient(() => worker);
    const generation = client.beginGeneration('project-session-a');
    const pending = client.preflight(generation, circuit);

    worker.respondTo(0);
    await expect(pending).resolves.toEqual(calculateSimulationPreflight(circuit));
    expect(worker.terminated).toBe(false);
    client.dispose();
    expect(worker.terminated).toBe(true);
  });

  it('terminates a superseded generation and rejects its pending request', async () => {
    const workers: FakeWorker[] = [];
    const client = new ElectronicsSimulationWorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const firstGeneration = client.beginGeneration('project-session-a');
    const pending = client.preflight(firstGeneration, circuit);
    const secondGeneration = client.beginGeneration('project-session-b');

    await expect(pending).rejects.toThrow('superseded');
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[0]?.messages.at(-1)).toMatchObject({
      kind: 'cancel-generation',
      generationId: firstGeneration,
    });
    expect(secondGeneration).toBe(firstGeneration + 1);
    client.dispose();
  });
  it('rejects a response from the wrong project session', async () => {
    const worker = new FakeWorker();
    const client = new ElectronicsSimulationWorkerClient(() => worker);
    const generation = client.beginGeneration('project-session-a');
    const pending = client.preflight(generation, circuit);
    const request = worker.messages[0];
    if (!request || request.kind === 'cancel-generation') throw new Error('Missing request.');
    const response = evaluateSimulationWorkerRequest(request);

    worker.respond({ ...response, projectSessionId: 'foreign-session' });
    await expect(pending).rejects.toThrow('Stale Electronics Worker response');
    client.dispose();
  });

  it('bounds silent requests and terminates the failed Worker', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = new ElectronicsSimulationWorkerClient(() => worker, 100);
    const generation = client.beginGeneration('project-session-a');
    const pending = expect(client.preflight(generation, circuit)).rejects.toThrow('timed out');

    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    client.dispose();
  });
  it('contains startup failure and recovers on a new generation', async () => {
    const worker = new FakeWorker();
    const factory = vi
      .fn<() => ElectronicsSimulationWorkerLike>()
      .mockImplementationOnce(() => {
        throw new Error('Worker startup blocked');
      })
      .mockReturnValue(worker);
    const client = new ElectronicsSimulationWorkerClient(factory);

    const failedGeneration = client.beginGeneration('project-session-a');
    await expect(client.preflight(failedGeneration, circuit)).rejects.toThrow('startup blocked');

    const recoveredGeneration = client.beginGeneration('project-session-b');
    const recovered = client.preflight(recoveredGeneration, circuit);
    worker.respondTo(0);
    await expect(recovered).resolves.toMatchObject({ status: 'solved' });
    client.dispose();
  });
  it('returns stale generation errors as rejected promises', async () => {
    const client = new ElectronicsSimulationWorkerClient(() => new FakeWorker());
    const staleGeneration = client.beginGeneration('project-session-a');
    client.beginGeneration('project-session-b');

    const stale = client.preflight(staleGeneration, circuit);
    expect(stale).toBeInstanceOf(Promise);
    await expect(stale).rejects.toThrow('no longer active');
    client.dispose();
  });
});

describe('ASA Electronics Worker module message loop', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('evaluates current messages and drops a cancelled generation', async () => {
    const posted: ElectronicsSimulationWorkerResponse[] = [];
    const scope: {
      onmessage: ((event: MessageEvent<ElectronicsSimulationWorkerRequest>) => void) | null;
      postMessage: (message: ElectronicsSimulationWorkerResponse) => void;
    } = {
      onmessage: null,
      postMessage: (message) => posted.push(message),
    };
    vi.stubGlobal('self', scope);
    await import('../simulation.worker');
    expect(scope.onmessage).toBeTypeOf('function');

    scope.onmessage?.({ data: preflightRequest('runtime-current', 2) } as MessageEvent);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ ok: true, requestId: 'runtime-current' });

    scope.onmessage?.({
      data: {
        ...preflightRequest('cancel-2', 2),
        kind: 'cancel-generation',
      },
    } as unknown as MessageEvent<ElectronicsSimulationWorkerRequest>);
    scope.onmessage?.({ data: preflightRequest('runtime-stale', 2) } as MessageEvent);
    expect(posted).toHaveLength(1);

    scope.onmessage?.({ data: preflightRequest('runtime-next', 3) } as MessageEvent);
    expect(posted).toHaveLength(2);
    expect(posted[1]).toMatchObject({ ok: true, requestId: 'runtime-next', generationId: 3 });
  });
});
