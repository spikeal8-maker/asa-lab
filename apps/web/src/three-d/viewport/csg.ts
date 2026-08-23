import * as THREE from 'three';
import type { BooleanOperation, ThreeDNode } from '@asa-lab/three-d';
import { createPrimitiveGeometry } from './geometry';

const EPSILON = 1e-5;

class Vertex {
  constructor(
    readonly position: THREE.Vector3,
    readonly normal: THREE.Vector3,
  ) {}

  clone(): Vertex {
    return new Vertex(this.position.clone(), this.normal.clone());
  }

  flip(): void {
    this.normal.multiplyScalar(-1);
  }

  interpolate(other: Vertex, amount: number): Vertex {
    return new Vertex(
      this.position.clone().lerp(other.position, amount),
      this.normal.clone().lerp(other.normal, amount).normalize(),
    );
  }
}

class Plane {
  constructor(
    readonly normal: THREE.Vector3,
    readonly w: number,
  ) {}

  static fromPoints(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): Plane {
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    return new Plane(normal, normal.dot(a));
  }

  clone(): Plane {
    return new Plane(this.normal.clone(), this.w);
  }

  flip(): void {
    this.normal.multiplyScalar(-1);
    (this as { w: number }).w = -this.w;
  }

  splitPolygon(
    polygon: Polygon,
    coplanarFront: Polygon[],
    coplanarBack: Polygon[],
    front: Polygon[],
    back: Polygon[],
  ): void {
    const COPLANAR = 0;
    const FRONT = 1;
    const BACK = 2;
    const SPANNING = 3;
    let polygonType = COPLANAR;
    const types = polygon.vertices.map((vertex) => {
      const value = this.normal.dot(vertex.position) - this.w;
      const type = value < -EPSILON ? BACK : value > EPSILON ? FRONT : COPLANAR;
      polygonType |= type;
      return type;
    });
    if (polygonType === COPLANAR) {
      (this.normal.dot(polygon.plane.normal) > 0 ? coplanarFront : coplanarBack).push(polygon);
      return;
    }
    if (polygonType === FRONT) {
      front.push(polygon);
      return;
    }
    if (polygonType === BACK) {
      back.push(polygon);
      return;
    }
    const frontVertices: Vertex[] = [];
    const backVertices: Vertex[] = [];
    for (let index = 0; index < polygon.vertices.length; index += 1) {
      const next = (index + 1) % polygon.vertices.length;
      const type = types[index] ?? COPLANAR;
      const nextType = types[next] ?? COPLANAR;
      const vertex = polygon.vertices[index] as Vertex;
      const nextVertex = polygon.vertices[next] as Vertex;
      if (type !== BACK) frontVertices.push(vertex);
      if (type !== FRONT) backVertices.push(type !== BACK ? vertex.clone() : vertex);
      if ((type | nextType) === SPANNING) {
        const direction = nextVertex.position.clone().sub(vertex.position);
        const amount = (this.w - this.normal.dot(vertex.position)) / this.normal.dot(direction);
        const split = vertex.interpolate(nextVertex, amount);
        frontVertices.push(split);
        backVertices.push(split.clone());
      }
    }
    if (frontVertices.length >= 3) front.push(new Polygon(frontVertices));
    if (backVertices.length >= 3) back.push(new Polygon(backVertices));
  }
}

class Polygon {
  readonly plane: Plane;

  constructor(readonly vertices: Vertex[]) {
    this.plane = Plane.fromPoints(
      vertices[0]!.position,
      vertices[1]!.position,
      vertices[2]!.position,
    );
  }

  clone(): Polygon {
    return new Polygon(this.vertices.map((vertex) => vertex.clone()));
  }

  flip(): void {
    this.vertices.reverse().forEach((vertex) => vertex.flip());
    this.plane.flip();
  }
}

class Node {
  plane: Plane | null = null;
  front: Node | null = null;
  back: Node | null = null;
  polygons: Polygon[] = [];

  constructor(polygons: readonly Polygon[] = []) {
    if (polygons.length > 0) this.build(polygons.map((polygon) => polygon.clone()));
  }

  clone(): Node {
    const node = new Node();
    node.plane = this.plane?.clone() ?? null;
    node.front = this.front?.clone() ?? null;
    node.back = this.back?.clone() ?? null;
    node.polygons = this.polygons.map((polygon) => polygon.clone());
    return node;
  }

  invert(): void {
    this.polygons.forEach((polygon) => polygon.flip());
    this.plane?.flip();
    this.front?.invert();
    this.back?.invert();
    [this.front, this.back] = [this.back, this.front];
  }

  clipPolygons(polygons: readonly Polygon[]): Polygon[] {
    if (!this.plane) return polygons.map((polygon) => polygon.clone());
    let front: Polygon[] = [];
    let back: Polygon[] = [];
    polygons.forEach((polygon) => this.plane!.splitPolygon(polygon, front, back, front, back));
    if (this.front) front = this.front.clipPolygons(front);
    back = this.back ? this.back.clipPolygons(back) : [];
    return [...front, ...back];
  }

  clipTo(node: Node): void {
    this.polygons = node.clipPolygons(this.polygons);
    this.front?.clipTo(node);
    this.back?.clipTo(node);
  }

