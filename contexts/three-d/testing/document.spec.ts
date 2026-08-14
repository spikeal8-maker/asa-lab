import { describe, expect, it } from 'vitest';
import {
  commitCommand,
  createEmptyThreeDDocument,
  createHistory,
  createThreeDNode,
  groupDocumentNodes,
  alignDocumentNodes,
  parseThreeDDocument,
  redoHistory,
  undoHistory,
} from '../index.js';

describe('ASA 3D document', () => {
  it('creates a versioned millimetre document accepted by the parser', () => {
    const document = createEmptyThreeDDocument();
    expect(parseThreeDDocument(document)).toEqual({ ok: true, value: document });
    expect(document.units).toBe('mm');
    expect(document.schemaVersion).toBe(1);
    expect(document.camera).toEqual({
      position: { x: 0, y: 181, z: 181 },
      target: { x: 0, y: 0, z: 0 },
      projection: 'perspective',
    });
  });

  it('rejects duplicate node identifiers', () => {
    const document = createEmptyThreeDDocument();
    const node = createThreeDNode('box', 'same');
    expect(parseThreeDDocument({ ...document, nodes: [node, node] })).toEqual({
      ok: false,
      message: 'Идентификаторы 3D-объектов должны быть уникальными.',
    });
  });

  it('applies reversible commands without mutating the source document', () => {
    const source = createEmptyThreeDDocument();
    const added = commitCommand(createHistory(source), {
      type: 'add',
      node: createThreeDNode('cylinder', 'cylinder-1'),
    });
    expect(source.nodes).toHaveLength(0);
    expect(added.present.nodes).toHaveLength(1);
    const undone = undoHistory(added);
    expect(undone.present.nodes).toHaveLength(0);
    expect(redoHistory(undone).present.nodes[0]?.primitive).toBe('cylinder');
  });

  it('upgrades legacy version-one documents with reversible modelling metadata', () => {
    const document = createEmptyThreeDDocument();
    const legacyNode = createThreeDNode('box', 'legacy');
    const legacy = { ...legacyNode } as Record<string, unknown>;
    delete legacy['groupId'];
    delete legacy['groupOperation'];
    const legacyDocument = { ...document } as Record<string, unknown>;
    delete legacyDocument['ruler'];
    const parsed = parseThreeDDocument({ ...legacyDocument, nodes: [legacy] });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.nodes[0]).toMatchObject({ groupId: null, groupOperation: null });
    expect(parsed.value.ruler).toEqual({
      visible: false,
      origin: { x: 0, y: 0, z: 0 },
      precision: 2,
    });
  });

  it('groups, aligns and ungroups editable nodes without flattening them', () => {
    const first = createThreeDNode('box', 'first');
    const second = {
      ...createThreeDNode('cylinder', 'second'),
      transform: {
        ...createThreeDNode('cylinder', 'second').transform,
        position: { x: 30, y: 10, z: 12 },
      },
    };
    const document = { ...createEmptyThreeDDocument(), nodes: [first, second] };
    const aligned = alignDocumentNodes(document, ['first', 'second'], 'z', 'center');
    expect(aligned.nodes[0]?.transform.position.z).toBe(aligned.nodes[1]?.transform.position.z);
    const grouped = groupDocumentNodes(aligned, ['first', 'second'], 'group-1', 'union');
    expect(grouped.nodes).toHaveLength(2);
    expect(grouped.nodes.every((node) => node.groupId === 'group-1')).toBe(true);
  });
});
