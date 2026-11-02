import { describe, expect, it, vi } from 'vitest';
import { createThreeDNode, PRIMITIVE_KINDS } from '@asa-lab/three-d';
import {
  PUBLIC_THREE_D_NODE_FIELDS,
  PUBLIC_THREE_D_PRIMITIVES,
  validatePublicThreeDArtifact,
} from '../../packages/contracts/src/public-three-d-artifact';
import { validatePublicProjectDisplayArtifact } from '../../packages/contracts/src/public-project-display-artifact';

function artifact(primitive: (typeof PRIMITIVE_KINDS)[number] = 'box') {
  const node = createThreeDNode(primitive, 'shape-1');
  return {
    schemaVersion: 4,
    status: 'display',
    viewerFamily: 'three-d',
    units: 'mm',
    provenance: { publicationId: '123e4567-e89b-42d3-a456-426614174001', revisionNumber: 1 },
    capabilities: { readOnly: true, interactive: true, download: false },
    nodes: [Object.fromEntries(PUBLIC_THREE_D_NODE_FIELDS.map((key) => [key, node[key]]))],
  };
}
describe('bounded geometry-only public 3D contract', () => {
  it('keeps the supported primitive list in sync with the canonical 3D module', () => {
    expect(PUBLIC_THREE_D_PRIMITIVES).toEqual(PRIMITIVE_KINDS);
  });
  it.each(PRIMITIVE_KINDS)(
    'accepts canonical %s geometry through the common artifact validator',
    (primitive) => {
      const input = artifact(primitive),
        result = validatePublicProjectDisplayArtifact(input);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.artifact).toEqual(input);
        expect(result.artifact).not.toBe(input);
      }
    },
  );
  it('does not invoke getters or transport editor/private metadata', () => {
    const input = artifact(),
      getter = vi.fn(() => 'secret');
    Object.defineProperty(input.nodes[0]!, 'privateNote', { enumerable: true, get: getter });
    expect(validatePublicThreeDArtifact(input).ok).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(validatePublicThreeDArtifact({ ...artifact(), projectId: 'private-project' }).ok).toBe(
      false,
    );
  });
  it('rejects executable resources, unsupported shapes, oversized geometry and non-finite numbers', () => {
    for (const field of [
      { color: 'url(https://attacker.test)' },
      { primitive: 'external-mesh' },
      { opacity: Infinity },
      { dimensions: { width: NaN, depth: 2, height: 3 } },
    ]) {
      const input = artifact();
      Object.assign(input.nodes[0]!, field);
      expect(validatePublicThreeDArtifact(input).ok).toBe(false);
    }
    const input = artifact();
    input.nodes = Array.from({ length: 257 }, (_, i) => ({ ...input.nodes[0], id: 'n' + i }));
    expect(validatePublicThreeDArtifact(input).ok).toBe(false);
  });
  it('rejects duplicate identities, conflicting groups and writable/download capabilities', () => {
    const input = artifact();
    input.nodes.push({ ...input.nodes[0] });
    expect(validatePublicThreeDArtifact(input).ok).toBe(false);
    const group = artifact();
    Object.assign(group.nodes[0]!, { groupId: 'g', groupOperation: 'union' });
    group.nodes.push({ ...group.nodes[0], id: 'n2', groupOperation: 'difference' });
    expect(validatePublicThreeDArtifact(group).ok).toBe(false);
    expect(
      validatePublicThreeDArtifact({
        ...artifact(),
        capabilities: { readOnly: false, interactive: true, download: true },
      }).ok,
    ).toBe(false);
  });
});
