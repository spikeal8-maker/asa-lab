import type {
  BooleanOperation,
  ShapeOperation,
  ThreeDDocument,
  ThreeDNode,
  Vector3Value,
} from './document.js';

export type AlignmentAxis = 'x' | 'y' | 'z';
export type AlignmentMode = 'minimum' | 'center' | 'maximum';

export interface ThreeDBounds {
  readonly min: Vector3Value;
  readonly max: Vector3Value;
  readonly center: Vector3Value;
  readonly size: Vector3Value;
}

function quaternionFromEuler(rotation: Vector3Value): readonly [number, number, number, number] {
  const x = (rotation.x * Math.PI) / 360;
  const y = (rotation.y * Math.PI) / 360;
  const z = (rotation.z * Math.PI) / 360;
  const c1 = Math.cos(x);
  const c2 = Math.cos(y);
  const c3 = Math.cos(z);
  const s1 = Math.sin(x);
  const s2 = Math.sin(y);
  const s3 = Math.sin(z);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

export function nodeBounds(node: ThreeDNode): ThreeDBounds {
  const [x, y, z, w] = quaternionFromEuler(node.transform.rotation);
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  const matrix = [
    1 - 2 * (yy + zz),
    2 * (xy - wz),
    2 * (xz + wy),
    2 * (xy + wz),
    1 - 2 * (xx + zz),
    2 * (yz - wx),
    2 * (xz - wy),
    2 * (yz + wx),
    1 - 2 * (xx + yy),
  ] as const;
  const local = {
    x: (node.dimensions.width * Math.abs(node.transform.scale.x)) / 2,
    y: (node.dimensions.height * Math.abs(node.transform.scale.y)) / 2,
    z: (node.dimensions.depth * Math.abs(node.transform.scale.z)) / 2,
  };
  const half = {
    x:
      Math.abs(matrix[0]) * local.x + Math.abs(matrix[1]) * local.y + Math.abs(matrix[2]) * local.z,
    y:
      Math.abs(matrix[3]) * local.x + Math.abs(matrix[4]) * local.y + Math.abs(matrix[5]) * local.z,
    z:
      Math.abs(matrix[6]) * local.x + Math.abs(matrix[7]) * local.y + Math.abs(matrix[8]) * local.z,
  };
  const min = {
    x: node.transform.position.x - half.x,
    y: node.transform.position.y - half.y,
    z: node.transform.position.z - half.z,
  };
  const max = {
    x: node.transform.position.x + half.x,
    y: node.transform.position.y + half.y,
    z: node.transform.position.z + half.z,
  };
  return {
    min,
    max,
    center: { ...node.transform.position },
    size: { x: half.x * 2, y: half.y * 2, z: half.z * 2 },
  };
}

export function selectionBounds(nodes: readonly ThreeDNode[]): ThreeDBounds | null {
  if (nodes.length === 0) return null;
  const min = {
    x: Number.POSITIVE_INFINITY,
    y: Number.POSITIVE_INFINITY,
    z: Number.POSITIVE_INFINITY,
  };
  const max = {
    x: Number.NEGATIVE_INFINITY,
    y: Number.NEGATIVE_INFINITY,
    z: Number.NEGATIVE_INFINITY,
  };
  for (const node of nodes) {
    const bounds = nodeBounds(node);
    min.x = Math.min(min.x, bounds.min.x);
    min.y = Math.min(min.y, bounds.min.y);
    min.z = Math.min(min.z, bounds.min.z);
    max.x = Math.max(max.x, bounds.max.x);
    max.y = Math.max(max.y, bounds.max.y);
    max.z = Math.max(max.z, bounds.max.z);
  }
  return {
    min,
    max,
    center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 },
    size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
  };
}

export function alignDocumentNodes(
  document: ThreeDDocument,
  nodeIds: readonly string[],
  axis: AlignmentAxis,
  mode: AlignmentMode,
): ThreeDDocument {
  const selected = new Set(nodeIds);
  const candidates = document.nodes.filter((node) => selected.has(node.id) && !node.locked);
  const overall = selectionBounds(candidates);
  if (!overall || candidates.length < 2) return document;
  const target =
    mode === 'minimum'
      ? overall.min[axis]
      : mode === 'maximum'
        ? overall.max[axis]
        : overall.center[axis];
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (!selected.has(node.id) || node.locked) return node;
      const bounds = nodeBounds(node);
      const current =
        mode === 'minimum'
          ? bounds.min[axis]
          : mode === 'maximum'
            ? bounds.max[axis]
            : bounds.center[axis];
      return {
        ...node,
        transform: {
          ...node.transform,
          position: {
            ...node.transform.position,
            [axis]: node.transform.position[axis] + target - current,
          },
        },
      };
    }),
  };
}

