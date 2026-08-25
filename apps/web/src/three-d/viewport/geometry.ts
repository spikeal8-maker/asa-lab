import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { FontLoader, type Font } from 'three/addons/loaders/FontLoader.js';
import type { PrimitiveKind, ThreeDNode } from '@asa-lab/three-d';
import notoSansTypeface from '../fonts/noto-sans.typeface.json';
import notoSerifTypeface from '../fonts/noto-serif.typeface.json';
import notoSansMonoTypeface from '../fonts/noto-sans-mono.typeface.json';
import { createCadSolidMaterial } from './cad-appearance';

const MODEL_EDGE_COLOR = '#263d47';
const MODEL_EDGE_THRESHOLD_DEGREES = 24;
export const MODEL_EDGE_NAME = 'ASA model hard edges';
export { createCadSurfaceColor } from './cad-appearance';

export function addModelOutlineGeometry(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>,
  edgeGeometry: THREE.BufferGeometry,
  operation: ThreeDNode['operation'] = 'solid',
): void {
  const material = new THREE.LineBasicMaterial({
    color: operation === 'hole' ? '#526169' : MODEL_EDGE_COLOR,
    transparent: true,
    opacity: operation === 'hole' ? 0.58 : 0.86,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });

  const edges = new THREE.LineSegments(edgeGeometry, material);
  edges.name = MODEL_EDGE_NAME;
  edges.renderOrder = 4;
  edges.raycast = () => {};
  edges.userData['modelOutline'] = true;
  mesh.add(edges);
}

/**
 * Adds only real hard edges. A back-face silhouette mesh used to cover whole
 * faces at common camera angles, making bright solids appear almost black.
 * Edges remain children of the mesh and do not affect saved/printable geometry.
 */
export function addModelOutlines(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>,
  operation: ThreeDNode['operation'] = 'solid',
): void {
  addModelOutlineGeometry(
    mesh,
    new THREE.EdgesGeometry(mesh.geometry, MODEL_EDGE_THRESHOLD_DEGREES),
    operation,
  );
}

