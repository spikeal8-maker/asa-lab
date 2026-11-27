// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Box3,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { createRoboticsRuntime } from '@asa-lab/robotics/runtime';
import {
  createRoboticsBall,
  createRoboticsBody,
  createRoboticsFloorMark,
  createRoboticsWall,
  createRoboticsWorldV3Document,
} from '@asa-lab/robotics/world-document';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { moveFieldObject } from '../RobotFieldEditor';
import { fieldWorldToScreen } from '../field-camera';
import {
  createFieldSpatialScene,
  createRobotSpatialScene,
  readRobotVisualGeometry,
  type SpatialPlacement,
} from '../field-spatial-scene';
import RobotFieldSpatialView, {
  bindSpatialFieldGestures,
  spatialEditPoint,
  readSideMetricScale,
  configureTopCamera,
  frameRobotCamera,
  type FieldViewportControls,
} from '../RobotFieldSpatialView';

const rendererFailure = vi.hoisted(() => ({
  render: vi.fn(),
  dispose: vi.fn(),
  construct: vi.fn(),
}));
vi.mock('three', async (original) => ({
  ...(await original<typeof import('three')>()),
  WebGLRenderer: class {
    constructor() {
      rendererFailure.construct();
    }
    render = rendererFailure.render;
    dispose = rendererFailure.dispose;
    setPixelRatio() {}
    setClearColor() {}
    setSize() {}
  },
}));

