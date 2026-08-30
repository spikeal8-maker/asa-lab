import { describe, expect, it } from 'vitest';
import { hitMaskContainsPoint, hitMaskVisibleBounds, type HitMask } from '../component-hit-testing';

describe('component alpha hit testing', () => {
  const mask: HitMask = {
    width: 10,
    height: 10,
    alpha: Uint8ClampedArray.from(
      Array.from({ length: 100 }, (_value, index) => {
        const x = index % 10;
        const y = Math.floor(index / 10);
        return x >= 4 && x <= 5 && y >= 2 && y <= 7 ? 255 : 0;
      }),
    ),
  };

  it('accepts the visible body and a one-pixel tolerance around thin leads', () => {
    expect(hitMaskContainsPoint(mask, { x: 4.5, y: 5 }, 10, 10)).toBe(true);
    expect(hitMaskContainsPoint(mask, { x: 3.5, y: 5 }, 10, 10)).toBe(true);
  });

  it('rejects transparent SVG margins instead of using the image rectangle', () => {
    expect(hitMaskContainsPoint(mask, { x: 0.5, y: 0.5 }, 10, 10)).toBe(false);
    expect(hitMaskContainsPoint(mask, { x: 9.5, y: 9.5 }, 10, 10)).toBe(false);
    expect(hitMaskContainsPoint(mask, { x: -1, y: 5 }, 10, 10)).toBe(false);
  });

  it('derives the painted bounds used by the shared diagnostic anchor', () => {
    expect(hitMaskVisibleBounds(mask, 100, 200)).toEqual({
      minX: 40,
      minY: 40,
      maxX: 60,
      maxY: 160,
    });
    expect(
      hitMaskVisibleBounds(
        { width: 2, height: 2, alpha: Uint8ClampedArray.from([0, 0, 0, 0]) },
        100,
        100,
      ),
    ).toBeNull();
  });
});
