import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { RoboticsObjectKey } from '@asa-lab/robotics/world-document';
import type { RoboticsFieldGeometry } from './RobotField';
import { createFieldSpatialScene, SPATIAL_FIELD_BACKGROUND } from './field-spatial-scene';
import type { RoboticsDistanceMeasurement, RoboticsWorldState } from './world';

type FieldView = 'orbit' | 'side';
type ViewportCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

interface SpatialViewProps {
  world: RoboticsFieldGeometry;
  state?: RoboticsWorldState | undefined;
  distance?: RoboticsDistanceMeasurement | undefined;
  selection?: RoboticsObjectKey | null;
  view: FieldView;
  showGrid?: boolean;
  active?: boolean;
  onSelect?: ((key: RoboticsObjectKey) => void) | undefined;
}

interface SceneProps {
  world: RoboticsFieldGeometry;
  state: RoboticsWorldState | undefined;
  distance: RoboticsDistanceMeasurement | undefined;
  selection: RoboticsObjectKey | null;
  showGrid: boolean;
  active: boolean;
  view: FieldView;
  onSelect: SpatialViewProps['onSelect'];
}

function createViewport(
  canvas: HTMLCanvasElement,
  getProps: () => SceneProps,
  setUnavailable: (unavailable: boolean) => void,
) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.localClippingEnabled = true;
  renderer.setClearColor(SPATIAL_FIELD_BACKGROUND);

  const perspective = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
  const side = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 200);
  perspective.up.set(0, 0, 1);
  side.up.set(0, 0, 1);

  let selectedView: FieldView | null = null;
  let controls: OrbitControls | null = null;
  let drawing = null as ReturnType<typeof createFieldSpatialScene> | null;
  let source: RoboticsFieldGeometry | null = null;
  const size = new THREE.Vector2();
  let visible = false;
  let frame = 0;
  let disposed = false;
  let contextLost = false;
  let renderFailed = false;
  let press: { x: number; y: number; pointerId: number } | null = null;
  const point = new THREE.Vector2();
  const viewOffset = new THREE.Vector3();
  const angles = new THREE.Spherical();
  const cameraTargets = { orbit: new THREE.Vector3(), side: new THREE.Vector3() };
  const fittedViews = new Set<FieldView>();

  function camera(): ViewportCamera {
    return selectedView === 'side' ? side : perspective;
  }

  function projection(): void {
    const aspect = size.x / Math.max(1, size.y);
    const { widthMeters: width, heightMeters: height } = getProps().world.field;
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
    if (
      frame ||
      disposed ||
      renderFailed ||
      contextLost ||
      !visible ||
      !getProps().active ||
      !drawing ||
      size.x <= 0 ||
      size.y <= 0
    )
      return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (disposed || contextLost || !visible || !getProps().active || !drawing) return;
      try {
        renderer.render(drawing.scene, camera());
      } catch {
        renderFailed = true;
        setUnavailable(true);
      }
    });
  }

  function fit(): void {
    if (!controls || !selectedView || !visible) return;
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
      viewOffset.set(0.72, -1, 0.98).normalize().multiplyScalar(distance);
      perspective.position.copy(controls.target).add(viewOffset);
    }
    fittedViews.add(selectedView);
    controls.update();
    invalidate();
  }

  function switchView(view: FieldView): void {
    if (selectedView && controls) cameraTargets[selectedView].copy(controls.target);
    controls?.dispose();
    selectedView = view;
    controls = new OrbitControls(camera(), canvas);
    controls.enableRotate = view === 'orbit';
    if (view === 'side') {
      controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      controls.touches.ONE = THREE.TOUCH.PAN;
    }
    controls.enableDamping = false;
    controls.minPolarAngle = 0.08;
    controls.maxPolarAngle = Math.PI / 2;
    controls.minDistance = 0.2;
    controls.maxDistance = 180;
    controls.minZoom = 0.4;
    controls.maxZoom = 18;
    controls.addEventListener('change', invalidate);
    if (fittedViews.has(view)) {
      controls.target.copy(cameraTargets[view]);
      controls.update();
    } else {
      fit();
    }
  }

  function setSize(width: number, height: number): void {
    const wasVisible = visible;
    visible = width > 0 && height > 0;
    if (!visible) return;
    if (size.x !== width || size.y !== height) {
      size.set(width, height);
      renderer.setSize(width, height, false);
      projection();
      if (selectedView && !fittedViews.has(selectedView)) fit();
    }
    if (!wasVisible) update();
    invalidate();
  }

  function update(): void {
    const { world, state, distance, showGrid, selection, active, view } = getProps();
    if (!active || !visible || disposed || contextLost || renderFailed) return;
    if (source !== world) {
      const resize =
        !source ||
        source.field.widthMeters !== world.field.widthMeters ||
        source.field.heightMeters !== world.field.heightMeters;
      drawing?.dispose();
      drawing = createFieldSpatialScene(world, invalidate);
      source = world;
      if (resize) {
        fittedViews.clear();
        projection();
        fit();
      }
    }
    if (selectedView !== view) switchView(view);
    drawing?.applySnapshot(state, distance, showGrid, selection);
    invalidate();
  }

  function zoom(factor: number): void {
    if (!controls) return;
    if (selectedView === 'side') {
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
    if (!controls) return;
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

  function focus(): void {
    if (!controls || !drawing || !visible) return;
    const key = getProps().selection ?? 'robot';
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

  function pointerDown(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0) {
      press = null;
      return;
    }
    press = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  }

  function pointerUp(event: PointerEvent): void {
    const start = press;
    press = null;
    if (
      !start ||
      start.pointerId !== event.pointerId ||
      Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5 ||
      !drawing ||
      !getProps().onSelect
    )
      return;
    const area = canvas.getBoundingClientRect();
    if (area.width <= 0 || area.height <= 0) return;
    point.set(
      ((event.clientX - area.left) / area.width) * 2 - 1,
      1 - ((event.clientY - area.top) / area.height) * 2,
    );
    drawing.scene.updateMatrixWorld(true);
    const currentCamera = camera();
    currentCamera.updateMatrixWorld(true);
    const key = drawing.pick(point, currentCamera);
    if (key) getProps().onSelect?.(key);
  }

  function pointerCancel(): void {
    press = null;
  }

  function loseContext(event: Event): void {
    event.preventDefault();
    contextLost = true;
    setUnavailable(true);
  }

  function restoreContext(): void {
    contextLost = false;
    renderFailed = false;
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
    if (frame) window.cancelAnimationFrame(frame);
    resize.disconnect();
    canvas.removeEventListener('pointerdown', pointerDown);
    canvas.removeEventListener('pointerup', pointerUp);
    canvas.removeEventListener('pointercancel', pointerCancel);
    canvas.removeEventListener('webglcontextlost', loseContext);
    canvas.removeEventListener('webglcontextrestored', restoreContext);
    controls?.dispose();
    drawing?.dispose();
    renderer.dispose();
  }

  return { update, fit, focus, zoom, nudge, dispose };
}

export default function RobotFieldSpatialView({
  world,
  state,
  distance,
  selection = null,
  view,
  showGrid = true,
  active = true,
  onSelect,
}: SpatialViewProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const props = useRef<SceneProps>({
    world,
    state,
    distance,
    selection,
    showGrid,
    view,
    active,
    onSelect,
  });
  props.current = { world, state, distance, selection, showGrid, view, active, onSelect };
  const viewport = useRef<ReturnType<typeof createViewport> | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    try {
      viewport.current = createViewport(element, () => props.current, setUnavailable);
    } catch {
      setUnavailable(true);
    }
    return () => {
      viewport.current?.dispose();
      viewport.current = null;
    };
  }, []);

  useEffect(() => {
    try {
      viewport.current?.update();
    } catch {
      setUnavailable(true);
    }
  }, [world, state, distance, selection, showGrid, view, active]);

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
      data-testid="robotics-field-spatial"
      data-field-view={view}
      data-microseconds={state?.atMicroseconds ?? 0}
      data-physics-microseconds={state?.physicsAtMicroseconds ?? 0}
      data-x-meters={pose.xMeters}
      data-y-meters={pose.yMeters}
      data-heading-radians={pose.headingRadians}
    >
      <canvas
        ref={canvas}
        tabIndex={unavailable ? -1 : 0}
        onKeyDown={keyDown}
        aria-hidden={unavailable}
        aria-label={view === 'side' ? 'Поле робота, вид сбоку' : 'Поле робота, объёмный вид'}
      />
      {unavailable ? (
        <p className="robotics-spatial-notice" role="status">
          Объёмный вид недоступен. Выберите «Сверху» для работы с полем.
        </p>
      ) : (
        <div className="robotics-spatial-controls" role="group" aria-label="Камера объёмного вида">
          <button
            type="button"
            className="robotics-button"
            aria-label="Отдалить объёмный вид"
            onClick={() => viewport.current?.zoom(1 / 1.25)}
          >
            −
          </button>
          <button
            type="button"
            className="robotics-button"
            aria-label="Приблизить объёмный вид"
            onClick={() => viewport.current?.zoom(1.25)}
          >
            +
          </button>
          <button
            type="button"
            className="robotics-button"
            aria-label="Показать всё поле в объёмном виде"
            onClick={() => viewport.current?.fit()}
          >
            Всё
          </button>
          <button
            type="button"
            className="robotics-button"
            aria-label={
              selection && selection !== 'robot'
                ? 'К выбранному предмету в объёмном виде'
                : 'К роботу в объёмном виде'
            }
            title="Приблизить выбранный предмет или робота (Shift+Home)"
            onClick={() => viewport.current?.focus()}
          >
            {selection && selection !== 'robot' ? 'Объект' : 'Робот'}
          </button>
        </div>
      )}
    </div>
  );
}
