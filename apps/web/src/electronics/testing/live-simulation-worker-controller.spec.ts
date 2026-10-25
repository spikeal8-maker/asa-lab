import {
  advanceElectronicsToHorizon,
  parseElectronicsEngineDocument,
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
import {
  ELECTRONICS_SIMULATION_ENGINE_REVISION,
  ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
  type SimulationTimedAdvancePayload,
} from '../simulation-worker-protocol';
import {
  evaluateSimulationWorkerRequest,
  evaluateSimulationWorkerRequestBatched,
} from '../simulation-worker-evaluator';
import { SimulationWorkerError } from '../simulation-failure';
import { classroomRequestedHorizon } from '../led-temporal-presentation';

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

const pirCircuit: SchematicDocument = {
  ...circuit,
  components: [
    ...circuit.components,
    {
      id: 'pir',
      kind: 'visual',
      value: 0,
      position: { x: 70, y: 0 },
      componentTypeId: 'pir-sensor',
      variantId: 'pir-sensor',
      pinIds: ['vcc', 'signal', 'gnd'],
      stateProperties: { motionDetected: false },
    },
  ],
};

const ultrasonicCircuit: SchematicDocument = {
  ...circuit,
  components: [
    ...circuit.components,
    {
      id: 'sonar',
      kind: 'visual',
      value: 0,
      position: { x: 70, y: 0 },
      componentTypeId: 'ultrasonic-sensor',
      variantId: 'ultrasonic-sensor',
      pinIds: ['gnd', 'vcc', 'signal'],
      stateProperties: { distanceMeters: 0.5 },
    },
  ],
};

const serialCircuit: SchematicDocument = {
  ...circuit,
  components: [
    ...circuit.components,
    {
      id: 'uno',
      kind: 'visual',
      value: 5,
      position: { x: 60, y: 0 },
      componentTypeId: 'arduino-uno',
      pinIds: ['d13', 'power-5v', 'power-3v3', 'power-gnd-1'],
      stateProperties: {
        arduinoSource: 'void setup(){Serial.begin(9600);}void loop(){delay(100);}',
      },
    },
  ],
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
    serial: [],
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
  it('pulls already elapsed positive host demand immediately after H0 without an external tick', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    let horizon = 0;
    controller.start('bootstrap', circuit, {
      onInitialReady: () => {
        horizon = 500;
      },
      readHostHorizonMicroseconds: () => horizon,
      onResult: vi.fn(),
      onFailure: vi.fn(),
    });
    await completeCanonicalStart(executor, 1);
    expect(executor.advances.map((call) => call.requestedHorizonMicroseconds)).toEqual([0, 500]);
    controller.dispose();
  });

  it('caps the first lawful host observation at 1ms and retains the complete remaining demand', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('bootstrap', circuit, {
      onResult: vi.fn(),
      onFailure: vi.fn(),
      readHostHorizonMicroseconds: () => 40_000,
    });
    await completeCanonicalStart(executor, 1);
    expect(executor.advances.at(-1)!.requestedHorizonMicroseconds).toBe(1000);
    for (const [from, to] of [
      [0, 1000],
      [1000, 26000],
      [26000, 40000],
    ] as const) {
      const call = executor.advances.at(-1)!;
      expect(call.requestedHorizonMicroseconds).toBe(to);
      expect(call.state.continuation?.committedHorizonMicroseconds ?? 0).toBe(from);
      call.deferred.resolve(timedAdvance('ready', to, to));
      await flush();
    }
    expect(executor.advances.map((call) => call.requestedHorizonMicroseconds)).toEqual([
      0, 1000, 26000, 40000,
    ]);
    controller.dispose();
  });

  it('retries a zero clock once in a guarded microtask without waiting for RAF or interval', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    const read = vi.fn().mockReturnValueOnce(0).mockReturnValue(300);
    controller.start('bootstrap', circuit, {
      onResult: vi.fn(),
      onFailure: vi.fn(),
      readHostHorizonMicroseconds: read,
    });
    await completeCanonicalStart(executor, 1);
    expect(executor.advances.map((call) => call.requestedHorizonMicroseconds)).toEqual([0, 300]);
    controller.dispose();
  });

  it.each([null, undefined, NaN, Infinity, -1, 0.5, 0])(
    'does not invent positive demand for invalid/zero host %s',
    async (host) => {
      const executor = new FakeExecutor();
      const controller = new ElectronicsLiveSimulationWorkerController(executor);
      const read = vi.fn(() => host);
      controller.start('bootstrap', circuit, {
        onResult: vi.fn(),
        onFailure: vi.fn(),
        readHostHorizonMicroseconds: read as unknown as () => number | null,
      });
      await completeCanonicalStart(executor, 1);
      await flush();
      expect(executor.advances).toHaveLength(1);
      expect(read).toHaveBeenCalledTimes(host === 0 ? 2 : 1);
      controller.dispose();
    },
  );

  it.each(['Stop', 'Reset', 'source'] as const)(
    'rejects H0 bootstrap after a reentrant onResult %s',
    async (action) => {
      const executor = new FakeExecutor();
      const controller = new ElectronicsLiveSimulationWorkerController(executor);
      const read = vi.fn(() => 40000);
      controller.start('bootstrap', serialCircuit, {
        readHostHorizonMicroseconds: read,
        onFailure: vi.fn(),
        onResult: () => {
          if (action === 'Stop') controller.stop();
          if (action === 'Reset') controller.restart(serialCircuit);
          if (action === 'source')
            controller.update(
              {
                ...serialCircuit,
                components: serialCircuit.components.map((c) =>
                  c.id === 'uno'
                    ? {
                        ...c,
                        stateProperties: { arduinoSource: 'void setup(){}void loop(){delay(77);}' },
                      }
                    : c,
                ),
              },
              0,
            );
        },
      });
      await completeCanonicalStart(executor, 1);
      if (action === 'source') {
        // The source update itself owns a fresh host read/dispatch; H0 must not
        // add a stale bootstrap after that reentrant valid command.
        expect(read).toHaveBeenCalledTimes(1);
        expect(executor.advances).toHaveLength(2);
        expect(executor.advances[1]!.requestedHorizonMicroseconds).toBe(1000);
        expect(
          executor.advances[1]!.document.components.find((c) => c.id === 'uno')!.stateProperties!
            .arduinoSource,
        ).toContain('delay(77)');
      } else {
        expect(read).not.toHaveBeenCalled();
        expect(
          executor.advances.filter((call) => call.requestedHorizonMicroseconds > 0),
        ).toHaveLength(0);
      }
      controller.dispose();
    },
  );

  it('cancels a zero-clock microtask when Stop is queued by H0 publication', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    const read = vi.fn().mockReturnValueOnce(0).mockReturnValue(40000);
    controller.start('bootstrap', circuit, {
      readHostHorizonMicroseconds: read,
      onFailure: vi.fn(),
      onResult: () => queueMicrotask(() => controller.stop()),
    });
    await completeCanonicalStart(executor, 1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(executor.advances).toHaveLength(1);
    controller.dispose();
  });

  it('retains the first positive slice after both H0 clock reads round to zero', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    let host = 0;
    controller.start('bootstrap', circuit, {
      onResult: vi.fn(),
      onFailure: vi.fn(),
      readHostHorizonMicroseconds: () => host,
    });
    await completeCanonicalStart(executor, 1);
    expect(executor.advances).toHaveLength(1);
    host = 40000;
    controller.update(circuit, host);
    expect(executor.advances.at(-1)!.requestedHorizonMicroseconds).toBe(1000);
    for (const to of [1000, 26000, 40000]) {
      const call = executor.advances.at(-1)!;
      expect(call.requestedHorizonMicroseconds).toBe(to);
      call.deferred.resolve(timedAdvance('ready', to, to));
      await flush();
    }
    expect(executor.advances.map((call) => call.requestedHorizonMicroseconds)).toEqual([
      0, 1000, 26000, 40000,
    ]);
    controller.dispose();
  });

  it.each([null, undefined, NaN, Infinity, -1, 0.5])(
    'retains the first slice after invalid H0 host %s becomes lawful',
    async (initial) => {
      const executor = new FakeExecutor();
      const controller = new ElectronicsLiveSimulationWorkerController(executor);
      let host: number | null | undefined = initial;
      controller.start('bootstrap', circuit, {
        onResult: vi.fn(),
        onFailure: vi.fn(),
        readHostHorizonMicroseconds: (() => host) as unknown as () => number | null,
      });
      await completeCanonicalStart(executor, 1);
      host = 40000;
      controller.update(circuit, host);
      expect(executor.advances.at(-1)!.requestedHorizonMicroseconds).toBe(1000);
      controller.dispose();
    },
  );

  it('preserves input priority and its canonical committed-time timestamp with a pending first slice', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    let host = 0;
    controller.start('bootstrap', circuit, {
      onResult: vi.fn(),
      onFailure: vi.fn(),
      readHostHorizonMicroseconds: () => host,
    });
    await completeCanonicalStart(executor, 1);
    host = 5000;
    controller.update(
      {
        ...circuit,
        components: circuit.components.map((c) => (c.id === 'button' ? { ...c, state: true } : c)),
      },
      host,
    );
    const call = executor.advances.at(-1)!;
    expect(call.requestedHorizonMicroseconds).toBe(5000);
    expect(call.inputEvents).toEqual([
      { atMicroseconds: 1, targetId: 'button', operation: 'state', payload: true },
    ]);
    controller.dispose();
  });

  it('does not consume first complete observation on an equal-time yielded checkpoint', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('bootstrap', circuit, {
      onResult: vi.fn(),
      onFailure: vi.fn(),
      readHostHorizonMicroseconds: () => 40000,
    });
    await completeCanonicalStart(executor, 1);
    executor.advances.at(-1)!.deferred.resolve(timedAdvance('yielded', 1000, 0));
    await flush();
    expect(executor.advances.at(-1)!.requestedHorizonMicroseconds).toBe(0);
    executor.advances.at(-1)!.deferred.resolve(timedAdvance('ready', 0, 0));
    await flush();
    expect(executor.advances.at(-1)!.requestedHorizonMicroseconds).toBe(1000);
    controller.dispose();
  });

  it('does not dispatch fulfilled host ticks and resumes only for new demand', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);
    controller.update(circuit, 6_250);
    executor.advances[1]!.deferred.resolve(timedAdvance('ready', 6_250, 6_250));
    await flush();
    for (const horizon of [6_250, 6_250, 6_249, 0, 6_250]) controller.update(circuit, horizon);
    expect(executor.advances).toHaveLength(2);
    controller.update(circuit, 6_251);
    expect(executor.advances).toHaveLength(3);
    expect(executor.advances[2]!.requestedHorizonMicroseconds).toBe(6_251);
    expect(executor.advances[2]!.state.continuation?.committedHorizonMicroseconds).toBe(6_250);
    controller.dispose();
  });

  it('retains same-horizon Arduino source edits queued behind an advance', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', serialCircuit, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);
    controller.update(serialCircuit, 6_250);
    const edited: SchematicDocument = {
      ...serialCircuit,
      components: serialCircuit.components.map((component) =>
        component.id === 'uno'
          ? {
              ...component,
              stateProperties: { arduinoSource: 'void setup(){}void loop(){delay(50);}' },
            }
          : component,
      ),
    };
    controller.update(edited, 6_250);
    executor.advances[1]!.deferred.resolve(timedAdvance('ready', 6_250, 6_250));
    await flush();
    expect(executor.advances).toHaveLength(3);
    expect(executor.advances[2]!.requestedHorizonMicroseconds).toBe(6_250);
    expect(
      executor.advances[2]!.document.components.find((part) => part.id === 'uno')?.stateProperties
        ?.arduinoSource,
    ).toBe('void setup(){}void loop(){delay(50);}');
    executor.advances[2]!.deferred.resolve(timedAdvance('ready', 6_250, 6_250));
    await flush();
    controller.update(
      { ...edited, components: edited.components.map((part) => ({ ...part })) },
      6_250,
    );
    expect(executor.advances).toHaveLength(3);
    expect(executor.generation).toBe(1);
    controller.dispose();
  });

  it('forwards the accepted clock profile even when that profile has no temporal history', async () => {
    for (const clockProfileId of [
      'dc-inputs-v1',
      'rc-inputs-v2',
      'electrothermal-v1',
      'electrothermal-events-v2',
    ]) {
      const executor = new FakeExecutor();
      const controller = new ElectronicsLiveSimulationWorkerController(executor);
      const onResult = vi.fn();
      controller.start('project-a', circuit, { onResult, onFailure: vi.fn() });
      executor.preflights[0]!.resolve(result(1));
      await flush();
      const startup = timedAdvance('ready', 0, 0);
      executor.advances[0]!.deferred.resolve({
        ...startup,
        state: {
          ...startup.state,
          continuation: {
            ...timedState(1).continuation!,
            committedHorizonMicroseconds: 0,
            clockProfileId,
          },
        },
      });
      await flush();
      expect(onResult).toHaveBeenCalledExactlyOnceWith(result(1), undefined, clockProfileId);
      controller.stop();
    }
  });

  it('publishes optical metadata only with its accepted complete ready horizon', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    const onResult = vi.fn();
    controller.start('project-a', circuit, { onResult, onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);
    onResult.mockClear();
    controller.update(circuit, 25_000);
    const optical = {
      profile: 'ordinary-led-held-v1' as const,
      fromMicroseconds: 0,
      toMicroseconds: 25_000,
      components: [],
    };
    executor.advances.at(-1)!.deferred.resolve({
      ...timedAdvance('ready', 25_000, 25_000, 2),
      ledTemporal: optical,
    });
    await flush();
    expect(onResult).toHaveBeenCalledExactlyOnceWith(result(2), optical, 'dc-inputs-v1');

    controller.update(circuit, 50_000);
    executor.advances.at(-1)!.deferred.resolve({
      ...timedAdvance('ready', 50_000, 50_000, 3),
      ledTemporal: optical,
    });
    await flush();
    expect(onResult).toHaveBeenLastCalledWith(result(3), undefined, 'dc-inputs-v1');

    controller.update(circuit, 75_000);
    const stale = executor.advances.at(-1)!;
    controller.restart(circuit);
    onResult.mockClear();
    stale.deferred.resolve({
      ...timedAdvance('ready', 75_000, 75_000, 4),
      ledTemporal: { ...optical, fromMicroseconds: 50_000, toMicroseconds: 75_000 },
    });
    await flush();
    expect(onResult).not.toHaveBeenCalled();
  });

  it('publishes time zero before coalesced preflight horizons and later ready observations', async () => {
    const executor = new FakeExecutor();
    const onResult = vi.fn();
    const onInitialReady = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);

    controller.start('project-a', circuit, { onResult, onInitialReady, onFailure: vi.fn() });
    controller.update(circuit, 25_000);
    controller.update(circuit, 50_000);
    expect(executor.advances).toHaveLength(0);

    executor.preflights[0]!.resolve(result(1));
    await flush();
    expect(onResult).not.toHaveBeenCalled();
    expect(onInitialReady).not.toHaveBeenCalled();
    expect(executor.advances).toHaveLength(1);
    expect(executor.advances[0]).toMatchObject({
      requestedHorizonMicroseconds: 0,
      inputEvents: [],
    });
    expect(executor.advances[0]!.state).toEqual(resetElectronicsTimedState());

    controller.update(circuit, 75_000);
    executor.advances[0]!.deferred.resolve(timedAdvance('ready', 0, 0, 1));
    await flush();
    expect(onResult).toHaveBeenCalledExactlyOnceWith(result(1), undefined, undefined);
    expect(onInitialReady).toHaveBeenCalledExactlyOnceWith(0);
    expect(executor.advances[1]).toMatchObject({ requestedHorizonMicroseconds: 25_000 });
    executor.advances[1]!.deferred.resolve(timedAdvance('yielded', 25_000, 15_000));
    await flush();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(executor.advances[2]).toMatchObject({ requestedHorizonMicroseconds: 15_000 });
    executor.advances[2]!.deferred.resolve(timedAdvance('ready', 15_000, 15_000, 2));
    await flush();
    expect(onResult).toHaveBeenLastCalledWith(result(2), undefined, 'dc-inputs-v1');
    expect(onInitialReady).toHaveBeenCalledExactlyOnceWith(0);
  });

  it.each(['stop', 'restart', 'replace', 'dispose'] as const)(
    'withholds the old startup frame when initial-ready invokes %s',
    async (action) => {
      const executor = new FakeExecutor();
      const controller = new ElectronicsLiveSimulationWorkerController(executor);
      const onResult = vi.fn();
      const onCommittedHorizon = vi.fn();
      const replacementResult = vi.fn();
      const onInitialReady = vi.fn(() => {
        if (action === 'stop') controller.stop();
        else if (action === 'restart') controller.restart(circuit);
        else if (action === 'dispose') controller.dispose();
        else
          controller.start('project-b', circuit, {
            onResult: replacementResult,
            onCommittedHorizon,
            onFailure: vi.fn(),
          });
      });
      controller.start('project-a', circuit, {
        onResult,
        onCommittedHorizon,
        onInitialReady,
        onFailure: vi.fn(),
      });
      await completeCanonicalStart(executor, 1);
      expect(onInitialReady).toHaveBeenCalledExactlyOnceWith(0);
      expect(onResult).not.toHaveBeenCalled();
      expect(replacementResult).not.toHaveBeenCalled();
      expect(onCommittedHorizon).not.toHaveBeenCalled();
      expect(executor.advances).toHaveLength(1);
    },
  );

  it('retains ordered runtime and serial inputs until after a complete zero-time observation', async () => {
    const executor = new FakeExecutor();
    const onResult = vi.fn();
    const onCommittedHorizon = vi.fn();
    const onInitialReady = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', serialCircuit, {
      onResult,
      onCommittedHorizon,
      onInitialReady,
      onFailure: vi.fn(),
    });
    const pressed = {
      ...serialCircuit,
      components: serialCircuit.components.map((component) =>
        component.id === 'button' ? { ...component, state: true } : component,
      ),
    };
    controller.update(pressed, 50_000);
    controller.sendSerialRx('uno', 'A', 50_000);
    executor.preflights[0]!.resolve(result(1));
    await flush();
    expect(executor.advances[0]).toMatchObject({
      requestedHorizonMicroseconds: 0,
      inputEvents: [],
    });
    const released = {
      ...pressed,
      components: pressed.components.map((component) =>
        component.id === 'button' ? { ...component, state: false } : component,
      ),
    };
    controller.update(released, 75_000);
    controller.sendSerialRx('uno', 'B', 75_000);
    executor.advances[0]!.deferred.resolve(timedAdvance('yielded', 0, 0));
    await flush();
    expect(onResult).not.toHaveBeenCalled();
    expect(onInitialReady).not.toHaveBeenCalled();
    expect(executor.advances[1]).toMatchObject({
      requestedHorizonMicroseconds: 0,
      inputEvents: [],
    });
    executor.advances[1]!.deferred.resolve(timedAdvance('ready', 0, 0, 1));
    await flush();
    expect(onResult).toHaveBeenCalledExactlyOnceWith(result(1), undefined, undefined);
    expect(onInitialReady).toHaveBeenCalledExactlyOnceWith(0);
    expect(onCommittedHorizon).toHaveBeenLastCalledWith(0);
    expect(executor.advances[2]!.inputEvents).toEqual([
      { atMicroseconds: 1, targetId: 'button', operation: 'state', payload: true },
      { atMicroseconds: 2, targetId: 'uno', operation: 'serialRx', payload: 'A' },
      { atMicroseconds: 3, targetId: 'button', operation: 'state', payload: false },
      { atMicroseconds: 4, targetId: 'uno', operation: 'serialRx', payload: 'B' },
    ]);
    expect(executor.advances[2]).toMatchObject({ requestedHorizonMicroseconds: 25_000 });
    executor.advances[2]!.deferred.resolve(timedAdvance('ready', 25_000, 25_000, 2));
    await flush();
    expect(onResult).toHaveBeenLastCalledWith(result(2), undefined, 'dc-inputs-v1');
    expect(executor.advances[3]).toMatchObject({
      requestedHorizonMicroseconds: 50_000,
      inputEvents: [],
    });
  });

  it('rejects obsolete zero-time advances after a structural restart and Stop/new Start', async () => {
    const executor = new FakeExecutor();
    const onResult = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult, onFailure: vi.fn() });
    executor.preflights[0]!.resolve(result(1));
    await flush();
    const firstStartup = executor.advances[0]!;
    const changed = {
      ...circuit,
      components: circuit.components.map((component) =>
        component.id === 'resistor' ? { ...component, value: 470 } : component,
      ),
    };
    controller.update(changed, 125_000);
    controller.update(changed, 150_000);
    firstStartup.deferred.resolve(timedAdvance('ready', 0, 0, 99));
    await flush();
    expect(onResult).not.toHaveBeenCalled();
    await completeCanonicalStart(executor, 2, 2);
    expect(onResult).toHaveBeenCalledExactlyOnceWith(result(2), undefined, undefined);
    expect(executor.advances.at(-1)).toMatchObject({
      generationId: 2,
      requestedHorizonMicroseconds: 25_000,
    });

    controller.stop();
    controller.start('project-a', changed, { onResult, onFailure: vi.fn() });
    controller.update(changed, 50_000);
    await completeCanonicalStart(executor, 3, 3);
    expect(onResult).toHaveBeenLastCalledWith(result(3), undefined, undefined);
    expect(executor.advances.at(-1)).toMatchObject({
      generationId: 3,
      requestedHorizonMicroseconds: 25_000,
    });
  });

  it.each(['fault', 'missing-result', 'rejection', 'nonzero-request', 'nonzero-commit'] as const)(
    'fails closed during the zero-time observation on %s',
    async (mode) => {
      const executor = new FakeExecutor();
      const onResult = vi.fn();
      const onFailure = vi.fn();
      const onInitialReady = vi.fn();
      const controller = new ElectronicsLiveSimulationWorkerController(executor);
      controller.start('project-a', circuit, { onResult, onInitialReady, onFailure });
      controller.update(circuit, 50_000);
      executor.preflights[0]!.resolve(result(1));
      await flush();
      const startup = executor.advances[0]!;
      if (mode === 'rejection')
        startup.deferred.reject(new SimulationWorkerError('worker-timeout', 'Timed out.'));
      else if (mode === 'nonzero-request' || mode === 'nonzero-commit')
        startup.deferred.resolve(
          timedAdvance(
            'ready',
            mode === 'nonzero-request' ? 1 : 0,
            mode === 'nonzero-commit' ? 1 : 0,
          ),
        );
      else
        startup.deferred.resolve({
          ...timedAdvance(mode === 'fault' ? 'fault' : 'ready', 0, 0),
          result: null,
        });
      await flush();
      expect(onFailure).toHaveBeenCalledOnce();
      expect(onResult).not.toHaveBeenCalled();
      expect(onInitialReady).not.toHaveBeenCalled();
      expect(executor.cancelCount).toBe(1);
      controller.update(circuit, 75_000);
      expect(executor.advances).toHaveLength(1);
    },
  );

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

  it('routes PIR motion changes through the existing canonical pending input queue', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', pirCircuit, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);

    const detected = {
      ...pirCircuit,
      components: pirCircuit.components.map((component) =>
        component.id === 'pir'
          ? {
              ...component,
              stateProperties: { ...component.stateProperties, motionDetected: true },
            }
          : component,
      ),
    };
    controller.update(detected, 0);
    expect(executor.advances[1]!.inputEvents).toEqual([
      { atMicroseconds: 1, targetId: 'pir', operation: 'motionDetected', payload: true },
    ]);
  });

  it('routes ultrasonic distance through the existing canonical pending input queue', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', ultrasonicCircuit, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);

    const changed = {
      ...ultrasonicCircuit,
      components: ultrasonicCircuit.components.map((component) =>
        component.id === 'sonar'
          ? {
              ...component,
              stateProperties: { ...component.stateProperties, distanceMeters: 1 },
            }
          : component,
      ),
    };
    controller.update(changed, 0);
    expect(executor.advances[1]!.inputEvents).toEqual([
      { atMicroseconds: 1, targetId: 'sonar', operation: 'distanceMeters', payload: 1 },
    ]);
  });

  it('keeps a progressed generation when the running supply changes canonical controls', async () => {
    const executor = new FakeExecutor();
    const supplyCircuit: SchematicDocument = {
      ...circuit,
      components: [
        ...circuit.components,
        {
          id: 'supply',
          kind: 'source',
          value: 5,
          position: { x: 100, y: 0 },
          componentTypeId: 'regulated-power-supply',
          pinIds: ['positive', 'negative'],
          stateProperties: { voltageSetpointVolt: 5, currentLimitAmp: 1, outputEnabled: true },
        },
      ],
    };
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', supplyCircuit, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);
    controller.update(supplyCircuit, 20_000);
    executor.advances.at(-1)!.deferred.resolve(timedAdvance('ready', 20_000, 20_000));
    await flush();

    const changed: SchematicDocument = {
      ...supplyCircuit,
      components: supplyCircuit.components.map((component) =>
        component.id === 'supply'
          ? {
              ...component,
              value: 8,
              stateProperties: {
                ...component.stateProperties,
                voltageSetpointVolt: 8,
                currentLimitAmp: 0.5,
                outputEnabled: false,
              },
            }
          : component,
      ),
    };
    controller.update(changed, 20_000);
    expect(executor.generation).toBe(1);
    expect(executor.preflights).toHaveLength(1);
    expect(executor.advances.at(-1)).toMatchObject({
      state: timedState(20_000),
      inputEvents: [
        {
          atMicroseconds: 20_001,
          targetId: 'supply',
          operation: 'voltageSetpointVolt',
          payload: 8,
        },
        { atMicroseconds: 20_001, targetId: 'supply', operation: 'currentLimitAmp', payload: 0.5 },
        { atMicroseconds: 20_001, targetId: 'supply', operation: 'outputEnabled', payload: false },
      ],
    });
    expect(
      executor.advances.at(-1)!.document.components.find((component) => component.id === 'supply')
        ?.stateProperties?.voltageSetpointVolt,
    ).toBe(5);
  });

  it.each([
    'inconsistent-alias',
    'legacy-fallback',
    'non-finite-explicit',
    'other-source',
    'resistor',
    'psu-resistance',
  ])('keeps %s electrical changes structural', async (change) => {
    const supply = {
      id: 'supply',
      kind: 'source' as const,
      value: 5,
      position: { x: 100, y: 0 },
      componentTypeId: 'regulated-power-supply',
      stateProperties: {
        ...(change === 'legacy-fallback'
          ? {}
          : { voltageSetpointVolt: change === 'non-finite-explicit' ? Infinity : 5 }),
        currentLimitAmp: 1,
        outputEnabled: true,
        outputResistanceOhm: 0.05,
      },
    };
    const base: SchematicDocument = { ...circuit, components: [...circuit.components, supply] };
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', base, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);
    controller.update(base, 20_000);
    executor.advances.at(-1)!.deferred.resolve(timedAdvance('ready', 20_000, 20_000));
    await flush();
    const changed: SchematicDocument = {
      ...base,
      components: base.components.map((component) => {
        if (change === 'other-source' && component.id === 'source')
          return { ...component, value: 8 };
        if (change === 'resistor' && component.id === 'resistor')
          return { ...component, value: 2000 };
        if (component.id !== 'supply' || change === 'other-source' || change === 'resistor')
          return component;
        if (change === 'psu-resistance')
          return {
            ...component,
            stateProperties: { ...component.stateProperties, outputResistanceOhm: 0.1 },
          };
        // An explicit U with a mismatching value is not a safe alias; a missing
        // U still uses value as the electrical fallback.
        return { ...component, value: 8 };
      }),
    };
    controller.update(changed, 20_000);
    expect(executor.generation).toBe(2);
    expect(executor.preflights).toHaveLength(2);
    controller.dispose();
  });

  it('forwards the real complete electrothermal/Arduino/RC/motor continuation on a persisted PSU edit and resets only on Stop/Start', async () => {
    const part = (
      id: string,
      kind: SchematicDocument['components'][number]['kind'],
      value: number,
      componentTypeId?: string,
    ): SchematicDocument['components'][number] => ({
      id,
      kind,
      value,
      position: { x: 0, y: 0 },
      ...(componentTypeId ? { componentTypeId } : {}),
    });
    const base: SchematicDocument = {
      schemaVersion: 4,
      components: [
        {
          ...part('supply', 'source', 5, 'regulated-power-supply'),
          pinIds: ['positive', 'negative'],
          stateProperties: { voltageSetpointVolt: 5, currentLimitAmp: 1, outputEnabled: true },
        },
        part('rc-r', 'resistor', 1000),
        {
          ...part('cap', 'visual', 100, 'electrolytic-capacitor'),
          pinIds: ['positive', 'negative'],
          stateProperties: { initialVoltageVolt: 0, voltageRatingVolt: 25 },
        },
        part('led-r', 'resistor', 10),
        { ...part('led', 'led', 0.02), stateProperties: { color: 'red' } },
        { ...part('motor', 'visual', 6, 'dc-motor'), pinIds: ['positive', 'negative'] },
        {
          ...part('uno', 'visual', 5, 'arduino-uno'),
          pinIds: ['d13', 'power-gnd-1', 'power-5v', 'power-3v3'],
          stateProperties: {
            arduinoSource:
              'int cycles=0;void setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}void loop(){cycles++;delay(1);}',
          },
        },
      ],
      connections: [
        ['supply', 'positive', 'rc-r', 'a'],
        ['rc-r', 'b', 'cap', 'positive'],
        ['cap', 'negative', 'supply', 'negative'],
        ['supply', 'positive', 'led-r', 'a'],
        ['led-r', 'b', 'led', 'anode'],
        ['led', 'cathode', 'supply', 'negative'],
        ['supply', 'positive', 'motor', 'positive'],
        ['motor', 'negative', 'supply', 'negative'],
      ].map(([from, a, to, b], index) => ({
        id: `w${index}`,
        from: { componentId: from!, terminal: a! },
        to: { componentId: to!, terminal: b! },
      })),
      viewport: { x: 0, y: 0, zoom: 1 },
      simulation: { running: true, maxIterations: 24 },
    };
    const progressed = advanceElectronicsToHorizon(base, {
      state: resetElectronicsTimedState(),
      requestedHorizonMicroseconds: 20_000,
    });
    expect(progressed.diagnostics).toEqual([]);
    expect(progressed.executionStatus).toBe('ready');
    expect(progressed.observation?.solved).toBe(true);
    const serialized = JSON.parse(progressed.state.continuation!.serializedState);
    expect(serialized.physicalState).toBeDefined();
    expect(serialized.boards[0].runtime).toBeDefined();
    expect(serialized.physicalState.capacitors).toHaveLength(1);
    expect(serialized.physicalState.thermal.length).toBeGreaterThan(0);
    expect(serialized.physicalState.motors[0].motorAngularVelocityRadPerSecond).toBeGreaterThan(0);
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', base, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);
    controller.update(base, 20_000);
    executor.advances
      .at(-1)!
      .deferred.resolve({ ...timedAdvance('ready', 20_000, 20_000), state: progressed.state });
    await flush();
    const changed = {
      ...base,
      components: base.components.map((component) =>
        component.id === 'supply'
          ? {
              ...component,
              value: 7.5,
              stateProperties: {
                ...component.stateProperties,
                voltageSetpointVolt: 7.5,
                currentLimitAmp: 0.15,
              },
            }
          : component,
      ),
    };
    controller.update(changed, 20_000);
    expect(executor.generation).toBe(1);
    const next = executor.advances.at(-1)!;
    expect(next.state).toBe(progressed.state);
    expect(next.state.continuation!.serializedState).toBe(
      progressed.state.continuation!.serializedState,
    );
    expect(next.inputEvents).toEqual([
      {
        atMicroseconds: 20_001,
        targetId: 'supply',
        operation: 'voltageSetpointVolt',
        payload: 7.5,
      },
      { atMicroseconds: 20_001, targetId: 'supply', operation: 'currentLimitAmp', payload: 0.15 },
    ]);
    const continued = advanceElectronicsToHorizon(next.document, {
      state: next.state,
      requestedHorizonMicroseconds: 21_000,
      inputEvents: next.inputEvents,
    });
    expect(continued.executionStatus).toBe('ready');
    expect(continued.observation?.solved).toBe(true);
    const after = JSON.parse(continued.state.continuation!.serializedState);
    expect(after.boards[0].runtime).not.toEqual(
      JSON.parse(
        advanceElectronicsToHorizon(base, {
          state: resetElectronicsTimedState(),
          requestedHorizonMicroseconds: 0,
        }).state.continuation!.serializedState,
      ).boards[0].runtime,
    );
    expect(after.physicalState.simulationTimeMs).toBeGreaterThan(
      serialized.physicalState.simulationTimeMs,
    );
    expect(after.physicalState.motors[0].simulationTimeSeconds).toBeGreaterThan(
      serialized.physicalState.motors[0].simulationTimeSeconds,
    );
    expect(after.physicalState.capacitors[0].voltageVolt).toBeGreaterThan(0);
    for (const beforeThermal of serialized.physicalState.thermal) {
      const nextThermal = after.physicalState.thermal.find(
        (entry: { componentId: string }) => entry.componentId === beforeThermal.componentId,
      );
      expect(nextThermal.accumulatedDamage).toBeGreaterThanOrEqual(beforeThermal.accumulatedDamage);
      expect(nextThermal.temperatureCelsius).toBeGreaterThanOrEqual(
        beforeThermal.temperatureCelsius,
      );
    }
    controller.stop();
    controller.start('project-a', changed, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 2);
    const reset = executor.advances.find((call) => call.generationId === 2)!;
    expect(reset.requestedHorizonMicroseconds).toBe(0);
    expect(reset.state).toEqual(resetElectronicsTimedState());
    expect(reset.document.components.find((component) => component.id === 'supply')!.value).toBe(
      7.5,
    );
    controller.dispose();
  });

  it('sends live meter modes through one progressed canonical generation', async () => {
    const executor = new FakeExecutor();
    const meterCircuit: SchematicDocument = {
      ...circuit,
      components: [
        ...circuit.components,
        {
          id: 'meter',
          kind: 'visual',
          value: 0,
          position: { x: 100, y: 0 },
          componentTypeId: 'multimeter',
          pinIds: ['com', 'v-ohm-ma'],
          stateProperties: { measurementMode: 'dc-voltage' },
        },
      ],
    };
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', meterCircuit, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);
    controller.update(meterCircuit, 20_000);
    executor.advances.at(-1)!.deferred.resolve(timedAdvance('ready', 20_000, 20_000));
    await flush();
    const changed: SchematicDocument = {
      ...meterCircuit,
      components: meterCircuit.components.map((component) =>
        component.id === 'meter'
          ? {
              ...component,
              stateProperties: { ...component.stateProperties, measurementMode: 'dc-current' },
            }
          : component,
      ),
    };
    controller.update(changed, 20_000);
    expect(executor.generation).toBe(1);
    expect(executor.preflights).toHaveLength(1);
    expect(executor.advances.at(-1)).toMatchObject({
      state: timedState(20_000),
      inputEvents: [
        {
          atMicroseconds: 20_001,
          targetId: 'meter',
          operation: 'measurementMode',
          payload: 'dc-current',
        },
      ],
    });
    expect(
      executor.advances.at(-1)!.document.components.find((component) => component.id === 'meter')
        ?.stateProperties?.measurementMode,
    ).toBe('dc-voltage');
  });

  it('updates scope observations without replacing the canonical generation', async () => {
    const executor = new FakeExecutor();
    const scopeCircuit: SchematicDocument = {
      ...circuit,
      components: [
        ...circuit.components,
        {
          id: 'scope',
          kind: 'visual',
          value: 1,
          position: { x: 100, y: 0 },
          componentTypeId: 'oscilloscope',
          pinIds: ['signal', 'ground'],
          stateProperties: {
            voltsPerDivision: 1,
            timePerDivisionMs: 1,
            triggerLevelVolt: 0,
            displayEnabled: true,
          },
        },
      ],
    };
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', scopeCircuit, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);
    const changed: SchematicDocument = {
      ...scopeCircuit,
      components: scopeCircuit.components.map((component) =>
        component.id === 'scope'
          ? {
              ...component,
              stateProperties: {
                ...component.stateProperties,
                voltsPerDivision: 2,
                timePerDivisionMs: 5,
                triggerLevelVolt: 1,
                displayEnabled: false,
              },
            }
          : component,
      ),
    };
    controller.update(changed, 0);
    expect(executor.generation).toBe(1);
    expect(
      executor.advances
        .at(-1)!
        .inputEvents.map(({ operation, payload }) => ({ operation, payload })),
    ).toEqual([
      { operation: 'voltsPerDivision', payload: 2 },
      { operation: 'timePerDivisionMs', payload: 5 },
      { operation: 'triggerLevelVolt', payload: 1 },
      { operation: 'displayEnabled', payload: false },
    ]);
  });

  it('applies generator settings as ordered timed inputs while retaining the initial document', async () => {
    const executor = new FakeExecutor();
    const generatorCircuit: SchematicDocument = {
      ...circuit,
      components: [
        ...circuit.components,
        {
          id: 'generator',
          kind: 'source',
          value: 1_000,
          position: { x: 100, y: 0 },
          componentTypeId: 'signal-generator',
          pinIds: ['signal', 'ground'],
          stateProperties: {
            waveform: 'sine',
            frequencyHz: 1_000,
            amplitudeVpp: 5,
            dcOffsetVolt: 0,
            outputEnabled: true,
          },
        },
      ],
    };
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', generatorCircuit, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);
    const changed: SchematicDocument = {
      ...generatorCircuit,
      components: generatorCircuit.components.map((component) =>
        component.id === 'generator'
          ? {
              ...component,
              stateProperties: {
                ...component.stateProperties,
                waveform: 'square',
                frequencyHz: 500,
                amplitudeVpp: 2,
                dcOffsetVolt: 1,
                outputEnabled: false,
              },
            }
          : component,
      ),
    };
    controller.update(changed, 0);
    expect(executor.generation).toBe(1);
    expect(
      executor.advances
        .at(-1)!
        .inputEvents.map(({ operation, payload }) => ({ operation, payload })),
    ).toEqual([
      { operation: 'waveform', payload: 'square' },
      { operation: 'frequencyHz', payload: 500 },
      { operation: 'amplitudeVpp', payload: 2 },
      { operation: 'dcOffsetVolt', payload: 1 },
      { operation: 'outputEnabled', payload: false },
    ]);
    expect(
      executor.advances
        .at(-1)!
        .document.components.find((component) => component.id === 'generator')?.stateProperties
        ?.frequencyHz,
    ).toBe(1_000);
  });

  it('routes Serial RX through the canonical pending input queue in accepted order', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', serialCircuit, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);

    controller.sendSerialRx('uno', 'A', 0);
    expect(executor.advances[1]!.inputEvents).toEqual([
      { atMicroseconds: 1, targetId: 'uno', operation: 'serialRx', payload: 'A' },
    ]);
    controller.sendSerialRx('uno', 'B', 0);
    expect(executor.advances).toHaveLength(2);

    executor.advances[1]!.deferred.resolve(timedAdvance('ready', 1, 1, 2));
    await flush();
    expect(executor.advances[2]!.inputEvents).toEqual([
      { atMicroseconds: 2, targetId: 'uno', operation: 'serialRx', payload: 'B' },
    ]);
  });

  it('clears Serial projection when a new generation starts', async () => {
    const executor = new FakeExecutor();
    const onSerialProjection = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', serialCircuit, {
      onResult: vi.fn(),
      onSerialProjection,
      onFailure: vi.fn(),
    });
    await completeCanonicalStart(executor, 1);
    onSerialProjection.mockClear();

    controller.restart(serialCircuit);

    expect(onSerialProjection).toHaveBeenCalledTimes(1);
    expect(onSerialProjection).toHaveBeenCalledWith([]);
  });

  it('publishes Serial projection from yielded canonical work', async () => {
    const executor = new FakeExecutor();
    const onSerialProjection = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', serialCircuit, {
      onResult: vi.fn(),
      onSerialProjection,
      onFailure: vi.fn(),
    });
    await completeCanonicalStart(executor, 1);
    onSerialProjection.mockClear();

    controller.update(serialCircuit, 100);
    executor.advances[1]!.deferred.resolve({
      ...timedAdvance('yielded', 100, 50),
      serial: [
        {
          componentId: 'uno',
          begun: true,
          baudRate: 9600,
          tx: [{ sequence: 0, atMicroseconds: 4, text: 'one\n' }],
          rxPendingBytes: 0,
        },
      ],
    });
    await flush();

    expect(onSerialProjection).toHaveBeenCalledWith([
      expect.objectContaining({
        componentId: 'uno',
        begun: true,
        baudRate: 9600,
        tx: [{ sequence: 0, atMicroseconds: 4, text: 'one\n' }],
      }),
    ]);
  });

  it('resumes yielded canonical work without publishing a partial horizon', async () => {
    const executor = new FakeExecutor();
    const onResult = vi.fn();
    const onCommittedHorizon = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, {
      onResult,
      onFailure: vi.fn(),
      onCommittedHorizon,
    });
    await completeCanonicalStart(executor, 1);
    onResult.mockClear();
    onCommittedHorizon.mockClear();

    controller.update(circuit, 75_000);
    expect(executor.advances[1]!.requestedHorizonMicroseconds).toBe(25_000);
    executor.advances[1]!.deferred.resolve(timedAdvance('yielded', 25_000, 256));
    await flush();
    expect(onResult).not.toHaveBeenCalled();
    expect(onCommittedHorizon).not.toHaveBeenCalled();
    expect(executor.advances).toHaveLength(3);
    expect(executor.advances[2]).toMatchObject({ requestedHorizonMicroseconds: 256 });
    expect(executor.advances[2]!.state.continuation?.committedHorizonMicroseconds).toBe(256);

    executor.advances[2]!.deferred.resolve(timedAdvance('ready', 256, 256, 3));
    await flush();
    expect(onResult).toHaveBeenCalledWith(result(3), undefined, 'dc-inputs-v1');
    expect(onCommittedHorizon).toHaveBeenCalledWith(256);
    expect(executor.advances[3]!.requestedHorizonMicroseconds).toBe(512);
  });

  it('timestamps live inputs immediately after committed canonical time, not host wall time', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);

    controller.update(circuit, 25_000);
    executor.advances[1]!.deferred.resolve(timedAdvance('ready', 25_000, 25_000, 2));
    await flush();

    const pressed = {
      ...circuit,
      components: circuit.components.map((component) =>
        component.id === 'button' ? { ...component, state: true } : component,
      ),
    };
    controller.update(pressed, 250_000);
    expect(executor.advances[2]!.inputEvents).toEqual([
      { atMicroseconds: 25_001, targetId: 'button', operation: 'state', payload: true },
    ]);
    expect(executor.advances[2]).toMatchObject({ requestedHorizonMicroseconds: 50_000 });
    executor.advances[2]!.deferred.resolve(timedAdvance('ready', 50_000, 50_000, 3));
    await flush();
    expect(executor.advances[3]).toMatchObject({ requestedHorizonMicroseconds: 75_000 });
    executor.advances[3]!.deferred.resolve(timedAdvance('ready', 75_000, 75_000));
    await flush();
    expect(executor.advances[4]).toMatchObject({ requestedHorizonMicroseconds: 100_000 });
  });

  it('publishes repeated complete catch-up windows while retaining growing host demand', async () => {
    const executor = new FakeExecutor();
    const onResult = vi.fn();
    const onCommittedHorizon = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult, onCommittedHorizon, onFailure: vi.fn() });
    controller.update(circuit, 5_000_000);
    await completeCanonicalStart(executor, 1);
    expect(onCommittedHorizon.mock.calls).toEqual([[0]]);

    let committed = 0;
    let window = 25_000;
    for (let completed = 0; completed < 3; completed++) {
      const horizon = committed + window;
      const reached = committed + window / 2;
      const chunk = executor.advances.at(-1)!;
      expect(chunk.requestedHorizonMicroseconds).toBe(horizon);
      expect(chunk.state).toEqual(timedState(committed));
      controller.update(circuit, 7_500_000 + completed * 2_500_000);
      chunk.deferred.resolve(timedAdvance('yielded', horizon, reached));
      await flush();
      expect(onResult).toHaveBeenCalledTimes(completed + 1);
      expect(onCommittedHorizon).toHaveBeenCalledTimes(completed + 1);
      const continuation = executor.advances.at(-1)!;
      expect(continuation.requestedHorizonMicroseconds).toBe(reached);
      expect(continuation.state).toEqual(timedState(reached));
      continuation.deferred.resolve(timedAdvance('ready', reached, reached, completed + 2));
      await flush();
      expect(onCommittedHorizon).toHaveBeenLastCalledWith(reached);
      expect(onResult).toHaveBeenLastCalledWith(result(completed + 2), undefined, 'dc-inputs-v1');
      committed = reached;
      window /= 2;
    }
    expect(executor.advances.at(-1)!.requestedHorizonMicroseconds).toBe(25_000);
    controller.stop();
    executor.advances.at(-1)!.deferred.resolve(timedAdvance('ready', 25_000, 25_000, 99));
    await flush();
    expect(onResult).toHaveBeenCalledTimes(4);
  });

  it('drains the retained final host horizon without another host update', async () => {
    const executor = new FakeExecutor();
    const onCommittedHorizon = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, {
      onResult: vi.fn(),
      onCommittedHorizon,
      onFailure: vi.fn(),
    });
    await completeCanonicalStart(executor, 1);
    controller.update(circuit, 300_000);
    const horizons = Array.from({ length: 12 }, (_, index) => (index + 1) * 25_000);
    for (const horizon of horizons) {
      expect(executor.advances.at(-1)!.requestedHorizonMicroseconds).toBe(horizon);
      executor.advances.at(-1)!.deferred.resolve(timedAdvance('ready', horizon, horizon));
      await flush();
    }
    expect(onCommittedHorizon.mock.calls).toEqual([[0], ...horizons.map((horizon) => [horizon])]);
    expect(executor.advances).toHaveLength(13);
  });

  it('observes a yielded checkpoint before draining retained newer host horizons', async () => {
    const executor = new FakeExecutor();
    const onResult = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult, onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);
    onResult.mockClear();

    controller.update(circuit, 75_000);
    controller.update(circuit, 125_000);
    executor.advances[1]!.deferred.resolve(timedAdvance('yielded', 25_000, 15_000));
    await flush();

    expect(executor.advances).toHaveLength(3);
    expect(executor.advances[2]).toMatchObject({ requestedHorizonMicroseconds: 15_000 });
    executor.advances[2]!.deferred.resolve(timedAdvance('ready', 15_000, 15_000, 3));
    await flush();

    expect(onResult).toHaveBeenCalledWith(result(3), undefined, 'dc-inputs-v1');
    expect(executor.advances).toHaveLength(4);
    expect(executor.advances[3]).toMatchObject({ requestedHorizonMicroseconds: 30_000 });
  });

  it('keeps real input transitions and forward progress when bounded host demand trails an input commit', async () => {
    const base: SchematicDocument = {
      ...circuit,
      components: [
        circuit.components[0]!,
        circuit.components[1]!,
        { id: 'button', kind: 'button', value: 1, position: { x: 40, y: 0 }, state: false },
        { id: 'switched', kind: 'resistor', value: 1000, position: { x: 60, y: 0 } },
      ],
      connections: [
        ['source', 'a', 'resistor', 'a'],
        ['resistor', 'b', 'source', 'b'],
        ['source', 'a', 'button', 'a'],
        ['button', 'b', 'switched', 'a'],
        ['switched', 'b', 'source', 'b'],
      ].map(([from, a, to, b], index) => ({
        id: `bounded-${index}`,
        from: { componentId: from!, terminal: a! },
        to: { componentId: to!, terminal: b! },
      })),
    };
    const executor = new FakeExecutor();
    const onFailure = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    const requestBase = {
      protocolVersion: ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
      engineRevision: ELECTRONICS_SIMULATION_ENGINE_REVISION,
      requestId: 'bounded-host-preflight',
      generationId: 1,
      projectSessionId: 'bounded-host-input',
    };
    const complete = async (call: AdvanceCall) => {
      const response = await evaluateSimulationWorkerRequestBatched(
        {
          ...requestBase,
          kind: 'advance',
          requestId: `bounded-host-${executor.advances.length}`,
          generationId: call.generationId,
          document: call.document,
          state: call.state,
          requestedHorizonMicroseconds: call.requestedHorizonMicroseconds,
          inputEvents: call.inputEvents,
        },
        () => true,
      );
      expect(response?.ok, JSON.stringify(response)).toBe(true);
      if (!response || !response.ok || response.kind !== 'advance')
        throw new Error('Expected real advance');
      expect(response.advance.executionStatus, JSON.stringify(response.advance.diagnostics)).toBe(
        'ready',
      );
      expect(response.advance.result?.solved).toBe(true);
      expect(response.advance.result?.quality?.passed).toBe(true);
      call.deferred.resolve(response.advance);
      await flush();
      return response.advance;
    };
    try {
      controller.start(requestBase.projectSessionId, base, { onResult: vi.fn(), onFailure });
      const preflight = evaluateSimulationWorkerRequest({
        ...requestBase,
        kind: 'preflight',
        document: base,
      });
      if (!preflight.ok || preflight.kind !== 'preflight')
        throw new Error('Expected real preflight');
      executor.preflights[0]!.resolve(preflight.result);
      await flush();
      await complete(executor.advances.at(-1)!);
      controller.update(base, 25_000);
      await complete(executor.advances.at(-1)!);
      const pressed: SchematicDocument = {
        ...base,
        components: base.components.map((component) =>
          component.id === 'button' ? { ...component, state: true } : component,
        ),
      };
      controller.update(pressed, 25_000);
      const input = executor.advances.at(-1)!;
      expect(input.inputEvents).toEqual([
        { atMicroseconds: 25_001, targetId: 'button', operation: 'state', payload: true },
      ]);
      const closed = await complete(input);
      expect(closed.committedHorizonMicroseconds).toBe(25_001);
      expect(
        closed.result?.components.find((component) => component.componentId === 'switched')
          ?.current,
      ).toBeGreaterThan(0.0049);

      controller.update(pressed, 25_000);
      const count = executor.advances.length;
      expect(count).toBe(3);
      // Holding the same input and an older host cursor needs no Worker call.
      controller.update(base, 25_000);
      const released = executor.advances.at(-1)!;
      controller.update(base, 50_000);
      expect(executor.advances).toHaveLength(count + 1);
      expect(released.state).toBe(closed.state);
      expect(released.inputEvents).toEqual([
        { atMicroseconds: 25_002, targetId: 'button', operation: 'state', payload: false },
      ]);
      const opened = await complete(released);
      expect(
        opened.result?.components.find((component) => component.componentId === 'switched')
          ?.current,
      ).toBeCloseTo(0, 9);
      const continued = await complete(executor.advances.at(-1)!);
      expect(continued.committedHorizonMicroseconds).toBe(50_000);
      expect(
        continued.result?.components.find((component) => component.componentId === 'switched')
          ?.current,
      ).toBeCloseTo(0, 9);
      const canonical = JSON.parse(continued.state.continuation!.serializedState);
      expect(canonical.inputs).toEqual([
        { atMicroseconds: 25_001, componentId: 'button', property: 'state', value: true },
        { atMicroseconds: 25_002, componentId: 'button', property: 'state', value: false },
      ]);
      expect(canonical.nextInputIndex).toBe(2);
      expect(executor.generation).toBe(1);
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      controller.dispose();
    }
  });

  it('retimes unsent input events beyond progress committed by an in-flight advance', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);

    controller.update(circuit, 75_000);
    const pressed = {
      ...circuit,
      components: circuit.components.map((component) =>
        component.id === 'button' ? { ...component, state: true } : component,
      ),
    };
    controller.update(pressed, 25_000);

    executor.advances[1]!.deferred.resolve(timedAdvance('yielded', 25_000, 15_000));
    await flush();

    expect(executor.advances).toHaveLength(3);
    expect(executor.advances[2]).toMatchObject({ requestedHorizonMicroseconds: 30_000 });
    expect(executor.advances[2]!.state.continuation?.committedHorizonMicroseconds).toBe(15_000);
    expect(executor.advances[2]!.inputEvents).toEqual([
      { atMicroseconds: 15_001, targetId: 'button', operation: 'state', payload: true },
    ]);
    executor.advances[2]!.deferred.resolve(timedAdvance('ready', 30_000, 30_000, 3));
    await flush();
    expect(executor.advances).toHaveLength(4);
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

    controller.update(twoButtons, 75_000);
    const bothPressed: SchematicDocument = {
      ...twoButtons,
      components: twoButtons.components.map((component) =>
        component.id === 'button' || component.id === 'button-2'
          ? { ...component, state: true }
          : component,
      ),
    };
    controller.update(bothPressed, 25_000);
    const firstReleased: SchematicDocument = {
      ...bothPressed,
      components: bothPressed.components.map((component) =>
        component.id === 'button' ? { ...component, state: false } : component,
      ),
    };
    controller.update(firstReleased, 25_000);

    executor.advances[1]!.deferred.resolve(timedAdvance('yielded', 25_000, 15_000));
    await flush();

    expect(executor.advances).toHaveLength(3);
    expect(executor.advances[2]!.inputEvents).toEqual([
      { atMicroseconds: 15_001, targetId: 'button', operation: 'state', payload: true },
      { atMicroseconds: 15_001, targetId: 'button-2', operation: 'state', payload: true },
      { atMicroseconds: 15_002, targetId: 'button', operation: 'state', payload: false },
    ]);
    expect(executor.advances[2]!.inputEvents[0]!.atMicroseconds).toBe(
      executor.advances[2]!.inputEvents[1]!.atMicroseconds,
    );
    expect(
      executor.advances[2]!.inputEvents[2]!.atMicroseconds -
        executor.advances[2]!.inputEvents[1]!.atMicroseconds,
    ).toBe(1);
    expect(executor.advances[2]!.inputEvents.every((event) => event.atMicroseconds > 15_000)).toBe(
      true,
    );
  });

  it('coalesces newer horizons while an advance is in flight', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);

    controller.update(circuit, 25_000);
    controller.update(circuit, 50_000);
    controller.update(circuit, 100_000);
    expect(executor.advances).toHaveLength(2);

    executor.advances[1]!.deferred.resolve(timedAdvance('ready', 25_000, 25_000, 2));
    await flush();
    expect(executor.advances).toHaveLength(3);
    expect(executor.advances[2]).toMatchObject({ requestedHorizonMicroseconds: 50_000 });
    expect(executor.advances[2]!.state.continuation?.committedHorizonMicroseconds).toBe(25_000);
  });

  it('refreshes classroom demand after an acknowledged cursor advances between tick and dispatch', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    let elapsedWallMicroseconds = 0;
    let presentedMicroseconds = 0;
    const readHostHorizonMicroseconds = vi.fn(() =>
      classroomRequestedHorizon(0, elapsedWallMicroseconds, presentedMicroseconds),
    );
    controller.start('project-a', circuit, {
      onResult: vi.fn(),
      onFailure: vi.fn(),
      readHostHorizonMicroseconds,
    });
    await completeCanonicalStart(executor, 1);
    expect(readHostHorizonMicroseconds).toHaveBeenCalledTimes(2);
    readHostHorizonMicroseconds.mockClear();
    elapsedWallMicroseconds = 80_000;

    controller.update(circuit, 25_000);
    expect(executor.advances[1]!.requestedHorizonMicroseconds).toBe(1_000);
    elapsedWallMicroseconds = 96_000;
    presentedMicroseconds = 2_000;
    controller.update(circuit, 8_250);
    expect(executor.advances).toHaveLength(2);
    // The host fixture now represents an acknowledged cursor. Native leases
    // and ACK are covered by the mounted/browser tests; no host tick is sent.
    elapsedWallMicroseconds = 112_000;
    presentedMicroseconds = 4_000;
    executor.advances[1]!.deferred.resolve(timedAdvance('ready', 1_000, 1_000));
    await flush();
    expect(executor.advances).toHaveLength(3);
    expect(executor.advances[2]!.requestedHorizonMicroseconds).toBe(26_000);
    expect(executor.advances[2]!.requestedHorizonMicroseconds - presentedMicroseconds).toBe(22_000);
    expect(executor.advances[2]!.state.continuation?.committedHorizonMicroseconds).toBe(1_000);

    // A long native/RAF hold supplies no new acknowledgement. Fresh wall time
    // cannot expand the cap or dispatch a second request alongside the first.
    elapsedWallMicroseconds = 1_000_000;
    controller.update(circuit, 54_000);
    expect(executor.advances).toHaveLength(3);
    executor.advances[2]!.deferred.resolve(timedAdvance('ready', 26_000, 26_000));
    await flush();
    expect(executor.advances[3]!.requestedHorizonMicroseconds).toBe(51_000);
    executor.advances[3]!.deferred.resolve(timedAdvance('ready', 51_000, 51_000));
    await flush();
    expect(executor.advances[4]!.requestedHorizonMicroseconds).toBe(54_000);
    executor.advances[4]!.deferred.resolve(timedAdvance('ready', 54_000, 54_000));
    await flush();
    expect(executor.advances).toHaveLength(5);
    expect(readHostHorizonMicroseconds).toHaveBeenCalledTimes(4);
    controller.stop();
  });

  it('retains refreshed host demand through the unchanged 25ms observation ceiling', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    let host = 0;
    controller.start('project-a', circuit, {
      onResult: vi.fn(),
      onFailure: vi.fn(),
      readHostHorizonMicroseconds: () => host,
    });
    await completeCanonicalStart(executor, 1);
    host = 75_000;
    controller.update(circuit, 1_000);
    for (const horizon of [1_000, 26_000, 51_000, 75_000]) {
      const request = executor.advances.at(-1)!;
      expect(request.requestedHorizonMicroseconds).toBe(horizon);
      expect(horizon - (request.state.continuation?.committedHorizonMicroseconds ?? 0)).toBe(
        horizon === 1_000
          ? 1_000
          : Math.min(
              25_000,
              75_000 - (request.state.continuation?.committedHorizonMicroseconds ?? 0),
            ),
      );
      request.deferred.resolve(timedAdvance('ready', horizon, horizon));
      await flush();
    }
    expect(executor.advances).toHaveLength(5);
    controller.stop();
  });

  it('leaves startup, yielded checkpoint observations and timed inputs independent of fresh host reads', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    let hostHorizon: number | null = 0;
    const readHostHorizonMicroseconds = vi.fn(() => hostHorizon);
    controller.start('project-a', circuit, {
      onResult: vi.fn(),
      onFailure: vi.fn(),
      readHostHorizonMicroseconds,
    });
    await completeCanonicalStart(executor, 1);
    expect(readHostHorizonMicroseconds).toHaveBeenCalledTimes(2);
    hostHorizon = 6_250;
    controller.update(circuit, 6_250);
    readHostHorizonMicroseconds.mockClear();
    hostHorizon = null;
    executor.advances[1]!.deferred.resolve(timedAdvance('yielded', 6_250, 2_000));
    await flush();
    expect(executor.advances.at(-1)!.requestedHorizonMicroseconds).toBe(2_000);
    expect(readHostHorizonMicroseconds).not.toHaveBeenCalled();

    const pressed: SchematicDocument = {
      ...circuit,
      components: circuit.components.map((component) =>
        component.id === 'button' ? { ...component, state: true } : component,
      ),
    };
    controller.update(pressed, 2_000);
    executor.advances[2]!.deferred.resolve(timedAdvance('ready', 2_000, 2_000));
    await flush();
    const input = executor.advances[3]!;
    expect(input.requestedHorizonMicroseconds).toBe(2_001);
    expect(input.inputEvents).toEqual([
      { atMicroseconds: 2_001, targetId: 'button', operation: 'state', payload: true },
    ]);
    expect(readHostHorizonMicroseconds).not.toHaveBeenCalled();
    input.deferred.resolve(timedAdvance('ready', 2_001, 2_001));
    await flush();
    expect(executor.advances).toHaveLength(4);
    expect(readHostHorizonMicroseconds).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  it.each(['stop', 'restart'] as const)(
    'rejects a captured fresh horizon if its generation changes through %s before dispatch',
    async (action) => {
      const executor = new FakeExecutor();
      const controller = new ElectronicsLiveSimulationWorkerController(executor);
      let replaceGeneration = false;
      let host = 0;
      controller.start('project-a', circuit, {
        onResult: vi.fn(),
        onFailure: vi.fn(),
        readHostHorizonMicroseconds: () => {
          if (replaceGeneration) {
            if (action === 'stop') controller.stop();
            else controller.restart(circuit);
          }
          return host;
        },
      });
      await completeCanonicalStart(executor, 1);
      host = 10_250;
      controller.update(circuit, 6_250);
      controller.update(circuit, 12_250);
      replaceGeneration = true;
      const requested = executor.advances[1]!.requestedHorizonMicroseconds;
      executor.advances[1]!.deferred.resolve(timedAdvance('ready', requested, requested));
      await flush();
      expect(executor.advances).toHaveLength(2);
      if (action === 'restart') {
        replaceGeneration = false;
        host = 0;
        await completeCanonicalStart(executor, 2);
        expect(executor.advances).toHaveLength(3);
        expect(executor.advances[2]!.generationId).toBe(2);
        expect(executor.advances[2]!.requestedHorizonMicroseconds).toBe(0);
      }
      controller.stop();
    },
  );

  it('normalizes a fresh host horizon against the current structural generation offset', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    let hostHorizon = 0;
    controller.start('project-a', circuit, {
      onResult: vi.fn(),
      onFailure: vi.fn(),
      readHostHorizonMicroseconds: () => hostHorizon,
    });
    await completeCanonicalStart(executor, 1);
    const changed: SchematicDocument = {
      ...circuit,
      components: circuit.components.map((component) =>
        component.id === 'resistor' ? { ...component, value: 2_000 } : component,
      ),
    };
    controller.update(changed, 1_000_000);
    await completeCanonicalStart(executor, 2);
    hostHorizon = 1_006_250;
    controller.update(changed, 1_003_000);
    expect(executor.advances.at(-1)!.generationId).toBe(2);
    expect(executor.advances.at(-1)!.requestedHorizonMicroseconds).toBe(1_000);
    executor.advances.at(-1)!.deferred.resolve(timedAdvance('ready', 1_000, 1_000));
    await flush();
    expect(executor.advances.at(-1)!.requestedHorizonMicroseconds).toBe(6_250);
    expect(
      executor.advances.at(-1)!.document.components.find((item) => item.id === 'resistor')?.value,
    ).toBe(2_000);
    controller.stop();
  });

  it('restarts the active canonical generation from time zero', async () => {
    const executor = new FakeExecutor();
    const onResult = vi.fn();
    const onGenerationPending = vi.fn();
    const onCommittedHorizon = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, {
      onResult,
      onGenerationPending,
      onCommittedHorizon,
      onFailure: vi.fn(),
    });
    await completeCanonicalStart(executor, 1);
    controller.update(circuit, 25_000);
    executor.advances[1]!.deferred.resolve(timedAdvance('ready', 25_000, 25_000, 2));
    await flush();
    expect(onCommittedHorizon).toHaveBeenLastCalledWith(25_000);
    onResult.mockClear();

    controller.update(circuit, 75_000);
    const oldAdvance = executor.advances[2]!;
    controller.restart(circuit);

    expect(executor.generation).toBe(2);
    expect(executor.preflights).toHaveLength(2);
    expect(onGenerationPending).toHaveBeenCalledTimes(2);
    expect(onCommittedHorizon).toHaveBeenLastCalledWith(25_000);

    oldAdvance.deferred.resolve(timedAdvance('ready', 50_000, 50_000, 9));
    await flush();
    expect(onResult).not.toHaveBeenCalled();
    expect(onCommittedHorizon).toHaveBeenLastCalledWith(25_000);

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
    expect(onResult).toHaveBeenCalledWith(result(2), undefined, undefined);
    expect(onCommittedHorizon).toHaveBeenLastCalledWith(0);

    controller.update(circuit, 50_000);
    expect(executor.advances.at(-1)).toMatchObject({
      generationId: 2,
      requestedHorizonMicroseconds: 25_000,
      state: resetElectronicsTimedState(),
    });
  });

  it('keeps one canonical generation across Arduino source-only edits', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    const sourceA = 'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);}';
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
    controller.update(edited, 25_000);

    expect(executor.generation).toBe(1);
    expect(executor.preflights).toHaveLength(1);
    expect(executor.advances.at(-1)?.generationId).toBe(1);
    expect(
      executor.advances.at(-1)?.document.components.find((component) => component.id === 'uno')
        ?.stateProperties?.arduinoSource,
    ).toBe(sourceB);
  });

  it('starts a fresh zero-based canonical generation for structural runtime changes', async () => {
    const executor = new FakeExecutor();
    const onCommittedHorizon = vi.fn();
    const onGenerationPending = vi.fn();
    const onInitialReady = vi.fn();
    const onResult = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, {
      onResult,
      onFailure: vi.fn(),
      onCommittedHorizon,
      onGenerationPending,
      onInitialReady,
    });
    await completeCanonicalStart(executor, 1);
    controller.update(circuit, 25_000);
    executor.advances.at(-1)!.deferred.resolve(timedAdvance('ready', 25_000, 25_000, 2));
    await flush();
    expect(onCommittedHorizon).toHaveBeenLastCalledWith(25_000);
    controller.update(circuit, 100_000);
    const oldPendingAdvance = executor.advances.at(-1)!;

    const changed = {
      ...circuit,
      components: circuit.components.map((component) =>
        component.id === 'resistor' ? { ...component, value: 470 } : component,
      ),
    };
    controller.update(changed, 125_000);
    expect(executor.generation).toBe(2);
    expect(executor.preflights).toHaveLength(2);
    expect(onGenerationPending).toHaveBeenCalledTimes(2);
    expect(onCommittedHorizon).toHaveBeenLastCalledWith(25_000);
    const resultCount = onResult.mock.calls.length;
    const confirmedCount = onCommittedHorizon.mock.calls.length;
    oldPendingAdvance.deferred.resolve(timedAdvance('ready', 50_000, 50_000, 999));
    await flush();
    expect(onResult).toHaveBeenCalledTimes(resultCount);
    expect(onCommittedHorizon).toHaveBeenCalledTimes(confirmedCount);
    await completeCanonicalStart(executor, 2, 2);
    expect(onCommittedHorizon).toHaveBeenLastCalledWith(0);
    expect(onInitialReady.mock.calls).toEqual([[0], [125_000]]);

    controller.update(changed, 150_000);
    expect(executor.advances.at(-1)).toMatchObject({ requestedHorizonMicroseconds: 25_000 });
    executor.advances.at(-1)!.deferred.resolve(timedAdvance('ready', 25_000, 25_000, 3));
    await flush();
    expect(onCommittedHorizon).toHaveBeenLastCalledWith(25_000);
  });

  it('keeps the canonical generation across presentation-only viewport changes', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult: vi.fn(), onFailure: vi.fn() });
    await completeCanonicalStart(executor, 1);

    const panned = { ...circuit, viewport: { x: 120, y: -40, zoom: 1.75 } };
    controller.update(panned, 25_000);

    expect(executor.generation).toBe(1);
    expect(executor.preflights).toHaveLength(1);
    expect(executor.advances.at(-1)).toMatchObject({ requestedHorizonMicroseconds: 25_000 });
  });
  it('fails closed on a canonical fault and ignores future updates', async () => {
    const executor = new FakeExecutor();
    const onFailure = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult: vi.fn(), onFailure });
    await completeCanonicalStart(executor, 1);

    controller.update(circuit, 25_000);
    executor.advances[1]!.deferred.resolve(timedAdvance('fault', 25_000, 0));
    await flush();
    expect(onFailure).toHaveBeenCalledOnce();
    expect(executor.cancelCount).toBe(1);

    controller.update(circuit, 50_000);
    expect(executor.advances).toHaveLength(2);
  });

  it.each(['unsupported', 'nonconvergent'] as const)(
    'preserves a %s preflight result instead of reporting a Worker failure',
    async (status) => {
      const executor = new FakeExecutor();
      const onFailure = vi.fn();
      const controller = new ElectronicsLiveSimulationWorkerController(executor);
      controller.start('project-a', circuit, { onResult: vi.fn(), onFailure });
      executor.preflights[0]!.resolve({
        ...result(0),
        solved: false,
        status,
        diagnostics: [
          {
            code: status === 'unsupported' ? 'unsupported_component' : 'nonconvergent_topology',
            severity: 'error',
            message: 'No trustworthy electrical result.',
          },
        ],
      });
      await flush();

      expect(executor.advances).toHaveLength(0);
      expect(onFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          category: status,
          code: status === 'unsupported' ? 'unsupported_component' : 'nonconvergent_topology',
        }),
      );
      expect(executor.cancelCount).toBe(1);
    },
  );

  it('preserves scheduler fault codes and does not publish a faulted frame', async () => {
    const executor = new FakeExecutor();
    const onResult = vi.fn();
    const onFailure = vi.fn();
    const onCommittedHorizon = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult, onFailure, onCommittedHorizon });
    await completeCanonicalStart(executor, 1);
    expect(onCommittedHorizon).toHaveBeenLastCalledWith(0);

    controller.update(circuit, 25_000);
    executor.advances[1]!.deferred.resolve({
      ...timedAdvance('fault', 25_000, 0),
      diagnostics: [{ code: 'physical_advance_failed', message: 'Physical step rejected.' }],
    });
    await flush();

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onCommittedHorizon).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'physical', code: 'physical_advance_failed' }),
    );
  });

  it('starts a fresh generation on the current document after a technical timeout', async () => {
    const executor = new FakeExecutor();
    const firstResult = vi.fn();
    const firstFailure = vi.fn();
    const nextResult = vi.fn();
    const nextFailure = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult: firstResult, onFailure: firstFailure });
    executor.preflights[0]!.reject(new SimulationWorkerError('worker-timeout', 'Timed out.'));
    await flush();
    expect(firstFailure).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'technical', code: 'worker-timeout' }),
    );

    const changed = {
      ...circuit,
      components: circuit.components.map((component) =>
        component.id === 'resistor' ? { ...component, value: 470 } : component,
      ),
    };
    controller.start('project-a', changed, { onResult: nextResult, onFailure: nextFailure });
    await completeCanonicalStart(executor, 2, 2);
    expect(executor.advances.find((call) => call.generationId === 2)?.document).toBe(changed);
    expect(nextResult).toHaveBeenCalledWith(result(2), undefined, undefined);
    expect(nextResult).toHaveBeenCalledTimes(1);
    expect(nextFailure).not.toHaveBeenCalled();
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
    expect(secondResult).toHaveBeenCalledWith(result(2), undefined, undefined);

    controller.dispose();
    expect(executor.disposeCount).toBe(1);
  });
});

