import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { BASE, RUN, footprintFits, projectAnchor, rampGeometry, riseForDegrees } from './passive';

const ramp = { x: 0.35, y: 0.55, width: 0.48, rise: 0.19 };
const viewport = { left: 21, top: 33, width: 720, height: 480 };

function pixel(camera: THREE.Camera, point: THREE.Vector3) {
  camera.updateMatrixWorld();
  const vector = point.project(camera);
  return [
    viewport.left + ((vector.x + 1) * viewport.width) / 2,
    viewport.top + ((1 - vector.y) * viewport.height) / 2,
  ] as const;
}

describe('passive metric ramp', () => {
  it('uses the immutable wedge vertices, constant horizontal run and slope above Z=0', () => {
    const wedge = rampGeometry(ramp);
    expect(wedge.angleRadians).toBeCloseTo(Math.atan2(ramp.rise, RUN), 12);
    expect(wedge.vertices.slice(0, 4).every((point) => point[2] === -BASE)).toBe(true);
    expect(wedge.vertices[4]).toEqual([ramp.x, ramp.y - ramp.width / 2, 0]);
    expect(wedge.vertices[7]).toEqual([ramp.x, ramp.y + ramp.width / 2, 0]);
    expect(wedge.vertices[5]).toEqual([ramp.x + RUN, ramp.y - ramp.width / 2, ramp.rise]);
    expect(wedge.vertices[6]).toEqual([ramp.x + RUN, ramp.y + ramp.width / 2, ramp.rise]);
    expect(riseForDegrees(30)).toBeCloseTo((RUN * Math.sqrt(3)) / 3, 12);
    expect(() => riseForDegrees(90)).toThrow();
    expect(() => rampGeometry({ ...ramp, width: 0 })).toThrow();
    expect(() => rampGeometry({ ...ramp, rise: Number.NaN })).toThrow();
  });

  it('fits the complete footprint and rejects otherwise valid anchors at the edge', () => {
    expect(footprintFits(ramp)).toBe(true);
    expect(footprintFits({ ...ramp, x: 2 })).toBe(false);
    expect(footprintFits({ ...ramp, y: 0.1 })).toBe(false);
    expect(footprintFits({ ...ramp, y: 1.5 })).toBe(false);
  });

  it('inverts actual Top and Perspective ground projections and rejects outside pixels', () => {
    const target = new THREE.Vector3(ramp.x, ramp.y, 0);
    const top = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.01, 25);
    top.position.set(1, 1, 3);
    top.lookAt(1, 1, 0);
    const orbit = new THREE.PerspectiveCamera(42, 1.5, 0.01, 25);
    orbit.position.set(3, -3, 3);
    orbit.lookAt(1, 1, 0);
    for (const [view, camera] of [
      ['top', top],
      ['orbit', orbit],
    ] as const) {
      expect(projectAnchor(camera, view, viewport, ...pixel(camera, target.clone()), 0.2)).toEqual({
        x: ramp.x,
        y: ramp.y,
      });
      expect(
        projectAnchor(camera, view, viewport, viewport.left - 1, viewport.top, 0.2),
      ).toBeNull();
    }
  });

  it('derives Side X independently of pixel height and retains the explicit depth', () => {
    const side = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.01, 25);
    side.position.set(1, -3, 0.5);
    side.up.set(0, 0, 1);
    side.lookAt(1, 0, 0.5);
    for (const cursorHeight of [0, 0.8]) {
      const onCanvas = pixel(side, new THREE.Vector3(ramp.x, 0.3, cursorHeight));
      expect(projectAnchor(side, 'side', viewport, ...onCanvas, 0.712)).toEqual({
        x: ramp.x,
        y: 0.712,
      });
    }
  });
});
