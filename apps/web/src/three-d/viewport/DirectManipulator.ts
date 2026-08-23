import * as THREE from 'three';
import type { ThreeDDimensions, ThreeDNode, ThreeDTransform } from '@asa-lab/three-d';
import {
  calculateAnchoredResize,
  calculateHeightResize,
  calculateLiftPosition,
  normaliseDegrees,
  snapRotationRadians,
  snapToStep,
  canDragOnPlane,
  dragPlaneHeight,
} from './manipulation';

export interface DirectManipulationEntry {
  readonly object: THREE.Group;
  readonly node: ThreeDNode;
}

export interface DirectManipulationCommit {
  readonly nodeId: string;
  readonly transform: ThreeDTransform;
  readonly dimensions?: ThreeDDimensions;
}

interface OrbitLike {
  enabled: boolean;
}

interface DirectManipulatorCallbacks {
  readonly onSelect: (nodeId: string | null, additive: boolean) => void;
  readonly onCommit: (
    nodeId: string,
    transform: ThreeDTransform,
    dimensions?: ThreeDDimensions,
  ) => void;
  readonly onCommitMany: (commits: readonly DirectManipulationCommit[]) => void;
}

type RotationAxis = 'x' | 'y' | 'z';
type HandleKind = 'resize' | 'height' | 'lift' | 'rotate';

interface HandleDescriptor {
  readonly id: string;
  readonly kind: HandleKind;
  readonly xSign?: -1 | 0 | 1;
  readonly zSign?: -1 | 0 | 1;
  readonly axis?: RotationAxis;
}

interface HandleVisual {
  readonly descriptor: HandleDescriptor;
  readonly root: THREE.Object3D;
  readonly accent: THREE.Color;
}

interface DragState {
  readonly pointerId: number;
  readonly nodeId: string;
  readonly entry: DirectManipulationEntry;
  readonly descriptor: HandleDescriptor | { readonly id: 'move'; readonly kind: 'move' };
  readonly plane: THREE.Plane;
  readonly startPoint: THREE.Vector3;
  readonly startPosition: THREE.Vector3;
  readonly startQuaternion: THREE.Quaternion;
  readonly startScale: THREE.Vector3;
  readonly initialWidth: number;
  readonly initialDepth: number;
  readonly initialHeight: number;
  readonly axisWorld: THREE.Vector3 | null;
  readonly startRotationVector: THREE.Vector3 | null;
  /** Keeps the exact visual handle point under an off-centre pointer grab. */
  readonly pointerGrabOffset: THREE.Vector3;
  readonly floorPositionY: number;
  readonly moveEntries: readonly {
    readonly nodeId: string;
    readonly entry: DirectManipulationEntry;
    readonly startPosition: THREE.Vector3;
  }[];
  moved: boolean;
  currentAngleDegrees: number;
}

interface MarqueeState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly additive: boolean;
  currentX: number;
  currentY: number;
  moved: boolean;
}

