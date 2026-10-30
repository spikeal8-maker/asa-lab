// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ElectronicsSimulationArtifact } from '@asa-lab/contracts';
import {
  ElectronicsLiveSimulationWorkerController,
  type LiveSimulationWorkerCallbacks,
} from '../electronics/live-simulation-worker-controller';
import {
  ElectronicsSimulationWorkerClient,
  type ElectronicsSimulationWorkerLike,
} from '../electronics/simulation-worker-client';
import {
  PUBLIC_SIMULATION_BUDGET,
  PublicElectronicsRuntime,
  publicSimulationDocument,
} from './electronics-public-runtime';

const artifact = (): ElectronicsSimulationArtifact => ({
  schemaVersion: 3,
  status: 'simulation',
  viewerFamily: 'electronics',
  solverIterations: 24,
  provenance: { publicationId: '123e4567-e89b-42d3-a456-426614174001', revisionNumber: 1 },
  capabilities: { readOnly: true, interactive: true, download: false },
  components: [
    { id: 'button', kind: 'button', position: { x: 0, y: 0 }, value: 0, state: false },
    {
      id: 'uno',
      kind: 'visual',
      componentTypeId: 'arduino-uno',
      position: { x: 50, y: 50 },
      value: 5,
      stateProperties: {
        arduinoSource:
          'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,LOW);delay(10);}',
      },
    },
  ],
  connections: [],
});
function setup() {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  let callbacks!: LiveSimulationWorkerCallbacks;
  const controller = {
    start: vi.fn((_id, _doc, value) => {
      callbacks = value;
    }),
    update: vi.fn(),
    dispose: vi.fn(),
  };
  const stop = vi.fn();
  const source = artifact();
  const host = new PublicElectronicsRuntime(
    source,
    stop,
    controller as unknown as ElectronicsLiveSimulationWorkerController,
  );
  host.start();
  callbacks.onInitialReady!(0);
  return { host, source, stop, controller, callbacks };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('bounded public electronics host', () => {
  it('terminates an unresponsive Worker at the public request deadline', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const worker: ElectronicsSimulationWorkerLike = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };
    const stop = vi.fn();
    const controller = new ElectronicsLiveSimulationWorkerController(
      new ElectronicsSimulationWorkerClient(() => worker, PUBLIC_SIMULATION_BUDGET.requestMs),
    );
    const host = new PublicElectronicsRuntime(artifact(), stop, controller);
    host.start();
    await vi.advanceTimersByTimeAsync(PUBLIC_SIMULATION_BUDGET.requestMs + 1);
    expect(worker.terminate).toHaveBeenCalled();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(host.port.getSnapshot().committed).toBeNull();
    host.dispose();
  });
  it('bounds the entire session independently of successful request completions', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const { host, controller, stop } = setup();
    now.mockReturnValue(PUBLIC_SIMULATION_BUDGET.sessionMs + 1);
    const raf = vi.mocked(requestAnimationFrame).mock.calls[0]![0];
    raf(PUBLIC_SIMULATION_BUDGET.sessionMs + 1);
    expect(controller.dispose).toHaveBeenCalled();
    expect(stop).toHaveBeenCalledWith(expect.stringContaining('Время просмотра'));
    host.dispose();
  });
  it('uses exactly published saved source and keeps transient inputs out of immutable artifact', () => {
    const { host, source, controller } = setup();
    const frozen = JSON.stringify(source);
    host.input('button', { state: true });
    host.input('button', { state: false });
    expect(controller.update).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(source)).toBe(frozen);
    expect(publicSimulationDocument(source).components[1]!.stateProperties?.arduinoSource).toBe(
      source.components[1]!.stateProperties?.arduinoSource,
    );
    host.dispose();
    expect(host.port.getSnapshot().observation).toBeNull();
    expect(host.input('button', { state: true })).toBeNull();
  });
  it('deduplicates releases and invalid controls before enqueueing', () => {
    const { host, controller } = setup();
    host.input('button', { state: false });
    host.input('uno', { state: true });
    host.input('button', { wiperPosition: NaN });
    expect(controller.update).not.toHaveBeenCalled();
    host.input('button', { state: true });
    host.input('button', { state: false });
    host.input('button', { state: false });
    expect(controller.update).toHaveBeenCalledTimes(2);
    host.dispose();
  });
  it('cancels the whole generation on flood instead of dropping a release in a live worker', () => {
    const { host, controller, stop, callbacks } = setup();
    for (let i = 0; i <= PUBLIC_SIMULATION_BUDGET.inputsPerSecond; i++)
      host.input('button', { state: i % 2 === 0 });
    expect(controller.update).toHaveBeenCalledTimes(PUBLIC_SIMULATION_BUDGET.inputsPerSecond);
    expect(controller.dispose).toHaveBeenCalled();
    expect(stop).toHaveBeenCalledWith(expect.stringContaining('Слишком много'));
    expect(callbacks.readHostHorizonMicroseconds!()).toBeNull();
    expect(host.port.getSnapshot().committed).toBeNull();
  });
  it('ignores late generation callbacks after stop and clears presentation leases', () => {
    const { host, callbacks, stop } = setup();
    host.stop();
    callbacks.onInitialReady!(100000);
    callbacks.onFailure(new Error('late') as never);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(host.port.getSnapshot()).toMatchObject({
      observation: null,
      committed: null,
      preparation: null,
      rollback: null,
    });
  });
});
