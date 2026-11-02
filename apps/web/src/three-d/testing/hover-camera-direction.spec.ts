import { expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { hoverCameraDirection } from '../hover-camera-direction';

function screenMarker(x: number, y: number) {
  const direction = hoverCameraDirection(x, y);
  const camera = new PerspectiveCamera(45, 4 / 3, 0.1, 100);
  camera.position.set(direction.x, direction.y, direction.z).multiplyScalar(5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const projected = new Vector3(0, 0, 1).project(camera);
  return { x: projected.x, y: -projected.y }; // Screen Y grows downwards.
}

it('moves the model front marker with the pointer in both screen axes', () => {
  const center = screenMarker(0, 0);
  expect(screenMarker(1, 0).x).toBeGreaterThan(center.x);
  expect(screenMarker(-1, 0).x).toBeLessThan(center.x);
  expect(screenMarker(0, 1).y).toBeGreaterThan(center.y);
  expect(screenMarker(0, -1).y).toBeLessThan(center.y);
});
