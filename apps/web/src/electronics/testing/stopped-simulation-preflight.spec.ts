import { afterEach, describe, expect, it, vi } from 'vitest';
import { simulationInputDigest, simulationModelSetDigest } from '@asa-lab/electronics/simulation';
import type { SchematicDocument } from '../../api';
import { calculateSimulationPreflight } from '../live-simulation';
import {
  StoppedSimulationPreflightController,
  stoppedSimulationInputKey,
} from '../stopped-simulation-preflight';
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
    { id: 'source', kind: 'source', value: 5, position: { x: 0, y: 0 } },
    { id: 'resistor', kind: 'resistor', value: 220, position: { x: 40, y: 0 } },
    {
      id: 'led',
      kind: 'led',
      componentTypeId: 'led-5mm',
      value: 2,
      pinIds: ['anode', 'cathode'],
      stateProperties: { ledColour: 'red' },
      position: { x: 80, y: 0 },
    },
  ],
  connections: [
    {
      id: 'positive',
      from: { componentId: 'source', terminal: 'a' },
      to: { componentId: 'resistor', terminal: 'a' },
    },
    {
      id: 'load',
      from: { componentId: 'resistor', terminal: 'b' },
      to: { componentId: 'led', terminal: 'anode' },
    },
    {
      id: 'negative',
      from: { componentId: 'led', terminal: 'cathode' },
      to: { componentId: 'source', terminal: 'b' },
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: false, maxIterations: 24 },
};

const resistance = (value: number): SchematicDocument => ({
  ...circuit,
  components: circuit.components.map((component) =>
    component.id === 'resistor' ? { ...component, value } : component,
  ),
});

class ControlledWorker implements ElectronicsSimulationWorkerLike {
  onmessage: ((event: MessageEvent<ElectronicsSimulationWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly requests: SimulationPreflightRequest[] = [];
  terminated = false;
  postMessage(message: ElectronicsSimulationWorkerRequest): void {
    if (message.kind === 'preflight') this.requests.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(index = this.requests.length - 1): void {
    const response = evaluateSimulationWorkerRequest(this.requests[index]!);
    this.onmessage?.({ data: response } as MessageEvent<ElectronicsSimulationWorkerResponse>);
  }
}

const controllers: StoppedSimulationPreflightController[] = [];
function setup() {
  const workers: ControlledWorker[] = [];
  const client = new ElectronicsSimulationWorkerClient(() => {
    const worker = new ControlledWorker();
    workers.push(worker);
    return worker;
  }, 100);
  const controller = new StoppedSimulationPreflightController(client);
  controllers.push(controller);
  controller.open('project-A');
  return { controller, workers, worker: () => workers.at(-1)! };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index++) await Promise.resolve();
}

afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.close();
  await settle();
  vi.useRealTimers();
});

