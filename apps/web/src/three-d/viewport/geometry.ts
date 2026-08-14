import * as THREE from 'three';
import type { PrimitiveKind, ThreeDNode } from '@asa-lab/three-d';

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

function starGeometry(): THREE.BufferGeometry {
  const points: [number, number][] = [];
  for (let index = 0; index < 10; index += 1) {
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    const radius = index % 2 === 0 ? 0.5 : 0.22;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return extrudedShapeGeometry(points, 0.24);
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
  }
  return normaliseToUnitBox(geometry);
}

export function createPrimitiveGeometry(node: ThreeDNode): THREE.BufferGeometry {
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
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
    else child.material.dispose();
  });
}
