import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { RoboticsObjectKey, RoboticsPoint } from '@asa-lab/robotics/world-document';
import type { RoboticsFieldGeometry } from './RobotField';
import {
  FIELD_CAMERA_NORMAL_MAGNIFICATION,
  type FieldCamera,
  type FieldViewport,
} from './field-camera';
import {
  createFieldSpatialScene,
  createRobotSpatialScene,
  SPATIAL_FIELD_BACKGROUND,
} from './field-spatial-scene';
import type { RoboticsDistanceMeasurement, RoboticsWorldState } from './world';

export type FieldView = 'top' | 'orbit' | 'side' | 'front';
export interface FieldViewportControls {
  zoom: (factor: number) => void;
  fit: () => void;
  focus: (key?: RoboticsObjectKey) => void;
}

/** Exactly the SVG ground transform, including CSS size and its upward world Y. */
export function configureTopCamera(
  camera: THREE.OrthographicCamera,
  reference: FieldCamera,
  viewport: FieldViewport,
): void {
  const { width, height } = viewport;
  if (
    ![width, height, reference.xMeters, reference.yMeters, reference.pixelsPerMeter].every(
      Number.isFinite,
    ) ||
    width <= 0 ||
    height <= 0 ||
    reference.pixelsPerMeter <= 0
  )
    throw new Error('Invalid field projection');
  camera.left = -width / (2 * reference.pixelsPerMeter);
  camera.right = -camera.left;
  camera.top = height / (2 * reference.pixelsPerMeter);
  camera.bottom = -camera.top;
  camera.zoom = 1;
  camera.up.set(0, 1, 0);
  camera.position.set(reference.xMeters, reference.yMeters, 30);
  camera.lookAt(reference.xMeters, reference.yMeters, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}
type ViewportCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

function robotOrbitDistance(diameter: number, aspect: number, fovDegrees: number): number {
  const angle = Math.atan(Math.tan(THREE.MathUtils.degToRad(fovDegrees / 2)) * Math.min(1, aspect));
  return (diameter * 0.59) / Math.sin(angle);
}

/** Shared by native OrbitControls (wheel/pinch) and toolbar/keyboard dolly. */
function robotOrbitBounds(diameter: number, aspect: number, fovDegrees: number) {
  const minimum = diameter / 2 + Math.max(diameter * 0.05, 0.004);
  const maximum = Math.max(robotOrbitDistance(diameter, aspect, fovDegrees) * 4, minimum * 2);
  return { minimum, maximum, far: Math.max(5, maximum + diameter * 2) };
}

/** Camera-only construction fit: no document pose changes, no field-size proxy. */
export function frameRobotCamera(
  camera: ViewportCamera,
  view: FieldView,
  centre: THREE.Vector3,
  diameter: number,
  width: number,
  height: number,
): void {
  if (
    ![diameter, width, height].every(Number.isFinite) ||
    diameter <= 0 ||
    width <= 0 ||
    height <= 0
  )
    throw new Error('Invalid robot bounds');
  const aspect = width / height;
  camera.near = 0.001;
  camera.far = Math.max(5, diameter * 40);
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = aspect;
    camera.far = robotOrbitBounds(diameter, aspect, camera.fov).far;

    camera.position
      .copy(centre)
      .add(
        new THREE.Vector3(0.8, -1, 0.75)
          .normalize()
          .multiplyScalar(robotOrbitDistance(diameter, aspect, camera.fov)),
      );
    camera.up.set(0, 0, 1);
  } else {
    const span = (diameter * 1.18) / Math.min(1, aspect);
    camera.left = (-span * aspect) / 2;
    camera.right = -camera.left;
    camera.top = span / 2;
    camera.bottom = -camera.top;
    camera.zoom = 1;
    const direction =
      view === 'top'
        ? new THREE.Vector3(0, 0, 1)
        : view === 'front'
          ? new THREE.Vector3(1, 0, 0)
          : new THREE.Vector3(0, -1, 0);
    camera.up.set(0, view === 'top' ? 1 : 0, view === 'top' ? 0 : 1);
    camera.position.copy(centre).add(direction.multiplyScalar(diameter * 3));
  }
  camera.lookAt(centre);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

interface SideMetricScale {
  meters: number;
  cssPixels: number;
  label: string;
  /** Actual render inputs: left/right/top/bottom/zoom/CSS width/CSS height. */
  projection: readonly [number, number, number, number, number, number, number];
}

const metricFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });

