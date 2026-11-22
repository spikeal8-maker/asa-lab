// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { OrthographicCamera, PerspectiveCamera, Vector2, Vector3 } from 'three';
import { createRoboticsRuntime } from '@asa-lab/robotics/runtime';
import {
  createRoboticsBody,
  createRoboticsFloorMark,
  createRoboticsWorldV3Document,
} from '@asa-lab/robotics/world-document';
import { createFieldSpatialScene } from '../field-spatial-scene';
import { readSideMetricScale } from '../RobotFieldSpatialView';

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
