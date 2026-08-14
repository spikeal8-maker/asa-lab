import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { PrimitiveKind } from '@asa-lab/three-d';
import { createPrimitiveGeometryForKind } from './viewport/geometry';

interface ShapeThumbnailProps {
  readonly color: string;
  readonly primitive: PrimitiveKind;
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

function renderThumbnail(target: HTMLCanvasElement, primitive: PrimitiveKind, color: string): void {
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
  for (const triangle of triangles) {
    context.fillStyle = triangle.color;
    context.strokeStyle = triangle.color;
    context.lineWidth = 0.65;
    context.beginPath();
    context.moveTo(triangle.points[0].x, triangle.points[0].y);
    context.lineTo(triangle.points[1].x, triangle.points[1].y);
    context.lineTo(triangle.points[2].x, triangle.points[2].y);
    context.closePath();
    context.fill();
    context.stroke();
  }
  geometry.dispose();
}

export function ShapeThumbnail({ color, primitive }: ShapeThumbnailProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      renderThumbnail(canvas, primitive, color);
      delete canvas.dataset['renderFailed'];
    } catch {
      canvas.dataset['renderFailed'] = 'true';
    }
  }, [color, primitive]);

  return <canvas ref={canvasRef} className="asa3d-shape-thumbnail" aria-hidden="true" />;
}
