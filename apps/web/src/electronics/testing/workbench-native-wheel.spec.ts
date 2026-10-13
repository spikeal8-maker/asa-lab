/* @vitest-environment jsdom */
import { act, createElement, StrictMode, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type Project, type SchematicDocument } from '../../api';
import { WorkbenchStage } from '../WorkbenchStage';
import {
  useElectronicsWorkbench,
  readLocalElectronicsViewport,
} from '../use-electronics-workbench';

// The real Stage, controller, geometry and viewport persistence run here.
// Hardware audio is irrelevant to this stopped, empty navigation fixture.
vi.mock('../use-piezo-audio', () => ({
  unlockPiezoAudio: async () => {},
  usePiezoAudio: () => {},
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const initial: SchematicDocument = {
  schemaVersion: 4,
  components: [],
  connections: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  simulation: { running: false, maxIterations: 24 },
};
let host: HTMLDivElement;
let root: Root;
let controller: ReturnType<typeof useElectronicsWorkbench>;
let generation = 0;
let calls: number[] = [];
function Probe({ stageKey = 'first' }: { stageKey?: string }) {
  controller = useElectronicsWorkbench('wheel-project', 'wheel-pupil');
  const ownGeneration = generation;
  return controller.document
    ? createElement(WorkbenchStage, {
        key: stageKey,
        showGrid: true,
        controller: {
          ...controller,
          handleWheel(event) {
            calls.push(ownGeneration);
            controller.handleWheel(event);
          },
        },
      })
    : null;
}
async function mount(stageKey = 'first') {
  await act(async () =>
    root.render(createElement(StrictMode, null, createElement(Probe, { stageKey }))),
  );
  const stage = host.querySelector<SVGSVGElement>('.workbench-canvas')!;
  expect(stage).not.toBeNull();
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({
    left: 10,
    top: 20,
    width: 1000,
    height: 700,
    right: 1010,
    bottom: 720,
    x: 10,
    y: 20,
    toJSON() {},
  });
  stage.setPointerCapture = vi.fn();
  stage.hasPointerCapture = () => false;
  return stage;
}
async function wheel(stage: SVGSVGElement, deltaY = 100, cancelable = true) {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable,
    deltaY,
    clientX: 410,
    clientY: 300,
  });
  await act(async () => {
    stage.dispatchEvent(event);
  });
  return event;
}
beforeEach(() => {
  localStorage.clear();
  calls = [];
  generation = 0;
  vi.spyOn(api, 'me').mockResolvedValue({
    ok: true,
    status: 200,
    data: { authenticated: true, user: { id: 'wheel-pupil' } },
  } as Awaited<ReturnType<typeof api.me>>);
  vi.spyOn(api, 'openProject').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      project: {
        id: 'wheel-project',
        moduleKey: 'electronics',
        title: 'Wheel',
        scope: 'personal',
        classroomId: null,
        status: 'active',
      } as Project,
      draft: { projectId: 'wheel-project', document: initial, revision: 1, updatedAt: '' },
      versions: [],
      result: null,
    },
  } as Awaited<ReturnType<typeof api.openProject>>);
  vi.spyOn(api, 'saveDraft');
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
describe('mounted production native wheel', () => {
  it('cancels one native event, zooms once and only stores the local viewport', async () => {
    const stage = await mount();
    const before = { ...controller.viewport };
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const event = await wheel(stage);
    expect(event.defaultPrevented).toBe(true);
    expect(calls).toEqual([0]);
    expect(controller.viewport.zoom).toBeCloseTo(before.zoom * 0.88, 12);
    // Independent xMidYMid/slice anchor calculation, not the production helper.
    function world(view: typeof before) {
      const scale = Math.max((1000 * view.zoom) / 1600, (700 * view.zoom) / 980);
      const ox = (1000 - (1600 / view.zoom) * scale) / 2;
      const oy = (700 - (980 / view.zoom) * scale) / 2;
      return { x: view.x + (400 - ox) / scale, y: view.y + (280 - oy) / scale };
    }
    expect(world(controller.viewport).x).toBeCloseTo(world(before).x, 10);
    expect(world(controller.viewport).y).toBeCloseTo(world(before).y, 10);
    expect(readLocalElectronicsViewport('wheel-project')).toEqual(controller.viewport);
    expect(
      writes.mock.calls.filter(([key]) => String(key).startsWith('asa-electronics-viewport:')),
    ).toHaveLength(1);
    expect(controller.document).toEqual(initial);
    expect(api.saveDraft).not.toHaveBeenCalled();
  });
  it('uses fresh callbacks and cleans up old SVG nodes across replacement and unmount', async () => {
    const first = await mount();
    generation = 1;
    await mount();
    await wheel(first, -100);
    expect(calls).toEqual([1]);
    const second = await mount('replacement');
    await wheel(first);
    expect(calls).toEqual([1]);
    await wheel(second);
    expect(calls).toEqual([1, 1]);
    await act(async () => root.render(null));
    await wheel(second);
    expect(calls).toEqual([1, 1]);
    await mount('remount');
    await wheel(host.querySelector<SVGSVGElement>('.workbench-canvas')!);
    expect(calls).toEqual([1, 1, 1]);
  });
  it('preserves both zoom signs, min/max clamps and noncancelable delivery', async () => {
    const stage = await mount();
    const before = controller.viewport.zoom;
    await wheel(stage, -100, false);
    expect(controller.viewport.zoom).toBeCloseTo(before * 1.14, 12);
    for (let i = 0; i < 25; i++) await wheel(stage, -100);
    expect(controller.viewport.zoom).toBe(8);
    for (let i = 0; i < 40; i++) await wheel(stage, 100);
    expect(controller.viewport.zoom).toBe(0.2);
    expect(controller.document).toEqual(initial);
    expect(api.saveDraft).not.toHaveBeenCalled();
  });
  for (const guard of ['component', 'vertex', 'segment', 'pinch'] as const) {
    it('keeps the ' + guard + ' interaction guard while cancelling the wheel', async () => {
      const stage = await mount();
      const pointer = (id: number) =>
        ({
          pointerId: id,
          pointerType: 'touch',
          button: 0,
          clientX: 410 + id * 20,
          clientY: 300,
          currentTarget: stage,
          stopPropagation() {},
          preventDefault() {},
        }) as unknown as ReactPointerEvent<SVGSVGElement>;
      await act(async () => {
        if (guard === 'vertex')
          controller.startVertexDrag(
            pointer(1) as unknown as ReactPointerEvent<SVGCircleElement>,
            'wire',
            0,
          );
        if (guard === 'segment')
          controller.startSegmentDrag(
            pointer(1) as unknown as ReactPointerEvent<SVGPathElement>,
            'wire',
            0,
          );
        if (guard === 'component')
          controller.startComponentDrag(pointer(1), {
            id: 'component',
            kind: 'resistor',
            position: { x: 100, y: 100 },
            value: 220,
          });
        if (guard === 'pinch') {
          controller.beginStagePointer(pointer(1));
          controller.beginStagePointer(pointer(2));
        }
      });
      const before = { ...controller.viewport };
      const event = await wheel(stage);
      expect(event.defaultPrevented).toBe(true);
      expect(calls).toEqual([0]);
      expect(controller.viewport).toEqual(before);
      expect(api.saveDraft).not.toHaveBeenCalled();
    });
  }
  it('does not cancel outside the stage', async () => {
    await mount();
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(calls).toEqual([]);
  });
});