describe('Ready cadence preserves the production canonical engine', () => {
  function physicalFixture(physical: boolean, source?: string) {
    const components: SchematicDocument['components'][number][] = [
      {
        id: 'uno',
        kind: 'visual',
        value: 5,
        position: { x: 0, y: 0 },
        componentTypeId: 'arduino-uno',
        pinIds: ['d2', 'd13', 'a0', 'power-5v', 'power-3v3', 'power-gnd-1'],
        stateProperties: {
          arduinoSource:
            source ??
            'int n=0;void setup(){pinMode(13,OUTPUT);pinMode(2,INPUT_PULLUP);Serial.begin(9600);}void loop(){n++;digitalWrite(13,n%2);Serial.println(n);delayMicroseconds(100);}',
        },
      },
      { id: 'r', kind: 'resistor', value: 1000, position: { x: 0, y: 0 } },
      {
        id: 'cap',
        kind: 'visual',
        value: 10,
        position: { x: 0, y: 0 },
        componentTypeId: 'electrolytic-capacitor',
        pinIds: ['positive', 'negative'],
        stateProperties: { initialVoltageVolt: 0, voltageRatingVolt: 25 },
      },
      { id: 'key', kind: 'button', value: 1, position: { x: 0, y: 0 }, state: false },
    ];
    const wires = [
      ['uno', 'd13', 'r', 'a'],
      ['r', 'b', 'cap', 'positive'],
      ['cap', 'negative', 'uno', 'power-gnd-1'],
      ['cap', 'positive', 'uno', 'a0'],
      ['uno', 'd2', 'key', 'a'],
      ['key', 'b', 'uno', 'power-gnd-1'],
    ];
    if (physical) {
      components.push(
        { id: 'source', kind: 'source', value: 6, position: { x: 0, y: 0 } },
        {
          id: 'motor',
          kind: 'visual',
          value: 6,
          position: { x: 0, y: 0 },
          componentTypeId: 'dc-motor',
          pinIds: ['positive', 'negative'],
        },
        {
          id: 'led',
          kind: 'led',
          value: 2,
          position: { x: 0, y: 0 },
          componentTypeId: 'led-5mm',
          pinIds: ['anode', 'cathode'],
          stateProperties: { ledColour: 'red' },
        },
        { id: 'led-r', kind: 'resistor', value: 330, position: { x: 0, y: 0 } },
      );
      wires.push(
        ['source', 'a', 'motor', 'positive'],
        ['motor', 'negative', 'source', 'b'],
        ['source', 'a', 'led-r', 'a'],
        ['led-r', 'b', 'led', 'anode'],
        ['led', 'cathode', 'source', 'b'],
      );
    }
    const parsed = parseElectronicsEngineDocument({
      ...circuit,
      components,
      connections: wires.map(([from, a, to, b], index) => ({
        id: `w${index}`,
        from: { componentId: from, terminal: a },
        to: { componentId: to, terminal: b },
      })),
    });
    if (!parsed.ok) throw new Error(parsed.message);
    return parsed.document;
  }

  it('preserves exact first20ms electrical edges and complete canonical state through the bootstrap partition', () => {
    const document = physicalFixture(
      false,
      'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(20);digitalWrite(13,LOW);delay(20);}',
    );
    const whole = advanceElectronicsToHorizon(document, {
      requestedHorizonMicroseconds: 40000,
      maxEvents: 1024,
    });
    let state = resetElectronicsTimedState();
    let last;
    for (const horizon of [0, 1000, 26000, 40000]) {
      last = advanceElectronicsToHorizon(document, {
        requestedHorizonMicroseconds: horizon,
        state,
        maxEvents: 1024,
      });
      expect(last.executionStatus).toBe('ready');
      state = last.state;
    }
    expect(state).toEqual(whole.state);
    expect(last!.observation).toEqual(whole.observation);
    const canonical = JSON.parse(state.continuation!.serializedState);
    expect(
      canonical.boards[0].runtime.eventQueue.filter(
        (e: { kind: string; terminal: string }) =>
          e.kind === 'output-change' && e.terminal === 'd13',
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ atMicroseconds: 2, voltage: 5 }),
        expect.objectContaining({ atMicroseconds: 20004, voltage: 0 }),
      ]),
    );
  });

  it.each([50, 100])(
    '25ms completed observations expose both %sms blink phases without changing canonical state',
    (delay) => {
      const document = physicalFixture(
        false,
        `void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);delay(${delay});digitalWrite(13,LOW);delay(${delay});}`,
      );
      const whole = advanceElectronicsToHorizon(document, {
        requestedHorizonMicroseconds: 500_000,
        maxEvents: 1024,
      });
      expect(whole.executionStatus, JSON.stringify(whole.diagnostics)).toBe('ready');
      let state = resetElectronicsTimedState();
      let last;
      const phases = new Set<number>();
      for (let horizon = 0; horizon <= 500_000; horizon += 25_000) {
        const complete = advanceElectronicsToHorizon(document, {
          requestedHorizonMicroseconds: horizon,
          state,
        });
        expect(complete.executionStatus).toBe('ready');
        expect(complete.committedHorizonMicroseconds).toBe(horizon);
        expect(complete.observation?.quality.passed).toBe(true);
        state = JSON.parse(JSON.stringify(complete.state));
        const canonical = JSON.parse(state.continuation!.serializedState);
        const events = canonical.boards[0].runtime.eventQueue as Array<{
          kind: string;
          terminal: string;
          voltage: number;
        }>;
        const lastOutput = events
          .filter((event) => event.kind === 'output-change' && event.terminal === 'd13')
          .at(-1);
        if (lastOutput) phases.add(lastOutput.voltage);
        last = complete;
      }
      expect([...phases].sort()).toEqual([0, 5]);
      expect(state).toEqual(whole.state);
      expect(last!.observation).toEqual(whole.observation);
    },
  );

  it.each([false, true])(
    'preserves all MCU/RC/heat/damage/motor state and ordered inputs across ready partitions (physical=%s)',
    (physical) => {
      const document = physicalFixture(physical);
      const zero = advanceElectronicsToHorizon(document, { requestedHorizonMicroseconds: 0 });
      expect(zero.executionStatus).toBe('ready');
      const initial = structuredClone(zero.state);
      // A controlled valid continuation proves nonzero history is carried, not reset.
      const seeded = JSON.parse(initial.continuation!.serializedState);
      seeded.physicalState.capacitors[0].voltageVolt = 1.25;
      for (const thermal of seeded.physicalState.thermal) {
        thermal.temperatureCelsius = 45;
        thermal.accumulatedDamage = 0.25;
      }
      for (const motor of seeded.physicalState.motors ?? []) {
        motor.temperatureCelsius = 42;
        motor.accumulatedDamage = 0.125;
      }
      const start = {
        ...initial,
        continuation: { ...initial.continuation!, serializedState: JSON.stringify(seeded) },
      };
      const inputEvents: ElectronicsTimedInputEvent[] = [
        { atMicroseconds: 51, targetId: 'key', operation: 'state', payload: true },
        { atMicroseconds: 51, targetId: 'uno', operation: 'serialRx', payload: 'A' },
        { atMicroseconds: 172, targetId: 'key', operation: 'state', payload: false },
        { atMicroseconds: 172, targetId: 'uno', operation: 'serialRx', payload: 'B' },
      ];
      const run = (horizons: number[], budget: number, observeYielded: boolean) => {
        let state = structuredClone(start);
        let first = true;
        let yielded = 0;
        let last;
        for (const horizon of horizons) {
          for (let batch = 0; batch < 5000; batch++) {
            const actual = advanceElectronicsToHorizon(document, {
              requestedHorizonMicroseconds: horizon,
              state,
              maxEvents: budget,
              ...(first ? { inputEvents } : {}),
            });
            first = false;
            expect(actual.diagnostics).toEqual([]);
            expect(actual.executionStatus).not.toBe('fault');
            state = JSON.parse(JSON.stringify(actual.state));
            if (actual.executionStatus === 'ready') {
              expect(actual.committedHorizonMicroseconds).toBe(horizon);
              expect(actual.observation.solved).toBe(true);
              expect(actual.observation.quality.passed).toBe(true);
              last = actual;
              break;
            }
            yielded++;
            expect(actual.observation).toBeNull();
            if (observeYielded) {
              const complete = advanceElectronicsToHorizon(document, {
                requestedHorizonMicroseconds: actual.committedHorizonMicroseconds,
                state,
                maxEvents: budget,
              });
              expect(complete.executionStatus).toBe('ready');
              if (complete.executionStatus !== 'ready')
                throw new Error('Checkpoint observation is incomplete');
              expect(complete.observation.quality.passed).toBe(true);
              expect(complete.committedHorizonMicroseconds).toBe(
                complete.requestedHorizonMicroseconds,
              );
              state = JSON.parse(JSON.stringify(complete.state));
            }
            if (batch === 4999) throw new Error('Bounded canonical horizon not reached');
          }
        }
        return { state, observation: last!.observation, yielded };
      };
      const whole = run([300], 1024, false);
      for (const budget of [1, 7, 31]) {
        const partitioned = run([33, 171, 300], budget, true);
        expect(partitioned.state).toEqual(whole.state);
        expect(partitioned.observation).toEqual(whole.observation);
        if (budget === 1) expect(partitioned.yielded).toBeGreaterThan(0);
      }
      const final = JSON.parse(whole.state.continuation!.serializedState);
      expect(final.inputs).toHaveLength(4);
      expect(final.nextInputIndex).toBe(4);
      expect(final.boards[0].runtime.serial.rx).toEqual([
        { sequence: 0, atMicroseconds: 51, byte: 65 },
        { sequence: 1, atMicroseconds: 172, byte: 66 },
      ]);
      expect(final.boards[0].runtime.eventQueue.length).toBeGreaterThan(4);
      expect(final.boards[0].runtime.eventQueue.length).toBeLessThan(256);
      expect(final.physicalState.capacitors[0].voltageVolt).not.toBe(0);
      if (physical) {
        expect(
          final.physicalState.thermal.find(
            (row: { componentId: string }) => row.componentId === 'led',
          ).accumulatedDamage,
        ).toBeGreaterThan(0);
        expect(final.physicalState.motors[0].accumulatedDamage).toBeGreaterThan(0);
        expect(final.physicalState.motors[0].motorAngularVelocityRadPerSecond).toBeGreaterThan(0);
      }
    },
  );
});