export function setDocumentNodeOperation(
  document: ThreeDDocument,
  nodeIds: readonly string[],
  operation: ShapeOperation,
): ThreeDDocument {
  const selected = new Set(nodeIds);
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      selected.has(node.id) && !node.locked ? { ...node, operation } : node,
    ),
  };
}

export function groupDocumentNodes(
  document: ThreeDDocument,
  nodeIds: readonly string[],
  groupId: string,
  groupOperation: BooleanOperation,
): ThreeDDocument {
  const selected = new Set(nodeIds);
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      selected.has(node.id) && !node.locked
        ? { ...node, bundleId: null, groupId, groupOperation }
        : node,
    ),
  };
}

export function bundleDocumentNodes(
  document: ThreeDDocument,
  nodeIds: readonly string[],
  bundleId: string,
): ThreeDDocument {
  const selected = new Set(nodeIds);
  const candidates = document.nodes.filter(
    (node) => selected.has(node.id) && !node.locked && !node.groupId,
  );
  if (candidates.length < 2) return document;
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      selected.has(node.id) && !node.locked && !node.groupId ? { ...node, bundleId } : node,
    ),
  };
}

export function unbundleDocumentNodes(
  document: ThreeDDocument,
  nodeIds: readonly string[],
): ThreeDDocument {
  const selectedBundles = new Set(
    document.nodes
      .filter((node) => nodeIds.includes(node.id) && node.bundleId)
      .map((node) => node.bundleId as string),
  );
  if (selectedBundles.size === 0) return document;
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      node.bundleId && selectedBundles.has(node.bundleId) ? { ...node, bundleId: null } : node,
    ),
  };
}

export function mirrorDocumentNodes(
  document: ThreeDDocument,
  nodeIds: readonly string[],
  axis: AlignmentAxis,
): ThreeDDocument {
  const selected = new Set(nodeIds);
  const candidates = document.nodes.filter((node) => selected.has(node.id) && !node.locked);
  const bounds = selectionBounds(candidates);
  if (!bounds) return document;
  return {
    ...document,
    nodes: document.nodes.map((node) => {
      if (!selected.has(node.id) || node.locked) return node;
      return {
        ...node,
        transform: {
          ...node.transform,
          position: {
            ...node.transform.position,
            [axis]: bounds.center[axis] * 2 - node.transform.position[axis],
          },
          scale: {
            ...node.transform.scale,
            [axis]: node.transform.scale[axis] * -1,
          },
        },
      };
    }),
  };
}

export function dropDocumentNodesToWorkplane(
  document: ThreeDDocument,
  nodeIds: readonly string[],
  workplaneY: number,
): ThreeDDocument {
  if (!Number.isFinite(workplaneY)) return document;
  const selected = new Set(nodeIds);
  const candidates = document.nodes.filter((node) => selected.has(node.id) && !node.locked);
  const bounds = selectionBounds(candidates);
  if (!bounds) return document;
  const delta = workplaneY - bounds.min.y;
  if (Math.abs(delta) < 0.000001) return document;
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      selected.has(node.id) && !node.locked
        ? {
            ...node,
            transform: {
              ...node.transform,
              position: { ...node.transform.position, y: node.transform.position.y + delta },
            },
          }
        : node,
    ),
  };
}

export function cruiseDocumentNodesToTarget(
  document: ThreeDDocument,
  sourceIds: readonly string[],
  targetIds: readonly string[],
): ThreeDDocument {
  const sources = new Set(sourceIds);
  const targets = new Set(targetIds.filter((id) => !sources.has(id)));
  const sourceNodes = document.nodes.filter((node) => sources.has(node.id) && !node.locked);
  const targetNodes = document.nodes.filter((node) => targets.has(node.id) && node.visible);
  const sourceBounds = selectionBounds(sourceNodes);
  const targetBounds = selectionBounds(targetNodes);
  if (!sourceBounds || !targetBounds) return document;
  const delta = {
    x: targetBounds.center.x - sourceBounds.center.x,
    y: targetBounds.max.y - sourceBounds.min.y,
    z: targetBounds.center.z - sourceBounds.center.z,
  };
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      sources.has(node.id) && !node.locked
        ? {
            ...node,
            transform: {
              ...node.transform,
              position: {
                x: node.transform.position.x + delta.x,
                y: node.transform.position.y + delta.y,
                z: node.transform.position.z + delta.z,
              },
            },
          }
        : node,
    ),
  };
}

export function ungroupDocumentNodes(
  document: ThreeDDocument,
  nodeIds: readonly string[],
): ThreeDDocument {
  const selectedGroups = new Set(
    document.nodes
      .filter((node) => nodeIds.includes(node.id) && node.groupId)
      .map((node) => node.groupId as string),
  );
  if (selectedGroups.size === 0) return document;
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      node.groupId && selectedGroups.has(node.groupId)
        ? { ...node, groupId: null, groupOperation: null }
        : node,
    ),
  };
}
