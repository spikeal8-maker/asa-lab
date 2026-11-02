import { describe, expect, it } from 'vitest';
import { measureRasterProfile, type RasterProfile } from '../../e2e/electronics-selection-raster';

// Public synthetic CI41371025175, artifact13110879066, stopped-fit390.
// Numeric CTM and recorded PNG pixels only; no owner artwork is copied.
const expectedPx = 1.061224413356719;
const screenCTM = {
  a: 0.590421184109938,
  b: 0,
  c: 0,
  d: 0.590421184109938,
  e: 195.00000088672365,
  f: 719.4095548791257,
};
const body = [
  { x: 186.734104, y: 710.553237 },
  { x: 203.265898, y: 710.553237 },
  { x: 203.265898, y: 716.457449 },
  { x: 186.734104, y: 716.457449 },
];
const profile: RasterProfile = {
  kind: 'pin',
  boundary: { x: screenCTM.a * 11 + screenCTM.e, y: screenCTM.f },
  normal: { x: 1, y: 0 },
  expectedPx,
  excludedBody: body,
  excludedBodyRadius: expectedPx,
};
function fixture(y = 719) {
  const before = { width: 208, height: 722, data: new Uint8Array(208 * 722 * 4).fill(255) };
  const after = { ...before, data: before.data.slice() };
  const set = (x: number, original: number[], selected: number[]) => {
    before.data.set(original, (y * before.width + x) * 4);
    after.data.set(selected, (y * before.width + x) * 4);
  };
  if (y === 719) {
    set(201, [189, 191, 191, 255], [96, 142, 181, 255]);
    set(202, [244, 245, 246, 255], [135, 181, 223, 255]);
    set(203, [244, 245, 246, 255], [244, 245, 246, 255]);
  } else {
    set(201, [185, 185, 186, 255], [99, 141, 178, 255]);
    set(202, [238, 239, 240, 255], [95, 160, 216, 255]);
    set(203, [243, 244, 245, 255], [205, 218, 230, 255]);
  }
  return { before, after, set };
}

describe('actual independent selection raster measurement', () => {
  it('measures the recorded isolated pin from unique pixel centres, not repeated quarter steps', () => {
    const { before, after } = fixture();
    const result = measureRasterProfile(before, after, profile);
    expect(result.lastBlueDistance).toBeCloseTo(202.5 - profile.boundary.x, 12);
    expect(Math.abs(result.lastBlueDistance - expectedPx)).toBeLessThanOrEqual(1.25);
    expect(new Set(result.samples.map((s) => `${s.x},${s.y}`)).size).toBe(result.samples.length);
    expect(result.exteriorBlue).toBe(2);
  });
  it('rejects the original row where adjacent body paint impersonated a wide pin', () => {
    const { before, after } = fixture(717);
    const contaminated = { ...profile, boundary: { ...profile.boundary, y: 717.9335019188509 } };
    expect(() => measureRasterProfile(before, after, contaminated)).toThrow('adjacent body paint');
    // Without independent geometry this same PNG row reports unrelated body blue.
    const result = measureRasterProfile(before, after, {
      ...contaminated,
      excludedBody: undefined,
    });
    expect(result.lastBlueDistance).toBeCloseTo(203.5 - profile.boundary.x, 12);
    // The old loop attributed distance2.5 to that same x203 pixel.
    expect(Math.abs(2.5 - expectedPx)).toBeGreaterThan(1.25);
  });
  it('still detects a genuinely over-wide isolated pin with the unchanged1.25px bound', () => {
    const { before, after, set } = fixture();
    for (const x of [203, 204]) set(x, [244, 245, 246, 255], [59, 142, 215, 255]);
    const result = measureRasterProfile(before, after, profile);
    expect(Math.abs(result.lastBlueDistance - expectedPx)).toBeGreaterThan(1.25);
  });
  it('fails closed for missing blue, clipped pixels and disconnected foreign blue', () => {
    const { before, after, set } = fixture();
    expect(() => measureRasterProfile(before, before, profile)).toThrow('Insufficient');
    expect(() =>
      measureRasterProfile(before, after, { ...profile, boundary: { x: 207, y: 719 } }),
    ).toThrow('clipped');
    set(204, [244, 245, 246, 255], [59, 142, 215, 255]);
    expect(() => measureRasterProfile(before, after, profile)).toThrow('Disconnected');
  });
  it('fails closed when independent pixel coverage is insufficient or the body radius is unknown', () => {
    const { before, after } = fixture();
    expect(() =>
      measureRasterProfile(before, after, {
        ...profile,
        expectedPx: 0.01,
        boundary: { x: 204.49, y: 719 },
      }),
    ).toThrow('Insufficient');
    expect(() =>
      measureRasterProfile(before, after, { ...profile, excludedBodyRadius: undefined }),
    ).toThrow('body paint radius');
  });
  it('rejects missing or degenerate geometry and invalid normals rather than inventing defaults', () => {
    const { before, after } = fixture();
    expect(() => measureRasterProfile(before, after, { ...profile, excludedBody: [] })).toThrow(
      'geometry',
    );
    expect(() =>
      measureRasterProfile(before, after, { ...profile, normal: { x: NaN, y: 0 } }),
    ).toThrow('Invalid');
    expect(() =>
      measureRasterProfile(before, after, { ...profile, excludedBody: Array(4).fill(body[0]!) }),
    ).toThrow('Degenerate');
  });
});
