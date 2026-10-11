/* @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, SchematicDocument } from '../../api';
import { evaluateSimulationWorkerRequest } from '../simulation-worker-evaluator';
import type {
  ElectronicsSimulationWorkerRequest,
  ElectronicsSimulationWorkerResponse,
} from '../simulation-worker-protocol';
import type { OwnerCatalogManifest } from '../production-manifest-adapter';
import type { useElectronicsWorkbench } from '../use-electronics-workbench';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Controlled native-boundary regression, not evidence of a school audio failure.
// The production audio hook, project state, client/controller and evaluator run.
// jsdom supplies only the Worker transport and Web Audio boundary doubles.
const requests: ElectronicsSimulationWorkerRequest[] = [];
const responses: ElectronicsSimulationWorkerResponse[] = [];
class InProcessWorker {
  onmessage: ((event: MessageEvent<ElectronicsSimulationWorkerResponse>) => void) | null = null;
  onerror = null;
  onmessageerror = null;
  stopped = false;
  postMessage(request: ElectronicsSimulationWorkerRequest) {
    requests.push(structuredClone(request));
    if (request.kind === 'cancel-generation') return;
    queueMicrotask(() => {
      if (this.stopped) return;
      const response = evaluateSimulationWorkerRequest(request);
      responses.push(response);
      this.onmessage?.({ data: response } as MessageEvent<ElectronicsSimulationWorkerResponse>);
    });
  }
  terminate() {
    this.stopped = true;
  }
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
let pending = deferred();
let constructorThrows = false;
let resumeThrows = false;
const oscillators: Array<{
  frequency: { setTargetAtTime: ReturnType<typeof vi.fn> };
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  type: string;
}> = [];
const gains: Array<{
  gain: {
    value: number;
    cancelScheduledValues: ReturnType<typeof vi.fn>;
    setTargetAtTime: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
}> = [];
let nativeContext: AudioBoundary;
class AudioBoundary {
  state: AudioContextState = 'suspended';
  currentTime = 1;
  destination = {};
  resume = vi.fn(() => {
    if (resumeThrows) throw new Error('native resume invocation failed');
    return pending.promise;
  });
  constructor() {
    if (constructorThrows) throw new Error('audio hardware unavailable');
  }
  createOscillator() {
    const oscillator = {
      frequency: { setTargetAtTime: vi.fn() },
      start: vi.fn(),
      stop: vi.fn(),
      connect: vi.fn((node: unknown) => node),
      type: '',
    };
    oscillators.push(oscillator);
    return oscillator;
  }
  createGain() {
    const gain = {
      gain: { value: 0, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn() },
      connect: vi.fn((node: unknown) => node),
    };
    gains.push(gain);
    return gain;
  }
}

const projectId = 'audio-startup-project';
const actor = 'audio-startup-pupil';
const fixture: SchematicDocument = {
  schemaVersion: 4,
  components: [
    {
      id: 'supply',
      kind: 'source',
      componentTypeId: 'regulated-power-supply',
      variantId: 'regulated-power-supply',
      position: { x: 50, y: 100 },
      value: 5,
      state: true,
      pinIds: ['positive', 'negative'],
      stateProperties: {
        voltageSetpointVolt: 5,
        currentLimitAmp: 1,
        outputEnabled: true,
        outputResistanceOhm: 0.05,
      },
    },
    {
      id: 'resistor',
      kind: 'resistor',
      componentTypeId: 'resistor-axial',
      variantId: 'resistor-axial',
      position: { x: 400, y: 100 },
      value: 220,
      pinIds: ['lead-1', 'lead-2'],
    },
    {
      id: 'led',
      kind: 'led',
      componentTypeId: 'led-5mm',
      variantId: 'led-5mm',
      position: { x: 600, y: 100 },
      value: 2,
      pinIds: ['anode', 'cathode'],
      stateProperties: { ledColour: 'red', ledFault: 'none', ledBrightness: 0 },
    },
    ...['sounder-one', 'sounder-two'].map((id, index) => ({
      id,
      kind: 'piezo' as const,
      componentTypeId: 'piezo-passive-buzzer',
      variantId: 'piezo-passive-buzzer',
      position: { x: 400 + index * 200, y: 400 },
      value: 0,
      pinIds: ['positive', 'negative'],
      stateProperties: { piezoMode: 'active' },
    })),
  ],
  connections: [
    {
      id: 'led-positive',
      from: { componentId: 'supply', terminal: 'positive' },
      to: { componentId: 'resistor', terminal: 'lead-1' },
      vertices: [{ x: 200, y: 50 }],
      color: '#ff0000',
    },
    {
      id: 'led-series',
      from: { componentId: 'resistor', terminal: 'lead-2' },
      to: { componentId: 'led', terminal: 'anode' },
      vertices: [],
      color: '#149447',
    },
    {
      id: 'led-negative',
      from: { componentId: 'led', terminal: 'cathode' },
      to: { componentId: 'supply', terminal: 'negative' },
      vertices: [{ x: 600, y: 700 }],
      color: '#000000',
    },
    ...['sounder-one', 'sounder-two'].flatMap((id) => [
      {
        id: `${id}-positive`,
        from: { componentId: 'supply', terminal: 'positive' },
        to: { componentId: id, terminal: 'positive' },
        vertices: [],
        color: '#ff0000',
      },
      {
        id: `${id}-negative`,
        from: { componentId: id, terminal: 'negative' },
        to: { componentId: 'supply', terminal: 'negative' },
        vertices: [],
        color: '#000000',
      },
    ]),
  ],
  viewport: { x: 1, y: 2, zoom: 1 },
  simulation: { running: false, maxIterations: 24 },
};
let root: Root | null = null;
let host: HTMLDivElement;
let current: ReturnType<typeof useElectronicsWorkbench> | null = null;
let initial: SchematicDocument;
let save: ReturnType<typeof vi.fn>;
function c() {
  if (!current) throw new Error('Actual workbench hook missing');
  return current;
}
async function flush() {
  await act(async () => {
    for (let index = 0; index < 30; index++) await Promise.resolve();
  });
}
async function prepare() {
  vi.resetModules();
  requests.length = 0;
  responses.length = 0;
  oscillators.length = 0;
  gains.length = 0;
  constructorThrows = false;
  resumeThrows = false;
  pending = deferred();
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  vi.setSystemTime(0);
  vi.stubGlobal('Worker', InProcessWorker);
  vi.stubGlobal(
    'AudioContext',
    vi.fn(function () {
      const context = new AudioBoundary();
      nativeContext = context;
      return context;
    }),
  );
  const { api } = await import('../../api');
  const { configureProductionLibrary } = await import('../production-manifest-adapter');
  configureProductionLibrary(
    JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'apps/web/public/assets/electronics/component-database/catalog.json',
        ),
        'utf8',
      ),
    ) as OwnerCatalogManifest,
  );
  const { normalizeLoadedDocument } = await import('../use-workbench-project-state');
  // Piezo is independently unsupported by the current canonical clock. Keep
  // startup truth on a supported DC LED; audio presentation is tested separately.
  initial = normalizeLoadedDocument({
    ...structuredClone(fixture),
    components: fixture.components.filter((part) => part.kind !== 'piezo'),
    connections: fixture.connections.filter((wire) => !wire.id.startsWith('sounder-')),
  });
  vi.spyOn(api, 'me').mockResolvedValue({
    ok: true,
    status: 200,
    data: { authenticated: true, user: { id: actor } },
  } as Awaited<ReturnType<typeof api.me>>);
  vi.spyOn(api, 'openProject').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      project: {
        id: projectId,
        moduleKey: 'electronics',
        title: 'Audio startup',
        scope: 'personal',
        classroomId: null,
        status: 'active',
      } as Project,
      draft: { projectId, document: initial, revision: 7, updatedAt: '' },
      versions: [],
      result: null,
    },
  } as Awaited<ReturnType<typeof api.openProject>>);
  save = vi.spyOn(api, 'saveDraft') as unknown as ReturnType<typeof vi.fn>;
  const { useElectronicsWorkbench: actualHook } = await import('../use-electronics-workbench');
  function Probe() {
    current = actualHook(projectId, actor);
    return null;
  }
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root!.render(createElement(Probe)));
  expect(c().status).toBe('ready');
}
async function run() {
  // Do not await the unlock barrier: this assertion distinguishes the old code.
  let completion: Promise<void> | undefined;
  await act(async () => {
    completion = c().toggleSimulation();
  });
  await flush();
  expect(requests.some((request) => request.kind === 'preflight')).toBe(true);
  const ready = responses.find(
    (response) =>
      response.ok && response.kind === 'advance' && response.advance.executionStatus === 'ready',
  );
  expect(
    ready?.ok && ready.kind === 'advance' ? ready.advance : null,
    JSON.stringify({
      requests: requests.map((r) => r.kind),
      status: c().simulationStatus,
      message: c().simulationMessage,
    }),
  ).toMatchObject({
    executionStatus: 'ready',
    requestedHorizonMicroseconds: 0,
    committedHorizonMicroseconds: 0,
    result: { solved: true, quality: { finite: true, passed: true } },
  });
  expect(c().simulationStatus).toBe('running');
  expect(
    c().result?.components.find((part) => part.componentId === 'led')?.brightness,
  ).toBeGreaterThan(0);
  expect(c().document).toEqual({
    ...initial,
    simulation: { ...initial.simulation, running: true },
  });
  expect(c().serverRevision).toBe(7);
  expect(save).not.toHaveBeenCalled();
  await completion;
}
async function stop() {
  await act(async () => {
    await c().toggleSimulation();
  });
  await flush();
  expect(c().simulationRunning).toBe(false);
  expect(c().document).toEqual(initial);
  expect(save).not.toHaveBeenCalled();
}
afterEach(async () => {
  pending.resolve();
  if (root) await act(async () => root!.unmount());
  root = null;
  current = null;
  host?.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('unchanged audio presenter using a genuine DC preflight result', () => {
  // This separately verifies the presenter, not canonical clock admission,
  // pupil tone/noTone or native PCM. Piezo remains an explicit dependency.
  it('preserves calculated multiple voices and silences missing sound, Stop and unmount', async () => {
    await prepare();
    const audio = await import('../use-piezo-audio');
    const { calculateSimulationPreflight } = await import('../live-simulation');
    const { normalizeLoadedDocument } = await import('../use-workbench-project-state');
    const audioDocument = normalizeLoadedDocument(structuredClone(fixture));
    const powered = {
      ...audioDocument,
      simulation: { ...audioDocument.simulation, running: true },
    };
    const sounding = calculateSimulationPreflight(powered);
    expect(sounding).toMatchObject({ solved: true, quality: { finite: true, passed: true } });
    pending.resolve();
    await audio.unlockPiezoAudio();
    let running = true;
    let result = sounding;
    function AudioProbe() {
      audio.usePiezoAudio(audioDocument, result, running);
      return null;
    }
    await act(async () => root!.render(createElement(AudioProbe)));
    expect(oscillators).toHaveLength(2);
    for (const voice of oscillators)
      expect(voice.frequency.setTargetAtTime).toHaveBeenCalledWith(2300, 1, 0.008);
    for (const gain of gains) expect(gain.connect).toHaveBeenCalledWith(nativeContext.destination);
    const silentDocument = {
      ...powered,
      components: powered.components.map((part) =>
        part.kind === 'piezo'
          ? { ...part, stateProperties: { ...part.stateProperties, piezoMode: 'passive' } }
          : part,
      ),
    };
    result = calculateSimulationPreflight(silentDocument);
    await act(async () => root!.render(createElement(AudioProbe)));
    for (const voice of oscillators) expect(voice.stop).toHaveBeenCalledTimes(1);
    result = sounding;
    await act(async () => root!.render(createElement(AudioProbe)));
    expect(oscillators).toHaveLength(4);
    running = false;
    await act(async () => root!.render(createElement(AudioProbe)));
    for (const voice of oscillators) expect(voice.stop).toHaveBeenCalledTimes(1);
    running = true;
    await act(async () => root!.render(createElement(AudioProbe)));
    expect(oscillators).toHaveLength(6);
    await act(async () => root!.unmount());
    root = null;
    for (const voice of oscillators) expect(voice.stop).toHaveBeenCalledTimes(1);
  });
});

describe('optional audio cannot hold the actual electrical startup', () => {
  it('starts real ready/LED while resume is pending and stays stopped after late completion', async () => {
    await prepare();
    await run();
    expect(nativeContext.resume).toHaveBeenCalledTimes(1);
    expect(oscillators).toHaveLength(0);
    await stop();
    for (const voice of oscillators) expect(voice.stop).toHaveBeenCalledTimes(1);
    nativeContext.state = 'running';
    pending.resolve();
    await flush();
    expect(oscillators).toHaveLength(0);
    for (const voice of oscillators) expect(voice.start).toHaveBeenCalledTimes(1);
    expect(c().simulationRunning).toBe(false);
  });
  it('consumes asynchronous resume rejection without blocking or an unhandled rejection', async () => {
    await prepare();
    await run();
    pending.reject(new Error('native audio permission rejected'));
    await flush();
    expect(c().simulationStatus).toBe('running');
    await stop();
  });
  it('continues the actual electrical start after an audio constructor failure', async () => {
    await prepare();
    constructorThrows = true;
    await run();
    expect(oscillators).toHaveLength(0);
    await stop();
  });
  it('continues the actual electrical start after a synchronous resume failure', async () => {
    await prepare();
    resumeThrows = true;
    await run();
    await stop();
  });
  it('late completion after unmount does not create another voice', async () => {
    await prepare();
    await run();
    await act(async () => root!.unmount());
    root = null;
    const count = oscillators.length;
    pending.resolve();
    await flush();
    expect(oscillators).toHaveLength(count);
    for (const voice of oscillators) expect(voice.stop).toHaveBeenCalledTimes(1);
  });
  it('keeps normally resolved audio and repeated real Stop/Run', async () => {
    await prepare();
    pending.resolve();
    await run();
    expect(oscillators).toHaveLength(0);
    await stop();
    await run();
    expect(oscillators).toHaveLength(0);
    await stop();
    for (const voice of oscillators) expect(voice.stop).toHaveBeenCalledTimes(1);
  });
});
