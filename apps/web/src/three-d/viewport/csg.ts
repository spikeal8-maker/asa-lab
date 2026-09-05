import * as THREE from 'three';
import type { BooleanOperation, ThreeDNode } from '@asa-lab/three-d';
import type { EvaluatedBooleanGeometry } from '../geometry/worker-protocol';
import { addModelOutlineGeometry, createPrimitiveGeometry } from './geometry';
import { createCadSolidMaterial } from './cad-appearance';

const EPSILON = 1e-5;
const FEATURE_EDGE_EPSILON = 1e-4;
const FEATURE_EDGE_ANGLE = THREE.MathUtils.degToRad(24);
const FEATURE_EDGE_COSINE = Math.cos(FEATURE_EDGE_ANGLE);
const FEATURE_EDGE_DATA = 'asaBooleanFeatureEdges';

export function readBooleanFeatureEdges(geometry: THREE.BufferGeometry): readonly number[] {
  const values = geometry.userData[FEATURE_EDGE_DATA];
  return Array.isArray(values) ? values : [];
}

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
    const frontPolygon = cleanPolygon(frontVertices);
    const backPolygon = cleanPolygon(backVertices);
    if (frontPolygon) front.push(frontPolygon);
    if (backPolygon) back.push(backPolygon);
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

/**
 * BSP cuts can land on an existing vertex and leave a repeated or collinear
 * point in the generated loop. Passing that loop back into the tree creates a
 * zero plane and, later, needle triangles. Besides being invalid printable
 * geometry, those needles were visible as the dark streaks reported on union
 * and sphere subtraction results.
 */
