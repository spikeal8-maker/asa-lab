import {
  createEmptyThreeDDocument,
  parseThreeDDocument,
  type ThreeDDocument,
} from '@asa-lab/three-d';
import type { PublicThreeDArtifact } from '@asa-lab/contracts';

export function publicThreeDDocument(artifact: PublicThreeDArtifact): ThreeDDocument {
  const empty = createEmptyThreeDDocument();
  const parsed = parseThreeDDocument({
    ...empty,
    nodes: artifact.nodes.map((node) => ({
      ...node,
      kind: 'primitive',
      locked: true,
      bundleId: null,
    })),
    grid: { ...empty.grid, visible: false },
  });
  if (!parsed.ok) throw Error('Invalid public 3D geometry');
  return parsed.value;
}
