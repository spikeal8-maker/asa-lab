import { describe, expect, it } from 'vitest';
import { createEmptyThreeDDocument, createThreeDNode } from '@asa-lab/three-d';
import {
  directManipulationReplacements,
  logicalSelectionCount,
  runtimeSelectionKeys,
} from '../selection-model';

describe('ASA 3D logical selection model', () => {
  it('represents two boolean results as two selected objects instead of four source nodes', () => {
    const nodes = [
      { ...createThreeDNode('box', 'a-1'), groupId: 'group-a' },
      { ...createThreeDNode('cylinder', 'a-2'), groupId: 'group-a' },
      { ...createThreeDNode('box', 'b-1'), groupId: 'group-b' },
      { ...createThreeDNode('sphere', 'b-2'), groupId: 'group-b' },
    ];

    expect(runtimeSelectionKeys(nodes)).toEqual(['group:group-a', 'group:group-b']);
    expect(logicalSelectionCount(nodes)).toBe(2);
  });

  it('counts a quick bundle as one object while keeping its runtime members editable', () => {
    const nodes = [
      { ...createThreeDNode('box', 'a'), bundleId: 'bundle-a' },
      { ...createThreeDNode('sphere', 'b'), bundleId: 'bundle-a' },
    ];
    expect(logicalSelectionCount(nodes)).toBe(1);
    expect(runtimeSelectionKeys(nodes)).toEqual(['a', 'b']);
  });

  it('moves every editable member when two boolean proxies move together', () => {
    const cylinder = createThreeDNode('cylinder', 'a-2');
    const sphere = createThreeDNode('sphere', 'b-2');
    const nodes = [
      { ...createThreeDNode('box', 'a-1'), groupId: 'group-a' },
      {
        ...cylinder,
        groupId: 'group-a',
        transform: { ...cylinder.transform, position: { x: 20, y: 10, z: 0 } },
      },
      { ...createThreeDNode('box', 'b-1'), groupId: 'group-b' },
      {
        ...sphere,
        groupId: 'group-b',
        transform: { ...sphere.transform, position: { x: 0, y: 10, z: 20 } },
      },
    ];
    const document = { ...createEmptyThreeDDocument(), nodes };
    const replacements = directManipulationReplacements(document, [
      {
        nodeId: 'group:group-a',
        transform: {
          position: { x: 20, y: 10, z: 5 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
      {
        nodeId: 'group:group-b',
        transform: {
          position: { x: -5, y: 10, z: 20 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
    ]);

    expect(replacements.map((node) => node.transform.position)).toEqual([
      { x: 10, y: 10, z: 5 },
      { x: 30, y: 10, z: 5 },
      { x: -5, y: 10, z: 10 },
      { x: -5, y: 10, z: 30 },
    ]);
  });

  it('scales a boolean proxy around its shared centre without flattening its members', () => {
    const second = createThreeDNode('cylinder', 'second');
    const nodes = [
      { ...createThreeDNode('box', 'first'), groupId: 'group-a' },
      {
        ...second,
        groupId: 'group-a',
        transform: { ...second.transform, position: { x: 20, y: 10, z: 0 } },
      },
    ];
    const replacements = directManipulationReplacements({ ...createEmptyThreeDDocument(), nodes }, [
      {
        nodeId: 'group:group-a',
        dimensions: { width: 80, height: 20, depth: 20 },
        transform: {
          position: { x: 10, y: 10, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
    ]);

    expect(replacements.map((node) => node.transform.position.x)).toEqual([-10, 30]);
    expect(replacements.map((node) => node.dimensions.width)).toEqual([40, 40]);
    expect(replacements.every((node) => node.groupId === 'group-a')).toBe(true);
  });
});
