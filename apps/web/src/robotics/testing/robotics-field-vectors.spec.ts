import { describe, expect, it } from 'vitest';
import {
  createRoboticsWorldDocument,
  createRoboticsWorldV3Document,
  type RoboticsFieldDecoration,
  type RoboticsWorldDocument,
} from '@asa-lab/robotics/world-document';
import {
  duplicateRoboticsObject,
  removeRoboticsObject,
  translateRoboticsObject,
} from '@asa-lab/robotics/world-authoring';

import { parseRoboticsWorldDocument } from '../world';
import {
  BALL_PRESETS,
  CAN_PRESETS,
  CUBE_PRESETS,
  applyBallPreset,
  applyCanPreset,
  applyCubePreset,
} from '../field-object-presets';
import { createImageVisual, exportRoboticsField, importRoboticsField } from '../field-files';
import { resizeRoboticsFieldHandle } from '../field-vector-resize';

const rect: RoboticsFieldDecoration = {
  id: 'rect-1',
  kind: 'rectangle',
  label: 'Финиш',
  xMeters: 2,
  yMeters: 2,
  widthMeters: 0.65,
  heightMeters: 0.42,
  strokeColor: '#0b3558',
  fillColor: '#e5f3fa',
  fillEnabled: false,
};
const circle: RoboticsFieldDecoration = {
  id: 'circle-1',
  kind: 'circle',
  xMeters: 3,
  yMeters: 2,
  widthMeters: 0.25,
  heightMeters: 0.25,
  strokeColor: '#2677ad',
  fillColor: '#d3f0fc',
  fillEnabled: true,
};
const label: RoboticsFieldDecoration = {
  id: 'label-1',
  kind: 'text',
  xMeters: 1,
  yMeters: 4,
  widthMeters: 0.9,
  heightMeters: 0.15,
  strokeColor: '#0b3558',
  fillColor: '#ffffff',
  fillEnabled: false,
  text: 'СТАРТ',
};

function worldWith(...items: RoboticsFieldDecoration[]): RoboticsWorldDocument {
  const world = createRoboticsWorldV3Document('arena');
  return { ...world, field: { ...world.field, visuals: items } };
}

