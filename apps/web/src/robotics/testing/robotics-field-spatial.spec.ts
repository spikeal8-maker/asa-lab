// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { OrthographicCamera, Vector2, Vector3 } from 'three';
import { createRoboticsRuntime } from '@asa-lab/robotics/runtime';
import {
  createRoboticsBody,
  createRoboticsFloorMark,
  createRoboticsWorldV3Document,
} from '@asa-lab/robotics/world-document';
import { createFieldSpatialScene } from '../field-spatial-scene';

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
