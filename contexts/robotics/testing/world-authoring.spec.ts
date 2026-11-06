import { describe, expect, it } from 'vitest';
import { createRoboticsWorldV3Document, parseRoboticsWorldDocument } from '../domain/world.js';
import {
  createRoboticsTileStamp,
  duplicateRoboticsObject,
  removeRoboticsObject,
  resizeRoboticsTileField,
  rotateRoboticsObject,
  translateRoboticsObject,
} from '../domain/world-authoring.js';

describe('atomic authored field operations', () => {
  it.each(['cross', 't-junction'] as const)(
    '%s stays a single movable/rotatable/duplicable stamp after reopening',
    (kind) => {
      const stamp = createRoboticsTileStamp(
        kind,
        createRoboticsWorldV3Document(),
        { xMeters: 0.3, yMeters: 0.3 },
        0,
      );
      const parsed = parseRoboticsWorldDocument(JSON.parse(JSON.stringify(stamp.world)));
      if (!parsed.ok) throw new Error(parsed.message);
      const key = stamp.keys[0]!;
      expect(key).toMatch(/^mark-group:/);
      const rotated = rotateRoboticsObject(parsed.world, key, Math.PI / 2);
      expect(rotated.field.floorMarks.map((mark) => mark.groupPivot)).toEqual([
        { xMeters: 0.45, yMeters: 0.45 },
        { xMeters: 0.45, yMeters: 0.45 },
      ]);
      const moved = translateRoboticsObject(
        rotated,
        `mark:${rotated.field.floorMarks[0]!.id}`,
        0.3,
        0,
      );
      expect(moved.field.floorMarks.every((mark) => mark.groupPivot!.xMeters > 0.7)).toBe(true);
      const copy = duplicateRoboticsObject(moved, key, { xMeters: 0, yMeters: 0.3 });
      expect(copy.world.field.floorMarks).toHaveLength(4);
      expect(new Set(copy.world.field.floorMarks.map((mark) => mark.id)).size).toBe(4);
      expect(new Set(copy.world.field.floorMarks.map((mark) => mark.groupId)).size).toBe(2);
      expect(removeRoboticsObject(copy.world, copy.key).field.floorMarks).toEqual(
        moved.field.floorMarks,
      );
    },
  );
  it('admits connected boundary stamps while rejecting an invalid resize atomically', () => {
    const world = createRoboticsTileStamp(
      'turn',
      createRoboticsWorldV3Document(),
      { xMeters: 0, yMeters: 0 },
      0,
    ).world;
    expect(parseRoboticsWorldDocument(world).ok).toBe(true);
    const before = JSON.stringify(world);
    expect(() => resizeRoboticsTileField(world, 3, 3)).toThrow();
    expect(JSON.stringify(world)).toBe(before);
    expect(resizeRoboticsTileField(world, 20, 20).field.widthMeters).toBe(6);
  });
  it('rejects broken group pivots rather than silently separating saved stamps', () => {
    const { world } = createRoboticsTileStamp(
      'cross',
      createRoboticsWorldV3Document(),
      { xMeters: 0.3, yMeters: 0.3 },
      0,
    );
    const marks = world.field.floorMarks;
    expect(
      parseRoboticsWorldDocument({
        ...world,
        field: { ...world.field, floorMarks: [{ ...marks[0], groupPivot: undefined }, marks[1]] },
      }).ok,
    ).toBe(false);
    expect(
      parseRoboticsWorldDocument({
        ...world,
        field: {
          ...world.field,
          floorMarks: [marks[0], { ...marks[1], groupPivot: { xMeters: 1, yMeters: 1 } }],
        },
      }).ok,
    ).toBe(false);
  });
  it('joins generated 30 cm cells exactly at the resized outer edges for all quarter turns', () => {
    const initial = createRoboticsWorldV3Document();
    const field = resizeRoboticsTileField(
      { ...initial, field: { ...initial.field, obstacles: [] } },
      6,
      4,
    );
    expect(field.field.widthMeters).toBe(1.8);
    expect(field.field.heightMeters).toBe(1.2);
    for (const turns of [0, 1, 2, 3]) {
      const stamp = createRoboticsTileStamp('cross', field, { xMeters: 1.5, yMeters: 0.9 }, turns);
      expect(parseRoboticsWorldDocument(stamp.world).ok).toBe(true);
      const rotated = rotateRoboticsObject(stamp.world, stamp.keys[0]!, Math.PI / 2);
      expect(parseRoboticsWorldDocument(rotated).ok).toBe(true);
    }
  });
});
