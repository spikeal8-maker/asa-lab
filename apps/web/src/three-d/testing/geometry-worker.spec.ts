import { afterEach, describe, expect, it, vi } from 'vitest';
import { createThreeDNode, type ThreeDNode } from '@asa-lab/three-d';
import { GeometryWorkerClient, type GeometryWorkerLike } from '../geometry/worker-client';
import { evaluateGeometryRequest } from '../geometry/worker-evaluator';
import {
  THREE_D_GEOMETRY_WORKER_PROTOCOL,
  THREE_D_LEGACY_BSP_ENGINE,
  type GeometryEvaluateRequest,
  type GeometryWorkerRequest,
  type GeometryWorkerResponse,
} from '../geometry/worker-protocol';

function operands(): readonly ThreeDNode[] {
  const first = createThreeDNode('box', 'box-a');
  const second = createThreeDNode('box', 'box-b');
  return [
    { ...first, groupId: 'group-a', groupOperation: 'union' },
    {
      ...second,
      groupId: 'group-a',
      groupOperation: 'union',
      transform: {
        ...second.transform,
        position: { ...second.transform.position, x: 10 },
      },
    },
  ];
}

function request(requestId = 'request-a', generationId = 1): GeometryEvaluateRequest {
  return {
    protocolVersion: THREE_D_GEOMETRY_WORKER_PROTOCOL,
    requestId,
    generationId,
    kind: 'evaluate-boolean',
    engine: THREE_D_LEGACY_BSP_ENGINE,
    operation: 'union',
    operands: operands(),
  };
}

function successfulResponse(requestId: string, generationId: number): GeometryWorkerResponse {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  return {
    protocolVersion: THREE_D_GEOMETRY_WORKER_PROTOCOL,
    requestId,
    generationId,
    ok: true,
    resultKind: 'mesh',
    positions: positions.buffer,
    normals: normals.buffer,
    featureEdges: new Float32Array().buffer,
    metrics: {
      engine: THREE_D_LEGACY_BSP_ENGINE,
      computeMs: 1,
      triangleCount: 1,
      featureEdgeSegmentCount: 0,
      checksum: 'fixture',
      bounds: { min: [0, 0, 0], max: [1, 1, 0] },
    },
  };
}

class FakeWorker implements GeometryWorkerLike {
  onmessage: ((event: MessageEvent<GeometryWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly messages: GeometryWorkerRequest[] = [];
  terminated = false;

  postMessage(message: GeometryWorkerRequest): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: GeometryWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<GeometryWorkerResponse>);
  }

  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

describe('ASA 3D OPT-1 Geometry Worker boundary', () => {
  afterEach(() => vi.useRealTimers());

  it('returns a successful empty intersection for disjoint solids', () => {
    const [first, second] = operands();
    const response = evaluateGeometryRequest({
      ...request(),
      operation: 'intersection',
      operands: [
        first!,
        { ...second!, transform: { ...second!.transform, position: { x: 100, y: 10, z: 0 } } },
      ],
    });

    expect(response).toMatchObject({
      ok: true,
      resultKind: 'empty',
      metrics: { triangleCount: 0, featureEdgeSegmentCount: 0, bounds: null },
    });
  });

  it('returns a successful empty difference when the hole removes the entire solid', () => {
    const solid = createThreeDNode('box', 'solid');
    const response = evaluateGeometryRequest({
      ...request(),
      operation: 'difference',
      operands: [solid, { ...solid, id: 'hole', operation: 'hole' }],
    });

    expect(response).toMatchObject({ ok: true, resultKind: 'empty', metrics: { bounds: null } });
  });

  it('returns empty when every operand is hidden', () => {
    const response = evaluateGeometryRequest({
      ...request(),
      operands: operands().map((node) => ({ ...node, visible: false })),
    });
    expect(response).toMatchObject({ ok: true, resultKind: 'empty', metrics: { bounds: null } });
  });

  it('bounds a silent Worker request and clears all deadlines on failure', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = new GeometryWorkerClient(() => worker, 100);
    const generation = client.beginGeneration();
    const first = expect(client.evaluate(generation, operands(), 'union')).rejects.toThrow(
      'timed out',
    );
    const second = expect(client.evaluate(generation, operands(), 'union')).rejects.toThrow(
      'timed out',
    );

    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([first, second]);
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    await expect(client.evaluate(generation, operands(), 'union')).rejects.toThrow('timed out');
    client.dispose();
  });

  it('clears a completed request deadline before starting the next one', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const client = new GeometryWorkerClient(() => worker, 100);
    const generation = client.beginGeneration();
    const first = client.evaluate(generation, operands(), 'union');
    worker.respond(successfulResponse(worker.messages[0]!.requestId, generation));
    await first;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(100);

    const second = client.evaluate(generation, operands(), 'union');
    worker.respond(successfulResponse(worker.messages[1]!.requestId, generation));
    await expect(second).resolves.toMatchObject({ resultKind: 'mesh' });
    expect(worker.terminated).toBe(false);
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('contains synchronous Worker startup and postMessage failures', async () => {
    const worker = new FakeWorker();
    const factory = vi
      .fn<() => GeometryWorkerLike>()
      .mockImplementationOnce(() => {
        throw new Error('Worker startup blocked');
      })
      .mockReturnValue(worker);
    const client = new GeometryWorkerClient(factory);
    const failedGeneration = client.beginGeneration();
    await expect(client.evaluate(failedGeneration, operands(), 'union')).rejects.toThrow(
      'startup blocked',
    );

    const nextGeneration = client.beginGeneration();
    vi.spyOn(worker, 'postMessage').mockImplementation(() => {
      throw new Error('Cannot clone request');
    });
    await expect(client.evaluate(nextGeneration, operands(), 'union')).rejects.toThrow(
      'Cannot clone',
    );
    expect(worker.terminated).toBe(true);
    expect(() => client.dispose()).not.toThrow();
  });

  it('terminates a Worker whose response cannot be decoded', async () => {
    const worker = new FakeWorker();
    const client = new GeometryWorkerClient(() => worker);
    const generation = client.beginGeneration();
    const pending = client.evaluate(generation, operands(), 'union');
    worker.onmessageerror?.({} as MessageEvent);
    await expect(pending).rejects.toThrow('could not be decoded');
    expect(worker.terminated).toBe(true);
    client.dispose();
  });

  it('fails later requests promptly after a fatal Worker error, then recovers on a new generation', async () => {
    const workers: FakeWorker[] = [];
    const client = new GeometryWorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    try {
      const generationId = client.beginGeneration();
      const first = client.evaluate(generationId, operands(), 'union');
      workers[0]!.fail('Worker initialization failed');
      await expect(first).rejects.toThrow('Worker initialization failed');
      expect(workers[0]!.terminated).toBe(true);
      await expect(client.evaluate(generationId, operands(), 'union')).rejects.toThrow(
        'Worker initialization failed',
      );

      const recoveredGeneration = client.beginGeneration();
      const recovered = client.evaluate(recoveredGeneration, operands(), 'union');
      const message = workers[1]!.messages[0]!;
      workers[1]!.respond(successfulResponse(message.requestId, recoveredGeneration));
      await expect(recovered).resolves.toMatchObject({ metrics: { checksum: 'fixture' } });
    } finally {
      client.dispose();
    }
  });

  it('evaluates the legacy BSP deterministically into transferable buffers', () => {
    const first = evaluateGeometryRequest(request('first'));
    const second = evaluateGeometryRequest(request('second'));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.metrics.engine).toEqual(THREE_D_LEGACY_BSP_ENGINE);
    expect(first.metrics.triangleCount).toBeGreaterThan(0);
    expect(first.metrics.checksum).toBe(second.metrics.checksum);
    expect([...new Float32Array(first.positions)]).toEqual([...new Float32Array(second.positions)]);
    expect([...new Float32Array(first.normals)]).toEqual([...new Float32Array(second.normals)]);
  });

  it('returns a typed failure for an unknown engine version', () => {
    const response = evaluateGeometryRequest({
      ...request(),
      engine: { id: 'legacy-bsp', version: 'missing' },
    });

    expect(response).toMatchObject({ ok: false, code: 'unsupported-engine' });
  });

  it('terminates the previous generation and rejects its pending result', async () => {
    const workers: FakeWorker[] = [];
    const client = new GeometryWorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const firstGeneration = client.beginGeneration();
    const pending = client.evaluate(firstGeneration, operands(), 'union');
    const secondGeneration = client.beginGeneration();

    await expect(pending).rejects.toThrow('superseded');
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[0]?.messages.at(-1)).toMatchObject({
      kind: 'cancel-generation',
      generationId: firstGeneration,
    });
    expect(secondGeneration).toBe(firstGeneration + 1);
    client.dispose();
  });