/** CSS pixels, not drawing-buffer pixels: DPR never changes a physical ruler. */
export function readSideMetricScale(
  camera: ViewportCamera,
  width: number,
  height: number,
  enabled = true,
): SideMetricScale | null {
  if (!enabled || !(camera instanceof THREE.OrthographicCamera)) return null;
  if (
    ![width, height, camera.left, camera.right, camera.top, camera.bottom, camera.zoom].every(
      Number.isFinite,
    ) ||
    width <= 32 ||
    height <= 0 ||
    camera.zoom <= 0 ||
    camera.right <= camera.left ||
    camera.top <= camera.bottom
  )
    return null;
  const metersPerPixel = (camera.right - camera.left) / (camera.zoom * width);
  const verticalMetersPerPixel = (camera.top - camera.bottom) / (camera.zoom * height);
  // The side camera has square CSS pixels and no view offset. Hide invalid projections.
  if (
    !Number.isFinite(metersPerPixel) ||
    metersPerPixel <= 0 ||
    Math.abs(metersPerPixel - verticalMetersPerPixel) > metersPerPixel * 1e-9 ||
    camera.view?.enabled
  )
    return null;
  const maxPixels = Math.min(84, width - 32);
  const target = maxPixels * metersPerPixel;
  const power = 10 ** Math.floor(Math.log10(target));
  const meters = [5, 2, 1].map((factor) => factor * power).find((value) => value <= target);
  if (!meters || !Number.isFinite(meters)) return null;
  const cssPixels = meters / metersPerPixel;
  if (!Number.isFinite(cssPixels) || cssPixels <= 0 || cssPixels > maxPixels) return null;
  const unit = meters < 0.01 ? 'мм' : meters < 1 ? 'см' : 'м';
  const value = meters * (unit === 'мм' ? 1000 : unit === 'см' ? 100 : 1);
  if (!Number.isFinite(value) || value < 0.001) return null;
  return {
    meters,
    cssPixels,
    label: metricFormat.format(value) + ' ' + unit,
    projection: [camera.left, camera.right, camera.top, camera.bottom, camera.zoom, width, height],
  };
}

export interface SpatialObjectPreview {
  key: RoboticsObjectKey;
  dxMeters: number;
  dyMeters: number;
}
interface SpatialEdit {
  begin: (key: RoboticsObjectKey, point: RoboticsPoint) => boolean;
  preview: (point: RoboticsPoint) => SpatialObjectPreview | null;
  finish: (point: RoboticsPoint) => void;
  cancel: () => void;
}

/** The picked surface's horizontal plane preserves the exact grab-to-anchor offset. */
export function spatialEditPoint(
  camera: THREE.Camera,
  area: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  clientX: number,
  clientY: number,
  z: number,
): RoboticsPoint | null {
  if (
    ![area.left, area.top, area.width, area.height, clientX, clientY, z].every(Number.isFinite) ||
    area.width <= 0 ||
    area.height <= 0 ||
    clientX < area.left ||
    clientY < area.top ||
    clientX > area.left + area.width ||
    clientY > area.top + area.height
  )
    return null;
  camera.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(
    new THREE.Vector2(
      ((clientX - area.left) / area.width) * 2 - 1,
      1 - ((clientY - area.top) / area.height) * 2,
    ),
    camera,
  );
  if (Math.abs(ray.ray.direction.z) <= Number.EPSILON) return null;
  const t = (z - ray.ray.origin.z) / ray.ray.direction.z;
  if (!Number.isFinite(t) || t < 0) return null;
  const p = ray.ray.at(t, new THREE.Vector3());
  return [p.x, p.y].every(Number.isFinite) ? { xMeters: p.x, yMeters: p.y } : null;
}

/** Capture-phase ownership leaves OrbitControls tracking touch positions, without moving
 * its camera. A second finger restores camera features before its normal bubble handler. */
