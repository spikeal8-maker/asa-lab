import {
  resetElectronicsTimedState,
  type ElectronicsTimedInputEvent,
  type ElectronicsTimedState,
} from '@asa-lab/electronics/engine';
import { describe, expect, it, vi } from 'vitest';
import type { SchematicDocument, SolveResult } from '../../api';
import {
  ElectronicsLiveSimulationWorkerController,
  type ElectronicsSimulationWorkerExecutor,
} from '../live-simulation-worker-controller';
import type { SimulationTimedAdvancePayload } from '../simulation-worker-protocol';

const circuit: SchematicDocument = {
  schemaVersion: 4,
  components: [
    { id: 'source', kind: 'source', position: { x: 0, y: 0 }, value: 5 },
    { id: 'resistor', kind: 'resistor', position: { x: 20, y: 0 }, value: 1000 },
    {
      id: 'button',
      kind: 'button',
      componentTypeId: 'button-tactile-6mm',
      position: { x: 40, y: 0 },
      value: 1,
      state: false,
    },
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

function timedState(committedMicroseconds = 0): ElectronicsTimedState {
  if (committedMicroseconds === 0) return resetElectronicsTimedState();
  return {
    version: 1,
    lifecycle: 'running',
    continuation: {
      version: 1,
      clockContractVersion: 1,
      engineContractVersion: 1,
      clockProfileId: 'dc-inputs-v1',
      documentDigest: 'fixture-document',
      modelSetDigest: 'fixture-models',
      committedHorizonMicroseconds: committedMicroseconds,
      serializedState: '{}',
    },
  };
}

function timedAdvance(
  executionStatus: 'ready' | 'yielded' | 'fault',
  requestedHorizonMicroseconds: number,
  committedHorizonMicroseconds: number,
  current = 1,
): SimulationTimedAdvancePayload {
  return {
    executionStatus,
    requestedHorizonMicroseconds,
    committedHorizonMicroseconds,
    state: timedState(committedHorizonMicroseconds),
    result: executionStatus === 'ready' ? result(current) : null,
    diagnostics: executionStatus === 'fault' ? [{ code: 'fixture-fault', message: 'fault' }] : [],
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
  readonly state: ElectronicsTimedState;
  readonly requestedHorizonMicroseconds: number;
  readonly inputEvents: readonly ElectronicsTimedInputEvent[];
  readonly deferred: Deferred<SimulationTimedAdvancePayload>;
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
    state: ElectronicsTimedState,
    requestedHorizonMicroseconds: number,
    inputEvents: readonly ElectronicsTimedInputEvent[] = [],
  ): Promise<SimulationTimedAdvancePayload> {
    const request = deferred<SimulationTimedAdvancePayload>();
    this.advances.push({
      generationId,
      document,
      state,
      requestedHorizonMicroseconds,
      inputEvents,
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

async function completeCanonicalStart(
  executor: FakeExecutor,
  generationId: number,
  current = 1,
): Promise<void> {
  executor.preflights[generationId - 1]!.resolve(result(current));
  await flush();
  const initialAdvance = executor.advances.find(
    (call) => call.generationId === generationId && call.requestedHorizonMicroseconds === 0,
  );
  if (!initialAdvance) throw new Error('Missing canonical horizon-zero advance.');
  initialAdvance.deferred.resolve(timedAdvance('ready', 0, 0, current));
  await flush();
}

describe('Electronics canonical Worker controller', () => {
  it('publishes only canonical ready observations and coalesces preflight horizons', async () => {
    const executor = new FakeExecutor();
    const onResult = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);

    controller.start('project-a', circuit, { onResult, onFailure: vi.fn() });
    controller.update(circuit, 100_000);
    controller.update(circuit, 200_000);
    expect(executor.advances).toHaveLength(0);

    executor.preflights[0]!.resolve(result(1));
    await flush();
    expect(onResult).not.toHaveBeenCalled();
    expect(executor.advances).toHaveLength(1);
    expect(executor.advances[0]).toMatchObject({ requestedHorizonMicroseconds: 200_000 });
    expect(executor.advances[0]!.state).toEqual(resetElectronicsTimedState());

    executor.advances[0]!.deferred.resolve(timedAdvance('ready', 200_000, 200_000, 2));
    await flush();
    expect(onResult).toHaveBeenCalledWith(result(2));
  });

  it('turns button changes into append-only canonical input events', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);

    const pressed = {
      ...circuit,
      components: circuit.components.map((component) =>
        component.id === 'button' ? { ...component, state: true } : component,
      ),
    };
    controller.update(pressed, 0);
    expect(executor.advances[1]).toMatchObject({ requestedHorizonMicroseconds: 1 });
    expect(executor.advances[1]!.inputEvents).toEqual([
      { atMicroseconds: 1, targetId: 'button', operation: 'state', payload: true },
    ]);
    executor.advances[1]!.deferred.resolve(timedAdvance('ready', 1, 1, 2));
    await flush();

    const released = {
      ...pressed,
      components: pressed.components.map((component) =>
        component.id === 'button' ? { ...component, state: false } : component,
      ),
    };
    controller.update(released, 0);
    expect(executor.advances[2]).toMatchObject({ requestedHorizonMicroseconds: 2 });
    expect(executor.advances[2]!.inputEvents).toEqual([
      { atMicroseconds: 2, targetId: 'button', operation: 'state', payload: false },
    ]);
  });

  it('resumes yielded canonical work without publishing a partial horizon', async () => {
    const executor = new FakeExecutor();
    const onResult = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult, onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);
    onResult.mockClear();

    controller.update(circuit, 300_000);
    executor.advances[1]!.deferred.resolve(timedAdvance('yielded', 300_000, 256_000));
    await flush();
    expect(onResult).not.toHaveBeenCalled();
    expect(executor.advances).toHaveLength(3);
    expect(executor.advances[2]).toMatchObject({ requestedHorizonMicroseconds: 300_000 });
    expect(executor.advances[2]!.state.continuation?.committedHorizonMicroseconds).toBe(256_000);

    executor.advances[2]!.deferred.resolve(timedAdvance('ready', 300_000, 300_000, 3));
    await flush();
    expect(onResult).toHaveBeenCalledWith(result(3));
  });

  it('timestamps live inputs immediately after committed canonical time, not host wall time', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);

    controller.update(circuit, 100_000);
    executor.advances[1]!.deferred.resolve(timedAdvance('ready', 100_000, 100_000, 2));
    await flush();

    const pressed = {
      ...circuit,
      components: circuit.components.map((component) =>
        component.id === 'button' ? { ...component, state: true } : component,
      ),
    };
    controller.update(pressed, 1_000_000);
    expect(executor.advances[2]!.inputEvents).toEqual([
      { atMicroseconds: 100_001, targetId: 'button', operation: 'state', payload: true },
    ]);
    expect(executor.advances[2]).toMatchObject({ requestedHorizonMicroseconds: 200_001 });
    executor.advances[2]!.deferred.resolve(timedAdvance('ready', 200_001, 200_001, 3));
    await flush();
    expect(executor.advances[3]).toMatchObject({ requestedHorizonMicroseconds: 1_000_000 });
  });

  it('finishes a yielded target before chasing newer host horizons', async () => {
    const executor = new FakeExecutor();
    const onResult = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult, onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);
    onResult.mockClear();

    controller.update(circuit, 300_000);
    controller.update(circuit, 500_000);
    executor.advances[1]!.deferred.resolve(timedAdvance('yielded', 300_000, 160_000));
    await flush();

    expect(executor.advances).toHaveLength(3);
    expect(executor.advances[2]).toMatchObject({ requestedHorizonMicroseconds: 300_000 });
    executor.advances[2]!.deferred.resolve(timedAdvance('ready', 300_000, 300_000, 3));
    await flush();

    expect(onResult).toHaveBeenCalledWith(result(3));
    expect(executor.advances).toHaveLength(4);
    expect(executor.advances[3]).toMatchObject({ requestedHorizonMicroseconds: 500_000 });
  });

  it('retimes unsent input events beyond progress committed by an in-flight advance', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);

    controller.update(circuit, 300_000);
    const pressed = {
      ...circuit,
      components: circuit.components.map((component) =>
        component.id === 'button' ? { ...component, state: true } : component,
      ),
    };
    controller.update(pressed, 100_000);

    executor.advances[1]!.deferred.resolve(timedAdvance('yielded', 300_000, 256_000));
    await flush();

    expect(executor.advances).toHaveLength(3);
    expect(executor.advances[2]).toMatchObject({ requestedHorizonMicroseconds: 300_000 });
    expect(executor.advances[2]!.state.continuation?.committedHorizonMicroseconds).toBe(256_000);
    expect(executor.advances[2]!.inputEvents).toEqual([
      { atMicroseconds: 256_001, targetId: 'button', operation: 'state', payload: true },
    ]);
    executor.advances[2]!.deferred.resolve(timedAdvance('ready', 300_000, 300_000, 3));
    await flush();
    expect(executor.advances).toHaveLength(3);
  });

  it('retimes pending input groups with one shared offset', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    const twoButtons: SchematicDocument = {
      ...circuit,
      components: [
        ...circuit.components,
        {
          id: 'button-2',
          kind: 'button',
          componentTypeId: 'button-tactile-6mm',
          position: { x: 60, y: 0 },
          value: 1,
          state: false,
        },
      ],
    };
    controller.start('project-a', twoButtons, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);

    controller.update(twoButtons, 300_000);
    const bothPressed: SchematicDocument = {
      ...twoButtons,
      components: twoButtons.components.map((component) =>
        component.id === 'button' || component.id === 'button-2'
          ? { ...component, state: true }
          : component,
      ),
    };
    controller.update(bothPressed, 100_000);
    const firstReleased: SchematicDocument = {
      ...bothPressed,
      components: bothPressed.components.map((component) =>
        component.id === 'button' ? { ...component, state: false } : component,
      ),
    };
    controller.update(firstReleased, 100_000);

    executor.advances[1]!.deferred.resolve(timedAdvance('yielded', 300_000, 256_000));
    await flush();

    expect(executor.advances).toHaveLength(3);
    expect(executor.advances[2]!.inputEvents).toEqual([
      { atMicroseconds: 256_001, targetId: 'button', operation: 'state', payload: true },
      { atMicroseconds: 256_001, targetId: 'button-2', operation: 'state', payload: true },
      { atMicroseconds: 256_002, targetId: 'button', operation: 'state', payload: false },
    ]);
    expect(executor.advances[2]!.inputEvents[0]!.atMicroseconds).toBe(
      executor.advances[2]!.inputEvents[1]!.atMicroseconds,
    );
    expect(
      executor.advances[2]!.inputEvents[2]!.atMicroseconds -
        executor.advances[2]!.inputEvents[1]!.atMicroseconds,
    ).toBe(1);
    expect(executor.advances[2]!.inputEvents.every((event) => event.atMicroseconds > 256_000)).toBe(
      true,
    );
  });

  it('coalesces newer horizons while an advance is in flight', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);

    controller.update(circuit, 100_000);
    controller.update(circuit, 200_000);
    controller.update(circuit, 400_000);
    expect(executor.advances).toHaveLength(2);

    executor.advances[1]!.deferred.resolve(timedAdvance('ready', 100_000, 100_000, 2));
    await flush();
    expect(executor.advances).toHaveLength(3);
    expect(executor.advances[2]).toMatchObject({ requestedHorizonMicroseconds: 400_000 });
    expect(executor.advances[2]!.state.continuation?.committedHorizonMicroseconds).toBe(100_000);
  });

  it('restarts the active canonical generation from time zero', async () => {
    const executor = new FakeExecutor();
    const onResult = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult, onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);
    onResult.mockClear();

    controller.update(circuit, 300_000);
    const oldAdvance = executor.advances[1]!;
    controller.restart(circuit);

    expect(executor.generation).toBe(2);
    expect(executor.preflights).toHaveLength(2);

    oldAdvance.deferred.resolve(timedAdvance('ready', 300_000, 300_000, 9));
    await flush();
    expect(onResult).not.toHaveBeenCalled();

    executor.preflights[1]!.resolve(result(2));
    await flush();
    const resetAdvance = executor.advances.find(
      (call) => call.generationId === 2 && call.requestedHorizonMicroseconds === 0,
    );
    expect(resetAdvance).toBeDefined();
    expect(resetAdvance!.state).toEqual(resetElectronicsTimedState());
    expect(resetAdvance!.state.continuation).toBeNull();

    resetAdvance!.deferred.resolve(timedAdvance('ready', 0, 0, 2));
    await flush();
    expect(onResult).toHaveBeenCalledWith(result(2));

    controller.update(circuit, 50_000);
    expect(executor.advances.at(-1)).toMatchObject({
      generationId: 2,
      requestedHorizonMicroseconds: 50_000,
      state: resetElectronicsTimedState(),
    });
  });

  it('keeps one canonical generation across Arduino source-only edits', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    const sourceA =
      'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);}';
    const sourceB = 'void setup(){digitalWrite(13,);}void loop(){}';
    const arduinoCircuit: SchematicDocument = {
      ...circuit,
      components: [
        ...circuit.components,
        {
          id: 'uno',
          kind: 'visual',
          value: 5,
          position: { x: 80, y: 0 },
          componentTypeId: 'arduino-uno',
          pinIds: ['d13', 'power-gnd-1'],
          stateProperties: { arduinoSource: sourceA },
        },
      ],
    };

    controller.start('project-a', arduinoCircuit, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);

    const edited: SchematicDocument = {
      ...arduinoCircuit,
      components: arduinoCircuit.components.map((component) =>
        component.id === 'uno'
          ? {
              ...component,
              stateProperties: { ...component.stateProperties, arduinoSource: sourceB },
            }
          : component,
      ),
    };
    controller.update(edited, 100_000);

    expect(executor.generation).toBe(1);
    expect(executor.preflights).toHaveLength(1);
    expect(executor.advances.at(-1)?.generationId).toBe(1);
    expect(
      executor.advances
        .at(-1)
        ?.document.components.find((component) => component.id === 'uno')?.stateProperties
        ?.arduinoSource,
    ).toBe(sourceB);
  });

  it('starts a fresh zero-based canonical generation for structural runtime changes', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);

    const changed = {
      ...circuit,
      components: circuit.components.map((component) =>
        component.id === 'resistor' ? { ...component, value: 470 } : component,
      ),
    };
    controller.update(changed, 500_000);
    expect(executor.generation).toBe(2);
    expect(executor.preflights).toHaveLength(2);
    await completeCanonicalStart(executor, 2, 2);

    controller.update(changed, 600_000);
    expect(executor.advances.at(-1)).toMatchObject({ requestedHorizonMicroseconds: 100_000 });
  });

  it('keeps the canonical generation across presentation-only viewport changes', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);

    const panned = { ...circuit, viewport: { x: 120, y: -40, zoom: 1.75 } };
    controller.update(panned, 100_000);

    expect(executor.generation).toBe(1);
    expect(executor.preflights).toHaveLength(1);
    expect(executor.advances.at(-1)).toMatchObject({ requestedHorizonMicroseconds: 100_000 });
  });
  it('fails closed on a canonical fault and ignores future updates', async () => {
    const executor = new FakeExecutor();
    const onFailure = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult: vi.fn(), onFailure });
    await completeCanonicalStart(executor, 1);

    controller.update(circuit, 100_000);
    executor.advances[1]!.deferred.resolve(timedAdvance('fault', 100_000, 0));
    await flush();
    expect(onFailure).toHaveBeenCalledOnce();
    expect(executor.cancelCount).toBe(1);

    controller.update(circuit, 200_000);
    expect(executor.advances).toHaveLength(2);
  });

  it('drops late preflight results after stop and cancels the generation', async () => {
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

  it('supersedes the previous generation and disposes explicitly', async () => {
    const executor = new FakeExecutor();
    const firstResult = vi.fn();
    const secondResult = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult: firstResult, onFailure: vi.fn() });
    controller.start('project-b', circuit, { onResult: secondResult, onFailure: vi.fn() });
    expect(executor.cancelCount).toBe(1);

    executor.preflights[0]!.resolve(result(1));
    await flush();
    expect(firstResult).not.toHaveBeenCalled();
    await completeCanonicalStart(executor, 2, 2);
    expect(secondResult).toHaveBeenCalledWith(result(2));

    controller.dispose();
    expect(executor.disposeCount).toBe(1);
  });
});
