import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type { R5StandCommand, R5StandEvent, R5StandScene, R5StandSnapshot } from './r5.worker';

type Geometry = R5StandScene['geometries'][number];
type Ready = Extract<R5StandEvent, { kind: 'ready' }>;
type RunCase = Ready['runCase'];
type Phase = 'preparing' | 'ready' | 'running' | 'paused' | 'complete' | 'fault' | 'disposed';
type CameraView = 'top' | 'spatial';
type Focus = 'field' | 'rover' | 'empty-can';
type BodyName = NonNullable<Geometry['body']>;
type FrameArrival = 'accepted' | 'stale' | 'invalid';

const expectedBodies: readonly BodyName[] = [
  'rover',
  'rear-axle',
  'front-left-wheel',
  'front-right-wheel',
  'empty-can',
];

function finiteVector(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    Array.from(value).every((part) => typeof part === 'number' && Number.isFinite(part))
  );
}

function frameHasAllBodies(poses: unknown): boolean {
  if (!Array.isArray(poses) || poses.length !== expectedBodies.length) return false;
  const remaining = new Set(expectedBodies);
  return (
    poses.every(
      (pose: R5StandSnapshot['poses'][number]) =>
        pose &&
        remaining.delete(pose.body) &&
        finiteVector(pose.positionMeters, 3) &&
        finiteVector(pose.quaternionWxyz, 4) &&
        pose.quaternionWxyz.some((part) => part !== 0),
    ) && remaining.size === 0
  );
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error('Missing element ' + id);
  return node as T;
}

const elements = {
  app: element('r5-app'),
  play: element<HTMLButtonElement>('r5-play'),
  pause: element<HTMLButtonElement>('r5-pause'),
  reset: element<HTMLButtonElement>('r5-reset'),
  runCase: element<HTMLSelectElement>('r5-run-case'),
  top: element<HTMLButtonElement>('r5-view-top'),
  spatial: element<HTMLButtonElement>('r5-view-spatial'),
  rover: element<HTMLButtonElement>('r5-focus-rover'),
  can: element<HTMLButtonElement>('r5-focus-can'),
  viewport: element('r5-viewport'),
  viewportMessage: element('r5-viewport-message'),
  state: element('r5-run-state'),
  clock: element('r5-clock'),
  gpio: element('r5-gpio'),
  voltage: element('r5-voltage'),
  current: element('r5-current'),
  speed: element('r5-speed'),
  torque: element('r5-torque'),
  landmarks: element('r5-landmarks'),
  emptyLandmarks: element('r5-no-landmarks'),
  verdict: element('r5-verdict'),
  components: element('r5-components'),
  connections: element('r5-connections'),
  arduinoSource: element('r5-arduino-source'),
};

const phaseLabels: Record<Phase, string> = {
  preparing: 'Подготовка симуляции',
  ready: 'Готов к пуску',
  running: 'Симуляция идёт',
  paused: 'На паузе',
  complete: 'Прогон завершён',
  fault: 'Симуляция остановлена из-за ошибки',
  disposed: 'Симуляция закрыта',
};

const landmarkLabels: Readonly<Record<string, string>> = {
  settled: 'Робот на старте',
  mixed: 'Передние колёса на рампе',
  ramp: 'Четыре колеса на рампе',
  top: 'Робот на верхней площадке',
  impact: 'Бампер коснулся банки',
  tip: 'Пройден порог опрокидывания',
  'final-low': 'Arduino отключила привод',
  'free-side': 'Боковая опора подтверждена',
  'late-recontact': 'Повторное касание банки',
};

const seconds = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 6,
});
const displayNumber = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 5,
});

function modelTime(atMicroseconds: number) {
  return seconds.format(atMicroseconds / 1_000_000) + ' с';
}

function displayMeasurement(node: HTMLElement, value: number | undefined, unit: string) {
  if (value === undefined || !Number.isFinite(value)) {
    node.textContent = '—';
    delete node.dataset.value;
    return;
  }
  const text =
    value !== 0 && Math.abs(value) < 1e-5
      ? value.toExponential(2).replace('.', ',')
      : displayNumber.format(value);
  node.textContent = text + ' ' + unit;
  node.dataset.value = String(value);
}