  it('does not create a replacement Worker when Boolean groups disappear', async () => {
    const workers: FakeWorker[] = [];
    const client = new GeometryWorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const generationId = client.beginGeneration();
    const pending = client.evaluate(generationId, operands(), 'union');

    client.cancelActiveGeneration();

    await expect(pending).rejects.toThrow('no Boolean groups remain');
    expect(workers).toHaveLength(1);
    expect(workers[0]?.terminated).toBe(true);
    client.dispose();
  });

  it('isolates the active request from errors emitted by a superseded Worker', async () => {
    const workers: FakeWorker[] = [];
    const client = new GeometryWorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    client.beginGeneration();
    const staleWorker = workers[0]!;
    const lateError = staleWorker.onerror!;
    const activeGeneration = client.beginGeneration();
    const activeWorker = workers[1]!;
    const pending = client.evaluate(activeGeneration, operands(), 'union');
    const evaluateMessage = activeWorker.messages.find(
      (message): message is GeometryEvaluateRequest => message.kind === 'evaluate-boolean',
    );

    lateError({ message: 'late failure from terminated Worker' } as ErrorEvent);
    activeWorker.respond(successfulResponse(evaluateMessage!.requestId, activeGeneration));

    await expect(pending).resolves.toMatchObject({ metrics: { checksum: 'fixture' } });
    client.dispose();
  });

  it('discards a response whose generation does not match the pending request', async () => {
    const worker = new FakeWorker();
    const client = new GeometryWorkerClient(() => worker);
    const generationId = client.beginGeneration();
    const pending = client.evaluate(generationId, operands(), 'union');
    const evaluateMessage = worker.messages.find(
      (message): message is GeometryEvaluateRequest => message.kind === 'evaluate-boolean',
    );
    expect(evaluateMessage).toBeDefined();
    worker.respond(successfulResponse(evaluateMessage!.requestId, generationId + 1));

    await expect(pending).rejects.toThrow('Stale');
    client.dispose();
  });

  it('reconstructs typed arrays only for the active generation', async () => {
    const worker = new FakeWorker();
    const client = new GeometryWorkerClient(() => worker);
    const generationId = client.beginGeneration();
    const pending = client.evaluate(generationId, operands(), 'union');
    const evaluateMessage = worker.messages.find(
      (message): message is GeometryEvaluateRequest => message.kind === 'evaluate-boolean',
    );
    worker.respond(successfulResponse(evaluateMessage!.requestId, generationId));

    await expect(pending).resolves.toMatchObject({
      positions: expect.any(Float32Array),
      normals: expect.any(Float32Array),
      metrics: { checksum: 'fixture' },
    });
    client.dispose();
  });
});
