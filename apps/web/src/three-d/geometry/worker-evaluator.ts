import * as THREE from 'three';
import { createBooleanGeometry, readBooleanFeatureEdges } from '../viewport/csg';
import {
  THREE_D_GEOMETRY_WORKER_PROTOCOL,
  THREE_D_LEGACY_BSP_ENGINE,
  type GeometryEvaluateRequest,
  type GeometryWorkerResponse,
} from './worker-protocol';

function exactArrayBuffer(values: Float32Array): ArrayBuffer {
  return values.buffer.slice(
    values.byteOffset,
    values.byteOffset + values.byteLength,
  ) as ArrayBuffer;
}

function checksumFloat32(...arrays: readonly Float32Array[]): string {
  let hash = 0x811c9dc5;
  for (const values of arrays) {
    const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
    for (const value of bytes) {
      hash ^= value;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}

function failure(
  request: GeometryEvaluateRequest,
  code: Extract<GeometryWorkerResponse, { ok: false }>['code'],
  message: string,
): GeometryWorkerResponse {
  return {
    protocolVersion: THREE_D_GEOMETRY_WORKER_PROTOCOL,
    requestId: request.requestId,
    generationId: request.generationId,
    ok: false,
    code,
    message,
  };
}

export function evaluateGeometryRequest(request: GeometryEvaluateRequest): GeometryWorkerResponse {
  if (request.protocolVersion !== THREE_D_GEOMETRY_WORKER_PROTOCOL) {
    return failure(request, 'protocol-mismatch', 'Geometry Worker protocol version mismatch.');
  }
  if (
    request.engine.id !== THREE_D_LEGACY_BSP_ENGINE.id ||
    request.engine.version !== THREE_D_LEGACY_BSP_ENGINE.version
  ) {
    return failure(request, 'unsupported-engine', 'Requested geometry engine is not available.');
  }

  const startedAt = performance.now();
  let geometry: THREE.BufferGeometry | null = null;
  try {
    geometry = createBooleanGeometry(request.operands, request.operation);
    const positionAttribute = geometry?.getAttribute('position');
    const normalAttribute = geometry?.getAttribute('normal');
    // No visible solid, complete subtraction and disjoint intersection are
    // valid empty results, not failures that should restore the source solids.
    if (!geometry || positionAttribute?.count === 0) {
      return {
        protocolVersion: THREE_D_GEOMETRY_WORKER_PROTOCOL,
        requestId: request.requestId,
        generationId: request.generationId,
        ok: true,
        resultKind: 'empty',
        positions: new ArrayBuffer(0),
        normals: new ArrayBuffer(0),
        featureEdges: new ArrayBuffer(0),
        metrics: {
          engine: request.engine,
          computeMs: performance.now() - startedAt,
          triangleCount: 0,
          featureEdgeSegmentCount: 0,
          checksum: checksumFloat32(),
          bounds: null,
        },
      };
    }
    if (!positionAttribute || !normalAttribute) {
      return failure(
        request,
        'invalid-geometry',
        'Boolean operation produced incomplete geometry.',
      );
    }

    const positions = new Float32Array(positionAttribute.array);
    const normals = new Float32Array(normalAttribute.array);
    const featureEdges = new Float32Array(readBooleanFeatureEdges(geometry));
    if (
      positions.some((value) => !Number.isFinite(value)) ||
      normals.some((value) => !Number.isFinite(value)) ||
      featureEdges.some((value) => !Number.isFinite(value))
    ) {
      return failure(request, 'invalid-geometry', 'Boolean operation produced non-finite values.');
    }

    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    if (!bounds) return failure(request, 'invalid-geometry', 'Boolean result has no bounds.');
    return {
      protocolVersion: THREE_D_GEOMETRY_WORKER_PROTOCOL,
      requestId: request.requestId,
      generationId: request.generationId,
      ok: true,
      resultKind: 'mesh',
      positions: exactArrayBuffer(positions),
      normals: exactArrayBuffer(normals),
      featureEdges: exactArrayBuffer(featureEdges),
      metrics: {
        engine: request.engine,
        computeMs: performance.now() - startedAt,
        triangleCount: positionAttribute.count / 3,
        featureEdgeSegmentCount: featureEdges.length / 6,
        checksum: checksumFloat32(positions, normals, featureEdges),
        bounds: {
          min: [bounds.min.x, bounds.min.y, bounds.min.z],
          max: [bounds.max.x, bounds.max.y, bounds.max.z],
        },
      },
    };
  } catch (error) {
    return failure(
      request,
      'internal',
      error instanceof Error ? error.message : 'Geometry evaluation failed.',
    );
  } finally {
    geometry?.dispose();
  }
}