function cleanPolygon(vertices: readonly Vertex[]): Polygon | null {
  const cleaned: Vertex[] = [];
  for (const vertex of vertices) {
    if (!vertex.position.toArray().every(Number.isFinite)) return null;
    const previous = cleaned.at(-1);
    if (!previous || previous.position.distanceToSquared(vertex.position) > EPSILON * EPSILON) {
      cleaned.push(vertex);
    }
  }
  if (
    cleaned.length > 2 &&
    cleaned[0]!.position.distanceToSquared(cleaned.at(-1)!.position) <= EPSILON * EPSILON
  ) {
    cleaned.pop();
  }
  let changed = true;
  while (changed && cleaned.length > 3) {
    changed = false;
    for (let index = 0; index < cleaned.length; index += 1) {
      const previous = cleaned[(index - 1 + cleaned.length) % cleaned.length]!;
      const current = cleaned[index]!;
      const next = cleaned[(index + 1) % cleaned.length]!;
      const cross = current.position
        .clone()
        .sub(previous.position)
        .cross(next.position.clone().sub(current.position));
      if (cross.lengthSq() > EPSILON * EPSILON) continue;
      cleaned.splice(index, 1);
      changed = true;
      break;
    }
  }
  if (cleaned.length < 3) return null;
  const area = cleaned[1]!.position
    .clone()
    .sub(cleaned[0]!.position)
    .cross(cleaned[2]!.position.clone().sub(cleaned[0]!.position));
  return area.lengthSq() > EPSILON * EPSILON ? new Polygon(cleaned) : null;
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
  const normal = source.getAttribute('normal');
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const polygons: Polygon[] = [];
  for (let offset = 0; offset + 2 < position.count; offset += 3) {
    const vertices: Vertex[] = [];
    for (let index = 0; index < 3; index += 1) {
      const point = new THREE.Vector3()
        .fromBufferAttribute(position, offset + index)
        .applyMatrix4(matrix);
      const vertexNormal = normal
        ? new THREE.Vector3()
            .fromBufferAttribute(normal, offset + index)
            .applyNormalMatrix(normalMatrix)
            .normalize()
        : new THREE.Vector3();
      vertices.push(new Vertex(point, vertexNormal));
    }
    const faceNormal = vertices[1]!.position
      .clone()
      .sub(vertices[0]!.position)
      .cross(vertices[2]!.position.clone().sub(vertices[0]!.position))
      .normalize();
    if (!normal) vertices.forEach((vertex) => vertex.normal.copy(faceNormal));
    if (faceNormal.lengthSq() > EPSILON * EPSILON) polygons.push(new Polygon(vertices));
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

interface SurfaceEdge {
  readonly start: THREE.Vector3;
  readonly end: THREE.Vector3;
  readonly normal: THREE.Vector3;
}

interface CollinearEdgeGroup {
  readonly direction: THREE.Vector3;
  readonly records: SurfaceEdge[];
}

function quantize(value: number): number {
  return Math.round(value / FEATURE_EDGE_EPSILON);
}

function canonicalDirection(start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3 {
  const direction = end.clone().sub(start).normalize();
  const significant = [direction.x, direction.y, direction.z].find(
    (component) => Math.abs(component) > FEATURE_EDGE_EPSILON,
  );
  if ((significant ?? 1) < 0) direction.multiplyScalar(-1);
  return direction;
}

function collinearEdgeKey(start: THREE.Vector3, end: THREE.Vector3): string {
  const direction = canonicalDirection(start, end);
  const offset = start.clone().sub(direction.clone().multiplyScalar(start.dot(direction)));
  return [
    quantize(direction.x),
    quantize(direction.y),
    quantize(direction.z),
    quantize(offset.x),
    quantize(offset.y),
    quantize(offset.z),
  ].join(':');
}

function uniqueSorted(values: readonly number[]): number[] {
  const sorted = [...values].sort((left, right) => left - right);
  const result: number[] = [];
  for (const value of sorted) {
    if (result.length === 0 || Math.abs(value - result.at(-1)!) > FEATURE_EDGE_EPSILON) {
      result.push(value);
    }
  }
  return result;
}

/**
 * Builds only authored/boolean feature edges. CSG frequently splits one edge
 * into several collinear pieces (T-junctions), so exact triangle-pair matching
 * exposes triangulation fans. Grouping by the infinite line and subdividing it
 * into atomic intervals lets us compare the actual adjacent surface normals.
 */
function createFeatureEdgePositions(polygons: readonly Polygon[]): number[] {
  const groups = new Map<string, CollinearEdgeGroup>();
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.vertices.length; index += 1) {
      const start = polygon.vertices[index]!.position;
      const end = polygon.vertices[(index + 1) % polygon.vertices.length]!.position;
      if (start.distanceToSquared(end) <= FEATURE_EDGE_EPSILON * FEATURE_EDGE_EPSILON) continue;
      const key = collinearEdgeKey(start, end);
      const group = groups.get(key) ?? {
        direction: canonicalDirection(start, end),
        records: [],
      };
      group.records.push({ start, end, normal: polygon.plane.normal });
      groups.set(key, group);
    }
  }

  const positions: number[] = [];
  for (const group of groups.values()) {
    const parameters = uniqueSorted(
      group.records.flatMap((record) => [
        record.start.dot(group.direction),
        record.end.dot(group.direction),
      ]),
    );
    const featureIntervals: Array<{ start: number; end: number; reference: THREE.Vector3 }> = [];
    for (let index = 0; index + 1 < parameters.length; index += 1) {
      const startParameter = parameters[index]!;
      const endParameter = parameters[index + 1]!;
      if (endParameter - startParameter <= FEATURE_EDGE_EPSILON) continue;
      const midpoint = (startParameter + endParameter) / 2;
      const covering = group.records.filter((record) => {
        const first = record.start.dot(group.direction);
        const second = record.end.dot(group.direction);
        return (
          midpoint >= Math.min(first, second) - FEATURE_EDGE_EPSILON &&
          midpoint <= Math.max(first, second) + FEATURE_EDGE_EPSILON
        );
      });
      const isFeature =
        covering.length === 1 ||
        covering.some((record, recordIndex) =>
          covering
            .slice(recordIndex + 1)
            .some((other) => Math.abs(record.normal.dot(other.normal)) < FEATURE_EDGE_COSINE),
        );
      if (!isFeature) continue;
      const previous = featureIntervals.at(-1);
      if (previous && Math.abs(previous.end - startParameter) <= FEATURE_EDGE_EPSILON) {
        previous.end = endParameter;
        continue;
      }
      featureIntervals.push({
        start: startParameter,
        end: endParameter,
        reference: covering[0]!.start,
      });
    }
    for (const interval of featureIntervals) {
      const reference = interval.reference;
      const referenceParameter = reference.dot(group.direction);
      const start = reference
        .clone()
        .add(group.direction.clone().multiplyScalar(interval.start - referenceParameter));
      const end = reference
        .clone()
        .add(group.direction.clone().multiplyScalar(interval.end - referenceParameter));
      positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
    }
  }
  return positions;
}

function toGeometry(node: Node): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const polygons = node.allPolygons();
  for (const polygon of polygons) {
    for (let index = 2; index < polygon.vertices.length; index += 1) {
      const triangle = [
        polygon.vertices[0]!,
        polygon.vertices[index - 1]!,
        polygon.vertices[index]!,
      ] as const;
      const areaSquared = triangle[1].position
        .clone()
        .sub(triangle[0].position)
        .cross(triangle[2].position.clone().sub(triangle[0].position))
        .lengthSq();
      if (areaSquared <= EPSILON * EPSILON) continue;
      for (const vertex of triangle) {
        positions.push(vertex.position.x, vertex.position.y, vertex.position.z);
        normals.push(vertex.normal.x, vertex.normal.y, vertex.normal.z);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.userData[FEATURE_EDGE_DATA] = createFeatureEdgePositions(polygons);
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
  return createBooleanMeshFromGeometry(geometry, nodes);
}

function createBooleanMeshFromGeometry(
  geometry: THREE.BufferGeometry,
  nodes: readonly ThreeDNode[],
): THREE.Mesh {
  const firstSolid = nodes.find((node) => node.operation === 'solid');
  const color = firstSolid?.color ?? '#27a9e1';
  const material = createCadSolidMaterial(color, firstSolid?.opacity ?? 1);
  const mesh = new THREE.Mesh(geometry, material);
  const featureEdgePositions = readBooleanFeatureEdges(geometry);
  if (featureEdgePositions.length > 0) {
    const outlineGeometry = new THREE.BufferGeometry();
    outlineGeometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(featureEdgePositions, 3),
    );
    addModelOutlineGeometry(mesh, outlineGeometry, 'solid');
  }
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData['booleanGroupId'] = nodes[0]?.groupId ?? '';
  return mesh;
}

export function createBooleanMeshFromEvaluation(
  evaluation: EvaluatedBooleanGeometry,
  nodes: readonly ThreeDNode[],
): THREE.Mesh | null {
  if (evaluation.resultKind === 'empty') return null;
  if (
    evaluation.positions.length === 0 ||
    evaluation.normals.length !== evaluation.positions.length
  ) {
    return null;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(evaluation.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(evaluation.normals, 3));
  geometry.userData[FEATURE_EDGE_DATA] = Array.from(evaluation.featureEdges);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return createBooleanMeshFromGeometry(geometry, nodes);
}