function setPose(
  group: THREE.Object3D,
  position: Geometry['positionMeters'],
  quaternion: Geometry['quaternionWxyz'],
) {
  group.position.set(position[0], position[1], position[2]);
  group.quaternion.set(quaternion[1], quaternion[2], quaternion[3], quaternion[0]);
}

function createGeometry(shape: Geometry['shape']) {
  if (shape.kind === 'box') {
    const [x, y, z] = shape.halfExtentsMeters;
    return new THREE.BoxGeometry(2 * x, 2 * y, 2 * z);
  }
  if (shape.kind === 'cylinder') {
    const { radiusMeters: r, halfHeightMeters: h } = shape;
    return new THREE.CylinderGeometry(r, r, 2 * h, 48).rotateX(Math.PI / 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(shape.verticesMeters.flat(), 3),
  );
  geometry.setIndex(shape.triangles.flat());
  const faces = geometry.toNonIndexed();
  geometry.dispose();
  faces.computeVertexNormals();
  return faces;
}

function createViewer(container: HTMLElement) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1524);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.setAttribute('aria-label', 'Поле эксперимента R5');
  renderer.domElement.setAttribute('role', 'img');
  container.prepend(renderer.domElement);

  const world = new THREE.Group();
  // Native coordinates are right-handed and Z-up. Three's scene is Y-up.
  world.rotation.x = -Math.PI / 2;
  scene.add(world);
  const bodies = new Map<BodyName, THREE.Group>();
  const grid = new THREE.GridHelper(8, 40, 0x30445d, 0x23344b);
  grid.position.set(1.1, -0.051, 0);
  scene.add(grid);
  scene.add(new THREE.HemisphereLight(0xe4f3ff, 0x485670, 2.1));
  const key = new THREE.DirectionalLight(0xfff0db, 2.7);
  key.position.set(-1.4, 3.3, 2.4);
  key.target.position.x = 1.05;
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -2.65;
  key.shadow.camera.right = 2.65;
  key.shadow.camera.top = 2.65;
  key.shadow.camera.bottom = -2.65;
  key.shadow.bias = -0.0002;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xadceff, 1.35);
  fill.position.set(3.4, 1.8, -2.7);
  scene.add(fill);

  const materials = {
    lower: new THREE.MeshStandardMaterial({ color: 0x697e98, roughness: 0.86 }),
    slope: new THREE.MeshStandardMaterial({ color: 0x879eba, roughness: 0.76 }),
    upper: new THREE.MeshStandardMaterial({ color: 0x697e98, roughness: 0.86 }),
    chassis: new THREE.MeshStandardMaterial({ color: 0x2867bc, roughness: 0.39, metalness: 0.25 }),
    bumper: new THREE.MeshStandardMaterial({ color: 0x849bab, roughness: 0.32, metalness: 0.47 }),
    can: new THREE.MeshStandardMaterial({ color: 0xc5d5df, roughness: 0.23, metalness: 0.58 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x1e2730, roughness: 0.81 }),
    endcap: new THREE.MeshStandardMaterial({
      color: 0x637585,
      roughness: 0.42,
      metalness: 0.39,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  };

  function material(id: string) {
    switch (id) {
      case 'lower':
      case 'slope':
      case 'upper':
      case 'chassis':
      case 'bumper':
      case 'can':
        return materials[id];
      default:
        return materials.tire;
    }
  }

  function addCylinderDetail(mesh: THREE.Mesh, geometry: Geometry) {
    if (geometry.body === null || geometry.shape.kind !== 'cylinder') return;
    const { radiusMeters: radius, halfHeightMeters: halfHeight } = geometry.shape;
    const radiusScale = geometry.id === 'can' ? 0.88 : 0.55;
    const inset = new THREE.CircleGeometry(radius * radiusScale, 48);
    // Endcap accents lie on the simulated surface and do not alter its silhouette.
    for (const sign of [-1, 1]) {
      const cap = new THREE.Mesh(inset, materials.endcap);
      cap.position.z = sign * halfHeight;
      cap.rotation.y = sign === -1 ? Math.PI : 0;
      mesh.add(cap);
    }
  }

  const perspective = new THREE.PerspectiveCamera(43, 1, 0.008, 40);
  const top = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.008, 40);
  top.up.set(0, 0, -1);

  let cameraView: CameraView = 'spatial';
  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = perspective;
  let controls = makeControls();
  let frame = 0;
  let disposed = false;
  let aspect = 1;
  let topHalfHeight = 1.5;
  let bounds: THREE.Box3 | undefined;
  let focus: Focus = 'field';

  function invalidate() {
    if (frame || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderer.render(scene, camera);
    });
  }

  function makeControls() {
    const result = new OrbitControls(camera, renderer.domElement);
    result.enableRotate = cameraView === 'spatial';
    result.enableDamping = false;
    result.minDistance = 0.14;
    result.maxDistance = 14;
    result.minZoom = 0.45;
    result.maxZoom = 8;
    result.maxPolarAngle = Math.PI * 0.49;
    result.addEventListener('change', invalidate);
    return result;
  }

  function setTopFrustum() {
    top.left = -topHalfHeight * aspect;
    top.right = topHalfHeight * aspect;
    top.top = topHalfHeight;
    top.bottom = -topHalfHeight;
    top.updateProjectionMatrix();
  }

  function focusOn(next: Focus) {
    focus = next;
    const target = new THREE.Vector3(1.1, 0.04, 0);
    const size = new THREE.Vector3(3.8, 0.2, 1);
    if (focus === 'field' && bounds) {
      bounds.getCenter(target);
      bounds.getSize(size);
    } else if (focus !== 'field') {
      const body = bodies.get(focus);
      if (!body) return;
      body.getWorldPosition(target);
      const span = focus === 'rover' ? 0.48 : 0.24;
      size.set(span, span * 0.7, span);
    }
    controls.target.copy(target);
    if (cameraView === 'top') {
      topHalfHeight = Math.max(size.z * 0.57, (size.x * 0.57) / aspect, 0.08);
      top.position.copy(target).add(new THREE.Vector3(0, 5, 0));
      top.zoom = 1;
      setTopFrustum();
    } else {
      const halfFov = THREE.MathUtils.degToRad(perspective.fov) / 2;
      const distance =
        (Math.max(size.x / aspect, size.y + size.z * 0.72) * 0.61) / Math.tan(halfFov);
      const direction =
        focus === 'field' ? new THREE.Vector3(-0.16, 0.64, 1) : new THREE.Vector3(0.65, 0.45, 1);
      perspective.position.copy(target).addScaledVector(direction.normalize(), distance);
    }
    camera.lookAt(target);
    controls.update();
    invalidate();
  }

  function onResize() {
    if (disposed) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    const previousAspect = aspect;
    aspect = width / height;
    renderer.setSize(width, height, false);
    perspective.aspect = aspect;
    perspective.updateProjectionMatrix();
    if (aspect !== previousAspect && focus === 'field') focusOn('field');
    else setTopFrustum();
    invalidate();
  }

  onResize();
  const resize = new ResizeObserver(onResize);
  resize.observe(container);
  focusOn('field');

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      resize.disconnect();
      if (frame) cancelAnimationFrame(frame);
      controls.dispose();
      const geometries = new Set<THREE.BufferGeometry>();
      const ownedMaterials = new Set<THREE.Material>(Object.values(materials));
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
        geometries.add(object.geometry);
        const list = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of list) ownedMaterials.add(material);
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of ownedMaterials) material.dispose();
      key.shadow.dispose();
      bodies.clear();
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
    setScene(layout: R5StandScene) {
      // Every body transform is in native coordinates; geom transforms are local to its body.
      for (const geometry of layout.geometries) {
        const mesh = new THREE.Mesh(createGeometry(geometry.shape), material(geometry.id));
        setPose(mesh, geometry.positionMeters, geometry.quaternionWxyz);
        mesh.castShadow = geometry.body !== null;
        mesh.receiveShadow = true;
        addCylinderDetail(mesh, geometry);
        if (geometry.body === null) {
          world.add(mesh);
        } else {
          let group = bodies.get(geometry.body);
          if (!group) {
            group = new THREE.Group();
            bodies.set(geometry.body, group);
            world.add(group);
          }
          group.add(mesh);
        }
      }
      // Fit to the authored terrain rather than to an arbitrary moving frame.
      world.updateMatrixWorld(true);
      bounds = new THREE.Box3();
      for (const mesh of world.children) {
        if (mesh instanceof THREE.Mesh) bounds.expandByObject(mesh);
      }
      focusOn('field');
    },
    setSnapshot(snapshot: R5StandSnapshot) {
      for (const pose of snapshot.poses) {
        const body = bodies.get(pose.body);
        if (!body) continue;
        setPose(body, pose.positionMeters, pose.quaternionWxyz);
        body.visible = true;
      }
      invalidate();
    },
    clearSnapshot() {
      for (const body of bodies.values()) body.visible = false;
      invalidate();
    },
    setView(next: CameraView) {
      if (cameraView === next) return;
      cameraView = next;
      camera = next === 'top' ? top : perspective;
      controls.dispose();
      controls = makeControls();
      focusOn(focus);
    },
    focusOn,
    zoom(factor: number) {
      if (cameraView === 'top') {
        top.zoom = THREE.MathUtils.clamp(top.zoom * factor, controls.minZoom, controls.maxZoom);
        top.updateProjectionMatrix();
      } else {
        const offset = perspective.position.clone().sub(controls.target);
        const distance = THREE.MathUtils.clamp(
          offset.length() / factor,
          controls.minDistance,
          controls.maxDistance,
        );
        perspective.position.copy(controls.target).add(offset.setLength(distance));
      }
      controls.update();
      invalidate();
    },
  };
}

