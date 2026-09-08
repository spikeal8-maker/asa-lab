import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import type {
  PrimitiveKind,
  ShapeOperation,
  ThreeDDimensions,
  ThreeDDocument,
  ThreeDNode,
  ThreeDTransform,
} from '@asa-lab/three-d';
import { createThreeDNode } from '@asa-lab/three-d';
import {
  DirectManipulator,
  type DirectManipulationCommit,
  type DirectManipulationEntry,
} from './DirectManipulator';
import { createBooleanMeshFromEvaluation } from './csg';
import { applyNodeTransform, createNodeObject, disposeObject } from './geometry';
import { addCadSceneLights } from './cad-appearance';
import { TouchNavigation } from './TouchNavigation';
import { directManipulationReplacements, runtimeSelectionKeys } from '../selection-model';
import { commonResultTransform, dimensionMatrix } from './result-transform';
import { GeometryWorkerClient } from '../geometry/worker-client';
import {
  geometryResultIsCurrent,
  geometryResultStatus,
  type BooleanGroupResultState,
  type GeometryResultState,
} from '../geometry/result-state';

export interface SceneRuntimeCallbacks {
  readonly onSelect: (nodeId: string | null, additive: boolean) => void;
  readonly onTransformCommit: (
    nodeId: string,
    transform: ThreeDTransform,
    dimensions?: ThreeDDimensions,
    basis?: DirectManipulationCommit['basis'],
  ) => void;
  readonly onTransformCommitMany: (commits: readonly DirectManipulationCommit[]) => void;
  readonly onWebGlError: (message: string) => void;
  readonly onCameraChange?: (state: CameraViewState) => void;
  readonly onGeometryStateChange?: (state: GeometryResultState) => void;
}

export type StandardCameraView = 'home' | 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

export interface CameraViewState {
  readonly yaw: number;
  readonly pitch: number;
}

export interface CameraDirection {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface SceneEntry extends DirectManipulationEntry {
  readonly object: THREE.Group;
  readonly node: ThreeDNode;
  readonly signature: string;
}

interface PlacementPreview {
  readonly primitive: PrimitiveKind;
  readonly operation: ShapeOperation;
  readonly height: number;
  readonly object: THREE.Group;
}

function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}

// Matches the default 200 x 200 mm workplane framing of the owner reference:
// a 45-degree elevation with the far and near edges fully visible.
const HOME_CAMERA_POSITION = new THREE.Vector3(0, 181, 181);
const HOME_CAMERA_FOV = 44.6;
const ORTHOGONAL_CAMERA_DISTANCE = 360;

function createGridLines(
  width: number,
  depth: number,
  step: number,
  color: string,
  opacity: number,
  height: number,
): THREE.LineSegments {
  const points: THREE.Vector3[] = [];
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const horizontalCount = Math.max(1, Math.floor(width / step));
  const verticalCount = Math.max(1, Math.floor(depth / step));
  for (let index = 0; index <= horizontalCount; index += 1) {
    const x = -halfWidth + Math.min(width, index * step);
    points.push(new THREE.Vector3(x, height, -halfDepth), new THREE.Vector3(x, height, halfDepth));
  }
  for (let index = 0; index <= verticalCount; index += 1) {
    const z = -halfDepth + Math.min(depth, index * step);
    points.push(new THREE.Vector3(-halfWidth, height, z), new THREE.Vector3(halfWidth, height, z));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
  });
  return new THREE.LineSegments(geometry, material);
}

