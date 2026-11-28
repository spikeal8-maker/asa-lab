import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// eslint-disable-next-line @nx/enforce-module-boundaries -- This isolated TEST_ONLY entry uses the immutable qualification geometry.
import {
  createEditableRampGeometry,
  rampRiseForAngle,
} from '../../../../../../tests/robotics/field-core-qualification/editable-ramp-geometry';

export const RUN = 0.8;
export const BASE = 0.05;
export const FIELD_WIDTH = 2.4;
export const FIELD_DEPTH = 1.6;
const MIME = 'application/x-asa-passive-ramp';
const RAD = Math.PI / 180;

type View = 'top' | 'orbit' | 'side';
type Role = 'committed' | 'preview';

export interface Ramp {
  x: number;
  y: number;
  width: number;
  rise: number;
}

const initial: Ramp = { x: 0.55, y: 0.55, width: 0.4, rise: 0.18 };
const rounded = (value: number) => Math.round(value * 1000) / 1000;

export function rampGeometry(ramp: Ramp) {
  if (!Object.values(ramp).every(Number.isFinite) || ramp.rise > 1)
    throw new Error('Некорректные размеры горки');
  return createEditableRampGeometry({
    lengthMeters: RUN,
    baseThicknessMeters: BASE,
    widthMeters: ramp.width,
    riseMeters: ramp.rise,
    originMeters: [ramp.x, ramp.y, 0],
    headingRadians: 0,
  });
}

export function footprintFits(ramp: Ramp): boolean {
  return rampGeometry(ramp).plan.every(
    ([x, y]) => x >= 0 && y >= 0 && x <= FIELD_WIDTH && y <= FIELD_DEPTH,
  );
}

export function riseForDegrees(angle: number): number {
  return rampRiseForAngle(RUN, angle * RAD);
}

export function projectAnchor(
  camera: THREE.Camera,
  view: View,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  clientX: number,
  clientY: number,
  depth: number,
): Pick<Ramp, 'x' | 'y'> | null {
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (![x, y, depth].every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  const ray = new THREE.Raycaster();
  camera.updateMatrixWorld();
  ray.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), camera);
  // A level Side ray does not resolve depth. Intersect the explicitly selected
  // Y plane and keep the ramp base at the reference Z regardless of cursor height.
  const plane =
    view === 'side'
      ? new THREE.Plane(new THREE.Vector3(0, 1, 0), -depth)
      : new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  if (Math.abs(ray.ray.direction.dot(plane.normal)) < 1e-9) return null;
  const point = ray.ray.intersectPlane(plane, new THREE.Vector3());
  return point ? { x: rounded(point.x), y: view === 'side' ? depth : rounded(point.y) } : null;
}

