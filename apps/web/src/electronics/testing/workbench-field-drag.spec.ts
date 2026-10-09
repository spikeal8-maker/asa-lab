/* @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement, type PointerEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { api, type Project, type SchematicDocument } from '../../api';
import { configureProductionLibrary } from '../production-manifest-adapter';
import { useElectronicsWorkbench } from '../use-electronics-workbench';
import { addComponentToDocument } from '../workbench-document';
import { worldToClient, type Point } from '../workbench-geometry';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../workbench-model';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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
    ),
  );
});

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let current: ReturnType<typeof useElectronicsWorkbench> | null = null;
let frame: FrameRequestCallback | null = null;
const rect = { left: 35, top: 90, width: 1080, height: 670 };
const projectId = 'field-drag-project';
const userId = 'field-drag-user';

function state() {
  if (!current) throw new Error('Workbench has not mounted');
  return current;
}

function Probe() {
  current = useElectronicsWorkbench(projectId, userId);
  return createElement(
    'svg',
    { ref: current.stageRef },
    current.document?.components.map((part) =>
      createElement('g', {
        key: part.id,
        'data-testid': 'schematic-component',
        'data-component-id': part.id,
        transform: `translate(${part.position.x} ${part.position.y})`,
      }),
    ),
  );
}

function fixture(position: Point, zoom = 1): SchematicDocument {
  let doc: SchematicDocument = {
    schemaVersion: 4,
    components: [],
    connections: [],
    viewport: { x: position.x - 300, y: position.y - 200, zoom },
    simulation: { running: false, maxIterations: 24 },
  };
  for (const [type, id, dx, dy] of [
    ['battery-holder-aa-2', 'source', 0, 0],
    ['resistor-axial', 'resistor', 210, -19],
    ['led-5mm', 'led', 344, 130],
    ['arduino-uno', 'uno', -111, -337],
  ] as const) {
    doc = addComponentToDocument(doc, type, { x: 0, y: 0 }, id).document;
    doc = {
      ...doc,
      components: doc.components.map((part) =>
        part.id === id ? { ...part, position: { x: position.x + dx, y: position.y + dy } } : part,
      ),
    };
  }
  return {
    ...doc,
    components: doc.components.map((part) =>
      part.id === 'uno'
        ? {
            ...part,
            stateProperties: {
              ...part.stateProperties,
              arduinoSource:
                'void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, HIGH); delay(250); digitalWrite(13, LOW); delay(250); }',
            },
          }
        : part,
    ),
    connections: [
      {
        id: 'positive',
        from: { componentId: 'source', terminal: 'BAT+' },
        to: { componentId: 'resistor', terminal: 'lead-1' },
        color: '#e3212b',
        vertices: [{ x: position.x + 146, y: position.y - 60 }],
      },
      {
        id: 'load',
        from: { componentId: 'resistor', terminal: 'lead-2' },
        to: { componentId: 'led', terminal: 'anode' },
        color: '#149447',
        vertices: [],
      },
      {
        id: 'return',
        from: { componentId: 'led', terminal: 'cathode' },
        to: { componentId: 'source', terminal: 'BAT-' },
        color: '#2a3035',
        vertices: [{ x: position.x + 216, y: position.y + 270 }],
      },
    ],
  };
}

async function mount(initial: SchematicDocument) {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(0);
  window.localStorage.clear();
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    frame = null;
  });
  vi.spyOn(api, 'me').mockResolvedValue({
    ok: true,
    status: 200,
    data: { authenticated: true, user: { id: userId } },
  } as Awaited<ReturnType<typeof api.me>>);
  const project = {
    id: projectId,
    moduleKey: 'electronics',
    title: 'Saved field circuit',
    scope: 'personal',
    classroomId: null,
    status: 'active',
    createdAt: '',
    updatedAt: '',
    preview: null,
    snapshotRevision: null,
    copiedFrom: null,
  } as Project;
  vi.spyOn(api, 'openProject').mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      project,
      draft: { projectId, document: initial, revision: 2, updatedAt: '' },
      versions: [],
      result: null,
    },
  } as Awaited<ReturnType<typeof api.openProject>>);
  vi.spyOn(api, 'saveDraft').mockImplementation(async (_id, document) => ({
    ok: true,
    status: 200,
    data: { draft: { projectId, document, revision: 3, updatedAt: '' }, result: null },
  }));
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () => root!.render(createElement(Probe)));
  expect(state().status).toBe('ready');
  const stage = state().stageRef.current!;
  vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);
  Object.assign(stage, {
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  });
  return JSON.parse(JSON.stringify(state().document)) as SchematicDocument;
}

function event(client: Point, patch: Partial<PointerEvent<SVGSVGElement>> = {}) {
  return {
    clientX: client.x,
    clientY: client.y,
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    shiftKey: false,
    currentTarget: state().stageRef.current!,
    target: state().stageRef.current!,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
    ...patch,
  } as PointerEvent<SVGSVGElement>;
}

function begin(id = 'source', patch: Partial<PointerEvent<SVGSVGElement>> = {}) {
  const part = state().document!.components.find((item) => item.id === id)!;
  const client = worldToClient(
    { x: part.position.x + 85, y: part.position.y + 150 },
    rect,
    state().viewport,
    STAGE_WIDTH,
    STAGE_HEIGHT,
  );
  act(() => state().startComponentDrag(event(client, patch), part));
  return client;
}

function move(client: Point) {
  act(() => state().handlePointerMove(event(client)));
  act(() => {
    const draw = frame;
    frame = null;
    draw?.(0);
  });
}

function finish(client: Point, patch: Partial<PointerEvent<SVGSVGElement>> = {}) {
  act(() => state().finishPointer(event(client, patch)));
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host?.remove();
  host = null;
  current = null;
  frame = null;
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('mounted production workbench field dragging', () => {
  const positions = [
    { x: -5216, y: -10 },
    { x: 6216, y: -10 },
    { x: 210, y: -4216 },
    { x: 210, y: 5216 },
    { x: -5216, y: -4216 },
    { x: 6216, y: -4216 },
    { x: -5216, y: 5216 },
    { x: 6216, y: 5216 },
  ];
  for (const zoom of [0.5, 1, 2]) {
    it.each(positions)('translates saved ($x,$y) by pointer motion at zoom ' + zoom, async (at) => {
      const before = await mount(fixture(at, zoom));
      const beforeBytes = JSON.stringify(before);
      const viewport = { ...state().viewport };
      const start = begin();
      const clientDelta = { x: 24, y: 18 };
      const end = { x: start.x + clientDelta.x, y: start.y + clientDelta.y };
      const scale = Math.max(rect.width / STAGE_WIDTH, rect.height / STAGE_HEIGHT) * zoom;
      const delta = { x: clientDelta.x / scale, y: clientDelta.y / scale };
      move(end);
      expect(state().document).toEqual(before);
      expect(state().canUndo).toBe(false);
      const node = state().stageRef.current!.querySelector('[data-component-id="source"]')!;
      const preview = node.getAttribute('transform')!.match(/^translate\(([^ ]+) ([^)]+)\)/)!;
      expect(Number(preview[1])).toBeCloseTo(delta.x, 8);
      expect(Number(preview[2])).toBeCloseTo(delta.y, 8);
      finish(end);
      const expected: SchematicDocument = {
        ...before,
        components: before.components.map((part) =>
          part.id === 'source'
            ? {
                ...part,
                holeBindings: {},
                position: {
                  x: part.position.x + Math.round(delta.x * 1000) / 1000,
                  y: part.position.y + Math.round(delta.y * 1000) / 1000,
                },
              }
            : part,
        ),
      };
      expect(state().document).toEqual(expected);
      expect(state().viewport).toEqual(viewport);
      expect(JSON.stringify(before)).toBe(beforeBytes);
      expect(state().canUndo).toBe(true);
      act(() => state().undo());
      expect(state().document).toEqual(before);
      expect(state().canUndo).toBe(false);
      act(() => state().redo());
      expect(state().document).toEqual(expected);
      expect(state().canRedo).toBe(false);
    });
  }

  it('keeps grouped relative positions and carries only internal wire bends', async () => {
    const before = await mount(fixture({ x: -5216, y: -4216 }));
    act(() =>
      state().setSelection({ kind: 'component', id: 'source', ids: ['source', 'resistor'] }),
    );
    const start = begin();
    const delta = { x: -31.25, y: 17.5 };
    const scale = Math.max(rect.width / STAGE_WIDTH, rect.height / STAGE_HEIGHT);
    const end = { x: start.x + delta.x * scale, y: start.y + delta.y * scale };
    move(end);
    expect(state().document).toEqual(before);
    finish(end);
    expect(state().document).toEqual({
      ...before,
      components: before.components.map((part) =>
        ['source', 'resistor'].includes(part.id)
          ? {
              ...part,
              holeBindings: {},
              position: { x: part.position.x + delta.x, y: part.position.y + delta.y },
            }
          : part,
      ),
      connections: before.connections.map((wire) =>
        wire.id === 'positive'
          ? {
              ...wire,
              vertices: wire.vertices!.map((point) => ({
                x: point.x + delta.x,
                y: point.y + delta.y,
              })),
            }
          : wire,
      ),
    });
    expect(state().selection).toEqual({
      kind: 'component',
      id: 'source',
      ids: ['source', 'resistor'],
    });
  });

  it.each([
    ['zero motion', { x: 0, y: 0 }, {}],
    ['below 3 px', { x: 1, y: 1 }, {}],
    ['right button', { x: 24, y: 18 }, { button: 2 }],
    ['Shift press', { x: 24, y: 18 }, { shiftKey: true }],
  ] as const)('does not move or create history on %s', async (_name, delta, patch) => {
    const before = await mount(fixture({ x: -5216, y: -4216 }));
    const start = begin('source', patch);
    const end = { x: start.x + delta.x, y: start.y + delta.y };
    move(end);
    finish(end);
    expect(state().document).toEqual(before);
    expect(state().canUndo).toBe(false);
  });

  it('carries a breadboard and its bound parts together outside the old grid', async () => {
    const initial = addComponentToDocument(
      fixture({ x: -5216, y: -4216 }),
      'breadboard-medium',
      { x: -5000, y: -4000 },
      'board',
    ).document;
    initial.components = initial.components.map((part) =>
      part.id === 'led'
        ? { ...part, holeBindings: { anode: { breadboardComponentId: 'board', holeId: 'J8' } } }
        : part,
    );
    const before = await mount(initial);
    const start = begin('board');
    const delta = { x: 24.5, y: -13.25 };
    const scale = Math.max(rect.width / STAGE_WIDTH, rect.height / STAGE_HEIGHT);
    const end = { x: start.x + delta.x * scale, y: start.y + delta.y * scale };
    move(end);
    expect(state().document).toEqual(before);
    finish(end);
    expect(state().document).toEqual({
      ...before,
      components: before.components.map((part) =>
        ['board', 'led'].includes(part.id)
          ? {
              ...part,
              holeBindings: part.holeBindings ?? {},
              position: { x: part.position.x + delta.x, y: part.position.y + delta.y },
            }
          : part,
      ),
    });
    act(() => state().undo());
    expect(state().document).toEqual(before);
  });

  it('ignores another pointer release and commits only the captured pointer', async () => {
    const before = await mount(fixture({ x: 6216, y: 5216 }));
    const start = begin();
    const end = { x: start.x - 30, y: start.y - 20 };
    finish(end, { pointerId: 2 });
    expect(state().document).toEqual(before);
    expect(state().canUndo).toBe(false);
    finish(end);
    expect(state().document!.components[0]!.position.x).toBeLessThan(
      before.components[0]!.position.x,
    );
    expect(state().canUndo).toBe(true);
  });

  it('restores a cancelled preview without committing a partial gesture', async () => {
    const before = await mount(fixture({ x: 6216, y: 5216 }));
    const start = begin();
    const end = { x: start.x - 30, y: start.y - 20 };
    move(end);
    act(() => state().cancelPointer(event(end)));
    finish(end);
    expect(state().document).toEqual(before);
    expect(state().canUndo).toBe(false);
    expect(
      state()
        .stageRef.current!.querySelector('[data-component-id="source"]')!
        .getAttribute('transform'),
    ).toBe(`translate(${before.components[0]!.position.x} ${before.components[0]!.position.y})`);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects a non-finite pointer coordinate %s without corrupting saved geometry',
    async (x) => {
      const before = await mount(fixture({ x: -5216, y: -4216 }));
      const start = begin();
      finish({ x, y: start.y + 20 });
      expect(state().document).toEqual(before);
      expect(state().canUndo).toBe(false);
    },
  );
});
