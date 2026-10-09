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
import type { SimulationTimedAdvancePayload } from '../simulation-worker-protocol';
import { SimulationWorkerError } from '../simulation-failure';

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
  it('publishes time zero before coalesced preflight horizons and later ready observations', async () => {
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
    expect(executor.advances[0]).toMatchObject({
      requestedHorizonMicroseconds: 0,
      inputEvents: [],
    });
    expect(executor.advances[0]!.state).toEqual(resetElectronicsTimedState());

    controller.update(circuit, 300_000);
    executor.advances[0]!.deferred.resolve(timedAdvance('ready', 0, 0, 1));
    await flush();
    expect(onResult).toHaveBeenCalledExactlyOnceWith(result(1));
    expect(executor.advances[1]).toMatchObject({ requestedHorizonMicroseconds: 100_000 });
    executor.advances[1]!.deferred.resolve(timedAdvance('yielded', 100_000, 60_000));
    await flush();
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(executor.advances[2]).toMatchObject({ requestedHorizonMicroseconds: 60_000 });
    executor.advances[2]!.deferred.resolve(timedAdvance('ready', 60_000, 60_000, 2));
    await flush();
    expect(onResult).toHaveBeenLastCalledWith(result(2));
  });

  it('retains ordered runtime and serial inputs until after a complete zero-time observation', async () => {
    const executor = new FakeExecutor();
    const onResult = vi.fn();
    const onCommittedHorizon = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', serialCircuit, {
      onResult,
      onCommittedHorizon,
      onFailure: vi.fn(),
    });
    const pressed = {
      ...serialCircuit,
      components: serialCircuit.components.map((component) =>
        component.id === 'button' ? { ...component, state: true } : component,
      ),
    };
    controller.update(pressed, 200_000);
    controller.sendSerialRx('uno', 'A', 200_000);
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
    controller.update(released, 300_000);
    controller.sendSerialRx('uno', 'B', 300_000);
    executor.advances[0]!.deferred.resolve(timedAdvance('yielded', 0, 0));
    await flush();
    expect(onResult).not.toHaveBeenCalled();
    expect(executor.advances[1]).toMatchObject({
      requestedHorizonMicroseconds: 0,
      inputEvents: [],
    });
    executor.advances[1]!.deferred.resolve(timedAdvance('ready', 0, 0, 1));
    await flush();
    expect(onResult).toHaveBeenCalledExactlyOnceWith(result(1));
    expect(onCommittedHorizon).toHaveBeenLastCalledWith(0);
    expect(executor.advances[2]!.inputEvents).toEqual([
      { atMicroseconds: 1, targetId: 'button', operation: 'state', payload: true },
      { atMicroseconds: 2, targetId: 'uno', operation: 'serialRx', payload: 'A' },
      { atMicroseconds: 3, targetId: 'button', operation: 'state', payload: false },
      { atMicroseconds: 4, targetId: 'uno', operation: 'serialRx', payload: 'B' },
    ]);
    expect(executor.advances[2]).toMatchObject({ requestedHorizonMicroseconds: 100_000 });
    executor.advances[2]!.deferred.resolve(timedAdvance('ready', 100_000, 100_000, 2));
    await flush();
    expect(onResult).toHaveBeenLastCalledWith(result(2));
    expect(executor.advances[3]).toMatchObject({
      requestedHorizonMicroseconds: 200_000,
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
    controller.update(changed, 500_000);
    controller.update(changed, 600_000);
    firstStartup.deferred.resolve(timedAdvance('ready', 0, 0, 99));
    await flush();
    expect(onResult).not.toHaveBeenCalled();
    await completeCanonicalStart(executor, 2, 2);
    expect(onResult).toHaveBeenCalledExactlyOnceWith(result(2));
    expect(executor.advances.at(-1)).toMatchObject({
      generationId: 2,
      requestedHorizonMicroseconds: 100_000,
    });

    controller.stop();
    controller.start('project-a', changed, { onResult, onFailure: vi.fn() });
    controller.update(changed, 200_000);
    await completeCanonicalStart(executor, 3, 3);
    expect(onResult).toHaveBeenLastCalledWith(result(3));
    expect(executor.advances.at(-1)).toMatchObject({
      generationId: 3,
      requestedHorizonMicroseconds: 100_000,
    });
  });

  it.each(['fault', 'missing-result', 'rejection'] as const)(
    'fails closed during the zero-time observation on %s',
    async (mode) => {
      const executor = new FakeExecutor();
      const onResult = vi.fn();
      const onFailure = vi.fn();
      const controller = new ElectronicsLiveSimulationWorkerController(executor);
      controller.start('project-a', circuit, { onResult, onFailure });
      controller.update(circuit, 200_000);
      executor.preflights[0]!.resolve(result(1));
      await flush();
      const startup = executor.advances[0]!;
      if (mode === 'rejection')
        startup.deferred.reject(new SimulationWorkerError('worker-timeout', 'Timed out.'));
      else
        startup.deferred.resolve({
          ...timedAdvance(mode === 'fault' ? 'fault' : 'ready', 0, 0),
          result: null,
        });
      await flush();
      expect(onFailure).toHaveBeenCalledOnce();
      expect(onResult).not.toHaveBeenCalled();
      expect(executor.cancelCount).toBe(1);
      controller.update(circuit, 300_000);
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

    controller.update(circuit, 300_000);
    expect(executor.advances[1]!.requestedHorizonMicroseconds).toBe(100_000);
    executor.advances[1]!.deferred.resolve(timedAdvance('yielded', 100_000, 256));
    await flush();
    expect(onResult).not.toHaveBeenCalled();
    expect(onCommittedHorizon).not.toHaveBeenCalled();
    expect(executor.advances).toHaveLength(3);
    expect(executor.advances[2]).toMatchObject({ requestedHorizonMicroseconds: 256 });
    expect(executor.advances[2]!.state.continuation?.committedHorizonMicroseconds).toBe(256);

    executor.advances[2]!.deferred.resolve(timedAdvance('ready', 256, 256, 3));
    await flush();
    expect(onResult).toHaveBeenCalledWith(result(3));
    expect(onCommittedHorizon).toHaveBeenCalledWith(256);
    expect(executor.advances[3]!.requestedHorizonMicroseconds).toBe(512);
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
    expect(executor.advances[2]).toMatchObject({ requestedHorizonMicroseconds: 200_000 });
    executor.advances[2]!.deferred.resolve(timedAdvance('ready', 200_000, 200_000, 3));
    await flush();
    expect(executor.advances[3]).toMatchObject({ requestedHorizonMicroseconds: 300_000 });
    executor.advances[3]!.deferred.resolve(timedAdvance('ready', 300_000, 300_000));
    await flush();
    expect(executor.advances[4]).toMatchObject({ requestedHorizonMicroseconds: 400_000 });
  });

  it('publishes repeated complete catch-up windows while retaining growing host demand', async () => {
    const executor = new FakeExecutor();
    const onResult = vi.fn();
    const onCommittedHorizon = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, { onResult, onCommittedHorizon, onFailure: vi.fn() });
    controller.update(circuit, 20_000_000);
    await completeCanonicalStart(executor, 1);
    expect(onCommittedHorizon.mock.calls).toEqual([[0]]);

    let committed = 0;
    let window = 100_000;
    for (let completed = 0; completed < 3; completed++) {
      const horizon = committed + window;
      const reached = committed + window / 2;
      const chunk = executor.advances.at(-1)!;
      expect(chunk.requestedHorizonMicroseconds).toBe(horizon);
      expect(chunk.state).toEqual(timedState(committed));
      controller.update(circuit, 30_000_000 + completed * 10_000_000);
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
      expect(onResult).toHaveBeenLastCalledWith(result(completed + 2));
      committed = reached;
      window /= 2;
    }
    expect(executor.advances.at(-1)!.requestedHorizonMicroseconds).toBe(100_000);
    controller.stop();
    executor.advances.at(-1)!.deferred.resolve(timedAdvance('ready', 100_000, 100_000, 99));
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
    controller.update(circuit, 1_200_000);
    const horizons = Array.from({ length: 12 }, (_, index) => (index + 1) * 100_000);
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

    controller.update(circuit, 300_000);
    controller.update(circuit, 500_000);
    executor.advances[1]!.deferred.resolve(timedAdvance('yielded', 100_000, 60_000));
    await flush();

    expect(executor.advances).toHaveLength(3);
    expect(executor.advances[2]).toMatchObject({ requestedHorizonMicroseconds: 60_000 });
    executor.advances[2]!.deferred.resolve(timedAdvance('ready', 60_000, 60_000, 3));
    await flush();

    expect(onResult).toHaveBeenCalledWith(result(3));
    expect(executor.advances).toHaveLength(4);
    expect(executor.advances[3]).toMatchObject({ requestedHorizonMicroseconds: 120_000 });
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

    executor.advances[1]!.deferred.resolve(timedAdvance('yielded', 100_000, 60_000));
    await flush();

    expect(executor.advances).toHaveLength(3);
    expect(executor.advances[2]).toMatchObject({ requestedHorizonMicroseconds: 120_000 });
    expect(executor.advances[2]!.state.continuation?.committedHorizonMicroseconds).toBe(60_000);
    expect(executor.advances[2]!.inputEvents).toEqual([
      { atMicroseconds: 60_001, targetId: 'button', operation: 'state', payload: true },
    ]);
    executor.advances[2]!.deferred.resolve(timedAdvance('ready', 120_000, 120_000, 3));
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

    executor.advances[1]!.deferred.resolve(timedAdvance('yielded', 100_000, 60_000));
    await flush();

    expect(executor.advances).toHaveLength(3);
    expect(executor.advances[2]!.inputEvents).toEqual([
      { atMicroseconds: 60_001, targetId: 'button', operation: 'state', payload: true },
      { atMicroseconds: 60_001, targetId: 'button-2', operation: 'state', payload: true },
      { atMicroseconds: 60_002, targetId: 'button', operation: 'state', payload: false },
    ]);
    expect(executor.advances[2]!.inputEvents[0]!.atMicroseconds).toBe(
      executor.advances[2]!.inputEvents[1]!.atMicroseconds,
    );
    expect(
      executor.advances[2]!.inputEvents[2]!.atMicroseconds -
        executor.advances[2]!.inputEvents[1]!.atMicroseconds,
    ).toBe(1);
    expect(executor.advances[2]!.inputEvents.every((event) => event.atMicroseconds > 60_000)).toBe(
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
    expect(executor.advances[2]).toMatchObject({ requestedHorizonMicroseconds: 200_000 });
    expect(executor.advances[2]!.state.continuation?.committedHorizonMicroseconds).toBe(100_000);
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
    controller.update(circuit, 100_000);
    executor.advances[1]!.deferred.resolve(timedAdvance('ready', 100_000, 100_000, 2));
    await flush();
    expect(onCommittedHorizon).toHaveBeenLastCalledWith(100_000);
    onResult.mockClear();

    controller.update(circuit, 300_000);
    const oldAdvance = executor.advances[2]!;
    controller.restart(circuit);

    expect(executor.generation).toBe(2);
    expect(executor.preflights).toHaveLength(2);
    expect(onGenerationPending).toHaveBeenCalledTimes(2);
    expect(onCommittedHorizon).toHaveBeenLastCalledWith(100_000);

    oldAdvance.deferred.resolve(timedAdvance('ready', 200_000, 200_000, 9));
    await flush();
    expect(onResult).not.toHaveBeenCalled();
    expect(onCommittedHorizon).toHaveBeenLastCalledWith(100_000);

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
    expect(onCommittedHorizon).toHaveBeenLastCalledWith(0);

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
    controller.update(edited, 100_000);

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
    const onResult = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(executor);
    controller.start('project-a', circuit, {
      onResult,
      onFailure: vi.fn(),
      onCommittedHorizon,
      onGenerationPending,
    });
    await completeCanonicalStart(executor, 1);
    controller.update(circuit, 100_000);
    executor.advances.at(-1)!.deferred.resolve(timedAdvance('ready', 100_000, 100_000, 2));
    await flush();
    expect(onCommittedHorizon).toHaveBeenLastCalledWith(100_000);
    controller.update(circuit, 400_000);
    const oldPendingAdvance = executor.advances.at(-1)!;

    const changed = {
      ...circuit,
      components: circuit.components.map((component) =>
        component.id === 'resistor' ? { ...component, value: 470 } : component,
      ),
    };
    controller.update(changed, 500_000);
    expect(executor.generation).toBe(2);
    expect(executor.preflights).toHaveLength(2);
    expect(onGenerationPending).toHaveBeenCalledTimes(2);
    expect(onCommittedHorizon).toHaveBeenLastCalledWith(100_000);
    const resultCount = onResult.mock.calls.length;
    const confirmedCount = onCommittedHorizon.mock.calls.length;
    oldPendingAdvance.deferred.resolve(timedAdvance('ready', 200_000, 200_000, 999));
    await flush();
    expect(onResult).toHaveBeenCalledTimes(resultCount);
    expect(onCommittedHorizon).toHaveBeenCalledTimes(confirmedCount);
    await completeCanonicalStart(executor, 2, 2);
    expect(onCommittedHorizon).toHaveBeenLastCalledWith(0);

    controller.update(changed, 600_000);
    expect(executor.advances.at(-1)).toMatchObject({ requestedHorizonMicroseconds: 100_000 });
    executor.advances.at(-1)!.deferred.resolve(timedAdvance('ready', 100_000, 100_000, 3));
    await flush();
    expect(onCommittedHorizon).toHaveBeenLastCalledWith(100_000);
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

    controller.update(circuit, 100_000);
    executor.advances[1]!.deferred.resolve({
      ...timedAdvance('fault', 100_000, 0),
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
    expect(nextResult).toHaveBeenCalledWith(result(2));
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
    expect(secondResult).toHaveBeenCalledWith(result(2));

    controller.dispose();
    expect(executor.disposeCount).toBe(1);
  });
});

describe('Ready cadence preserves the production canonical engine', () => {
  function physicalFixture(physical: boolean) {
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