export function bindSpatialFieldGestures(
  canvas: HTMLCanvasElement,
  env: {
    current: () => {
      world: unknown;
      enabled: boolean;
      edit: SpatialEdit | undefined;
      controls: OrbitControls | null;
    };
    hit: (x: number, y: number) => { key: RoboticsObjectKey; point: THREE.Vector3 } | undefined;
    project: (x: number, y: number, z: number) => RoboticsPoint | null;
    preview: (value: SpatialObjectPreview | null) => void;
    select: (key: RoboticsObjectKey) => void;
    resetControls: () => void;
  },
) {
  let press: {
    id: number;
    x: number;
    y: number;
    world: unknown;
    key: RoboticsObjectKey;
    z: number;
    moved: boolean;
    edit: SpatialEdit;
    controls: OrbitControls;
    features: readonly [boolean, boolean, boolean];
  } | null = null;
  function clear(reset: boolean) {
    const old = press;
    press = null;
    if (!old) return;
    old.controls.enableRotate = old.features[0];
    old.controls.enablePan = old.features[1];
    old.controls.enableZoom = old.features[2];
    env.preview(null);
    if (reset) {
      old.edit.cancel();
      if (canvas.hasPointerCapture?.(old.id)) canvas.releasePointerCapture(old.id);
      env.resetControls();
    }
    canvas.classList.remove('robotics-object-dragging');
  }
  function sync() {
    if (
      press &&
      (!env.current().enabled || env.current().world !== press.world || !env.current().edit)
    )
      clear(true);
  }
  function down(event: PointerEvent) {
    if (press) {
      if (event.pointerId !== press.id) {
        const old = press;
        clear(false);
        old.edit.cancel();
      }
      return;
    }
    const state = env.current();
    if (!state.enabled || !state.edit || !state.controls || event.button !== 0 || !event.isPrimary)
      return;
    const hit = env.hit(event.clientX, event.clientY);
    if (!hit) return;
    const point = env.project(event.clientX, event.clientY, hit.point.z);
    if (!point || !state.edit.begin(hit.key, point)) return;
    const controls = state.controls;
    press = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      world: state.world,
      key: hit.key,
      z: hit.point.z,
      moved: false,
      edit: state.edit,
      controls,
      features: [controls.enableRotate, controls.enablePan, controls.enableZoom],
    };
    controls.enableRotate = controls.enablePan = controls.enableZoom = false;
    canvas.classList.add('robotics-object-dragging');
  }
  function move(event: PointerEvent) {
    sync();
    if (!press || press.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5) press.moved = true;
    if (!press.moved) return;
    const point = env.project(event.clientX, event.clientY, press.z);
    if (!point) {
      clear(true);
      return;
    }
    env.preview(press.edit.preview(point));
  }
  function up(event: PointerEvent) {
    sync();
    const old = press;
    if (!old || old.id !== event.pointerId) return;
    const point = env.project(event.clientX, event.clientY, old.z);
    // Evaluate final travel too: missing/coalesced pointermove must never turn a drag into a click.
    const moved = old.moved || Math.hypot(event.clientX - old.x, event.clientY - old.y) > 5;
    clear(false);
    if (moved && point) old.edit.finish(point);
    else {
      old.edit.cancel();
      if (!moved && point) env.select(old.key);
    }
  }
  function cancel() {
    clear(true);
  }
  function key(event: globalThis.KeyboardEvent) {
    if (event.key === 'Escape') cancel();
  }
  canvas.addEventListener('pointerdown', down, true);
  canvas.addEventListener('pointermove', move, true);
  canvas.addEventListener('pointerup', up, true);
  canvas.addEventListener('pointercancel', cancel, true);
  canvas.addEventListener('lostpointercapture', cancel);
  window.addEventListener('blur', cancel);
  window.addEventListener('keydown', key);
  return {
    sync,
    cancel,
    owns: () => Boolean(press),
    dispose() {
      cancel();
      canvas.removeEventListener('pointerdown', down, true);
      canvas.removeEventListener('pointermove', move, true);
      canvas.removeEventListener('pointerup', up, true);
      canvas.removeEventListener('pointercancel', cancel, true);
      canvas.removeEventListener('lostpointercapture', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key);
    },
  };
}

interface SpatialViewProps {
  world: RoboticsFieldGeometry;
  subject?: 'field' | 'robot';
  state?: RoboticsWorldState | undefined;
  distance?: RoboticsDistanceMeasurement | undefined;
  selection?: RoboticsObjectKey | null;
  view: FieldView;
  showGrid?: boolean;
  active?: boolean;
  onSelect?: ((key: RoboticsObjectKey) => void) | undefined;
  edit?: SpatialEdit | undefined;
  topProjection?: { camera: FieldCamera; viewport: FieldViewport } | undefined;
  onReady?: ((ready: boolean) => void) | undefined;
  onControls?: ((controls: FieldViewportControls | null) => void) | undefined;
  onZoom?: ((zoom: number) => void) | undefined;
}

interface SceneProps {
  world: RoboticsFieldGeometry;
  subject: 'field' | 'robot';
  state: RoboticsWorldState | undefined;
  distance: RoboticsDistanceMeasurement | undefined;
  selection: RoboticsObjectKey | null;
  showGrid: boolean;
  active: boolean;
  view: FieldView;
  onSelect: SpatialViewProps['onSelect'];
  edit: SpatialViewProps['edit'];
  topProjection: SpatialViewProps['topProjection'];
  onReady: SpatialViewProps['onReady'];
  onZoom: SpatialViewProps['onZoom'];
}

