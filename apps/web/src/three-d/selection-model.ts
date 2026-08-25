import { selectionBounds, type ThreeDDocument, type ThreeDNode } from '@asa-lab/three-d';
import type { DirectManipulationCommit } from './viewport/DirectManipulator';

export function runtimeSelectionKeys(nodes: readonly ThreeDNode[]): readonly string[] {
  return [...new Set(nodes.map((node) => (node.groupId ? `group:${node.groupId}` : node.id)))];
}

export function logicalSelectionCount(nodes: readonly ThreeDNode[]): number {
  return new Set(
    nodes.map((node) =>
      node.groupId ? `group:${node.groupId}` : node.bundleId ? `bundle:${node.bundleId}` : node.id,
    ),
  ).size;
}

export function directManipulationReplacements(
  document: ThreeDDocument,
  commits: readonly DirectManipulationCommit[],
): readonly ThreeDNode[] {
  const changes = new Map(commits.map((commit) => [commit.nodeId, commit]));
  const groupChanges = new Map(
    commits
      .filter((commit) => commit.nodeId.startsWith('group:'))
      .map((commit) => [commit.nodeId.slice('group:'.length), commit]),
  );
  const groupTransforms = new Map(
    [...groupChanges].flatMap(([groupId, commit]) => {
      const members = document.nodes.filter((node) => node.groupId === groupId && !node.locked);
      const bounds = selectionBounds(members);
      return bounds
        ? [
            [
              groupId,
              {
                commit,
                bounds,
                scale: commit.dimensions
                  ? {
                      x: commit.dimensions.width / Math.max(bounds.size.x, 0.001),
                      y: commit.dimensions.height / Math.max(bounds.size.y, 0.001),
                      z: commit.dimensions.depth / Math.max(bounds.size.z, 0.001),
                    }
                  : { x: 1, y: 1, z: 1 },
              },
            ] as const,
          ]
        : [];
    }),
  );

  return document.nodes.flatMap((node) => {
    const commit = changes.get(node.id);
    const groupTransform = node.groupId ? groupTransforms.get(node.groupId) : undefined;
    if (node.locked || (!commit && !groupTransform)) return [];
    if (groupTransform) {
      const { bounds, scale } = groupTransform;
      const relative = {
        x: (node.transform.position.x - bounds.center.x) * scale.x,
        y: (node.transform.position.y - bounds.center.y) * scale.y,
        z: (node.transform.position.z - bounds.center.z) * scale.z,
      };
      const rotated = rotateVector(relative, groupTransform.commit.transform.rotation);
      return [
        {
          ...node,
          dimensions: {
            width: node.dimensions.width * scale.x,
            height: node.dimensions.height * scale.y,
            depth: node.dimensions.depth * scale.z,
          },
          transform: {
            ...node.transform,
            position: {
              x: groupTransform.commit.transform.position.x + rotated.x,
              y: groupTransform.commit.transform.position.y + rotated.y,
              z: groupTransform.commit.transform.position.z + rotated.z,
            },
            rotation: {
              x: node.transform.rotation.x + groupTransform.commit.transform.rotation.x,
              y: node.transform.rotation.y + groupTransform.commit.transform.rotation.y,
              z: node.transform.rotation.z + groupTransform.commit.transform.rotation.z,
            },
            scale: { x: 1, y: 1, z: 1 },
          },
        },
      ];
    }
    if (!commit) return [];
    return [
      {
        ...node,
        dimensions: commit.dimensions ? { ...commit.dimensions } : node.dimensions,
        transform: {
          position: { ...commit.transform.position },
          rotation: { ...commit.transform.rotation },
          scale: { ...commit.transform.scale },
        },
      },
    ];
  });
}

function rotateVector(
  vector: { readonly x: number; readonly y: number; readonly z: number },
  rotation: { readonly x: number; readonly y: number; readonly z: number },
): { x: number; y: number; z: number } {
  const toRadians = Math.PI / 180;
  let { x, y, z } = vector;
  const xAngle = rotation.x * toRadians;
  const yAngle = rotation.y * toRadians;
  const zAngle = rotation.z * toRadians;
  [y, z] = [
    y * Math.cos(xAngle) - z * Math.sin(xAngle),
    y * Math.sin(xAngle) + z * Math.cos(xAngle),
  ];
  [x, z] = [
    x * Math.cos(yAngle) + z * Math.sin(yAngle),
    -x * Math.sin(yAngle) + z * Math.cos(yAngle),
  ];
  [x, y] = [
    x * Math.cos(zAngle) - y * Math.sin(zAngle),
    x * Math.sin(zAngle) + y * Math.cos(zAngle),
  ];
  return { x, y, z };
}