it('calibrates the side ruler against actual orthographic projections in CSS pixels', () => {
  const camera = new OrthographicCamera(-2, 2, 1, -1, 0.01, 20);
  camera.up.set(0, 0, 1);
  camera.position.set(0, -10, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const verify = (width: number, height: number) => {
    camera.updateProjectionMatrix();
    const scale = readSideMetricScale(camera, width, height);
    expect(scale).not.toBeNull();
    if (!scale) throw new Error('Valid side projection has no metric ruler');
    const origin = new Vector3(0, 0, 0).project(camera);
    const horizontal = new Vector3(scale.meters, 0, 0).project(camera);
    const vertical = new Vector3(0, 0, scale.meters).project(camera);
    expect(((horizontal.x - origin.x) * width) / 2).toBeCloseTo(scale.cssPixels, 10);
    expect(((vertical.y - origin.y) * height) / 2).toBeCloseTo(scale.cssPixels, 10);
    expect(scale.cssPixels).toBeGreaterThan(0);
    expect(scale.cssPixels).toBeLessThanOrEqual(84);
    return scale;
  };
  expect(verify(800, 400)).toMatchObject({ meters: 0.2, cssPixels: 40, label: '20 см' });
  camera.zoom = 2.5;
  expect(verify(800, 400)).toMatchObject({ meters: 0.1, cssPixels: 50, label: '10 см' });
  camera.left = -1.6;
  camera.right = 1.6;
  camera.top = 2;
  camera.bottom = -2;
  const portrait = verify(320, 400);
  camera.position.add(new Vector3(5, 0, 3));
  camera.updateMatrixWorld(true);
  expect(verify(320, 400)).toEqual(portrait); // Panning changes neither unit nor scale.
});

it('keeps metric choices deterministic across DPR and formats millimetres through metres', () => {
  const camera = new OrthographicCamera(-2, 2, 1, -1, 0.01, 20);
  const dpr = vi.spyOn(window, 'devicePixelRatio', 'get');
  try {
    dpr.mockReturnValue(1);
    const first = readSideMetricScale(camera, 800, 400);
    dpr.mockReturnValue(2);
    expect(readSideMetricScale(camera, 800, 400)).toEqual(first);
    camera.zoom = 100;
    expect(readSideMetricScale(camera, 800, 400)?.label).toBe('2 мм');
    camera.zoom = 0.1;
    expect(readSideMetricScale(camera, 800, 400)?.label).toBe('2 м');
  } finally {
    dpr.mockRestore();
  }
});

it('hides side calibration for inactive, perspective, invalid and nonsquare projections', () => {
  const camera = new OrthographicCamera(-2, 2, 1, -1, 0.01, 20);
  expect(readSideMetricScale(camera, 800, 400, false)).toBeNull();
  expect(readSideMetricScale(new PerspectiveCamera(), 800, 400)).toBeNull();
  for (const [width, height] of [
    [0, 400],
    [800, 0],
    [NaN, 400],
    [800, Infinity],
    [800, 800],
  ])
    expect(readSideMetricScale(camera, width!, height!)).toBeNull();
  for (const zoom of [0, -1, NaN, Infinity, 1e300]) {
    camera.zoom = zoom;
    expect(readSideMetricScale(camera, 800, 400)).toBeNull();
  }
  camera.zoom = 1;
  camera.right = camera.left;
  expect(readSideMetricScale(camera, 800, 400)).toBeNull();
  camera.right = 2;
  camera.setViewOffset(800, 400, 0, 0, 400, 400);
  expect(readSideMetricScale(camera, 800, 400)).toBeNull();
});

it('picks and focuses a committed moving can above overlapping field markings', () => {
  const floor = createRoboticsWorldV3Document('practice');
  const can = createRoboticsBody('can', 'can', { xMeters: 0.8, yMeters: 0.9 });
  const mark = createRoboticsFloorMark('area', 'base', { xMeters: 0.72, yMeters: 0.8 });
  const world = {
    ...floor,
    initialPose: { xMeters: 0.25, yMeters: 0.9, headingRadians: 0 },
    field: {
      ...floor.field,
      obstacles: [],
      bodies: [can],
      floorMarks: [mark, { ...mark, id: 'top', color: '#fb923c' }],
    },
  };
  const savedSource = structuredClone(world);
  const runtime = createRoboticsRuntime(world);
  const initial = runtime.read();
  const rpm = (0.5 * 60) / (2 * Math.PI * world.robot.wheelRadiusMeters);
  runtime.advance({ atMicroseconds: 0, leftRpm: rpm, rightRpm: rpm });
  const moved = runtime.advance({ atMicroseconds: 2_000_000, leftRpm: rpm, rightRpm: rpm });
  expect(moved.haltReason).toBeNull();
  const movedCan = moved.bodies?.find((body) => body.id === can.id);
  if (!movedCan) throw new Error('The physics snapshot lost the can');
  expect(movedCan.xMeters).toBeGreaterThan(1.1);

  const camera = new OrthographicCamera(-0.9, 0.9, 0.9, -0.9, 0.01, 15);
  camera.position.set(0.9, 0.9, 5);
  camera.lookAt(0.9, 0.9, 0);
  camera.updateMatrixWorld(true);
  const canvasContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const view = createFieldSpatialScene(world, () => {});
  const pick = (x: number, y: number) => {
    view.scene.updateMatrixWorld(true);
    const point = new Vector3(x, y, 0).project(camera);
    return view.pick(new Vector2(point.x, point.y), camera);
  };
  try {
    view.applySnapshot(initial, undefined, true, null);
    expect(pick(can.xMeters, can.yMeters)).toBe('body:can');

    view.applySnapshot(moved, undefined, true, 'body:can');
    expect(pick(can.xMeters, can.yMeters)).toBe('mark:top');
    expect(pick(movedCan.xMeters, movedCan.yMeters)).toBe('body:can');
    const focus = new Vector3();
    expect(view.readFocus('body:can', focus)).toBeGreaterThanOrEqual(can.heightMeters);
    expect(focus.x).toBeCloseTo(movedCan.xMeters, 12);
    expect(focus.y).toBeCloseTo(movedCan.yMeters, 12);
    expect(runtime.read()).toEqual(moved);
    expect(world).toEqual(savedSource);
  } finally {
    view.dispose();
    canvasContext.mockRestore();
  }
});

it('projects a rotated perspective ray onto the grabbed surface plane and rejects invalid rays', () => {
  const camera = new PerspectiveCamera(38, 800 / 600, 0.01, 200);
  camera.up.set(0, 0, 1);
  camera.position.set(2, -3, 4);
  camera.lookAt(0.8, 0.9, 0.06);
  camera.updateMatrixWorld(true);
  const area = { left: 20, top: 30, width: 800, height: 600 };
  const p = new Vector3(0.83, 0.91, 0.06).project(camera);
  const point = spatialEditPoint(
    camera,
    area,
    area.left + (p.x + 1) * 400,
    area.top + (1 - p.y) * 300,
    0.06,
  )!;
  expect(point.xMeters).toBeCloseTo(0.83, 12);
  expect(point.yMeters).toBeCloseTo(0.91, 12);
  expect(spatialEditPoint(camera, area, NaN, 30, 0)).toBeNull();
  expect(spatialEditPoint(camera, area, 10, 30, 0)).toBeNull();
  expect(spatialEditPoint(camera, { ...area, width: 0 }, 20, 30, 0)).toBeNull();
  camera.position.set(0, -1, 1);
  camera.lookAt(0, 0, 1);
  expect(spatialEditPoint(camera, area, 420, 330, 0)).toBeNull();
});

it('draws one unpickable palette candidate with canonical geometry and disposes it on clear', () => {
  const original = createRoboticsWorldV3Document('practice');
  const point = { xMeters: 0.8, yMeters: 0.9 };
  const wall = createRoboticsWall('new-wall', point),
    ball = createRoboticsBall('new-ball', point);
  const can = createRoboticsBody('can', 'new-can', point),
    box = createRoboticsBody('box', 'new-box', point);
  if (can.kind !== 'can' || box.kind !== 'box') throw new Error('Wrong source fixture');
  const candidates: SpatialPlacement[] = [
    { kind: 'wall', key: 'wall:new-wall', object: wall, valid: true },
    { kind: 'ball', key: 'ball:new-ball', object: ball, valid: true },
    { kind: 'can', key: 'body:new-can', object: can, valid: true },
    { kind: 'box', key: 'body:new-box', object: box, valid: true },
  ];
  const world = {
    ...original,
    field: { ...original.field, obstacles: [], balls: [], bodies: [], floorMarks: [] },
  };
  const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const drawing = createFieldSpatialScene(world, () => {});
  const canonical = createFieldSpatialScene(
    { ...world, field: { ...world.field, obstacles: [wall], balls: [ball], bodies: [can, box] } },
    () => {},
  );
  const camera = new OrthographicCamera(-0.9, 0.9, 0.9, -0.9, 0.01, 15);
  camera.position.set(point.xMeters, point.yMeters, 5);
  camera.lookAt(point.xMeters, point.yMeters, 0);
  camera.updateMatrixWorld(true);
  const canonicalMeshes = (root: import('three').Object3D) => {
    const meshes: import('three').Mesh[] = [];
    root.traverse((item) => {
      if (item instanceof Mesh && !(item.material instanceof ShaderMaterial)) meshes.push(item);
    });
    return meshes;
  };
  const before = JSON.stringify(world);
  try {
    canonical.applySnapshot(undefined, undefined, true, null);
    const basePick = drawing.pick(new Vector2(0, 0), camera);
    for (const placement of candidates) {
      drawing.setPlacementPreview(placement);
      const root = drawing.scene.getObjectByName('field-placement-preview')!;
      const authored = canonical.scene.getObjectByName(placement.key)!;
      const meshes = canonicalMeshes(root);
      expect(meshes.map((mesh) => mesh.geometry.toJSON())).toEqual(
        canonicalMeshes(authored)
          .map((mesh) => mesh.geometry.toJSON())
          .map((json, index) => ({
            ...json,
            uuid: meshes[index]!.geometry.uuid,
          })),
      );
      expect(root.position.toArray()).toEqual(authored.position.toArray());
      expect(drawing.pick(new Vector2(0, 0), camera)).toBe(basePick);
      expect(drawing.readPlacementPreview()).toMatchObject({
        kind: placement.kind,
        key: placement.key,
        valid: true,
        meshCount: meshes.length,
      });
      expect(drawing.readPlacementPreview()?.xMeters).toBeCloseTo(point.xMeters, 12);
      expect(drawing.readPlacementPreview()?.yMeters).toBeCloseTo(point.yMeters, 12);
      const geometry = meshes[0]!.geometry;
      const released = vi.fn();
      geometry.addEventListener('dispose', released);
      const moved = {
        ...placement,
        object: { ...placement.object, xMeters: 1.1 },
        valid: false,
      } as SpatialPlacement;
      drawing.setPlacementPreview(moved);
      expect(drawing.scene.getObjectByName('field-placement-preview')).toBe(root);
      expect(drawing.readPlacementPreview()).toMatchObject({ valid: false });
      expect(drawing.readPlacementPreview()?.xMeters).toBeCloseTo(1.1, 12);
      expect(released).not.toHaveBeenCalled();
      drawing.setPlacementPreview(null);
      expect(drawing.scene.getObjectByName('field-placement-preview')).toBeUndefined();
      expect(drawing.readPlacementPreview()).toBeNull();
      expect(released).toHaveBeenCalledTimes(1);
    }
    expect(JSON.stringify(world)).toBe(before);
  } finally {
    canonical.dispose();
    drawing.dispose();
    spy.mockRestore();
  }
});

it('previews all scene roots from exact base transforms without rebuilding or mutating source/state', () => {
  const world = createRoboticsWorldV3Document('practice');
  const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const before = JSON.stringify(world);
  const scene = createFieldSpatialScene(world, () => undefined);
  try {
    scene.applySnapshot(undefined, undefined, true, 'robot');
    const target = new Vector3();
    scene.readFocus('robot', target);
    const base = target.clone();
    const ids: string[] = [];
    scene.scene.traverse((item) => ids.push(item.uuid));
    for (const x of [0.1, 0.2, -0.3]) {
      scene.applySnapshot(undefined, undefined, true, 'robot', {
        key: 'robot',
        dxMeters: x,
        dyMeters: 0.12,
      });
      scene.readFocus('robot', target);
      expect(target.x - base.x).toBeCloseTo(x, 12);
      expect(target.y - base.y).toBeCloseTo(0.12, 12);
    }
    scene.applySnapshot(undefined, undefined, true, 'robot', null);
    scene.readFocus('robot', target);
    expect(target.toArray()).toEqual(base.toArray());
    const after: string[] = [];
    scene.scene.traverse((item) => after.push(item.uuid));
    expect(after).toEqual(ids);
    expect(JSON.stringify(world)).toBe(before);
  } finally {
    scene.dispose();
    spy.mockRestore();
  }
});

it('owns an object pointer before real OrbitControls, commits once, cancels stale/invalid edits and hands two touches to camera', () => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const captured = new Set<number>();
  canvas.setPointerCapture = (id) => {
    captured.add(id);
  };
  canvas.hasPointerCapture = (id) => captured.has(id);
  canvas.releasePointerCapture = (id) => {
    captured.delete(id);
  };
  const camera = new PerspectiveCamera(38, 800 / 600, 0.01, 200);
  camera.up.set(0, 0, 1);
  camera.position.set(2, -3, 4);
  let controls = new OrbitControls(camera, canvas);
  controls.target.set(0.8, 0.9, 0);
  controls.update();
  const world = createRoboticsWorldV3Document('practice');
  let source: unknown = world;
  let enabled = true;
  let hit = true;
  let valid = true;
  let start = { xMeters: 0, yMeters: 0 };
  const commits = vi.fn();
  const cancel = vi.fn();
  const preview = vi.fn();
  const select = vi.fn();
  const edit = {
    begin: (_key: string, point: typeof start) => {
      start = point;
      return true;
    },
    preview: (point: typeof start) => {
      const result = moveFieldObject({ world, key: 'robot', start }, point, true);
      return { key: 'robot' as const, dxMeters: result.dxMeters, dyMeters: result.dyMeters };
    },
    finish: (point: typeof start) =>
      commits(moveFieldObject({ world, key: 'robot', start }, point, true).world),
    cancel,
  };
  const gestures = bindSpatialFieldGestures(canvas, {
    current: () => ({ world: source, enabled, edit, controls }),
    hit: () => (hit ? { key: 'robot', point: new Vector3(0, 0, 0.04) } : undefined),
    project: (x, y) => (valid ? { xMeters: x / 100, yMeters: y / 100 } : null),
    preview,
    select,
    resetControls: () => {
      const target = controls.target.clone();
      controls.dispose();
      controls = new OrbitControls(camera, canvas);
      controls.target.copy(target);
      controls.update();
    },
  });
  function pointer(type: string, x: number, y: number, id = 1, touch = false) {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
    });
    Object.defineProperties(event, {
      pointerId: { value: id },
      pointerType: { value: touch ? 'touch' : 'mouse' },
      isPrimary: { value: id === 1 },
    });
    canvas.dispatchEvent(event);
  }
  try {
    const before = camera.position.toArray();
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 127, 113);
    expect(commits).not.toHaveBeenCalled();
    expect(preview).toHaveBeenLastCalledWith(
      expect.objectContaining({ dxMeters: 0.3, dyMeters: 0.1 }),
    );
    expect(camera.position.toArray()).toEqual(before);
    pointer('pointerup', 127, 113);
    expect(commits).toHaveBeenCalledTimes(1);
    expect(controls.enableRotate).toBe(true);
    expect(select).not.toHaveBeenCalled();
    pointer('pointerdown', 100, 100);
    pointer('pointerup', 101, 101);
    expect(select).toHaveBeenCalledWith('robot');
    for (const reason of ['invalid', 'stale', 'disabled', 'cancel', 'lost', 'blur', 'escape']) {
      valid = true;
      source = world;
      enabled = true;
      pointer('pointerdown', 100, 100);
      pointer('pointermove', 125, 110);
      if (reason === 'invalid') valid = false;
      if (reason === 'stale') {
        source = {};
        gestures.sync();
      }
      if (reason === 'disabled') {
        enabled = false;
        gestures.sync();
      }
      if (reason === 'cancel') pointer('pointercancel', 125, 110);
      if (reason === 'lost') pointer('lostpointercapture', 125, 110);
      if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      if (reason === 'escape')
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      pointer('pointerup', 125, 110);
      expect(commits).toHaveBeenCalledTimes(1);
    }
    valid = true;
    source = world;
    enabled = true;
    pointer('pointerdown', 100, 100, 1, true);
    pointer('pointermove', 120, 100, 1, true);
    pointer('pointerdown', 180, 100, 2, true);
    expect(gestures.owns()).toBe(false);
    expect(controls.enablePan && controls.enableZoom && controls.enableRotate).toBe(true);
    const touchCamera = camera.position.toArray();
    pointer('pointermove', 240, 130, 2, true);
    expect(camera.position.toArray()).not.toEqual(touchCamera);
    pointer('pointerup', 120, 100, 1, true);
    pointer('pointerup', 240, 130, 2, true);
    expect(commits).toHaveBeenCalledTimes(1);
    hit = false;
    const emptyCamera = camera.position.toArray();
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 180, 120);
    pointer('pointerup', 180, 120);
    expect(camera.position.toArray()).not.toEqual(emptyCamera);
    expect(commits).toHaveBeenCalledTimes(1);
  } finally {
    gestures.dispose();
    controls.dispose();
    canvas.remove();
  }
});

