/* @vitest-environment jsdom */
import { act, createElement, startTransition, StrictMode, Suspense, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type Project, type SchematicDocument, type SolveResult } from '../../api';
import type { LiveSimulationWorkerCallbacks } from '../live-simulation-worker-controller';
import { ElectronicsLiveSimulationWorkerController } from '../live-simulation-worker-controller';
import { loadSimulationWorkerController } from '../load-simulation-worker-controller';
import { SimulationFailure } from '../simulation-failure';
import { useElectronicsWorkbench } from '../use-electronics-workbench';

const transport = vi.hoisted(() => ({
  autoReady: true,
  instances: [] as Array<{
    callbacks?: LiveSimulationWorkerCallbacks;
    start: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    restart: ReturnType<typeof vi.fn>;
    sendSerialRx: ReturnType<typeof vi.fn>;
  }>,
}));
vi.mock('../live-simulation-worker-controller', () => ({
  ElectronicsLiveSimulationWorkerController: class {
    callbacks?: LiveSimulationWorkerCallbacks;
    start = vi.fn((_id, _document, callbacks: LiveSimulationWorkerCallbacks) => {
      this.callbacks = callbacks;
      callbacks.onGenerationPending?.();
      if (transport.autoReady) {
        callbacks.onInitialReady?.(0);
        callbacks.onCommittedHorizon?.(0);
        callbacks.onResult(ready);
      }
    });
    update = vi.fn();
    stop = vi.fn();
    restart = vi.fn(() => {
      this.callbacks?.onGenerationPending?.();
      if (transport.autoReady) {
        this.callbacks?.onInitialReady?.(0);
        this.callbacks?.onCommittedHorizon?.(0);
        this.callbacks?.onResult(ready);
      }
    });
    sendSerialRx = vi.fn();
    constructor() {
      transport.instances.push(this);
    }
  },
}));
vi.mock('../use-piezo-audio', () => ({
  unlockPiezoAudio: async () => {},
  usePiezoAudio: () => {},
}));
vi.mock('../load-simulation-worker-controller', () => ({
  loadSimulationWorkerController: vi.fn(),
}));
vi.mock('../../client-diagnostics', () => ({ reportClientDiagnostic: vi.fn() }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// The real workbench and project-state hooks run here. Only transport/audio is
// replaced. Fake wall time tests host scheduling, never electrical throughput.
const initial: SchematicDocument = {
  schemaVersion: 4,
  components: [
    {
      id: 'uno',
      kind: 'visual',
      componentTypeId: 'arduino-uno',
      value: 5,
      position: { x: 0, y: 0 },
      stateProperties: { arduinoSource: 'void setup(){}void loop(){delay(100);}' },
    },
    { id: 'switch', kind: 'switch', value: 0, state: false, position: { x: 100, y: 0 } },
  ],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: false, maxIterations: 24 },
};
const ready: SolveResult = {
  solved: true,
  status: 'solved',
  current: 1,
  components: [],
  nodes: [],
  diagnostics: [],
  iterations: 1,
  numericalResidual: 0,
  numericalTolerance: 1e-9,
};
let host: HTMLDivElement;
let root: Root;
let workbench: ReturnType<typeof useElectronicsWorkbench>;
let renders: number;
let suspendRender: Promise<void> | null;
let onLayoutCommit: (() => void) | null;
function Probe({ id = 'clock-project' }: { id?: string }) {
  workbench = useElectronicsWorkbench(id, 'clock-pupil');
  useLayoutEffect(() => onLayoutCommit?.());
  renders += 1;
  if (suspendRender) throw suspendRender;
  return createElement(
    'output',
    null,
    `${workbench.simulationTimeMs}:${workbench.result?.current}`,
  );
}
const worker = () => transport.instances.at(-1)!;
function deferredController() {
  let resolve!: (controller: typeof ElectronicsLiveSimulationWorkerController) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<typeof ElectronicsLiveSimulationWorkerController>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  vi.mocked(loadSimulationWorkerController).mockReturnValueOnce(promise);
  return { resolve: () => resolve(ElectronicsLiveSimulationWorkerController), reject };
}
async function mount(id = 'clock-project') {
  await act(async () =>
    root.render(createElement(Suspense, { fallback: 'pending' }, createElement(Probe, { id }))),
  );
  expect(workbench.status).toBe('ready');
}
async function tick(milliseconds: number) {
  await act(async () => vi.advanceTimersByTime(milliseconds));
}
function intervalCallback(): () => void {
  const call = vi.mocked(window.setInterval).mock.calls.find((entry) => entry[1] === 10);
  expect(call).toBeDefined();
  return call![0] as () => void;
}
beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
  vi.setSystemTime(0);
  vi.spyOn(window.performance, 'now').mockImplementation(() => Date.now());
  vi.spyOn(window, 'setInterval');
  localStorage.clear();
  transport.instances.length = 0;
  transport.autoReady = true;
  vi.mocked(loadSimulationWorkerController)
    .mockReset()
    .mockResolvedValue(ElectronicsLiveSimulationWorkerController);
  renders = 0;
  suspendRender = null;
  onLayoutCommit = null;
  vi.spyOn(api, 'me').mockResolvedValue({
    ok: true,
    status: 200,
    data: { authenticated: true, user: { id: 'clock-pupil' } },
  } as Awaited<ReturnType<typeof api.me>>);
  vi.spyOn(api, 'openProject').mockImplementation(
    async (id) =>
      ({
        ok: true,
        status: 200,
        data: {
          project: {
            id,
            moduleKey: 'electronics',
            title: id,
            scope: 'personal',
            classroomId: null,
            status: 'active',
          } as Project,
          draft: { projectId: id, document: initial, revision: 1, updatedAt: '' },
          versions: [],
          result: null,
        },
      }) as Awaited<ReturnType<typeof api.openProject>>,
  );
  vi.spyOn(api, 'saveDraft');
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('mounted workbench host demand clock', () => {
  it('loads only after Start and preserves every pending committed input in order before H0', async () => {
    const loading = deferredController();
    transport.autoReady = false;
    await mount();
    await tick(50);
    expect(loadSimulationWorkerController).not.toHaveBeenCalled();
    expect(transport.instances).toHaveLength(0);
    await act(async () => workbench.toggleSimulation());
    expect(loadSimulationWorkerController).toHaveBeenCalledTimes(1);
    await tick(2000);
    expect(workbench.simulationStatus).toBe('starting');
    expect(workbench.simulationTimeMs).toBe(0);
    expect(transport.instances).toHaveLength(0);
    await act(async () => workbench.toggleComponentState('switch'));
    workbench.sendArduinoSerialRx('uno', 'first');
    const source = 'void setup(){}void loop(){delay(77);}';
    await act(async () => workbench.updateArduinoProgram('uno', { arduinoSource: source }));
    await act(async () => workbench.resetArduinoRuntime('uno'));
    workbench.sendArduinoSerialRx('uno', 'after reset');
    await act(async () => workbench.toggleComponentState('switch'));
    await act(async () => loading.resolve());
    const instance = worker();
    expect(instance.start).toHaveBeenCalledTimes(1);
    expect(instance.start.mock.calls[0]![1].components[1].state).toBe(false);
    const calls = [
      ...instance.update.mock.calls.map((args, i) => ({
        order: instance.update.mock.invocationCallOrder[i]!,
        value: [
          'update',
          args[0].components[1].state,
          args[0].components[0].stateProperties.arduinoSource,
          args[1],
        ],
      })),
      ...instance.sendSerialRx.mock.calls.map((args, i) => ({
        order: instance.sendSerialRx.mock.invocationCallOrder[i]!,
        value: ['serial', ...args],
      })),
      ...instance.restart.mock.calls.map((args, i) => ({
        order: instance.restart.mock.invocationCallOrder[i]!,
        value: [
          'restart',
          args[0].components[1].state,
          args[0].components[0].stateProperties.arduinoSource,
        ],
      })),
    ]
      .sort((a, b) => a.order - b.order)
      .map((call) => call.value);
    expect(calls).toEqual([
      ['update', false, initial.components[0]!.stateProperties!.arduinoSource, 0],
      ['update', true, initial.components[0]!.stateProperties!.arduinoSource, 0],
      ['serial', 'uno', 'first', 0],
      ['update', true, source, 0],
      ['restart', true, source],
      ['serial', 'uno', 'after reset', 0],
      ['update', false, source, 0],
    ]);
    await tick(500);
    expect(workbench.simulationTimeMs).toBe(0);
    await act(async () => {
      instance.callbacks!.onInitialReady!(0);
      instance.callbacks!.onCommittedHorizon!(0);
      instance.callbacks!.onResult(ready);
    });
    await tick(10);
    expect(instance.update.mock.calls.at(-1)![1]).toBe(10_000);
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it('reports a failed capability load and retries on the next Start', async () => {
    const loading = deferredController();
    await mount();
    await act(async () => workbench.toggleSimulation());
    workbench.sendArduinoSerialRx('uno', 'discard failed run');
    await act(async () => loading.reject(new Error('chunk unavailable')));
    expect(workbench.simulationRunning).toBe(false);
    expect(workbench.simulationMessage?.code).toBe('worker-start');
    expect(workbench.result).toBeNull();
    expect(transport.instances).toHaveLength(0);
    await act(async () => workbench.toggleSimulation());
    expect(loadSimulationWorkerController).toHaveBeenCalledTimes(2);
    expect(worker().sendSerialRx).not.toHaveBeenCalled();
    expect(workbench.result).toBe(ready);
    await tick(10);
    expect(worker().update.mock.calls.at(-1)![1]).toBe(10_000);
  });

  for (const outcome of ['resolve', 'reject'] as const) {
    it(`ignores stale load ${outcome} after Stop and a newer Start`, async () => {
      const loading = deferredController();
      await mount();
      await act(async () => workbench.toggleSimulation());
      workbench.sendArduinoSerialRx('uno', 'old run');
      await act(async () => workbench.toggleSimulation());
      expect(workbench.simulationRunning).toBe(false);
      await act(async () => workbench.toggleSimulation());
      const current = worker();
      await act(async () =>
        outcome === 'resolve' ? loading.resolve() : loading.reject(new Error('old failure')),
      );
      expect(transport.instances).toHaveLength(1);
      expect(worker()).toBe(current);
      expect(current.start).toHaveBeenCalledTimes(1);
      expect(current.sendSerialRx).not.toHaveBeenCalled();
      expect(workbench.simulationMessage).toBeNull();
      expect(workbench.result).toBe(ready);
    });
  }

  for (const destination of ['replacement', 'unmount'] as const) {
    it(`discards a pending capability after ${destination}`, async () => {
      const loading = deferredController();
      await mount();
      await act(async () => workbench.toggleSimulation());
      workbench.sendArduinoSerialRx('uno', 'old project');
      if (destination === 'replacement') await mount('replacement');
      else await act(async () => root.render(null));
      await act(async () => loading.resolve());
      expect(transport.instances).toHaveLength(0);
      if (destination === 'replacement') {
        await act(async () => workbench.toggleSimulation());
        expect(worker().start.mock.calls[0]![0]).toBe('replacement');
        expect(worker().sendSerialRx).not.toHaveBeenCalled();
      }
    });
  }

  for (const strict of [false, true]) {
    it(`keeps a pending load across Suspense hide/reveal${strict ? ' with StrictMode' : ''}`, async () => {
      const loading = deferredController();
      transport.autoReady = false;
      const scene = () => {
        const child = createElement(Suspense, { fallback: 'pending' }, createElement(Probe));
        return strict ? createElement(StrictMode, null, child) : child;
      };
      await act(async () => root.render(scene()));
      await act(async () => workbench.toggleSimulation());
      await act(async () => workbench.toggleComponentState('switch'));
      let resume!: () => void;
      await act(async () => {
        suspendRender = new Promise<void>((resolve) => {
          resume = resolve;
        });
        root.render(scene());
      });
      expect(host.textContent).toContain('pending');
      await act(async () => loading.resolve());
      expect(worker().start).toHaveBeenCalledTimes(1);
      expect(worker().update.mock.calls.at(-1)![0].components[1].state).toBe(true);
      await tick(500);
      expect(workbench.simulationTimeMs).toBe(0);
      await act(async () => {
        suspendRender = null;
        resume();
      });
      expect(host.textContent).not.toContain('pending');
      expect(loadSimulationWorkerController).toHaveBeenCalledTimes(1);
      await act(async () => {
        worker().callbacks!.onInitialReady!(0);
        worker().callbacks!.onCommittedHorizon!(0);
        worker().callbacks!.onResult(ready);
      });
      await tick(10);
      expect(worker().update.mock.calls.at(-1)![1]).toBe(10_000);
    });
  }

  it('waits through preflight and H0, then retains elapsed demand across later ready frames', async () => {
    transport.autoReady = false;
    await mount();
    await act(async () => workbench.toggleSimulation());
    worker().update.mockClear();
    await tick(750);
    expect(worker().update).not.toHaveBeenCalled();
    expect(workbench.result).toBeNull();
    // A preflight result or an incomplete/yielded checkpoint cannot start time.
    await act(async () => worker().callbacks!.onSerialProjection!([]));
    await tick(250);
    expect(worker().update).not.toHaveBeenCalled();
    await act(async () => {
      worker().callbacks!.onInitialReady!(0);
      worker().callbacks!.onCommittedHorizon!(0);
      worker().callbacks!.onResult(ready);
    });
    await tick(30);
    expect(worker().update.mock.calls.map((call) => call[1])).toEqual([10_000, 20_000, 30_000]);
    await act(async () => {
      worker().callbacks!.onCommittedHorizon!(10_000);
      worker().callbacks!.onResult({ ...ready, current: 2 });
    });
    await tick(20);
    expect(worker().update.mock.calls.at(-1)![1]).toBe(50_000);
    expect(workbench.committedSimulationTimeMs).toBe(10);
    expect(workbench.result?.current).toBe(2);
  });

  it('retains pending controls and Serial, and anchors genuine resets without offset debt', async () => {
    await mount();
    await act(async () => workbench.toggleSimulation());
    await tick(80);
    await act(async () => worker().callbacks!.onGenerationPending!());
    worker().update.mockClear();
    await tick(500);
    expect(worker().update).not.toHaveBeenCalled();
    await act(async () => workbench.toggleComponentState('switch'));
    expect(worker().update.mock.calls.at(-1)![1]).toBe(80_000);
    expect((worker().update.mock.calls.at(-1)![0] as SchematicDocument).components[1]!.state).toBe(
      true,
    );
    workbench.sendArduinoSerialRx('uno', 'queued');
    expect(worker().sendSerialRx).toHaveBeenLastCalledWith('uno', 'queued', 80_000);
    await act(async () => worker().callbacks!.onInitialReady!(80_000));
    await tick(10);
    expect(worker().update.mock.calls.at(-1)![1]).toBe(90_000);
    transport.autoReady = false;
    await act(async () => workbench.resetArduinoRuntime('uno'));
    worker().update.mockClear();
    await tick(500);
    expect(worker().update).not.toHaveBeenCalled();
    workbench.sendArduinoSerialRx('uno', 'reset queue');
    expect(worker().sendSerialRx).toHaveBeenLastCalledWith('uno', 'reset queue', 0);
    await act(async () => worker().callbacks!.onInitialReady!(0));
    await tick(10);
    expect(worker().update.mock.calls.at(-1)![1]).toBe(10_000);
  });

  it('rejects old initial-ready callbacks after Stop, project replacement and unmount', async () => {
    transport.autoReady = false;
    await mount();
    await act(async () => workbench.toggleSimulation());
    const stopped = worker().callbacks!;
    await act(async () => workbench.toggleSimulation());
    await act(async () => workbench.toggleSimulation());
    await act(async () => stopped.onInitialReady!(999_000));
    worker().update.mockClear();
    await tick(50);
    expect(worker().update).not.toHaveBeenCalled();
    const replaced = worker().callbacks!;
    await mount('new-project');
    await act(async () => workbench.toggleSimulation());
    await act(async () => replaced.onInitialReady!(999_000));
    worker().update.mockClear();
    await tick(50);
    expect(worker().update).not.toHaveBeenCalled();
    const unmounted = worker().callbacks!;
    await act(async () => root.render(null));
    await act(async () => unmounted.onInitialReady!(999_000));
    await tick(50);
    expect(worker().update).not.toHaveBeenCalled();
  });
  for (const strict of [false, true]) {
    it(`resumes the same clock after Suspense hide/reveal${strict ? ' with StrictMode replay' : ''}`, async () => {
      const scene = () => {
        const child = createElement(Suspense, { fallback: 'pending' }, createElement(Probe));
        return strict ? createElement(StrictMode, null, child) : child;
      };
      await act(async () => root.render(scene()));
      expect(workbench.status).toBe('ready');
      await act(async () => workbench.toggleSimulation());
      await tick(20);
      const starts = worker().start.mock.calls.length;
      const restarts = worker().restart.mock.calls.length;
      const intervals = vi
        .mocked(window.setInterval)
        .mock.calls.filter((entry) => entry[1] === 10).length;
      let resume!: () => void;
      await act(async () => {
        suspendRender = new Promise<void>((resolve) => {
          resume = resolve;
        });
        root.render(scene());
      });
      expect(host.textContent).toContain('pending');
      worker().update.mockClear();
      await tick(20);
      expect(worker().update).not.toHaveBeenCalled();
      await act(async () => {
        suspendRender = null;
        resume();
      });
      expect(host.textContent).not.toContain('pending');
      worker().update.mockClear();
      for (let turn = 0; turn < 5; turn += 1) await tick(10);
      expect(worker().update.mock.calls.map((call) => call[1])).toEqual([
        50_000, 60_000, 70_000, 80_000, 90_000,
      ]);
      expect(worker().start).toHaveBeenCalledTimes(starts);
      expect(worker().restart).toHaveBeenCalledTimes(restarts);
      expect(
        vi.mocked(window.setInterval).mock.calls.filter((entry) => entry[1] === 10),
      ).toHaveLength(intervals);
    });
  }

  it('does not publish an aborted pending edit after a newer source has committed', async () => {
    await mount();
    await act(async () => workbench.toggleSimulation());
    await tick(20);
    const losingSource = 'void setup(){}void loop(){delay(999);}';
    let resume!: () => void;
    await act(async () =>
      startTransition(() => {
        suspendRender = new Promise<void>((resolve) => {
          resume = resolve;
        });
        workbench.updateArduinoProgram('uno', {
          arduinoSource: losingSource,
        });
      }),
    );
    worker().update.mockClear();
    await tick(10);
    expect(
      (worker().update.mock.calls.at(-1)![0] as SchematicDocument).components[0]!.stateProperties!
        .arduinoSource,
    ).toBe(initial.components[0]!.stateProperties!.arduinoSource);
    const winningSource = 'void setup(){}void loop(){delay(77);}';
    await act(async () => {
      suspendRender = null;
      workbench.updateArduinoProgram('uno', { arduinoSource: winningSource });
    });
    await act(async () => resume());
    await tick(10);
    expect(
      (worker().update.mock.calls.at(-1)![0] as SchematicDocument).components[0]!.stateProperties!
        .arduinoSource,
    ).toBe(winningSource);
    expect(
      worker().update.mock.calls.some(
        (call) =>
          (call[0] as SchematicDocument).components[0]!.stateProperties!.arduinoSource ===
          losingSource,
      ),
    ).toBe(false);
  });

  it('withholds suspended source edits from the active Worker until the transition commits', async () => {
    await mount();
    await act(async () => workbench.toggleSimulation());
    const oldTick = intervalCallback();
    await tick(20);
    const oldSource = initial.components[0]!.stateProperties!.arduinoSource;
    const newSource = 'void setup(){}void loop(){delay(999);}';
    const oldDom = host.textContent;
    let resume!: () => void;
    await act(async () => {
      startTransition(() => {
        suspendRender = new Promise<void>((resolve) => {
          resume = resolve;
        });
        workbench.updateArduinoProgram('uno', { arduinoSource: newSource });
      });
    });
    expect(host.textContent).toBe(oldDom);
    expect(host.textContent).not.toBe('pending');
    worker().update.mockClear();
    await tick(10);
    expect(worker().update).toHaveBeenCalled();
    expect(
      (worker().update.mock.calls.at(-1)![0] as SchematicDocument).components[0]!.stateProperties!
        .arduinoSource,
    ).toBe(oldSource);
    await act(async () => {
      oldTick();
      suspendRender = null;
      resume();
    });
    expect(host.textContent).not.toBe(oldDom);
    expect(
      (worker().update.mock.calls.at(-1)![0] as SchematicDocument).components[0]!.stateProperties!
        .arduinoSource,
    ).toBe(newSource);
    worker().update.mockClear();
    await tick(10);
    expect(
      (worker().update.mock.calls.at(-1)![0] as SchematicDocument).components[0]!.stateProperties!
        .arduinoSource,
    ).toBe(newSource);
  });

  it('invalidates old project and Stop ticks during layout commit before passive cleanup', async () => {
    await mount();
    await act(async () => workbench.toggleSimulation());
    const oldTick = intervalCallback();
    await tick(20);
    const sentAtLayout: number[] = [];
    onLayoutCommit = () => {
      const before = worker().update.mock.calls.length;
      oldTick();
      sentAtLayout.push(worker().update.mock.calls.length - before);
    };
    await act(async () => {
      startTransition(() =>
        root.render(
          createElement(
            Suspense,
            { fallback: 'pending' },
            createElement(Probe, { id: 'layout-project' }),
          ),
        ),
      );
    });
    expect(sentAtLayout.length).toBeGreaterThan(0);
    expect(sentAtLayout.every((count) => count === 0)).toBe(true);
    onLayoutCommit = null;
    expect(workbench.status).toBe('ready');
    await act(async () => workbench.toggleSimulation());
    const currentTick = vi
      .mocked(window.setInterval)
      .mock.calls.filter((entry) => entry[1] === 10)
      .at(-1)![0] as () => void;
    const stoppedAtLayout: number[] = [];
    onLayoutCommit = () => {
      const before = worker().update.mock.calls.length;
      currentTick();
      stoppedAtLayout.push(worker().update.mock.calls.length - before);
    };
    await act(async () => workbench.toggleSimulation());
    expect(stoppedAtLayout.length).toBeGreaterThan(0);
    expect(stoppedAtLayout.every((count) => count === 0)).toBe(true);
    onLayoutCommit = null;
  });

  it('advances pending Worker demand every 10ms without rendering; ready still publishes', async () => {
    await mount();
    await act(async () => workbench.toggleSimulation());
    const before = renders;
    worker().update.mockClear();
    // Separate event turns prevent React test batching from hiding tick renders.
    for (let turn = 0; turn < 10; turn += 1) await tick(10);
    expect(renders).toBe(before);
    expect(loadSimulationWorkerController).toHaveBeenCalledTimes(1);
    expect(worker().update.mock.calls.map((call) => call[1])).toEqual([
      10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000, 100_000,
    ]);
    expect(workbench.result).toBe(ready);
    await act(async () => {
      worker().callbacks!.onCommittedHorizon!(25_000);
      worker().callbacks!.onResult(ready);
    });
    expect(renders).toBeGreaterThan(before);
    expect(workbench.result).toBe(ready);
    expect(workbench.simulationTimeMs).toBe(100);
    expect(workbench.committedSimulationTimeMs).toBe(25);
    expect(host.textContent).toBe('100:1');
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it('delivers fresh source and live controls while pending, and timestamps Serial from current demand', async () => {
    await mount();
    await act(async () => workbench.toggleSimulation());
    await tick(40);
    const source = 'void setup(){pinMode(13,OUTPUT);}void loop(){digitalWrite(13,HIGH);}';
    await act(async () => workbench.updateArduinoProgram('uno', { arduinoSource: source }));
    const sourceDocument = worker().update.mock.calls.at(-1)![0] as SchematicDocument;
    expect(sourceDocument.components[0]!.stateProperties!.arduinoSource).toBe(source);
    expect(worker().update.mock.calls.at(-1)![1]).toBe(40_000);
    await act(async () => workbench.toggleComponentState('switch'));
    const runtimeDocument = worker().update.mock.calls.at(-1)![0] as SchematicDocument;
    expect(runtimeDocument.components[1]!.state).toBe(true);
    expect(runtimeDocument.components[0]!.stateProperties!.arduinoSource).toBe(source);
    const before = renders;
    await tick(30);
    expect(renders).toBe(before);
    expect(worker().update.mock.calls.at(-1)).toEqual([runtimeDocument, 70_000]);
    workbench.sendArduinoSerialRx('uno', 'hello');
    expect(worker().sendSerialRx).toHaveBeenCalledWith('uno', 'hello', 70_000);
    await act(async () => workbench.resetArduinoRuntime('uno'));
    expect(worker().restart).toHaveBeenCalledWith(runtimeDocument);
    expect(workbench.simulationTimeMs).toBe(0);
    workbench.sendArduinoSerialRx('uno', 'after reset');
    expect(worker().sendSerialRx).toHaveBeenLastCalledWith('uno', 'after reset', 0);
    await tick(10);
    expect(worker().update.mock.calls.at(-1)).toEqual([runtimeDocument, 10_000]);
  });

  it('cancels old tick callbacks on Stop, starts from zero and cleans up on unmount', async () => {
    await mount();
    await act(async () => workbench.toggleSimulation());
    const oldTick = intervalCallback();
    await tick(50);
    await act(async () => workbench.toggleSimulation());
    expect(workbench.simulationTimeMs).toBe(0);
    worker().update.mockClear();
    await tick(50);
    oldTick();
    expect(worker().update).not.toHaveBeenCalled();
    await act(async () => workbench.toggleSimulation());
    await tick(10);
    expect(loadSimulationWorkerController).toHaveBeenCalledTimes(1);
    expect(worker().update.mock.calls.at(-1)![1]).toBe(10_000);
    worker().update.mockClear();
    oldTick();
    expect(worker().update).not.toHaveBeenCalled();
    const lastTick = vi
      .mocked(window.setInterval)
      .mock.calls.filter((entry) => entry[1] === 10)
      .at(-1)![0] as () => void;
    await act(async () => root.render(null));
    lastTick();
    await tick(50);
    expect(worker().update).not.toHaveBeenCalled();
  });

  it('isolates a replacement project and a failed generation from previous tick callbacks', async () => {
    await mount();
    await act(async () => workbench.toggleSimulation());
    const oldTick = intervalCallback();
    await tick(30);
    await mount('replacement-project');
    await act(async () => workbench.toggleSimulation());
    expect(worker().start.mock.calls.at(-1)![0]).toBe('replacement-project');
    worker().update.mockClear();
    oldTick();
    expect(worker().update).not.toHaveBeenCalled();
    await tick(10);
    expect(worker().update.mock.calls.at(-1)![1]).toBe(10_000);
    const activeTick = vi
      .mocked(window.setInterval)
      .mock.calls.filter((entry) => entry[1] === 10)
      .at(-1)![0] as () => void;
    await act(async () =>
      worker().callbacks!.onFailure(
        new SimulationFailure('technical', 'worker-runtime', 'Worker failed'),
      ),
    );
    expect(workbench.simulationRunning).toBe(false);
    expect(workbench.simulationTimeMs).toBe(0);
    worker().update.mockClear();
    activeTick();
    await tick(50);
    expect(worker().update).not.toHaveBeenCalled();
  });
});
