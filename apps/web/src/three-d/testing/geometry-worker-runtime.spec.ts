import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyThreeDDocument, createThreeDNode, type ThreeDNode } from '@asa-lab/three-d';
import { GeometryWorkerClient, type GeometryWorkerLike } from '../geometry/worker-client';
import { evaluateGeometryRequest } from '../geometry/worker-evaluator';
import type {
  GeometryEvaluateRequest,
  GeometryWorkerRequest,
  GeometryWorkerResponse,
} from '../geometry/worker-protocol';
import { SceneRuntime } from '../viewport/SceneRuntime';
import { DirectManipulator, type DirectManipulationCommit } from '../viewport/DirectManipulator';
import { directManipulationReplacements } from '../selection-model';
import { disposeObject } from '../viewport/geometry';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GeometryResultNotice } from '../GeometryResultNotice';
import { downloadThreeDJson } from '../exporters';
import { geometryResultIsCurrent, type GeometryResultState } from '../geometry/result-state';

class ControlledWorker implements GeometryWorkerLike {
  onmessage: ((event: MessageEvent<GeometryWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly requests: GeometryEvaluateRequest[] = [];
  terminated = false;

  postMessage(message: GeometryWorkerRequest): void {
    if (message.kind === 'evaluate-boolean') this.requests.push(message);
  }

  completeNext(): void {
    const request = this.requests.shift();
    if (!request) throw new Error('No pending Boolean request');
    this.onmessage?.({
      data: evaluateGeometryRequest(request),
    } as MessageEvent<GeometryWorkerResponse>);
  }

  terminate(): void {
    this.terminated = true;
  }
}

const cleanup: Array<() => void> = [];

function harness(options: { timeoutMs?: number; creationFails?: boolean } = {}) {
  const document = createEmptyThreeDDocument();
  const workers: ControlledWorker[] = [];
  const client = new GeometryWorkerClient(() => {
    if (options.creationFails) throw new Error('Worker creation denied');
    const worker = new ControlledWorker();
    workers.push(worker);
    return worker;
  }, options.timeoutMs);
  const root = new THREE.Group();
  const entries = new Map<string, { object: THREE.Group; node: ThreeDNode }>();
  const dataset: Record<string, string> = {};
  const setSelection = vi.fn();
  const isDragging = vi.fn(() => false);
  const cancelDrag = vi.fn();
  const onGeometryStateChange = vi.fn<(state: GeometryResultState) => void>();
  // Exercise the real document reconciliation and asynchronous scene updates
  // with Three.js objects, without creating a GPU context or animation loop.
  const runtime = Object.create(SceneRuntime.prototype) as SceneRuntime;
  Object.assign(runtime, {
    scene: new THREE.Scene(),
    container: { dataset },
    entries,
    booleanRoot: root,
    geometryWorker: client,
    deferredResults: new Map(),
    documentSignature: '',
    gridSignature: JSON.stringify(document.grid),
    manipulator: { setGridSnap: vi.fn(), setSelection, isDragging, cancelDrag },
    syncRuler: vi.fn(),
    geometryState: null,
    onGeometryStateChange,
  });
  cleanup.push(() => {
    (runtime as unknown as { clearDeferredResults: () => void }).clearDeferredResults();
    client.dispose();
    disposeObject(root);
  });
  return {
    root,
    entries,
    dataset,
    workers,
    setSelection,
    runtime,
    onGeometryStateChange,
    isDragging,
    cancelDrag,
    flush: () =>
      (runtime as unknown as { flushDeferredResults: () => void }).flushDeferredResults(),
    state: () => onGeometryStateChange.mock.lastCall![0],
    export: (nodes: readonly ThreeDNode[]) => runtime.exportStl({ ...document, nodes }),
    update(nodes: readonly ThreeDNode[]) {
      runtime.setDocument(
        { ...document, nodes },
        nodes.filter((node) => node.visible).map((node) => node.id),
      );
    },
  };
}

function pair(): ThreeDNode[] {
  return ['a', 'b'].map((id) => ({
    ...createThreeDNode('box', id),
    groupId: 'g',
    groupOperation: 'union' as const,
  }));
}

function releaseHarness(
  entries: readonly { object: THREE.Group; node: ThreeDNode }[],
  onCommit: (commits: readonly DirectManipulationCommit[]) => void,
) {
  const manipulator = Object.create(DirectManipulator.prototype) as DirectManipulator;
  const methods = manipulator as unknown as {
    finishDrag: (commit?: boolean) => void;
    commitBasis: (entry: {
      object: THREE.Group;
      node: ThreeDNode;
    }) => NonNullable<DirectManipulationCommit['basis']>;
  };
  const starts = entries.map((entry) => ({
    nodeId: entry.node.id,
    entry,
    startPosition: entry.object.position.clone(),
    startQuaternion: entry.object.quaternion.clone(),
    startScale: entry.object.scale.clone(),
  }));
  Object.assign(manipulator, {
    drag: {
      pointerId: 1,
      moved: true,
      multiSelection: entries.length > 1,
      descriptor: { id: 'resize-east', kind: 'resize', xSign: 1, zSign: 0 },
      nodeId: entries[0]!.node.id,
      entry: entries[0],
      transformEntries: starts,
      moveEntries: starts,
      bases: new Map(entries.map((entry) => [entry.node.id, methods.commitBasis(entry)])),
    },
    canvas: { hasPointerCapture: () => false, style: {} },
    container: { dataset: {} },
    orbit: { enabled: false },
    callbacks: {
      onCommit: (
        nodeId: string,
        transform: DirectManipulationCommit['transform'],
        dimensions: DirectManipulationCommit['dimensions'],
        basis: DirectManipulationCommit['basis'],
      ) => onCommit([{ nodeId, transform, dimensions, basis }]),
      onCommitMany: onCommit,
    },
    hideModifierHint: vi.fn(),
    clearDimensionVisuals: vi.fn(),
    setHoveredHandle: vi.fn(),
    update: vi.fn(),
    showPinnedMeasurements: vi.fn(),
  });
  return { release: () => methods.finishDrag(), cancel: () => manipulator.cancelDrag() };
}

function worldBounds(object: THREE.Object3D): number[] {
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(object);
  return [...bounds.min.toArray(), ...bounds.max.toArray()].map(
    (value) => Math.round(value * 1000) / 1000 || 0,
  );
}

describe('Boolean Worker scene lifecycle', () => {
  afterEach(() => {
    cleanup.splice(0).forEach((dispose) => dispose());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it.each(['width', 'height', 'depth'] as const)(
    'holds %s and the opposite anchor through release, pending, and Worker replacement',
    async (dimension) => {
      const scene = harness();
      let nodes = pair();
      scene.update(nodes);
      scene.workers[0]!.completeNext();
      await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('ready'));
      const entry = scene.entries.get('group:g')!;
      const commit = vi.fn((commits: readonly DirectManipulationCommit[]) => {
        nodes = [
          ...directManipulationReplacements({ ...createEmptyThreeDDocument(), nodes }, commits),
        ];
      });
      const gesture = releaseHarness([entry], commit);
      const axis = dimension === 'width' ? 'x' : dimension === 'height' ? 'y' : 'z';
      entry.object.scale[axis] = 2;
      entry.object.position[axis] += 10;
      const preview = worldBounds(entry.object);
      gesture.release();
      expect(commit).toHaveBeenCalledOnce();
      expect(nodes[0]!.dimensions[dimension] * nodes[0]!.transform.scale[axis]).toBeCloseTo(40, 6);
      expect(commit.mock.calls[0]![0][0]!.transform.scale).toEqual({ x: 1, y: 1, z: 1 });
      expect(worldBounds(entry.object)).toEqual(preview);
      scene.update(nodes);
      expect(worldBounds(entry.object)).toEqual(preview);
      expect(() => scene.export(nodes)).toThrow();
      scene.workers[1]!.completeNext();
      await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('ready'));
      expect(worldBounds(scene.entries.get('group:g')!.object)).toEqual(preview);
    },
  );

  it('uses the cut result bounds, not an off-centre protruding hole, for two consecutive resizes', async () => {
    const scene = harness();
    let nodes: ThreeDNode[] = pair().map((node, i) => ({
      ...node,
      groupOperation: 'difference',
      ...(i
        ? {
            operation: 'hole',
            dimensions: { width: 20, height: 60, depth: 60 },
            transform: { ...node.transform, position: { x: 15, y: 10, z: 0 } },
          }
        : {}),
    }));
    scene.update(nodes);
    scene.workers[0]!.completeNext();
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('ready'));
    expect(scene.entries.get('group:g')!.node.dimensions.width).toBeCloseTo(15, 6);
    let preview: number[] = [];
    for (let step = 0; step < 2; step += 1) {
      const entry = scene.entries.get('group:g')!;
      const gesture = releaseHarness([entry], (commits) => {
        nodes = [
          ...directManipulationReplacements({ ...createEmptyThreeDDocument(), nodes }, commits),
        ];
        scene.update(nodes);
      });
      entry.object.scale.x *= 2;
      preview = worldBounds(entry.object);
      gesture.release();
      expect(worldBounds(entry.object)).toEqual(preview);
    }
    scene.workers.at(-1)!.completeNext();
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('ready'));
    expect(worldBounds(scene.entries.get('group:g')!.object)).toEqual(preview);
    expect(scene.entries.get('group:g')!.node.dimensions.width).toBeCloseTo(60, 6);
  });

  it('retains a multi-selection preview as one commit and restores cancelled gestures', () => {
    const entries = pair().map((node) => {
      const object = new THREE.Group();
      object.add(new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20)));
      object.position.y = 10;
      cleanup.push(() => disposeObject(object));
      return { node, object };
    });
    const original = entries.map((entry) => worldBounds(entry.object));
    const commit = vi.fn();
    const cancelled = releaseHarness(entries, commit);
    entries.forEach((entry) => entry.object.scale.set(2, 2, 2));
    cancelled.cancel();
    expect(commit).not.toHaveBeenCalled();
    expect(entries.map((entry) => worldBounds(entry.object))).toEqual(original);
    const gesture = releaseHarness(entries, commit);
    entries.forEach((entry) => entry.object.scale.set(2, 2, 2));
    const preview = entries.map((entry) => worldBounds(entry.object));
    gesture.release();
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0]![0]).toHaveLength(2);
    expect(entries.map((entry) => worldBounds(entry.object))).toEqual(preview);
  });

  it('keeps both Boolean results and rounded profiles in the same pose before either reply', async () => {
    const scene = harness();
    let nodes = [
      // Low-detail rounding isolates the handoff; the unchanged legacy BSP
      // overflows its stack on coincident high-detail rounded operands (R3).
      ...pair().map((node) => ({ ...node, bevel: 2, sides: 1 })),
      ...pair().map((node) => ({
        ...node,
        id: `other-${node.id}`,
        groupId: 'other',
        transform: { ...node.transform, position: { x: 40, y: 10, z: 0 } },
      })),
    ];
    scene.update(nodes);
    scene.workers[0]!.completeNext();
    await vi.waitFor(() => expect(scene.workers[0]!.requests).toHaveLength(1));
    scene.workers[0]!.completeNext();
    expect(scene.dataset['geometryWorkerError']).toBeUndefined();
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('ready'));
    const entries = [...scene.entries.values()];
    const gesture = releaseHarness(entries, (commits) => {
      nodes = [
        ...directManipulationReplacements({ ...createEmptyThreeDDocument(), nodes }, commits),
      ];
      scene.update(nodes);
    });
    entries.forEach((entry) => {
      entry.object.scale.set(2, 2, 2);
      entry.object.position.multiplyScalar(2);
    });
    const preview = entries.map((entry) => worldBounds(entry.object));
    gesture.release();
    expect(entries.map((entry) => worldBounds(entry.object))).toEqual(preview);
    expect(nodes[0]!.dimensions).toEqual({ width: 20, height: 20, depth: 20 });
    expect(nodes[0]!.bevel).toBe(2);
    expect(nodes[0]!.transform.scale).toEqual({ x: 2, y: 2, z: 2 });
    scene.workers[1]!.completeNext();
    await vi.waitFor(() => expect(scene.workers[1]!.requests).toHaveLength(1));
    scene.workers[1]!.completeNext();
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('ready'));
    expect([...scene.entries.values()].map((entry) => worldBounds(entry.object))).toEqual(preview);
  });

  it('defers a completed Worker mesh during the next gesture and applies it only after cancel/release', async () => {
    const scene = harness();
    const nodes = pair();
    scene.update(nodes);
    scene.workers[0]!.completeNext();
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('ready'));
    const previous = scene.entries.get('group:g')!;
    scene.update(nodes.map((node) => ({ ...node, dimensions: { ...node.dimensions, width: 40 } })));
    scene.isDragging.mockReturnValue(true);
    previous.object.scale.x = 3;
    scene.workers[1]!.completeNext();
    await Promise.resolve();
    await Promise.resolve();
    expect(scene.entries.get('group:g')).toBe(previous);
    expect(previous.object.scale.x).toBe(3);
    expect(scene.dataset['geometryWorkerState']).toBe('evaluating');
    scene.isDragging.mockReturnValue(false);
    scene.flush();
    expect(scene.dataset['geometryWorkerState']).toBe('ready');
    expect(scene.entries.get('group:g')!.node.dimensions.width).toBeCloseTo(40, 6);
  });

  it('keeps the requested pose through 100 resize/undo/redo updates and rejects the late first result', async () => {
    const scene = harness();
    const nodes = pair();
    scene.update(nodes);
    scene.workers[0]!.completeNext();
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('ready'));
    let late: (() => void) | undefined;
    for (let index = 0; index < 100; index += 1) {
      const width = index % 3 === 0 ? 40 : index % 3 === 1 ? 20 : 60;
      scene.update(nodes.map((node) => ({ ...node, dimensions: { ...node.dimensions, width } })));
      if (index === 0) {
        const worker = scene.workers.at(-1)!;
        const callback = worker.onmessage!;
        const result = evaluateGeometryRequest(worker.requests[0]!);
        late = () => callback({ data: result } as MessageEvent<GeometryWorkerResponse>);
      }
      expect(worldBounds(scene.root)[3]! - worldBounds(scene.root)[0]!).toBe(width);
      expect(scene.root.children).toHaveLength(1);
    }
    late?.();
    await Promise.resolve();
    expect(scene.dataset['geometryWorkerState']).toBe('evaluating');
    expect(scene.workers.filter((worker) => !worker.terminated)).toHaveLength(1);
    scene.workers.at(-1)!.completeNext();
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('ready'));
    expect(scene.entries.get('group:g')!.node.dimensions.width).toBeCloseTo(40, 6);
  });

  it('keeps the named source download URL alive across asynchronous browser handoff and releases it afterwards', () => {
    vi.useFakeTimers();
    const anchor = { href: '', download: '', hidden: false, click: vi.fn(), remove: vi.fn() };
    const append = vi.fn();
    vi.stubGlobal('window', {
      document: { createElement: () => anchor, body: { append } },
      setTimeout,
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:source');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    downloadThreeDJson(createEmptyThreeDDocument(), 'Проверка модели');
    expect(anchor.download).toBe('Проверка-модели.asa3d.json');
    expect(append).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(59_000);
    expect(revoke).toHaveBeenCalledWith('blob:source');
  });

  it('removes a hidden group immediately, clears its selection proxy, and restores it when shown', async () => {
    const scene = harness();
    const nodes = pair();
    scene.update(nodes);
    scene.workers[0]!.completeNext();
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('ready'));
    const oldObject = scene.root.children[0]!;
    const mesh = oldObject.children[0] as THREE.Mesh;
    const disposed = vi.spyOn(mesh.geometry, 'dispose');

    scene.update(nodes.map((node) => ({ ...node, visible: false })));

    expect(scene.root.children).toHaveLength(0);
    expect(scene.entries.size).toBe(0);
    expect(oldObject.parent).toBeNull();
    expect(disposed).toHaveBeenCalledOnce();
    expect(scene.setSelection).toHaveBeenLastCalledWith(null, []);
    expect(scene.workers).toHaveLength(1);
    expect(scene.dataset['geometryWorkerState']).toBe('idle');

    scene.update(nodes);
    scene.workers[1]!.completeNext();
    await vi.waitFor(() => expect(scene.root.children).toHaveLength(1));
    expect(scene.setSelection).toHaveBeenLastCalledWith('group:g', ['group:g']);
  });

  it('removes the previous mesh for an empty intersection, without rendering its operands', async () => {
    const scene = harness();
    const nodes = pair();
    scene.update(nodes);
    scene.workers[0]!.completeNext();
    await vi.waitFor(() => expect(scene.root.children).toHaveLength(1));
    const oldObject = scene.root.children[0]!;
    const mesh = oldObject.children[0] as THREE.Mesh;
    const disposed = vi.spyOn(mesh.geometry, 'dispose');

    scene.update(
      nodes.map((node, index) => ({
        ...node,
        groupOperation: 'intersection',
        transform: { ...node.transform, position: { x: index * 100, y: 10, z: 0 } },
      })),
    );
    scene.workers[1]!.completeNext();
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('valid-empty'));

    expect(scene.root.children).toHaveLength(0);
    expect(scene.entries.size).toBe(0);
    expect(oldObject.parent).toBeNull();
    expect(disposed).toHaveBeenCalledOnce();
    expect(scene.setSelection).toHaveBeenLastCalledWith(null, []);
    expect(scene.dataset['geometryWorkerError']).toBeUndefined();
  });

  it('does not resurrect a hidden group from a late response while another group is visible', async () => {
    const scene = harness();
    const nodes = [
      ...pair(),
      ...pair().map((node) => ({ ...node, id: `other-${node.id}`, groupId: 'other' })),
    ];
    scene.update(nodes);
    const lateResponse = scene.workers[0]!.onmessage!;
    const oldRequest = scene.workers[0]!.requests[0]!;

    scene.update(nodes.map((node) => (node.groupId === 'g' ? { ...node, visible: false } : node)));
    lateResponse({
      data: evaluateGeometryRequest(oldRequest),
    } as MessageEvent<GeometryWorkerResponse>);
    expect(scene.workers[1]!.requests[0]!.operands.every((node) => node.groupId === 'other')).toBe(
      true,
    );
    scene.workers[1]!.completeNext();
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('ready'));

    expect([...scene.entries.keys()]).toEqual(['group:other']);
    expect(scene.root.children).toHaveLength(1);
    expect(scene.setSelection).toHaveBeenLastCalledWith('group:other', ['group:other']);
  });

  it('finishes all groups after a fatal Worker error instead of waiting on the dead Worker', async () => {
    const scene = harness();
    const nodes = [
      ...pair(),
      ...pair().map((node) => ({ ...node, id: `other-${node.id}`, groupId: 'other' })),
    ];
    scene.update(nodes);
    scene.workers[0]!.onerror?.({ message: 'Worker failed to load' } as ErrorEvent);

    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('error'));
    expect(scene.workers[0]!.terminated).toBe(true);
    expect(scene.entries.size).toBe(0);
    expect(scene.state().groups.map((group) => group.status)).toEqual(['error', 'error']);
    expect(() => scene.export(nodes)).toThrow('STL недоступен');

    scene.update(nodes.map((node) => ({ ...node, color: '#ff0000' })));
    scene.workers[1]!.completeNext();
    await vi.waitFor(() => expect(scene.workers[1]!.requests).toHaveLength(1));
    scene.workers[1]!.completeNext();
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('ready'));
    expect(scene.dataset['geometryWorkerError']).toBeUndefined();
  });

  it('retains only the last confirmed mesh on failure and retries the same document without a new edit', async () => {
    const scene = harness();
    const nodes = pair();
    scene.update(nodes);
    scene.workers[0]!.completeNext();
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('ready'));
    const previous = scene.entries.get('group:g')!;
    const disposed = vi.spyOn((previous.object.children[0] as THREE.Mesh).geometry, 'dispose');
    const edited = nodes.map((node) => ({
      ...node,
      dimensions: { ...node.dimensions, width: 40 },
    }));
    const sourceBefore = JSON.stringify(edited);
    scene.update(edited);
    expect(scene.state().groups[0]!.status).toBe('pending');
    expect(() => scene.export(edited)).toThrow('STL недоступен');
    scene.workers[1]!.onerror?.({ message: 'Failed calculation' } as ErrorEvent);
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('stale'));
    expect(scene.entries.get('group:g')).toBe(previous);
    expect(disposed).not.toHaveBeenCalled();
    expect(() => scene.export(edited)).toThrow('STL недоступен');
    expect(scene.state().groups[0]!.message).toBe('Failed calculation');

    scene.runtime.retryGeometry();
    expect(scene.workers).toHaveLength(3);
    expect(scene.state().groups[0]!.status).toBe('pending');
    scene.workers[2]!.completeNext();
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('ready'));
    expect(disposed).toHaveBeenCalledOnce();
    expect(scene.entries.get('group:g')!.node.dimensions.width).toBe(40);
    expect(scene.dataset['geometryWorkerError']).toBeUndefined();
    expect(JSON.stringify(edited)).toBe(sourceBefore);
    expect(scene.setSelection).toHaveBeenLastCalledWith('group:g', ['group:g']);
  });

  it.each(['creation', 'timeout', 'malformed'] as const)(
    'shows a recoverable error for %s failure without ever creating operand proxies',
    async (mode) => {
      const scene = harness({
        creationFails: mode === 'creation',
        timeoutMs: mode === 'timeout' ? 5 : 30_000,
      });
      const nodes = pair();
      scene.update(nodes);
      if (mode === 'malformed') {
        const worker = scene.workers[0]!;
        const valid = evaluateGeometryRequest(worker.requests[0]!);
        if (!valid.ok) throw new Error('Fixture failed');
        worker.onmessage?.({
          data: { ...valid, normals: new ArrayBuffer(0) },
        } as MessageEvent<GeometryWorkerResponse>);
      }
      await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('error'));
      expect(scene.entries.size).toBe(0);
      expect(scene.root.children).toHaveLength(0);
      expect(scene.setSelection).toHaveBeenLastCalledWith(null, []);
      const markup = renderToStaticMarkup(
        createElement(GeometryResultNotice, { state: scene.state(), onRetry: vi.fn() }),
      );
      expect(markup).toContain('role="alert"');
      expect(markup).toContain('Повторить');
      expect(markup).toContain('Исходные детали не потеряны');
    },
  );

  it('keeps mixed ready/error states and never exports a partially calculated scene', async () => {
    const scene = harness();
    const nodes = [
      ...pair(),
      ...pair().map((node) => ({ ...node, id: `other-${node.id}`, groupId: 'other' })),
    ];
    scene.update(nodes);
    scene.workers[0]!.completeNext();
    await vi.waitFor(() => expect(scene.workers[0]!.requests).toHaveLength(1));
    scene.workers[0]!.onerror?.({ message: 'Second group failed' } as ErrorEvent);
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('error'));
    expect(scene.state().groups.map((group) => group.status)).toEqual(['ready', 'error']);
    expect(scene.entries.size).toBe(1);
    expect(() => scene.export(nodes)).toThrow('STL недоступен');
    scene.update(nodes.filter((node) => node.groupId === 'g'));
    scene.workers[1]!.completeNext();
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('ready'));
    expect(scene.state().groups).toHaveLength(1);
  });

  it('clears stale geometry and errors on hide, and ignores a cancelled retry response', async () => {
    const scene = harness();
    const nodes = pair();
    scene.update(nodes);
    scene.workers[0]!.completeNext();
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('ready'));
    scene.update(nodes.map((node) => ({ ...node, color: '#0000ff' })));
    scene.workers[1]!.onerror?.({ message: 'Failed' } as ErrorEvent);
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('stale'));
    scene.runtime.retryGeometry();
    const late = scene.workers[2]!.onmessage!;
    const request = scene.workers[2]!.requests[0]!;
    scene.update(nodes.map((node) => ({ ...node, visible: false })));
    late({ data: evaluateGeometryRequest(request) } as MessageEvent<GeometryWorkerResponse>);
    await Promise.resolve();
    expect(scene.dataset['geometryWorkerState']).toBe('idle');
    expect(scene.dataset['geometryWorkerError']).toBeUndefined();
    expect(scene.entries.size).toBe(0);
    expect(scene.state().groups).toHaveLength(0);
  });

  it('treats a confirmed empty result separately from error, exports no triangles, and never resurrects an older mesh', async () => {
    const scene = harness();
    const nodes = pair().map((node, index) => ({
      ...node,
      operation: index ? ('hole' as const) : ('solid' as const),
      groupOperation: 'difference' as const,
    }));
    scene.update(nodes);
    scene.workers[0]!.completeNext();
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('valid-empty'));
    expect(scene.export(nodes).getUint32(80, true)).toBe(0);
    expect(
      renderToStaticMarkup(
        createElement(GeometryResultNotice, { state: scene.state(), onRetry: vi.fn() }),
      ),
    ).toContain('Вырезано всё');
    scene.update(nodes.map((node) => ({ ...node, color: '#0000ff' })));
    scene.workers[1]!.onerror?.({ message: 'Failed' } as ErrorEvent);
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('error'));
    expect(scene.entries.size).toBe(0);
  });

  it('exports exactly the confirmed triangles and committed transforms, not a pointer preview or an unseen document edit', async () => {
    const scene = harness();
    const nodes = pair();
    scene.update(nodes);
    scene.workers[0]!.completeNext();
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('ready'));
    const object = scene.entries.get('group:g')!.object;
    const geometry = (object.children[0] as THREE.Mesh).geometry;
    const disposed = vi.spyOn(geometry, 'dispose');
    const stl = scene.export(nodes);
    expect(stl.getUint32(80, true)).toBe(geometry.getAttribute('position').count / 3);
    object.scale.set(7, 7, 7);
    object.position.x += 123;
    expect(new Uint8Array(scene.export(nodes).buffer)).toEqual(new Uint8Array(stl.buffer));
    expect(disposed).not.toHaveBeenCalled();
    const next = {
      ...createEmptyThreeDDocument(),
      nodes: nodes.map((node) => ({ ...node, color: '#0000ff' })),
    };
    expect(geometryResultIsCurrent(scene.state(), next)).toBe(false);
    expect(() => scene.runtime.exportStl(next)).toThrow('STL недоступен');
  });
});
