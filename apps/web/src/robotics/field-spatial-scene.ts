import * as THREE from 'three';
import type {
  RoboticsBall,
  RoboticsBody,
  RoboticsObjectKey,
  RoboticsRectObstacle,
} from '@asa-lab/robotics/world-document';
import type { RoboticsFieldGeometry } from './RobotField';
import type { RoboticsDistanceMeasurement, RoboticsWorldState } from './world';

const GROUND = 0.002;
const START_SIZE = 0.3;
const TRAIL_CAPACITY = 800;
const BODY_Z = new THREE.Vector3(0, 0, 1);
const MARK_ORDER = 10;
const DECORATION_ORDER = 100;
const START_ORDER = 200;
export const SPATIAL_FIELD_BACKGROUND = 0x253945;

function metal(color: number, roughness: number, metalness = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

// CylinderGeometry is Y-up. The field itself always keeps the canonical X/Y ground, Z-up axes.
function uprightCylinder(radius: number, height: number, segments = 32): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(radius, radius, height, segments).rotateX(Math.PI / 2);
}

function rim(radius: number, tube: number): THREE.TorusGeometry {
  return new THREE.TorusGeometry(radius, tube, 6, 32);
}

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function addGroundLines(
  parent: THREE.Object3D,
  width: number,
  height: number,
  step: number,
  material: THREE.LineBasicMaterial,
  z: number,
): void {
  const positions: number[] = [];
  for (let column = 1; column * step < width; column++) {
    const x = column * step;
    positions.push(x, 0, z, x, height, z);
  }
  for (let row = 1; row * step < height; row++) {
    const y = row * step;
    positions.push(0, y, z, width, y, z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  parent.add(new THREE.LineSegments(geometry, material));
}

function markMesh(points: THREE.Vector2[], width: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const triangles: number[] = [];
  points.forEach((point, index) => {
    const tangent = points[Math.min(points.length - 1, index + 1)]!.clone()
      .sub(points[Math.max(0, index - 1)]!)
      .normalize();
    const normalX = (-tangent.y * width) / 2;
    const normalY = (tangent.x * width) / 2;
    positions.push(
      point.x + normalX,
      point.y + normalY,
      GROUND,
      point.x - normalX,
      point.y - normalY,
      GROUND,
    );
    if (index > 0) {
      const top = index * 2;
      triangles.push(top - 2, top - 1, top, top - 1, top + 1, top);
    }
  });
  return new THREE.BufferGeometry()
    .setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    .setIndex(triangles);
}

function textTexture(text: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = color;
    context.font = '700 88px system-ui, sans-serif';
    context.textBaseline = 'middle';
    context.textAlign = 'center';
    context.fillText(text, 256, 64, 490);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createDecorations(
  parent: THREE.Group,
  visuals: NonNullable<RoboticsFieldGeometry['field']['visuals']>,
  addPickable: (key: RoboticsObjectKey, object: THREE.Object3D) => void,
  invalidate: () => void,
  clippingPlanes: THREE.Plane[],
): () => void {
  const loading: HTMLImageElement[] = [];
  for (const [index, visual] of visuals.entries()) {
    const { widthMeters: width, heightMeters: height } = visual;
    const key: RoboticsObjectKey = `decoration:${visual.id}`;
    const group = new THREE.Group();
    group.position.set(visual.xMeters + width / 2, visual.yMeters + height / 2, GROUND * 1.5);
    group.rotation.z = visual.rotationRadians ?? 0;
    parent.add(group);
    if (visual.kind === 'text' || visual.kind === 'image') {
      let map: THREE.Texture;
      if (visual.kind === 'text') {
        map = textTexture(visual.text ?? '', visual.strokeColor);
      } else {
        if (!visual.imageData || !/^data:image\/(png|jpeg|webp);base64,/.test(visual.imageData)) {
          parent.remove(group);
          continue;
        }
        const image = new Image();
        map = new THREE.Texture(image);
        map.colorSpace = THREE.SRGBColorSpace;
        const texture = map;
        image.onload = () => {
          texture.needsUpdate = true;
          invalidate();
        };
        image.src = visual.imageData;
        loading.push(image);
      }
      const item = addMesh(
        group,
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, clippingPlanes }),
      );
      item.renderOrder = DECORATION_ORDER + index * 2;
    } else {
      const circle = visual.kind === 'circle';
      const bounds = circle
        ? new THREE.CircleGeometry(width / 2, 36)
        : new THREE.PlaneGeometry(width, height);
      const fill = new THREE.MeshBasicMaterial({
        color: visual.fillColor,
        transparent: true,
        opacity: visual.fillEnabled ? 1 : 0,
        depthWrite: false,
        clippingPlanes,
      });
      addMesh(group, bounds, fill).renderOrder = DECORATION_ORDER + index * 2;
      const outline = new THREE.EdgesGeometry(bounds);
      const line = new THREE.LineSegments(
        outline,
        new THREE.LineBasicMaterial({
          color: visual.strokeColor,
          transparent: true,
          depthWrite: false,
          clippingPlanes,
        }),
      );
      line.renderOrder = DECORATION_ORDER + index * 2 + 1;
      group.add(line);
    }
    addPickable(key, group);
  }
  return () => {
    for (const image of loading) image.onload = null;
  };
}

export function createRobotVisual(robot: RoboticsFieldGeometry['robot']): THREE.Group {
  const group = new THREE.Group();
  const length = robot.bodyLengthMeters;
  const width = robot.bodyWidthMeters;
  const wheelRadius = robot.wheelRadiusMeters;
  const track = robot.wheelTrackMeters;
  const tyreWidth = robot.wheelWidthMeters;
  const deckZ = wheelRadius * 1.55;
  const deckThickness = Math.min(0.009, wheelRadius * 0.35);
  const shellHeight = Math.min(0.035, length * 0.18);
  const boardZ = deckZ + deckThickness / 2 + shellHeight + 0.004;
  const rubber = metal(0x202833, 0.95);
  const aluminium = metal(0x9db5bd, 0.32, 0.32);
  const steel = metal(0x627988, 0.43, 0.35);
  const circuit = metal(0x147c87, 0.55);
  const plastic = metal(0x28394b, 0.62);
  const wheel = new THREE.CylinderGeometry(wheelRadius, wheelRadius, tyreWidth, 24);
  const hub = new THREE.CylinderGeometry(wheelRadius * 0.53, wheelRadius * 0.53, 0.004, 20);
  const deck = addMesh(
    group,
    new THREE.BoxGeometry(length, width, deckThickness),
    aluminium,
    0,
    0,
    deckZ,
  );
  deck.name = 'visual-chassis-deck';
  addMesh(
    group,
    new THREE.BoxGeometry(length * 0.68, width * 0.7, shellHeight),
    plastic,
    -length * 0.06,
    0,
    deckZ + deckThickness / 2 + shellHeight / 2,
  );
  addMesh(
    group,
    new THREE.BoxGeometry(length * 0.36, width * 0.58, 0.008),
    circuit,
    length * 0.17,
    0,
    boardZ,
  );
  addMesh(
    group,
    new THREE.BoxGeometry(length * 0.16, width * 0.26, 0.01),
    plastic,
    length * 0.18,
    0,
    boardZ + 0.008,
  );
  for (const side of [-1, 1]) {
    const tyre = addMesh(group, wheel, rubber, 0, (side * track) / 2, wheelRadius);
    tyre.name = side === 1 ? 'visual-wheel-left' : 'visual-wheel-right';
    addMesh(group, hub, steel, 0, (side * (track + tyreWidth)) / 2, wheelRadius);
    addMesh(
      group,
      new THREE.CylinderGeometry(wheelRadius * 0.18, wheelRadius * 0.18, 0.006, 12),
      aluminium,
      0,
      side * ((track + tyreWidth) / 2 + 0.002),
      wheelRadius,
    );
  }
  const casterRadius = Math.min(wheelRadius * 0.38, width * 0.12, length * 0.06);
  const casterX = -length * 0.42;
  const caster = addMesh(
    group,
    new THREE.SphereGeometry(casterRadius, 20, 12),
    steel,
    casterX,
    0,
    casterRadius,
  );
  caster.name = 'visual-rear-caster';
  const cup = addMesh(
    group,
    new THREE.BoxGeometry(casterRadius * 1.8, casterRadius * 1.8, 0.006),
    aluminium,
    casterX,
    0,
    casterRadius * 1.9,
  );
  cup.name = 'visual-caster-cup';
  const cupTop = casterRadius * 1.9 + 0.003;
  const deckUnderside = deckZ - deckThickness / 2;
  // Slight embed at both ends keeps the actual Float32 meshes joined. The
  // bracket stays inside the existing chassis plan and is appearance only.
  const embed = Math.min(0.001, casterRadius * 0.15, deckThickness * 0.15);
  const bracket = addMesh(
    group,
    new THREE.BoxGeometry(
      casterRadius * 0.65,
      casterRadius * 0.65,
      deckUnderside - cupTop + embed * 2,
    ),
    steel,
    casterX,
    0,
    (cupTop + deckUnderside) / 2,
  );
  bracket.name = 'visual-caster-bracket';
  // Uno-like board/headers are visual detail; no hardware origin or model changes.
  for (const side of [-1, 1])
    addMesh(
      group,
      new THREE.BoxGeometry(length * 0.28, 0.004, 0.007),
      rubber,
      length * 0.17,
      side * width * 0.23,
      boardZ + 0.006,
    );
  const sensor = new THREE.Group();
  sensor.name = 'visual-hcsr04';
  sensor.position.set(robot.sensorForwardMeters, robot.sensorLateralMeters, deckZ + 0.012);
  sensor.rotation.z = robot.sensorHeadingRadians;
  group.add(sensor);
  addMesh(sensor, new THREE.BoxGeometry(0.007, 0.045, 0.019), circuit);
  const receiver = new THREE.CylinderGeometry(0.008, 0.008, 0.011, 14).rotateZ(-Math.PI / 2);
  const emitter = new THREE.CylinderGeometry(0.005, 0.005, 0.001, 12).rotateZ(-Math.PI / 2);
  for (const side of [-1, 1]) {
    addMesh(sensor, receiver, aluminium, 0.008, side * 0.012);
    addMesh(sensor, emitter, plastic, 0.014, side * 0.012);
  }
  return group;
}

function createCan(radius: number, height: number): THREE.Group {
  const group = new THREE.Group();
  const tube = Math.min(radius * 0.08, height / 18, 0.003);
  const lipRadius = radius - tube;
  const shell = metal(0xc5533b, 0.35, 0.12);
  const lid = metal(0xc0ccd5, 0.28, 0.5);
  const recess = metal(0x8294a1, 0.35, 0.35);
  addMesh(group, uprightCylinder(radius - tube / 2, height - tube * 2), shell, 0, 0, height / 2);
  addMesh(group, uprightCylinder(lipRadius, tube * 1.4), lid, 0, 0, height - tube * 1.65);
  const lip = rim(lipRadius, tube);
  addMesh(group, lip, lid, 0, 0, height - tube);
  addMesh(group, lip, lid, 0, 0, tube);
  addMesh(group, rim(radius * 0.72, tube * 0.34), recess, 0, 0, height - tube * 1.01);
  const tab = addMesh(group, rim(radius * 0.26, tube * 0.55), lid, radius * 0.08, 0, height - tube);
  tab.scale.set(0.76, 1.12, 1);
  return group;
}

function createBall(radius: number): THREE.Group {
  const group = new THREE.Group();
  addMesh(group, new THREE.SphereGeometry(radius, 28, 18), metal(0xec9942, 0.64), 0, 0, radius);
  const seam = metal(0x9e4a1b, 0.84);
  const seamGeometry = rim(radius * 0.988, Math.min(radius * 0.012, 0.0012));
  addMesh(group, seamGeometry, seam, 0, 0, radius);
  addMesh(group, seamGeometry, seam, 0, 0, radius).rotateY(Math.PI / 2);
  return group;
}

export type SpatialPlacement = {
  key: RoboticsObjectKey;
  valid: boolean;
} & (
  | { kind: 'wall'; object: RoboticsRectObstacle }
  | { kind: 'ball'; object: RoboticsBall }
  | { kind: 'can'; object: Extract<RoboticsBody, { kind: 'can' }> }
  | { kind: 'box'; object: Extract<RoboticsBody, { kind: 'box' }> }
);

function createWall(
  wall: RoboticsRectObstacle,
  material = metal(0x4c6478, 0.67),
  cap = metal(0x8199ac, 0.52),
): THREE.Group {
  const group = new THREE.Group();
  // Legacy walls have plan dimensions only. These sides are visualization geometry.
  const capHeight = 0.004;
  const bodyHeight = 0.083;
  addMesh(
    group,
    new THREE.BoxGeometry(wall.widthMeters, wall.heightMeters, bodyHeight),
    material,
    0,
    0,
    bodyHeight / 2,
  );
  addMesh(
    group,
    new THREE.BoxGeometry(wall.widthMeters, wall.heightMeters, capHeight),
    cap,
    0,
    0,
    bodyHeight + capHeight / 2,
  );
  return group;
}

function createBody(
  body: NonNullable<RoboticsFieldGeometry['field']['bodies']>[number],
): THREE.Group {
  if (body.kind === 'can') return createCan(body.radiusMeters, body.heightMeters);
  const item = new THREE.Group();
  const endGrain = metal(0xad7446, 0.92);
  const grain = metal(0xb98252, 0.94);
  const top = metal(0xd0a374, 0.9);
  addMesh(
    item,
    new THREE.BoxGeometry(body.widthMeters, body.depthMeters, body.heightMeters),
    [endGrain, endGrain, grain, grain, top, grain],
    0,
    0,
    body.heightMeters / 2,
  );
  return item;
}

function placementGeometryKey(placement: SpatialPlacement): string {
  switch (placement.kind) {
    case 'wall':
      return ['wall', placement.object.widthMeters, placement.object.heightMeters].join(':');
    case 'ball':
      return ['ball', placement.object.radiusMeters].join(':');
    case 'can':
      return ['can', placement.object.radiusMeters, placement.object.heightMeters].join(':');
    case 'box':
      return [
        'box',
        placement.object.widthMeters,
        placement.object.depthMeters,
        placement.object.heightMeters,
      ].join(':');
  }
}

export function createFieldSpatialScene(world: RoboticsFieldGeometry, invalidate: () => void) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SPATIAL_FIELD_BACKGROUND);
  const field = world.field;
  const width = field.widthMeters;
  const height = field.heightMeters;
  const clippingPlanes = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), width),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), height),
  ];
  const objects = new Map<RoboticsObjectKey, THREE.Object3D>();
  const previewRoots = new Map<RoboticsObjectKey, Set<THREE.Object3D>>();
  const previewPositions = new Map<THREE.Object3D, THREE.Vector3>();
  const objectKeys = new WeakMap<THREE.Object3D, RoboticsObjectKey>();
  function addPickable(key: RoboticsObjectKey, item: THREE.Object3D): void {
    item.name ||= key;
    objects.set(key, item);
    const roots = previewRoots.get(key) ?? new Set<THREE.Object3D>();
    roots.add(item);
    previewRoots.set(key, roots);
    objectKeys.set(item, key);
  }

  const sun = new THREE.DirectionalLight(0xffebd7, 2.0);
  sun.position.set(width * 0.15, -height, Math.max(width, height) * 1.5);
  scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x87969f, 2.25), sun);
  const surfaceColors = { smooth: 0x9eacb5, wood: 0xb49872, carpet: 0x8f99a9 };
  const floor = metal(surfaceColors[field.surface ?? 'smooth'], 0.93);
  addMesh(scene, new THREE.BoxGeometry(width, height, 0.012), floor, width / 2, height / 2, -0.006);
  // Low visual perimeter only: outside canonical XY and absent from picking/physics.
  const rimMaterial = metal(0x526773, 0.66, 0.18);
  const rimWidth = 0.012;
  const rimHeight = 0.009;
  for (const y of [-rimWidth / 2, height + rimWidth / 2])
    addMesh(
      scene,
      new THREE.BoxGeometry(width + rimWidth * 2, rimWidth, rimHeight),
      rimMaterial,
      width / 2,
      y,
      rimHeight / 2,
    );
  for (const x of [-rimWidth / 2, width + rimWidth / 2])
    addMesh(
      scene,
      new THREE.BoxGeometry(rimWidth, height, rimHeight),
      rimMaterial,
      x,
      height / 2,
      rimHeight / 2,
    );
  const metricGrid = new THREE.Group();
  metricGrid.name = 'metric-grid';
  scene.add(metricGrid);
  addGroundLines(
    metricGrid,
    width,
    height,
    field.gridMeters,
    new THREE.LineBasicMaterial({ color: 0x68798a, transparent: true, opacity: 0.32 }),
    GROUND / 4,
  );
  if (field.tiles?.enabled) {
    addGroundLines(
      scene,
      width,
      height,
      field.tiles.sizeMeters,
      new THREE.LineBasicMaterial({ color: 0x556678, transparent: true, opacity: 0.45 }),
      GROUND / 3,
    );
  }

  const startColor = 0x12798b;
  const startX = world.initialPose.xMeters;
  const startY = world.initialPose.yMeters;
  const start = new THREE.PlaneGeometry(START_SIZE, START_SIZE);
  const startFill = addMesh(
    scene,
    start,
    new THREE.MeshBasicMaterial({
      color: startColor,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
    }),
    startX,
    startY,
    GROUND * 1.1,
  );
  startFill.renderOrder = START_ORDER;
  const startBorder = new THREE.LineSegments(
    new THREE.EdgesGeometry(start),
    new THREE.LineBasicMaterial({ color: startColor, transparent: true, depthWrite: false }),
  );
  startBorder.position.set(startX, startY, GROUND * 1.2);
  startBorder.renderOrder = START_ORDER + 1;
  scene.add(startBorder);
  const startText = addMesh(
    scene,
    new THREE.PlaneGeometry(0.16, 0.04),
    new THREE.MeshBasicMaterial({
      map: textTexture('СТАРТ', '#ebfdff'),
      transparent: true,
      depthWrite: false,
    }),
    startX,
    startY - 0.121,
    GROUND * 1.3,
  );
  startText.renderOrder = START_ORDER + 2;

  const markingObjects: THREE.Object3D[] = [];
  for (const [index, mark] of field.floorMarks.entries()) {
    const material = new THREE.MeshBasicMaterial({
      color: mark.color,
      transparent: true,
      opacity: mark.kind === 'area' ? 0.65 : 1,
      depthWrite: false,
      clippingPlanes,
    });
    const item =
      mark.kind === 'area'
        ? addMesh(
            scene,
            new THREE.PlaneGeometry(mark.widthMeters, mark.heightMeters),
            material,
            mark.xMeters + mark.widthMeters / 2,
            mark.yMeters + mark.heightMeters / 2,
            GROUND,
          )
        : addMesh(
            scene,
            markMesh(
              mark.kind === 'line'
                ? [
                    new THREE.Vector2(mark.start.xMeters, mark.start.yMeters),
                    new THREE.Vector2(mark.end.xMeters, mark.end.yMeters),
                  ]
                : new THREE.QuadraticBezierCurve(
                    new THREE.Vector2(mark.start.xMeters, mark.start.yMeters),
                    new THREE.Vector2(mark.control.xMeters, mark.control.yMeters),
                    new THREE.Vector2(mark.end.xMeters, mark.end.yMeters),
                  ).getPoints(32),
              mark.widthMeters,
            ),
            material,
          );
    item.renderOrder = MARK_ORDER + index;
    // A stamp can consist of several marks. All select its same authored group.
    const key: RoboticsObjectKey = mark.groupId ? `mark-group:${mark.groupId}` : `mark:${mark.id}`;
    addPickable(key, item);
    markingObjects.push(item);
  }

  const decorations = new THREE.Group();
  scene.add(decorations);
  const disposeDecorations = createDecorations(
    decorations,
    field.visuals ?? [],
    addPickable,
    invalidate,
    clippingPlanes,
  );

  // A cheap visual contact shadow anchors small field objects at all zoom levels.
  // It does not depend on simulated forces or modify any world geometry.
  const shadowGeometry = new THREE.PlaneGeometry(2, 2);
  const shadowMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec2 vUv;
      void main() {
        float radius = length((vUv - 0.5) * 2.0);
        float alpha = 0.34 * (1.0 - smoothstep(0.3, 1.0, radius));
        gl_FragColor = vec4(0.08, 0.14, 0.19, alpha);
      }`,
  });
  function addShadow(parent: THREE.Group, halfWidth: number, halfDepth: number): void {
    const shadow = addMesh(parent, shadowGeometry, shadowMaterial, 0, 0, GROUND * 1.6);
    shadow.scale.set(halfWidth * 1.65, halfDepth * 1.65, 1);
    shadow.renderOrder = START_ORDER + 3;
  }

  const wallMaterial = metal(0x4c6478, 0.67);
  const wallCap = metal(0x8199ac, 0.52);
  for (const wall of field.obstacles) {
    const group = createWall(wall, wallMaterial, wallCap);
    group.position.set(
      wall.xMeters + wall.widthMeters / 2,
      wall.yMeters + wall.heightMeters / 2,
      0,
    );
    group.rotation.z = wall.headingRadians ?? 0;
    scene.add(group);
    addPickable(`wall:${wall.id}`, group);
  }

  const ballMeshes = new Map<string, THREE.Group>();
  for (const ball of field.balls) {
    const item = createBall(ball.radiusMeters);
    addShadow(item, ball.radiusMeters, ball.radiusMeters);
    scene.add(item);
    addPickable(`ball:${ball.id}`, item);
    ballMeshes.set(ball.id, item);
  }

  const bodyMeshes = new Map<string, THREE.Group>();
  for (const body of field.bodies ?? []) {
    const item = createBody(body);
    if (body.kind === 'box') addShadow(item, body.widthMeters / 2, body.depthMeters / 2);
    else addShadow(item, body.radiusMeters, body.radiusMeters);
    scene.add(item);
    addPickable(`body:${body.id}`, item);
    bodyMeshes.set(body.id, item);
  }

  const robot = createRobotVisual(world.robot);
  addShadow(
    robot,
    world.robot.bodyLengthMeters / 2,
    (world.robot.wheelTrackMeters + world.robot.wheelWidthMeters) / 2,
  );
  scene.add(robot);
  addPickable('robot', robot);

  const pathPositions = new THREE.BufferAttribute(new Float32Array(TRAIL_CAPACITY * 3), 3);
  pathPositions.setUsage(THREE.DynamicDrawUsage);
  const pathGeometry = new THREE.BufferGeometry().setAttribute('position', pathPositions);
  pathGeometry.setDrawRange(0, 0);
  const path = new THREE.Line(pathGeometry, new THREE.LineBasicMaterial({ color: 0xb15416 }));
  path.frustumCulled = false;
  scene.add(path);

  const rangePositions = new THREE.BufferAttribute(new Float32Array(6), 3);
  rangePositions.setUsage(THREE.DynamicDrawUsage);
  const rangeGeometry = new THREE.BufferGeometry().setAttribute('position', rangePositions);
  const range = new THREE.Line(rangeGeometry, new THREE.LineBasicMaterial({ color: 0x006d83 }));
  range.frustumCulled = false;
  scene.add(range);

  const outline = new THREE.Box3Helper(new THREE.Box3(), 0x00697e);
  outline.visible = false;
  scene.add(outline);
  const poseBounds = new THREE.Box3();
  function applySnapshot(
    state: RoboticsWorldState | undefined,
    distance: RoboticsDistanceMeasurement | undefined,
    grid: boolean,
    selection: RoboticsObjectKey | null,
    preview?: { key: RoboticsObjectKey; dxMeters: number; dyMeters: number } | null,
  ): void {
    // Restore exact base transforms: drafts never accumulate deltas or rebuild resources.
    for (const [item, position] of previewPositions) item.position.copy(position);
    previewPositions.clear();
    const pose = state?.pose ?? world.initialPose;
    robot.position.set(pose.xMeters, pose.yMeters, 0);
    robot.setRotationFromAxisAngle(BODY_Z, pose.headingRadians);
    const balls = new Map(state?.balls.map((ball) => [ball.id, ball]));
    const bodies = new Map(state?.bodies?.map((body) => [body.id, body]));
    for (const source of field.balls) {
      const current = balls.get(source.id) ?? source;
      ballMeshes.get(source.id)!.position.set(current.xMeters, current.yMeters, 0);
    }
    for (const source of field.bodies ?? []) {
      const current = bodies.get(source.id) ?? source;
      const item = bodyMeshes.get(source.id)!;
      item.position.set(current.xMeters, current.yMeters, 0);
      item.rotation.z = current.headingRadians;
    }
    const trail = state?.trail ?? [];
    const offset = Math.max(0, trail.length - TRAIL_CAPACITY);
    for (let index = offset; index < trail.length; index++) {
      const point = trail[index]!;
      pathPositions.setXYZ(index - offset, point.xMeters, point.yMeters, GROUND * 2);
    }
    pathPositions.needsUpdate = true;
    pathGeometry.setDrawRange(0, trail.length - offset);
    range.visible = Boolean(distance?.origin && distance.hit);
    if (distance?.origin && distance.hit) {
      const height = world.robot.wheelRadiusMeters * 1.55 + 0.012;
      rangePositions.setXYZ(0, distance.origin.xMeters, distance.origin.yMeters, height);
      rangePositions.setXYZ(1, distance.hit.xMeters, distance.hit.yMeters, height);
      rangePositions.needsUpdate = true;
    }
    metricGrid.visible = grid;

    if (preview && [preview.dxMeters, preview.dyMeters].every(Number.isFinite)) {
      const roots = new Set(previewRoots.get(preview.key));
      if (preview.key === 'robot') {
        roots.add(startFill);
        roots.add(startBorder);
        roots.add(startText);
      }
      for (const item of roots) {
        previewPositions.set(item, item.position.clone());
        item.position.x += preview.dxMeters;
        item.position.y += preview.dyMeters;
      }
    }
    const selected = selection ? objects.get(selection) : null;
    outline.visible = Boolean(selected);
    if (selected) {
      outline.box.setFromObject(selected);
      if (selection?.startsWith('mark-group:')) {
        for (const part of markingObjects) {
          if (objectKeys.get(part) === selection) outline.box.union(poseBounds.setFromObject(part));
        }
      }
      outline.box.expandByScalar(0.008);
    }
  }

  let placementShape: {
    identity: string;
    root: THREE.Group;
    outline: THREE.Box3Helper;
    meshCount: number;
  } | null = null;
  let placementPreview: {
    kind: SpatialPlacement['kind'];
    key: RoboticsObjectKey;
    xMeters: number;
    yMeters: number;
    valid: boolean;
    meshCount: number;
  } | null = null;

  function clearPlacementPreview(): void {
    if (!placementShape) return;
    scene.remove(placementShape.root, placementShape.outline);
    disposeSpatialResources(placementShape.root);
    disposeSpatialResources(placementShape.outline);
    placementShape = null;
    placementPreview = null;
  }

  function setPlacementPreview(placement: SpatialPlacement | null): void {
    if (!placement) {
      clearPlacementPreview();
      return;
    }
    const identity = placementGeometryKey(placement);
    if (placementShape?.identity !== identity) {
      clearPlacementPreview();
      const root =
        placement.kind === 'wall'
          ? createWall(placement.object)
          : placement.kind === 'ball'
            ? createBall(placement.object.radiusMeters)
            : createBody(placement.object);
      root.name = 'field-placement-preview';
      let meshCount = 0;
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        meshCount++;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          material.transparent = true;
          material.opacity = 0.55;
          material.depthWrite = false;
        }
      });
      const outline = new THREE.Box3Helper(new THREE.Box3());
      scene.add(root, outline);
      // Preview meshes and their outline never join the saved-object pick list.
      placementShape = { identity, root, outline, meshCount };
    }
    const { root, outline, meshCount } = placementShape;
    const { object, key, kind, valid } = placement;
    const offsetX = placement.kind === 'wall' ? placement.object.widthMeters / 2 : 0;
    const offsetY = placement.kind === 'wall' ? placement.object.heightMeters / 2 : 0;
    root.position.set(object.xMeters + offsetX, object.yMeters + offsetY, 0);
    root.rotation.z = 'headingRadians' in object ? (object.headingRadians ?? 0) : 0;
    outline.box.setFromObject(root);
    (outline.material as THREE.LineBasicMaterial).color.setHex(valid ? 0x227e6c : 0xd82c2c);
    placementPreview = {
      kind,
      key,
      xMeters: root.position.x - offsetX,
      yMeters: root.position.y - offsetY,
      valid,
      meshCount,
    };
  }

  const raycaster = new THREE.Raycaster();
  const pickables = [...new Set([...objects.values(), ...markingObjects])];
  const focusBounds = new THREE.Box3();
  function readFocus(key: RoboticsObjectKey, target: THREE.Vector3): number {
    const item = objects.get(key) ?? robot;
    focusBounds.setFromObject(item).getCenter(target);
    if (key.startsWith('mark-group:')) {
      for (const part of markingObjects) {
        if (objectKeys.get(part) === key) focusBounds.union(poseBounds.setFromObject(part));
      }
      focusBounds.getCenter(target);
    }
    return focusBounds.min.distanceTo(focusBounds.max);
  }

  function pickHit(point: THREE.Vector2, camera: THREE.Camera) {
    raycaster.setFromCamera(point, camera);
    const hits = raycaster.intersectObjects(pickables, true).filter((hit) => {
      if (!(hit.object instanceof THREE.Mesh) || hit.object.material === shadowMaterial)
        return false;
      return (
        hit.object.renderOrder < MARK_ORDER ||
        (hit.point.x >= 0 && hit.point.x <= width && hit.point.y >= 0 && hit.point.y <= height)
      );
    });
    const closest = hits[0];
    if (closest && closest.object.renderOrder >= MARK_ORDER) {
      // Overlays are drawn in document order even if their planes differ by a few millimetres.
      // Solid objects still win by depth, in the same way they occlude paint in the renderer.
      const topOverlay = hits.reduce((best, hit) => {
        return hit.distance - closest.distance < 0.004 &&
          hit.object.renderOrder > best.object.renderOrder
          ? hit
          : best;
      }, closest);
      hits.unshift(topOverlay);
    }
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      while (object) {
        const key = objectKeys.get(object);
        if (key) return { key, point: hit.point.clone() };
        object = object.parent;
      }
    }
    return undefined;
  }

  function pick(point: THREE.Vector2, camera: THREE.Camera): RoboticsObjectKey | undefined {
    return pickHit(point, camera)?.key;
  }

  function dispose(): void {
    clearPlacementPreview();
    disposeDecorations();
    disposeSpatialResources(scene);
  }

  return {
    scene,
    applySnapshot,
    setPlacementPreview,
    readPlacementPreview: () => placementPreview,
    readFocus,
    pick,
    pickHit,
    dispose,
    robotGeometry: readRobotVisualGeometry(robot),
  };
}

function disposeSpatialResources(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      if (material instanceof THREE.MeshBasicMaterial && material.map) textures.add(material.map);
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
  root.clear();
}

/** Actual shared mesh parameters, for read-only view parity evidence in metres. */
export function readRobotVisualGeometry(robot: THREE.Group) {
  const deck = robot.getObjectByName('visual-chassis-deck') as THREE.Mesh<THREE.BoxGeometry>;
  const left = robot.getObjectByName('visual-wheel-left') as THREE.Mesh<THREE.CylinderGeometry>;
  const right = robot.getObjectByName('visual-wheel-right') as THREE.Mesh<THREE.CylinderGeometry>;
  const sensor = robot.getObjectByName('visual-hcsr04')!;
  return {
    bodyLengthMeters: deck.geometry.parameters.width,
    bodyWidthMeters: deck.geometry.parameters.height,
    wheelRadiusMeters: left.geometry.parameters.radiusTop,
    wheelWidthMeters: left.geometry.parameters.height,
    wheelTrackMeters: left.position.y - right.position.y,
    sensorForwardMeters: sensor.position.x,
    sensorLateralMeters: sensor.position.y,
    sensorHeadingRadians: sensor.rotation.z,
  };
}

/** Construction-local coordinates, not runtime state: only the same robot mesh. */
export function createRobotSpatialScene(
  world: RoboticsFieldGeometry,
): ReturnType<typeof createFieldSpatialScene> {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SPATIAL_FIELD_BACKGROUND);
  const robot = createRobotVisual(world.robot);
  robot.name = 'robot';
  scene.add(robot);
  const sun = new THREE.DirectionalLight(0xffebd7, 2);
  sun.position.set(1, -2, 3);
  scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x87969f, 2.25), sun);
  const bounds = new THREE.Box3().setFromObject(robot);
  return {
    scene,
    robotGeometry: readRobotVisualGeometry(robot),
    applySnapshot: () => {},
    setPlacementPreview: () => {},
    readPlacementPreview: () => null,
    readFocus: (_key: RoboticsObjectKey, target: THREE.Vector3) => {
      bounds.getCenter(target);
      return bounds.min.distanceTo(bounds.max);
    },
    pick: () => undefined,
    pickHit: () => undefined,
    dispose: () => disposeSpatialResources(scene),
  };
}
