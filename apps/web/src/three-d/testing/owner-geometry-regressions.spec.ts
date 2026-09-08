import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createThreeDNode } from '@asa-lab/three-d';
import { createPrimitiveGeometry } from '../viewport/geometry';
import { createBooleanGeometry } from '../viewport/csg';

function volume(geometry: THREE.BufferGeometry): number {
  const positions = geometry.getAttribute('position');
  const indices = geometry.index;
  let result = 0;
  const vertices = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let index = 0; index < (indices?.count ?? positions.count); index += 3) {
    vertices.forEach((vertex, offset) =>
      vertex.fromBufferAttribute(positions, indices?.getX(index + offset) ?? index + offset),
    );
    result += vertices[0]!.dot(vertices[1]!.cross(vertices[2]!)) / 6;
  }
  return result;
}

// Weld only for inspection: duplicate cap/surface vertices are legitimate for
// shading, but every geometric boundary must have an oppositely oriented mate.
function unmatchedEdges(geometry: THREE.BufferGeometry): number {
  const p = geometry.getAttribute('position');
  const index = geometry.index;
  const edges = new Map<string, number>();
  const point = (offset: number): string => {
    const i = index?.getX(offset) ?? offset;
    return [p.getX(i), p.getY(i), p.getZ(i)].map((v) => Math.round(v * 1e5)).join(',');
  };
  for (let i = 0; i < (index?.count ?? p.count); i += 3) {
    const triangle = [point(i), point(i + 1), point(i + 2)];
    for (let j = 0; j < 3; j++) {
      const a = triangle[j]!;
      const b = triangle[(j + 1) % 3]!;
      if (a === b) continue;
      const key = a < b ? `${a}/${b}` : `${b}/${a}`;
      edges.set(key, (edges.get(key) ?? 0) + (a < b ? 1 : -1));
    }
  }
  return [...edges.values()].filter((count) => count !== 0).length;
}

describe('owner underside and rounded-body regressions', () => {
  it('keeps the hemisphere base normal separate from the curved rim', () => {
    const geometry = createPrimitiveGeometry(createThreeDNode('half-sphere', 'dome'));
    try {
      const p = geometry.getAttribute('position');
      const n = geometry.getAttribute('normal');
      let downward = 0;
      let curved = 0;
      for (let i = 0; i < p.count; i++) {
        if (Math.abs(p.getY(i) + 0.5) > 1e-5 || Math.hypot(p.getX(i), p.getZ(i)) < 0.49) continue;
        if (n.getY(i) < -0.99) downward++;
        else {
          expect(n.getY(i)).toBeGreaterThanOrEqual(-1e-5);
          curved++;
        }
      }
      expect(downward).toBeGreaterThan(0);
      expect(curved).toBeGreaterThan(0);
    } finally {
      geometry.dispose();
    }
  });

  it.each([
    ['round-roof', 24],
    ['half-sphere', 24],
    ['half-sphere', 7],
    ['half-sphere', 25],
  ] as const)('%s with %s sides has a closed outward-facing base', (kind, sides) => {
    const geometry = createPrimitiveGeometry({ ...createThreeDNode(kind, kind), sides });
    try {
      expect(unmatchedEdges(geometry)).toBe(0);
      expect(volume(geometry)).toBeGreaterThan(0);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      const hits = new THREE.Raycaster(
        new THREE.Vector3(0.07, -2, 0.09),
        new THREE.Vector3(0, 1, 0),
      ).intersectObject(mesh);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]!.point.y).toBeCloseTo(-0.5, 5);
      (mesh.material as THREE.Material).dispose();
    } finally {
      geometry.dispose();
    }
  });

  it('unites two default-detail rounded boxes without exhausting the call stack', () => {
    const first = { ...createThreeDNode('box', 'body'), bevel: 2, sides: 24 };
    const second = {
      ...first,
      id: 'cab',
      transform: {
        ...first.transform,
        position: { ...first.transform.position, x: 10 },
      },
    };
    const geometry = createBooleanGeometry([first, second], 'union');
    expect(geometry).not.toBeNull();
    try {
      expect(volume(geometry!)).toBeGreaterThan(10000);
      expect(volume(geometry!)).toBeLessThan(12000);
      geometry!.computeBoundingBox();
      expect(geometry!.boundingBox!.getSize(new THREE.Vector3()).toArray()).toEqual([30, 20, 20]);
    } finally {
      geometry?.dispose();
    }
  }, 30000);

  it('unites the reported bus body and cab at their real dimensions and offsets', () => {
    const first = {
      ...createThreeDNode('box', 'body'),
      bevel: 2,
      sides: 24,
      dimensions: { width: 91, height: 31, depth: 54 },
      transform: {
        position: { x: 5.5, y: 23.5, z: 14 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      },
    };
    const second = {
      ...first,
      id: 'cab',
      dimensions: { width: 20, height: 20, depth: 54 },
      transform: { ...first.transform, position: { x: -44, y: 18, z: 14 } },
    };
    const geometry = createBooleanGeometry([first, second], 'union');
    expect(geometry).not.toBeNull();
    try {
      expect(volume(geometry!)).toBeGreaterThan(155000);
      expect(volume(geometry!)).toBeLessThan(174000);
      const material = new THREE.MeshBasicMaterial();
      const mesh = new THREE.Mesh(geometry!, material);
      for (const x of [-44, 5.5]) {
        const hits = new THREE.Raycaster(
          new THREE.Vector3(x, 0, 14),
          new THREE.Vector3(0, 1, 0),
        ).intersectObject(mesh);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0]!.point.y).toBeCloseTo(8, 4);
      }
      material.dispose();
    } finally {
      geometry?.dispose();
    }
  }, 30000);
});