// Private proposed scheduling criterion: these tests do not attribute native CI lag.
describe('private exhausted ordinary demand probe', () => {
  async function ordinaryFixture(
    afterOrdinary: (fixture: {
      controller: ElectronicsLiveSimulationWorkerController;
      setElapsed: (value: number | null) => void;
      acknowledge: (value: number) => void;
    }) => void,
  ) {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    let elapsed: number | null = 0;
    let acknowledged = 0;
    let delivered = 0;
    const failures = vi.fn();
    const readHost = vi.fn(() =>
      elapsed === null ? null : Math.min(elapsed, acknowledged + 50_000),
    );
    const fixture = {
      controller,
      setElapsed: (value: number | null) => {
        elapsed = value;
      },
      acknowledge: (value: number) => {
        expect(value).toBeGreaterThanOrEqual(acknowledged);
        expect(value).toBeLessThanOrEqual(delivered);
        acknowledged = value;
      },
    };
    controller.start('private-exhausted-demand', serialCircuit, {
      readHostHorizonMicroseconds: readHost,
      onCommittedHorizon: (value) => {
        delivered = value;
      },
      onResult: () => {
        if (delivered === 2_000) afterOrdinary(fixture);
      },
      onFailure: failures,
    });
    await completeCanonicalStart(executor, 1);
    await flush();
    expect(executor.advances.map((call) => call.requestedHorizonMicroseconds)).toEqual([0]);
    // Finish the first positive release and all startup microtasks before probing
    // an ordinary saved target. H0 alone could exercise the special startup pull.
    fixture.setElapsed(1_000);
    controller.update(serialCircuit, 1_000);
    expect(executor.advances[1]!.requestedHorizonMicroseconds).toBe(1_000);
    executor.advances[1]!.deferred.resolve(timedAdvance('ready', 1_000, 1_000));
    await flush();
    await flush();
    const settledReads = readHost.mock.calls.length;
    await flush();
    expect(readHost).toHaveBeenCalledTimes(settledReads);
    expect(executor.advances.map((call) => call.requestedHorizonMicroseconds)).toEqual([0, 1_000]);
    fixture.acknowledge(1_000);
    fixture.setElapsed(2_000);
    controller.update(serialCircuit, 2_000);
    expect(executor.advances).toHaveLength(3);
    expect(executor.advances[2]).toMatchObject({
      generationId: 1,
      requestedHorizonMicroseconds: 2_000,
      inputEvents: [],
    });
    expect(executor.advances[2]!.state.continuation?.committedHorizonMicroseconds).toBe(1_000);
    return { ...fixture, executor, readHost, failures };
  }

  it.each([
    { elapsed: 3_000, expected: 3_000 },
    { elapsed: 100_000, expected: 27_000 },
  ])(
    'proposed fresh read after ordinary exhaustion, elapsed=$elapsed',
    async ({ elapsed, expected }) => {
      const fixture = await ordinaryFixture(({ setElapsed, acknowledge }) => {
        acknowledge(2_000);
        setElapsed(elapsed);
      });
      try {
        const readsBefore = fixture.readHost.mock.calls.length;
        fixture.executor.advances[2]!.deferred.resolve(timedAdvance('ready', 2_000, 2_000));
        await flush();
        await flush();
        // Expected is declared independently: min(elapsed, ACK+50000), then
        // the existing 25000us complete-observation slice from committed 2000.
        expect.soft(fixture.readHost.mock.calls.length - readsBefore).toBe(1);
        expect.soft(fixture.executor.advances).toHaveLength(4);
        expect.soft(fixture.executor.advances[3]?.requestedHorizonMicroseconds).toBe(expected);
        expect(fixture.failures).not.toHaveBeenCalled();
      } finally {
        fixture.controller.dispose();
      }
    },
  );

  it.each([2_000, null, NaN, -1, 0.5])(
    'does not invent demand or busy-loop for unchanged/null/invalid host %s',
    async (host) => {
      const fixture = await ordinaryFixture(({ setElapsed }) => setElapsed(host));
      try {
        fixture.executor.advances[2]!.deferred.resolve(timedAdvance('ready', 2_000, 2_000));
        await flush();
        const settledReads = fixture.readHost.mock.calls.length;
        for (let index = 0; index < 8; index += 1) await flush();
        expect(fixture.executor.advances).toHaveLength(3);
        expect(fixture.readHost).toHaveBeenCalledTimes(settledReads);
        expect(fixture.failures).not.toHaveBeenCalled();
      } finally {
        fixture.controller.dispose();
      }
    },
  );

  it('keeps one in-flight request and no work when legal held-ACK demand equals committed', async () => {
    const fixture = await ordinaryFixture(() => undefined);
    try {
      fixture.setElapsed(80_000);
      // ACK remains 1000, so the legal cap is 51000: finite catch-up is allowed.
      // This positive update is a control, not the no-external-update regression.
      fixture.controller.update(serialCircuit, 51_000);
      expect(fixture.executor.advances).toHaveLength(3);
      fixture.executor.advances[2]!.deferred.resolve(timedAdvance('ready', 2_000, 2_000));
      await flush();
      expect(fixture.executor.advances[3]!.requestedHorizonMicroseconds).toBe(27_000);
      fixture.executor.advances[3]!.deferred.resolve(timedAdvance('ready', 27_000, 27_000));
      await flush();
      expect(fixture.executor.advances[4]!.requestedHorizonMicroseconds).toBe(51_000);
      fixture.executor.advances[4]!.deferred.resolve(timedAdvance('ready', 51_000, 51_000));
      await flush();
      // H=min(80000,1000+50000)=51000, exactly committed: held ACK now
      // implies no work; greater wall elapsed does not increase its legal cap.
      fixture.setElapsed(1_000_000);
      const count = fixture.executor.advances.length;
      const reads = fixture.readHost.mock.calls.length;
      for (let index = 0; index < 8; index += 1) await flush();
      expect(fixture.executor.advances).toHaveLength(count);
      expect(fixture.readHost).toHaveBeenCalledTimes(reads);
    } finally {
      fixture.controller.dispose();
    }
  });

  it.each(['Stop', 'Reset'] as const)(
    'does not dispatch stale demand after callback %s',
    async (action) => {
      const fixture = await ordinaryFixture(({ controller, setElapsed }) => {
        setElapsed(0);
        if (action === 'Stop') controller.stop();
        else controller.restart(serialCircuit);
      });
      try {
        fixture.executor.advances[2]!.deferred.resolve(timedAdvance('ready', 2_000, 2_000));
        for (let index = 0; index < 8; index += 1) await flush();
        expect(fixture.executor.advances).toHaveLength(3);
        if (action === 'Reset') {
          expect(fixture.executor.preflights).toHaveLength(2);
          await completeCanonicalStart(fixture.executor, 2);
          expect(fixture.executor.advances.at(-1)).toMatchObject({
            generationId: 2,
            requestedHorizonMicroseconds: 0,
          });
        }
        expect(fixture.failures).not.toHaveBeenCalled();
      } finally {
        fixture.controller.dispose();
      }
    },
  );

  it('preserves callback button/Serial priority and serial one-in-flight ordering', async () => {
    const pressed: SchematicDocument = {
      ...serialCircuit,
      components: serialCircuit.components.map((component) =>
        component.id === 'button' ? { ...component, state: true } : component,
      ),
    };
    const fixture = await ordinaryFixture(({ controller }) => {
      controller.update(pressed, 2_000);
      controller.sendSerialRx('uno', 'A', 2_000);
    });
    try {
      fixture.executor.advances[2]!.deferred.resolve(timedAdvance('ready', 2_000, 2_000));
      await flush();
      expect(fixture.executor.advances).toHaveLength(4);
      expect(fixture.executor.advances[3]!.inputEvents).toEqual([
        { atMicroseconds: 2_001, targetId: 'button', operation: 'state', payload: true },
      ]);
      fixture.executor.advances[3]!.deferred.resolve(timedAdvance('ready', 2_001, 2_001));
      await flush();
      expect(fixture.executor.advances).toHaveLength(5);
      expect(fixture.executor.advances[4]!.inputEvents).toEqual([
        { atMicroseconds: 2_002, targetId: 'uno', operation: 'serialRx', payload: 'A' },
      ]);
      fixture.executor.advances[4]!.deferred.resolve(timedAdvance('ready', 2_002, 2_002));
      for (let index = 0; index < 8; index += 1) await flush();
      expect(fixture.executor.advances).toHaveLength(5);
      expect(fixture.failures).not.toHaveBeenCalled();
    } finally {
      fixture.controller.dispose();
    }
  });
  it('finishes a yielded committed checkpoint before the remaining ordinary demand', async () => {
    const fixture = await ordinaryFixture(() => undefined);
    try {
      fixture.executor.advances[2]!.deferred.resolve(timedAdvance('yielded', 2_000, 1_500));
      await flush();
      expect(fixture.executor.advances).toHaveLength(4);
      expect(fixture.executor.advances[3]).toMatchObject({
        requestedHorizonMicroseconds: 1_500,
        inputEvents: [],
      });
      expect(fixture.executor.advances[3]!.state.continuation?.committedHorizonMicroseconds).toBe(
        1_500,
      );
      fixture.executor.advances[3]!.deferred.resolve(timedAdvance('ready', 1_500, 1_500));
      await flush();
      expect(fixture.executor.advances).toHaveLength(5);
      expect(fixture.executor.advances[4]!.requestedHorizonMicroseconds).toBe(2_000);
      fixture.executor.advances[4]!.deferred.resolve(timedAdvance('ready', 2_000, 2_000));
      for (let index = 0; index < 8; index += 1) await flush();
      expect(fixture.executor.advances).toHaveLength(5);
      expect(fixture.failures).not.toHaveBeenCalled();
    } finally {
      fixture.controller.dispose();
    }
  });
});