interface ScreenRectangle {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface LabelAnchor {
  readonly element: HTMLDivElement;
  readonly point: THREE.Vector3;
}

const HANDLE_COLOR = new THREE.Color('#e8ecee');
const HANDLE_ACTIVE = new THREE.Color('#ef3b32');
const DIMENSION_COLOR = '#30383d';
const RING_COLOR = '#15a9d1';

const RESIZE_HANDLES: readonly HandleDescriptor[] = [
  { id: 'resize-north-west', kind: 'resize', xSign: -1, zSign: -1 },
  { id: 'resize-north', kind: 'resize', xSign: 0, zSign: -1 },
  { id: 'resize-north-east', kind: 'resize', xSign: 1, zSign: -1 },
  { id: 'resize-east', kind: 'resize', xSign: 1, zSign: 0 },
  { id: 'resize-south-east', kind: 'resize', xSign: 1, zSign: 1 },
  { id: 'resize-south', kind: 'resize', xSign: 0, zSign: 1 },
  { id: 'resize-south-west', kind: 'resize', xSign: -1, zSign: 1 },
  { id: 'resize-west', kind: 'resize', xSign: -1, zSign: 0 },
] as const;

const HEIGHT_HANDLE: HandleDescriptor = { id: 'resize-height', kind: 'height' };
const LIFT_HANDLE: HandleDescriptor = { id: 'lift', kind: 'lift' };
const ROTATE_HANDLES: readonly HandleDescriptor[] = [
  { id: 'rotate-x', kind: 'rotate', axis: 'x' },
  { id: 'rotate-y', kind: 'rotate', axis: 'y' },
  { id: 'rotate-z', kind: 'rotate', axis: 'z' },
] as const;

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function axisVector(axis: RotationAxis): THREE.Vector3 {
  if (axis === 'x') return new THREE.Vector3(1, 0, 0);
  if (axis === 'y') return new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3(0, 0, 1);
}

function findNodeId(object: THREE.Object3D | undefined): string | null {
  let current = object;
  while (current) {
    const nodeId = current.userData['nodeId'];
    if (typeof nodeId === 'string') return nodeId;
    current = current.parent ?? undefined;
  }
  return null;
}

function findHandleId(object: THREE.Object3D | undefined): string | null {
  let current = object;
  while (current) {
    const handleId = current.userData['directHandleId'];
    if (typeof handleId === 'string') return handleId;
    current = current.parent ?? undefined;
  }
  return null;
}

function createRotationArrowTexture(): THREE.CanvasTexture {
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, 96, 96);
    context.strokeStyle = '#ffffff';
    context.fillStyle = '#ffffff';
    context.lineWidth = 7;
    context.lineCap = 'round';
    context.beginPath();
    context.arc(48, 50, 27, Math.PI * 1.08, Math.PI * 1.92);
    context.stroke();
    const drawArrow = (x: number, y: number, mirrored = false): void => {
      context.save();
      context.translate(x, y);
      if (mirrored) context.scale(-1, -1);
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(-4, 16);
      context.lineTo(-16, 7);
      context.closePath();
      context.fill();
      context.restore();
    };
    drawArrow(72, 34);
    drawArrow(24, 34, true);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function createSquareHandleTexture(): THREE.CanvasTexture {
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, 64, 64);
    context.shadowColor = 'rgba(10, 22, 28, 0.42)';
    context.shadowBlur = 4;
    context.shadowOffsetY = 2;
    context.fillStyle = '#f5f7f7';
    context.strokeStyle = '#20292d';
    context.lineWidth = 8;
    context.fillRect(16, 16, 32, 32);
    context.strokeRect(16, 16, 32, 32);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function createLiftHandleTexture(): THREE.CanvasTexture {
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, 64, 64);
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.moveTo(32, 9);
    context.lineTo(50, 51);
    context.lineTo(14, 51);
    context.closePath();
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function disposeGraph(root: THREE.Object3D): void {
  root.traverse((child) => {
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
}

export class DirectManipulator {
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly centreMarker: THREE.Mesh;
  private readonly handleRoot = new THREE.Group();
  private readonly handles = new Map<string, HandleVisual>();
  private readonly rotationRing = new THREE.Group();
  private readonly footprintRoot = new THREE.Group();
  private readonly dimensionRoot = new THREE.Group();
  private readonly overlay: HTMLDivElement;
  private readonly selectionBox: HTMLDivElement;
  private readonly rotationTexture = createRotationArrowTexture();
  private readonly squareTexture = createSquareHandleTexture();
  private readonly liftTexture = createLiftHandleTexture();
  private selectedId: string | null = null;
  private selectedIds: readonly string[] = [];
  private hoveredHandleId: string | null = null;
  private rotationRingAxis: RotationAxis | null = null;
  private workplaneY = 0;
  private footprintSignature = '';
  private gridSnap = 1;
  private marquee: MarqueeState | null = null;
  private drag: DragState | null = null;
  private labelAnchors: LabelAnchor[] = [];
  private handlePositionSignature = '';

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    private readonly container: HTMLElement,
    private readonly orbit: OrbitLike,
    private readonly getEntries: () => ReadonlyMap<string, DirectManipulationEntry>,
    private readonly callbacks: DirectManipulatorCallbacks,
  ) {
    this.handleRoot.name = 'ASA direct-manipulation handles';
    this.rotationRing.name = 'ASA direct-manipulation rotation ring';
    this.footprintRoot.name = 'ASA selected-object workplane footprint';
    this.dimensionRoot.name = 'ASA direct-manipulation dimensions';
    this.scene.add(this.footprintRoot, this.handleRoot, this.rotationRing, this.dimensionRoot);

    this.centreMarker = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: '#30383d',
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.centreMarker.name = 'ASA selected-object centre';
    this.centreMarker.renderOrder = 53;
    this.centreMarker.visible = false;
    this.scene.add(this.centreMarker);

    for (const descriptor of [...RESIZE_HANDLES, HEIGHT_HANDLE]) {
      this.addSquareHandle(descriptor);
    }
    this.addLiftHandle(LIFT_HANDLE);
    for (const descriptor of ROTATE_HANDLES) this.addRotationHandle(descriptor);

    this.overlay = globalThis.document.createElement('div');
    this.overlay.className = 'asa3d-manipulation-overlay';
    this.overlay.dataset['testid'] = 'asa3d-manipulator-overlay';
    this.overlay.setAttribute('aria-live', 'polite');
    this.overlay.setAttribute('aria-atomic', 'false');
    this.container.append(this.overlay);

    this.selectionBox = globalThis.document.createElement('div');
    this.selectionBox.className = 'asa3d-selection-marquee';
    this.selectionBox.dataset['testid'] = 'asa3d-selection-marquee';
    this.selectionBox.hidden = true;
    this.overlay.append(this.selectionBox);

    this.canvas.addEventListener('pointerdown', this.handlePointerDown, true);
    this.canvas.addEventListener('pointermove', this.handlePointerMove, true);
    this.canvas.addEventListener('pointerup', this.handlePointerUp, true);
    this.canvas.addEventListener('pointercancel', this.handlePointerCancel, true);
    this.canvas.addEventListener('pointerleave', this.handlePointerLeave);
    this.canvas.style.cursor = 'default';
  }

  private addSquareHandle(descriptor: HandleDescriptor): void {
    const material = new THREE.SpriteMaterial({
      map: this.squareTexture,
      color: HANDLE_COLOR,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    const root = new THREE.Sprite(material);
    root.userData['directHandleId'] = descriptor.id;
    root.renderOrder = 57;
    root.visible = false;
    this.handleRoot.add(root);
    this.handles.set(descriptor.id, { descriptor, root, accent: material.color });
  }

  private addLiftHandle(descriptor: HandleDescriptor): void {
    const material = new THREE.SpriteMaterial({
      map: this.liftTexture,
      color: '#30383d',
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    const root = new THREE.Sprite(material);
    root.userData['directHandleId'] = descriptor.id;
    root.renderOrder = 58;
    root.visible = false;
    this.handleRoot.add(root);
    this.handles.set(descriptor.id, { descriptor, root, accent: material.color });
  }

  private addRotationHandle(descriptor: HandleDescriptor): void {
    const material = new THREE.SpriteMaterial({
      map: this.rotationTexture,
      color: '#414b50',
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    material.rotation =
      descriptor.axis === 'y' ? -Math.PI / 2 : descriptor.axis === 'x' ? Math.PI : 0;
    const root = new THREE.Sprite(material);
    root.userData['directHandleId'] = descriptor.id;
    root.renderOrder = 58;
    root.visible = false;
    this.handleRoot.add(root);
    this.handles.set(descriptor.id, { descriptor, root, accent: material.color });
  }

  setGridSnap(step: number): void {
    this.gridSnap = Number.isFinite(step) && step > 0 ? step : 1;
  }

  setWorkplaneY(value: number): void {
    this.workplaneY = Number.isFinite(value) ? value : 0;
    this.footprintSignature = '';
    this.update();
  }

  setSelection(nodeId: string | null, nodeIds: readonly string[] = nodeId ? [nodeId] : []): void {
    this.selectedId = nodeId;
    this.selectedIds = [...new Set(nodeIds.filter((id) => this.getEntries().has(id)))];
    if (nodeId && !this.selectedIds.includes(nodeId)) {
      this.selectedIds = [...this.selectedIds, nodeId];
    }
    this.container.dataset['selectedNodeId'] = nodeId ?? '';
    this.container.dataset['selectedNodeIds'] = this.selectedIds.join(',');
    this.clearDimensionVisuals();
    this.setHoveredHandle(null);
    this.update();
  }

  private selectedEntry(): DirectManipulationEntry | null {
    return this.selectedId ? (this.getEntries().get(this.selectedId) ?? null) : null;
  }

  private selectedEntries(): readonly DirectManipulationEntry[] {
    return this.selectedIds
      .map((id) => this.getEntries().get(id))
      .filter((entry): entry is DirectManipulationEntry => Boolean(entry?.object.visible));
  }

  private effectiveDimensions(entry: DirectManipulationEntry): THREE.Vector3 {
    return new THREE.Vector3(
      entry.node.dimensions.width * Math.abs(entry.object.scale.x),
      entry.node.dimensions.height * Math.abs(entry.object.scale.y),
      entry.node.dimensions.depth * Math.abs(entry.object.scale.z),
    );
  }

  private worldFromLocal(entry: DirectManipulationEntry, local: THREE.Vector3): THREE.Vector3 {
    return local.applyQuaternion(entry.object.quaternion).add(entry.object.position);
  }

  private worldUnitsPerPixel(point: THREE.Vector3): number {
    const distance = Math.max(1, this.camera.position.distanceTo(point));
    const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * distance;
    return visibleHeight / Math.max(1, this.canvas.clientHeight);
  }

  update(): void {
    const selectedEntries = this.selectedEntries();
    this.updateFootprint(selectedEntries);
    if (selectedEntries.length > 1) {
      this.centreMarker.visible = false;
      this.handleRoot.visible = false;
      this.rotationRing.visible = false;
      this.publishHandlePositions(null);
      this.clearDimensionVisuals();
      return;
    }
    const entry = this.selectedEntry();
    if (!entry || !entry.object.visible) {
      this.centreMarker.visible = false;
      this.handleRoot.visible = false;
      this.rotationRing.visible = false;
      this.publishHandlePositions(null);
      this.clearDimensionVisuals();
      return;
    }

    const dimensions = this.effectiveDimensions(entry);
    const halfWidth = dimensions.x / 2;
    const halfHeight = dimensions.y / 2;
    const halfDepth = dimensions.z / 2;
    const frontCentre = this.worldFromLocal(entry, new THREE.Vector3(0, 0, halfDepth));
    const centreUnit = this.worldUnitsPerPixel(frontCentre);
    this.centreMarker.visible = true;
    this.centreMarker.position.copy(frontCentre);
    this.centreMarker.quaternion.copy(this.camera.quaternion);
    this.centreMarker.scale.setScalar(centreUnit * 6);

    const showHandles = !entry.node.locked;
    this.handleRoot.visible = showHandles;
    if (showHandles) {
      for (const descriptor of RESIZE_HANDLES) {
        const visual = this.handles.get(descriptor.id);
        if (!visual) continue;
        const local = new THREE.Vector3(
          (descriptor.xSign ?? 0) * halfWidth,
          -halfHeight,
          (descriptor.zSign ?? 0) * halfDepth,
        );
        const world = this.worldFromLocal(entry, local);
        visual.root.visible = true;
        visual.root.position.copy(world);
        visual.root.quaternion.copy(entry.object.quaternion);
        visual.root.scale.setScalar(this.worldUnitsPerPixel(world) * 20);
      }

      const heightVisual = this.handles.get(HEIGHT_HANDLE.id);
      if (heightVisual) {
        const world = this.worldFromLocal(entry, new THREE.Vector3(0, halfHeight, 0));
        heightVisual.root.visible = true;
        heightVisual.root.position.copy(world);
        heightVisual.root.quaternion.copy(entry.object.quaternion);
        heightVisual.root.scale.setScalar(this.worldUnitsPerPixel(world) * 20);
      }

      const bounds = new THREE.Box3().setFromObject(entry.object);
      const liftVisual = this.handles.get(LIFT_HANDLE.id);
      if (liftVisual) {
        const top = new THREE.Vector3(
          entry.object.position.x,
          bounds.max.y,
          entry.object.position.z,
        );
        const unit = this.worldUnitsPerPixel(top);
        top.y += unit * 57;
        liftVisual.root.visible = true;
        liftVisual.root.position.copy(top);
        liftVisual.root.quaternion.identity();
        liftVisual.root.scale.setScalar(unit * 23);
      }

      const rotateY = this.handles.get('rotate-y');
      if (rotateY) {
        const boundary = this.worldFromLocal(entry, new THREE.Vector3(halfWidth, -halfHeight, 0));
        const unit = this.worldUnitsPerPixel(boundary);
        const world = this.worldFromLocal(
          entry,
          new THREE.Vector3(halfWidth + unit * 34, -halfHeight, 0),
        );
        rotateY.root.visible = true;
        rotateY.root.position.copy(world);
        rotateY.root.scale.set(unit * 34, unit * 34, 1);
      }

      const rotateX = this.handles.get('rotate-x');
      if (rotateX) {
        const boundary = this.worldFromLocal(entry, new THREE.Vector3(0, -halfHeight, halfDepth));
        const unit = this.worldUnitsPerPixel(boundary);
        const world = this.worldFromLocal(
          entry,
          new THREE.Vector3(0, -halfHeight, halfDepth + unit * 34),
        );
        rotateX.root.visible = true;
        rotateX.root.position.copy(world);
        rotateX.root.scale.set(unit * 34, unit * 34, 1);
      }

      const rotateZ = this.handles.get('rotate-z');
      if (rotateZ) {
        const boundary = this.worldFromLocal(entry, new THREE.Vector3(0, halfHeight, 0));
        const unit = this.worldUnitsPerPixel(boundary);
        const world = this.worldFromLocal(entry, new THREE.Vector3(0, halfHeight + unit * 29, 0));
        rotateZ.root.visible = true;
        rotateZ.root.position.copy(world);
        rotateZ.root.scale.set(unit * 34, unit * 34, 1);
      }
    }

    this.updateRotationRingTransform(entry);
    this.publishHandlePositions(entry);
    this.updateLabelPositions();
  }

  private updateFootprint(entries: readonly DirectManipulationEntry[]): void {
    const bounds = new THREE.Box3();
    entries.forEach((entry) => bounds.expandByObject(entry.object));
    if (entries.length === 0 || bounds.isEmpty()) {
      this.footprintRoot.visible = false;
      this.footprintSignature = '';
      return;
    }
    const minX = bounds.min.x;
    const maxX = bounds.max.x;
    const minZ = bounds.min.z;
    const maxZ = bounds.max.z;
    const signature = [minX, maxX, minZ, maxZ, this.workplaneY]
      .map((value) => round(value, 3))
      .join(':');
    this.footprintRoot.visible = true;
    if (signature === this.footprintSignature) return;
    this.footprintSignature = signature;
    disposeGraph(this.footprintRoot);
    this.footprintRoot.clear();

    const width = Math.max(0.01, maxX - minX);
    const depth = Math.max(0.01, maxZ - minZ);
    const centreX = (minX + maxX) / 2;
    const centreZ = (minZ + maxZ) / 2;
    const y = this.workplaneY + 0.055;
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshBasicMaterial({
        color: '#19a9cf',
        transparent: true,
        opacity: 0.055,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    fill.position.set(centreX, y, centreZ);
    fill.rotation.x = -Math.PI / 2;
    fill.renderOrder = 48;
    this.footprintRoot.add(fill);

    const points = [
      new THREE.Vector3(minX, y, minZ),
      new THREE.Vector3(maxX, y, minZ),
      new THREE.Vector3(maxX, y, minZ),
      new THREE.Vector3(maxX, y, maxZ),
      new THREE.Vector3(maxX, y, maxZ),
      new THREE.Vector3(minX, y, maxZ),
      new THREE.Vector3(minX, y, maxZ),
      new THREE.Vector3(minX, y, minZ),
      new THREE.Vector3(minX, y, centreZ),
      new THREE.Vector3(maxX, y, centreZ),
      new THREE.Vector3(centreX, y, minZ),
      new THREE.Vector3(centreX, y, maxZ),
    ];
    const outline = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineDashedMaterial({
        color: '#30383d',
        transparent: true,
        opacity: 0.78,
        dashSize: 1.45,
        gapSize: 0.9,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    outline.computeLineDistances();
    outline.renderOrder = 54;
    this.footprintRoot.add(outline);
  }

  private publishHandlePositions(entry: DirectManipulationEntry | null): void {
    const project = (point: THREE.Vector3): { readonly x: number; readonly y: number } => {
      const projected = point.clone().project(this.camera);
      return {
        x: round((projected.x * 0.5 + 0.5) * Math.max(1, this.canvas.clientWidth), 1),
        y: round((-projected.y * 0.5 + 0.5) * Math.max(1, this.canvas.clientHeight), 1),
      };
    };
    const payload = {
      centre: entry ? project(entry.object.position) : null,
      handles: entry
        ? [...this.handles.values()]
            .filter((visual) => visual.root.visible)
            .map((visual) => ({ id: visual.descriptor.id, ...project(visual.root.position) }))
        : [],
    };
    const signature = JSON.stringify(payload);
    if (signature === this.handlePositionSignature) return;
    this.handlePositionSignature = signature;
    this.overlay.dataset['handlePositions'] = signature;
  }

  private setPointer(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private intersectHandle(): HandleDescriptor | null {
    if (!this.handleRoot.visible) return null;
    const visibleRoots = [...this.handles.values()]
      .map((visual) => visual.root)
      .filter((root) => root.visible);
    const directHit = this.raycaster.intersectObjects(visibleRoots, true)[0];
    const directHandleId = findHandleId(directHit?.object);
    if (directHandleId) return this.handles.get(directHandleId)?.descriptor ?? null;
    const ringHit = this.rotationRing.visible
      ? this.raycaster.intersectObject(this.rotationRing, true)[0]
      : undefined;
    const handleId = findHandleId(ringHit?.object);
    return handleId ? (this.handles.get(handleId)?.descriptor ?? null) : null;
  }

  private intersectEntry(): {
    readonly nodeId: string;
    readonly entry: DirectManipulationEntry;
  } | null {
    const objects = [...this.getEntries().values()]
      .filter((entry) => entry.object.visible)
      .map((entry) => entry.object);
    const hit = this.raycaster.intersectObjects(objects, true)[0];
    const nodeId = findNodeId(hit?.object);
    const entry = nodeId ? this.getEntries().get(nodeId) : null;
    return nodeId && entry ? { nodeId, entry } : null;
  }

  private marqueeRectangle(state: MarqueeState): ScreenRectangle {
    const canvasRect = this.canvas.getBoundingClientRect();
    const startX = state.startX - canvasRect.left;
    const startY = state.startY - canvasRect.top;
    const currentX = state.currentX - canvasRect.left;
    const currentY = state.currentY - canvasRect.top;
    return {
      left: Math.max(0, Math.min(startX, currentX)),
      top: Math.max(0, Math.min(startY, currentY)),
      right: Math.min(canvasRect.width, Math.max(startX, currentX)),
      bottom: Math.min(canvasRect.height, Math.max(startY, currentY)),
    };
  }

  private updateMarqueeVisual(): void {
    const state = this.marquee;
    if (!state || !state.moved) {
      this.selectionBox.hidden = true;
      delete this.overlay.dataset['marqueeBounds'];
      return;
    }
    const rectangle = this.marqueeRectangle(state);
    this.selectionBox.hidden = false;
    this.selectionBox.style.left = `${rectangle.left}px`;
    this.selectionBox.style.top = `${rectangle.top}px`;
    this.selectionBox.style.width = `${Math.max(1, rectangle.right - rectangle.left)}px`;
    this.selectionBox.style.height = `${Math.max(1, rectangle.bottom - rectangle.top)}px`;
    this.overlay.dataset['marqueeBounds'] = JSON.stringify(rectangle);
  }

  private entryScreenRectangle(entry: DirectManipulationEntry): ScreenRectangle | null {
    const bounds = new THREE.Box3().setFromObject(entry.object);
    if (bounds.isEmpty()) return null;
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const corners: THREE.Vector3[] = [];
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z));
      }
    }
    const projected = corners.map((corner) => corner.project(this.camera));
    if (!projected.some((point) => point.z >= -1 && point.z <= 1)) return null;
    const xs = projected.map((point) => (point.x * 0.5 + 0.5) * width);
    const ys = projected.map((point) => (-point.y * 0.5 + 0.5) * height);
    return {
      left: Math.min(...xs),
      top: Math.min(...ys),
      right: Math.max(...xs),
      bottom: Math.max(...ys),
    };
  }

  private entriesInMarquee(rectangle: ScreenRectangle): readonly string[] {
    const ids: string[] = [];
    for (const [id, entry] of this.getEntries()) {
      if (!entry.object.visible) continue;
      const candidate = this.entryScreenRectangle(entry);
      if (!candidate) continue;
      const intersects =
        candidate.right >= rectangle.left &&
        candidate.left <= rectangle.right &&
        candidate.bottom >= rectangle.top &&
        candidate.top <= rectangle.bottom;
      if (intersects) ids.push(id);
    }
    return ids;
  }

  private applySelection(ids: readonly string[], additive: boolean): void {
    const uniqueIds = [...new Set(ids.filter((id) => this.getEntries().has(id)))];
    let nextIds: readonly string[];
    if (!additive) {
      nextIds = uniqueIds;
    } else {
      const next = new Set(this.selectedIds);
      const remove = uniqueIds.length > 0 && uniqueIds.every((id) => next.has(id));
      uniqueIds.forEach((id) => (remove ? next.delete(id) : next.add(id)));
      nextIds = [...next];
    }
    this.setSelection(nextIds.at(-1) ?? null, nextIds);
    if (!additive) {
      const [first, ...rest] = uniqueIds;
      if (!first) {
        this.callbacks.onSelect(null, false);
        return;
      }
      this.callbacks.onSelect(first, false);
      rest.forEach((id) => this.callbacks.onSelect(id, true));
      return;
    }
    uniqueIds.forEach((id) => this.callbacks.onSelect(id, true));
  }

  private finishMarquee(select: boolean): void {
    const state = this.marquee;
    if (!state) return;
    if (this.canvas.hasPointerCapture(state.pointerId)) {
      this.canvas.releasePointerCapture(state.pointerId);
    }
    this.marquee = null;
    this.selectionBox.hidden = true;
    delete this.overlay.dataset['marqueeBounds'];
    delete this.container.dataset['selecting'];
    if (!select) return;
    if (!state.moved) {
      if (!state.additive) this.applySelection([], false);
      return;
    }
    this.applySelection(this.entriesInMarquee(this.marqueeRectangle(state)), state.additive);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    this.setPointer(event.clientX, event.clientY);
    const handle = this.intersectHandle();
    const selected = this.selectedEntry();
    if (handle && selected && !selected.node.locked) {
      event.preventDefault();
      event.stopPropagation();
      this.beginDrag(event, this.selectedId as string, selected, handle);
      return;
    }

    const hit = this.intersectEntry();
    if (hit) {
      event.preventDefault();
      event.stopPropagation();
      if (additive) {
        this.applySelection([hit.nodeId], true);
        return;
      }
      const alreadySelected = this.selectedIds.includes(hit.nodeId);
      if (!alreadySelected) {
        this.applySelection([hit.nodeId], false);
      }
      if (!hit.entry.node.locked) {
        this.beginDrag(event, hit.nodeId, hit.entry, { id: 'move', kind: 'move' });
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.marquee = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      additive,
      moved: false,
    };
    this.canvas.setPointerCapture(event.pointerId);
    this.setHoveredHandle(null);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (this.marquee) {
      if (event.pointerId !== this.marquee.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      this.marquee.currentX = event.clientX;
      this.marquee.currentY = event.clientY;
      this.marquee.moved =
        this.marquee.moved ||
        Math.hypot(
          this.marquee.currentX - this.marquee.startX,
          this.marquee.currentY - this.marquee.startY,
        ) > 4;
      if (this.marquee.moved) this.container.dataset['selecting'] = 'marquee';
      this.updateMarqueeVisual();
      return;
    }
    if (this.drag) {
      if (event.pointerId !== this.drag.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      this.updateDrag(event);
      return;
    }

    this.setPointer(event.clientX, event.clientY);
    const handle = this.intersectHandle();
    this.setHoveredHandle(handle?.id ?? null);
    if (handle) return;
    this.canvas.style.cursor = 'default';
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.marquee && event.pointerId === this.marquee.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      this.marquee.currentX = event.clientX;
      this.marquee.currentY = event.clientY;
      this.finishMarquee(true);
      return;
    }
    if (this.drag && event.pointerId === this.drag.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      this.finishDrag();
      return;
    }
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    if (this.marquee?.pointerId === event.pointerId) this.finishMarquee(false);
    if (this.drag?.pointerId === event.pointerId) this.finishDrag();
  };

  private readonly handlePointerLeave = (): void => {
    if (!this.drag && !this.marquee) this.setHoveredHandle(null);
  };

  private beginDrag(
    event: PointerEvent,
    nodeId: string,
    entry: DirectManipulationEntry,
    descriptor: HandleDescriptor | { readonly id: 'move'; readonly kind: 'move' },
  ): void {
    const object = entry.object;
    const startPosition = object.position.clone();
    const startQuaternion = object.quaternion.clone();
    const startScale = object.scale.clone();
    const dimensions = this.effectiveDimensions(entry);
    const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(startQuaternion).normalize();
    let plane: THREE.Plane;
    let axisWorld: THREE.Vector3 | null = null;
    let mathematicalHandlePoint: THREE.Vector3 | null = null;

    if (descriptor.kind === 'move') {
      /**
       * Горизонтальная плоскость через саму фигуру, а не через пол.
       *
       * Раньше здесь стояла плоскость y = 0, и фигура уезжала из-под курсора:
       * луч от мыши пересекает пол не там, где проходит через фигуру, поэтому
       * при одном и том же движении мыши деталь проходила лишнее. Для куба,
       * стоящего на плоскости (центр на 10 мм), это почти 6% лишнего хода; для
       * поднятой на 70 мм — 63%; для верхушки башни — в несколько раз больше.
       * Именно это выглядит как «бежит и плывёт».
       */
      plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -dragPlaneHeight(startPosition.y));
    } else if (descriptor.kind === 'resize') {
      mathematicalHandlePoint = this.worldFromLocal(
        entry,
        new THREE.Vector3(
          (descriptor.xSign ?? 0) * (dimensions.x / 2),
          -dimensions.y / 2,
          (descriptor.zSign ?? 0) * (dimensions.z / 2),
        ),
      );
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(localY, mathematicalHandlePoint);
    } else if (descriptor.kind === 'height') {
      axisWorld = localY;
      plane = this.dragPlaneForAxis(axisWorld, startPosition);
    } else if (descriptor.kind === 'lift') {
      axisWorld = new THREE.Vector3(0, 1, 0);
      plane = this.dragPlaneForAxis(axisWorld, startPosition);
    } else {
      axisWorld = axisVector(descriptor.axis ?? 'y')
        .applyQuaternion(startQuaternion)
        .normalize();
      const ringPoint =
        this.rotationRing.visible && this.rotationRingAxis === descriptor.axis
          ? this.rotationRing.position
          : (this.handles.get(descriptor.id)?.root.position ?? startPosition);
      plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisWorld, ringPoint);
    }

    const startPoint = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, startPoint)) return;
    const pointerGrabOffset = mathematicalHandlePoint
      ? mathematicalHandlePoint.clone().sub(startPoint)
      : new THREE.Vector3();
    const bounds = new THREE.Box3().setFromObject(object);
    const moveEntries =
      descriptor.kind === 'move' && this.selectedIds.includes(nodeId)
        ? this.selectedEntries()
            .filter((selected) => !selected.node.locked)
            .map((selected) => ({
              nodeId: selected.node.id,
              entry: selected,
              startPosition: selected.object.position.clone(),
            }))
        : [{ nodeId, entry, startPosition: startPosition.clone() }];
    const startRotationVector =
      descriptor.kind === 'rotate'
        ? startPoint
            .clone()
            .sub(startPosition)
            .projectOnPlane(axisWorld as THREE.Vector3)
            .normalize()
        : null;

    this.drag = {
      pointerId: event.pointerId,
      nodeId,
      entry,
      descriptor,
      plane,
      startPoint,
      startPosition,
      startQuaternion,
      startScale,
      initialWidth: dimensions.x,
      initialDepth: dimensions.z,
      initialHeight: dimensions.y,
      axisWorld,
      startRotationVector,
      pointerGrabOffset,
      floorPositionY: startPosition.y - bounds.min.y,
      moveEntries,
      moved: false,
      currentAngleDegrees: 0,
    };
    this.orbit.enabled = false;
    this.finishMarquee(false);
    this.container.dataset['manipulating'] = descriptor.kind;
    this.container.dataset['manipulationCount'] = String(moveEntries.length);
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.style.cursor = 'default';
    if (descriptor.kind !== 'move') this.setHoveredHandle(descriptor.id);
    this.showMeasurements(descriptor);
  }

  private dragPlaneForAxis(axis: THREE.Vector3, point: THREE.Vector3): THREE.Plane {
    const cameraDirection = new THREE.Vector3();
    this.camera.getWorldDirection(cameraDirection);
    const normal = cameraDirection.addScaledVector(axis, -cameraDirection.dot(axis));
    if (normal.lengthSq() < 0.0001) {
      normal.copy(new THREE.Vector3(0, 0, 1)).addScaledVector(axis, -axis.z);
    }
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal.normalize(), point);
  }

  private updateDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    this.setPointer(event.clientX, event.clientY);
    /**
     * Луч, идущий вдоль плоскости, пересекает её где угодно: у горизонта одно
     * движение мыши на пиксель улетает в метры, и деталь исчезает с экрана.
     * Пока камера смотрит слишком полого, движение просто не применяется —
     * лучше не сдвинуть, чем зашвырнуть.
     */
    if (!canDragOnPlane(this.raycaster.ray.direction.dot(drag.plane.normal))) return;
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(drag.plane, point)) return;
    const delta = point.clone().sub(drag.startPoint);
    const object = drag.entry.object;

    if (drag.descriptor.kind === 'move') {
      drag.moveEntries.forEach((moving) => {
        moving.entry.object.position.set(
          snapToStep(moving.startPosition.x + delta.x, this.gridSnap),
          moving.startPosition.y,
          snapToStep(moving.startPosition.z + delta.z, this.gridSnap),
        );
        moving.entry.object.updateMatrixWorld(true);
      });
    } else if (drag.descriptor.kind === 'resize') {
      const inverse = drag.startQuaternion.clone().invert();
      const localPointer = point
        .clone()
        .add(drag.pointerGrabOffset)
        .sub(drag.startPosition)
        .applyQuaternion(inverse);
      const result = calculateAnchoredResize({
        initialWidth: drag.initialWidth,
        initialDepth: drag.initialDepth,
        pointerX: localPointer.x,
        pointerZ: localPointer.z,
        xSign: drag.descriptor.xSign ?? 0,
        zSign: drag.descriptor.zSign ?? 0,
        snapStep: this.gridSnap,
      });
      object.scale.set(
        result.width / drag.entry.node.dimensions.width,
        drag.startScale.y,
        result.depth / drag.entry.node.dimensions.depth,
      );
      const centreOffset = new THREE.Vector3(result.centerOffsetX, 0, result.centerOffsetZ)
        .applyQuaternion(drag.startQuaternion)
        .add(drag.startPosition);
      object.position.copy(centreOffset);
    } else if (drag.descriptor.kind === 'height') {
      const axisDelta = delta.dot(drag.axisWorld as THREE.Vector3);
      const result = calculateHeightResize(drag.initialHeight, axisDelta, this.gridSnap);
      object.scale.set(
        drag.startScale.x,
        result.height / drag.entry.node.dimensions.height,
        drag.startScale.z,
      );
      object.position
        .copy(drag.startPosition)
        .add((drag.axisWorld as THREE.Vector3).clone().multiplyScalar(result.centerOffset));
    } else if (drag.descriptor.kind === 'lift') {
      const axisDelta = delta.dot(drag.axisWorld as THREE.Vector3);
      object.position.copy(drag.startPosition);
      object.position.y = calculateLiftPosition(
        drag.startPosition.y,
        axisDelta,
        drag.floorPositionY,
        this.gridSnap,
      );
    } else {
      const axis = drag.axisWorld as THREE.Vector3;
      const currentVector = point.clone().sub(drag.startPosition).projectOnPlane(axis).normalize();
      const startVector = drag.startRotationVector as THREE.Vector3;
      const unsigned = Math.acos(THREE.MathUtils.clamp(startVector.dot(currentVector), -1, 1));
      const sign = Math.sign(axis.dot(startVector.clone().cross(currentVector))) || 1;
      const snapped = snapRotationRadians(unsigned * sign, event.shiftKey ? 15 : 1);
      drag.currentAngleDegrees = normaliseDegrees(THREE.MathUtils.radToDeg(snapped));
      const localRotation = new THREE.Quaternion().setFromAxisAngle(
        axisVector(drag.descriptor.axis ?? 'y'),
        snapped,
      );
      object.quaternion.copy(drag.startQuaternion).multiply(localRotation).normalize();
    }

    object.updateMatrixWorld(true);
    drag.moved = this.transformChanged(drag);
    this.update();
    this.showMeasurements(drag.descriptor);
  }

  private transformChanged(drag: DragState): boolean {
    if (drag.descriptor.kind === 'move') {
      return drag.moveEntries.some(
        (moving) => moving.entry.object.position.distanceToSquared(moving.startPosition) > 0.000001,
      );
    }
    const object = drag.entry.object;
    return (
      object.position.distanceToSquared(drag.startPosition) > 0.000001 ||
      object.scale.distanceToSquared(drag.startScale) > 0.000001 ||
      1 - Math.abs(object.quaternion.dot(drag.startQuaternion)) > 0.000001
    );
  }

  private finishDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    if (this.canvas.hasPointerCapture(drag.pointerId))
      this.canvas.releasePointerCapture(drag.pointerId);
    this.drag = null;
    this.orbit.enabled = true;
    delete this.container.dataset['manipulating'];
    delete this.container.dataset['manipulationCount'];
    this.canvas.style.cursor = 'default';
    if (drag.moved) {
      if (drag.descriptor.kind === 'move' && drag.moveEntries.length > 1) {
        this.callbacks.onCommitMany(
          drag.moveEntries.map((moving) => this.createCommit(moving.nodeId, moving.entry.object)),
        );
        this.clearDimensionVisuals();
        this.setHoveredHandle(null);
        this.update();
        return;
      }
      let dimensions: ThreeDDimensions | undefined;
      if (drag.descriptor.kind === 'resize' || drag.descriptor.kind === 'height') {
        const effective = this.effectiveDimensions(drag.entry);
        dimensions = {
          width: round(effective.x, 3),
          depth: round(effective.z, 3),
          height: round(effective.y, 3),
        };
        drag.entry.object.scale.set(1, 1, 1);
      }
      this.commitEntry(drag.nodeId, drag.entry.object, dimensions);
    }
    this.clearDimensionVisuals();
    this.setHoveredHandle(null);
    this.update();
  }

  private commitEntry(nodeId: string, object: THREE.Object3D, dimensions?: ThreeDDimensions): void {
    const commit = this.createCommit(nodeId, object, dimensions);
    this.callbacks.onCommit(commit.nodeId, commit.transform, commit.dimensions);
  }

  private createCommit(
    nodeId: string,
    object: THREE.Object3D,
    dimensions?: ThreeDDimensions,
  ): DirectManipulationCommit {
    const toDegrees = 180 / Math.PI;
    return {
      nodeId,
      transform: {
        position: {
          x: round(object.position.x, 3),
          y: round(object.position.y, 3),
          z: round(object.position.z, 3),
        },
        rotation: {
          x: round(normaliseDegrees(object.rotation.x * toDegrees), 1),
          y: round(normaliseDegrees(object.rotation.y * toDegrees), 1),
          z: round(normaliseDegrees(object.rotation.z * toDegrees), 1),
        },
        scale: {
          x: Math.max(0.0025, round(Math.abs(object.scale.x), 4)),
          y: Math.max(0.0025, round(Math.abs(object.scale.y), 4)),
          z: Math.max(0.0025, round(Math.abs(object.scale.z), 4)),
        },
      },
      ...(dimensions ? { dimensions } : {}),
    };
  }

  private setHoveredHandle(handleId: string | null): void {
    if (this.hoveredHandleId === handleId) return;
    this.hoveredHandleId = handleId;
    for (const [id, visual] of this.handles) {
      const active = id === handleId;
      if (visual.descriptor.kind === 'lift') {
        visual.accent.copy(active ? HANDLE_ACTIVE : new THREE.Color('#30383d'));
      } else if (visual.descriptor.kind === 'rotate') {
        visual.accent.copy(active ? HANDLE_ACTIVE : new THREE.Color('#414b50'));
      } else {
        visual.accent.copy(active ? HANDLE_ACTIVE : HANDLE_COLOR);
      }
    }

    const descriptor = handleId ? this.handles.get(handleId)?.descriptor : null;
    if (descriptor?.kind === 'rotate') {
      this.showRotationRing(descriptor.axis ?? 'y', descriptor.id);
      this.canvas.style.cursor = 'default';
    } else {
      this.clearRotationRing();
      if (descriptor?.kind === 'resize') {
        this.canvas.style.cursor =
          descriptor.xSign !== 0 && descriptor.zSign !== 0 ? 'nwse-resize' : 'col-resize';
      } else if (descriptor?.kind === 'height' || descriptor?.kind === 'lift') {
        this.canvas.style.cursor = 'ns-resize';
      }
    }
    this.showMeasurements(descriptor ?? null);
  }

  private showRotationRing(axis: RotationAxis, handleId: string): void {
    const entry = this.selectedEntry();
    if (!entry) return;
    this.clearRotationRing();
    this.rotationRingAxis = axis;
    this.rotationRing.userData['directHandleId'] = handleId;
    const dimensions = this.effectiveDimensions(entry);
    const radius = Math.max(dimensions.x, dimensions.y, dimensions.z) * 1.55;
    const inner = radius * 0.69;
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: RING_COLOR,
      transparent: true,
      opacity: 0.2,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const band = new THREE.Mesh(new THREE.RingGeometry(inner, radius, 96), ringMaterial);
    band.userData['directHandleId'] = handleId;
    band.renderOrder = 51;
    this.rotationRing.add(band);

    // A wider invisible bridge joins the small arrow to the visible band, so the
    // ring remains interactive while the pointer moves away from the arrow.
    const hitBand = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.43, radius * 1.08, 96),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    hitBand.userData['directHandleId'] = handleId;
    hitBand.renderOrder = 50;
    this.rotationRing.add(hitBand);

    const linePoints: THREE.Vector3[] = [];
    const addCircle = (circleRadius: number): void => {
      for (let index = 0; index < 96; index += 1) {
        const first = (index / 96) * Math.PI * 2;
        const second = ((index + 1) / 96) * Math.PI * 2;
        linePoints.push(
          new THREE.Vector3(Math.cos(first) * circleRadius, Math.sin(first) * circleRadius, 0),
          new THREE.Vector3(Math.cos(second) * circleRadius, Math.sin(second) * circleRadius, 0),
        );
      }
    };
    addCircle(inner);
    addCircle(radius);
    for (let index = 0; index < 24; index += 1) {
      const angle = (index / 24) * Math.PI * 2;
      linePoints.push(
        new THREE.Vector3(Math.cos(angle) * inner, Math.sin(angle) * inner, 0),
        new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0),
      );
    }
    const addArrowHead = (angle: number, direction: 1 | -1): void => {
      const tip = new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      const tangent = new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0).multiplyScalar(
        direction,
      );
      const inward = tip
        .clone()
        .normalize()
        .multiplyScalar(-radius * 0.14);
      const back = tangent.multiplyScalar(-radius * 0.2);
      linePoints.push(
        tip,
        tip.clone().add(back).add(inward),
        tip,
        tip.clone().add(back).sub(inward),
      );
    };
    addArrowHead(Math.PI * 0.25, 1);
    addArrowHead(Math.PI * 1.25, -1);
    const lines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(linePoints),
      new THREE.LineBasicMaterial({
        color: RING_COLOR,
        transparent: true,
        opacity: 0.68,
        depthTest: false,
        toneMapped: false,
      }),
    );
    lines.renderOrder = 52;
    this.rotationRing.add(lines);
    this.rotationRing.visible = true;
    this.updateRotationRingTransform(entry);
  }

  private updateRotationRingTransform(entry: DirectManipulationEntry): void {
    if (!this.rotationRingAxis || !this.rotationRing.visible) return;
    const dimensions = this.effectiveDimensions(entry);
    this.rotationRing.position.copy(entry.object.position);
    if (this.rotationRingAxis === 'y') {
      this.rotationRing.position.copy(
        this.worldFromLocal(entry, new THREE.Vector3(0, -dimensions.y / 2, 0)),
      );
    }
    const orientation = new THREE.Quaternion();
    if (this.rotationRingAxis === 'y') {
      orientation.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    } else if (this.rotationRingAxis === 'x') {
      orientation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    }
    this.rotationRing.quaternion.copy(entry.object.quaternion).multiply(orientation);
  }

  private clearRotationRing(): void {
    this.rotationRingAxis = null;
    delete this.rotationRing.userData['directHandleId'];
    disposeGraph(this.rotationRing);
    disposeGraph(this.footprintRoot);
    this.rotationRing.clear();
    this.rotationRing.visible = false;
  }

  private clearDimensionVisuals(): void {
    disposeGraph(this.dimensionRoot);
    this.dimensionRoot.clear();
    // Measurement labels are transient, but the marquee is a permanent child
    // used for every future box-selection gesture.
    this.overlay.replaceChildren(this.selectionBox);
    this.labelAnchors = [];
  }

  private showMeasurements(
    descriptor: HandleDescriptor | { readonly id: 'move'; readonly kind: 'move' } | null,
  ): void {
    this.clearDimensionVisuals();
    const entry = this.selectedEntry();
    if (!entry || !descriptor) return;
    const dimensions = this.effectiveDimensions(entry);
    const halfWidth = dimensions.x / 2;
    const halfHeight = dimensions.y / 2;
    const halfDepth = dimensions.z / 2;
    const offset = Math.max(2, Math.max(dimensions.x, dimensions.y, dimensions.z) * 0.1);

    if (descriptor.kind === 'move') {
      this.addLabel(
        `X ${this.formatMillimetres(entry.object.position.x)} · Y ${this.formatMillimetres(entry.object.position.z)}`,
        this.worldFromLocal(entry, new THREE.Vector3(0, halfHeight + offset, 0)),
        'asa3d-position-value',
      );
      return;
    }

    if (descriptor.kind === 'resize') {
      if ((descriptor.xSign ?? 0) !== 0) {
        const z = halfDepth + offset;
        this.addLocalDimension(entry, [
          new THREE.Vector3(-halfWidth, -halfHeight, z),
          new THREE.Vector3(halfWidth, -halfHeight, z),
          new THREE.Vector3(-halfWidth, -halfHeight, z - offset * 0.45),
          new THREE.Vector3(-halfWidth, -halfHeight, z + offset * 0.45),
          new THREE.Vector3(halfWidth, -halfHeight, z - offset * 0.45),
          new THREE.Vector3(halfWidth, -halfHeight, z + offset * 0.45),
        ]);
        this.addLabel(
          this.formatMillimetres(dimensions.x),
          this.worldFromLocal(entry, new THREE.Vector3(0, -halfHeight, z + offset * 0.42)),
          'asa3d-width-value',
        );
      }
      if ((descriptor.zSign ?? 0) !== 0) {
        const x = -halfWidth - offset;
        this.addLocalDimension(entry, [
          new THREE.Vector3(x, -halfHeight, -halfDepth),
          new THREE.Vector3(x, -halfHeight, halfDepth),
          new THREE.Vector3(x - offset * 0.45, -halfHeight, -halfDepth),
          new THREE.Vector3(x + offset * 0.45, -halfHeight, -halfDepth),
          new THREE.Vector3(x - offset * 0.45, -halfHeight, halfDepth),
          new THREE.Vector3(x + offset * 0.45, -halfHeight, halfDepth),
        ]);
        this.addLabel(
          this.formatMillimetres(dimensions.z),
          this.worldFromLocal(entry, new THREE.Vector3(x - offset * 0.42, -halfHeight, 0)),
          'asa3d-depth-value',
        );
      }
      return;
    }

    if (descriptor.kind === 'height') {
      const x = halfWidth + offset;
      this.addLocalDimension(entry, [
        new THREE.Vector3(x, -halfHeight, 0),
        new THREE.Vector3(x, halfHeight, 0),
        new THREE.Vector3(x - offset * 0.45, -halfHeight, 0),
        new THREE.Vector3(x + offset * 0.45, -halfHeight, 0),
        new THREE.Vector3(x - offset * 0.45, halfHeight, 0),
        new THREE.Vector3(x + offset * 0.45, halfHeight, 0),
      ]);
      this.addLabel(
        this.formatMillimetres(dimensions.y),
        this.worldFromLocal(entry, new THREE.Vector3(x + offset * 0.5, 0, 0)),
        'asa3d-height-value',
      );
      return;
    }

    if (descriptor.kind === 'lift') {
      const bounds = new THREE.Box3().setFromObject(entry.object);
      const x = bounds.max.x + offset;
      this.addWorldDimension([
        new THREE.Vector3(x, 0, entry.object.position.z),
        new THREE.Vector3(x, bounds.min.y, entry.object.position.z),
        new THREE.Vector3(x - offset * 0.45, 0, entry.object.position.z),
        new THREE.Vector3(x + offset * 0.45, 0, entry.object.position.z),
        new THREE.Vector3(x - offset * 0.45, bounds.min.y, entry.object.position.z),
        new THREE.Vector3(x + offset * 0.45, bounds.min.y, entry.object.position.z),
      ]);
      this.addLabel(
        this.formatMillimetres(Math.max(0, bounds.min.y)),
        new THREE.Vector3(
          x + offset * 0.55,
          Math.max(0, bounds.min.y / 2),
          entry.object.position.z,
        ),
        'asa3d-lift-value',
      );
      return;
    }

    const rotationVisual = this.handles.get(descriptor.id);
    const angle = this.drag?.descriptor.kind === 'rotate' ? this.drag.currentAngleDegrees : 0;
    this.addLabel(
      `${round(angle, 1)}°`,
      rotationVisual?.root.position.clone() ?? entry.object.position.clone(),
      'asa3d-angle-value',
    );
  }

  private addLocalDimension(entry: DirectManipulationEntry, localPoints: THREE.Vector3[]): void {
    this.addWorldDimension(localPoints.map((point) => this.worldFromLocal(entry, point)));
  }

  private addWorldDimension(points: THREE.Vector3[]): void {
    const line = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: DIMENSION_COLOR,
        depthTest: false,
        transparent: true,
        opacity: 0.96,
        toneMapped: false,
      }),
    );
    line.renderOrder = 54;
    this.dimensionRoot.add(line);
  }

  private addLabel(text: string, point: THREE.Vector3, testId: string): void {
    const element = globalThis.document.createElement('div');
    element.className = 'asa3d-measurement-label';
    element.dataset['testid'] = testId;
    element.textContent = text;
    this.overlay.append(element);
    this.labelAnchors.push({ element, point });
    this.updateLabelPositions();
  }

  private formatMillimetres(value: number): string {
    return round(value, 2).toFixed(2);
  }

  private updateLabelPositions(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    for (const anchor of this.labelAnchors) {
      const projected = anchor.point.clone().project(this.camera);
      const visible = projected.z >= -1 && projected.z <= 1;
      anchor.element.style.display = visible ? 'block' : 'none';
      anchor.element.style.left = `${(projected.x * 0.5 + 0.5) * width}px`;
      anchor.element.style.top = `${(-projected.y * 0.5 + 0.5) * height}px`;
    }
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown, true);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove, true);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp, true);
    this.canvas.removeEventListener('pointercancel', this.handlePointerCancel, true);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    this.orbit.enabled = true;
    this.overlay.remove();
    this.rotationTexture.dispose();
    this.squareTexture.dispose();
    this.liftTexture.dispose();
    disposeGraph(this.handleRoot);
    disposeGraph(this.rotationRing);
    disposeGraph(this.dimensionRoot);
    disposeGraph(this.centreMarker);
    this.scene.remove(
      this.footprintRoot,
      this.handleRoot,
      this.rotationRing,
      this.dimensionRoot,
      this.centreMarker,
    );
    this.handles.clear();
    this.labelAnchors = [];
  }
}
