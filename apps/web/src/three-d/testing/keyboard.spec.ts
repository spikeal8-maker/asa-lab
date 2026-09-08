import { describe, expect, it } from 'vitest';
import { applyThreeDCommand, createEmptyThreeDDocument, createThreeDNode } from '@asa-lab/three-d';
import type { ThreeDDocument } from '@asa-lab/three-d';
import { editorShortcutKey, keyboardNudge, nudgedSelection } from '../keyboard';

describe('3D keyboard editing', () => {
  it.each([
    ['KeyC', 'с', 'c'],
    ['KeyV', 'м', 'v'],
    ['KeyZ', 'я', 'z'],
    ['KeyG', 'п', 'g'],
  ])('maps physical %s with Russian key %s to %s', (code, key, expected) => {
    expect(editorShortcutKey({ code: code!, key: key! })).toBe(expected);
  });
  it('supports key-only events and does not reinterpret navigation keys', () => {
    expect(editorShortcutKey({ key: 'C', code: '' })).toBe('c');
    expect(editorShortcutKey({ key: 'ArrowLeft', code: 'ArrowLeft' })).toBe('arrowleft');
  });
  it('uses the grid step and a tenfold Shift step on the workplane', () => {
    expect(keyboardNudge('ArrowLeft', 1, false)).toEqual({ x: -1, z: 0 });
    expect(keyboardNudge('ArrowRight', 0.25, true)).toEqual({ x: 2.5, z: 0 });
    expect(keyboardNudge('ArrowUp', 0.1, false)).toEqual({ x: 0, z: -0.1 });
    expect(keyboardNudge('ArrowDown', 1, true)).toEqual({ x: 0, z: 10 });
    expect(keyboardNudge('c', 1, false)).toBeNull();
  });
  it('moves every operand of selected Boolean results, including holes, without changing geometry', () => {
    const nodes = [
      { ...createThreeDNode('box', 'a'), groupId: 'g' },
      { ...createThreeDNode('sphere', 'b'), groupId: 'g', operation: 'hole' as const },
      createThreeDNode('cylinder', 'other'),
    ];
    const document = { ...createEmptyThreeDDocument(), nodes };
    const moved = nudgedSelection(document, ['a', 'b'], { x: 10, z: -1 });
    expect(moved).toHaveLength(2);
    for (const [index, node] of moved.entries()) {
      expect(node.transform.position).toEqual({
        x: 10,
        y: nodes[index]!.transform.position.y,
        z: -1,
      });
      expect(node.dimensions).toEqual(nodes[index]!.dimensions);
      expect(node.transform.rotation).toEqual(nodes[index]!.transform.rotation);
      expect(node.operation).toBe(nodes[index]!.operation);
    }
    expect(nodes[0]!.transform.position.x).toBe(0);
  });
  it('does not distort groups containing a locked operand or move hidden objects', () => {
    const nodes = [
      { ...createThreeDNode('box', 'a'), groupId: 'g' },
      { ...createThreeDNode('sphere', 'b'), groupId: 'g', locked: true },
      { ...createThreeDNode('box', 'hidden'), visible: false },
    ];
    expect(
      nudgedSelection(
        { ...createEmptyThreeDDocument(), nodes },
        nodes.map((n) => n.id),
        { x: 1, z: 0 },
      ),
    ).toEqual([]);
  });
  it('accumulates held-arrow updates against the latest document without rounding drift', () => {
    let document: ThreeDDocument = {
      ...createEmptyThreeDDocument(),
      nodes: [createThreeDNode('box', 'a')],
    };
    for (let i = 0; i < 100; i++) {
      document = applyThreeDCommand(document, {
        type: 'replace-nodes',
        nodes: nudgedSelection(document, ['a'], { x: 0.1, z: 0 }),
      }).document;
    }
    expect(document.nodes[0]!.transform.position.x).toBe(10);
  });
});