// Private feasibility controls; all earlier tests remain byte-exact.
describe('private external-epoch exhaustion safety', () => {
  async function settled() {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    let host: number | null = 0;
    let delivered = 0;
    let afterCommit: (value: number) => void = () => {};
    let afterResult = () => {};
    let duringRead = () => {};
    const failures = vi.fn();
    const read = vi.fn(() => {
      const sample = host;
      duringRead();
      return sample;
    });
    controller.start('epoch-private', serialCircuit, {
      readHostHorizonMicroseconds: read,
      onCommittedHorizon: (value) => {
        delivered = value;
        afterCommit(value);
      },
      onResult: () => afterResult(),
      onFailure: failures,
    });
    await completeCanonicalStart(executor, 1);
    await flush();
    host = 1000;
    controller.update(serialCircuit, 1000);
    executor.advances[1]!.deferred.resolve(timedAdvance('ready', 1000, 1000));
    await flush();
    await flush();
    host = 2000;
    controller.update(serialCircuit, 2000);
    expect(executor.advances.map((call) => call.requestedHorizonMicroseconds)).toEqual([
      0, 1000, 2000,
    ]);
    return {
      executor,
      controller,
      read,
      failures,
      committed: () => delivered,
      host: (value: number | null) => {
        host = value;
      },
      onCommit: (callback: typeof afterCommit) => {
        afterCommit = callback;
      },
      onResult: (callback: typeof afterResult) => {
        afterResult = callback;
      },
      onRead: (callback: typeof duringRead) => {
        duringRead = callback;
      },
      finish: async (index: number) => {
        const call = executor.advances[index]!;
        call.deferred.resolve(
          timedAdvance(
            'ready',
            call.requestedHorizonMicroseconds,
            call.requestedHorizonMicroseconds,
          ),
        );
        await flush();
        await flush();
      },
    };
  }

  it.each([null, NaN, -1, 0.5, 2000])(
    'reaches exactly one refresh read for invalid/unchanged sample %s',
    async (sample) => {
      const f = await settled();
      try {
        f.host(sample);
        const reads = f.read.mock.calls.length;
        await f.finish(2);
        expect(f.read.mock.calls.length - reads).toBe(1);
        expect(f.executor.advances).toHaveLength(3);
        for (let i = 0; i < 12; i++) await flush();
        expect(f.read.mock.calls.length - reads).toBe(1);
        expect(f.failures).not.toHaveBeenCalled();
      } finally {
        f.controller.dispose();
      }
    },
  );

  it('does not self-chain with a host moving on every read and completion; external update rearms once', async () => {
    const f = await settled();
    try {
      let elapsed = 3000;
      f.host(elapsed);
      f.onRead(() => f.host(++elapsed));
      f.onCommit(() => f.host(++elapsed));
      const reads = f.read.mock.calls.length;
      await f.finish(2);
      expect(f.read.mock.calls.length - reads).toBe(1);
      expect(f.executor.advances).toHaveLength(4);
      await f.finish(3);
      for (let i = 0; i < 12; i++) await flush();
      expect(f.executor.advances).toHaveLength(4);
      expect(f.read.mock.calls.length - reads).toBe(1);
      elapsed = 5000;
      f.host(elapsed);
      f.controller.update(serialCircuit, 5000);
      expect(f.executor.advances).toHaveLength(5);
      elapsed = 6000;
      f.host(elapsed);
      const nextReads = f.read.mock.calls.length;
      await f.finish(4);
      expect(f.read.mock.calls.length - nextReads).toBe(1);
      expect(f.executor.advances).toHaveLength(6);
      await f.finish(5);
      expect(f.executor.advances).toHaveLength(6);
      expect(f.failures).not.toHaveBeenCalled();
    } finally {
      f.controller.dispose();
    }
  });

  it.each(['onCommit', 'onResult', 'onRead'] as const)(
    'preserves newer update and its permit during %s reentry',
    async (boundary) => {
      const f = await settled();
      try {
        f.host(3000);
        let entered = false;
        f[boundary](() => {
          if (entered) return;
          entered = true;
          f.host(4000);
          f.controller.update(serialCircuit, 4000);
        });
        await f.finish(2);
        expect(entered).toBe(true);
        expect(f.executor.advances).toHaveLength(4);
        expect(f.executor.advances[3]!.requestedHorizonMicroseconds).toBe(4000);
        f.host(5000);
        const reads = f.read.mock.calls.length;
        await f.finish(3);
        expect(f.read.mock.calls.length - reads).toBe(1);
        expect(f.executor.advances).toHaveLength(5);
        expect(f.executor.advances[4]!.requestedHorizonMicroseconds).toBe(5000);
        await f.finish(4);
        expect(f.executor.advances).toHaveLength(5);
        expect(f.failures).not.toHaveBeenCalled();
      } finally {
        f.controller.dispose();
      }
    },
  );

  it.each(['Stop', 'Reset', 'document', 'input'] as const)(
    'fences refresh sample after host callback %s',
    async (action) => {
      const f = await settled();
      try {
        f.host(3000);
        let entered = false;
        f.onRead(() => {
          if (entered) return;
          entered = true;
          if (action === 'Stop') f.controller.stop();
          else if (action === 'Reset') f.controller.restart(serialCircuit);
          else if (action === 'document')
            f.controller.update({ ...serialCircuit, components: [] }, 3000);
          else
            f.controller.update(
              {
                ...serialCircuit,
                components: serialCircuit.components.map((c) =>
                  c.id === 'button' ? { ...c, state: true } : c,
                ),
              },
              3000,
            );
        });
        await f.finish(2);
        expect(entered).toBe(true);
        if (action === 'Stop') expect(f.executor.advances).toHaveLength(3);
        else if (action === 'input') {
          expect(f.executor.advances).toHaveLength(4);
          expect(f.executor.advances[3]!.inputEvents).toEqual([
            { atMicroseconds: 2001, targetId: 'button', operation: 'state', payload: true },
          ]);
        } else {
          expect(f.executor.advances).toHaveLength(3);
          expect(f.executor.preflights).toHaveLength(2);
        }
        expect(f.failures).not.toHaveBeenCalled();
      } finally {
        f.controller.dispose();
      }
    },
  );

  it('coalesces updates while inflight without accumulating credits and retains ordinary slicing', async () => {
    const f = await settled();
    try {
      f.host(62000);
      f.controller.update(serialCircuit, 42000);
      f.controller.update(serialCircuit, 52000);
      f.controller.update(serialCircuit, 62000);
      expect(f.executor.advances).toHaveLength(3);
      await f.finish(2);
      expect(f.executor.advances[3]!.requestedHorizonMicroseconds).toBe(27000);
      await f.finish(3);
      expect(f.executor.advances[4]!.requestedHorizonMicroseconds).toBe(52000);
      await f.finish(4);
      expect(f.executor.advances[5]!.requestedHorizonMicroseconds).toBe(62000);
      f.host(63000);
      const reads = f.read.mock.calls.length;
      await f.finish(5);
      expect(f.read.mock.calls.length - reads).toBe(0);
      expect(f.executor.advances).toHaveLength(6);
      f.host(100000);
      for (let i = 0; i < 12; i++) await flush();
      expect(f.executor.advances).toHaveLength(6);
      expect(f.read.mock.calls.length - reads).toBe(0);
      expect(f.failures).not.toHaveBeenCalled();
    } finally {
      f.controller.dispose();
    }
  });

  it.each(['normal', 'held ACK'] as const)(
    'valid unchanged post-completion sample spends opportunity without a value special case (%s)',
    async (mode) => {
      const f = await settled();
      try {
        // Synthetic retained-target control: the sample is independently bounded by elapsed and ACK.
        const elapsed = 2000;
        const ack = 0;
        const h = mode === 'held ACK' ? Math.min(elapsed, ack + 50000) : 2000;
        f.controller.update(serialCircuit, 6000);
        f.host(h);
        const before = f.read.mock.calls.length;
        await f.finish(2);
        expect(f.read.mock.calls.length - before).toBe(1);
        expect(f.executor.advances[3]!.requestedHorizonMicroseconds).toBe(6000);
        f.host(10000);
        await f.finish(3);
        expect(f.executor.advances).toHaveLength(4);
        expect(f.read.mock.calls.length - before).toBe(1);
      } finally {
        f.controller.dispose();
      }
    },
  );

  it.each(['update', 'Stop', 'Reset', 'document', 'input'] as const)(
    'fences the selected normal retained read across reentrant %s',
    async (action) => {
      const f = await settled();
      try {
        f.controller.update(serialCircuit, 6000);
        f.host(6000);
        let entered = false;
        f.onRead(() => {
          if (entered) return;
          entered = true;
          f.host(7000);
          if (action === 'update') f.controller.update(serialCircuit, 7000);
          else if (action === 'Stop') f.controller.stop();
          else if (action === 'Reset') f.controller.restart(serialCircuit);
          else if (action === 'document')
            f.controller.update({ ...serialCircuit, components: [] }, 7000);
          else {
            f.controller.update(
              {
                ...serialCircuit,
                components: serialCircuit.components.map((c) =>
                  c.id === 'button' ? { ...c, state: true } : c,
                ),
              },
              7000,
            );
            f.controller.sendSerialRx('uno', 'A', 7000);
          }
        });
        await f.finish(2);
        expect(entered).toBe(true);
        if (action === 'update') {
          expect(f.executor.advances).toHaveLength(4);
          expect(f.executor.advances[3]!.requestedHorizonMicroseconds).toBe(7000);
          f.host(8000);
          const reads = f.read.mock.calls.length;
          await f.finish(3);
          // Old discarded normal sample did not consume the reentrant epoch.
          expect(f.read.mock.calls.length - reads).toBe(1);
          expect(f.executor.advances[4]!.requestedHorizonMicroseconds).toBe(8000);
          await f.finish(4);
          expect(f.executor.advances).toHaveLength(5);
        } else if (action === 'input') {
          expect(f.executor.advances).toHaveLength(4);
          expect(f.executor.advances[3]!.inputEvents).toEqual([
            { atMicroseconds: 2001, targetId: 'button', operation: 'state', payload: true },
          ]);
          await f.finish(3);
          expect(f.executor.advances[4]!.inputEvents).toEqual([
            { atMicroseconds: 7001, targetId: 'uno', operation: 'serialRx', payload: 'A' },
          ]);
          expect(f.executor.advances).toHaveLength(5);
        } else if (action === 'Stop') expect(f.executor.advances).toHaveLength(3);
        else {
          expect(f.executor.advances).toHaveLength(3);
          expect(f.executor.preflights).toHaveLength(2);
        }
        expect(f.failures).not.toHaveBeenCalled();
      } finally {
        f.controller.dispose();
      }
    },
  );

  it.each([null, NaN, -1, 0.5])(
    'invalid normal sample %s is actually reached and input-only resume cannot consume opportunity',
    async (sample) => {
      const f = await settled();
      try {
        f.controller.update(serialCircuit, 6000);
        f.host(sample);
        const before = f.read.mock.calls.length;
        await f.finish(2);
        expect(f.read.mock.calls.length - before).toBe(1);
        expect(f.executor.advances).toHaveLength(3);
        for (let i = 0; i < 8; i++) await flush();
        expect(f.read.mock.calls.length - before).toBe(1);
        f.host(6000);
        f.controller.sendSerialRx('uno', 'X', 2000);
        expect(f.executor.advances[3]!.inputEvents).toEqual([
          { atMicroseconds: 2001, targetId: 'uno', operation: 'serialRx', payload: 'X' },
        ]);
        await f.finish(3);
        expect(f.executor.advances[4]!.requestedHorizonMicroseconds).toBe(6000);
        f.host(7000);
        const endReads = f.read.mock.calls.length;
        await f.finish(4);
        expect(f.read.mock.calls.length - endReads).toBe(1);
        expect(f.executor.advances[5]!.requestedHorizonMicroseconds).toBe(7000);
        await f.finish(5);
        expect(f.executor.advances).toHaveLength(6);
        expect(f.failures).not.toHaveBeenCalled();
      } finally {
        f.controller.dispose();
      }
    },
  );

  it('no callback remains idle and invalid public updates do not create work', async () => {
    const executor = new FakeExecutor();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    try {
      controller.start('no-host', serialCircuit, { onResult: vi.fn(), onFailure: vi.fn() });
      await completeCanonicalStart(executor, 1);
      controller.update(serialCircuit, 2000);
      executor.advances[1]!.deferred.resolve(timedAdvance('ready', 2000, 2000));
      await flush();
      for (const h of [NaN, -1, 0.5]) controller.update(serialCircuit, h);
      for (let i = 0; i < 12; i++) await flush();
      expect(executor.advances).toHaveLength(2);
    } finally {
      controller.dispose();
    }
  });

  it('moving every normal read/completion still drains a finite admitted horizon and does not rearm', async () => {
    const f = await settled();
    try {
      // Host is independently ahead of C but remains below already admitted62000.
      let elapsed = 60000;
      f.host(elapsed);
      f.controller.update(serialCircuit, 62000);
      f.onRead(() => f.host(++elapsed));
      f.onCommit(() => f.host(++elapsed));
      const reads = f.read.mock.calls.length;
      await f.finish(2);
      expect(f.executor.advances[3]!.requestedHorizonMicroseconds).toBe(27000);
      await f.finish(3);
      expect(f.executor.advances[4]!.requestedHorizonMicroseconds).toBe(52000);
      await f.finish(4);
      expect(f.executor.advances[5]!.requestedHorizonMicroseconds).toBe(62000);
      await f.finish(5);
      expect(f.read.mock.calls.length - reads).toBe(3);
      for (let i = 0; i < 12; i++) await flush();
      expect(f.executor.advances).toHaveLength(6);
      expect(f.read.mock.calls.length - reads).toBe(3);
      elapsed = 70000;
      f.host(elapsed);
      f.controller.update(serialCircuit, 70000);
      elapsed = 71000;
      f.host(elapsed);
      const nextReads = f.read.mock.calls.length;
      await f.finish(6);
      expect(f.read.mock.calls.length - nextReads).toBe(1);
      expect(f.executor.advances).toHaveLength(8);
      await f.finish(7);
      expect(f.executor.advances).toHaveLength(8);
    } finally {
      f.controller.dispose();
    }
  });

  it('held ACK uses the independent delivered+50000 ceiling and no completion mints more credit', async () => {
    const f = await settled();
    try {
      let acknowledged = 1000;
      let elapsed = 100000;
      const bounded = () => Math.min(elapsed, acknowledged + 50000);
      f.onCommit(() => {
        expect(acknowledged).toBeLessThanOrEqual(f.committed());
        f.host(bounded());
      });
      f.onRead(() => {
        elapsed += 1000;
        f.host(bounded());
      });
      f.host(bounded());
      await f.finish(2);
      expect(f.executor.advances[3]!.requestedHorizonMicroseconds).toBe(27000);
      await f.finish(3);
      expect(f.executor.advances[4]!.requestedHorizonMicroseconds).toBe(51000);
      await f.finish(4);
      expect(f.executor.advances).toHaveLength(5);
      const reads = f.read.mock.calls.length;
      for (let i = 0; i < 12; i++) await flush();
      expect(f.read.mock.calls.length).toBe(reads);
      acknowledged = 51000;
      expect(acknowledged).toBeLessThanOrEqual(f.committed());
      f.host(bounded());
      f.controller.update(serialCircuit, bounded());
      expect(f.executor.advances[5]!.requestedHorizonMicroseconds).toBe(76000);
      await f.finish(5);
      expect(f.executor.advances[6]!.requestedHorizonMicroseconds).toBe(101000);
      await f.finish(6);
      expect(f.executor.advances).toHaveLength(7);
      expect(f.failures).not.toHaveBeenCalled();
    } finally {
      f.controller.dispose();
    }
  });
});