function wedgeGeometry(): THREE.BufferGeometry {
  const vertices = new Float32Array([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5,
    0.5,
  ]);
  const indices = [0, 1, 2, 0, 2, 3, 3, 2, 5, 3, 5, 4, 0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  const flatGeometry = geometry.toNonIndexed();
  geometry.dispose();
  flatGeometry.computeVertexNormals();
  return flatGeometry;
}

function roofGeometry(): THREE.BufferGeometry {
  const vertices = new Float32Array([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, 0.5,
  ]);
  const indices = [0, 1, 2, 0, 2, 3, 0, 4, 1, 3, 2, 5, 0, 3, 5, 0, 5, 4, 1, 4, 5, 1, 5, 2];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  const flatGeometry = geometry.toNonIndexed();
  geometry.dispose();
  flatGeometry.computeVertexNormals();
  return flatGeometry;
}

function extrudedShapeGeometry(
  points: readonly (readonly [number, number])[],
  depth = 1,
  steps = 1,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  points.forEach(([x, y], index) => (index === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: Math.max(1, Math.min(64, steps)),
    bevelEnabled: false,
    curveSegments: 16,
  });
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function starGeometry(pointsCount = 5, innerRatio = 0.44): THREE.BufferGeometry {
  const points: [number, number][] = [];
  for (let index = 0; index < pointsCount * 2; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI) / pointsCount;
    const radius = index % 2 === 0 ? 0.5 : 0.5 * innerRatio;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return extrudedShapeGeometry(points, 0.24);
}

/**
 * Tinkercad's first Star is not an extrusion. Its star-shaped footprint rises
 * to one centre apex, producing ten readable triangular facets. Keeping the
 * triangles unshared preserves the deliberate hard facet normals.
 */
function pointedStarGeometry(pointsCount = 5, innerRatio = 0.44): THREE.BufferGeometry {
  const ring: THREE.Vector3[] = [];
  for (let index = 0; index < pointsCount * 2; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI) / pointsCount;
    const radius = index % 2 === 0 ? 0.5 : 0.5 * innerRatio;
    ring.push(new THREE.Vector3(Math.cos(angle) * radius, -0.5, Math.sin(angle) * radius));
  }
  const apex = new THREE.Vector3(0, 0.5, 0);
  const bottom = new THREE.Vector3(0, -0.5, 0);
  const vertices: number[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index] as THREE.Vector3;
    const next = ring[(index + 1) % ring.length] as THREE.Vector3;
    vertices.push(
      current.x,
      current.y,
      current.z,
      next.x,
      next.y,
      next.z,
      apex.x,
      apex.y,
      apex.z,
      next.x,
      next.y,
      next.z,
      current.x,
      current.y,
      current.z,
      bottom.x,
      bottom.y,
      bottom.z,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function roundRoofGeometry(sides: number): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, sides, 1, false, 0, Math.PI);
  geometry.rotateZ(Math.PI / 2);
  return geometry;
}

function revolveSketchGeometry(
  sides: number,
  sketchPoints: ThreeDNode['parameters']['sketchPoints'] = [],
): THREE.BufferGeometry {
  const source =
    sketchPoints.length >= 3
      ? sketchPoints
      : [
          { x: 0.2, y: -1 },
          { x: 0.8, y: -0.5 },
          { x: 0.5, y: 1 },
        ];
  const profile = [
    new THREE.Vector2(0, source[0]?.y ?? -1),
    ...source.map((point) => new THREE.Vector2(Math.max(0.02, point.x), point.y)),
    new THREE.Vector2(0, source.at(-1)?.y ?? 1),
  ];
  return new THREE.LatheGeometry(profile, sides);
}

function sketchExtrudeGeometry(
  sketchPoints: ThreeDNode['parameters']['sketchPoints'],
  topScale = 1,
  baseScale = 1,
  twist = 0,
  steps = 1,
): THREE.BufferGeometry {
  const points = sketchPoints.map((point) => [point.x, point.y] as const);
  const geometry = extrudedShapeGeometry(points, 1, steps);
  const positions = geometry.getAttribute('position');
  for (let index = 0; index < positions.count; index += 1) {
    const depthPosition = Math.min(1, Math.max(0, -positions.getY(index)));
    const scale = baseScale + (topScale - baseScale) * depthPosition;
    const angle = THREE.MathUtils.degToRad(twist * depthPosition);
    const x = positions.getX(index) * scale;
    const z = positions.getZ(index) * scale;
    positions.setXYZ(
      index,
      x * Math.cos(angle) - z * Math.sin(angle),
      positions.getY(index),
      x * Math.sin(angle) + z * Math.cos(angle),
    );
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

const fontLoader = new FontLoader();
const TEXT_FONTS: Readonly<Record<ThreeDNode['parameters']['font'], Font>> = {
  sans: fontLoader.parse(notoSansTypeface),
  serif: fontLoader.parse(notoSerifTypeface),
  mono: fontLoader.parse(notoSansMonoTypeface),
};

function textGeometry(
  text: string,
  bevel: number,
  segments = 0,
  fontStyle: ThreeDNode['parameters']['font'] = 'sans',
  curveAngle = 0,
): THREE.BufferGeometry {
  const geometry = new TextGeometry(text.trim() || 'TEXT', {
    font: TEXT_FONTS[fontStyle],
    size: 1,
    depth: 0.22,
    curveSegments: 8,
    bevelEnabled: bevel > 0,
    bevelSize: Math.min(0.08, bevel / 100),
    bevelThickness: Math.min(0.08, bevel / 100),
    bevelSegments: Math.max(1, Math.min(5, segments)),
  });
  geometry.rotateX(-Math.PI / 2);
  bendTextGeometry(geometry, curveAngle);
  return geometry;
}

/**
 * Bends the glyph line around the Y axis while preserving its extrusion.
 * Positive and negative values create opposite arcs, which lets the same text
 * sit outside a cup or curve inward around a circular feature.
 */
function bendTextGeometry(geometry: THREE.BufferGeometry, curveAngle: number): void {
  const angle = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(curveAngle, -180, 180));
  if (Math.abs(angle) < 0.0001) return;
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const position = geometry.getAttribute('position');
  if (!bounds || !(position instanceof THREE.BufferAttribute)) return;
  const width = Math.max(0.0001, bounds.max.x - bounds.min.x);
  const centerX = (bounds.min.x + bounds.max.x) / 2;
  const centerZ = (bounds.min.z + bounds.max.z) / 2;
  const direction = Math.sign(angle);
  const radius = width / Math.abs(angle);
  for (let index = 0; index < position.count; index += 1) {
    const localX = position.getX(index) - centerX;
    const localZ = position.getZ(index) - centerZ;
    const theta = (localX / radius) * direction;
    const radial = radius + localZ * direction;
    position.setX(index, Math.sin(theta) * radial);
    position.setZ(index, centerZ + direction * (radius - Math.cos(theta) * radial));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

export function measureTextWidthAtHeight(
  text: string,
  fontStyle: ThreeDNode['parameters']['font'] = 'sans',
): number {
  const geometry = textGeometry(text, 0, 0, fontStyle);
  geometry.computeBoundingBox();
  const size = geometry.boundingBox?.getSize(new THREE.Vector3());
  geometry.dispose();
  if (!size || size.z <= 0.0001) return 1;
  return Math.max(0.1, size.x / size.z);
}

function heartGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.42);
  shape.bezierCurveTo(-0.52, -0.12, -0.54, 0.3, -0.25, 0.4);
  shape.bezierCurveTo(-0.08, 0.46, 0, 0.33, 0, 0.22);
  shape.bezierCurveTo(0, 0.33, 0.08, 0.46, 0.25, 0.4);
  shape.bezierCurveTo(0.54, 0.3, 0.52, -0.12, 0, -0.42);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.22,
    bevelEnabled: true,
    bevelSize: 0.025,
    bevelThickness: 0.025,
    bevelSegments: 2,
    curveSegments: 18,
  });
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function roundedBoxGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const radius = 0.12;
  shape.moveTo(-0.5 + radius, -0.5);
  shape.lineTo(0.5 - radius, -0.5);
  shape.quadraticCurveTo(0.5, -0.5, 0.5, -0.5 + radius);
  shape.lineTo(0.5, 0.5 - radius);
  shape.quadraticCurveTo(0.5, 0.5, 0.5 - radius, 0.5);
  shape.lineTo(-0.5 + radius, 0.5);
  shape.quadraticCurveTo(-0.5, 0.5, -0.5, 0.5 - radius);
  shape.lineTo(-0.5, -0.5 + radius);
  shape.quadraticCurveTo(-0.5, -0.5, -0.5 + radius, -0.5);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: true,
    bevelSize: 0.05,
    bevelThickness: 0.05,
    bevelSegments: 3,
    curveSegments: 12,
  });
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function tubeGeometry(
  radius = 10,
  wallThickness = 2.5,
  sides = 48,
  bevel = 0,
  bevelSegments = 1,
): THREE.BufferGeometry {
  const safeRadius = Math.max(0.1, radius);
  const innerRatio = Math.max(0.02, 1 - Math.min(wallThickness, safeRadius * 0.98) / safeRadius);
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 0.5, 0, Math.PI * 2, false);
  const opening = new THREE.Path();
  opening.absarc(0, 0, 0.5 * innerRatio, 0, Math.PI * 2, true);
  shape.holes.push(opening);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: bevel > 0,
    bevelSize: Math.min(0.2, bevel / (safeRadius * 2)),
    bevelThickness: Math.min(0.2, bevel / (safeRadius * 2)),
    bevelSegments: Math.max(1, Math.min(10, bevelSegments)),
    curveSegments: Math.max(3, sides),
  });
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function paraboloidGeometry(sides: number): THREE.BufferGeometry {
  const points: THREE.Vector2[] = [];
  for (let index = 0; index <= 20; index += 1) {
    const y = index / 20 - 0.5;
    points.push(new THREE.Vector2(Math.sqrt(Math.max(0, y + 0.5)) * 0.5, y));
  }
  return new THREE.LatheGeometry(points, sides);
}

