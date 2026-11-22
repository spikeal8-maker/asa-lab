// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Vector2, Vector3 } from 'three';
import { createRoboticsRuntime } from '@asa-lab/robotics/runtime';
import {
  createRoboticsBall,
  createRoboticsBody,
  createRoboticsFloorMark,
  createRoboticsWorldV3Document,
} from '@asa-lab/robotics/world-document';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { moveFieldObject } from '../RobotFieldEditor';
import { createFieldSpatialScene } from '../field-spatial-scene';
import {
  bindSpatialFieldGestures,
  spatialEditPoint,
  readSideMetricScale,
} from '../RobotFieldSpatialView';

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
