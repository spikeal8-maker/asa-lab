import { describe, expect, it } from 'vitest';
import {
  commitCommand,
  createEmptyThreeDDocument,
  createHistory,
  createThreeDNode,
  cruiseDocumentNodesToTarget,
  dropDocumentNodesToWorkplane,
  groupDocumentNodes,
  alignDocumentNodes,
  bundleDocumentNodes,
  mirrorDocumentNodes,
  parseThreeDDocument,
  redoHistory,
  unbundleDocumentNodes,
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

  it('uses the Tinkercad red for a new box by default', () => {
    expect(createThreeDNode('box', 'default-box').color).toBe('#d71920');
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

  it('keeps visibility available while a shape is locked', () => {
    const locked = { ...createThreeDNode('box', 'locked-box'), locked: true };
    const source = { ...createEmptyThreeDDocument(), nodes: [locked] };
    const hidden = commitCommand(createHistory(source), {
      type: 'set-visible',
      nodeId: locked.id,
      visible: false,
    });
    expect(hidden.present.nodes[0]).toMatchObject({ locked: true, visible: false });
    expect(source.nodes[0]).toMatchObject({ locked: true, visible: true });
  });

  it('upgrades legacy version-one documents with reversible modelling metadata', () => {
    const document = createEmptyThreeDDocument();
    const legacyNode = createThreeDNode('box', 'legacy');
    const legacy = { ...legacyNode } as Record<string, unknown>;
    delete legacy['groupId'];
    delete legacy['groupOperation'];
    delete legacy['bundleId'];
    const legacyDocument = { ...document } as Record<string, unknown>;
    delete legacyDocument['ruler'];
    const parsed = parseThreeDDocument({ ...legacyDocument, nodes: [legacy] });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.nodes[0]).toMatchObject({
      bundleId: null,
      groupId: null,
      groupOperation: null,
    });
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

  it('bundles shapes without changing geometry, colour or boolean state', () => {
    const first = createThreeDNode('box', 'first');
    const second = createThreeDNode('cylinder', 'second');
    const document = { ...createEmptyThreeDDocument(), nodes: [first, second] };
    const bundled = bundleDocumentNodes(document, ['first', 'second'], 'bundle-1');
    expect(bundled.nodes).toMatchObject([
      { id: 'first', bundleId: 'bundle-1', groupId: null, color: first.color },
      { id: 'second', bundleId: 'bundle-1', groupId: null, color: second.color },
    ]);
    expect(unbundleDocumentNodes(bundled, ['first']).nodes.every((node) => !node.bundleId)).toBe(
      true,
    );
  });

  it('mirrors a selection around its shared centre and remains undoable', () => {
    const first = createThreeDNode('wedge', 'first');
    const second = {
      ...createThreeDNode('box', 'second'),
      transform: {
        ...createThreeDNode('box', 'second').transform,
        position: { x: 30, y: 10, z: 0 },
      },
    };
    const source = { ...createEmptyThreeDDocument(), nodes: [first, second] };
    const history = createHistory(source);
    const mirrored = mirrorDocumentNodes(source, ['first', 'second'], 'x');
    expect(mirrored.nodes[0]?.transform.position.x).toBe(30);
    expect(mirrored.nodes[1]?.transform.position.x).toBe(0);
    expect(mirrored.nodes.every((node) => node.transform.scale.x === -1)).toBe(true);
    const committed = commitCommand(history, { type: 'replace-nodes', nodes: mirrored.nodes });
    expect(undoHistory(committed).present).toEqual(source);
  });

  it('drops to a raised workplane and cruises onto another shape', () => {
    const source = {
      ...createThreeDNode('box', 'source'),
      transform: {
        ...createThreeDNode('box', 'source').transform,
        position: { x: -20, y: 30, z: -10 },
      },
    };
    const target = {
      ...createThreeDNode('box', 'target'),
      transform: {
        ...createThreeDNode('box', 'target').transform,
        position: { x: 40, y: 10, z: 25 },
      },
    };
    const document = { ...createEmptyThreeDDocument(), nodes: [source, target] };
    const dropped = dropDocumentNodesToWorkplane(document, ['source'], 15);
    expect(dropped.nodes[0]?.transform.position.y).toBe(25);
    const cruised = cruiseDocumentNodesToTarget(dropped, ['source'], ['target']);
    expect(cruised.nodes[0]?.transform.position).toEqual({ x: 40, y: 30, z: 25 });
    expect(cruised.nodes[1]).toEqual(target);
  });
});