function normaliseToUnitBox(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) return geometry;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(
    1 / Math.max(size.x, 0.0001),
    1 / Math.max(size.y, 0.0001),
    1 / Math.max(size.z, 0.0001),
  );
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createPrimitiveGeometryForKind(
  primitive: PrimitiveKind,
  sides = 48,
): THREE.BufferGeometry {
  let geometry: THREE.BufferGeometry;
  switch (primitive) {
    case 'box':
      geometry = new THREE.BoxGeometry(1, 1, 1);
      break;
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, sides);
      break;
    case 'sphere':
      geometry = new THREE.SphereGeometry(0.5, sides, Math.max(12, Math.floor(sides / 2)));
      break;
    case 'cone':
      geometry = new THREE.CylinderGeometry(0, 0.5, 1, sides);
      break;
    case 'torus':
      geometry = new THREE.TorusGeometry(0.36, 0.14, Math.max(12, Math.floor(sides / 2)), sides);
      geometry.rotateX(Math.PI / 2);
      break;
    case 'wedge':
      geometry = wedgeGeometry();
      break;
    case 'roof':
      geometry = roofGeometry();
      break;
    case 'pyramid':
      geometry = new THREE.CylinderGeometry(0, 0.5, 1, 4);
      break;
    case 'half-sphere':
      geometry = new THREE.SphereGeometry(
        0.5,
        sides,
        Math.max(8, Math.floor(sides / 4)),
        0,
        Math.PI * 2,
        0,
        Math.PI / 2,
      );
      geometry.translate(0, -0.25, 0);
      break;
    case 'tube':
      geometry = tubeGeometry();
      break;
    case 'rounded-box':
      geometry = roundedBoxGeometry();
      break;
    case 'polygon':
      geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, sides);
      break;
    case 'star':
      geometry = pointedStarGeometry();
      break;
    case 'heart':
      geometry = heartGeometry();
      break;
    case 'diamond':
      geometry = new THREE.OctahedronGeometry(0.5, 0);
      break;
    case 'capsule':
      geometry = new THREE.CapsuleGeometry(0.32, 0.72, 8, Math.max(12, Math.floor(sides / 2)));
      break;
    case 'paraboloid':
      geometry = paraboloidGeometry(sides);
      break;
    case 'extrude-sketch':
      geometry = starGeometry(7);
      break;
    case 'revolve-sketch':
      geometry = revolveSketchGeometry(sides);
      break;
    case 'scribble':
      geometry = heartGeometry();
      break;
    case 'text':
      geometry = textGeometry('TEXT', 0);
      break;
    case 'round-roof':
      geometry = roundRoofGeometry(sides);
      break;
    case 'ring':
      geometry = new THREE.TorusGeometry(0.38, 0.12, Math.max(8, Math.floor(sides / 3)), sides);
      geometry.rotateX(Math.PI / 2);
      break;
    case 'icosahedron':
      geometry = new THREE.IcosahedronGeometry(0.5, 0);
      break;
    case 'star-6':
      geometry = starGeometry(6);
      break;
  }
  return normaliseToUnitBox(geometry);
}

