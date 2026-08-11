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
      callbacks.onWebGlError('WebGL2 недоступен. Включите аппаратное ускорение браузера.');
      throw new Error('WebGL2 is unavailable');
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.domElement.className = 'asa3d-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Рабочая область 3D-моделирования');
    this.container.append(this.renderer.domElement);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.screenSpacePanning = true;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.minDistance = 35;
    this.orbit.maxDistance = 1200;

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setTranslationSnap(1);
    this.transform.setRotationSnap(THREE.MathUtils.degToRad(15));
    this.transform.setScaleSnap(0.1);
    this.transform.setSize(0.78);
    this.transform.addEventListener('dragging-changed', (event) => {
      const dragging = Boolean(event.value);
      this.transformDragging = dragging;
      this.orbit.enabled = !dragging;
    });
    this.transform.addEventListener('mouseUp', () => this.commitSelectedTransform());
    this.scene.add(this.transform.getHelper());

    const hemisphere = new THREE.HemisphereLight('#ffffff', '#aebac0', 2.05);
    this.scene.add(hemisphere);
    const key = new THREE.DirectionalLight('#ffffff', 3.15);
    key.position.set(-110, 210, 155);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -170;
    key.shadow.camera.right = 170;
    key.shadow.camera.top = 170;
    key.shadow.camera.bottom = -170;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#bcecff', 0.9);
    fill.position.set(155, 105, -120);
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

    const shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(document.grid.width, document.grid.depth),
      new THREE.ShadowMaterial({
        color: '#71838b',
        transparent: true,
        opacity: 0.13,
        depthWrite: false,
      }),
    );
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.y = -0.018;
    shadowCatcher.receiveShadow = true;
    this.gridRoot.add(shadowCatcher);

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
    const position = {
      home: HOME_CAMERA_POSITION,
      top: new THREE.Vector3(0, ORTHOGONAL_CAMERA_DISTANCE, 0.001),
      front: new THREE.Vector3(0, 95, ORTHOGONAL_CAMERA_DISTANCE),
      right: new THREE.Vector3(ORTHOGONAL_CAMERA_DISTANCE, 95, 0),
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
    this.clearGrid();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
