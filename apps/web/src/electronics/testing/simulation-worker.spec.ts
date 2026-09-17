import {
  advanceElectronicsToHorizon,
  analyseElectronicsSnapshot,
  resetElectronicsTimedState,
} from '@asa-lab/electronics/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SchematicDocument } from '../../api';
import { calculateSimulationPreflight } from '../live-simulation';
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

const resistanceCircuit: SchematicDocument = {
  schemaVersion: 4,
  components: [
    {
      id: 'load',
      kind: 'resistor',
      componentTypeId: 'resistor-axial',
      variantId: 'resistor-axial',
      name: 'R1',
      position: { x: 0, y: 0 },
      rotation: 0,
      value: 1_000,
      pinIds: ['lead-1', 'lead-2'],
      stateProperties: { powerRatingWatt: 0.25 },
    },
    {
      id: 'meter',
      kind: 'visual',
      componentTypeId: 'multimeter',
      variantId: 'multimeter',
      name: 'Meter',
      position: { x: 20, y: 0 },
      rotation: 0,
      value: 0,
      pinIds: ['com', 'v-ohm-ma'],
      stateProperties: { measurementMode: 'resistance', meterRange: 'auto' },
    },
  ],
  connections: [
    {
      id: 'red',
      from: { componentId: 'meter', terminal: 'v-ohm-ma' },
      to: { componentId: 'load', terminal: 'lead-1' },
    },
    {
      id: 'black',
      from: { componentId: 'meter', terminal: 'com' },
      to: { componentId: 'load', terminal: 'lead-2' },
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
            if (count % 2 == 1) { digitalWrite(13, HIGH); } else { digitalWrite(13, LOW); }
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

describe('ASA Electronics E-OPT-3D Worker boundary', () => {
  afterEach(() => vi.useRealTimers());

  it('preserves non-temporal preflight identity at time zero', () => {
    const stable = analyseElectronicsSnapshot(circuit);
    const expected = calculateSimulationPreflight(circuit, 0);
    const response = evaluateSimulationWorkerRequest(preflightRequest());

    expect(response.ok).toBe(true);
    if (!response.ok || response.kind !== 'preflight') return;
    expect(response.result).toEqual(expected);
    expect(response.metrics).toMatchObject({
      solverRevision: stable.solverRevision,
      simulationInputDigest: stable.simulationInputDigest,
      topologySignature: stable.topologySignature,
      executionStatus: 'preflight',
    });
  });
  it('matches direct canonical timed advance across the Worker boundary', () => {
    const state = resetElectronicsTimedState();
    const direct = advanceElectronicsToHorizon(circuit, {
      requestedHorizonMicroseconds: 100_000,
      state,
    });
    const response = evaluateSimulationWorkerRequest({
      ...preflightRequest('advance-1'),
      kind: 'advance',
      document: circuit,
      state,
      requestedHorizonMicroseconds: 100_000,
    });

    expect(response.ok).toBe(true);
    if (!response.ok || response.kind !== 'advance') return;
    expect(response.advance.executionStatus).toBe(direct.executionStatus);
    expect(response.advance.requestedHorizonMicroseconds).toBe(100_000);
    expect(response.advance.committedHorizonMicroseconds).toBe(direct.committedHorizonMicroseconds);
    expect(response.advance.state).toEqual(direct.state);
    expect(response.advance.result?.current).toBe(direct.observation?.current);
    expect(response.advance.result?.components).toEqual(direct.observation?.components);
    expect(response.metrics.executionStatus).toBe(direct.executionStatus);
  });
  it('returns passive no-source diagnostics as a ready Worker observation', () => {
    const document = {
      ...resistanceCircuit,
      components: resistanceCircuit.components.map((component) =>
        component.id === 'meter'
          ? {
              ...component,
              stateProperties: { ...component.stateProperties, measurementMode: 'dc-voltage' },
            }
          : component,
      ),
    };
    const response = evaluateSimulationWorkerRequest({
      ...preflightRequest('meter-passive'),
      kind: 'advance',
      document,
      state: resetElectronicsTimedState(),
      requestedHorizonMicroseconds: 0,
    });
    expect(response.ok).toBe(true);
    if (!response.ok || response.kind !== 'advance') return;
    expect(response.advance.executionStatus).toBe('ready');
    expect(response.advance.result?.solved).toBe(false);
    expect(response.advance.result?.diagnostics.map((entry) => entry.code)).toContain('no_source');
  });

  it('keeps unpowered resistance measurement valid across the Worker boundary', () => {
    const state = resetElectronicsTimedState();
    const response = evaluateSimulationWorkerRequest({
      ...preflightRequest('meter-resistance'),
      kind: 'advance',
      document: resistanceCircuit,
      state,
      requestedHorizonMicroseconds: 0,
    });
    expect(response.ok).toBe(true);
    if (!response.ok || response.kind !== 'advance') return;
    expect(response.advance.executionStatus, JSON.stringify(response.advance.diagnostics)).toBe(
      'ready',
    );
    const meter = response.advance.result?.components.find(
      (entry) => entry.componentId === 'meter',
    );
    expect(meter).toMatchObject({
      measurementMode: 'resistance',
      meterOpenCircuit: false,
      meterExternalPowerPresent: false,
    });
    expect(meter?.measuredValue).toBeCloseTo(1_000, 3);
  });

  it('carries canonical Arduino continuation across successive Worker advances', () => {
    const initial = resetElectronicsTimedState();
    const first = evaluateSimulationWorkerRequest({
      ...preflightRequest('arduino-1'),
      kind: 'advance',
      document: arduinoCircuit,
      state: initial,
      requestedHorizonMicroseconds: 1_000,
    });
    expect(first.ok).toBe(true);
    if (!first.ok || first.kind !== 'advance') return;
    expect(first.advance.executionStatus).toBe('ready');

    const second = evaluateSimulationWorkerRequest({
      ...preflightRequest('arduino-2'),
      kind: 'advance',
      document: arduinoCircuit,
      state: first.advance.state,
      requestedHorizonMicroseconds: 100_000,
    });
    const directSecond = advanceElectronicsToHorizon(arduinoCircuit, {
      state: first.advance.state,
      requestedHorizonMicroseconds: 100_000,
    });
    expect(second.ok).toBe(true);
    if (!second.ok || second.kind !== 'advance') return;
    expect(second.advance.state).toEqual(directSecond.state);
    expect(second.advance.committedHorizonMicroseconds).toBe(100_000);
  });
  it('rejects invalid protocol, solver and non-integer horizons', () => {
    const wrongProtocol = evaluateSimulationWorkerRequest({
      ...preflightRequest(),
      protocolVersion: 999,
    } as unknown as SimulationPreflightRequest);
    const wrongSolver = evaluateSimulationWorkerRequest({
      ...preflightRequest(),
      engineRevision: 'missing-solver',
    } as unknown as SimulationPreflightRequest);
    const invalidHorizon = evaluateSimulationWorkerRequest({
      ...preflightRequest('invalid-horizon'),
      kind: 'advance',
      document: circuit,
      state: resetElectronicsTimedState(),
      requestedHorizonMicroseconds: 1.5,
    });

    expect(wrongProtocol).toMatchObject({ ok: false, code: 'protocol-mismatch' });
    expect(wrongSolver).toMatchObject({ ok: false, code: 'solver-mismatch' });
    expect(invalidHorizon).toMatchObject({ ok: false, code: 'invalid-request' });
  });

  it('sends canonical state and integer horizon through the client boundary', async () => {
    const worker = new FakeWorker();
    const client = new ElectronicsSimulationWorkerClient(() => worker);
    const generation = client.beginGeneration('project-session-a');
    const state = resetElectronicsTimedState();
    const pending = client.advance(generation, circuit, state, 25_000);
    const request = worker.messages[0];
    expect(request).toMatchObject({
      kind: 'advance',
      requestedHorizonMicroseconds: 25_000,
      state,
    });
    expect(request && 'simulationTimeMs' in request).toBe(false);
    expect(request && 'previousResult' in request).toBe(false);

    worker.respondTo(0);
    const advance = await pending;
    expect(advance).toMatchObject({
      executionStatus: 'ready',
      requestedHorizonMicroseconds: 25_000,
      committedHorizonMicroseconds: 25_000,
    });
    client.dispose();
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
    expect(secondGeneration).toBeGreaterThan(firstGeneration);
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

  it('does not let a mismatched protocol poison the active generation', async () => {
    const posted: ElectronicsSimulationWorkerResponse[] = [];
    const scope = {
      onmessage: null as ((event: MessageEvent<ElectronicsSimulationWorkerRequest>) => void) | null,
      postMessage: (message: ElectronicsSimulationWorkerResponse) => posted.push(message),
    };
    vi.stubGlobal('self', scope);
    await import('../simulation.worker');

    const invalid = {
      ...preflightRequest('invalid-protocol', 99),
      protocolVersion: 999,
    } as unknown as ElectronicsSimulationWorkerRequest;
    scope.onmessage?.({ data: invalid } as MessageEvent<ElectronicsSimulationWorkerRequest>);
    expect(posted[0]).toMatchObject({ ok: false, code: 'protocol-mismatch' });

    scope.onmessage?.({ data: preflightRequest('still-current', 2) } as MessageEvent);
    expect(posted[1]).toMatchObject({
      ok: true,
      kind: 'preflight',
      requestId: 'still-current',
      generationId: 2,
    });
  });

  it('drops a cancelled generation and accepts the next one', async () => {
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

    scope.onmessage?.({ data: preflightRequest('runtime-current', 2) } as MessageEvent);
    expect(posted).toHaveLength(1);

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
    expect(posted[1]).toMatchObject({
      ok: true,
      kind: 'preflight',
      requestId: 'runtime-next',
      generationId: 3,
    });
  });
});