function beveledPrismGeometry(node: ThreeDNode, sides: number): THREE.BufferGeometry {
  if (node.bevel <= 0) return new THREE.CylinderGeometry(0.5, 0.5, 1, sides);
  const minimumDimension = Math.max(
    0.001,
    Math.min(node.dimensions.width, node.dimensions.depth, node.dimensions.height),
  );
  const bevel = Math.min(0.24, node.bevel / minimumDimension);
  const segments = Math.max(1, Math.min(10, node.parameters.bevelSegments));
  const profile: THREE.Vector2[] = [new THREE.Vector2(0, -0.5)];
  for (let index = 0; index <= segments; index += 1) {
    const angle = -Math.PI / 2 + (index / segments) * (Math.PI / 2);
    profile.push(
      new THREE.Vector2(
        0.5 - bevel + bevel * Math.cos(angle),
        -0.5 + bevel + bevel * Math.sin(angle),
      ),
    );
  }
  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * (Math.PI / 2);
    profile.push(
      new THREE.Vector2(
        0.5 - bevel + bevel * Math.cos(angle),
        0.5 - bevel + bevel * Math.sin(angle),
      ),
    );
  }
  profile.push(new THREE.Vector2(0, 0.5));
  return new THREE.LatheGeometry(profile, sides);
}

