import * as THREE from 'three';
import type { ThreeDGeometryCase } from '../../../../../contexts/three-d/testing/corpus/expectations';
import { PRINTABLE_TOLERANCE_V1 } from '../../../../../contexts/three-d/testing/corpus/expectations';
import { createBooleanGeometry } from '../viewport/csg';

export const LEGACY_CSG_ENGINE_VERSION = 'legacy-bsp-v1' as const;

export type GeometryDiagnosticCode =
  | 'empty'
  | 'non-finite'
  | 'degenerate-triangle'
  | 'boundary-edge'
  | 'non-manifold-edge'
  | 'non-manifold-vertex'
  | 'non-positive-volume'
  | 'exception';

export interface GeometryCorpusResult {
  readonly caseId: string;
  readonly resultKind: 'valid-solid' | 'valid-empty' | 'validation-rejection' | 'engine-exception';
  readonly diagnosticCodes: readonly GeometryDiagnosticCode[];
  readonly message?: string;
  readonly triangleCount: number;
  readonly boundaryEdgeCount: number;
  readonly nonManifoldEdgeCount: number;
  readonly nonManifoldVertexCount: number;
  readonly degenerateTriangleCount: number;
  readonly bounds: readonly [number, number, number, number, number, number] | null;
  readonly areaMm2: number | null;
  readonly volumeMm3: number | null;
  readonly checksum: string | null;
  readonly durationMs: number;
}

type Triangle = readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3];

function quantize(value: number): number {
  const quantum = PRINTABLE_TOLERANCE_V1.coordinateQuantumMm;
  const rounded = Math.round(value / quantum) * quantum;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function vertexKey(value: THREE.Vector3): string {
  return `${quantize(value.x)},${quantize(value.y)},${quantize(value.z)}`;
}

function triangleKey(triangle: Triangle): string {
  return triangle.map(vertexKey).sort().join('|');
}

function stableChecksum(values: readonly string[]): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  const text = values.join('\n');
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193) >>> 0;
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b) >>> 0;
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

function trianglesOf(geometry: THREE.BufferGeometry): readonly Triangle[] {
  const position = geometry.getAttribute('position');
  const triangles: Triangle[] = [];
  for (let offset = 0; offset + 2 < position.count; offset += 3) {
    triangles.push([
      new THREE.Vector3().fromBufferAttribute(position, offset),
      new THREE.Vector3().fromBufferAttribute(position, offset + 1),
      new THREE.Vector3().fromBufferAttribute(position, offset + 2),
    ]);
  }
  return triangles;
}

