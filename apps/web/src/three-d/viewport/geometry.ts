import * as THREE from 'three';
import type { ThreeDNode } from '@asa-lab/three-d';

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

export function createPrimitiveGeometry(node: ThreeDNode): THREE.BufferGeometry {
  switch (node.primitive) {
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, node.sides);
    case 'sphere':
      return new THREE.SphereGeometry(0.5, node.sides, Math.max(8, Math.floor(node.sides / 2)));
    case 'cone':
      return new THREE.CylinderGeometry(0, 0.5, 1, node.sides);
    case 'torus':
      return new THREE.TorusGeometry(
        0.36,
        0.14,
        Math.max(8, Math.floor(node.sides / 2)),
        node.sides,
      );
    case 'wedge':
      return wedgeGeometry();
    case 'roof':
      return roofGeometry();
  }
}

export function createNodeObject(node: ThreeDNode): THREE.Group {
  const group = new THREE.Group();
  group.name = node.name;
  group.userData['nodeId'] = node.id;
  const material = new THREE.MeshStandardMaterial({
    color: node.operation === 'hole' ? '#b9c4cc' : node.color,
    roughness: 0.55,
    metalness: 0.02,
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