function install(root: HTMLElement): void {
  function required<T extends HTMLElement>(id: string): T {
    const item = root.querySelector<T>('#' + id);
    if (!item) throw new Error('Не найден элемент редактора ' + id);
    return item;
  }

  const canvas = required<HTMLCanvasElement>('ramp-passive-canvas');
  const palette = required<HTMLButtonElement>('ramp-palette');
  const confirm = required<HTMLButtonElement>('ramp-confirm');
  const status = required('ramp-status');
  const help = required('ramp-help');
  const defaultHelp = help.textContent;
  const angleInput = required<HTMLInputElement>('ramp-angle');
  const inputs = {
    x: required<HTMLInputElement>('ramp-x'),
    y: required<HTMLInputElement>('ramp-y'),
    width: required<HTMLInputElement>('ramp-width'),
    rise: required<HTMLInputElement>('ramp-rise'),
  };
  const cameraButtons = [...root.querySelectorAll<HTMLButtonElement>('[data-view-choice]')];
  let view: View = 'top';
  let draft: Ramp | null = initial;
  let committed: Ramp | null = null;
  let preview: Ramp | null = null;
  let placement: 'drag' | 'choose' | null = null;
  let pendingPointer: number | null = null;
  let invalid = false;
  let dragImage: HTMLCanvasElement | null = null;
  let enteredDrag = false;
  let frame = 0;
  let orbitAspectScale = 1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x263a49);
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch {
    status.textContent = 'Для тестового поля требуется WebGL';
    palette.disabled = confirm.disabled = true;
    cameraButtons.forEach((button) => (button.disabled = true));
    return;
  }

  const center = new THREE.Vector3(FIELD_WIDTH / 2, FIELD_DEPTH / 2, 0);
  const top = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 25);
  top.position.set(center.x, center.y, 5);
  top.up.set(0, 1, 0);
  top.lookAt(center);
  const side = top.clone();
  side.position.set(center.x, -5, 0.39);
  side.up.set(0, 0, 1);
  side.lookAt(center.x, center.y, 0.39);
  const orbit = new THREE.PerspectiveCamera(42, 1, 0.01, 25);
  orbit.up.set(0, 0, 1);
  orbit.position.set(3.25, -3.15, 2.95);
  const controls = new OrbitControls(orbit, canvas);
  controls.target.copy(center);
  controls.update();
  controls.addEventListener('change', schedule);
  controls.minDistance = 0.7;
  controls.maxDistance = 10;
  controls.enabled = false;
  const camera = () => (view === 'top' ? top : view === 'side' ? side : orbit);

  scene.add(new THREE.HemisphereLight(0xf6faff, 0x243935, 2.35));
  const sun = new THREE.DirectionalLight(0xffefdc, 2);
  sun.position.set(2, -3, 6);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD_WIDTH, FIELD_DEPTH),
    new THREE.MeshStandardMaterial({ color: 0x344d54, side: THREE.DoubleSide }),
  );
  ground.position.set(center.x, center.y, -BASE);
  scene.add(ground);
  const grid: number[] = [];
  for (let i = 0; i <= 12; i++)
    grid.push(i / 5, 0, -BASE + 0.001, i / 5, FIELD_DEPTH, -BASE + 0.001);
  for (let i = 0; i <= 8; i++)
    grid.push(0, i / 5, -BASE + 0.001, FIELD_WIDTH, i / 5, -BASE + 0.001);
  const fixedMaterial = new THREE.LineBasicMaterial({
    color: 0x7f9da4,
    transparent: true,
    opacity: 0.54,
  });
  const lines = (vertices: number[], material: THREE.LineBasicMaterial) =>
    new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute(
        'position',
        new THREE.Float32BufferAttribute(vertices, 3),
      ),
      material,
    );
  const gridMesh = lines(grid, fixedMaterial);
  const datum = lines([0, 0, 0, FIELD_WIDTH, 0, 0], fixedMaterial);
  scene.add(gridMesh, datum);

  const material = {
    committed: new THREE.MeshStandardMaterial({
      color: 0x49b5ae,
      roughness: 0.62,
      flatShading: true,
    }),
    preview: new THREE.MeshStandardMaterial({
      color: 0xeff483,
      roughness: 0.75,
      flatShading: true,
      transparent: true,
      opacity: 0.66,
      depthWrite: false,
    }),
  };
  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xc9ffce });
  const model: Record<Role, { ramp: Ramp; mesh: THREE.Mesh } | null> = {
    committed: null,
    preview: null,
  };

  function updateMesh(role: Role, ramp: Ramp | null) {
    const existing = model[role];
    if (existing && ramp && sameRamp(existing.ramp, ramp)) return;
    if (existing) {
      scene.remove(existing.mesh);
      existing.mesh.geometry.dispose();
      existing.mesh.children.forEach((child) => {
        if (child instanceof THREE.LineSegments) child.geometry.dispose();
      });
    }
    model[role] = null;
    if (!ramp) return;

    const shape = rampGeometry(ramp);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(shape.vertices.flat(), 3));
    geometry.setIndex(shape.faces.flat());
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material[role]);

    // The raised edge and upslope arrow are derived from the actual top face.
    const topPoints = shape.top.map((point) => new THREE.Vector3(...point));
    const low = topPoints[0]!.clone().lerp(topPoints[3]!, 0.5);
    const high = topPoints[1]!.clone().lerp(topPoints[2]!, 0.5);
    const tail = low.clone().lerp(high, 0.22);
    const tip = low.clone().lerp(high, 0.78);
    const elbow = low.clone().lerp(high, 0.62);
    const wing = Math.min(ramp.width * 0.24, 0.12);
    const lifted = (point: THREE.Vector3) => [point.x, point.y, point.z + 0.002];
    mesh.add(
      lines(
        [
          ...lifted(topPoints[1]!),
          ...lifted(topPoints[2]!),
          ...lifted(tail),
          ...lifted(tip),
          ...lifted(tip),
          ...lifted(elbow.clone().add(new THREE.Vector3(0, wing, 0))),
          ...lifted(tip),
          ...lifted(elbow.clone().add(new THREE.Vector3(0, -wing, 0))),
        ],
        edgeMaterial,
      ),
    );
    scene.add(mesh);
    model[role] = { ramp, mesh };
  }

  function sameRamp(a: Ramp, b: Ramp) {
    return a.x === b.x && a.y === b.y && a.rise === b.rise && a.width === b.width;
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function draw() {
    frame = 0;
    const selected = camera();
    renderer.render(scene, selected);
    canvas.dataset.view = view;
    canvas.dataset.projection = JSON.stringify(selected.projectionMatrix.toArray());
    canvas.dataset.viewMatrix = JSON.stringify(selected.matrixWorldInverse.toArray());
    canvas.dataset.rampRenders = JSON.stringify(
      (['committed', 'preview'] as const).flatMap((role) => {
        const item = model[role];
        if (!item) return [];
        const positions = item.mesh.geometry.getAttribute('position');
        const vertex = (i: number) =>
          new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(item.mesh.matrixWorld);
        return [
          {
            role,
            origin: vertex(4).lerp(vertex(7), 0.5).toArray(),
            vertices: Array.from({ length: positions.count }, (_, i) => vertex(i).toArray()),
          },
        ];
      }),
    );
  }

  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    const aspect = width / height;
    const fit = (orthographic: THREE.OrthographicCamera, sceneHeight: number) => {
      const span = Math.max(sceneHeight, (FIELD_WIDTH + 0.25) / aspect) / 2;
      orthographic.left = -span * aspect;
      orthographic.right = span * aspect;
      orthographic.top = span;
      orthographic.bottom = -span;
      orthographic.updateProjectionMatrix();
    };
    fit(top, FIELD_DEPTH + 0.27);
    fit(side, 1.2);
    const nextOrbitAspectScale = Math.max(1, 1 / aspect);
    orbit.position
      .sub(controls.target)
      .multiplyScalar(nextOrbitAspectScale / orbitAspectScale)
      .add(controls.target);
    orbitAspectScale = nextOrbitAspectScale;
    orbit.aspect = aspect;
    orbit.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(width, height, false);
    schedule();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  function refresh(message?: string) {
    controls.enabled = view === 'orbit' && placement === null;
    palette.setAttribute('aria-pressed', String(placement !== null));
    canvas.dataset.placement = invalid
      ? 'invalid'
      : preview
        ? 'preview'
        : placement
          ? 'armed'
          : 'idle';
    confirm.disabled = !draft || !footprintFits(draft);
    status.dataset.invalid = String(invalid);
    help.textContent =
      view === 'side'
        ? '← и → перемещают горку по X. Глубину Y задайте в панели. Enter подтверждает, Esc отменяет.'
        : defaultHelp;
    status.textContent =
      message ??
      (view === 'side'
        ? 'Глубина Y задаётся в панели. На поле выбирается положение X.'
        : placement
          ? 'Выберите положение горки на поле.'
          : committed
            ? 'Горка размещена.'
            : 'Перетащите горку из панели или выберите её.');
    updateMesh('committed', committed);
    updateMesh('preview', preview);
    schedule();
  }

  function writeInputs(ramp: Ramp, degrees = true) {
    for (const key of Object.keys(inputs) as (keyof Ramp)[]) inputs[key].value = String(ramp[key]);
    if (degrees) angleInput.value = (Math.atan2(ramp.rise, RUN) / RAD).toFixed(2);
  }

  function showCandidate(candidate: Ramp | null) {
    preview = candidate && footprintFits(candidate) ? candidate : null;
    invalid = !preview;
    refresh(invalid ? 'Горка выходит за границы поля' : undefined);
  }

  function readInputs(fromAngle: boolean) {
    const next = {
      x: inputs.x.valueAsNumber,
      y: inputs.y.valueAsNumber,
      width: inputs.width.valueAsNumber,
      rise: inputs.rise.valueAsNumber,
    };
    try {
      if (fromAngle) next.rise = riseForDegrees(angleInput.valueAsNumber);
      rampGeometry(next);
    } catch {
      draft = preview = null;
      invalid = true;
      refresh('Введите корректные размеры и координаты');
      return;
    }
    draft = next;
    if (fromAngle) inputs.rise.value = String(next.rise);
    else angleInput.value = (Math.atan2(next.rise, RUN) / RAD).toFixed(2);
    showCandidate(next);
  }

  for (const input of Object.values(inputs))
    input.addEventListener('input', () => readInputs(false));
  angleInput.addEventListener('input', () => readInputs(true));

  function cancel() {
    const pointer = pendingPointer;
    pendingPointer = null;
    if (pointer !== null && canvas.hasPointerCapture(pointer))
      canvas.releasePointerCapture(pointer);
    placement = null;
    enteredDrag = false;
    preview = null;
    invalid = false;
    dragImage?.remove();
    dragImage = null;
    refresh();
  }

  function commit(candidate: Ramp | null) {
    if (!candidate || !footprintFits(candidate)) {
      cancel();
      invalid = true;
      refresh('Горка выходит за границы поля');
      return;
    }
    committed = draft = candidate;
    writeInputs(candidate);
    cancel();
    refresh('Горка размещена.');
  }

  function at(event: MouseEvent) {
    if (!draft) return null;
    const anchor = projectAnchor(
      camera(),
      view,
      canvas.getBoundingClientRect(),
      event.clientX,
      event.clientY,
      draft.y,
    );
    return anchor ? { ...draft, ...anchor } : null;
  }

  confirm.addEventListener('click', () => commit(draft));
  palette.addEventListener('click', () => {
    if (!draft) return;
    if (placement === 'choose') {
      cancel();
      return;
    }
    placement = 'choose';
    showCandidate(draft);
    canvas.focus({ preventScroll: true });
  });
  palette.addEventListener('dragstart', (event) => {
    if (!event.dataTransfer || !draft) {
      event.preventDefault();
      return;
    }
    placement = 'drag';
    enteredDrag = false;
    preview = null;
    invalid = false;
    dragImage = document.createElement('canvas');
    dragImage.width = dragImage.height = 1;
    dragImage.style.cssText = 'position:fixed;top:-20px;left:-20px;pointer-events:none';
    document.body.append(dragImage);
    event.dataTransfer.setDragImage(dragImage, 0, 0);
    event.dataTransfer.setData(MIME, 'ramp');
    event.dataTransfer.effectAllowed = 'copy';
    refresh();
  });
  palette.addEventListener('dragend', () => {
    if (placement === 'drag') cancel();
  });
  const isRampDrag = (event: DragEvent) =>
    placement === 'drag' && event.dataTransfer?.types.includes(MIME);
  canvas.addEventListener('dragover', (event) => {
    if (!isRampDrag(event) || !event.dataTransfer) return;
    event.preventDefault();
    enteredDrag = true;
    showCandidate(at(event));
    event.dataTransfer.dropEffect = preview ? 'copy' : 'none';
  });
  canvas.addEventListener('dragleave', () => {
    // Ignore a stale leave before this drag first reaches the actual canvas.
    if (placement === 'drag' && enteredDrag) cancel();
  });
  canvas.addEventListener('drop', (event) => {
    if (!isRampDrag(event) || event.dataTransfer?.getData(MIME) !== 'ramp') return;
    event.preventDefault();
    commit(at(event));
  });
  canvas.addEventListener(
    'pointerdown',
    (event) => {
      if (placement !== 'choose') return;
      if (!event.isPrimary || event.button !== 0) {
        cancel();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      pendingPointer = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      showCandidate(at(event));
    },
    true,
  );
  function capturedPointerLeft(event: PointerEvent) {
    if (event.pointerId !== pendingPointer) return false;
    const { left, right, top, bottom } = canvas.getBoundingClientRect();
    return (
      event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom
    );
  }

  canvas.addEventListener('pointermove', (event) => {
    if (placement !== 'choose' || !event.isPrimary) return;
    if (capturedPointerLeft(event)) {
      cancel();
      return;
    }
    showCandidate(at(event));
  });
  canvas.addEventListener('pointerleave', () => {
    if (placement !== 'choose' || pendingPointer !== null) return;
    preview = null;
    invalid = false;
    refresh();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId !== pendingPointer) return;
    if (capturedPointerLeft(event)) cancel();
    else commit(at(event));
  });
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('lostpointercapture', (event) => {
    if (event.pointerId === pendingPointer) cancel();
  });
  canvas.addEventListener('keydown', (event) => {
    if (placement !== 'choose' || !draft) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!invalid) commit(preview ?? draft);
      return;
    }
    const directions: Record<string, readonly [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowDown: [0, -1],
      ArrowUp: [0, 1],
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    if (view === 'side' && direction[1] !== 0) return;
    const start = preview ?? draft;
    showCandidate({
      ...start,
      x: rounded(start.x + direction[0] / 100),
      y: rounded(start.y + direction[1] / 100),
    });
  });
  for (const button of cameraButtons) {
    button.addEventListener('click', () => {
      const next = button.dataset.viewChoice as View;
      if (next === view) return;
      view = next;
      cancel();
      for (const item of cameraButtons) item.setAttribute('aria-pressed', String(item === button));
    });
  }
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') cancel();
  });
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancel();
  });
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    cancel();
    status.textContent = 'Контекст WebGL потерян';
  });
  canvas.addEventListener('webglcontextrestored', schedule);
  window.addEventListener('pagehide', ({ persisted }) => {
    if (persisted) {
      cancel();
      return;
    }
    observer.disconnect();
    cancelAnimationFrame(frame);
    controls.dispose();
    updateMesh('committed', null);
    updateMesh('preview', null);
    Object.values(material).forEach((item) => item.dispose());
    edgeMaterial.dispose();
    gridMesh.geometry.dispose();
    datum.geometry.dispose();
    fixedMaterial.dispose();
    ground.geometry.dispose();
    ground.material.dispose();
    renderer.dispose();
  });

  writeInputs(initial);
  refresh();
  resize();
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('ramp-passive-editor');
  if (root) install(root);
}
