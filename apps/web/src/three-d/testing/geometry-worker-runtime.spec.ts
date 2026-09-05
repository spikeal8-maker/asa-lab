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
import { disposeObject } from '../viewport/geometry';

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

function harness() {
  const document = createEmptyThreeDDocument();
  const workers: ControlledWorker[] = [];
  const client = new GeometryWorkerClient(() => {
    const worker = new ControlledWorker();
    workers.push(worker);
    return worker;
  });
  const root = new THREE.Group();
  const entries = new Map<string, { object: THREE.Group; node: ThreeDNode }>();
  const dataset: Record<string, string> = {};
  const setSelection = vi.fn();
  // Exercise the real document reconciliation and asynchronous scene updates
  // with Three.js objects, without creating a GPU context or animation loop.
  const runtime = Object.create(SceneRuntime.prototype) as SceneRuntime;
  Object.assign(runtime, {
    scene: new THREE.Scene(),
    container: { dataset },
    entries,
    booleanRoot: root,
    geometryWorker: client,
    documentSignature: '',
    gridSignature: JSON.stringify(document.grid),
    manipulator: { setGridSnap: vi.fn(), setSelection },
    syncRuler: vi.fn(),
  });
  cleanup.push(() => {
    client.dispose();
    disposeObject(root);
  });
  return {
    root,
    entries,
    dataset,
    workers,
    setSelection,
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

describe('Boolean Worker scene lifecycle', () => {
  afterEach(() => cleanup.splice(0).forEach((dispose) => dispose()));

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
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('ready'));

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

    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('fallback'));
    expect(scene.workers[0]!.terminated).toBe(true);
    expect(scene.entries.size).toBe(2);

    scene.update(nodes.map((node) => ({ ...node, color: '#ff0000' })));
    scene.workers[1]!.completeNext();
    await vi.waitFor(() => expect(scene.workers[1]!.requests).toHaveLength(1));
    scene.workers[1]!.completeNext();
    await vi.waitFor(() => expect(scene.dataset['geometryWorkerState']).toBe('ready'));
    expect(scene.dataset['geometryWorkerError']).toBeUndefined();
  });
});
