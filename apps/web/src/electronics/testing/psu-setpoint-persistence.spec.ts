/* @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, type Project, type SchematicDocument } from '../../api';
import { readLocalProjectDraft } from '../../modules/project-local-draft';
import {
  configureProductionLibrary,
  type OwnerCatalogManifest,
} from '../production-manifest-adapter';
import { evaluateSimulationWorkerRequest } from '../simulation-worker-evaluator';
import type {
  ElectronicsSimulationWorkerRequest,
  ElectronicsSimulationWorkerResponse,
} from '../simulation-worker-protocol';
import { normalizeLoadedDocument } from '../use-workbench-project-state';
import { useElectronicsWorkbench } from '../use-electronics-workbench';

// jsdom supplies no Worker or audio hardware. Keep the real client/controller,
// evaluator, physics, project-state, recovery and queue; only transport is in-process.
vi.mock('../use-piezo-audio', () => ({
  unlockPiezoAudio: async () => {},
  usePiezoAudio: () => {},
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

class InProcessWorker {
  onmessage: ((event: MessageEvent<ElectronicsSimulationWorkerResponse>) => void) | null = null;
  onerror = null;
  onmessageerror = null;
  stopped = false;
  postMessage(request: ElectronicsSimulationWorkerRequest) {
    if (request.kind === 'cancel-generation') return;
    queueMicrotask(() => {
      if (!this.stopped)
        this.onmessage?.({
          data: evaluateSimulationWorkerRequest(request),
        } as MessageEvent<ElectronicsSimulationWorkerResponse>);
    });
  }
  terminate() {
    this.stopped = true;
  }
}

const actor = 'psu-settings-pupil';
const projectId = 'psu-settings-project';
const sketch =
  '// retained whole sketch\nvoid setup(){pinMode(13,OUTPUT);digitalWrite(13,HIGH);}\nvoid loop(){delay(100);}\n';
const fixture: SchematicDocument = {
  schemaVersion: 4,
  components: [
    {
      id: 'supply',
      kind: 'source',
      componentTypeId: 'regulated-power-supply',
      variantId: 'regulated-power-supply',
      position: { x: 10, y: 20 },
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
      id: 'load',
      kind: 'resistor',
      componentTypeId: 'resistor-axial',
      variantId: 'resistor-axial',
      position: { x: 400, y: 20 },
      value: 100,
      pinIds: ['lead-1', 'lead-2'],
      stateProperties: { powerRatingWatt: 5 },
    },
    {
      id: 'uno',
      kind: 'visual',
      componentTypeId: 'arduino-uno',
      variantId: 'arduino-uno',
      position: { x: 700, y: 100 },
      value: 5,
      pinIds: ['d13', 'power-gnd-1', 'power-5v', 'power-3v3'],
      stateProperties: {
        arduinoCodeMode: 'text',
        arduinoSource: sketch,
        arduinoWorkspace: '{"blocks":{"blocks":[]}}',
        arduinoSerialOpen: false,
        arduinoBaudRate: 9600,
      },
    },
  ],
  connections: [
    {
      id: 'positive',
      from: { componentId: 'supply', terminal: 'positive' },
      to: { componentId: 'load', terminal: 'lead-1' },
      vertices: [{ x: 300, y: 20 }],
      color: '#ff0000',
    },
    {
      id: 'negative',
      from: { componentId: 'load', terminal: 'lead-2' },
      to: { componentId: 'supply', terminal: 'negative' },
      vertices: [],
      color: '#000000',
    },
  ],
  viewport: { x: 5, y: 6, zoom: 1.25 },
  simulation: { running: false, maxIterations: 24 },
};
let initial: SchematicDocument;
let host: HTMLDivElement;
let root: Root | null = null;
let current: ReturnType<typeof useElectronicsWorkbench> | null = null;
let saved: SchematicDocument;
let revision: number;
function c() {
  if (!current) throw new Error('Hook missing');
  return current;
}
function Probe() {
  current = useElectronicsWorkbench(projectId, actor);
  return null;
}
beforeAll(() => {
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
  initial = normalizeLoadedDocument(fixture);
});
async function prepare() {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  vi.setSystemTime(0);
  vi.stubGlobal('Worker', InProcessWorker);
  localStorage.clear();
  revision = 1;
  saved = structuredClone(initial);
  vi.spyOn(api, 'me').mockResolvedValue({
    ok: true,
    status: 200,
    data: { authenticated: true, user: { id: actor } },
  } as Awaited<ReturnType<typeof api.me>>);
  vi.spyOn(api, 'openProject').mockImplementation(
    async () =>
      ({
        ok: true,
        status: 200,
        data: {
          project: {
            id: projectId,
            moduleKey: 'electronics',
            title: 'PSU',
            scope: 'personal',
            classroomId: null,
            status: 'active',
          } as Project,
          draft: { projectId, document: structuredClone(saved), revision, updatedAt: '' },
          versions: [],
          result: null,
        },
      }) as Awaited<ReturnType<typeof api.openProject>>,
  );
  const save = vi.spyOn(api, 'saveDraft').mockImplementation(async (_id, document) => {
    saved = structuredClone(document as SchematicDocument);
    return {
      ok: true,
      status: 200,
      data: {
        draft: { projectId, document: saved, revision: ++revision, updatedAt: '' },
        result: null,
      },
    } as Awaited<ReturnType<typeof api.saveDraft>>;
  });
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root!.render(createElement(Probe)));
  expect(c().status).toBe('ready');
  return save;
}
function expected(voltage: number, limit: number, output = true): SchematicDocument {
  return {
    ...initial,
    components: initial.components.map((part) =>
      part.id === 'supply'
        ? {
            ...part,
            value: voltage,
            state: output,
            stateProperties: {
              ...part.stateProperties,
              voltageSetpointVolt: voltage,
              currentLimitAmp: limit,
              outputEnabled: output,
            },
          }
        : part,
    ),
  };
}
function local() {
  return readLocalProjectDraft<SchematicDocument>(localStorage, projectId, 'electronics', actor)
    ?.document;
}
function runtime(voltage: number, limit: number, output = true): SchematicDocument {
  const document = expected(voltage, limit);
  return {
    ...document,
    simulation: { ...document.simulation, running: true },
    components: document.components.map((part) =>
      part.id === 'supply'
        ? { ...part, stateProperties: { ...part.stateProperties, outputEnabled: output } }
        : part,
    ),
  };
}
async function toggle() {
  await act(async () => {
    await c().toggleSimulation();
  });
  await act(async () => {
    for (let index = 0; index < 20; index++) await Promise.resolve();
  });
  if (c().simulationRunning) expect(c().simulationStatus).toBe('running');
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  current = null;
  host?.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('PSU pupil settings use the real document/recovery/save queue', () => {
  it('persists only U/I/value during Run and retains the whole document across Stop/Run and manual Save', async () => {
    const save = await prepare();
    await toggle();
    expect(c().simulationRunning).toBe(true);
    await act(async () =>
      c().setRegulatedPowerSupplyControls('supply', {
        voltageSetpointVolt: 7.5,
        currentLimitAmp: 0.15,
        outputEnabled: false,
      }),
    );
    expect(c().document).toEqual(runtime(7.5, 0.15, false));
    expect(local()).toEqual(expected(7.5, 0.15));
    expect(save).not.toHaveBeenCalled();
    const edited = c().document;
    await act(async () =>
      c().setRegulatedPowerSupplyControls('supply', {
        voltageSetpointVolt: 7.5,
        currentLimitAmp: 0.15,
      }),
    );
    expect(c().document).toBe(edited);
    await toggle();
    expect(c().simulationRunning).toBe(false);
    expect(c().document).toEqual(expected(7.5, 0.15));
    await toggle();
    expect(c().simulationRunning).toBe(true);
    await act(async () => c().saveNow());
    expect(save).toHaveBeenCalledTimes(1);
    expect(saved).toEqual(expected(7.5, 0.15));
    expect(c().serverRevision).toBe(2);
    expect(local()).toBeUndefined();
  });

  it('keeps an output-only Run toggle out of dirty/recovery/revision/autosave', async () => {
    const save = await prepare();
    await toggle();
    expect(c().canUndo).toBe(false);
    await act(async () => c().setRegulatedPowerSupplyControls('supply', { outputEnabled: false }));
    expect(c().document).toEqual(runtime(5, 1, false));
    expect(c().canUndo).toBe(false);
    expect(local()).toBeUndefined();
    expect(c().serverRevision).toBe(1);
    await toggle();
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(save).not.toHaveBeenCalled();
    expect(saved).toEqual(initial);
  });

  it('coalesces a burst into the latest normal quiet-minute autosave with no knob HTTP', async () => {
    const save = await prepare();
    await toggle();
    // Same render deliberately: each mutation must merge the latest document ref.
    await act(async () => {
      c().setRegulatedPowerSupplyControls('supply', { voltageSetpointVolt: 6 });
      c().setRegulatedPowerSupplyControls('supply', { currentLimitAmp: 0.15 });
      c().setRegulatedPowerSupplyControls('supply', { voltageSetpointVolt: 7.5 });
    });
    expect(c().document).toEqual(runtime(7.5, 0.15));
    expect(save).not.toHaveBeenCalled();
    await toggle();
    await act(async () => vi.advanceTimersByTimeAsync(59_999));
    expect(save).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(save).toHaveBeenCalledTimes(1);
    expect(saved).toEqual(expected(7.5, 0.15));
    expect(c().serverRevision).toBe(2);
  });

  it('does not let an old in-flight save replace the latest U/I or scoped recovery', async () => {
    const save = await prepare();
    await toggle();
    await act(async () =>
      c().setRegulatedPowerSupplyControls('supply', { voltageSetpointVolt: 6 }),
    );
    let release!: () => void;
    save.mockImplementationOnce(async (_id, document) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        ok: true,
        status: 200,
        data: { draft: { projectId, document, revision: 2, updatedAt: '' }, result: null },
      } as Awaited<ReturnType<typeof api.saveDraft>>;
    });
    let pending!: Promise<void>;
    await act(async () => {
      pending = c().saveNow();
    });
    await act(async () =>
      c().setRegulatedPowerSupplyControls('supply', {
        voltageSetpointVolt: 7.5,
        currentLimitAmp: 0.15,
      }),
    );
    await act(async () => {
      release();
      await pending;
    });
    expect(c().document).toEqual(runtime(7.5, 0.15));
    expect(local()).toEqual(expected(7.5, 0.15));
    await act(async () => c().saveNow());
    expect(saved).toEqual(expected(7.5, 0.15));
    expect(local()).toBeUndefined();
  });

  it('rejects invalid identity/type/non-finite patches and clamps only approved U/I', async () => {
    const save = await prepare();
    await toggle();
    const before = c().document;
    await act(async () => {
      c().setRegulatedPowerSupplyControls('missing', { voltageSetpointVolt: 7.5 });
      c().setRegulatedPowerSupplyControls('load', { voltageSetpointVolt: 7.5 });
      c().setRegulatedPowerSupplyControls('supply', { voltageSetpointVolt: NaN });
      c().setRegulatedPowerSupplyControls('supply', { currentLimitAmp: Infinity });
      c().setRegulatedPowerSupplyControls('supply', {
        voltageSetpointVolt: '7.5' as unknown as number,
      });
      c().setRegulatedPowerSupplyControls('supply', { outputEnabled: 1 as unknown as boolean });
      c().setRegulatedPowerSupplyControls('supply', {});
    });
    expect(c().document).toBe(before);
    expect(local()).toBeUndefined();
    await act(async () =>
      c().setRegulatedPowerSupplyControls('supply', {
        voltageSetpointVolt: 100,
        currentLimitAmp: -1,
      }),
    );
    expect(c().document).toEqual(runtime(30, 0));
    await act(async () =>
      c().setRegulatedPowerSupplyControls('supply', {
        voltageSetpointVolt: -1,
        currentLimitAmp: 100,
      }),
    );
    expect(c().document).toEqual(runtime(0, 5));
    expect(save).not.toHaveBeenCalled();
  });

  it('retains the existing stopped output persistence rule and avoids identical commits', async () => {
    await prepare();
    await act(async () =>
      c().setRegulatedPowerSupplyControls('supply', {
        voltageSetpointVolt: 7.5,
        currentLimitAmp: 0.15,
        outputEnabled: false,
      }),
    );
    expect(c().document).toEqual(expected(7.5, 0.15, false));
    const before = c().document;
    await act(async () =>
      c().setRegulatedPowerSupplyControls('supply', {
        voltageSetpointVolt: 7.5,
        currentLimitAmp: 0.15,
        outputEnabled: false,
      }),
    );
    expect(c().document).toBe(before);
  });
});