describe('stopped preflight input and accepted cache', () => {
  it('keys installed model, engine and protocol identity alongside electrical input', () => {
    expect(JSON.parse(stoppedSimulationInputKey(circuit))).toMatchObject({
      electrical: simulationInputDigest(circuit, 0),
      modelSet: simulationModelSetDigest(),
      engineRevision: ELECTRONICS_SIMULATION_ENGINE_REVISION,
      protocolVersion: ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
    });
    const versioned: SchematicDocument = {
      ...circuit,
      components: circuit.components.map((component) =>
        component.id === 'resistor'
          ? {
              ...component,
              electricalModelId: 'resistor',
              electricalModelVersion: 99,
              modelProfileId: 'axial-resistor',
              modelProfileVersion: 1,
            }
          : component,
      ),
    };
    expect(stoppedSimulationInputKey(versioned)).not.toBe(stoppedSimulationInputKey(circuit));
  });

  it('includes and refreshes every Arduino source, including variant-only boards, with deterministic ordering', async () => {
    const boards: SchematicDocument = {
      ...circuit,
      components: [
        ...circuit.components,
        {
          id: 'uno-A',
          kind: 'visual',
          componentTypeId: 'arduino-uno',
          value: 5,
          position: { x: 0, y: 90 },
          stateProperties: { arduinoSource: 'void setup(){}void loop(){}' },
        },
        {
          id: 'uno-B',
          kind: 'visual',
          variantId: 'arduino-uno',
          value: 5,
          position: { x: 90, y: 90 },
          stateProperties: { arduinoSource: 'void setup(){}void loop(){delay(100);}' },
        },
      ],
    };
    const edited: SchematicDocument = {
      ...boards,
      components: boards.components.map((component) =>
        component.id === 'uno-B'
          ? {
              ...component,
              stateProperties: { arduinoSource: 'void setup(){digitalWrite(13,);}void loop(){}' },
            }
          : component,
      ),
    };
    expect(simulationInputDigest(boards)).toBe(simulationInputDigest(edited));
    expect(stoppedSimulationInputKey(boards)).not.toBe(stoppedSimulationInputKey(edited));
    expect(
      stoppedSimulationInputKey({ ...boards, components: [...boards.components].reverse() }),
    ).toBe(stoppedSimulationInputKey(boards));
    const { controller, worker } = setup();
    controller.update(boards);
    worker().reply();
    await settle();
    controller.update(edited);
    expect(worker().requests).toHaveLength(2);
    expect(controller.getSnapshot()).toMatchObject({ pending: true, result: null });
    worker().reply();
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      pending: false,
      error: null,
      inputKey: stoppedSimulationInputKey(edited),
    });
  });

  it.each<[string, SchematicDocument]>([
    ['pan/zoom', { ...circuit, viewport: { x: 900, y: -500, zoom: 0.5 } }],
    [
      'component movement',
      {
        ...circuit,
        components: circuit.components.map((component) => ({
          ...component,
          position: { x: 800, y: 400 },
        })),
      },
    ],
    [
      'wire colour and vertices',
      {
        ...circuit,
        connections: circuit.connections.map((connection) => ({
          ...connection,
          color: '#00ff00',
          vertices: [{ x: 999, y: 999 }],
        })),
      },
    ],
    [
      'annotation',
      {
        ...circuit,
        schemaVersion: 5,
        annotations: [
          {
            id: 'note',
            text: 'Test',
            position: { x: 0, y: 0 },
            size: { width: 80, height: 40 },
            fontSize: 14,
          },
        ],
      },
    ],
  ])(
    'reuses the accepted result for %s without another Worker request',
    async (_name, document) => {
      const { controller, worker, workers } = setup();
      controller.update(circuit);
      worker().reply();
      await settle();
      const accepted = controller.getSnapshot();
      expect(accepted.result?.solved).toBe(true);
      controller.update(document);
      expect(controller.getSnapshot()).toBe(accepted);
      expect(worker().requests).toHaveLength(1);
      expect(workers).toHaveLength(1);
    },
  );

  it('recalculates electrical changes and uses accepted Undo/Redo inputs from its cache', async () => {
    const { controller, worker } = setup();
    controller.update(circuit);
    worker().reply();
    await settle();
    const first = controller.getSnapshot().result;
    controller.update(resistance(330));
    expect(controller.getSnapshot()).toMatchObject({ pending: true, result: null });
    worker().reply();
    await settle();
    const second = controller.getSnapshot().result;
    expect(second?.current).not.toBe(first?.current);
    controller.update(circuit);
    expect(controller.getSnapshot().result).toBe(first);
    controller.update(resistance(330));
    expect(controller.getSnapshot().result).toBe(second);
    expect(worker().requests).toHaveLength(2);
    controller.update({ ...circuit, connections: circuit.connections.slice(1) });
    expect(worker().requests).toHaveLength(3);
    worker().reply();
    await settle();
    expect(controller.getSnapshot().result).not.toEqual(first);
  });

  it('preserves wire-colour results but recalculates current for a physical LED colour', async () => {
    const { controller, worker } = setup();
    controller.update(circuit);
    worker().reply();
    await settle();
    const red = controller.getSnapshot().result!;
    const wireColour = {
      ...circuit,
      connections: circuit.connections.map((connection) => ({ ...connection, color: '#1122ff' })),
    };
    controller.update(wireColour);
    expect(controller.getSnapshot().result).toBe(red);
    expect(
      calculateSimulationPreflight({
        ...wireColour,
        simulation: { ...wireColour.simulation, running: true },
      }),
    ).toEqual(red);
    const blue: SchematicDocument = {
      ...circuit,
      components: circuit.components.map((component) =>
        component.id === 'led'
          ? { ...component, stateProperties: { ledColour: 'blue' } }
          : component,
      ),
    };
    controller.update(blue);
    worker().reply();
    await settle();
    expect(worker().requests).toHaveLength(2);
    expect(controller.getSnapshot().result?.solved).toBe(true);
    expect(
      controller
        .getSnapshot()
        .result?.components.find((component) => component.componentId === 'led')?.current,
    ).not.toBe(red.components.find((component) => component.componentId === 'led')?.current);
  });

  it('bounds accepted-result storage and recomputes an evicted old input', async () => {
    const { controller, worker } = setup();
    for (let index = 0; index < 10; index++) {
      controller.update(resistance(220 + index));
      worker().reply();
      await settle();
    }
    controller.update(resistance(220));
    expect(controller.getSnapshot()).toMatchObject({ pending: true, result: null });
    expect(worker().requests).toHaveLength(11);
  });
});

