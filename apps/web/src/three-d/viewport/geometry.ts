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
