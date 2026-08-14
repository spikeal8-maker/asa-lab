import { describe, expect, it } from 'vitest';
import { THREE_D_MODULE, createThreeDNode } from '../index.js';

describe('ASA 3D module provider', () => {
  it('is active and creates a valid project document', () => {
    expect(THREE_D_MODULE.manifest.availability).toBe('active');
    const document = THREE_D_MODULE.provider?.createEmptyProject();
    expect(THREE_D_MODULE.provider?.validate(document).ok).toBe(true);
  });

  it('summarises solid and hole objects', () => {
    const empty = THREE_D_MODULE.provider?.createEmptyProject();
    expect(empty).toBeDefined();
    if (!empty) return;
    const solid = createThreeDNode('box', 'solid');
    const hole = { ...createThreeDNode('cylinder', 'hole'), operation: 'hole' as const };
    expect(THREE_D_MODULE.provider?.analyse?.({ ...empty, nodes: [solid, hole] })).toMatchObject({
      objectCount: 2,
      solidCount: 1,
      holeCount: 1,
    });
  });
});
