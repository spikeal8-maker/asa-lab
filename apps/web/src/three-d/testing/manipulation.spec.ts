import { describe, expect, it } from 'vitest';
import {
  calculateAnchoredResize,
  calculateHeightResize,
  calculateLiftPosition,
  normaliseDegrees,
  snapRotationRadians,
  snapToStep,
  canDragOnPlane,
  dragPlaneHeight,
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

  it('scales a footprint uniformly when Shift is held', () => {
    const result = calculateAnchoredResize({
      initialWidth: 20,
      initialDepth: 10,
      pointerX: 20,
      pointerZ: 7,
      xSign: 1,
      zSign: 1,
      snapStep: 1,
      uniform: true,
    });

    expect(result.width).toBe(30);
    expect(result.depth).toBe(15);
    expect(result.centerOffsetX).toBe(5);
    expect(result.centerOffsetZ).toBe(2.5);
  });

  it('scales a footprint around its centre when Alt is held', () => {
    const result = calculateAnchoredResize({
      initialWidth: 20,
      initialDepth: 12,
      pointerX: -14.8,
      pointerZ: 0,
      xSign: -1,
      zSign: 0,
      snapStep: 1,
      centered: true,
    });

    expect(result).toEqual({
      width: 30,
      depth: 12,
      centerOffsetX: 0,
      centerOffsetZ: 0,
    });
  });

  it('grows height equally above and below the centre when Alt is held', () => {
    expect(calculateHeightResize(20, 5, 1, 1, true)).toEqual({
      height: 30,
      centerOffset: 0,
    });
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

describe('плоскость перетаскивания', () => {
  it('проходит через саму фигуру, а не через пол', () => {
    // Пока здесь был пол, деталь уезжала из-под курсора тем сильнее, чем выше
    // она стояла: куб на плоскости уходил на 6% дальше мыши, поднятый на
    // 70 мм — на 63%, верхушка башни — в несколько раз.
    expect(dragPlaneHeight(10)).toBe(10);
    expect(dragPlaneHeight(70)).toBe(70);
    expect(dragPlaneHeight(0)).toBe(0);
  });

  it('не спотыкается о нечисловую высоту', () => {
    expect(dragPlaneHeight(Number.NaN)).toBe(0);
    expect(dragPlaneHeight(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('не двигает фигуру, когда камера смотрит вдоль плоскости', () => {
    // У горизонта луч почти параллелен плоскости, и один пиксель мыши
    // превращается в метры. Лучше не сдвинуть, чем зашвырнуть за экран.
    expect(canDragOnPlane(1)).toBe(true);
    expect(canDragOnPlane(-0.5)).toBe(true);
    expect(canDragOnPlane(0.08)).toBe(true);
    expect(canDragOnPlane(0.02)).toBe(false);
    expect(canDragOnPlane(0)).toBe(false);
  });
});