it('keeps an elevated ball surface under its grabbed ray without moving its anchor to the hit point', () => {
  const base = createRoboticsWorldV3Document('practice');
  const world = {
    ...base,
    initialPose: { xMeters: 0.25, yMeters: 0.25, headingRadians: 0 },
    field: { ...base.field, balls: [createRoboticsBall('grab', { xMeters: 0.8, yMeters: 0.9 })] },
  };
  const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const scene = createFieldSpatialScene(world, () => undefined);
  try {
    scene.applySnapshot(undefined, undefined, true, null);
    scene.scene.updateMatrixWorld(true);
    const camera = new PerspectiveCamera(38, 800 / 600, 0.01, 200);
    camera.up.set(0, 0, 1);
    camera.position.set(1, -0.5, 1.2);
    camera.lookAt(0.8, 0.9, 0.03);
    camera.updateMatrixWorld(true);
    const hit = scene.pickHit(new Vector2(0.015, 0.015), camera)!;
    expect(hit.key).toBe('ball:grab');
    expect(hit.point.z).toBeGreaterThan(0.03);
    const area = { left: 0, top: 0, width: 800, height: 600 };
    const x = (0.015 + 1) * 400,
      y = (1 - 0.015) * 300;
    const start = spatialEditPoint(camera, area, x, y, hit.point.z)!;
    const point = spatialEditPoint(camera, area, x + 47, y - 16, hit.point.z)!;
    const draft = moveFieldObject({ world, key: hit.key, start }, point, false);
    const moved = draft.world.field.balls[0]!;
    expect(moved.xMeters - 0.8).toBeCloseTo(point.xMeters - start.xMeters, 4);
    expect(moved.yMeters - 0.9).toBeCloseTo(point.yMeters - start.yMeters, 4);
    const projected = hit.point
      .clone()
      .add(new Vector3(draft.dxMeters, draft.dyMeters, 0))
      .project(camera);
    // Existing document movement rounds metres to 4 decimals, independently of camera.
    expect(Math.abs((projected.x + 1) * 400 - (x + 47))).toBeLessThan(0.1);
    expect(Math.abs((1 - projected.y) * 300 - (y - 16))).toBeLessThan(0.1);
    const snapped = moveFieldObject({ world, key: hit.key, start }, point, true).world.field
      .balls[0]!;
    expect(snapped.xMeters / world.field.gridMeters).toBeCloseTo(
      Math.round(snapped.xMeters / world.field.gridMeters),
      10,
    );
    expect(world.field.balls[0]!.xMeters).toBe(0.8);
  } finally {
    scene.dispose();
    spy.mockRestore();
  }
});