function createViewport(
  canvas: HTMLCanvasElement,
  getProps: () => SceneProps,
  setUnavailable: (unavailable: boolean) => void,
  setScale: (scale: SideMetricScale | null) => void,
) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.localClippingEnabled = true;
  renderer.setClearColor(SPATIAL_FIELD_BACKGROUND);

  const perspective = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
  const top = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 200);
  const front = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 200);
  front.up.set(0, 0, 1);
  top.up.set(0, 1, 0);
  const side = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 200);
  perspective.up.set(0, 0, 1);
  side.up.set(0, 0, 1);

  let selectedView: FieldView | null = null;
  let controls: OrbitControls | null = null;
  let drawing = null as
    ReturnType<typeof createFieldSpatialScene> | ReturnType<typeof createRobotSpatialScene> | null;
  let source: RoboticsFieldGeometry | null = null;
  const size = new THREE.Vector2();
  let visible = false;
  let frame = 0;
  let disposed = false;
  let contextLost = false;
  let renderFailed = false;
  let press: { x: number; y: number; pointerId: number } | null = null;
  let preview: SpatialObjectPreview | null = null;
  const cameraPointers = new Set<number>();
  const point = new THREE.Vector2();
  const viewOffset = new THREE.Vector3();
  const angles = new THREE.Spherical();
  const cameraTargets = {
    top: new THREE.Vector3(),
    orbit: new THREE.Vector3(),
    side: new THREE.Vector3(),
    front: new THREE.Vector3(),
  };
  const fittedViews = new Set<FieldView>();

  function releaseCameraPointers(): void {
    const ids = [...cameraPointers];
    cameraPointers.clear();
    for (const id of ids) if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
  }
  function suspendRobotControls(): void {
    if (getProps().subject !== 'robot') return;
    if (selectedView && controls) cameraTargets[selectedView].copy(controls.target);
    controls?.dispose();
    controls = null;
    releaseCameraPointers();
    canvas.style.cursor = '';
    press = null;
  }

  function camera(): ViewportCamera {
    return selectedView === 'top'
      ? top
      : selectedView === 'side'
        ? side
        : selectedView === 'front'
          ? front
          : perspective;
  }

  function projection(): void {
    const aspect = size.x / Math.max(1, size.y);
    const { widthMeters: width, heightMeters: height } = getProps().world.field;
    if (getProps().subject === 'robot') {
      perspective.aspect = aspect;
      perspective.updateProjectionMatrix();
      if (drawing) {
        const diameter = drawing.readFocus('robot', new THREE.Vector3());
        const limits = robotOrbitBounds(diameter, aspect, perspective.fov);
        perspective.far = limits.far;
        perspective.updateProjectionMatrix();
        if (controls && selectedView === 'orbit') {
          controls.minDistance = limits.minimum;
          controls.maxDistance = limits.maximum;
        }
        if (fittedViews.has('orbit')) {
          const target =
            selectedView === 'orbit' && controls ? controls.target : cameraTargets.orbit;
          const offset = perspective.position.clone().sub(target);
          const nextFit = robotOrbitDistance(diameter, aspect, perspective.fov);
          // Preserve angle, pan and magnification while the viewport aspect changes.
          if (offset.length() > 0) {
            const distance = THREE.MathUtils.clamp(
              (offset.length() * nextFit) / orbitFitDistance,
              limits.minimum,
              limits.maximum,
            );
            perspective.position.copy(target).add(offset.setLength(distance));
          }
          orbitFitDistance = nextFit;
          perspective.updateMatrixWorld(true);
        }
        const span = diameter * 1.18;
        for (const ortho of [top, side, front]) {
          ortho.top = span / Math.min(1, aspect) / 2;
          ortho.bottom = -ortho.top;
          ortho.right = ortho.top * aspect;
          ortho.left = -ortho.right;
          ortho.near = 0.001;
          ortho.updateProjectionMatrix();
        }
      }
      return;
    }
    const reference = getProps().topProjection;
    if (reference) configureTopCamera(top, reference.camera, reference.viewport);
    perspective.aspect = aspect;
    perspective.updateProjectionMatrix();
    const verticalSpan = Math.max(1.25, width / Math.max(aspect, 0.01)) * 1.22;
    side.left = (-verticalSpan * aspect) / 2;
    side.right = -side.left;
    side.top = verticalSpan / 2;
    side.bottom = -side.top;
    side.far = Math.max(width, height) * 4 + 10;
    side.updateProjectionMatrix();
  }

  function invalidate(): void {
    if (disposed) return;
    if (
      renderFailed ||
      contextLost ||
      !visible ||
      !getProps().active ||
      !drawing ||
      (getProps().subject === 'field' && getProps().view === 'top' && !getProps().topProjection) ||
      size.x <= 0 ||
      size.y <= 0
    ) {
      setScale(null);
      return;
    }
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (disposed || contextLost || !visible || !getProps().active || !drawing) return;
      try {
        renderer.render(drawing.scene, camera());
        canvas.dataset.rendered = 'true';
        canvas.dataset.gridRendered = String(getProps().showGrid);
        canvas.dataset.robotGeometry = JSON.stringify(drawing.robotGeometry);
        canvas.dataset.renderCount = String(Number(canvas.dataset.renderCount ?? 0) + 1);
        canvas.dataset.projection = JSON.stringify(camera().projectionMatrix.toArray());
        getProps().onReady?.(true);
        if (getProps().subject === 'robot')
          getProps().onZoom?.(
            camera() instanceof THREE.OrthographicCamera
              ? camera().zoom
              : orbitFitDistance /
                  Math.max(0.001, perspective.position.distanceTo(controls!.target)),
          );
        else if (selectedView !== 'top')
          getProps().onZoom?.(
            selectedView === 'side'
              ? side.zoom / FIELD_CAMERA_NORMAL_MAGNIFICATION
              : orbitFitDistance /
                  Math.max(0.001, perspective.position.distanceTo(controls!.target)) /
                  FIELD_CAMERA_NORMAL_MAGNIFICATION,
          );
        // Read-only browser evidence from the actual rendered camera, never an alternate transform.
        canvas.dataset.camera = JSON.stringify([
          camera().position.toArray(),
          camera().quaternion.toArray(),
          controls?.target.toArray(),
        ]);
        canvas.dataset.editPreview = JSON.stringify(preview);
        setScale(
          readSideMetricScale(
            camera(),
            size.x,
            size.y,
            selectedView !== 'orbit' && selectedView === getProps().view,
          ),
        );
      } catch {
        fail();
      }
    });
  }

  let orbitFitDistance = 1;
  function fit(): void {
    if (!controls || !selectedView || !visible) return;
    if (getProps().subject === 'robot') {
      if (!drawing) return;
      const diameter = drawing.readFocus('robot', controls.target);
      frameRobotCamera(camera(), selectedView, controls.target, diameter, size.x, size.y);
      controls.update();
      if (selectedView === 'orbit')
        orbitFitDistance = perspective.position.distanceTo(controls.target);
      fittedViews.add(selectedView);
      invalidate();
      return;
    }
    if (selectedView === 'top') return;
    const { widthMeters: width, heightMeters: height } = getProps().world.field;
    const extent = Math.hypot(width, height);
    const aspect = size.x / Math.max(1, size.y);
    if (selectedView === 'side') {
      controls.target.set(width / 2, height / 2, 0.28);
      side.position.copy(controls.target);
      side.position.y -= extent + 3;
      side.zoom = 1;
      side.updateProjectionMatrix();
    } else {
      controls.target.set(width / 2, height / 2, 0);
      const distance =
        (extent * 0.54) /
        (Math.tan(THREE.MathUtils.degToRad(19)) * Math.min(1, Math.max(0.1, aspect)));
      orbitFitDistance = distance;
      viewOffset.set(0.72, -1, 0.98).normalize().multiplyScalar(distance);
      perspective.position.copy(controls.target).add(viewOffset);
    }
    fittedViews.add(selectedView);
    controls.update();
    if (selectedView === 'orbit')
      orbitFitDistance = perspective.position.distanceTo(controls.target);
    invalidate();
  }

  function switchView(view: FieldView): void {
    if (selectedView && controls) cameraTargets[selectedView].copy(controls.target);
    controls?.dispose();
    releaseCameraPointers();
    selectedView = view;
    controls = new OrbitControls(camera(), canvas);
    controls.enabled = view !== 'top' || getProps().subject === 'robot';
    controls.enableRotate = view === 'orbit';
    if (view === 'side' || view === 'front' || (view === 'top' && getProps().subject === 'robot')) {
      controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      controls.touches.ONE = THREE.TOUCH.PAN;
    }
    controls.enableDamping = false;
    controls.minPolarAngle = 0.08;
    controls.maxPolarAngle = getProps().subject === 'robot' ? Math.PI - 0.08 : Math.PI / 2;
    const robotLimits =
      getProps().subject === 'robot' && drawing
        ? robotOrbitBounds(
            drawing.readFocus('robot', new THREE.Vector3()),
            size.x / size.y,
            perspective.fov,
          )
        : null;
    controls.minDistance = robotLimits?.minimum ?? 0.2;
    controls.maxDistance = robotLimits?.maximum ?? 180;
    controls.minZoom = 0.4;
    controls.maxZoom = 18;
    controls.addEventListener('change', invalidate);
    if (fittedViews.has(view)) {
      controls.target.copy(cameraTargets[view]);
      controls.update();
    } else if (getProps().subject === 'robot') {
      fit();
    } else if (view !== 'top') {
      fit();
      // Normal 100% is twice the former whole-field fit, centred on the real subject.
      const pose = getProps().state?.pose ?? getProps().world.initialPose;
      const delta = new THREE.Vector3(pose.xMeters, pose.yMeters, controls.target.z).sub(
        controls.target,
      );
      camera().position.add(delta);
      controls.target.add(delta);
      zoom(FIELD_CAMERA_NORMAL_MAGNIFICATION);
    }
  }

  function setSize(width: number, height: number): void {
    const wasVisible = visible;
    visible = width > 0 && height > 0;
    if (!visible) {
      gestures.cancel();
      suspendRobotControls();
      if (controls) controls.enabled = false;
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      setScale(null);
      return;
    }
    if (size.x !== width || size.y !== height) {
      gestures.cancel();
      size.set(width, height);
      renderer.setSize(width, height, false);
      projection();
      if (selectedView && !fittedViews.has(selectedView)) fit();
    }
    if (!wasVisible) update();
    invalidate();
  }

  function update(): void {
    gestures.sync();
    const { world, state, distance, showGrid, selection, active, view } = getProps();
    if (!active || !visible || disposed || contextLost || renderFailed) {
      gestures.cancel();
      suspendRobotControls();
      if (controls) controls.enabled = false;
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      if (!disposed) setScale(null);
      return;
    }
    if (controls) controls.enabled = view !== 'top' || getProps().subject === 'robot';
    if (source !== world && (getProps().subject !== 'robot' || source?.robot !== world.robot)) {
      const resize =
        !source ||
        source.field.widthMeters !== world.field.widthMeters ||
        source.field.heightMeters !== world.field.heightMeters;
      suspendRobotControls();
      drawing?.dispose();
      drawing =
        getProps().subject === 'robot'
          ? createRobotSpatialScene(world)
          : createFieldSpatialScene(world, invalidate);
      source = world;
      if (resize || getProps().subject === 'robot') {
        fittedViews.clear();
        projection();
        fit();
      }
    }
    if (selectedView !== view || !controls) switchView(view);
    if (view === 'top') projection();
    drawing?.applySnapshot(state, distance, showGrid, selection, preview);
    invalidate();
  }

  function zoom(factor: number): void {
    gestures.cancel();
    if (
      !controls ||
      !interactive() ||
      (selectedView === 'top' && getProps().subject === 'field') ||
      !Number.isFinite(factor) ||
      factor <= 0
    )
      return;
    if (getProps().subject === 'robot' && camera() instanceof THREE.OrthographicCamera) {
      const ortho = camera() as THREE.OrthographicCamera;
      ortho.zoom = THREE.MathUtils.clamp(ortho.zoom * factor, controls.minZoom, controls.maxZoom);
      ortho.updateProjectionMatrix();
    } else if (selectedView === 'side') {
      side.zoom = THREE.MathUtils.clamp(side.zoom * factor, controls.minZoom, controls.maxZoom);
      side.updateProjectionMatrix();
    } else {
      viewOffset.copy(perspective.position).sub(controls.target);
      const distance = THREE.MathUtils.clamp(
        viewOffset.length() / factor,
        controls.minDistance,
        controls.maxDistance,
      );
      perspective.position.copy(controls.target).add(viewOffset.setLength(distance));
    }
    controls.update();
    invalidate();
  }

  function nudge(horizontal: number, vertical: number): void {
    gestures.cancel();
    if (!controls || !interactive() || (selectedView === 'top' && getProps().subject === 'field'))
      return;
    if (getProps().subject === 'robot' && selectedView !== 'orbit') {
      const ortho = camera() as THREE.OrthographicCamera;
      viewOffset
        .set(horizontal, vertical, 0)
        .applyQuaternion(ortho.quaternion)
        .multiplyScalar((ortho.right - ortho.left) / ortho.zoom / 12);
      ortho.position.add(viewOffset);
      controls.target.add(viewOffset);
      controls.update();
      invalidate();
      return;
    }
    if (selectedView === 'side') {
      const distance = (side.right - side.left) / side.zoom / 12;
      side.position.x += horizontal * distance;
      side.position.z += vertical * distance;
      controls.target.x += horizontal * distance;
      controls.target.z += vertical * distance;
    } else {
      // Three's spherical angles are Y-up. Swap the Y/Z components for the canonical Z-up field.
      viewOffset.copy(perspective.position).sub(controls.target);
      angles.setFromCartesianCoords(viewOffset.x, viewOffset.z, -viewOffset.y);
      angles.theta += horizontal * 0.16;
      angles.phi = THREE.MathUtils.clamp(
        angles.phi - vertical * 0.16,
        controls.minPolarAngle,
        controls.maxPolarAngle,
      );
      viewOffset.setFromSpherical(angles);
      perspective.position
        .copy(controls.target)
        .add(new THREE.Vector3(viewOffset.x, -viewOffset.z, viewOffset.y));
    }
    controls.update();
    invalidate();
  }

  function focus(requested?: RoboticsObjectKey): void {
    gestures.cancel();
    if (getProps().subject === 'robot') {
      fit();
      return;
    }
    if (!controls || !drawing || !interactive() || selectedView === 'top') return;
    const key = requested ?? getProps().selection ?? 'robot';
    viewOffset.copy(camera().position).sub(controls.target);
    const span = Math.max(0.85, drawing.readFocus(key, controls.target) * 1.45);
    if (selectedView === 'side') {
      side.position.copy(controls.target).add(viewOffset);
      side.zoom = THREE.MathUtils.clamp(
        Math.min(side.right - side.left, side.top - side.bottom) / span,
        controls.minZoom,
        controls.maxZoom,
      );
      side.updateProjectionMatrix();
    } else {
      const aspect = size.x / size.y;
      const distance = span / (2 * Math.tan(THREE.MathUtils.degToRad(19)) * Math.min(1, aspect));
      perspective.position.copy(controls.target).add(viewOffset.setLength(distance));
    }
    controls.update();
    invalidate();
  }

  function interactive(): boolean {
    return !disposed && !renderFailed && !contextLost && visible && getProps().active;
  }
  function fail(): void {
    // Invalidate ownership before publishing fallback. A late release can never commit
    // an invisible draft, even before React processes the unavailable state.
    renderFailed = true;
    suspendRobotControls();
    canvas.dataset.rendered = 'false';
    press = null;
    gestures.cancel();
    preview = null;
    canvas.dataset.editPreview = 'null';
    if (controls) controls.enabled = false;
    setScale(null);
    getProps().onReady?.(false);
    setUnavailable(true);
  }
  function hit(x: number, y: number) {
    if (!interactive() || !drawing) return undefined;
    const area = canvas.getBoundingClientRect();
    if (area.width <= 0 || area.height <= 0) return undefined;
    point.set(((x - area.left) / area.width) * 2 - 1, 1 - ((y - area.top) / area.height) * 2);
    drawing.scene.updateMatrixWorld(true);
    camera().updateMatrixWorld(true);
    return drawing.pickHit(point, camera());
  }
  const gestures = bindSpatialFieldGestures(canvas, {
    current: () => ({
      world: getProps().world,
      enabled: interactive() && getProps().subject === 'field' && getProps().view === 'orbit',
      edit: getProps().edit,
      controls,
    }),
    hit,
    project: (x, y, z) => spatialEditPoint(camera(), canvas.getBoundingClientRect(), x, y, z),
    preview: (next) => {
      preview = next;
      update();
    },
    select: (key) => getProps().onSelect?.(key),
    resetControls: () => {
      if (selectedView && !disposed) switchView(selectedView);
    },
  });
  function pointerDown(event: PointerEvent): void {
    if (getProps().subject === 'robot' && interactive()) cameraPointers.add(event.pointerId);
    if (!interactive() || gestures.owns() || !event.isPrimary || event.button !== 0) {
      press = null;
      return;
    }
    press = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  }
  function pointerUp(event: PointerEvent): void {
    cameraPointers.delete(event.pointerId);
    const start = press;
    press = null;
    if (
      !start ||
      start.pointerId !== event.pointerId ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5
    )
      return;
    const picked = hit(event.clientX, event.clientY);
    if (picked) getProps().onSelect?.(picked.key);
  }
  function pointerCancel(event: PointerEvent): void {
    cameraPointers.delete(event.pointerId);
    press = null;
  }

  function loseContext(event: Event): void {
    event.preventDefault();
    gestures.cancel();
    suspendRobotControls();
    contextLost = true;
    canvas.dataset.rendered = 'false';
    setScale(null);
    getProps().onReady?.(false);
    setUnavailable(true);
  }

  function restoreContext(): void {
    contextLost = false;
    renderFailed = false;
    if (controls) controls.enabled = selectedView !== 'top' || getProps().subject === 'robot';
    setUnavailable(false);
    update();
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerCancel);
  canvas.addEventListener('webglcontextlost', loseContext);
  canvas.addEventListener('webglcontextrestored', restoreContext);
  const resize = new ResizeObserver(([entry]) => {
    if (entry) setSize(entry.contentRect.width, entry.contentRect.height);
  });
  resize.observe(canvas);

  function dispose(): void {
    disposed = true;
    gestures.dispose();
    if (frame) window.cancelAnimationFrame(frame);
    resize.disconnect();
    canvas.removeEventListener('pointerdown', pointerDown);
    canvas.removeEventListener('pointerup', pointerUp);
    canvas.removeEventListener('pointercancel', pointerCancel);
    canvas.removeEventListener('webglcontextlost', loseContext);
    canvas.removeEventListener('webglcontextrestored', restoreContext);
    controls?.dispose();
    releaseCameraPointers();
    drawing?.dispose();
    renderer.dispose();
  }

  return {
    update,
    fail,
    fit: () => {
      gestures.cancel();
      fit();
    },
    focus,
    zoom,
    nudge,
    dispose,
  };
}

