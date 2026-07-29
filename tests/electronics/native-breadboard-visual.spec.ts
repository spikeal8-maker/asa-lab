import { describe, expect, it } from 'vitest';
import {
  HALF_BREADBOARD_VISUAL,
  halfBreadboardRenderedSize,
  halfBreadboardTerminalPosition,
  halfBreadboardVisualHole,
} from '../../apps/web/src/electronics/native-breadboard-model';
import { WORKBENCH_UNITS_PER_MM } from '../../apps/web/src/electronics/workbench-scale';

describe('native half-breadboard visual model', () => {
  it('contains 400 unique terminal holes at physical scale', () => {
    expect(HALF_BREADBOARD_VISUAL).toMatchObject({
      widthMm: 83.5,
      heightMm: 54.5,
      depthMm: 8.5,
      pitchMm: 2.54,
      centerChannelMm: 7.62,
      terminalCount: 400,
    });
    expect(new Set(HALF_BREADBOARD_VISUAL.holes.map((hole) => hole.id)).size).toBe(400);
    expect(HALF_BREADBOARD_VISUAL.renderWidth).toBeCloseTo(83.5 * WORKBENCH_UNITS_PER_MM, 8);
    expect(HALF_BREADBOARD_VISUAL.renderHeight).toBeCloseTo(54.5 * WORKBENCH_UNITS_PER_MM, 8);
  });

  it('keeps native field and rail IDs aligned with the domain contract', () => {
    expect(halfBreadboardVisualHole('half-400:terminal:30:j')).toMatchObject({
      label: 'j30',
      row: 'j',
      column: 30,
      internalBusId: 'half-400:terminal:30:lower',
    });
    expect(halfBreadboardVisualHole('half-400:rail:top-positive:25')).toMatchObject({
      rail: 'top-positive',
      railIndex: 25,
      internalBusId: 'half-400:rail:top-positive:continuous',
    });
    expect(halfBreadboardVisualHole('missing')).toBeNull();
  });

  it.each([0, 90, 180, 270] as const)(
    'transforms terminal positions consistently at %s degrees',
    (rotation) => {
      const origin = { x: 123, y: 77 };
      const point = halfBreadboardTerminalPosition(
        origin,
        'half-400:terminal:1:a',
        rotation,
      );
      expect(point).not.toBeNull();
      const size = halfBreadboardRenderedSize(rotation);
      expect(point!.x).toBeGreaterThanOrEqual(origin.x);
      expect(point!.x).toBeLessThanOrEqual(origin.x + size.width);
      expect(point!.y).toBeGreaterThanOrEqual(origin.y);
      expect(point!.y).toBeLessThanOrEqual(origin.y + size.height);
    },
  );

  it('swaps the rendered envelope on quarter-turn rotation without changing physical size', () => {
    const zero = halfBreadboardRenderedSize(0);
    const ninety = halfBreadboardRenderedSize(90);
    expect(ninety).toEqual({ width: zero.height, height: zero.width });
    expect(halfBreadboardRenderedSize(180)).toEqual(zero);
    expect(halfBreadboardRenderedSize(270)).toEqual(ninety);
  });

  it('uses a real 5.08 mm visible centre trench between rows e and f', () => {
    expect(HALF_BREADBOARD_VISUAL.channel.heightMm).toBeCloseTo(5.08, 8);
    const e = halfBreadboardVisualHole('half-400:terminal:1:e')!;
    const f = halfBreadboardVisualHole('half-400:terminal:1:f')!;
    expect(f.yMm - e.yMm).toBeCloseTo(7.62, 8);
    expect(HALF_BREADBOARD_VISUAL.channel.yMm).toBeGreaterThan(e.yMm);
    expect(
      HALF_BREADBOARD_VISUAL.channel.yMm + HALF_BREADBOARD_VISUAL.channel.heightMm,
    ).toBeLessThan(f.yMm);
  });
});