describe('robotics 5m editor, pure drawing layer and physically sized objects', () => {
  it('starts new projects at 5×5m with the same robot dimensions and working sonar fixture', () => {
    const world = createRoboticsWorldV3Document('arena');
    expect(world.field.widthMeters).toBe(5);
    expect(world.field.heightMeters).toBe(5);
    expect(world.robot.bodyLengthMeters).toBe(0.2);
    expect(world.robot.wheelRadiusMeters).toBe(0.0325);
    expect(world.initialPose).toEqual({ xMeters: 2.5, yMeters: 2.5, headingRadians: 0 });
    expect(world.field.obstacles[0]?.xMeters).toBe(3.4);
    expect(parseRoboticsWorldDocument(world).ok).toBe(true);
    expect(createRoboticsWorldDocument('practice').field.widthMeters).toBe(1.8);
  });

  it('round-trips vector decoration types without changing the original physical scene', () => {
    const source = worldWith(rect, circle, label);
    const saved = parseRoboticsWorldDocument(JSON.parse(JSON.stringify(source)));
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error(saved.message);
    expect(saved.world.field.visuals).toEqual(
      [rect, circle, label].map((item) =>
        item.rotationRadians === undefined ? { ...item, rotationRadians: 0 } : item,
      ),
    );
    expect(saved.world.field.balls).toEqual(source.field.balls);
    expect(saved.world.robot).toEqual(source.robot);
    expect(saved.world.initialPose).toEqual(source.initialPose);
  });

  it('rejects overflowing shapes and executable image URLs', () => {
    expect(parseRoboticsWorldDocument(worldWith({ ...rect, xMeters: 4.9 })).ok).toBe(false);
    expect(parseRoboticsWorldDocument(worldWith({ ...circle, heightMeters: 0.3 })).ok).toBe(false);
    const remoteImage = {
      ...rect,
      kind: 'image' as const,
      imageData: 'https://example.org/script.svg',
    };
    expect(parseRoboticsWorldDocument(worldWith(remoteImage)).ok).toBe(false);
  });

  it('supports drag resize/Undo snapshots of lines, walls, circles and text locally', () => {
    const start = worldWith(rect, circle, label);
    const changed = resizeRoboticsFieldHandle(start, 'decoration', 'rect-1', 'end', {
      xMeters: 3,
      yMeters: 3,
    });
    expect(changed.field.visuals?.[0]?.widthMeters).toBe(1);
    expect(changed.field.visuals?.[0]?.heightMeters).toBe(1);
    expect(start.field.visuals?.[0]?.widthMeters).toBe(0.65);
    expect(parseRoboticsWorldDocument(changed).ok).toBe(true);
    const moved = translateRoboticsObject(changed, 'decoration:rect-1', 0.3, 0.2);
    expect(moved.field.visuals?.[0]?.xMeters).toBe(2.3);
    const duplicate = duplicateRoboticsObject(moved, 'decoration:rect-1');
    expect(duplicate.world.field.visuals).toHaveLength(4);
    const erased = removeRoboticsObject(duplicate.world, duplicate.key);
    expect(erased.field.visuals).toHaveLength(3);
    const circleSized = resizeRoboticsFieldHandle(start, 'decoration', 'circle-1', 'end', {
      xMeters: 3.5,
      yMeters: 2.8,
    });
    expect(circleSized.field.visuals?.[1]?.widthMeters).toBe(
      circleSized.field.visuals?.[1]?.heightMeters,
    );
  });

  it('exports/imports ONLY the field JSON and preserves robot, electronics bindings and program', () => {
    const before = createRoboticsWorldV3Document('arena');
    const populated = worldWith(rect, circle, label);
    const json = exportRoboticsField(populated);
    const imported = importRoboticsField(before, json);
    expect(imported.field.visuals).toHaveLength(3);
    expect(imported.robot).toEqual(before.robot);
    expect(imported.bindings).toEqual(before.bindings);
    expect(imported.initialPose).toEqual(before.initialPose);
    expect(() => importRoboticsField(before, '{"format":"unknown","field":{}}')).toThrow();
    expect(() => importRoboticsField(before, 'x'.repeat(550_000))).toThrow();
  });

  it('keeps safe embedded images as project source and rejects external SVG files', () => {
    const world = createRoboticsWorldV3Document('arena');
    const img = createImageVisual(world, 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', 120, 90);
    const parsed = parseRoboticsWorldDocument({
      ...world,
      field: { ...world.field, visuals: [img] },
    });
    expect(parsed.ok).toBe(true);
    expect(() => createImageVisual(world, 'data:image/svg+xml;base64,PHN2Zz4=', 50, 50)).toThrow();
  });

  it('presets alter physical mass and dimensions but stay in shared solver bounds', () => {
    const start = createRoboticsWorldV3Document('arena');
    const ball = {
      id: 'test-ball',
      xMeters: 2,
      yMeters: 3,
      radiusMeters: 0.06,
      massKg: 0.05,
      frictionCoefficient: 0.08,
      restitution: 0.6,
    };
    const pool = applyBallPreset(ball, BALL_PRESETS[0]!.id);
    const tennis = applyBallPreset(ball, BALL_PRESETS[1]!.id);
    expect(pool.massKg).toBeLessThan(tennis.massKg);
    const can = {
      id: 'can',
      kind: 'can' as const,
      xMeters: 2,
      yMeters: 2,
      headingRadians: 0,
      radiusMeters: 0.033,
      heightMeters: 0.115,
      massKg: 0.04,
      slidingFrictionCoefficient: 0.3,
      contactFrictionCoefficient: 0.3,
      restitution: 0.1,
    };
    const full = applyCanPreset(can, CAN_PRESETS[1]!.id, 'full');
    const empty = applyCanPreset(can, CAN_PRESETS[1]!.id, 'empty');
    expect(full.massKg).toBeGreaterThan(empty.massKg);
    const cube = { ...can, kind: 'box' as const, widthMeters: 0.12, depthMeters: 0.08 };
    const mini = applyCubePreset({ ...cube, id: 'cube', xMeters: 3.2 }, CUBE_PRESETS[0]!.id);
    if (mini.kind !== 'box') throw new Error('Ожидался кубик.');
    expect(mini.widthMeters).toBe(0.03);
    expect(mini.massKg).toBe(0.02);
    const combined = parseRoboticsWorldDocument({
      ...start,
      field: { ...start.field, balls: [pool], bodies: [full, mini] },
    });
    if (!combined.ok) throw new Error(combined.message);
    expect(combined.ok).toBe(true);
  });
});