export default function RobotFieldSpatialView({
  world,
  subject = 'field',
  state,
  distance,
  selection = null,
  view,
  showGrid = true,
  active = true,
  onSelect,
  edit,
  topProjection,
  onReady,
  onControls,
  onZoom,
}: SpatialViewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const props = useRef<SceneProps>({
    world,
    subject,
    state,
    distance,
    selection,
    showGrid,
    view,
    active,
    onSelect,
    edit,
    topProjection,
    onReady,
    onZoom,
  });
  props.current = {
    world,
    subject,
    state,
    distance,
    selection,
    showGrid,
    view,
    active,
    onSelect,
    edit,
    topProjection,
    onReady,
    onZoom,
  };
  const viewport = useRef<ReturnType<typeof createViewport> | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [scale, setScale] = useState<SideMetricScale | null>(null);
  useEffect(() => {
    const element = canvas.current;
    // A pending lazy module may finish after its tab was hidden. Allocate only
    // on an active visit; retain the initialized viewport until real unmount.
    if (!element || !active || viewport.current) return;
    try {
      viewport.current = createViewport(
        element,
        () => props.current,
        setUnavailable,
        (next) => {
          setScale((previous) => {
            if (!previous || !next) return previous === next ? previous : next;
            return previous.meters === next.meters &&
              previous.cssPixels === next.cssPixels &&
              previous.projection.every((value, index) => value === next.projection[index])
              ? previous
              : next;
          });
        },
      );
      onControls?.(viewport.current);
    } catch {
      onReady?.(false);
      setUnavailable(true);
    }
  }, [active]);

  useEffect(
    () => () => {
      onControls?.(null);
      onReady?.(false);
      viewport.current?.dispose();
      viewport.current = null;
    },
    [],
  );

  useEffect(() => {
    try {
      viewport.current?.update();
    } catch {
      viewport.current?.fail();
    }
  }, [
    world,
    state,
    distance,
    selection,
    showGrid,
    view,
    active,
    Boolean(edit),
    topProjection,
    subject,
  ]);

  function keyDown(event: KeyboardEvent<HTMLCanvasElement>): void {
    switch (event.key) {
      case 'Home':
        if (event.shiftKey) viewport.current?.focus();
        else viewport.current?.fit();
        break;
      case '-':
        viewport.current?.zoom(1 / 1.25);
        break;
      case '+':
      case '=':
        viewport.current?.zoom(1.25);
        break;
      case 'ArrowLeft':
        viewport.current?.nudge(-1, 0);
        break;
      case 'ArrowRight':
        viewport.current?.nudge(1, 0);
        break;
      case 'ArrowUp':
        viewport.current?.nudge(0, 1);
        break;
      case 'ArrowDown':
        viewport.current?.nudge(0, -1);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  const pose = state?.pose ?? world.initialPose;
  return (
    <div
      className="robotics-field-spatial"
      data-testid={subject === 'robot' ? 'robotics-assembly-spatial' : 'robotics-field-spatial'}
      data-renderer={unavailable ? 'fallback' : 'webgl'}
      data-field-view={view}
      data-coordinate-frame={subject === 'robot' ? 'construction-local' : 'world'}
      data-microseconds={subject === 'field' ? (state?.atMicroseconds ?? 0) : undefined}
      data-physics-microseconds={
        subject === 'field' ? (state?.physicsAtMicroseconds ?? 0) : undefined
      }
      data-x-meters={subject === 'field' ? pose.xMeters : undefined}
      data-y-meters={subject === 'field' ? pose.yMeters : undefined}
      data-heading-radians={subject === 'field' ? pose.headingRadians : undefined}
    >
      <canvas
        ref={canvas}
        tabIndex={unavailable || !active || (view === 'top' && subject === 'field') ? -1 : 0}
        onKeyDown={keyDown}
        aria-hidden={unavailable || (view === 'top' && subject === 'field')}
        aria-label={
          subject === 'robot'
            ? 'Конструкция робота, объёмный просмотр'
            : view === 'side'
              ? 'Поле робота, вид сбоку'
              : 'Поле робота, объёмный вид'
        }
      />
      {subject === 'field' && view !== 'orbit' && active && !unavailable && scale ? (
        <div
          className="robotics-side-scale"
          data-testid={view === 'side' ? 'robotics-side-scale' : 'robotics-top-scale'}
          data-meters={scale.meters}
          data-projection={JSON.stringify(scale.projection)}
          role="img"
          aria-label={
            (view === 'side' ? 'Масштаб бокового вида: ' : 'Масштаб вида сверху: ') + scale.label
          }
        >
          <span
            className="robotics-side-scale-bar"
            data-testid="robotics-side-scale-bar"
            style={{ inlineSize: scale.cssPixels }}
            aria-hidden="true"
          />
          <span aria-hidden="true">{scale.label}</span>
        </div>
      ) : null}
      {unavailable && subject === 'field' && view !== 'top' ? (
        <p className="robotics-spatial-notice" role="status">
          Объёмный вид недоступен. Выберите «Сверху» для работы с полем.
        </p>
      ) : null}
    </div>
  );
}
