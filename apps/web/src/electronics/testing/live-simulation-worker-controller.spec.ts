import { describe, expect, it, vi } from 'vitest';
import type { SchematicDocument, SolveResult } from '../../api';
import {
  ElectronicsLiveSimulationWorkerController,
  type ElectronicsSimulationWorkerExecutor,
} from '../live-simulation-worker-controller';

const circuit: SchematicDocument = {
  schemaVersion: 4,
  components: [
    { id: 'source', kind: 'source', position: { x: 0, y: 0 }, value: 5 },
    { id: 'resistor', kind: 'resistor', position: { x: 20, y: 0 }, value: 1000 },
  ],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: true, maxIterations: 24 },
};

function result(current: number): SolveResult {
  return {
    solved: true,
    status: 'solved',
    current,
    components: [],
    nodes: [],
    diagnostics: [],
    iterations: 1,
    numericalResidual: 0,
    numericalTolerance: 1e-9,
  };
}
interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

interface AdvanceCall {
  readonly generationId: number;
  readonly document: SchematicDocument;
  readonly previousResult: SolveResult | null;
  readonly simulationTimeMs: number;
  readonly deferred: Deferred<SolveResult>;
}

class FakeExecutor implements ElectronicsSimulationWorkerExecutor {
  generation = 0;
  cancelCount = 0;
  disposeCount = 0;
  readonly preflights: Array<Deferred<SolveResult>> = [];
  readonly advances: AdvanceCall[] = [];
  beginGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  preflight(): Promise<SolveResult> {
    const request = deferred<SolveResult>();
    this.preflights.push(request);
    return request.promise;
  }

  advance(
    generationId: number,
    document: SchematicDocument,
    previousResult: SolveResult | null,
    simulationTimeMs: number,
  ): Promise<SolveResult> {
    const request = deferred<SolveResult>();
    this.advances.push({
      generationId,
      document,
      previousResult,
      simulationTimeMs,
      deferred: request,
    });
    return request.promise;
  }

  cancelActiveGeneration(): void {
    this.cancelCount += 1;
  }

  dispose(): void {
    this.disposeCount += 1;
  }
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};
describe('Electronics live simulation Worker controller', () => {
  it('keeps only the latest target while preflight is in flight', async () => {
    const executor = new FakeExecutor();
    const onResult = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);

    controller.start('project-a', circuit, { onResult, onFailure: vi.fn() });
    controller.update(circuit, 100);
    controller.update({ ...circuit, viewport: { ...circuit.viewport, x: 1 } }, 200);
    expect(executor.advances).toHaveLength(0);

    executor.preflights[0]!.resolve(result(1));
    await flush();
    expect(onResult).not.toHaveBeenCalled();
    expect(executor.advances).toHaveLength(1);
    expect(executor.advances[0]).toMatchObject({
      simulationTimeMs: 200,
      previousResult: result(1),
    });

    executor.advances[0]!.deferred.resolve(result(2));
    await flush();
    expect(onResult).toHaveBeenLastCalledWith(result(2));
  });
  it('coalesces updates while advance is in flight and carries the latest result forward', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult: vi.fn(), onFailure: vi.fn() });
    executor.preflights[0]!.resolve(result(1));
    await flush();

    controller.update(circuit, 100);
    expect(executor.advances).toHaveLength(1);
    controller.update(circuit, 200);
    controller.update(circuit, 400);
    expect(executor.advances).toHaveLength(1);

    executor.advances[0]!.deferred.resolve(result(2));
    await flush();
    expect(executor.advances).toHaveLength(2);
    expect(executor.advances[1]).toMatchObject({
      simulationTimeMs: 400,
      previousResult: result(2),
    });
  });

  it('drops late results after stop and cancels the active generation', async () => {
    const executor = new FakeExecutor();
    const onResult = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult, onFailure: vi.fn() });
    controller.stop();
    executor.preflights[0]!.resolve(result(1));
    await flush();
    expect(onResult).not.toHaveBeenCalled();
    expect(executor.cancelCount).toBe(1);
  });
  it('fails closed and ignores future updates after a Worker error', async () => {
    const executor = new FakeExecutor();
    const onFailure = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult: vi.fn(), onFailure });

    executor.preflights[0]!.reject(new Error('worker crashed'));
    await flush();
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure.mock.calls[0]?.[0]).toMatchObject({ message: 'worker crashed' });
    expect(executor.cancelCount).toBe(1);

    controller.update(circuit, 500);
    expect(executor.advances).toHaveLength(0);
  });

  it('supersedes the previous generation and disposes the executor explicitly', async () => {
    const executor = new FakeExecutor();
    const firstResult = vi.fn();
    const secondResult = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult: firstResult, onFailure: vi.fn() });
    controller.start('project-b', circuit, { onResult: secondResult, onFailure: vi.fn() });
    expect(executor.cancelCount).toBe(1);

    executor.preflights[0]!.resolve(result(1));
    executor.preflights[1]!.resolve(result(2));
    await flush();
    expect(firstResult).not.toHaveBeenCalled();
    expect(secondResult).toHaveBeenCalledWith(result(2));

    controller.dispose();
    expect(executor.disposeCount).toBe(1);
  });
});