describe('stopped preflight request and session lifecycle', () => {
  it('coalesces duplicate requests and keeps only the latest queued physical input', async () => {
    const { controller, worker, workers } = setup();
    controller.update(circuit);
    controller.update({ ...circuit });
    expect(worker().requests).toHaveLength(1);
    for (let index = 0; index < 100; index++) controller.update(resistance(300 + index));
    expect(worker().requests).toHaveLength(1);
    worker().reply(0);
    await settle();
    expect(controller.getSnapshot()).toMatchObject({ pending: true, result: null });
    expect(worker().requests).toHaveLength(2);
    expect(worker().requests[1]!.document.components[1]!.value).toBe(399);
    worker().reply(1);
    await settle();
    expect(controller.getSnapshot()).toMatchObject({ pending: false, error: null });
    expect(workers).toHaveLength(1);
  });

  it('rejects an unfinished old A in A → B → A and solves the new A request', async () => {
    const { controller, worker } = setup();
    controller.update(circuit);
    controller.update(resistance(330));
    controller.update(circuit);
    worker().reply(0);
    await settle();
    expect(controller.getSnapshot()).toMatchObject({ pending: true, result: null });
    expect(worker().requests).toHaveLength(2);
    worker().reply(1);
    await settle();
    expect(controller.getSnapshot()).toMatchObject({ pending: false, error: null });
    expect(controller.getSnapshot().result?.solved).toBe(true);
  });

  it('never applies responses from an earlier project session, including reopening the same ID', async () => {
    const { controller, worker, workers } = setup();
    controller.update(circuit);
    const old = worker();
    const oldHandler = old.onmessage!;
    const oldRequest = old.requests[0]!;
    controller.open('project-B');
    controller.update(circuit);
    controller.open('project-A');
    controller.update(circuit);
    expect(old.terminated).toBe(true);
    expect(workers).toHaveLength(3);
    expect(new Set(workers.map((entry) => entry.requests[0]!.projectSessionId)).size).toBe(3);
    oldHandler({
      data: evaluateSimulationWorkerRequest(oldRequest),
    } as MessageEvent<ElectronicsSimulationWorkerResponse>);
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      projectId: 'project-A',
      pending: true,
      result: null,
      error: null,
    });
    worker().reply();
    await settle();
    const accepted = controller.getSnapshot();
    controller.close();
    controller.open('project-A');
    controller.update(circuit);
    expect(controller.getSnapshot().projectSessionId).not.toBe(accepted.projectSessionId);
    expect(controller.getSnapshot()).toMatchObject({ pending: true, result: null });
  });

  it('keeps an accepted cache hit when an obsolete in-flight request fails', async () => {
    const { controller, worker, workers } = setup();
    controller.update(circuit);
    worker().reply();
    await settle();
    const accepted = controller.getSnapshot().result;
    controller.update(resistance(330));
    controller.update(circuit);
    worker().onerror?.({ message: 'old request failed' } as ErrorEvent);
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      result: accepted,
      pending: false,
      error: null,
    });
    controller.update(resistance(470));
    expect(workers).toHaveLength(2);
    worker().reply();
    await settle();
    expect(controller.getSnapshot()).toMatchObject({ pending: false, error: null });
  });

  it('recovers the latest queued input after an obsolete transport crashes', async () => {
    const { controller, worker, workers } = setup();
    controller.update(circuit);
    controller.update(resistance(330));
    worker().onerror?.({ message: 'old crash' } as ErrorEvent);
    await settle();
    expect(workers).toHaveLength(2);
    expect(controller.getSnapshot()).toMatchObject({ pending: true, error: null });
    worker().reply();
    await settle();
    expect(controller.getSnapshot().result?.solved).toBe(true);
  });

  it.each(['crash', 'message', 'timeout', 'protocol'] as const)(
    'ends current pending and exposes a technical %s failure',
    async (kind) => {
      vi.useFakeTimers();
      const { controller, worker } = setup();
      controller.update(circuit);
      if (kind === 'crash') worker().onerror?.({ message: 'Worker crashed' } as ErrorEvent);
      else if (kind === 'message') worker().onmessageerror?.({} as MessageEvent);
      else if (kind === 'timeout') await vi.advanceTimersByTimeAsync(100);
      else {
        const response = evaluateSimulationWorkerRequest(worker().requests[0]!)!;
        worker().onmessage?.({
          data: { ...response, ok: false, code: 'protocol-mismatch', message: 'wrong protocol' },
        } as MessageEvent<ElectronicsSimulationWorkerResponse>);
      }
      await settle();
      expect(controller.getSnapshot()).toMatchObject({
        pending: false,
        result: null,
        error: { category: 'technical' },
      });
    },
  );

  it('reports unavailable Worker without a synchronous solver fallback', async () => {
    const client = new ElectronicsSimulationWorkerClient(() => {
      throw new Error('Worker unavailable');
    });
    const controller = new StoppedSimulationPreflightController(client);
    controllers.push(controller);
    controller.open('unsupported-browser');
    controller.update(circuit);
    await settle();
    expect(controller.getSnapshot()).toMatchObject({
      pending: false,
      result: null,
      error: { category: 'technical', code: 'worker-start' },
    });
  });
});
