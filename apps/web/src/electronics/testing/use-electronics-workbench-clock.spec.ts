/* @vitest-environment jsdom */
import { act, createElement, startTransition, StrictMode, Suspense, useLayoutEffect } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetElectronicsTimedState,
  type ElectronicsLedTemporalObservation,
} from '@asa-lab/electronics/engine';
import { api, type Project, type SchematicDocument, type SolveResult } from '../../api';
import type { LiveSimulationWorkerCallbacks } from '../live-simulation-worker-controller';
import { ElectronicsLiveSimulationWorkerController } from '../live-simulation-worker-controller';
import { loadSimulationWorkerController } from '../load-simulation-worker-controller';
import { SimulationFailure } from '../simulation-failure';
import { catalogEntry } from '../component-catalog';
import { configureProductionLibrary } from '../production-manifest-adapter';
import { ProductionComponentVisual } from '../ProductionComponentVisual';
import { useElectronicsWorkbench } from '../use-electronics-workbench';
import { evaluateSimulationWorkerRequestBatched } from '../simulation-worker-evaluator';
import {
  ELECTRONICS_SIMULATION_ENGINE_REVISION,
  ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
} from '../simulation-worker-protocol';

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
        callbacks.onResult(ready, undefined, 'dc-inputs-v1');
      }
    });
    update = vi.fn();
    stop = vi.fn();
    restart = vi.fn(() => {
      this.callbacks?.onGenerationPending?.();
      if (transport.autoReady) {
        this.callbacks?.onInitialReady?.(0);
        this.callbacks?.onCommittedHorizon?.(0);
        this.callbacks?.onResult(ready, undefined, 'dc-inputs-v1');
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
// replaced. Uno + switch uses a generic canonical DC endpoint, not event history.
// Quality and clock-profile metadata model the accepted transport contract. Fake
// wall time/manual RAF test scheduling and DOM commits, never physical throughput
// or a browser paint. The LED cases explicitly induce analytic event observations.
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
  quality: {
    passed: true,
    finite: true,
    maxKclResidualAmp: 0,
    maxSourceVoltageResidualVolt: 0,
    powerBalanceResidualWatt: 0,
    powerBalanceToleranceWatt: 1e-9,
    kclToleranceAmp: 1e-9,
    sourceVoltageToleranceVolt: 1e-9,
  },
};
let openedDocument = initial;
let host: HTMLDivElement;
let root: Root;
let workbench: ReturnType<typeof useElectronicsWorkbench>;
let renders: number;
let suspendRender: Promise<void> | null;
let onLayoutCommit: (() => void) | null;
let frameSequence = 0;
const frameCallbacks = new Map<number, FrameRequestCallback>();
function Probe({ id = 'clock-project' }: { id?: string }) {
  workbench = useElectronicsWorkbench(id, 'clock-pupil');
  useLayoutEffect(() => onLayoutCommit?.());
  renders += 1;
  if (suspendRender) throw suspendRender;
  return createElement(
    'div',
    null,
    createElement(
      'output',
      {
        'data-source': workbench.document?.components.find((component) => component.id === 'uno')
          ?.stateProperties?.arduinoSource,
      },
      `${workbench.simulationTimeMs}:${workbench.result?.current}`,
    ),
    createElement(
      'svg',
      null,
      ...(workbench.document?.components ?? [])
        .filter((component) => component.kind === 'led')
        .map((component) => {
          const entry = catalogEntry(component);
          if (!entry) throw new Error('Mounted LED fixture requires its real catalogue entry');
          return createElement(
            'g',
            { key: component.id, 'data-testid': `clock-led-${component.id}` },
            createElement(ProductionComponentVisual, {
              entry,
              component,
              width: 40,
              height: 60,
              visualState: workbench.componentVisualState(component),
              effectiveBrightness: workbench.componentLedBrightness(component),
              simulationRunning: workbench.simulationRunning,
              simulationTimeMs: workbench.simulationTimeMs,
              preparedLedAsset: workbench.preparedComponentLedAsset(component),
              committedLedAsset: workbench.committedComponentLedAsset(component),
              rollbackLedAsset: workbench.rollbackComponentLedAsset(component),
              onLedAssetReadiness: workbench.onLedAssetReadiness,
              result: workbench.runtimePresentationResultByComponent.get(component.id),
            }),
          );
        }),
    ),
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
// One explicit animation frame per act allows the actual hook/renderer layout
// effects to commit before the next frame. Wall-only ticks intentionally leave
// RAF queued, so pending producer demand cannot masquerade as presented time.
async function frame(milliseconds = 0) {
  if (milliseconds > 0) await tick(milliseconds);
  const callbacks = [...frameCallbacks.values()];
  frameCallbacks.clear();
  await act(async () => {
    for (const callback of callbacks) callback(window.performance.now());
  });
}
async function frames(count: number, milliseconds = 16) {
  for (let index = 0; index < count; index++) await frame(milliseconds);
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
  frameSequence = 0;
  frameCallbacks.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++frameSequence;
    frameCallbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frameCallbacks.delete(id));
  localStorage.clear();
  transport.instances.length = 0;
  transport.autoReady = true;
  vi.mocked(loadSimulationWorkerController)
    .mockReset()
    .mockResolvedValue(ElectronicsLiveSimulationWorkerController);
  renders = 0;
  suspendRender = null;
  onLayoutCommit = null;
  openedDocument = initial;
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
          draft: { projectId: id, document: openedDocument, revision: 1, updatedAt: '' },
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
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('mounted workbench host demand clock', () => {
  it('restores normal demand from a real motor clock profile while publishing only actual ready frames', async () => {
    transport.autoReady = false;
    const motor: SchematicDocument = {
      ...initial,
      components: [
        { id: 'source', kind: 'source', value: 23, position: { x: 0, y: 0 } },
        {
          id: 'motor',
          kind: 'visual',
          componentTypeId: 'dc-motor',
          value: 6,
          position: { x: 100, y: 0 },
          pinIds: ['positive', 'negative'],
        },
      ],
      connections: [
        {
          id: 'positive',
          from: { componentId: 'source', terminal: 'a' },
          to: { componentId: 'motor', terminal: 'positive' },
        },
        {
          id: 'negative',
          from: { componentId: 'motor', terminal: 'negative' },
          to: { componentId: 'source', terminal: 'b' },
        },
      ],
    };
    openedDocument = motor;
    await mount();
    await act(async () => workbench.toggleSimulation());
    await tick(100);
    // Canonical document normalization may queue an input-intent update at H0.
    // No positive model-time demand is allowed before the actual initial frame.
    expect(worker().update.mock.calls.every((call) => call[1] === 0)).toBe(true);
    expect(workbench.simulationTimeMs).toBe(0);
    const actualAdvance = async (horizon: number, state = resetElectronicsTimedState()) => {
      const response = await evaluateSimulationWorkerRequestBatched(
        {
          kind: 'advance',
          protocolVersion: ELECTRONICS_SIMULATION_WORKER_PROTOCOL,
          engineRevision: ELECTRONICS_SIMULATION_ENGINE_REVISION,
          requestId: `normal-motor-${horizon}`,
          generationId: 1,
          projectSessionId: 'clock-project',
          document: motor,
          requestedHorizonMicroseconds: horizon,
          state,
        },
        () => true,
        // Only the cooperative yield is deterministic; the real engine computes
        // both endpoints. This test does not measure physical throughput or paint.
        () => Promise.resolve(),
      );
      if (!response || !response.ok || response.kind !== 'advance')
        throw new Error(`Expected real motor response: ${JSON.stringify(response)}`);
      expect(response.advance.executionStatus, JSON.stringify(response.advance.diagnostics)).toBe(
        'ready',
      );
      expect(response.advance.result?.solved).toBe(true);
      expect(response.advance.result?.quality?.passed).toBe(true);
      expect(response.advance.ledTemporal).toBeUndefined();
      expect(response.advance.state.continuation?.clockProfileId).toBe('electrothermal-v1');
      return response.advance;
    };
    const initialFrame = await actualAdvance(0);
    await act(async () => {
      worker().callbacks!.onInitialReady!(0);
      worker().callbacks!.onCommittedHorizon!(0);
      worker().callbacks!.onResult(
        initialFrame.result!,
        undefined,
        initialFrame.state.continuation!.clockProfileId,
      );
    });
    await frame();
    const before = renders;
    worker().update.mockClear();
    await tick(100);
    expect(worker().update.mock.calls.map((call) => call[1])).toEqual([
      10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000, 100_000,
    ]);
    expect(renders).toBe(before);
    expect(workbench.simulationTimeMs).toBe(0);
    expect(workbench.result).toBe(initialFrame.result);
    const next = await actualAdvance(100_000, initialFrame.state);
    expect(next.committedHorizonMicroseconds).toBe(100_000);
    const canonical = JSON.parse(next.state.continuation!.serializedState);
    expect(canonical.physicalState.motors[0].simulationTimeSeconds).toBeGreaterThan(0);
    expect(canonical.physicalState.motors[0].motorAngularVelocityRadPerSecond).toBeGreaterThan(0);
    await act(async () => {
      worker().callbacks!.onCommittedHorizon!(next.committedHorizonMicroseconds);
      worker().callbacks!.onResult(
        next.result!,
        undefined,
        next.state.continuation!.clockProfileId,
      );
    });
    expect(workbench.result).toBe(initialFrame.result);
    expect(workbench.simulationTimeMs).toBe(0);
    await frame();
    expect(workbench.result).toBe(next.result);
    expect(workbench.simulationTimeMs).toBe(100);
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it('loads only after Start and preserves every pending committed input in order before H0', async () => {
    const loading = deferredController();
    transport.autoReady = false;
    await mount();
    await tick(50);
    expect(loadSimulationWorkerController).not.toHaveBeenCalled();
    expect(transport.instances).toHaveLength(0);
    await act(async () => workbench.toggleSimulation());
    await frame();
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
      instance.callbacks!.onResult(ready, undefined, 'dc-inputs-v1');
    });
    await tick(10);
    expect(instance.update.mock.calls.at(-1)![1]).toBe(10_000);
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it('reports a failed capability load and retries on the next Start', async () => {
    const loading = deferredController();
    await mount();
    await act(async () => workbench.toggleSimulation());
    await frame();
    workbench.sendArduinoSerialRx('uno', 'discard failed run');
    await act(async () => loading.reject(new Error('chunk unavailable')));
    expect(workbench.simulationRunning).toBe(false);
    expect(workbench.simulationMessage?.code).toBe('worker-start');
    expect(workbench.result).toBeNull();
    expect(transport.instances).toHaveLength(0);
    await act(async () => workbench.toggleSimulation());
    await frame();
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
      await frame();
      workbench.sendArduinoSerialRx('uno', 'old run');
      await act(async () => workbench.toggleSimulation());
      await frame();
      expect(workbench.simulationRunning).toBe(false);
      await act(async () => workbench.toggleSimulation());
      await frame();
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
      await frame();
      workbench.sendArduinoSerialRx('uno', 'old project');
      if (destination === 'replacement') await mount('replacement');
      else await act(async () => root.render(null));
      await act(async () => loading.resolve());
      expect(transport.instances).toHaveLength(0);
      if (destination === 'replacement') {
        await act(async () => workbench.toggleSimulation());
        await frame();
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
      await frame();
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
        worker().callbacks!.onResult(ready, undefined, 'dc-inputs-v1');
      });
      await tick(10);
      expect(worker().update.mock.calls.at(-1)![1]).toBe(10_000);
    });
  }

  it('waits through preflight and H0, then retains elapsed demand across later ready frames', async () => {
    transport.autoReady = false;
    await mount();
    await act(async () => workbench.toggleSimulation());
    await frame();
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
      worker().callbacks!.onResult(ready, undefined, 'dc-inputs-v1');
    });
    expect(workbench.result).toBeNull();
    await frame();
    await tick(30);
    expect(worker().update.mock.calls.map((call) => call[1])).toEqual([10_000, 20_000, 30_000]);
    await act(async () => {
      worker().callbacks!.onCommittedHorizon!(10_000);
      worker().callbacks!.onResult({ ...ready, current: 2 }, undefined, 'dc-inputs-v1');
    });
    expect(workbench.result).toBe(ready);
    await frame();
    await tick(20);
    expect(worker().update.mock.calls.at(-1)![1]).toBe(50_000);
    expect(workbench.committedSimulationTimeMs).toBe(10);
    expect(workbench.result?.current).toBe(2);
  });

  it('retains pending controls and Serial, and anchors genuine resets without offset debt', async () => {
    await mount();
    await act(async () => workbench.toggleSimulation());
    await frame();
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
    await act(async () => {
      worker().callbacks!.onInitialReady!(80_000);
      worker().callbacks!.onCommittedHorizon!(0);
      worker().callbacks!.onResult(ready, undefined, 'dc-inputs-v1');
    });
    await frame();
    await tick(10);
    expect(worker().update.mock.calls.at(-1)![1]).toBe(90_000);
    transport.autoReady = false;
    await act(async () => workbench.resetArduinoRuntime('uno'));
    worker().update.mockClear();
    await tick(500);
    expect(worker().update).not.toHaveBeenCalled();
    workbench.sendArduinoSerialRx('uno', 'reset queue');
    expect(worker().sendSerialRx).toHaveBeenLastCalledWith('uno', 'reset queue', 0);
    await act(async () => {
      worker().callbacks!.onInitialReady!(0);
      worker().callbacks!.onCommittedHorizon!(0);
      worker().callbacks!.onResult(ready, undefined, 'dc-inputs-v1');
    });
    await frame();
    await tick(10);
    expect(worker().update.mock.calls.at(-1)![1]).toBe(10_000);
  });

  it('rejects old initial-ready callbacks after Stop, project replacement and unmount', async () => {
    transport.autoReady = false;
    await mount();
    await act(async () => workbench.toggleSimulation());
    await frame();
    const stopped = worker().callbacks!;
    await act(async () => workbench.toggleSimulation());
    await frame();
    await act(async () => workbench.toggleSimulation());
    await frame();
    await act(async () => stopped.onInitialReady!(999_000));
    worker().update.mockClear();
    await tick(50);
    expect(worker().update).not.toHaveBeenCalled();
    const replaced = worker().callbacks!;
    await mount('new-project');
    await act(async () => workbench.toggleSimulation());
    await frame();
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
      await frame();
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
      await act(async () => {
        worker().callbacks!.onCommittedHorizon!(10_000);
        worker().callbacks!.onResult({ ...ready, current: 2 }, undefined, 'dc-inputs-v1');
      });
      await frame();
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
    await frame();
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
    await frame();
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
    expect(host.querySelector('output')?.getAttribute('data-source')).toBe(newSource);
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
    await frame();
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
    await frame();
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
    await frame();
    expect(stoppedAtLayout.length).toBeGreaterThan(0);
    expect(stoppedAtLayout.every((count) => count === 0)).toBe(true);
    onLayoutCommit = null;
  });

  it('retains pending normal-paced demand without rendering and publishes ready only on a shared frame', async () => {
    await mount();
    await act(async () => workbench.toggleSimulation());
    await frame();
    const before = renders;
    worker().update.mockClear();
    // Generic host demand advances normally while RAF still owns result publication.
    for (let turn = 0; turn < 10; turn += 1) await tick(10);
    expect(renders).toBe(before);
    expect(loadSimulationWorkerController).toHaveBeenCalledTimes(1);
    expect(worker().update.mock.calls.map((call) => call[1])).toEqual([
      10_000, 20_000, 30_000, 40_000, 50_000, 60_000, 70_000, 80_000, 90_000, 100_000,
    ]);
    expect(workbench.result).toBe(ready);
    const next = { ...ready, current: 2 };
    await act(async () => {
      worker().callbacks!.onCommittedHorizon!(25_000);
      worker().callbacks!.onResult(next, undefined, 'dc-inputs-v1');
    });
    expect(renders).toBeGreaterThan(before);
    expect(workbench.result).toBe(ready);
    expect(workbench.simulationTimeMs).toBe(0);
    expect(workbench.committedSimulationTimeMs).toBe(25);
    expect(host.textContent).toBe('0:1');
    await frame();
    expect(workbench.result).toBe(next);
    expect(workbench.simulationTimeMs).toBe(25);
    expect(workbench.committedSimulationTimeMs).toBe(25);
    expect(host.textContent).toBe('25:2');
    await tick(10);
    expect(worker().update.mock.calls.at(-1)![1]).toBe(110_000);
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it('delivers fresh source and live controls while pending, and timestamps Serial from current demand', async () => {
    await mount();
    await act(async () => workbench.toggleSimulation());
    await frame();
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
    await frame();
    await tick(10);
    expect(worker().update.mock.calls.at(-1)).toEqual([runtimeDocument, 10_000]);
  });

  it('cancels old tick callbacks on Stop, starts from zero and cleans up on unmount', async () => {
    await mount();
    await act(async () => workbench.toggleSimulation());
    await frame();
    const oldTick = intervalCallback();
    await tick(50);
    await act(async () => workbench.toggleSimulation());
    await frame();
    expect(workbench.simulationTimeMs).toBe(0);
    worker().update.mockClear();
    await tick(50);
    oldTick();
    expect(worker().update).not.toHaveBeenCalled();
    await act(async () => workbench.toggleSimulation());
    await frame();
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
    await frame();
    const oldTick = intervalCallback();
    await tick(30);
    await mount('replacement-project');
    await act(async () => workbench.toggleSimulation());
    await frame();
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

describe('mounted workbench LED temporal display', () => {
  const led: SchematicDocument['components'][number] = {
    id: 'led',
    kind: 'led',
    componentTypeId: 'led-5mm',
    value: 2,
    position: { x: 200, y: 0 },
    pinIds: ['anode', 'cathode'],
    stateProperties: { ledColour: 'red' },
  };
  beforeEach(() => {
    configureProductionLibrary(
      JSON.parse(
        readFileSync(
          resolve(
            process.cwd(),
            'apps/web/public/assets/electronics/component-database/catalog.json',
          ),
          'utf8',
        ),
      ),
    );
    transport.autoReady = false;
    // Deliberately analytic events-profile transport: no switch-containing
    // generic circuit is relabelled as event physics. No solver claim is made.
    openedDocument = { ...initial, components: [initial.components[0]!, led] };
  });

  function observed(
    samples: Array<{ atMicroseconds: number; brightness: number; current: number }>,
    component?: SolveResult['components'][number],
  ) {
    let brightnessIntegral = 0;
    let litDurationMicroseconds = 0;
    let transitionCount = 0;
    for (let index = 1; index < samples.length; index++) {
      const before = samples[index - 1]!;
      const elapsed = samples[index]!.atMicroseconds - before.atMicroseconds;
      brightnessIntegral += before.brightness * elapsed;
      if (before.brightness > 0) litDurationMicroseconds += elapsed;
      if (before.brightness !== samples[index]!.brightness) transitionCount++;
    }
    const final = samples.at(-1)!;
    const result: SolveResult = {
      ...ready,
      components: [
        component ?? {
          componentId: 'led',
          brightness: final.brightness,
          current: final.current,
          voltageDrop: 2,
          lit: final.brightness > 0,
          terminalVoltages: { anode: 2, cathode: 0 },
        },
        {
          componentId: 'uno',
          current: -final.current,
          voltageDrop: 5,
          terminalVoltages: { d13: final.brightness > 0 ? 5 : 0 },
        },
      ],
    };
    const observation: ElectronicsLedTemporalObservation = {
      profile: 'ordinary-led-held-v1',
      fromMicroseconds: samples[0]!.atMicroseconds,
      toMicroseconds: final.atMicroseconds,
      components: [
        {
          componentId: 'led',
          samples,
          brightnessIntegral,
          litDurationMicroseconds,
          transitionCount,
          truncated: false,
        },
      ],
      arduinoIndicators: [
        {
          componentId: 'uno',
          truncated: false,
          samples: samples.map((sample) => ({
            atMicroseconds: sample.atMicroseconds,
            voltage: sample.brightness > 0 ? 5 : 0,
          })),
        },
      ],
    };
    return { result, observation };
  }
  function opticalReady(toMicroseconds: number, fromMicroseconds = 0, half = 1000) {
    const point = (atMicroseconds: number) => ({
      atMicroseconds,
      brightness: Math.floor(atMicroseconds / half) % 2 === 0 ? 80 : 0,
      current: Math.floor(atMicroseconds / half) % 2 === 0 ? 0.01 : 0,
    });
    const samples = [point(fromMicroseconds)];
    for (let at = (Math.floor(fromMicroseconds / half) + 1) * half; at < toMicroseconds; at += half)
      samples.push(point(at));
    if (toMicroseconds > fromMicroseconds) samples.push(point(toMicroseconds));
    return observed(samples);
  }
  async function receive(next: ReturnType<typeof opticalReady>, initialReady = false) {
    const to = next.observation.toMicroseconds;
    if (to > 0) expect(worker().update.mock.calls.at(-1)![1]).toBeGreaterThanOrEqual(to);
    expect(to - next.observation.fromMicroseconds).toBeLessThanOrEqual(25_000);
    await act(async () => {
      if (initialReady) worker().callbacks!.onInitialReady!(0);
      worker().callbacks!.onCommittedHorizon!(to);
      worker().callbacks!.onResult(next.result, next.observation, 'electrothermal-events-v2');
    });
  }

  async function requestedHorizon(toMicroseconds: number) {
    for (
      let turn = 0;
      turn < 20 && Number(worker().update.mock.calls.at(-1)?.[1] ?? 0) < toMicroseconds;
      turn++
    )
      await tick(10);
    expect(worker().update.mock.calls.at(-1)![1]).toBeGreaterThanOrEqual(toMicroseconds);
  }

  // Keep original physical edges and deliver only requested complete prefixes.
  async function receiveHeldPrefix(from: number, to: number, half: number) {
    expect(to).toBeGreaterThan(from);
    let last: ReturnType<typeof opticalReady> | undefined;
    for (let cursor = from; cursor < to;) {
      const next = Math.min(to, cursor + 6_250);
      await requestedHorizon(next);
      last = opticalReady(next, cursor, half);
      const samples = last.observation.components[0]!.samples;
      expect(samples.every((sample) => sample.brightness === samples[0]!.brightness)).toBe(true);
      await receive(last);
      // A held vector can ACK later cursor positions without a React render.
      // Publish this new result at the full requested endpoint on its first RAF;
      // no intermediate same-result render is required by the production hook.
      await frame((next - cursor) / 1000);
      expect(workbench.simulationTimeMs).toBe(next / 1000);
      cursor = next;
    }
    return last!;
  }

  // JSDOM cannot load SVGs or deliver trusted browser events. As in the existing
  // native renderer tests, invoke the real React-installed callback with an
  // induced record. No event is dispatched or Event.isTrusted property changed.
  // Real element/binding/readiness and React layout ACK run; browser paint does not.
  async function loadMountedImages(beforePublication?: () => void) {
    const images = [...host.querySelectorAll<SVGImageElement>('image.workbench-led-asset')];
    expect(images.length).toBeGreaterThan(0);
    await act(async () => {
      for (const image of images) {
        const key = Object.getOwnPropertyNames(image).find((name) =>
          name.startsWith('__reactProps$'),
        );
        if (!key) throw new Error('React native image props are missing');
        const props = (image as unknown as Record<string, unknown>)[key] as Record<string, unknown>;
        const callback = props.onLoad;
        if (typeof callback !== 'function')
          throw new Error('Mounted image load callback is missing');
        callback({ nativeEvent: { target: image, isTrusted: true } });
      }
      // Binding notifications are already queued; their readiness callback
      // queues publication after this cancellation, never inside native load.
      if (beforePublication) queueMicrotask(() => flushSync(beforePublication));
    });
  }
  function assertCommitted(
    brightness: number,
    visualState: 'lit' | 'off' | 'overcurrent' | 'burned',
  ) {
    expect(workbench.componentLedBrightness(led)).toBe(brightness);
    expect(workbench.componentVisualState(led)).toBe(visualState);
    const lease = workbench.committedComponentLedAsset(led);
    expect(lease?.isCurrent()).toBe(true);
    expect(lease?.isActive()).toBe(true);
    expect(host.querySelector('[data-testid="clock-led-led"] image.workbench-led-asset')).toBe(
      lease?.element,
    );
    expect(lease?.element.style.opacity).toBe('1');
  }
  async function settleNativeFrame(preparationMilliseconds = 16) {
    // Two complete intervening RAFs precede a distinct optical frame.
    await frame();
    await frame(16);
    // The third RAF can prepare and mount the new immutable native request.
    await frame(preparationMilliseconds);
    await loadMountedImages();
    // A resource that needed loading publishes on a subsequent RAF/layout ACK.
    await frame(16);
  }
  async function startOptical(half: number) {
    await mount();
    await act(async () => workbench.toggleSimulation());
    const first = opticalReady(0, 0, half);
    await receive(first, true);
    expect(workbench.result).toBeNull();
    await frame();
    await frame(16);
    expect(workbench.result).toBeNull();
    expect(workbench.componentLedBrightness(led)).toBe(0);
    await loadMountedImages();
    // A cold resource publishes through a queued flush/layout ACK without
    // requiring an additional RAF after its actual mounted readiness.
    expect(workbench.result).toBe(first.result);
    assertCommitted(80, 'lit');
    await frame(16);
    expect(workbench.result).toBe(first.result);
    assertCommitted(80, 'lit');
    return first;
  }

  it.each([0, 1, 2])(
    'mounts the first cold native resource for joint LED %i before its display RAF is eligible',
    async (activeIndex) => {
      const leds = [led, { ...led, id: 'led-d3' }, { ...led, id: 'led-d4' }];
      openedDocument = { ...initial, components: [initial.components[0]!, ...leds] };
      const joint = (times: number[], values: number[][]) => {
        const channels = leds.map((component, index) => {
          const single = observed(
            times.map((atMicroseconds, sample) => ({
              atMicroseconds,
              brightness: values[sample]![index]!,
              current: values[sample]![index]! > 0 ? 0.01 : 0,
            })),
          );
          return {
            electrical: { ...single.result.components[0]!, componentId: component.id },
            temporal: { ...single.observation.components[0]!, componentId: component.id },
          };
        });
        const observation: ElectronicsLedTemporalObservation = {
          profile: 'ordinary-led-held-v1',
          fromMicroseconds: times[0]!,
          toMicroseconds: times.at(-1)!,
          components: channels.map((channel) => channel.temporal),
          arduinoIndicators: [
            {
              componentId: 'uno',
              truncated: false,
              samples: times.map((atMicroseconds) => ({ atMicroseconds, voltage: 0 })),
            },
          ],
        };
        const result: SolveResult = {
          ...ready,
          components: [
            ...channels.map((channel) => channel.electrical),
            { componentId: 'uno', current: -0.01, voltageDrop: 5, terminalVoltages: { d13: 0 } },
          ],
        };
        return { result, observation };
      };
      await mount();
      await loadMountedImages();
      await act(async () => workbench.toggleSimulation());
      await receive(joint([0], [[0, 0, 0]]), true);
      await frame();
      expect(leds.map((component) => workbench.componentLedBrightness(component))).toEqual([
        0, 0, 0,
      ]);
      await tick(10);
      const high = [0, 0, 0];
      high[activeIndex] = 70;
      const receivedAt = window.performance.now();
      await receive(joint([0, 7, 1_000], [[0, 0, 0], high, high]));
      const component = leds[activeIndex]!;
      const preparation = workbench.preparedComponentLedAsset(component)!;
      expect(preparation.asset).toMatch(/_i070\.svg$/);
      const cold = [
        ...host.querySelectorAll<SVGImageElement>(
          `[data-testid="clock-led-${component.id}"] image.workbench-led-asset`,
        ),
      ].find((image) => image.getAttribute('href') === preparation.asset)!;
      expect(cold).toBeDefined();
      expect(cold.style.opacity).toBe('0');
      expect(workbench.simulationTimeMs).toBe(0);
      await frame(8);
      await frame(8);
      // Induced native load runs the binding and queued parent layout ACK.
      // No additional RAF is needed; this is not a browser paint measurement.
      await loadMountedImages();
      expect(leds.map((item) => workbench.componentLedBrightness(item))).toEqual(high);
      expect(workbench.simulationTimeMs).toBe(1);
      await frame(8);
      expect(window.performance.now() - receivedAt).toBe(24);
      expect(leds.map((item) => workbench.componentLedBrightness(item))).toEqual(high);
      expect(workbench.componentArduinoLActive(initial.components[0]!)).toBe(false);
      const committed = workbench.committedComponentLedAsset(component)!;
      expect(committed.token).not.toBe(preparation.token);
      expect(committed.element).toBe(cold);
      expect(committed.isCurrent()).toBe(true);
      expect(committed.isActive()).toBe(true);
      expect(cold.style.opacity).toBe('1');
      expect(workbench.simulationTimeMs).toBe(1);
      for (const item of leds)
        expect(
          host.querySelectorAll(`[data-testid="clock-led-${item.id}"] image.workbench-led-asset`)
            .length,
        ).toBeLessThanOrEqual(3);
    },
  );

  it('does not replace an unacknowledged native request with a later accepted asset', async () => {
    await mount();
    await loadMountedImages();
    await act(async () => workbench.toggleSimulation());
    await receive(opticalReady(0), true);
    await frame();
    const pending = workbench.preparedComponentLedAsset(led)!;
    expect(pending.asset).toMatch(/_i080\.svg$/);
    await tick(10);
    await receive(
      observed([
        { atMicroseconds: 0, brightness: 80, current: 0.01 },
        { atMicroseconds: 7, brightness: 30, current: 0.01 },
        { atMicroseconds: 1_000, brightness: 30, current: 0.01 },
      ]),
    );
    expect(workbench.preparedComponentLedAsset(led)?.token).toBe(pending.token);
    expect(host.querySelector('image[href$="_i030.svg"]')).toBeNull();
    expect(workbench.result).toBeNull();
    await loadMountedImages();
    await frame();
    assertCommitted(80, 'lit');
    expect(workbench.simulationTimeMs).toBe(0);
    // The later solved resource can mount only after the first complete vector ACK.
    expect(workbench.preparedComponentLedAsset(led)?.asset).toMatch(/_i030\.svg$/);
    expect(host.querySelector<SVGImageElement>('image[href$="_i030.svg"]')?.style.opacity).toBe(
      '0',
    );
  });

  it.each(['Reset', 'Stop', 'failure'] as const)(
    'cancels a cold native preparation on %s and ignores its late load',
    async (cancellation) => {
      await mount();
      await loadMountedImages();
      await act(async () => workbench.toggleSimulation());
      const off = observed([{ atMicroseconds: 0, brightness: 0, current: 0 }]);
      await receive(off, true);
      await frame();
      await tick(10);
      await receive(
        observed([
          { atMicroseconds: 0, brightness: 0, current: 0 },
          { atMicroseconds: 7, brightness: 80, current: 0.01 },
          { atMicroseconds: 1_000, brightness: 80, current: 0.01 },
        ]),
      );
      const warming = workbench.preparedComponentLedAsset(led)!;
      expect(warming.asset).toMatch(/_i080\.svg$/);
      await act(async () => {
        if (cancellation === 'Reset') workbench.resetArduinoRuntime('uno');
        else if (cancellation === 'Stop') await workbench.toggleSimulation();
        else
          worker().callbacks!.onFailure(
            new SimulationFailure('technical', 'worker-runtime', 'Worker failed'),
          );
      });
      expect(workbench.preparedComponentLedAsset(led)).toBeUndefined();
      await loadMountedImages();
      await frames(3);
      expect(workbench.componentLedBrightness(led)).toBe(0);
      expect(workbench.simulationTimeMs).toBe(0);
      expect(workbench.committedComponentLedAsset(led)).toBeUndefined();
      if (cancellation === 'Reset') {
        await receive(off, true);
        await frame();
        assertCommitted(0, 'off');
        expect(workbench.committedComponentLedAsset(led)?.token).not.toBe(warming.token);
      }
    },
  );

  it.each(['Stop', 'Reset', 'source', 'unmount'] as const)(
    'cancels readiness publication queued before %s without another RAF',
    async (cancellation) => {
      await mount();
      await loadMountedImages();
      await act(async () => workbench.toggleSimulation());
      await receive(opticalReady(0, 0, 100_000), true);
      await frame();
      await frame(16);
      const before = frameSequence;
      const pendingToken = workbench.preparedComponentLedAsset(led)!.token;
      await loadMountedImages(() => {
        if (cancellation === 'Stop') workbench.toggleSimulation();
        else if (cancellation === 'Reset') workbench.resetArduinoRuntime('uno');
        else if (cancellation === 'source')
          workbench.updateArduinoProgram('uno', {
            arduinoSource: 'void setup(){}void loop(){delay(777);}',
          });
        else root.render(null);
      });
      expect(frameSequence).toBe(before);
      expect(workbench.committedComponentLedAsset(led)?.token).not.toBe(pendingToken);
      if (cancellation === 'unmount') expect(host.querySelector('image')).toBeNull();
      else {
        expect(workbench.componentLedBrightness(led)).toBe(0);
        expect(workbench.committedComponentLedAsset(led)).toBeUndefined();
      }
    },
  );

  it('cancels queued native work before a new generation with the same asset', async () => {
    await mount();
    await loadMountedImages();
    await act(async () => workbench.toggleSimulation());
    const off = observed([{ atMicroseconds: 0, brightness: 0, current: 0 }]);
    await receive(off, true);
    await frame();
    await tick(10);
    const high = observed([
      { atMicroseconds: 0, brightness: 0, current: 0 },
      { atMicroseconds: 7, brightness: 80, current: 0.01 },
      { atMicroseconds: 1_000, brightness: 80, current: 0.01 },
    ]);
    await act(async () => {
      worker().callbacks!.onCommittedHorizon!(1_000);
      worker().callbacks!.onResult(high.result, high.observation, 'electrothermal-events-v2');
      workbench.resetArduinoRuntime('uno');
    });
    expect(workbench.preparedComponentLedAsset(led)).toBeUndefined();
    expect(host.querySelector('image[href$="_i080.svg"]')).toBeNull();
    await receive(off, true);
    await frame();
    await tick(10);
    await receive(high);
    expect(workbench.preparedComponentLedAsset(led)?.asset).toMatch(/_i080\.svg$/);
    expect(workbench.componentLedBrightness(led)).toBe(0);
    expect(workbench.simulationTimeMs).toBe(0);
  });

  it.each(['changed', 'changed back'] as const)(
    'withholds speculative native preparation after a %s source until a real Reset',
    async (edit) => {
      await mount();
      await loadMountedImages();
      await act(async () => workbench.toggleSimulation());
      const off = observed([{ atMicroseconds: 0, brightness: 0, current: 0 }]);
      await receive(off, true);
      await frame();
      await tick(10);
      const high = observed([
        { atMicroseconds: 0, brightness: 0, current: 0 },
        { atMicroseconds: 7, brightness: 80, current: 0.01 },
        { atMicroseconds: 1_000, brightness: 80, current: 0.01 },
      ]);
      const originalSource = initial.components[0]!.stateProperties!.arduinoSource;
      const editedSource = 'void setup(){}void loop(){delay(77);}';
      await act(async () => workbench.updateArduinoProgram('uno', { arduinoSource: editedSource }));
      if (edit === 'changed back')
        await act(async () =>
          workbench.updateArduinoProgram('uno', { arduinoSource: originalSource }),
        );
      expect(host.querySelector('output')?.getAttribute('data-source')).toBe(
        edit === 'changed back' ? originalSource : editedSource,
      );
      // Source-only edits do not start a controller generation. This old
      // in-flight response can therefore arrive after the new source layout;
      // its callback supplies no identity that could prove the new source.
      await receive(high);
      expect(Boolean(host.querySelector('image[href$="_i080.svg"]'))).toBe(false);
      expect(workbench.preparedComponentLedAsset(led)?.asset).toMatch(/_i000\.svg$/);
      expect(workbench.componentLedBrightness(led)).toBe(0);
      expect(workbench.simulationTimeMs).toBe(0);
      await act(async () => workbench.resetArduinoRuntime('uno'));
      await receive(off, true);
      await frame();
      await tick(10);
      // A genuine new generation re-enables the same first cold native state.
      await receive(high);
      expect(workbench.preparedComponentLedAsset(led)?.asset).toMatch(/_i080\.svg$/);
      expect(workbench.componentLedBrightness(led)).toBe(0);
      expect(workbench.simulationTimeMs).toBe(0);
    },
  );

  it('does not spend the first real 16ms RAF displaying an already resident OFF H0 and miss the first 20ms HIGH', async () => {
    await mount();
    await loadMountedImages();
    await act(async () => workbench.toggleSimulation());
    await receive(observed([{ atMicroseconds: 0, brightness: 0, current: 0 }]), true);
    await requestedHorizon(10_000);
    await receive(
      observed([
        { atMicroseconds: 0, brightness: 0, current: 0 },
        { atMicroseconds: 2, brightness: 80, current: 0.01 },
        { atMicroseconds: 10_000, brightness: 80, current: 0.01 },
      ]),
    );
    await loadMountedImages();
    // All resources are resident before the first actual RAF; no network/cold
    // loading or changed physical timing can explain a lost first short phase.
    await frame(6);
    assertCommitted(80, 'lit');
    expect(workbench.componentArduinoLActive(initial.components[0]!)).toBe(true);
    await requestedHorizon(20_004);
    await receive(
      observed([
        { atMicroseconds: 10_000, brightness: 80, current: 0.01 },
        { atMicroseconds: 20_004, brightness: 0, current: 0 },
      ]),
    );
    await frame(7);
    assertCommitted(0, 'off');
    expect(workbench.componentArduinoLActive(initial.components[0]!)).toBe(false);
  });

  it('withholds the dark H0 bootstrap while its actual OFF native lease is unready', async () => {
    await mount();
    await act(async () => workbench.toggleSimulation());
    await receive(observed([{ atMicroseconds: 0, brightness: 0, current: 0 }]), true);
    expect(workbench.committedComponentLedAsset(led)).toBeUndefined();
    expect(workbench.result).toBeNull();
    await loadMountedImages();
    assertCommitted(0, 'off');
  });

  it.each(['Stop', 'Reset', 'source', 'unmount'] as const)(
    'rejects dark H0 readiness queued across %s',
    async (change) => {
      await mount();
      await act(async () => workbench.toggleSimulation());
      await receive(observed([{ atMicroseconds: 0, brightness: 0, current: 0 }]), true);
      expect(workbench.committedComponentLedAsset(led)).toBeUndefined();
      const before = workbench.preparedComponentLedAsset(led)?.token;
      await loadMountedImages(() => {
        if (change === 'Stop') workbench.toggleSimulation();
        if (change === 'Reset') workbench.resetArduinoRuntime('uno');
        if (change === 'source')
          workbench.updateArduinoProgram('uno', {
            arduinoSource: 'void setup(){}void loop(){delay(77);}',
          });
        if (change === 'unmount') root.unmount();
      });
      expect(workbench.committedComponentLedAsset(led)).toBeUndefined();
      if (change === 'Stop' || change === 'Reset')
        expect(workbench.preparedComponentLedAsset(led)?.token).not.toBe(before);
    },
  );

  it('prepares the actual current complete fast-cycle resource instead of its obsolete first HIGH without moving the display', async () => {
    await mount();
    await loadMountedImages();
    await act(async () => workbench.toggleSimulation());
    await receive(observed([{ atMicroseconds: 0, brightness: 0, current: 0 }]), true);
    await frame();
    const prior = workbench.committedComponentLedAsset(led)!;
    await requestedHorizon(24_000);
    const samples = [{ atMicroseconds: 0, brightness: 0, current: 0 }];
    for (let at = 1; at < 24_000; at += 1000) {
      const brightness = Math.floor((at - 1) / 1000) % 2 === 0 ? 80 : 0;
      samples.push({ atMicroseconds: at, brightness, current: brightness ? 0.01 : 0 });
    }
    samples.push({ ...samples.at(-1)!, atMicroseconds: 24_000 });
    await receive(observed(samples));
    expect(workbench.preparedComponentLedAsset(led)?.asset).toMatch(/_i040\.svg$/);
    expect(workbench.committedComponentLedAsset(led)).toBe(prior);
    expect(prior.isActive()).toBe(true);
    expect(workbench.componentLedBrightness(led)).toBe(0);
    expect(workbench.simulationTimeMs).toBe(0);
  });

  it('retires an existing speculative token on source layout without disturbing the displayed native lease', async () => {
    await mount();
    await loadMountedImages();
    await act(async () => workbench.toggleSimulation());
    const off = observed([{ atMicroseconds: 0, brightness: 0, current: 0 }]);
    await receive(off, true);
    await frame();
    const displayed = workbench.committedComponentLedAsset(led)!;
    await tick(10);
    await receive(
      observed([
        { atMicroseconds: 0, brightness: 0, current: 0 },
        { atMicroseconds: 7, brightness: 80, current: 0.01 },
        { atMicroseconds: 1_000, brightness: 80, current: 0.01 },
      ]),
    );
    expect(workbench.preparedComponentLedAsset(led)?.asset).toMatch(/_i080\.svg$/);
    await act(async () =>
      workbench.updateArduinoProgram('uno', {
        arduinoSource: 'void setup(){}void loop(){delay(77);}',
      }),
    );
    expect(workbench.preparedComponentLedAsset(led)).toBeUndefined();
    await loadMountedImages();
    expect(workbench.preparedComponentLedAsset(led)).toBeUndefined();
    expect(workbench.committedComponentLedAsset(led)).toBe(displayed);
    expect(displayed.isCurrent()).toBe(true);
    expect(displayed.isActive()).toBe(true);
    expect(workbench.componentLedBrightness(led)).toBe(0);
    expect(workbench.simulationTimeMs).toBe(0);
  });

  it('rejects queued native history after a source layout commits before Worker generation changes', async () => {
    await mount();
    await loadMountedImages();
    await act(async () => workbench.toggleSimulation());
    const off = observed([{ atMicroseconds: 0, brightness: 0, current: 0 }]);
    await receive(off, true);
    await frame();
    await tick(10);
    const high = observed([
      { atMicroseconds: 0, brightness: 0, current: 0 },
      { atMicroseconds: 7, brightness: 80, current: 0.01 },
      { atMicroseconds: 1_000, brightness: 80, current: 0.01 },
    ]);
    const source = 'void setup(){}void loop(){delay(77);}';
    await act(async () => {
      worker().callbacks!.onCommittedHorizon!(1_000);
      worker().callbacks!.onResult(high.result, high.observation, 'electrothermal-events-v2');
      flushSync(() => workbench.updateArduinoProgram('uno', { arduinoSource: source }));
    });
    // This transport deliberately withholds onGenerationPending. The real
    // source layout alone must reject the already queued old-document work.
    expect(host.querySelector('output')?.getAttribute('data-source')).toBe(source);
    expect(host.querySelector('image[href$="_i080.svg"]')).toBeNull();
    expect(workbench.preparedComponentLedAsset(led)?.asset).toMatch(/_i000\.svg$/);
    await act(async () => worker().callbacks!.onGenerationPending!());
    await receive(off, true);
    await frame();
    await tick(10);
    await receive(high);
    expect(workbench.preparedComponentLedAsset(led)?.asset).toMatch(/_i080\.svg$/);
    expect(workbench.componentLedBrightness(led)).toBe(0);
  });

  async function residentLowBoundary() {
    await startOptical(100_000);
    const high = workbench.committedComponentLedAsset(led);
    if (!high) throw new Error('The first HIGH must own a native lease');
    const off = [...host.querySelectorAll<SVGImageElement>('image.workbench-led-asset')].find(
      (image) => image !== high.element,
    );
    if (!off) throw new Error('The already-loaded resident OFF image is missing');
    await receiveHeldPrefix(0, 93_750, 100_000);
    const low = opticalReady(100_000, 93_750, 100_000);
    await receive(low);
    // The complete LOW has arrived at its real wall deadline. It must stay
    // uncommitted until the next shared RAF verifies its resident native lease.
    assertCommitted(80, 'lit');
    expect(workbench.componentArduinoLActive(initial.components[0]!)).toBe(true);
    return { low, high, off };
  }

  it('publishes a loaded resident asset within its first eligible preparation RAF at the real phase deadline', async () => {
    const { off } = await residentLowBoundary();
    const before = frameSequence;
    await frame(16);
    expect(frameSequence).toBe(before + 1);
    expect(frameCallbacks.size).toBe(1);
    assertCommitted(0, 'off');
    expect(workbench.componentArduinoLActive(initial.components[0]!)).toBe(false);
    expect(workbench.committedComponentLedAsset(led)?.element).toBe(off);
    expect(workbench.simulationTimeMs).toBe(100);
  });

  for (const interruption of ['native invalidation', 'Stop', 'Suspense'] as const) {
    it(`rechecks the pending native frame after preparation flush encounters ${interruption}`, async () => {
      const { off } = await residentLowBoundary();
      const beforeModelTime = workbench.simulationTimeMs;
      const previousToken = workbench.preparedComponentLedAsset(led)?.token;
      let pendingToken: string | undefined;
      let interrupted = false;
      let resume: (() => void) | undefined;
      onLayoutCommit = () => {
        const prepared = workbench.preparedComponentLedAsset(led);
        if (!prepared || prepared.token === previousToken) return;
        onLayoutCommit = null;
        pendingToken = prepared.token;
        interrupted = true;
        if (interruption === 'native invalidation') {
          // An actual A -> B -> A href mutation invalidates the issued native
          // binding even though the final URL is unchanged. Only a fresh native
          // load can establish a new lease for this same frozen model frame.
          const href = off.getAttribute('href')!;
          off.setAttribute('href', `${href}?invalidated-native-binding`);
          off.setAttribute('href', href);
        } else if (interruption === 'Stop') {
          workbench.toggleSimulation();
        } else {
          suspendRender = new Promise<void>((resolve) => {
            resume = resolve;
          });
          root.render(createElement(Suspense, { fallback: 'pending' }, createElement(Probe)));
        }
      };
      await frame(16);
      expect(interrupted).toBe(true);
      if (interruption === 'Stop') {
        expect(workbench.simulationRunning).toBe(false);
        expect(workbench.simulationTimeMs).toBe(0);
        expect(workbench.componentLedBrightness(led)).toBe(0);
        expect(workbench.committedComponentLedAsset(led)).toBeUndefined();
        await frames(2);
        expect(workbench.componentLedBrightness(led)).toBe(0);
        return;
      }
      expect(workbench.componentLedBrightness(led)).toBe(80);
      expect(workbench.componentArduinoLActive(initial.components[0]!)).toBe(true);
      expect(workbench.simulationTimeMs).toBe(beforeModelTime);
      expect(workbench.preparedComponentLedAsset(led)?.token).toBe(pendingToken);
      if (interruption === 'Suspense') {
        expect(host.textContent).toContain('pending');
        await frame(16);
        expect(workbench.simulationTimeMs).toBe(beforeModelTime);
        await act(async () => {
          suspendRender = null;
          resume!();
        });
        expect(host.textContent).not.toContain('pending');
      }
      await loadMountedImages();
      // Fresh readiness queues publication; the real parent layout performs ACK.
      expect(workbench.simulationTimeMs).toBe(100);
      expect(workbench.componentLedBrightness(led)).toBe(0);
      expect(workbench.preparedComponentLedAsset(led)?.token).toBe(pendingToken);
      await frame();
      assertCommitted(0, 'off');
      expect(workbench.componentArduinoLActive(initial.components[0]!)).toBe(false);
      expect(workbench.simulationTimeMs).toBe(100);
    });
  }

  it('keeps temporal demand at 1 pace and within 50ms of the last actual native frame', async () => {
    const first = await startOptical(50_000);
    const before = renders;
    worker().update.mockClear();
    for (let turn = 0; turn < 10; turn++) await tick(10);
    expect(worker().update.mock.calls.map((call) => call[1])).toEqual([
      40_000, 50_000, 50_000, 50_000, 50_000, 50_000, 50_000, 50_000, 50_000, 50_000,
    ]);
    expect(renders).toBe(before);
    expect(workbench.result).toBe(first.result);
    expect(workbench.simulationTimeMs).toBe(0);
    const next = opticalReady(6_250, 0, 50_000);
    await receive(next);
    expect(workbench.result).toBe(first.result);
    await frame();
    expect(workbench.result).toBe(next.result);
    expect(workbench.simulationTimeMs).toBe(6.25);
    assertCommitted(80, 'lit');
    await tick(10);
    expect(worker().update.mock.calls.at(-1)![1]).toBe(56_250);
  });

  it('publishes explicit HIGH and LOW only after shared RAF, native readiness and layout ACK', async () => {
    await startOptical(50_000);
    const first = await receiveHeldPrefix(0, 25_000, 50_000);
    expect(workbench.result).toBe(first.result);
    const beforeLow = await receiveHeldPrefix(25_000, 43_750, 50_000);
    await requestedHorizon(50_000);
    const low = opticalReady(50_000, 43_750, 50_000);
    await receive(low);
    expect(low.result.components[0]!.brightness).toBe(0);
    expect(workbench.result).toBe(beforeLow.result);
    assertCommitted(80, 'lit');
    await frame();
    await frames(4);
    expect(workbench.result).toBe(low.result);
    assertCommitted(0, 'off');
    const middle = await receiveHeldPrefix(50_000, 75_000, 50_000);
    expect(workbench.result).toBe(middle.result);
    const beforeHigh = await receiveHeldPrefix(75_000, 93_750, 50_000);
    await requestedHorizon(100_000);
    const high = opticalReady(100_000, 93_750, 50_000);
    await receive(high);
    expect(high.result.components[0]!.brightness).toBe(80);
    expect(workbench.result).toBe(beforeHigh.result);
    assertCommitted(0, 'off');
    await frame();
    await frames(4);
    expect(workbench.result).toBe(high.result);
    assertCommitted(80, 'lit');
  });

  it('samples an actual 30ms phase at current wall time after native startup', async () => {
    await startOptical(30_000);
    await receiveHeldPrefix(0, 25_000, 30_000);
    await requestedHorizon(50_000);
    const low = opticalReady(50_000, 25_000, 30_000);
    await receive(low);
    assertCommitted(80, 'lit');
    await frame();
    await frame();
    assertCommitted(0, 'off');
    expect(workbench.simulationTimeMs).toBe(50);
    await requestedHorizon(60_000);
    const high = opticalReady(60_000, 50_000, 30_000);
    await receive(high);
    assertCommitted(0, 'off');
    await frame();
    await frame();
    assertCommitted(80, 'lit');
    expect(workbench.simulationTimeMs).toBe(60);
  });

  it('pairs the accepted mean with the actual result and clears it on Reset and Stop', async () => {
    await startOptical(1000);
    await tick(18);
    await receive(opticalReady(6_250));
    // Reach this mean's 6.25ms endpoint on its eligible preparation RAF.
    // Native loading still precedes the separate following RAF/layout ACK.
    await settleNativeFrame(50);
    await frames(3);
    expect(workbench.simulationTimeMs).toBe(6.25);
    await requestedHorizon(12_500);
    await receive(opticalReady(12_500, 6_250));
    await frame(50);
    expect(workbench.simulationTimeMs).toBe(12.5);
    await requestedHorizon(18_750);
    await receive(opticalReady(18_750, 12_500));
    await frame(50);
    expect(workbench.simulationTimeMs).toBe(18.75);
    await requestedHorizon(25_000);
    const fast = opticalReady(25_000, 18_750);
    const oldCallbacks = worker().callbacks!;
    await receive(fast);
    await settleNativeFrame();
    expect(workbench.result).toBe(fast.result);
    expect(workbench.result!.components[0]!.brightness).toBe(0);
    assertCommitted(40, 'lit');
    await act(async () => workbench.resetArduinoRuntime('uno'));
    expect(worker().restart).toHaveBeenCalledTimes(1);
    expect(workbench.simulationTimeMs).toBe(0);
    expect(workbench.componentLedBrightness(led)).toBe(0);
    expect(workbench.componentVisualState(led)).toBe('off');
    await receive(opticalReady(0), true);
    // The first host interval can be only 2ms after H0: 250us at eighth pace.
    // Let the following real interval request at least the same 500us prefix.
    await tick(20);
    const startup = opticalReady(500);
    await receive(startup);
    await settleNativeFrame();
    expect(workbench.result).toBe(startup.result);
    assertCommitted(80, 'lit');

    await act(async () => workbench.toggleSimulation());
    expect(workbench.componentLedBrightness(led)).toBe(0);
    await act(async () =>
      oldCallbacks.onResult(fast.result, fast.observation, 'electrothermal-events-v2'),
    );
    expect(workbench.componentLedBrightness(led)).toBe(0);
    await act(async () => workbench.toggleSimulation());
    const resetOff = observed([{ atMicroseconds: 0, brightness: 0, current: 0 }]);
    await receive(resetOff, true);
    await settleNativeFrame();
    await act(async () =>
      oldCallbacks.onResult(fast.result, fast.observation, 'electrothermal-events-v2'),
    );
    expect(workbench.result).toBe(resetOff.result);
    assertCommitted(0, 'off');
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it('shows a conducting destructive preview as overcurrent and actual failure as burned', async () => {
    await mount();
    await act(async () => workbench.toggleSimulation());
    // These boundary states are independently obtained from the real engine in
    // led-temporal-presentation.spec; this induced transport tests mounted mapping.
    const before = {
      componentId: 'led',
      brightness: 100,
      current: 0.397126331189,
      lit: true,
      stressState: 'burned',
      deviceHealth: 'overheated',
      damageState: 'none',
      presentationState: 'destructive',
      voltageDrop: 2,
      terminalVoltages: {},
    } as SolveResult['components'][number];
    await receive(
      observed([{ atMicroseconds: 0, brightness: 100, current: before.current }], before),
      true,
    );
    await settleNativeFrame();
    assertCommitted(100, 'overcurrent');
    for (const failure of [
      { presentationState: 'failed' },
      { deviceHealth: 'failed_open' },
      { damageState: 'failed' },
    ] as const) {
      const failed = {
        ...before,
        ...failure,
        brightness: 0,
        current: 0,
        lit: false,
        junctionState: 'reverse_blocking' as const,
      };
      await receive(observed([{ atMicroseconds: 0, brightness: 0, current: 0 }], failed));
      await settleNativeFrame();
      assertCommitted(0, 'burned');
    }
  });
});
