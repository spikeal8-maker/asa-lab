import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createThreeDNode, type PrimitiveKind } from '@asa-lab/three-d';
import {
  MODEL_EDGE_NAME,
  MODEL_SILHOUETTE_NAME,
  createNodeObject,
  createPrimitiveGeometry,
  createPrimitiveGeometryForKind,
  disposeObject,
} from '../viewport/geometry';
import { createBooleanGeometry } from '../viewport/csg';

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

  it('adds crisp CAD edges and a silhouette without changing printable geometry', () => {
    const object = createNodeObject(createThreeDNode('box', 'outlined-box'));
    const mesh = object.children[0] as THREE.Mesh;
    const hardEdges = mesh.getObjectByName(MODEL_EDGE_NAME);
    const silhouette = mesh.getObjectByName(MODEL_SILHOUETTE_NAME);

    expect(hardEdges).toBeInstanceOf(THREE.LineSegments);
    expect(silhouette).toBeInstanceOf(THREE.Mesh);
    expect(hardEdges?.userData['modelOutline']).toBe(true);
    expect(silhouette?.userData['modelOutline']).toBe(true);
    expect(mesh.geometry.getAttribute('position').count).toBe(24);
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

  it('uses the saved radius and steps for a rounded parallelepiped', () => {
    const node = { ...createThreeDNode('box', 'rounded-box'), bevel: 3, sides: 8 };
    const geometry = createPrimitiveGeometry(node);
    geometry.computeBoundingBox();
    const size = geometry.boundingBox?.getSize(new THREE.Vector3());
    expect(geometry.getAttribute('position').count).toBeGreaterThan(36);
    expect(size?.x).toBeCloseTo(1, 5);
    expect(size?.y).toBeCloseTo(1, 5);
    expect(size?.z).toBeCloseTo(1, 5);
    geometry.dispose();
  });

  it('normalises every catalog primitive to exact width, height and depth', () => {
    const primitives: PrimitiveKind[] = [
      'box',
      'cylinder',
      'sphere',
      'cone',
      'torus',
      'wedge',
      'roof',
      'pyramid',
      'half-sphere',
      'tube',
      'rounded-box',
      'polygon',
      'star',
      'heart',
      'diamond',
      'capsule',
      'paraboloid',
    ];
    for (const primitive of primitives) {
      const geometry = createPrimitiveGeometryForKind(primitive, 48);
      geometry.computeBoundingBox();
      const size = geometry.boundingBox?.getSize(new THREE.Vector3());
      expect(size, primitive).toBeDefined();
      expect(size?.x, primitive).toBeCloseTo(1, 5);
      expect(size?.y, primitive).toBeCloseTo(1, 5);
      expect(size?.z, primitive).toBeCloseTo(1, 5);
      geometry.dispose();
    }
  });

  it('subtracts a hole from a solid into printable boolean geometry', () => {
    const solid = createThreeDNode('box', 'solid');
    const hole = {
      ...createThreeDNode('cylinder', 'hole'),
      operation: 'hole' as const,
      dimensions: { width: 8, depth: 8, height: 30 },
    };
    const geometry = createBooleanGeometry([solid, hole], 'difference');
    expect(geometry).not.toBeNull();
    expect(geometry?.getAttribute('position').count).toBeGreaterThan(36);
    geometry?.dispose();
  });

  it('switches boolean modes without losing the saved solid and hole roles', () => {
    const solid = createThreeDNode('box', 'solid');
    const hole = {
      ...createThreeDNode('cylinder', 'hole'),
      operation: 'hole' as const,
      dimensions: { width: 8, depth: 8, height: 30 },
    };
    const nodes = [solid, hole] as const;
    const differenceBefore = createBooleanGeometry(nodes, 'difference');
    const intersection = createBooleanGeometry(nodes, 'intersection');
    const differenceAfter = createBooleanGeometry(nodes, 'difference');

    expect(differenceBefore?.getAttribute('position').count).toBeGreaterThan(36);
    expect(intersection?.getAttribute('position').count).toBeGreaterThan(0);
    expect(differenceAfter?.getAttribute('position').count).toBe(
      differenceBefore?.getAttribute('position').count,
    );
    expect(nodes.map((node) => node.operation)).toEqual(['solid', 'hole']);

    differenceBefore?.dispose();
    intersection?.dispose();
    differenceAfter?.dispose();
  });
});
