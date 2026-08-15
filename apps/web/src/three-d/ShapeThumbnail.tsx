import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { PrimitiveKind, ShapeOperation } from '@asa-lab/three-d';
import { createPrimitiveGeometryForKind } from './viewport/geometry';

interface ShapeThumbnailProps {
  readonly color: string;
  readonly primitive: PrimitiveKind;
  readonly operation?: ShapeOperation;
}

interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
}

interface ProjectedTriangle {
  readonly color: string;
  readonly depth: number;
  readonly points: readonly [ProjectedPoint, ProjectedPoint, ProjectedPoint];
}

interface ProjectedLine {
  readonly from: ProjectedPoint;
  readonly to: ProjectedPoint;
}

const WIDTH = 92;
const HEIGHT = 70;
const KEY_POSITION = new THREE.Vector3(-3.2, 5.5, 4.2);
const RIM_POSITION = new THREE.Vector3(4, 2, -4);

function projectPoint(point: THREE.Vector3, camera: THREE.OrthographicCamera): ProjectedPoint {
  const projected = point.clone().project(camera);
  return {
    x: (projected.x * 0.5 + 0.5) * WIDTH,
    y: (-projected.y * 0.5 + 0.5) * HEIGHT - 2,
  };
}

function shadeColor(base: THREE.Color, intensity: number): string {
  const shaded = base.clone().multiplyScalar(intensity);
  shaded.r = THREE.MathUtils.clamp(shaded.r, 0, 1);
  shaded.g = THREE.MathUtils.clamp(shaded.g, 0, 1);
  shaded.b = THREE.MathUtils.clamp(shaded.b, 0, 1);
  return shaded.getStyle(THREE.SRGBColorSpace);
}

function collectTriangles(
  geometry: THREE.BufferGeometry,
  camera: THREE.OrthographicCamera,
  modelMatrix: THREE.Matrix4,
  color: string,
): ProjectedTriangle[] {
  const position = geometry.getAttribute('position');
  if (!(position instanceof THREE.BufferAttribute)) return [];
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const base = new THREE.Color(color);
  const triangles: ProjectedTriangle[] = [];

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const center = new THREE.Vector3();
  const toCamera = new THREE.Vector3();
  const toKey = new THREE.Vector3();
  const toRim = new THREE.Vector3();

  for (let offset = 0; offset < count; offset += 3) {
    const aIndex = index?.getX(offset) ?? offset;
    const bIndex = index?.getX(offset + 1) ?? offset + 1;
    const cIndex = index?.getX(offset + 2) ?? offset + 2;
    a.fromBufferAttribute(position, aIndex).applyMatrix4(modelMatrix);
    b.fromBufferAttribute(position, bIndex).applyMatrix4(modelMatrix);
    c.fromBufferAttribute(position, cIndex).applyMatrix4(modelMatrix);

    edgeA.subVectors(b, a);
    edgeB.subVectors(c, a);
    normal.crossVectors(edgeA, edgeB);
    if (normal.lengthSq() < 0.000001) continue;
    normal.normalize();
    center
      .copy(a)
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3);
    toCamera.subVectors(camera.position, center).normalize();
    if (normal.dot(toCamera) <= 0) continue;

    const diffuse = Math.max(0, normal.dot(toKey.subVectors(KEY_POSITION, center).normalize()));
    const rim = Math.max(0, normal.dot(toRim.subVectors(RIM_POSITION, center).normalize()));
    const intensity = Math.min(1.3, 0.58 + diffuse * 0.66 + rim * 0.14);
    triangles.push({
      color: shadeColor(base, intensity),
      depth: center.distanceToSquared(camera.position),
      points: [projectPoint(a, camera), projectPoint(b, camera), projectPoint(c, camera)],
    });
  }

  return triangles.sort((left, right) => right.depth - left.depth);
}

function collectHardEdges(
  geometry: THREE.BufferGeometry,
  camera: THREE.OrthographicCamera,
  modelMatrix: THREE.Matrix4,
): ProjectedLine[] {
  const edgeGeometry = new THREE.EdgesGeometry(geometry, 24);
  const positions = edgeGeometry.getAttribute('position');
  const lines: ProjectedLine[] = [];
  if (positions instanceof THREE.BufferAttribute) {
    for (let index = 0; index + 1 < positions.count; index += 2) {
      const from = new THREE.Vector3()
        .fromBufferAttribute(positions, index)
        .applyMatrix4(modelMatrix);
      const to = new THREE.Vector3()
        .fromBufferAttribute(positions, index + 1)
        .applyMatrix4(modelMatrix);
      lines.push({ from: projectPoint(from, camera), to: projectPoint(to, camera) });
    }
  }
  edgeGeometry.dispose();
  return lines;
}

