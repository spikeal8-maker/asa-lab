import { describe, expect, it } from 'vitest';
import {
  calculateAnchoredResize,
  calculateHeightResize,
  calculateLiftPosition,
  normaliseDegrees,
  snapRotationRadians,
  snapToStep,
} from '../viewport/manipulation';

describe('ASA 3D direct-manipulation math', () => {
  it('snaps positions to the active millimetre grid', () => {
    expect(snapToStep(4.49, 1)).toBe(4);
    expect(snapToStep(4.51, 1)).toBe(5);
    expect(snapToStep(3.12, 0.25)).toBe(3);
  });

  it('keeps the opposite corner anchored while resizing two axes', () => {
    const result = calculateAnchoredResize({
      initialWidth: 20,
      initialDepth: 20,
      pointerX: 18.4,
      pointerZ: 15.6,
      xSign: 1,
      zSign: 1,
      snapStep: 1,
    });

    expect(result).toEqual({
      width: 28,
      depth: 26,
      centerOffsetX: 4,
      centerOffsetZ: 3,
    });
    expect(result.centerOffsetX - result.width / 2).toBe(-10);
    expect(result.centerOffsetZ - result.depth / 2).toBe(-10);
  });

  it('changes only the requested side dimension', () => {
    const result = calculateAnchoredResize({
      initialWidth: 20,
      initialDepth: 12,
      pointerX: -14.8,
      pointerZ: 200,
      xSign: -1,
      zSign: 0,
      snapStep: 1,
    });

    expect(result.width).toBe(25);
    expect(result.depth).toBe(12);
    expect(result.centerOffsetX).toBe(-2.5);
    expect(result.centerOffsetZ).toBe(0);
  });

  it('keeps the lower face fixed during height resizing', () => {
    const result = calculateHeightResize(20, 7.6, 1);
    expect(result).toEqual({ height: 28, centerOffset: 4 });
    expect(result.centerOffset - result.height / 2).toBe(-10);
  });

  it('does not allow lifting through the workplane', () => {
    expect(calculateLiftPosition(10, -30, 10, 1)).toBe(10);
    expect(calculateLiftPosition(10, 4.4, 10, 1)).toBe(14);
  });

  it('normalises and snaps rotation angles', () => {
    expect(normaliseDegrees(450)).toBe(90);
    expect(normaliseDegrees(-540)).toBe(-180);
    expect((snapRotationRadians((22.6 * Math.PI) / 180, 1) * 180) / Math.PI).toBeCloseTo(23);
    expect((snapRotationRadians((22.6 * Math.PI) / 180, 15) * 180) / Math.PI).toBeCloseTo(30);
  });
});
