import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import type { Font } from 'three/addons/loaders/FontLoader.js';
import type { PrimitiveKind, ThreeDNode } from '@asa-lab/three-d';

const MODEL_EDGE_COLOR = '#17242a';
const MODEL_EDGE_THRESHOLD_DEGREES = 24;
const MODEL_SILHOUETTE_WIDTH_MM = 0.22;

export const MODEL_EDGE_NAME = 'ASA model hard edges';
export const MODEL_SILHOUETTE_NAME = 'ASA model silhouette';

/**
 * Gives every viewport shape the same readable visual hierarchy as a simple CAD
 * model: a dark outside silhouette plus crisp lines on real hard edges. These
 * helpers are children of the mesh so they follow every transform without
 * changing the saved geometry or the printable/exported model.
 */
export function addModelOutlines(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>,
  operation: ThreeDNode['operation'] = 'solid',
): void {
  if (operation === 'solid') {
    const silhouette = new THREE.Mesh(
      mesh.geometry.clone(),
      new THREE.ShaderMaterial({
        uniforms: {
          outlineWidth: { value: MODEL_SILHOUETTE_WIDTH_MM },
          outlineColor: { value: new THREE.Color(MODEL_EDGE_COLOR) },
          outlineOpacity: { value: 0.82 },
        },
        vertexShader: `
          uniform float outlineWidth;
          void main() {
            vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
            vec3 viewNormal = normalize(normalMatrix * normal);
            viewPosition.xyz += viewNormal * outlineWidth;
            gl_Position = projectionMatrix * viewPosition;
          }
        `,
        fragmentShader: `
          uniform vec3 outlineColor;
          uniform float outlineOpacity;
          void main() {
            gl_FragColor = vec4(outlineColor, outlineOpacity);
          }
        `,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    silhouette.name = MODEL_SILHOUETTE_NAME;
    silhouette.renderOrder = 2;
    silhouette.raycast = () => {};
    silhouette.userData['modelOutline'] = true;
    mesh.add(silhouette);
  }

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, MODEL_EDGE_THRESHOLD_DEGREES),
    new THREE.LineBasicMaterial({
      color: operation === 'hole' ? '#526169' : MODEL_EDGE_COLOR,
      transparent: true,
      opacity: operation === 'hole' ? 0.62 : 0.78,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  edges.name = MODEL_EDGE_NAME;
  edges.renderOrder = 4;
  edges.raycast = () => {};
  edges.userData['modelOutline'] = true;
  mesh.add(edges);
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
  geometry.computeVertexNormals();
  return geometry;
}

function roofGeometry(): THREE.BufferGeometry {
  const vertices = new Float32Array([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, 0.5,
  ]);
  const indices = [0, 1, 2, 0, 2, 3, 0, 4, 1, 3, 2, 5, 0, 3, 5, 0, 5, 4, 1, 4, 5, 1, 5, 2];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function extrudedShapeGeometry(
  points: readonly (readonly [number, number])[],
  depth = 1,
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  points.forEach(([x, y], index) => (index === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 16,
  });
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function starGeometry(pointsCount = 5): THREE.BufferGeometry {
  const points: [number, number][] = [];
  for (let index = 0; index < pointsCount * 2; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI) / pointsCount;
    const radius = index % 2 === 0 ? 0.5 : 0.22;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return extrudedShapeGeometry(points, 0.24);
}

function roundRoofGeometry(sides: number): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, sides, 1, false, 0, Math.PI);
  geometry.rotateZ(Math.PI / 2);
  return geometry;
}

function revolveSketchGeometry(sides: number): THREE.BufferGeometry {
  const profile = [
    new THREE.Vector2(0, -0.5),
    new THREE.Vector2(0.31, -0.5),
    new THREE.Vector2(0.42, -0.28),
    new THREE.Vector2(0.26, 0.02),
    new THREE.Vector2(0.36, 0.3),
    new THREE.Vector2(0.2, 0.5),
    new THREE.Vector2(0, 0.5),
  ];
  return new THREE.LatheGeometry(profile, sides);
}

const PIXEL_GLYPHS: Readonly<Record<string, string>> = {
  A: '01110/10001/10001/11111/10001/10001/10001',
  B: '11110/10001/10001/11110/10001/10001/11110',
  C: '01111/10000/10000/10000/10000/10000/01111',
  D: '11110/10001/10001/10001/10001/10001/11110',
  E: '11111/10000/10000/11110/10000/10000/11111',
  F: '11111/10000/10000/11110/10000/10000/10000',
  G: '01111/10000/10000/10111/10001/10001/01111',
  H: '10001/10001/10001/11111/10001/10001/10001',
  I: '11111/00100/00100/00100/00100/00100/11111',
  J: '00111/00010/00010/00010/10010/10010/01100',
  K: '10001/10010/10100/11000/10100/10010/10001',
  L: '10000/10000/10000/10000/10000/10000/11111',
  M: '10001/11011/10101/10101/10001/10001/10001',
  N: '10001/11001/10101/10011/10001/10001/10001',
  O: '01110/10001/10001/10001/10001/10001/01110',
  P: '11110/10001/10001/11110/10000/10000/10000',
  Q: '01110/10001/10001/10001/10101/10010/01101',
  R: '11110/10001/10001/11110/10100/10010/10001',
  S: '01111/10000/10000/01110/00001/00001/11110',
  T: '11111/00100/00100/00100/00100/00100/00100',
  U: '10001/10001/10001/10001/10001/10001/01110',
  V: '10001/10001/10001/10001/10001/01010/00100',
  W: '10001/10001/10001/10101/10101/10101/01010',
  X: '10001/10001/01010/00100/01010/10001/10001',
  Y: '10001/10001/01010/00100/00100/00100/00100',
  Z: '11111/00001/00010/00100/01000/10000/11111',
  '0': '01110/10001/10011/10101/11001/10001/01110',
  '1': '00100/01100/00100/00100/00100/00100/01110',
  '2': '01110/10001/00001/00010/00100/01000/11111',
  '3': '11110/00001/00001/01110/00001/00001/11110',
  '4': '00010/00110/01010/10010/11111/00010/00010',
  '5': '11111/10000/10000/11110/00001/00001/11110',
  '6': '01110/10000/10000/11110/10001/10001/01110',
  '7': '11111/00001/00010/00100/01000/01000/01000',
  '8': '01110/10001/10001/01110/10001/10001/01110',
  '9': '01110/10001/10001/01111/00001/00001/01110',
  '?': '01110/10001/00001/00010/00100/00000/00100',
};

const CYRILLIC_GLYPH_ALIASES: Readonly<Record<string, string>> = {
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  У: 'Y',
  Х: 'X',
};

const textFont = {
  generateShapes(value: string, size: number): THREE.Shape[] {
    const shapes: THREE.Shape[] = [];
    let cursor = 0;
    const pixel = size / 7;
    for (const rawCharacter of value.toLocaleUpperCase('ru')) {
      if (rawCharacter === ' ') {
        cursor += pixel * 4;
        continue;
      }
      const character = CYRILLIC_GLYPH_ALIASES[rawCharacter] ?? rawCharacter;
      const rows = (PIXEL_GLYPHS[character] ?? PIXEL_GLYPHS['?'] ?? '').split('/');
      rows.forEach((row, rowIndex) => {
        [...row].forEach((filled, columnIndex) => {
          if (filled !== '1') return;
          const left = cursor + columnIndex * pixel;
          const bottom = (6 - rowIndex) * pixel;
          const shape = new THREE.Shape();
          shape.moveTo(left, bottom);
          shape.lineTo(left + pixel * 0.86, bottom);
          shape.lineTo(left + pixel * 0.86, bottom + pixel * 0.86);
          shape.lineTo(left, bottom + pixel * 0.86);
          shape.closePath();
          shapes.push(shape);
        });
      });
      cursor += pixel * 6;
    }
    return shapes;
  },
} as Font;

function textGeometry(text: string, bevel: number): THREE.BufferGeometry {
  const geometry = new TextGeometry(text.trim() || 'TEXT', {
    font: textFont,
    size: 1,
    depth: 0.22,
    curveSegments: 8,
    bevelEnabled: bevel > 0,
    bevelSize: Math.min(0.08, bevel / 100),
    bevelThickness: Math.min(0.08, bevel / 100),
    bevelSegments: 2,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
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

function tubeGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 0.5, 0, Math.PI * 2, false);
  const opening = new THREE.Path();
  opening.absarc(0, 0, 0.28, 0, Math.PI * 2, true);
  shape.holes.push(opening);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: false,
    curveSegments: 32,
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
      geometry = starGeometry();
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
  if (node.primitive === 'cylinder' && node.bevel > 0) {
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
    return normaliseToUnitBox(new THREE.LatheGeometry(profile, node.sides));
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
    return normaliseToUnitBox(textGeometry(node.parameters.text, node.bevel));
  }
  return createPrimitiveGeometryForKind(node.primitive, node.sides);
}

export function createNodeObject(node: ThreeDNode): THREE.Group {
  const group = new THREE.Group();
  group.name = node.name;
  group.userData['nodeId'] = node.id;
  const material = new THREE.MeshStandardMaterial({
    color: node.operation === 'hole' ? '#b9c4cc' : node.color,
    roughness: 0.48,
    metalness: 0.015,
    transparent: node.operation === 'hole',
    opacity: node.operation === 'hole' ? 0.36 : 1,
    depthWrite: node.operation !== 'hole',
  });
  const mesh = new THREE.Mesh(createPrimitiveGeometry(node), material);
  mesh.name = `${node.name}:mesh`;
  mesh.userData['nodeId'] = node.id;
  mesh.scale.set(node.dimensions.width, node.dimensions.height, node.dimensions.depth);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
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
