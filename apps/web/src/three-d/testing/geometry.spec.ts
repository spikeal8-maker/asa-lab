import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createThreeDNode } from '@asa-lab/three-d';
import { createNodeObject, disposeObject } from '../viewport/geometry';

describe('ASA 3D primitive geometry', () => {
  it('keeps exact millimetre dimensions in the mesh transform', () => {
    const node = {
      ...createThreeDNode('box', 'box-1'),
      dimensions: { width: 31.5, depth: 18, height: 7.25 },
    };
    const object = createNodeObject(node);
    const mesh = object.children[0];
    expect(mesh).toBeInstanceOf(THREE.Mesh);
    expect(mesh?.scale.toArray()).toEqual([31.5, 7.25, 18]);
    disposeObject(object);
  });

  it('renders a hole as a translucent non-depth-writing shape', () => {
    const node = { ...createThreeDNode('cylinder', 'hole-1'), operation: 'hole' as const };
    const object = createNodeObject(node);
    const mesh = object.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    expect(mesh.material.transparent).toBe(true);
    expect(mesh.material.depthWrite).toBe(false);
    disposeObject(object);
  });
});
