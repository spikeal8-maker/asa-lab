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
  const groupOffsets = new Map(
    [...groupChanges].flatMap(([groupId, commit]) => {
      const members = document.nodes.filter((node) => node.groupId === groupId && !node.locked);
      const bounds = selectionBounds(members);
      return bounds
        ? [
            [
              groupId,
              {
                x: commit.transform.position.x - bounds.center.x,
                y: commit.transform.position.y - bounds.center.y,
                z: commit.transform.position.z - bounds.center.z,
              },
            ] as const,
          ]
        : [];
    }),
  );

  return document.nodes.flatMap((node) => {
    const commit = changes.get(node.id);
    const groupOffset = node.groupId ? groupOffsets.get(node.groupId) : undefined;
    if (node.locked || (!commit && !groupOffset)) return [];
    if (groupOffset) {
      return [
        {
          ...node,
          transform: {
            ...node.transform,
            position: {
              x: node.transform.position.x + groupOffset.x,
              y: node.transform.position.y + groupOffset.y,
              z: node.transform.position.z + groupOffset.z,
            },
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