function drawTrianglePath(context: CanvasRenderingContext2D, triangle: ProjectedTriangle): void {
  context.beginPath();
  context.moveTo(triangle.points[0].x, triangle.points[0].y);
  context.lineTo(triangle.points[1].x, triangle.points[1].y);
  context.lineTo(triangle.points[2].x, triangle.points[2].y);
  context.closePath();
}

function drawShadow(context: CanvasRenderingContext2D): void {
  context.save();
  context.filter = 'blur(3px)';
  context.fillStyle = 'rgba(42, 61, 69, 0.2)';
  context.beginPath();
  context.ellipse(59, 57, 20, 5.2, -0.08, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.fillStyle = 'rgba(42, 61, 69, 0.12)';
  context.beginPath();
  context.ellipse(49, 54, 12, 3.2, 0, 0, Math.PI * 2);
  context.fill();
}

function previewModelMatrix(primitive: PrimitiveKind): THREE.Matrix4 {
  const heightRatio = primitive === 'torus' ? 7 / 24 : primitive === 'roof' ? 15 / 20 : 1;
  const matrix = new THREE.Matrix4().makeRotationY(-0.16);
  matrix.scale(new THREE.Vector3(1, heightRatio, 1));
  matrix.setPosition(0, (heightRatio - 1) / 2, 0);
  return matrix;
}

function renderThumbnail(
  target: HTMLCanvasElement,
  primitive: PrimitiveKind,
  color: string,
  operation: ShapeOperation,
): void {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  target.width = Math.round(WIDTH * pixelRatio);
  target.height = Math.round(HEIGHT * pixelRatio);
  const context = target.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, WIDTH, HEIGHT);
  context.lineJoin = 'round';
  drawShadow(context);

  const camera = new THREE.OrthographicCamera(-1.08, 1.08, 0.82, -0.82, 0.1, 20);
  camera.position.set(2.5, 2.05, 2.8);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const modelMatrix = previewModelMatrix(primitive);
  const geometry = createPrimitiveGeometryForKind(primitive, 48);
  const triangles = collectTriangles(geometry, camera, modelMatrix, color);
  const hardEdges = collectHardEdges(geometry, camera, modelMatrix);
  const stripeCanvas = globalThis.document.createElement('canvas');
  stripeCanvas.width = 12;
  stripeCanvas.height = 12;
  const stripeContext = stripeCanvas.getContext('2d');
  if (stripeContext) {
    stripeContext.fillStyle = '#c8d0d5';
    stripeContext.fillRect(0, 0, 12, 12);
    stripeContext.strokeStyle = '#929fa7';
    stripeContext.lineWidth = 4;
    stripeContext.beginPath();
    stripeContext.moveTo(-3, 11);
    stripeContext.lineTo(11, -3);
    stripeContext.moveTo(3, 15);
    stripeContext.lineTo(15, 3);
    stripeContext.stroke();
  }
  const stripePattern = context.createPattern(stripeCanvas, 'repeat');
  // Paint a dark underlay first. The second fill covers its inner half, leaving
  // a clean silhouette around the finished thumbnail instead of a soft blur.
  context.strokeStyle = operation === 'hole' ? '#5d6b72' : '#1b272d';
  context.fillStyle = context.strokeStyle;
  context.lineWidth = 2.1;
  for (const triangle of triangles) {
    drawTrianglePath(context, triangle);
    context.fill();
    context.stroke();
  }

  for (const triangle of triangles) {
    context.fillStyle = operation === 'hole' && stripePattern ? stripePattern : triangle.color;
    context.strokeStyle = operation === 'hole' ? '#8a969d' : triangle.color;
    context.lineWidth = 0.45;
    drawTrianglePath(context, triangle);
    context.fill();
    context.stroke();
  }
  context.strokeStyle = operation === 'hole' ? '#56656d' : '#17242a';
  context.lineWidth = 1.05;
  for (const edge of hardEdges) {
    context.beginPath();
    context.moveTo(edge.from.x, edge.from.y);
    context.lineTo(edge.to.x, edge.to.y);
    context.stroke();
  }
  geometry.dispose();
}

export function ShapeThumbnail({
  color,
  primitive,
  operation = 'solid',
}: ShapeThumbnailProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      renderThumbnail(canvas, primitive, color, operation);
      delete canvas.dataset['renderFailed'];
    } catch {
      canvas.dataset['renderFailed'] = 'true';
    }
  }, [color, operation, primitive]);

  return <canvas ref={canvasRef} className="asa3d-shape-thumbnail" aria-hidden="true" />;
}