function createWorkplaneLabel(
  text: string,
  width: number,
  depth: number,
  fontSize: number,
  italic = false,
): THREE.Mesh {
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = 1536;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#68c1d7';
    context.font = `${italic ? 'italic ' : ''}700 ${fontSize}px Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 7, canvas.width - 48);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.46,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const label = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
  label.rotation.x = -Math.PI / 2;
  label.renderOrder = 4;
  return label;
}

export class SceneRuntime {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly orbit: OrbitControls;
  private readonly manipulator: DirectManipulator;
  private readonly touchNavigation: TouchNavigation;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly entries = new Map<string, SceneEntry>();
  private readonly geometryWorker = new GeometryWorkerClient();
  private readonly deferredResults = new Map<string, { apply: () => void; dispose: () => void }>();
  private readonly booleanRoot = new THREE.Group();
  private readonly rulerRoot = new THREE.Group();
  private placementPreview: PlacementPreview | null = null;
  private documentSignature = '';
  private gridSignature = '';
  private readonly gridRoot = new THREE.Group();
  private gridSnap = 1;
  private workplaneY = 0;
  private animationFrame = 0;
  private readonly resizeObserver: ResizeObserver;
  private readonly onCameraChange: ((state: CameraViewState) => void) | undefined;
  private selectedIds: readonly string[] = [];
  private currentDocument: ThreeDDocument | null = null;
  private geometryState: GeometryResultState | null = null;
  private readonly onGeometryStateChange: SceneRuntimeCallbacks['onGeometryStateChange'];

  private readonly publishCameraState = (): void => {
    const values = [
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
      this.orbit.target.x,
      this.orbit.target.y,
      this.orbit.target.z,
    ].map((value) => Math.round(value * 1000) / 1000);
    this.container.dataset['cameraState'] = values.join(',');
    const offset = this.camera.position.clone().sub(this.orbit.target);
    this.onCameraChange?.({
      yaw: THREE.MathUtils.radToDeg(Math.atan2(offset.x, offset.z)),
      pitch: THREE.MathUtils.radToDeg(Math.atan2(offset.y, Math.hypot(offset.x, offset.z))),
    });
  };

  constructor(
    private readonly container: HTMLElement,
    callbacks: SceneRuntimeCallbacks,
  ) {
    this.onCameraChange = callbacks.onCameraChange;
    this.onGeometryStateChange = callbacks.onGeometryStateChange;
    this.container.dataset['geometryWorkerState'] = 'idle';
    this.scene.background = new THREE.Color('#fafafa');
    this.scene.fog = new THREE.Fog('#fafafa', 560, 980);
    this.camera = new THREE.PerspectiveCamera(HOME_CAMERA_FOV, 1, 0.5, 2400);
    this.camera.position.copy(HOME_CAMERA_POSITION);

    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch {
      const message = 'WebGL2 недоступен. Включите аппаратное ускорение браузера.';
      callbacks.onWebGlError(message);
      throw new Error(message);
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.98;
    this.renderer.domElement.className = 'asa3d-canvas';
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', 'Рабочая область 3D-моделирования');
    this.container.append(this.renderer.domElement);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.screenSpacePanning = true;
    this.orbit.minPolarAngle = 0.001;
    this.orbit.maxPolarAngle = Math.PI - 0.001;
    this.orbit.minDistance = 35;
    this.orbit.maxDistance = 1200;
    // Tinkercad-style desktop navigation: the primary button belongs only to
    // object interaction and marquee selection. Camera gestures never steal it.
    this.orbit.mouseButtons.LEFT = null;
    this.orbit.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    this.orbit.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    this.orbit.addEventListener('change', this.publishCameraState);
    this.container.dataset['mouseNavigation'] = 'left-select;right-orbit;middle-pan;wheel-zoom';

    this.manipulator = new DirectManipulator(
      this.scene,
      this.camera,
      this.renderer.domElement,
      this.container,
      this.orbit,
      () => this.entries,
      {
        onSelect: callbacks.onSelect,
        onCommit: (nodeId, transform, dimensions, basis) => {
          this.acceptPreview([{ nodeId, transform, dimensions, basis }]);
          callbacks.onTransformCommit(nodeId, transform, dimensions, basis);
        },
        onCommitMany: (commits) => {
          this.acceptPreview(commits);
          callbacks.onTransformCommitMany(commits);
        },
        onInteractionEnd: () => this.flushDeferredResults(),
      },
    );

    this.touchNavigation = new TouchNavigation(this.container, this.renderer.domElement, {
      targetsModel: (x, y) => this.manipulator.touchTargetsModel(x, y),
      cancelModelGesture: () => this.manipulator.cancelTouchGesture(),
      clearSelection: () => this.manipulator.clearTouchSelection(),
      orbit: (dx, dy) => this.orbitBy(dx, dy),
      panZoom: (dx, dy, scale) => this.panZoomBy(dx, dy, scale),
    });
    this.container.dataset['touchNavigation'] = 'model-move;empty-orbit;two-finger-pan-zoom';

    addCadSceneLights(this.scene);
    this.scene.add(this.gridRoot, this.booleanRoot, this.rulerRoot);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.publishCameraState();
    this.animate();
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private animate = (): void => {
    this.animationFrame = window.requestAnimationFrame(this.animate);
    this.orbit.update();
    this.manipulator.update();
    this.renderer.render(this.scene, this.camera);
  };

  setDocument(document: ThreeDDocument, selectedIds: readonly string[]): void {
    this.currentDocument = document;
    this.selectedIds = selectedIds;
    this.gridSnap = document.grid.snap;
    this.manipulator.setGridSnap(document.grid.snap);
    const gridSignature = JSON.stringify(document.grid);
    if (gridSignature !== this.gridSignature) {
      this.gridSignature = gridSignature;
      this.syncGrid(document);
    }
    const documentSignature = JSON.stringify(document.nodes);
    const documentChanged = documentSignature !== this.documentSignature;
    if (documentChanged) {
      this.clearDeferredResults();
      this.manipulator.cancelDrag();
    }
    this.documentSignature = documentSignature;
    const groupedIds = new Set(
      document.nodes.filter((node) => node.groupId).map((node) => node.id),
    );
    const groupEntryIds = new Set(
      document.nodes
        .filter((node) => node.groupId && node.visible)
        .map((node) => `group:${node.groupId as string}`),
    );
    const incomingIds = new Set([
      ...document.nodes.filter((node) => !groupedIds.has(node.id)).map((node) => node.id),
      ...groupEntryIds,
    ]);
    for (const [id, entry] of this.entries) {
      if (incomingIds.has(id)) continue;
      entry.object.parent?.remove(entry.object);
      disposeObject(entry.object);
      this.entries.delete(id);
    }
    for (const node of document.nodes) {
      if (node.groupId) continue;
      const signature = JSON.stringify(node);
      const existing = this.entries.get(node.id);
      if (existing?.signature === signature) continue;
      if (existing) {
        this.scene.remove(existing.object);
        disposeObject(existing.object);
      }
      const object = createNodeObject(node);
      this.scene.add(object);
      this.entries.set(node.id, { object, node, signature });
    }
    if (documentChanged) {
      if (groupEntryIds.size > 0) {
        const generationId = this.geometryWorker.beginGeneration();
        void this.syncBooleanGroups(document, generationId);
      } else {
        this.geometryWorker.cancelActiveGeneration();
        this.publishGeometryState({ documentSignature, groups: [] });
        delete this.container.dataset['geometryEngine'];
      }
    }
    this.syncRuler(document, selectedIds);
    this.syncRuntimeSelection();
  }

  private acceptPreview(commits: readonly DirectManipulationCommit[]): void {
    if (!this.currentDocument) return;
    const replacements = new Map(
      directManipulationReplacements(this.currentDocument, commits).map((node) => [node.id, node]),
    );
    // The same reducer feeds the controller's one undo command. Reconcile now,
    // before a late result or the next pointerdown can replace the released pose.
    this.setDocument(
      {
        ...this.currentDocument,
        nodes: this.currentDocument.nodes.map((node) => replacements.get(node.id) ?? node),
      },
      this.selectedIds,
    );
  }

  private clearDeferredResults(): void {
    for (const result of this.deferredResults.values()) result.dispose();
    this.deferredResults.clear();
  }

  private flushDeferredResults(): void {
    for (const [id, result] of this.deferredResults) {
      if (this.manipulator.isDragging(id)) continue;
      this.deferredResults.delete(id);
      result.apply();
    }
  }

  private applyAfterGesture(entryId: string, apply: () => void, dispose: () => void): void {
    if (this.manipulator.isDragging(entryId)) {
      this.deferredResults.get(entryId)?.dispose();
      this.deferredResults.set(entryId, { apply, dispose });
    } else apply();
  }

  private syncPendingTransform(entry: SceneEntry, nodes: readonly ThreeDNode[]): void {
    const previousNodes = JSON.parse(entry.signature) as ThreeDNode[];
    const delta = commonResultTransform(previousNodes, nodes);
    applyNodeTransform(entry.object, entry.node);
    if (delta) {
      const matrix = delta.multiply(
        dimensionMatrix(entry.node.transform, { width: 1, height: 1, depth: 1 }),
      );
      matrix.decompose(entry.object.position, entry.object.quaternion, entry.object.scale);
    }
    entry.object.updateMatrixWorld(true);
  }

  private syncRuntimeSelection(): void {
    const document = this.currentDocument;
    if (!document) return;
    const selectedNodes = this.selectedIds
      .map((id) => document.nodes.find((node) => node.id === id))
      .filter((node): node is ThreeDNode => Boolean(node));
    // A boolean result is one scene object even though the editable document
    // keeps every source primitive. Collapse every selected group's members to
    // its runtime proxy independently. Without this, selecting two boolean
    // results produced four hidden primitive ids, so the manipulator received
    // an empty selection and showed no footprint or movement feedback.
    const runtimeSelectionIds = runtimeSelectionKeys(selectedNodes).filter((id) =>
      this.entries.has(id),
    );
    this.setSelection(runtimeSelectionIds.at(-1) ?? null, runtimeSelectionIds);
  }

  private async syncBooleanGroups(document: ThreeDDocument, generationId: number): Promise<void> {
    this.container.dataset['geometryEngine'] = 'legacy-bsp@1';
    const groups = new Map<string, ThreeDNode[]>();
    for (const node of document.nodes) {
      if (!node.groupId) continue;
      const group = groups.get(node.groupId) ?? [];
      group.push(node);
      groups.set(node.groupId, group);
    }
    const states: BooleanGroupResultState[] = [...groups]
      .filter(([, nodes]) => nodes.some((node) => node.visible))
      .map(([groupId, nodes], index) => ({
        groupId,
        label: `Группа ${index + 1} (${nodes.length} деталей)`,
        status: 'pending',
      }));
    const documentSignature = JSON.stringify(document.nodes);
    const publish = (): void =>
      this.publishGeometryState({
        documentSignature,
        groups: [...states],
      });
    // All selected results must retain the same committed pose before the
    // first asynchronous group evaluation yields control to another frame.
    for (const [groupId, nodes] of groups) {
      const retained = this.entries.get(`group:${groupId}`);
      if (retained && nodes.some((node) => node.visible))
        this.syncPendingTransform(retained, nodes);
    }
    publish();
    for (const [groupId, nodes] of groups) {
      // setDocument already removes fully hidden groups and their selection
      // proxies. Do not let another group's pending work recreate them.
      if (!nodes.some((node) => node.visible)) continue;
      const stateIndex = states.findIndex((state) => state.groupId === groupId);
      const entryId = `group:${groupId}`;
      const operation = nodes[0]?.groupOperation ?? 'union';
      let rendered: THREE.Object3D | null;
      try {
        const evaluation = await this.geometryWorker.evaluate(generationId, nodes, operation);
        if (!this.geometryWorker.isCurrent(generationId)) return;
        rendered = createBooleanMeshFromEvaluation(evaluation, nodes);
      } catch (error) {
        if (!this.geometryWorker.isCurrent(generationId)) return;
        // Never turn failed CSG into an apparently successful pile of operands.
        // Only an already confirmed result may remain, explicitly marked stale.
        this.applyAfterGesture(
          entryId,
          () => {
            if (!this.geometryWorker.isCurrent(generationId)) return;
            states[stateIndex] = {
              ...states[stateIndex]!,
              status: this.entries.has(entryId) ? 'stale' : 'error',
              message:
                error instanceof Error
                  ? error.message.slice(0, 240)
                  : 'Unknown Geometry Worker error.',
            };
            const previous = this.entries.get(entryId);
            if (previous) applyNodeTransform(previous.object, previous.node);
            publish();
            this.syncRuntimeSelection();
          },
          () => {},
        );
        continue;
      }
      const apply = (): void => {
        if (!this.geometryWorker.isCurrent(generationId)) {
          if (rendered) disposeObject(rendered);
          return;
        }
        states[stateIndex] = { ...states[stateIndex]!, status: rendered ? 'ready' : 'valid-empty' };
        const existing = this.entries.get(entryId);
        if (existing) {
          existing.object.parent?.remove(existing.object);
          disposeObject(existing.object);
          this.entries.delete(entryId);
        }
        if (!rendered) {
          publish();
          this.syncRuntimeSelection();
          return;
        }
        const bounds = new THREE.Box3().setFromObject(rendered);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const proxyNode: ThreeDNode = {
          ...nodes[0]!,
          id: entryId,
          name: `Группа (${nodes.length})`,
          operation: 'solid',
          visible: true,
          transform: {
            position: { x: center.x, y: center.y, z: center.z },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
          dimensions: { width: size.x, depth: size.z, height: size.y },
          groupId,
        };
        const wrapper = new THREE.Group();
        wrapper.userData['nodeId'] = entryId;
        wrapper.name = proxyNode.name;
        rendered.position.sub(center);
        rendered.traverse((child) => {
          child.userData['nodeId'] = entryId;
        });
        wrapper.position.copy(center);
        wrapper.add(rendered);
        this.booleanRoot.add(wrapper);
        this.entries.set(entryId, {
          object: wrapper,
          node: proxyNode,
          signature: JSON.stringify(nodes),
        });
        publish();
        this.syncRuntimeSelection();
      };
      this.applyAfterGesture(entryId, apply, () => {
        if (rendered) disposeObject(rendered);
      });
    }
  }

  private publishGeometryState(state: GeometryResultState): void {
    this.geometryState = state;
    const status = geometryResultStatus(state);
    this.container.dataset['geometryWorkerState'] = status === 'pending' ? 'evaluating' : status;
    const errors = state.groups.flatMap((group) => (group.message ? [group.message] : []));
    if (errors.length)
      this.container.dataset['geometryWorkerError'] = errors.join('; ').slice(0, 480);
    else delete this.container.dataset['geometryWorkerError'];
    this.container.dataset['geometryGroupStates'] = JSON.stringify(state.groups);
    this.onGeometryStateChange?.(state);
  }

  retryGeometry(): void {
    if (
      !this.currentDocument ||
      !this.geometryState?.groups.some(
        (group) => group.status === 'stale' || group.status === 'error',
      )
    )
      return;
    void this.syncBooleanGroups(this.currentDocument, this.geometryWorker.beginGeneration());
  }

  exportStl(document: ThreeDDocument): DataView<ArrayBuffer> {
    // Check the caller's document too: React may not have delivered a new edit
    // to the runtime yet. A disabled menu alone cannot protect that boundary.
    if (!geometryResultIsCurrent(this.geometryState, document)) {
      throw new Error('STL недоступен: дождитесь успешного расчёта текущего проекта.');
    }
    const scene = new THREE.Scene();
    for (const entry of this.entries.values()) {
      if (!entry.node.visible || entry.node.operation === 'hole') continue;
      const object = entry.object.clone(true);
      // A pointer preview is not a committed edit. Export confirmed transforms.
      applyNodeTransform(object, entry.node);
      scene.add(object);
    }
    scene.updateMatrixWorld(true);
    // Clones share GPU resources with the viewport; do not dispose them here.
    return new STLExporter().parse(scene, { binary: true });
  }

  private syncRuler(document: ThreeDDocument, selectedIds: readonly string[]): void {
    this.clearRuler();
    if (!document.ruler.visible) return;
    const origin = new THREE.Vector3(
      document.ruler.origin.x,
      document.ruler.origin.y + 0.08,
      document.ruler.origin.z,
    );
    const addAxis = (direction: THREE.Vector3, color: string, length: number): void => {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        origin,
        origin.clone().add(direction.multiplyScalar(length)),
      ]);
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color, depthTest: false, toneMapped: false }),
      );
      line.renderOrder = 25;
      this.rulerRoot.add(line);
    };
    addAxis(new THREE.Vector3(1, 0, 0), '#d63d3d', Math.min(70, document.grid.width / 2));
    addAxis(new THREE.Vector3(0, 0, 1), '#268f72', Math.min(70, document.grid.depth / 2));
    addAxis(new THREE.Vector3(0, 1, 0), '#2e72c7', 45);
    if (selectedIds.length > 0) {
      const entryIds = new Set(
        selectedIds.map((id) => {
          const node = document.nodes.find((candidate) => candidate.id === id);
          return node?.groupId ? `group:${node.groupId}` : id;
        }),
      );
      [...entryIds]
        .map((id) => this.entries.get(id)?.object.position)
        .filter((point): point is THREE.Vector3 => Boolean(point))
        .forEach((point) => {
          const geometry = new THREE.BufferGeometry().setFromPoints([origin, point]);
          const line = new THREE.Line(
            geometry,
            new THREE.LineDashedMaterial({
              color: '#26343a',
              dashSize: 2,
              gapSize: 1,
              transparent: true,
              opacity: 0.75,
            }),
          );
          line.computeLineDistances();
          this.rulerRoot.add(line);
        });
    }
  }

  private clearRuler(): void {
    this.rulerRoot.traverse((child) => {
      const disposable = child as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };
      disposable.geometry?.dispose();
      if (Array.isArray(disposable.material)) {
        disposable.material.forEach((material) => material.dispose());
      } else {
        disposable.material?.dispose();
      }
    });
    this.rulerRoot.clear();
  }

  private syncGrid(document: ThreeDDocument): void {
    this.clearGrid();
    if (!document.grid.visible) return;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(document.grid.width, document.grid.depth),
      new THREE.MeshBasicMaterial({
        color: '#f4fafc',
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.03;
    this.gridRoot.add(plane);

    const maximumDimension = Math.max(document.grid.width, document.grid.depth);
    const fineStep = Math.max(document.grid.snap, maximumDimension / 400);
    this.gridRoot.add(
      createGridLines(document.grid.width, document.grid.depth, fineStep, '#a9cbd1', 0.17, 0.008),
    );
    this.gridRoot.add(
      createGridLines(
        document.grid.width,
        document.grid.depth,
        Math.max(10, document.grid.snap * 10),
        '#91b8c0',
        0.24,
        0.014,
      ),
    );

    const halfWidth = document.grid.width / 2;
    const halfDepth = document.grid.depth / 2;
    const edgeBand = Math.max(1.2, Math.min(document.grid.width, document.grid.depth) * 0.012);
    const edgeMaterial = (): THREE.MeshBasicMaterial =>
      new THREE.MeshBasicMaterial({
        color: '#75cadb',
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      });
    const addEdgeBand = (width: number, depth: number, x: number, z: number): void => {
      const band = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), edgeMaterial());
      band.rotation.x = -Math.PI / 2;
      band.position.set(x, 0.017, z);
      band.renderOrder = 2;
      this.gridRoot.add(band);
    };
    addEdgeBand(document.grid.width, edgeBand, 0, -halfDepth + edgeBand / 2);
    addEdgeBand(document.grid.width, edgeBand, 0, halfDepth - edgeBand / 2);
    addEdgeBand(edgeBand, document.grid.depth - edgeBand * 2, -halfWidth + edgeBand / 2, 0);
    addEdgeBand(edgeBand, document.grid.depth - edgeBand * 2, halfWidth - edgeBand / 2, 0);

    const borderGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-halfWidth, 0.022, -halfDepth),
      new THREE.Vector3(halfWidth, 0.022, -halfDepth),
      new THREE.Vector3(halfWidth, 0.022, halfDepth),
      new THREE.Vector3(-halfWidth, 0.022, halfDepth),
      new THREE.Vector3(-halfWidth, 0.022, -halfDepth),
    ]);
    this.gridRoot.add(
      new THREE.Line(
        borderGeometry,
        new THREE.LineBasicMaterial({
          color: '#41b8cf',
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    );

    const horizontalAxisGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-halfWidth, 0.021, 0),
      new THREE.Vector3(halfWidth, 0.021, 0),
    ]);
    const depthAxisGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.021, -halfDepth),
      new THREE.Vector3(0, 0.021, halfDepth),
    ]);
    this.gridRoot.add(
      new THREE.Line(
        horizontalAxisGeometry,
        new THREE.LineBasicMaterial({
          color: '#829da3',
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    );
    this.gridRoot.add(
      new THREE.Line(
        depthAxisGeometry,
        new THREE.LineBasicMaterial({
          color: '#619895',
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    );

    const labelDepth = Math.min(10, Math.max(6, document.grid.depth * 0.06));
    const titleWidth = Math.min(108, document.grid.width * 0.56);
    const titleLabel = createWorkplaneLabel(
      'Рабоч. плоск-ть',
      titleWidth,
      Math.max(12, document.grid.depth * 0.082),
      168,
      true,
    );
    titleLabel.position.set(-halfWidth + titleWidth / 2 + 2, 0.03, halfDepth - labelDepth);
    this.gridRoot.add(titleLabel);

    const unitsWidth = Math.min(48, document.grid.width * 0.27);
    const unitsLabel = createWorkplaneLabel(
      'Миллиметры',
      unitsWidth,
      Math.max(8, document.grid.depth * 0.06),
      150,
    );
    unitsLabel.position.set(halfWidth - unitsWidth / 2 + 2.5, 0.03, halfDepth - labelDepth);
    this.gridRoot.add(unitsLabel);
  }

  private clearGrid(): void {
    this.gridRoot.traverse((child) => {
      const disposable = child as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };
      disposable.geometry?.dispose();
      const disposeMaterial = (material: THREE.Material): void => {
        if (material instanceof THREE.MeshBasicMaterial && material.map) material.map.dispose();
        material.dispose();
      };
      if (Array.isArray(disposable.material)) disposable.material.forEach(disposeMaterial);
      else if (disposable.material) disposeMaterial(disposable.material);
    });
    this.gridRoot.clear();
  }

  setSelection(nodeId: string | null, nodeIds: readonly string[] = nodeId ? [nodeId] : []): void {
    this.manipulator.setSelection(nodeId, nodeIds);
  }

  setAdditiveSelection(value: boolean): void {
    this.manipulator.setAdditiveSelection(value);
  }

  setWorkplaneY(value: number): void {
    this.workplaneY = Number.isFinite(value) ? value : 0;
    this.gridRoot.position.y = this.workplaneY;
    this.manipulator.setWorkplaneY(this.workplaneY);
    this.container.dataset['workplaneY'] = String(this.workplaneY);
  }

  workplanePoint(clientX: number, clientY: number): { x: number; y: number; z: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const point = new THREE.Vector3();
    if (
      !this.raycaster.ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.workplaneY),
        point,
      )
    )
      return null;
    return { x: snap(point.x, this.gridSnap), y: this.workplaneY, z: snap(point.z, this.gridSnap) };
  }

  setPlacementPreview(
    primitive: PrimitiveKind,
    operation: ShapeOperation,
    clientX: number,
    clientY: number,
  ): void {
    const point = this.workplanePoint(clientX, clientY);
    if (!point) {
      this.clearPlacementPreview();
      return;
    }
    if (
      !this.placementPreview ||
      this.placementPreview.primitive !== primitive ||
      this.placementPreview.operation !== operation
    ) {
      this.clearPlacementPreview();
      const node = {
        ...createThreeDNode(primitive, '__placement-preview__'),
        operation,
      };
      const object = createNodeObject(node);
      object.name = 'ASA placement preview';
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          material.transparent = true;
          material.opacity = operation === 'hole' ? 0.42 : 0.72;
          material.depthWrite = false;
        }
        child.castShadow = false;
        child.receiveShadow = false;
        child.renderOrder = 18;
      });
      this.scene.add(object);
      this.placementPreview = { primitive, operation, height: node.dimensions.height, object };
    }
    this.placementPreview.object.position.x = point.x;
    this.placementPreview.object.position.y = point.y + this.placementPreview.height / 2;
    this.placementPreview.object.position.z = point.z;
    this.placementPreview.object.updateMatrixWorld(true);
    this.container.dataset['placementPreview'] =
      `${operation}:${primitive}:${point.x}:${point.y}:${point.z}`;
  }

  clearPlacementPreview(): void {
    if (this.placementPreview) {
      this.scene.remove(this.placementPreview.object);
      disposeObject(this.placementPreview.object);
      this.placementPreview = null;
    }
    delete this.container.dataset['placementPreview'];
  }

  setView(view: StandardCameraView): void {
    const position = {
      home: HOME_CAMERA_POSITION,
      top: new THREE.Vector3(0, ORTHOGONAL_CAMERA_DISTANCE, 0.001),
      bottom: new THREE.Vector3(0, -ORTHOGONAL_CAMERA_DISTANCE, 0.001),
      front: new THREE.Vector3(0, 95, ORTHOGONAL_CAMERA_DISTANCE),
      back: new THREE.Vector3(0, 95, -ORTHOGONAL_CAMERA_DISTANCE),
      left: new THREE.Vector3(-ORTHOGONAL_CAMERA_DISTANCE, 95, 0),
      right: new THREE.Vector3(ORTHOGONAL_CAMERA_DISTANCE, 95, 0),
    }[view];
    this.camera.position.copy(position);
    this.orbit.target.set(0, 0, 0);
    this.orbit.update();
  }

  setCameraDirection(direction: CameraDirection): void {
    const offset = new THREE.Vector3(direction.x, direction.y, direction.z);
    if (offset.lengthSq() < 0.000001) return;
    this.orbit.target.set(0, 0, 0);
    this.camera.position
      .copy(this.orbit.target)
      .add(offset.normalize().multiplyScalar(ORTHOGONAL_CAMERA_DISTANCE));
    this.camera.lookAt(this.orbit.target);
    this.orbit.update();
  }

  orbitBy(deltaX: number, deltaY: number): void {
    const offset = this.camera.position.clone().sub(this.orbit.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta -= deltaX * 0.012;
    spherical.phi = THREE.MathUtils.clamp(
      spherical.phi - deltaY * 0.012,
      this.orbit.minPolarAngle,
      this.orbit.maxPolarAngle,
    );
    offset.setFromSpherical(spherical);
    this.camera.position.copy(this.orbit.target).add(offset);
    this.camera.lookAt(this.orbit.target);
    this.orbit.update();
  }

  zoom(direction: 1 | -1): void {
    const offset = this.camera.position.clone().sub(this.orbit.target);
    offset.multiplyScalar(direction === 1 ? 0.82 : 1.22);
    this.camera.position.copy(this.orbit.target.clone().add(offset));
    this.orbit.update();
  }

  private panZoomBy(deltaX: number, deltaY: number, scale: number): void {
    const offset = this.camera.position.clone().sub(this.orbit.target);
    const distance = offset.length();
    const unitsPerPixel =
      (2 * distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) /
      Math.max(1, this.renderer.domElement.clientHeight);
    const shift = new THREE.Vector3(-deltaX, deltaY, 0)
      .applyQuaternion(this.camera.quaternion)
      .multiplyScalar(unitsPerPixel);
    this.orbit.target.add(shift);
    offset.setLength(
      THREE.MathUtils.clamp(distance * scale, this.orbit.minDistance, this.orbit.maxDistance),
    );
    this.camera.position.copy(this.orbit.target).add(offset);
    this.camera.lookAt(this.orbit.target);
    this.orbit.update();
  }

  fitToScene(): void {
    const box = new THREE.Box3();
    for (const entry of this.entries.values()) {
      if (entry.object.visible) box.expandByObject(entry.object);
    }
    if (box.isEmpty()) {
      this.setView('home');
      return;
    }
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const direction = this.camera.position.clone().sub(this.orbit.target).normalize();
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const distance = Math.max(55, (sphere.radius / Math.sin(halfFov)) * 1.35);
    this.orbit.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).add(direction.multiplyScalar(distance));
    this.orbit.update();
  }

  /**
   * The canvas holding a freshly drawn frame of the whole scene, for the
   * project card.
   *
   * Two things make this different from simply handing back the canvas. The
   * drawing buffer is not preserved — turning that on would cost every frame of
   * every session for a picture taken once a minute — so the frame is rendered
   * here and the caller must read it before yielding. And the learner's own
   * camera may be zoomed into a corner, which says nothing on a card, so the
   * scene is framed first and the camera put back afterwards.
   */
  captureFrame(): HTMLCanvasElement | null {
    if (this.manipulator.isDragging() || this.touchNavigation.isActive()) return null;
    const position = this.camera.position.clone();
    const target = this.orbit.target.clone();
    try {
      this.fitToScene();
      this.orbit.update();
      this.renderer.render(this.scene, this.camera);
    } finally {
      this.camera.position.copy(position);
      this.orbit.target.copy(target);
      this.orbit.update();
    }
    return this.renderer.domElement;
  }

  dispose(): void {
    this.clearDeferredResults();
    window.cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.touchNavigation.dispose();
    this.manipulator.dispose();
    this.geometryWorker.dispose();
    this.clearPlacementPreview();
    this.orbit.removeEventListener('change', this.publishCameraState);
    this.orbit.dispose();
    for (const entry of this.entries.values()) disposeObject(entry.object);
    this.entries.clear();
    this.clearGrid();
    this.clearRuler();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