  allPolygons(): Polygon[] {
    return [
      ...this.polygons,
      ...(this.front?.allPolygons() ?? []),
      ...(this.back?.allPolygons() ?? []),
    ];
  }

  build(polygons: readonly Polygon[]): void {
    if (polygons.length === 0) return;
    this.plane ??= polygons[0]!.plane.clone();
    const front: Polygon[] = [];
    const back: Polygon[] = [];
    polygons.forEach((polygon) =>
      this.plane!.splitPolygon(polygon, this.polygons, this.polygons, front, back),
    );
    if (front.length > 0) {
      this.front ??= new Node();
      this.front.build(front);
    }
    if (back.length > 0) {
      this.back ??= new Node();
      this.back.build(back);
    }
  }
}

function union(a: Node, b: Node): Node {
  const first = a.clone();
  const second = b.clone();
  first.clipTo(second);
  second.clipTo(first);
  second.invert();
  second.clipTo(first);
  second.invert();
  first.build(second.allPolygons());
  return first;
}

function subtract(a: Node, b: Node): Node {
  const first = a.clone();
  const second = b.clone();
  first.invert();
  first.clipTo(second);
  second.clipTo(first);
  second.invert();
  second.clipTo(first);
  second.invert();
  first.build(second.allPolygons());
  first.invert();
  return first;
}

function intersect(a: Node, b: Node): Node {
  const first = a.clone();
  const second = b.clone();
  first.invert();
  second.clipTo(first);
  second.invert();
  first.clipTo(second);
  second.clipTo(first);
  first.build(second.allPolygons());
  first.invert();
  return first;
}

function geometryToNode(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): Node {
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const position = source.getAttribute('position');
  const polygons: Polygon[] = [];
  for (let offset = 0; offset + 2 < position.count; offset += 3) {
    const vertices: Vertex[] = [];
    for (let index = 0; index < 3; index += 1) {
      const point = new THREE.Vector3()
        .fromBufferAttribute(position, offset + index)
        .applyMatrix4(matrix);
      vertices.push(new Vertex(point, new THREE.Vector3()));
    }
    const faceNormal = vertices[1]!.position
      .clone()
      .sub(vertices[0]!.position)
      .cross(vertices[2]!.position.clone().sub(vertices[0]!.position))
      .normalize();
    vertices.forEach((vertex) => vertex.normal.copy(faceNormal));
    if (faceNormal.lengthSq() > EPSILON) polygons.push(new Polygon(vertices));
  }
  source.dispose();
  return new Node(polygons);
}

function nodeMatrix(node: ThreeDNode): THREE.Matrix4 {
  const position = new THREE.Vector3(
    node.transform.position.x,
    node.transform.position.y,
    node.transform.position.z,
  );
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      THREE.MathUtils.degToRad(node.transform.rotation.x),
      THREE.MathUtils.degToRad(node.transform.rotation.y),
      THREE.MathUtils.degToRad(node.transform.rotation.z),
    ),
  );
  const scale = new THREE.Vector3(
    node.dimensions.width * node.transform.scale.x,
    node.dimensions.height * node.transform.scale.y,
    node.dimensions.depth * node.transform.scale.z,
  );
  return new THREE.Matrix4().compose(position, quaternion, scale);
}

function toGeometry(node: Node): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  for (const polygon of node.allPolygons()) {
    for (let index = 2; index < polygon.vertices.length; index += 1) {
      for (const vertex of [
        polygon.vertices[0]!,
        polygon.vertices[index - 1]!,
        polygon.vertices[index]!,
      ]) {
        positions.push(vertex.position.x, vertex.position.y, vertex.position.z);
        normals.push(vertex.normal.x, vertex.normal.y, vertex.normal.z);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createBooleanGeometry(
  nodes: readonly ThreeDNode[],
  operation: BooleanOperation,
): THREE.BufferGeometry | null {
  const visible = nodes.filter((node) => node.visible);
  const solids =
    operation === 'difference' ? visible.filter((node) => node.operation === 'solid') : visible;
  const holes =
    operation === 'difference' ? visible.filter((node) => node.operation === 'hole') : [];
  if (solids.length === 0) return null;
  const make = (node: ThreeDNode): Node => {
    const geometry = createPrimitiveGeometry(node);
    const result = geometryToNode(geometry, nodeMatrix(node));
    geometry.dispose();
    return result;
  };
  const baseSolids = solids;
  const subtractors = holes;
  let result = make(baseSolids[0]!);
  for (const solid of baseSolids.slice(1)) {
    result =
      operation === 'intersection' ? intersect(result, make(solid)) : union(result, make(solid));
  }
  for (const hole of subtractors) result = subtract(result, make(hole));
  return toGeometry(result);
}

export function createBooleanMesh(
  nodes: readonly ThreeDNode[],
  operation: BooleanOperation,
): THREE.Mesh | null {
  const geometry = createBooleanGeometry(nodes, operation);
  if (!geometry || geometry.getAttribute('position').count === 0) {
    geometry?.dispose();
    return null;
  }
  const color = nodes.find((node) => node.operation === 'solid')?.color ?? '#27a9e1';
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: '#000000',
    emissiveIntensity: 0,
    roughness: 0.9,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData['booleanGroupId'] = nodes[0]?.groupId ?? '';
  return mesh;
}
