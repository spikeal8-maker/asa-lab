import { describe, expect, it } from 'vitest';
import {
  clampTaskImageReferenceRect,
  defaultTaskImageReferenceRect,
  moveTaskImageReferenceRect,
  parseTaskImageReferenceRect,
  resizeTaskImageReferenceRect,
} from '../../apps/web/src/components/task-image-reference-window-layout';

describe('UX1A4 task image reference window geometry', () => {
  it('opens as a bounded reference instead of covering the editor', () => {
    const rect = defaultTaskImageReferenceRect(1440, 900);
    expect(rect.width).toBe(360);
    expect(rect.height).toBe(320);
    expect(rect.x).toBeGreaterThan(900);
    expect(rect.y).toBeGreaterThan(58);
    expect(rect.width).toBeLessThan(1440 / 2);
    expect(rect.height).toBeLessThan(900 / 2);
  });

  it('moves and resizes while staying inside the viewport', () => {
    const start = defaultTaskImageReferenceRect(1440, 900);
    const moved = moveTaskImageReferenceRect(start, -180, 90, 1440, 900);
    expect(moved.x).toBeLessThan(start.x);
    expect(moved.y).toBeGreaterThan(start.y);

    const resized = resizeTaskImageReferenceRect(moved, 'bottom-right', 120, 80, 1440, 900);
    expect(resized.width).toBeGreaterThan(moved.width);
    expect(resized.height).toBeGreaterThan(moved.height);

    const clamped = clampTaskImageReferenceRect(
      { x: -500, y: -500, width: 5000, height: 5000 },
      1440,
      900,
    );
    expect(clamped.x).toBeGreaterThanOrEqual(16);
    expect(clamped.y).toBeGreaterThanOrEqual(74);
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(1440 - 16);
    expect(clamped.y + clamped.height).toBeLessThanOrEqual(900 - 16);
  });

  it('persists geometry only through a validated rect payload', () => {
    const parsed = parseTaskImageReferenceRect(
      JSON.stringify({ x: 40, y: 90, width: 420, height: 360 }),
      1440,
      900,
    );
    expect(parsed).toEqual({ x: 40, y: 90, width: 420, height: 360 });

    const fallback = parseTaskImageReferenceRect(
      JSON.stringify({ x: 40, y: 90, width: 'bad', height: 360 }),
      1440,
      900,
    );
    expect(fallback).toEqual(defaultTaskImageReferenceRect(1440, 900));
  });
});
