import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { collectThumbnailTriangles } from '../ShapeThumbnail';

describe('thumbnail face visibility', () => {
  it.each([
    [1, 1],
    [-1, 1],
    [1, 0.01],
    [-1, 0.01],
  ])('uses winding including small valid faces (normal z=%s, scale=%s)', (normalZ, scale) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.5, 0], 3),
    );
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute([0, 0, normalZ, 0, 0, normalZ, 0, 0, normalZ], 3),
    );
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    try {
      for (const z of [2, -2]) {
        camera.position.set(0, 0, z);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        const triangles = collectThumbnailTriangles(
          geometry,
          camera,
          new THREE.Matrix4().makeScale(scale, scale, scale),
          '#e31c2b',
        );
        expect(triangles).toHaveLength(z > 0 ? 1 : 0);
      }
    } finally {
      geometry.dispose();
    }
  });
});