function showCircuit(circuit: Ready['circuit']) {
  const labels = new Map(circuit.components.map((component) => [component.id, component.label]));
  const list = (values: string[]) =>
    values.map((value) => {
      const li = document.createElement('li');
      li.textContent = value;
      return li;
    });
  const connectionTerminal = (terminal: { componentId: string; terminalId: string }) =>
    (labels.get(terminal.componentId) ?? terminal.componentId) + ' · ' + terminal.terminalId;
  elements.components.replaceChildren(...list(circuit.components.map(({ label }) => label)));
  elements.connections.replaceChildren(
    ...list(
      circuit.connections.map(
        ({ from, to }) => connectionTerminal(from) + ' — ' + connectionTerminal(to),
      ),
    ),
  );
  elements.arduinoSource.textContent = circuit.arduinoSource;
}

function installStand() {
  const viewer = createViewer(elements.viewport);
  let worker: Worker;
  try {
    worker = new Worker(new URL('./r5.worker.ts', import.meta.url), { type: 'module' });
  } catch (error) {
    viewer.dispose();
    throw error;
  }
  let generation = 0;
  let runCase: RunCase = 'powered';
  let phase: Phase = 'preparing';
  let pending: 'play' | 'pause' | 'resume' | null = null;
  let layoutPin: string | undefined;
  let snapshot: R5StandSnapshot | undefined;
  let closing = false;
  const shownLandmarks = new Set<string>();

  function send(command: R5StandCommand) {
    worker.postMessage(command);
  }

  function updateControls() {
    elements.play.disabled = closing || phase !== 'ready' || pending !== null;
    elements.pause.disabled =
      closing || (phase !== 'running' && phase !== 'paused') || pending !== null;
    elements.pause.textContent = phase === 'paused' ? 'Продолжить' : 'Пауза';
    elements.reset.disabled = closing || phase === 'preparing' || phase === 'disposed';
    elements.runCase.disabled =
      closing || phase === 'preparing' || phase === 'running' || pending !== null;
    elements.rover.disabled = closing || !snapshot;
    elements.can.disabled = closing || !snapshot;
  }

  function setPhase(next: Phase, error?: string) {
    phase = next;
    elements.state.dataset.state = next;
    elements.state.textContent = phaseLabels[next];
    elements.viewportMessage.hidden = next !== 'preparing' && next !== 'fault';
    elements.viewportMessage.textContent =
      next === 'fault' ? (error ?? phaseLabels.fault) : 'Подготовка сцены…';
    updateControls();
  }

  function showTelemetry(telemetry: R5StandSnapshot['telemetry']) {
    displayMeasurement(elements.gpio, telemetry?.gpioD5Volt, 'В');
    displayMeasurement(elements.voltage, telemetry?.windingVoltageVolt, 'В');
    displayMeasurement(elements.current, telemetry?.windingCurrentAmp, 'А');
    displayMeasurement(elements.speed, telemetry?.shaftAngularVelocityRadPerSecond, 'рад/с');
    displayMeasurement(elements.torque, telemetry?.appliedTorqueNm, 'Н·м');
  }

  function classifyFrame(next: R5StandSnapshot, initial = false): FrameArrival {
    if (
      !next ||
      !Number.isSafeInteger(next.generation) ||
      next.generation < 1 ||
      next.generation > generation
    )
      return 'invalid';
    if (next.generation < generation) return 'stale';
    if (
      !Number.isSafeInteger(next.tickId) ||
      !Number.isSafeInteger(next.atMicroseconds) ||
      next.tickId < 0 ||
      next.atMicroseconds < 0 ||
      (next.tickId === 0) !== (next.atMicroseconds === 0) ||
      !frameHasAllBodies(next.poses)
    )
      return 'invalid';
    if (initial) return next.tickId === 0 && !snapshot ? 'accepted' : 'invalid';
    if (!snapshot) return 'invalid';
    if (
      (next.tickId === snapshot.tickId && next.atMicroseconds === snapshot.atMicroseconds) ||
      (next.tickId < snapshot.tickId && next.atMicroseconds < snapshot.atMicroseconds)
    )
      return 'stale';
    if (next.tickId <= snapshot.tickId || next.atMicroseconds <= snapshot.atMicroseconds)
      return 'invalid';
    return phase === 'paused' && pending !== 'resume' ? 'invalid' : 'accepted';
  }

  function rejectFrame() {
    if (phase === 'running') send({ kind: 'pause', generation });
    pending = null;
    clearFrame();
    shownLandmarks.clear();
    elements.landmarks.replaceChildren();
    elements.emptyLandmarks.hidden = false;
    elements.verdict.hidden = true;
    setPhase('fault', 'Получен неполный или несогласованный кадр MuJoCo.');
  }

  function drawFrame(next: R5StandSnapshot) {
    snapshot = next;
    viewer.setSnapshot(next);
    elements.app.dataset.r5Generation = String(next.generation);
    elements.app.dataset.r5Tick = String(next.tickId);
    elements.app.dataset.r5TimeUs = String(next.atMicroseconds);
    elements.app.dataset.poses = JSON.stringify(
      next.poses.map(({ body, positionMeters, quaternionWxyz }) => [
        body,
        positionMeters,
        quaternionWxyz,
      ]),
    );
    elements.clock.textContent = modelTime(next.atMicroseconds);
    showTelemetry(next.telemetry);
    for (const landmark of next.landmarks) {
      const label = landmarkLabels[landmark.key];
      if (!label || shownLandmarks.has(landmark.key)) continue;
      shownLandmarks.add(landmark.key);
      const row = document.createElement('li');
      const text = document.createElement('span');
      const time = document.createElement('time');
      text.textContent = label;
      time.textContent = modelTime(landmark.atMicroseconds);
      time.dataset.timeUs = String(landmark.atMicroseconds);
      row.dataset.event = landmark.key;
      row.append(text, time);
      elements.landmarks.append(row);
    }
    elements.emptyLandmarks.hidden = shownLandmarks.size > 0;
  }

  function clearFrame() {
    snapshot = undefined;
    delete elements.app.dataset.r5Tick;
    delete elements.app.dataset.r5TimeUs;
    delete elements.app.dataset.poses;
    elements.clock.textContent = '—';
    viewer.clearSnapshot();
    showTelemetry(null);
  }

  function reset() {
    generation += 1;
    pending = null;
    elements.app.dataset.r5Generation = String(generation);
    clearFrame();
    shownLandmarks.clear();
    elements.landmarks.replaceChildren();
    elements.emptyLandmarks.hidden = false;
    elements.verdict.hidden = true;
    elements.components.replaceChildren();
    elements.connections.replaceChildren();
    elements.arduinoSource.textContent = '';
    setPhase('preparing');
    send({ kind: 'reset', generation, runCase });
  }

  function showVerdict(record: unknown) {
    if (!record || typeof record !== 'object' || !('kind' in record) || record.kind !== 'finish')
      return;
    const outcome =
      'result' in record && record.result && typeof record.result === 'object'
        ? record.result
        : record;
    if (!('physical' in outcome)) return;
    const physical =
      outcome.physical === 'PASS'
        ? 'Физические проверки пройдены.'
        : outcome.physical === 'FAIL'
          ? 'Физические проверки не пройдены.'
          : 'Физический результат не определён.';
    const causal =
      'causal' in outcome && outcome.causal === 'GAP_CAUSAL_ALT'
        ? ' Остался разрыв в проверке знака работы передачи.'
        : '';
    elements.verdict.textContent = physical + causal;
    elements.verdict.hidden = false;
  }

  worker.addEventListener('message', ({ data }: MessageEvent<R5StandEvent>) => {
    if (!data || typeof data !== 'object') {
      if (!closing && phase !== 'fault') rejectFrame();
      return;
    }
    if (data.kind === 'proof') {
      // The acquisition driver listens here. Its receipt must never gate the Worker clock.
      window.dispatchEvent(new CustomEvent('asa-r5-proof', { detail: data }));
      if (data.generation === generation) showVerdict(data.record);
      return;
    }
    if (data.kind === 'phase' && data.phase === 'disposed' && data.generation === generation) {
      closing = true;
      viewer.dispose();
      worker.terminate();
      clearFrame();
      setPhase('disposed');
      return;
    }
    if (closing || phase === 'fault') return;
    if (data.kind === 'snapshot') {
      const result = classifyFrame(data.snapshot);
      if (result === 'accepted') drawFrame(data.snapshot);
      if (result === 'invalid') rejectFrame();
      return;
    }
    if (
      !Number.isSafeInteger(data.generation) ||
      data.generation < 1 ||
      data.generation > generation
    ) {
      rejectFrame();
      return;
    }
    if (data.generation < generation) return;
    if (data.kind === 'ready') {
      if (classifyFrame(data.snapshot, true) !== 'accepted') {
        rejectFrame();
        return;
      }
      if (
        data.runCase !== runCase ||
        (layoutPin !== undefined && layoutPin !== data.pins.xmlSha256)
      ) {
        setPhase('fault', 'Получена другая модель сцены или другой сценарий.');
        return;
      }
      if (layoutPin === undefined) {
        viewer.setScene(data.scene);
        layoutPin = data.pins.xmlSha256;
      }
      showCircuit(data.circuit);
      drawFrame(data.snapshot);
      setPhase('ready');
      return;
    }
    pending = null;
    if (
      (data.phase === 'paused' || data.phase === 'complete') &&
      (!snapshot ||
        data.tickId !== snapshot.tickId ||
        data.atMicroseconds !== snapshot.atMicroseconds)
    ) {
      rejectFrame();
      return;
    }
    setPhase(data.phase, data.error);
  });

  worker.addEventListener('error', (event) => {
    pending = null;
    setPhase('fault', event.message);
  });

  elements.play.addEventListener('click', () => {
    pending = 'play';
    updateControls();
    send({ kind: 'play', generation });
  });
  elements.pause.addEventListener('click', () => {
    const command = phase === 'paused' ? 'resume' : 'pause';
    pending = command;
    updateControls();
    send({ kind: command, generation });
  });
  elements.reset.addEventListener('click', reset);
  elements.runCase.addEventListener('change', () => {
    runCase = elements.runCase.value === 'control' ? 'control' : 'powered';
    reset();
  });

  function changeView(mode: CameraView) {
    viewer.setView(mode);
    elements.viewport.dataset.view = mode;
    elements.top.setAttribute('aria-pressed', String(mode === 'top'));
    elements.spatial.setAttribute('aria-pressed', String(mode === 'spatial'));
  }

  elements.top.addEventListener('click', () => changeView('top'));
  elements.spatial.addEventListener('click', () => changeView('spatial'));
  element('r5-fit').addEventListener('click', () => viewer.focusOn('field'));
  elements.rover.addEventListener('click', () => viewer.focusOn('rover'));
  elements.can.addEventListener('click', () => viewer.focusOn('empty-can'));
  element('r5-zoom-in').addEventListener('click', () => viewer.zoom(1.25));
  element('r5-zoom-out').addEventListener('click', () => viewer.zoom(0.8));
  window.addEventListener('pagehide', () => {
    if (closing) return;
    closing = true;
    viewer.dispose();
    updateControls();
    send({ kind: 'dispose', generation });
  });
  window.addEventListener('pageshow', ({ persisted }) => {
    if (persisted && closing) window.location.reload();
  });

  reset();
}

try {
  installStand();
} catch (error) {
  elements.state.dataset.state = 'fault';
  elements.state.textContent = phaseLabels.fault;
  elements.viewportMessage.textContent =
    error instanceof Error ? error.message : 'Не удалось открыть сцену.';
}