export function createPrimitiveGeometry(node: ThreeDNode): THREE.BufferGeometry {
  if (node.primitive === 'box' && node.bevel > 0) {
    const minimumDimension = Math.max(
      0.001,
      Math.min(node.dimensions.width, node.dimensions.depth, node.dimensions.height),
    );
    const radius = Math.min(0.49, node.bevel / minimumDimension);
    return normaliseToUnitBox(
      new RoundedBoxGeometry(1, 1, 1, Math.max(1, Math.min(12, node.sides)), radius),
    );
  }
  if (node.primitive === 'cylinder') {
    return normaliseToUnitBox(beveledPrismGeometry(node, node.sides));
  }
  if (node.primitive === 'cone') {
    return normaliseToUnitBox(
      new THREE.CylinderGeometry(
        Math.max(0, node.parameters.topRadius),
        Math.max(0.1, node.parameters.baseRadius),
        1,
        node.sides,
      ),
    );
  }
  if (node.primitive === 'text') {
    return normaliseToUnitBox(
      textGeometry(
        node.parameters.text,
        node.bevel,
        node.parameters.segments,
        node.parameters.font,
        node.parameters.curveAngle,
      ),
    );
  }
  if (node.primitive === 'sphere') {
    const steps = Math.max(3, Math.min(64, node.parameters.steps));
    return normaliseToUnitBox(new THREE.SphereGeometry(0.5, steps, Math.max(3, steps)));
  }
  if (node.primitive === 'pyramid') {
    return normaliseToUnitBox(new THREE.CylinderGeometry(0, 0.5, 1, node.sides));
  }
  if (node.primitive === 'polygon') {
    return normaliseToUnitBox(beveledPrismGeometry(node, node.sides));
  }
  if (node.primitive === 'torus') {
    const radius = Math.max(0.1, node.parameters.radius);
    const tube = Math.max(0.1, node.parameters.tubeRadius);
    const total = radius + tube;
    const geometry = new THREE.TorusGeometry(
      radius / total,
      tube / total,
      Math.max(3, node.sides),
      Math.max(3, node.parameters.steps),
    );
    geometry.rotateX(Math.PI / 2);
    return normaliseToUnitBox(geometry);
  }
  if (node.primitive === 'tube') {
    return normaliseToUnitBox(
      tubeGeometry(
        node.parameters.radius,
        node.parameters.wallThickness,
        node.sides,
        node.bevel,
        node.parameters.bevelSegments,
      ),
    );
  }
  if (node.primitive === 'star') {
    return normaliseToUnitBox(pointedStarGeometry(5, 0.44));
  }
  if (node.primitive === 'star-6') {
    return normaliseToUnitBox(starGeometry(node.parameters.points, node.parameters.innerRatio));
  }
  if (node.primitive === 'extrude-sketch') {
    return normaliseToUnitBox(
      sketchExtrudeGeometry(
        node.parameters.sketchPoints,
        node.parameters.topScale,
        node.parameters.baseScale,
        node.parameters.twist,
        node.parameters.smoothTwist ? 32 : node.parameters.twistSteps,
      ),
    );
  }
  if (node.primitive === 'scribble') {
    return normaliseToUnitBox(sketchExtrudeGeometry(node.parameters.sketchPoints));
  }
  if (node.primitive === 'revolve-sketch') {
    return normaliseToUnitBox(revolveSketchGeometry(node.sides, node.parameters.sketchPoints));
  }
  return createPrimitiveGeometryForKind(node.primitive, node.sides);
}

export function createNodeObject(node: ThreeDNode): THREE.Group {
  const group = new THREE.Group();
  group.name = node.name;
  group.userData['nodeId'] = node.id;
  const material =
    node.operation === 'hole'
      ? new THREE.MeshStandardMaterial({
          color: '#b9c4cc',
          emissive: '#000000',
          emissiveIntensity: 0,
          roughness: 0.9,
          metalness: 0,
          transparent: true,
          opacity: 0.36,
          depthWrite: false,
        })
      : createCadSolidMaterial(node.color, node.opacity);
  const mesh = new THREE.Mesh(createPrimitiveGeometry(node), material);
  mesh.name = `${node.name}:mesh`;
  mesh.userData['nodeId'] = node.id;
  mesh.scale.set(node.dimensions.width, node.dimensions.height, node.dimensions.depth);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  addModelOutlines(mesh, node.operation);
  group.add(mesh);
  applyNodeTransform(group, node);
  group.visible = node.visible;
  return group;
}

export function applyNodeTransform(group: THREE.Group, node: ThreeDNode): void {
  const toRadians = Math.PI / 180;
  group.position.set(
    node.transform.position.x,
    node.transform.position.y,
    node.transform.position.z,
  );
  group.rotation.set(
    node.transform.rotation.x * toRadians,
    node.transform.rotation.y * toRadians,
    node.transform.rotation.z * toRadians,
  );
  group.scale.set(node.transform.scale.x, node.transform.scale.y, node.transform.scale.z);
}

export function disposeObject(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  object.traverse((child) => {
    const renderable = child as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    if (renderable.geometry) geometries.add(renderable.geometry);
    if (Array.isArray(renderable.material)) {
      renderable.material.forEach((material) => materials.add(material));
    } else if (renderable.material) {
      materials.add(renderable.material);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}
