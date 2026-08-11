import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { ThreeDDocument, ThreeDTransform } from '@asa-lab/three-d';
import { createNodeObject, disposeObject } from './geometry';

export type TransformMode = 'translate' | 'rotate' | 'scale';

export interface SceneRuntimeCallbacks {
  readonly onSelect: (nodeId: string | null) => void;
  readonly onTransformCommit: (nodeId: string, transform: ThreeDTransform) => void;
  readonly onWebGlError: (message: string) => void;
}

interface SceneEntry {
  readonly object: THREE.Group;
  readonly signature: string;
}

function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export class SceneRuntime {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly orbit: OrbitControls;
  private readonly transform: TransformControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly entries = new Map<string, SceneEntry>();
  private readonly gridRoot = new THREE.Group();
  private selectionHelper: THREE.BoxHelper | null = null;
  private selectedId: string | null = null;
  private gridSnap = 1;
  private animationFrame = 0;
  private pointerStart: { x: number; y: number } | null = null;
  private transformDragging = false;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: SceneRuntimeCallbacks,
  ) {
    this.scene.background = new THREE.Color('#f5f7f8');
    this.scene.fog = new THREE.Fog('#f5f7f8', 360, 760);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 2000);
    this.camera.position.set(145, 115, 145);

    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch {
      callbacks.onWebGlError('WebGL2 недоступен. Включите аппаратное ускорение браузера.');
      throw new Error('WebGL2 is unavailable');
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'asa3d-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Рабочая область 3D-моделирования');
    this.container.append(this.renderer.domElement);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.screenSpacePanning = true;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.minDistance = 24;
    this.orbit.maxDistance = 900;

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setTranslationSnap(1);
    this.transform.setRotationSnap(THREE.MathUtils.degToRad(15));
    this.transform.setScaleSnap(0.1);
    this.transform.addEventListener('dragging-changed', (event) => {
      const dragging = Boolean(event.value);
      this.transformDragging = dragging;
      this.orbit.enabled = !dragging;
    });
    this.transform.addEventListener('mouseUp', () => this.commitSelectedTransform());
    this.scene.add(this.transform.getHelper());

    const hemisphere = new THREE.HemisphereLight('#ffffff', '#9aa8b2', 2.2);
    this.scene.add(hemisphere);
    const key = new THREE.DirectionalLight('#ffffff', 2.8);
    key.position.set(90, 170, 120);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#bce9ff', 0.75);
    fill.position.set(-120, 80, -70);
    this.scene.add(fill);
    this.scene.add(this.gridRoot);

    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.animate();
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.pointerStart = { x: event.clientX, y: event.clientY };
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const start = this.pointerStart;
    this.pointerStart = null;
    if (
      !start ||
      this.transformDragging ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5
    )
      return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = [...this.entries.values()].map((entry) => entry.object);
    const hit = this.raycaster.intersectObjects(meshes, true)[0];
    const nodeId =
      typeof hit?.object.userData['nodeId'] === 'string' ? hit.object.userData['nodeId'] : null;
    this.callbacks.onSelect(nodeId);
  };

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
    this.selectionHelper?.update();
    this.renderer.render(this.scene, this.camera);
  };

  setDocument(document: ThreeDDocument, selectedId: string | null): void {
    this.gridSnap = document.grid.snap;
    this.transform.setTranslationSnap(document.grid.snap);
    this.syncGrid(document);
    const incomingIds = new Set(document.nodes.map((node) => node.id));
    for (const [id, entry] of this.entries) {
      if (incomingIds.has(id)) continue;
      if (this.transform.object === entry.object) this.transform.detach();
      this.scene.remove(entry.object);
      disposeObject(entry.object);
      this.entries.delete(id);
    }
    for (const node of document.nodes) {
      const signature = JSON.stringify(node);
      const existing = this.entries.get(node.id);
      if (existing?.signature === signature) continue;
      if (existing) {
        if (this.transform.object === existing.object) this.transform.detach();
        this.scene.remove(existing.object);
        disposeObject(existing.object);
      }
      const object = createNodeObject(node);
      this.scene.add(object);
      this.entries.set(node.id, { object, signature });
    }
    this.setSelection(selectedId);
  }

  private syncGrid(document: ThreeDDocument): void {
    this.gridRoot.clear();
    if (!document.grid.visible) return;
    const divisions = Math.min(
      400,
      Math.max(2, Math.round(document.grid.width / document.grid.snap)),
    );
    const grid = new THREE.GridHelper(document.grid.width, divisions, '#4bb4ce', '#c5dce2');
    grid.material.transparent = true;
    grid.material.opacity = 0.72;
    this.gridRoot.add(grid);
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(document.grid.width, document.grid.depth),
      new THREE.MeshStandardMaterial({
        color: '#eaf8fb',
        roughness: 1,
        transparent: true,
        opacity: 0.48,
      }),
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = -0.025;
    plane.receiveShadow = true;
    this.gridRoot.add(plane);
  }

  setSelection(nodeId: string | null): void {
    this.selectedId = nodeId;
    this.transform.detach();
    if (this.selectionHelper) {
      this.scene.remove(this.selectionHelper);
      this.selectionHelper.dispose();
      this.selectionHelper = null;
    }
    if (!nodeId) return;
    const entry = this.entries.get(nodeId);
    if (!entry || !entry.object.visible) return;
    this.transform.attach(entry.object);
    this.selectionHelper = new THREE.BoxHelper(entry.object, '#006fb9');
    this.scene.add(this.selectionHelper);
  }

  setTransformMode(mode: TransformMode): void {
    this.transform.setMode(mode);
  }

  private commitSelectedTransform(): void {
    if (!this.selectedId) return;
    const object = this.entries.get(this.selectedId)?.object;
    if (!object) return;
    const toDegrees = 180 / Math.PI;
    this.callbacks.onTransformCommit(this.selectedId, {
      position: {
        x: snap(object.position.x, this.gridSnap),
        y: snap(object.position.y, this.gridSnap),
        z: snap(object.position.z, this.gridSnap),
      },
      rotation: {
        x: Math.round(object.rotation.x * toDegrees * 10) / 10,
        y: Math.round(object.rotation.y * toDegrees * 10) / 10,
        z: Math.round(object.rotation.z * toDegrees * 10) / 10,
      },
      scale: {
        x: Math.max(0.05, Math.round(object.scale.x * 100) / 100),
        y: Math.max(0.05, Math.round(object.scale.y * 100) / 100),
        z: Math.max(0.05, Math.round(object.scale.z * 100) / 100),
      },
    });
  }

  workplanePoint(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), point))
      return null;
    return { x: snap(point.x, this.gridSnap), z: snap(point.z, this.gridSnap) };
  }

  setView(view: 'home' | 'top' | 'front' | 'right'): void {
    const distance = view === 'home' ? 205 : 230;
    const position = {
      home: new THREE.Vector3(145, 115, 145),
      top: new THREE.Vector3(0, distance, 0.001),
      front: new THREE.Vector3(0, 70, distance),
      right: new THREE.Vector3(distance, 70, 0),
    }[view];
    this.camera.position.copy(position);
    this.orbit.target.set(0, 0, 0);
    this.orbit.update();
  }

  zoom(direction: 1 | -1): void {
    const offset = this.camera.position.clone().sub(this.orbit.target);
    offset.multiplyScalar(direction === 1 ? 0.82 : 1.22);
    this.camera.position.copy(this.orbit.target.clone().add(offset));
    this.orbit.update();
  }

  dispose(): void {
    window.cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.handlePointerUp);
    this.transform.detach();
    this.transform.dispose();
    this.orbit.dispose();
    this.selectionHelper?.dispose();
    this.selectionHelper = null;
    for (const entry of this.entries.values()) disposeObject(entry.object);
    this.entries.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