function analyze(
  caseId: string,
  operation: ThreeDGeometryCase['operation'],
  geometry: THREE.BufferGeometry,
  durationMs: number,
): GeometryCorpusResult {
  const diagnostics = new Set<GeometryDiagnosticCode>();
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const finite = [...position.array, ...(normal?.array ?? [])].every(Number.isFinite);
  if (!finite) diagnostics.add('non-finite');

  const triangles = trianglesOf(geometry);
  const edges = new Map<string, number>();
  const vertexLinks = new Map<string, Array<readonly [string, string]>>();
  let degenerateTriangleCount = 0;
  let areaMm2 = 0;
  let signedVolume = 0;
  for (const triangle of triangles) {
    const [a, b, c] = triangle;
    const cross = b.clone().sub(a).cross(c.clone().sub(a));
    const areaSquared = cross.lengthSq() / 4;
    if (areaSquared <= PRINTABLE_TOLERANCE_V1.minimumTriangleAreaSquaredMm) {
      degenerateTriangleCount += 1;
      continue;
    }
    areaMm2 += Math.sqrt(areaSquared);
    signedVolume += a.dot(b.clone().cross(c)) / 6;
    const keys = [vertexKey(a), vertexKey(b), vertexKey(c)];
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const key = keys[vertex]!;
      const links = vertexLinks.get(key) ?? [];
      links.push([keys[(vertex + 1) % 3]!, keys[(vertex + 2) % 3]!]);
      vertexLinks.set(key, links);
    }
    for (const [start, end] of [
      [keys[0]!, keys[1]!],
      [keys[1]!, keys[2]!],
      [keys[2]!, keys[0]!],
    ] as const) {
      const edge = start < end ? `${start}|${end}` : `${end}|${start}`;
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  if (degenerateTriangleCount > 0) diagnostics.add('degenerate-triangle');
  const boundaryEdgeCount = [...edges.values()].filter((count) => count === 1).length;
  const nonManifoldEdgeCount = [...edges.values()].filter((count) => count > 2).length;
  let nonManifoldVertexCount = 0;
  for (const links of vertexLinks.values()) {
    const adjacency = new Map<string, Set<string>>();
    for (const [left, right] of links) {
      const leftNeighbors = adjacency.get(left) ?? new Set<string>();
      const rightNeighbors = adjacency.get(right) ?? new Set<string>();
      leftNeighbors.add(right);
      rightNeighbors.add(left);
      adjacency.set(left, leftNeighbors);
      adjacency.set(right, rightNeighbors);
    }
    const remaining = new Set(adjacency.keys());
    let components = 0;
    while (remaining.size > 0) {
      components += 1;
      const first = remaining.values().next().value as string;
      const pending = [first];
      remaining.delete(first);
      while (pending.length > 0) {
        const current = pending.pop()!;
        for (const neighbor of adjacency.get(current) ?? []) {
          if (!remaining.delete(neighbor)) continue;
          pending.push(neighbor);
        }
      }
    }
    if (components > 1) nonManifoldVertexCount += 1;
  }
  if (boundaryEdgeCount > 0) diagnostics.add('boundary-edge');
  if (nonManifoldEdgeCount > 0) diagnostics.add('non-manifold-edge');
  if (nonManifoldVertexCount > 0) diagnostics.add('non-manifold-vertex');
  const volumeMm3 = Math.abs(signedVolume);
  if (volumeMm3 <= PRINTABLE_TOLERANCE_V1.minimumVolumeMm3) {
    diagnostics.add('non-positive-volume');
  }

  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  return {
    caseId,
    resultKind: diagnostics.size === 0 ? 'valid-solid' : 'validation-rejection',
    diagnosticCodes: [...diagnostics].sort(),
    triangleCount: triangles.length,
    boundaryEdgeCount,
    nonManifoldEdgeCount,
    nonManifoldVertexCount,
    degenerateTriangleCount,
    bounds: bounds
      ? [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z]
      : null,
    areaMm2: Number.isFinite(areaMm2) ? areaMm2 : null,
    volumeMm3: Number.isFinite(volumeMm3) ? volumeMm3 : null,
    checksum: finite
      ? stableChecksum([LEGACY_CSG_ENGINE_VERSION, operation, ...triangles.map(triangleKey).sort()])
      : null,
    durationMs,
  };
}

export function evaluateGeometryCase(testCase: ThreeDGeometryCase): GeometryCorpusResult {
  const startedAt = performance.now();
  try {
    const geometry = createBooleanGeometry(testCase.document.nodes, testCase.operation);
    const durationMs = performance.now() - startedAt;
    if (!geometry || geometry.getAttribute('position').count === 0) {
      geometry?.dispose();
      return {
        caseId: testCase.id,
        resultKind: 'valid-empty',
        diagnosticCodes: ['empty'],
        triangleCount: 0,
        boundaryEdgeCount: 0,
        nonManifoldEdgeCount: 0,
        nonManifoldVertexCount: 0,
        degenerateTriangleCount: 0,
        bounds: null,
        areaMm2: null,
        volumeMm3: null,
        checksum: null,
        durationMs,
      };
    }
    const result = analyze(testCase.id, testCase.operation, geometry, durationMs);
    geometry.dispose();
    return result;
  } catch (error) {
    return {
      caseId: testCase.id,
      resultKind: 'engine-exception',
      diagnosticCodes: ['exception'],
      message: error instanceof Error ? error.message : String(error),
      triangleCount: 0,
      boundaryEdgeCount: 0,
      nonManifoldEdgeCount: 0,
      nonManifoldVertexCount: 0,
      degenerateTriangleCount: 0,
      bounds: null,
      areaMm2: null,
      volumeMm3: null,
      checksum: null,
      durationMs: performance.now() - startedAt,
    };
  }
}