it('cancels a captured real viewport edit synchronously when its renderer fails, before fallback or late release', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const queue = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  const area = {
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    right: 800,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };
  const captured = new Set<number>();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queue.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => queue.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) {
        this.callback(
          [{ target: element, contentRect: area } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(area);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const world = createRoboticsWorldV3Document('practice');
  const before = JSON.stringify(world);
  let controls: FieldViewportControls | null = null;
  const finish = vi.fn();
  const cancel = vi.fn();
  const begin = vi.fn(() => true);
  const preview = vi.fn(() => ({ key: 'robot' as const, dxMeters: 0.1, dyMeters: 0 }));
  rendererFailure.render.mockReset();
  rendererFailure.dispose.mockReset();
  async function flush() {
    await act(async () => {
      const callbacks = [...queue.values()];
      queue.clear();
      for (const callback of callbacks) callback(0);
    });
  }
  try {
    await act(async () =>
      root.render(
        createElement(RobotFieldSpatialView, {
          world,
          view: 'orbit',
          selection: 'robot',
          active: true,
          edit: { begin, preview, finish, cancel },
          onControls: (value) => {
            controls = value;
          },
        }),
      ),
    );
    const canvas = container.querySelector('canvas')!;
    canvas.setPointerCapture = (id) => {
      captured.add(id);
    };
    canvas.hasPointerCapture = (id) => captured.has(id);
    canvas.releasePointerCapture = vi.fn((id) => {
      captured.delete(id);
    });
    Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    await act(async () => (controls as FieldViewportControls | null)?.focus('robot'));
    await flush();
    async function pointer(type: string, x: number, y: number) {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
      Object.defineProperties(event, {
        pointerId: { value: 7 },
        pointerType: { value: 'mouse' },
        isPrimary: { value: true },
      });
      await act(async () => {
        canvas.dispatchEvent(event);
      });
    }
    await pointer('pointerdown', 400, 300);
    await pointer('pointermove', 435, 290);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(captured.has(7)).toBe(true);
    expect(canvas.classList.contains('robotics-object-dragging')).toBe(true);
    rendererFailure.render.mockImplementationOnce(() => {
      throw new Error('actual render failure');
    });
    await flush();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(captured.size).toBe(0);
    expect(canvas.classList.contains('robotics-object-dragging')).toBe(false);
    expect(canvas.dataset.editPreview).toBe('null');
    expect(container.querySelector('.robotics-spatial-notice')?.textContent).toContain(
      'недоступен',
    );
    await pointer('pointerup', 435, 290);
    await pointer('pointerdown', 400, 300);
    await pointer('pointermove', 435, 290);
    await pointer('pointerup', 435, 290);
    expect(finish).not.toHaveBeenCalled();
    expect(begin).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(world)).toBe(before);
  } finally {
    await act(async () => root.unmount());
    expect(rendererFailure.dispose).toHaveBeenCalledTimes(1);
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it('projects the one Three Top camera exactly onto SVG metres at all object heights, sizes and DPRs', () => {
  const top = new OrthographicCamera();
  for (const width of [1440, 320])
    for (const dpr of [1, 2])
      for (const ppm of [50, 200, 1250]) {
        const viewport = { width, height: 637 };
        const reference = { xMeters: 0.73, yMeters: 1.27, pixelsPerMeter: ppm };
        configureTopCamera(top, reference, viewport);
        for (const [xMeters, yMeters, z] of [
          [0, 0, 0],
          [0.82, 1.13, 0.115],
          [0.55, 0.7, 0.033],
          [5, 5, 0.3],
        ]) {
          const p = new Vector3(xMeters, yMeters, z).project(top);
          const expected = fieldWorldToScreen(reference, viewport, {
            xMeters: xMeters!,
            yMeters: yMeters!,
          });
          expect(((p.x + 1) * width) / 2).toBeCloseTo(expected.x, 9);
          expect(((1 - p.y) * viewport.height) / 2).toBeCloseTo(expected.y, 9);
          expect((dpr * (p.x + 1) * width) / 2 / dpr).toBeCloseTo(expected.x, 9);
        }
        const ruler = readSideMetricScale(top, width, viewport.height)!;
        expect(ruler.cssPixels).toBeCloseTo(ruler.meters * ppm, 10);
      }
  expect(() =>
    configureTopCamera(
      top,
      { xMeters: 0, yMeters: NaN, pixelsPerMeter: 1 },
      { width: 1, height: 1 },
    ),
  ).toThrow();
});

it('retains one scene and canvas through real Top/orbit/Side lifecycle, with actual camera zoom and no inactive render', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const callbacks = new Map<number, FrameRequestCallback>();
  let serial = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  const area = { width: 800, height: 600 };
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) {
        this.callback(
          [{ target: element, contentRect: area } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const holder = document.createElement('div');
  document.body.append(holder);
  const root = createRoot(holder);
  const world = createRoboticsWorldV3Document('practice');
  const initial = JSON.stringify(world);
  const reference = { camera: { xMeters: 0.5, yMeters: 0.7, pixelsPerMeter: 260 }, viewport: area };
  let commands: FieldViewportControls | null = null;
  const ready = vi.fn();
  rendererFailure.render.mockReset();
  rendererFailure.dispose.mockReset();
  const mount = async (view: 'top' | 'orbit' | 'side', active = true) => {
    await act(async () =>
      root.render(
        createElement(RobotFieldSpatialView, {
          world,
          view,
          active,
          topProjection: reference,
          onReady: ready,
          onControls: (value) => {
            commands = value;
          },
        }),
      ),
    );
    await act(async () => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(0);
    });
  };
  try {
    await mount('top');
    const canvas = holder.querySelector('canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 30, 800, 600));
    const project = (x: number, y: number) =>
      (commands as FieldViewportControls | null)?.projectGround(x, y);
    const scene = rendererFailure.render.mock.calls.at(-1)![0];
    const camera = rendererFailure.render.mock.calls.at(-1)![1] as OrthographicCamera;
    expect(camera.position.x).toBe(0.5);
    expect(camera.position.y).toBe(0.7);
    expect(holder.querySelector('[data-testid="robotics-top-scale"]')).not.toBeNull();
    expect(ready).toHaveBeenLastCalledWith(true);
    for (const mode of ['orbit', 'side', 'top'] as const) {
      await mount(mode);
      expect(holder.querySelector('canvas')).toBe(canvas);
      expect(rendererFailure.render.mock.calls.at(-1)![0]).toBe(scene);
      expect(rendererFailure.dispose).not.toHaveBeenCalled();
      if (mode === 'orbit') {
        const actual = rendererFailure.render.mock.calls.at(-1)![1] as PerspectiveCamera;
        actual.updateMatrixWorld(true);
        const pixel = new Vector3(0.8, 0.9, 0).project(actual);
        const ground = project(20 + (pixel.x + 1) * 400, 30 + (1 - pixel.y) * 300);
        expect(ground?.xMeters).toBeCloseTo(0.8, 12);
        expect(ground?.yMeters).toBeCloseTo(0.9, 12);
        expect(project(19, 330)).toBeNull();
      } else {
        expect(project(420, 330)).toBeNull();
      }
    }
    await mount('orbit');
    await act(async () =>
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })),
    );
    expect(project(420, 330)).toBeNull();
    expect(canvas.dataset.placementPreview).toBe('null');
    await act(async () => canvas.dispatchEvent(new Event('webglcontextrestored')));
    await mount('orbit', false);
    expect(project(420, 330)).toBeNull();
    await mount('side');
    const side = rendererFailure.render.mock.calls.at(-1)![1] as OrthographicCamera;
    expect(side.zoom).toBe(2);
    await act(async () => (commands as FieldViewportControls | null)?.zoom(1.25));
    expect(side.zoom).toBe(2.5);
    await act(async () => (commands as FieldViewportControls | null)?.fit());
    expect(side.zoom).toBe(1);
    await mount('side', false);
    const count = rendererFailure.render.mock.calls.length;
    await mount('side', false);
    expect(rendererFailure.render).toHaveBeenCalledTimes(count);
    expect(holder.querySelector('[data-testid="robotics-side-scale"]')).toBeNull();
    expect(JSON.stringify(world)).toBe(initial);
  } finally {
    await act(async () => root.unmount());
    holder.remove();
    expect(rendererFailure.dispose).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it('uses bounded solid ball/can dimensions, a visible rear caster and a grid without adding pickable rim objects', () => {
  const original = createRoboticsWorldV3Document('practice');
  const can = createRoboticsBody('can', 'solid-can', { xMeters: 0.8, yMeters: 0.9 });
  if (can.kind !== 'can') throw new Error('Expected can fixture');
  const ball = createRoboticsBall('solid-ball', { xMeters: 0.5, yMeters: 1.2 });
  const world = { ...original, field: { ...original.field, bodies: [can], balls: [ball] } };
  const image = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const drawing = createFieldSpatialScene(world, () => {});
  try {
    drawing.applySnapshot(undefined, undefined, true, null);
    drawing.scene.updateMatrixWorld(true);
    const bounds = (key: string) => {
      const box = new Box3();
      drawing.scene.getObjectByName(key)!.traverse((part) => {
        if (part instanceof Mesh && part.material instanceof MeshStandardMaterial)
          box.union(new Box3().setFromObject(part));
      });
      return box;
    };
    const canBox = bounds('body:' + can.id);
    expect(canBox.min.x).toBeGreaterThanOrEqual(can.xMeters - can.radiusMeters - 1e-8);
    expect(canBox.max.x).toBeLessThanOrEqual(can.xMeters + can.radiusMeters + 1e-8);
    expect(canBox.max.z).toBeLessThanOrEqual(can.heightMeters + 1e-8);
    const ballBox = bounds('ball:' + ball.id);
    expect(ballBox.max.x - ballBox.min.x).toBeLessThanOrEqual(ball.radiusMeters * 2 + 1e-8);
    const caster = drawing.scene.getObjectByName('visual-rear-caster')!;
    expect(caster).toBeDefined();
    expect(caster.position.x).toBeLessThan(0);
    const grid = drawing.scene.getObjectByName('metric-grid')!;
    expect(grid.visible).toBe(true);
    drawing.applySnapshot(undefined, undefined, false, null);
    expect(grid.visible).toBe(false);
    const camera = new OrthographicCamera();
    configureTopCamera(
      camera,
      { xMeters: -0.006, yMeters: 1, pixelsPerMeter: 200 },
      { width: 800, height: 600 },
    );
    expect(drawing.pick(new Vector2(0, 0), camera)).toBeUndefined();
  } finally {
    drawing.dispose();
    image.mockRestore();
  }
});

it('joins the actual rear caster cup to the deck across supported chassis and wheel sizes', () => {
  const source = createRoboticsWorldV3Document('practice');
  const image = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  try {
    for (const bodyLengthMeters of [0.05, 0.2, 0.5])
      for (const bodyWidthMeters of [0.05, 0.14, 0.5])
        for (const wheelRadiusMeters of [0.01, 0.0325, 0.1]) {
          const world = {
            ...source,
            initialPose: { xMeters: 0.5, yMeters: 0.5, headingRadians: 0 },
            robot: { ...source.robot, bodyLengthMeters, bodyWidthMeters, wheelRadiusMeters },
          };
          const before = JSON.stringify(world);
          const drawing = createFieldSpatialScene(world, () => {});
          try {
            drawing.applySnapshot(undefined, undefined, true, null);
            drawing.scene.updateMatrixWorld(true);
            const part = (name: string) => {
              const mesh = drawing.scene.getObjectByName(name);
              if (!(mesh instanceof Mesh)) throw new Error('Missing actual visual mesh: ' + name);
              return new Box3().setFromObject(mesh);
            };
            const ball = part('visual-rear-caster');
            const cup = part('visual-caster-cup');
            const bracket = part('visual-caster-bracket');
            const deck = part('visual-chassis-deck');
            expect(ball.min.z).toBeCloseTo(0, 8);
            // The cup is centred on the sphere axis and intersects its upper half.
            expect(cup.min.z).toBeLessThan(ball.max.z);
            expect(cup.max.z).toBeGreaterThan((ball.min.z + ball.max.z) / 2);
            expect(bracket.intersectsBox(cup)).toBe(true);
            expect(bracket.intersectsBox(deck)).toBe(true);
            expect(bracket.min.z).toBeGreaterThan(0);
            expect(bracket.max.z - bracket.min.z).toBeGreaterThan(0);
            for (const piece of [ball, cup, bracket]) {
              expect(piece.min.x).toBeGreaterThanOrEqual(deck.min.x - 1e-8);
              expect(piece.max.x).toBeLessThanOrEqual(deck.max.x + 1e-8);
              expect(piece.min.y).toBeGreaterThanOrEqual(deck.min.y - 1e-8);
              expect(piece.max.y).toBeLessThanOrEqual(deck.max.y + 1e-8);
            }
            expect(JSON.stringify(world)).toBe(before);
          } finally {
            drawing.dispose();
          }
        }
  } finally {
    image.mockRestore();
  }
});

it('isolates the exact shared robot construction in metres without field content or a runtime pose', () => {
  const base = createRoboticsWorldV3Document('arena');
  const image = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  try {
    for (const size of [0.05, 0.2, 0.5]) {
      const world = {
        ...base,
        robot: {
          ...base.robot,
          bodyLengthMeters: size,
          bodyWidthMeters: size,
          sensorForwardMeters: 0.3,
          sensorLateralMeters: -0.3,
          sensorHeadingRadians: 0.8,
        },
      };
      const before = JSON.stringify(world);
      const field = createFieldSpatialScene(world, () => {}),
        assembly = createRobotSpatialScene(world);
      try {
        expect(assembly.robotGeometry).toEqual(field.robotGeometry);
        expect(assembly.robotGeometry).toEqual(world.robot);
        const robot = assembly.scene.getObjectByName('robot')!;
        expect(robot.position.toArray()).toEqual([0, 0, 0]);
        expect(robot.quaternion.toArray()).toEqual([0, 0, 0, 1]);
        expect(readRobotVisualGeometry(robot as import('three').Group)).toEqual(world.robot);
        expect(assembly.scene.getObjectByName('metric-grid')).toBeUndefined();
        expect(assembly.scene.children.filter((object) => !('isLight' in object))).toEqual([robot]);
        expect(robot.getObjectByName('visual-caster-bracket')).toBeDefined();
        const centre = new Vector3(),
          diameter = assembly.readFocus('robot', centre);
        const bounds = new Box3().setFromObject(robot);
        expect(diameter).toBeCloseTo(bounds.min.distanceTo(bounds.max), 12);
        for (const [width, height] of [
          [900, 650],
          [320, 250],
          [320, 650],
        ])
          for (const view of ['top', 'front', 'side', 'orbit'] as const) {
            const camera = view === 'orbit' ? new PerspectiveCamera(38) : new OrthographicCamera();
            frameRobotCamera(camera, view, centre, diameter, width!, height!);
            for (const x of [bounds.min.x, bounds.max.x])
              for (const y of [bounds.min.y, bounds.max.y])
                for (const z of [bounds.min.z, bounds.max.z]) {
                  const projected = new Vector3(x, y, z).project(camera);
                  expect(Math.abs(projected.x)).toBeLessThan(1);
                  expect(Math.abs(projected.y)).toBeLessThan(1);
                  expect(Math.abs(projected.z)).toBeLessThan(1);
                }
            if (view === 'front') {
              const direction = camera.position.clone().sub(centre).normalize();
              expect(direction.toArray()).toEqual([1, 0, 0]);
              expect(
                new Vector3(centre.x, centre.y + 0.01, centre.z).project(camera).x,
              ).toBeGreaterThan(0);
            }
          }
        expect(JSON.stringify(world)).toBe(before);
      } finally {
        field.dispose();
        assembly.dispose();
      }
    }
  } finally {
    image.mockRestore();
  }
});

it('keeps the robot scene/camera across modes, suspends hidden drawing and restores real context without a second renderer', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const callbacks = new Map<number, FrameRequestCallback>();
  let serial = 0;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    callbacks.set(++serial, fn);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  let resize!: (width: number, height: number) => void;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) {
        resize = (width, height) =>
          this.callback(
            [{ target: element, contentRect: { width, height } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
        resize(800, 600);
      }
      disconnect() {}
    },
  );
  const holder = document.createElement('div');
  document.body.append(holder);
  const root = createRoot(holder);
  const world = createRoboticsWorldV3Document('arena');
  const before = JSON.stringify(world);
  const ready = vi.fn();
  rendererFailure.render.mockReset();
  rendererFailure.dispose.mockReset();
  rendererFailure.construct.mockReset();
  const flush = async () => {
    await act(async () => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const fn of pending) fn(0);
    });
  };
  const mount = async (view: 'top' | 'front' | 'side' | 'orbit', active = true) => {
    await act(async () =>
      root.render(
        createElement(RobotFieldSpatialView, {
          subject: 'robot',
          world,
          view,
          active,
          onReady: ready,
        }),
      ),
    );
    await flush();
  };
  try {
    await mount('orbit', false);
    expect(rendererFailure.construct).not.toHaveBeenCalled();
    expect(rendererFailure.render).not.toHaveBeenCalled();
    await mount('orbit');
    expect(rendererFailure.construct).toHaveBeenCalledTimes(1);
    const canvas = holder.querySelector('canvas')!;
    const scene = rendererFailure.render.mock.calls.at(-1)![0] as import('three').Scene;
    await act(async () => resize(320, 650));
    await flush();
    const portraitCamera = rendererFailure.render.mock.calls.at(-1)![1] as PerspectiveCamera;
    const box = new Box3().setFromObject(scene.getObjectByName('robot')!);
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) {
          const corner = new Vector3(x, y, z).project(portraitCamera);
          expect(Math.abs(corner.x)).toBeLessThan(1);
          expect(Math.abs(corner.y)).toBeLessThan(1);
        }
    await act(async () => resize(800, 600));
    await flush();
    for (const mode of ['front', 'top', 'side', 'orbit'] as const) {
      await mount(mode);
      expect(holder.querySelector('canvas')).toBe(canvas);
      expect(rendererFailure.render.mock.calls.at(-1)![0]).toBe(scene);
      expect(
        holder
          .querySelector('[data-testid="robotics-assembly-spatial"]')
          ?.getAttribute('data-coordinate-frame'),
      ).toBe('construction-local');
    }
    await act(async () =>
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
    );
    await flush();
    const orbit = canvas.dataset.camera;
    const captured = new Set<number>();
    canvas.setPointerCapture = (id) => {
      captured.add(id);
    };
    canvas.hasPointerCapture = (id) => captured.has(id);
    canvas.releasePointerCapture = vi.fn((id) => {
      captured.delete(id);
    });
    const down = new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      clientX: 400,
      clientY: 300,
    });
    Object.defineProperties(down, {
      pointerId: { value: 9 },
      pointerType: { value: 'mouse' },
      isPrimary: { value: true },
    });
    await act(async () => canvas.dispatchEvent(down));
    expect(captured.has(9)).toBe(true);
    await mount('orbit', false);
    expect(captured.size).toBe(0);
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(9);
    const rendered = rendererFailure.render.mock.calls.length;
    await mount('orbit', false);
    await flush();
    expect(rendererFailure.render).toHaveBeenCalledTimes(rendered);
    expect(callbacks.size).toBe(0);
    await mount('orbit');
    const cameraValues = JSON.parse(canvas.dataset.camera!) as number[][];
    const savedCamera = JSON.parse(orbit!) as number[][];
    cameraValues.forEach((row, i) =>
      row.forEach((value, j) => expect(value).toBeCloseTo(savedCamera[i]![j]!, 12)),
    );
    await act(async () =>
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })),
    );
    expect(ready).toHaveBeenLastCalledWith(false);
    await flush();
    const lostCount = rendererFailure.render.mock.calls.length;
    await mount('orbit');
    expect(rendererFailure.render).toHaveBeenCalledTimes(lostCount);
    await act(async () => canvas.dispatchEvent(new Event('webglcontextrestored')));
    await flush();
    expect(ready).toHaveBeenLastCalledWith(true);
    expect(rendererFailure.render.mock.calls.at(-1)![0]).toBe(scene);
    const restored = JSON.parse(canvas.dataset.camera!) as number[][];
    restored.forEach((row, i) =>
      row.forEach((value, j) => expect(value).toBeCloseTo(savedCamera[i]![j]!, 12)),
    );
    expect(rendererFailure.dispose).not.toHaveBeenCalled();
    expect(rendererFailure.construct).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(world)).toBe(before);
  } finally {
    await act(async () => root.unmount());
    holder.remove();
    expect(rendererFailure.dispose).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it('bounds every Robot dolly path inside native clip planes and recomputes limits after resize or a smaller model', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const callbacks = new Map<number, FrameRequestCallback>();
  let serial = 0;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    callbacks.set(++serial, fn);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  let resize!: (width: number, height: number) => void;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) {
        resize = (width, height) =>
          this.callback(
            [{ target: element, contentRect: { width, height } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
        resize(800, 600);
      }
      disconnect() {}
    },
  );
  const holder = document.createElement('div');
  document.body.append(holder);
  const root = createRoot(holder);
  const original = createRoboticsWorldV3Document('arena'),
    before = JSON.stringify(original);
  let world = original;
  let commands: FieldViewportControls | null = null;
  const control = () => {
    const value = commands as FieldViewportControls | null;
    if (!value) throw new Error('Missing actual viewport controller');
    return value;
  };
  rendererFailure.render.mockReset();
  rendererFailure.dispose.mockReset();
  const flush = async () => {
    await act(async () => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((fn) => fn(0));
    });
  };
  const mount = async () => {
    await act(async () =>
      root.render(
        createElement(RobotFieldSpatialView, {
          world,
          subject: 'robot',
          view: 'orbit',
          active: true,
          onControls: (value) => {
            commands = value;
          },
        }),
      ),
    );
    await flush();
  };
  try {
    await mount();
    const canvas = holder.querySelector('canvas')!;
    Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    const captured = new Set<number>();
    canvas.setPointerCapture = (id) => {
      captured.add(id);
    };
    canvas.hasPointerCapture = (id) => captured.has(id);
    canvas.releasePointerCapture = (id) => {
      captured.delete(id);
    };
    const measure = (whole: boolean) => {
      const [scene, camera] = rendererFailure.render.mock.calls.at(-1)! as [
        import('three').Scene,
        PerspectiveCamera,
      ];
      camera.updateMatrixWorld(true);
      const bounds = new Box3().setFromObject(scene.getObjectByName('robot')!);
      const centre = bounds.getCenter(new Vector3()),
        radius = bounds.min.distanceTo(bounds.max) / 2;
      const distance = camera.position.distanceTo(centre);
      expect(distance - radius).toBeGreaterThan(camera.near);
      expect(distance + radius).toBeLessThan(camera.far);
      for (const x of [bounds.min.x, bounds.max.x])
        for (const y of [bounds.min.y, bounds.max.y])
          for (const z of [bounds.min.z, bounds.max.z]) {
            const corner = new Vector3(x, y, z).project(camera);
            expect(Math.abs(corner.z)).toBeLessThan(1);
            if (whole) {
              expect(Math.abs(corner.x)).toBeLessThan(1);
              expect(Math.abs(corner.y)).toBeLessThan(1);
            }
          }
      return distance;
    };
    const zoom = async (factor: number, count = 1) => {
      await act(async () => {
        for (let i = 0; i < count; i++) control().zoom(factor);
      });
      await flush();
    };
    const fit = async () => {
      await act(async () => control().fit());
      await flush();
      return measure(true);
    };
    const extremes = async () => {
      const fitted = await fit();
      await zoom(1 / 1.25, 80);
      const maximum = measure(true);
      expect(maximum).toBeCloseTo(fitted * 4, 10);
      await fit();
      await act(async () => {
        for (let i = 0; i < 80; i++)
          canvas.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }));
      });
      await flush();
      expect(measure(true)).toBeCloseTo(maximum, 10);
      await fit();
      await act(async () => {
        for (let i = 0; i < 20; i++)
          canvas.dispatchEvent(
            new WheelEvent('wheel', { deltaY: 1000, bubbles: true, cancelable: true }),
          );
      });
      await flush();
      expect(measure(true)).toBeCloseTo(maximum, 10);
      await zoom(1.25, 100);
      const minimum = measure(false);
      await fit();
      await act(async () => {
        for (let i = 0; i < 20; i++)
          canvas.dispatchEvent(
            new WheelEvent('wheel', { deltaY: -1000, bubbles: true, cancelable: true }),
          );
      });
      await flush();
      expect(measure(false)).toBeCloseTo(minimum, 10);
      await fit();
      return { fitted, maximum };
    };
    await extremes();
    const touch = async (type: string, id: number, x: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: 300,
      });
      Object.defineProperties(event, {
        pointerId: { value: id },
        pointerType: { value: 'touch' },
        isPrimary: { value: id === 31 },
      });
      await act(async () => canvas.dispatchEvent(event));
    };
    const fitted = await fit();
    await touch('pointerdown', 31, 100);
    await touch('pointerdown', 32, 700);
    await touch('pointermove', 31, 395);
    await touch('pointermove', 32, 405);
    await flush();
    const pinch = JSON.parse(canvas.dataset.camera!) as number[][];
    expect(
      new Vector3(...(pinch[0] as [number, number, number])).distanceTo(
        new Vector3(...(pinch[2] as [number, number, number])),
      ),
    ).toBeCloseTo(fitted * 4, 10);
    await touch('pointerup', 31, 395);
    await touch('pointerup', 32, 405);
    await fit();
    await zoom(1 / 1.25, 80);
    await act(async () => resize(320, 650));
    await flush();
    measure(true);
    await extremes();
    await zoom(1 / 1.25, 80);
    world = {
      ...original,
      robot: {
        ...original.robot,
        bodyLengthMeters: 0.05,
        bodyWidthMeters: 0.05,
        wheelRadiusMeters: 0.01,
        wheelTrackMeters: 0.05,
        wheelWidthMeters: 0.005,
        sensorForwardMeters: 0.03,
      },
    };
    await mount();
    measure(true);
    const small = await extremes();
    await zoom(1 / 1.25, 80);
    await act(async () => resize(800, 600));
    await flush();
    measure(true);
    const wide = await extremes();
    expect(wide.maximum).toBeLessThan(small.maximum);
    expect(JSON.stringify(original)).toBe(before);
  } finally {
    await act(async () => root.unmount());
    holder.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
