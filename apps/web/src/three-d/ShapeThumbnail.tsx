import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { PrimitiveKind, ShapeOperation } from '@asa-lab/three-d';
import { createPrimitiveGeometryForKind } from './viewport/geometry';
import { createCadShadedColor } from './viewport/cad-appearance';

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

interface ProjectedBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
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
  const shaded = createCadShadedColor(base, intensity);
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
  const normalAttribute = geometry.getAttribute('normal');
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
  const vertexNormal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(modelMatrix);
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
    if (normalAttribute instanceof THREE.BufferAttribute) {
      normal
        .set(0, 0, 0)
        .add(
          vertexNormal.fromBufferAttribute(normalAttribute, aIndex).applyNormalMatrix(normalMatrix),
        )
        .add(
          vertexNormal.fromBufferAttribute(normalAttribute, bIndex).applyNormalMatrix(normalMatrix),
        )
        .add(
          vertexNormal.fromBufferAttribute(normalAttribute, cIndex).applyNormalMatrix(normalMatrix),
        );
    }
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
    // Calibrated against the visible Tinkercad basic-shape shelf: the lightest
    // red face stays near #c41825 and the two receding faces near #a91420 and
    // #9b1520 for ASA's canonical #d71920 red.
    const intensity = Math.min(
      0.98,
      0.49 + diffuse * 0.1 + 4 * Math.pow(diffuse, 8) + 6 * Math.pow(diffuse, 12) + rim * 0.03,
    );
    triangles.push({
      color: shadeColor(base, intensity),
      depth: center.distanceToSquared(camera.position),
      points: [projectPoint(a, camera), projectPoint(b, camera), projectPoint(c, camera)],
    });
  }

  return triangles.sort((left, right) => right.depth - left.depth);
}

function drawTrianglePath(context: CanvasRenderingContext2D, triangle: ProjectedTriangle): void {
  context.beginPath();
  context.moveTo(triangle.points[0].x, triangle.points[0].y);
  context.lineTo(triangle.points[1].x, triangle.points[1].y);
  context.lineTo(triangle.points[2].x, triangle.points[2].y);
  context.closePath();
}

function fitTriangles(triangles: readonly ProjectedTriangle[]): {
  readonly triangles: ProjectedTriangle[];
  readonly bounds: ProjectedBounds;
} {
  const points = triangles.flatMap((triangle) => triangle.points);
  if (points.length === 0) {
    return { triangles: [], bounds: { left: 6, top: 6, right: WIDTH - 6, bottom: HEIGHT - 6 } };
  }
  const source = {
    left: Math.min(...points.map((point) => point.x)),
    top: Math.min(...points.map((point) => point.y)),
    right: Math.max(...points.map((point) => point.x)),
    bottom: Math.max(...points.map((point) => point.y)),
  };
  const sourceWidth = Math.max(0.001, source.right - source.left);
  const sourceHeight = Math.max(0.001, source.bottom - source.top);
  const target = { left: 4, top: 3, right: WIDTH - 4, bottom: HEIGHT - 5 };
  const scale = Math.min(
    (target.right - target.left) / sourceWidth,
    (target.bottom - target.top) / sourceHeight,
  );
  const offsetX = WIDTH / 2 - ((source.left + source.right) / 2) * scale;
  const offsetY = (target.top + target.bottom) / 2 - ((source.top + source.bottom) / 2) * scale;
  const transform = (point: ProjectedPoint): ProjectedPoint => ({
    x: point.x * scale + offsetX,
    y: point.y * scale + offsetY,
  });
  const fitted = triangles.map((triangle) => ({
    ...triangle,
    points: triangle.points.map(transform) as [ProjectedPoint, ProjectedPoint, ProjectedPoint],
  }));
  const fittedPoints = fitted.flatMap((triangle) => triangle.points);
  return {
    triangles: fitted,
    bounds: {
      left: Math.min(...fittedPoints.map((point) => point.x)),
      top: Math.min(...fittedPoints.map((point) => point.y)),
      right: Math.max(...fittedPoints.map((point) => point.x)),
      bottom: Math.max(...fittedPoints.map((point) => point.y)),
    },
  };
}

function drawShadow(context: CanvasRenderingContext2D, bounds: ProjectedBounds): void {
  const width = Math.max(12, bounds.right - bounds.left);
  const centreX = (bounds.left + bounds.right) / 2 + width * 0.12;
  const centreY = Math.min(HEIGHT - 3, bounds.bottom + 1);
  context.save();
  context.filter = 'blur(3px)';
  context.fillStyle = 'rgba(42, 61, 69, 0.2)';
  context.beginPath();
  context.ellipse(centreX, centreY, width * 0.28, 4.2, -0.08, 0, Math.PI * 2);
  context.fill();
  context.restore();

  context.fillStyle = 'rgba(42, 61, 69, 0.12)';
  context.beginPath();
  context.ellipse(centreX - width * 0.08, centreY - 1, width * 0.17, 2.5, 0, 0, Math.PI * 2);
  context.fill();
}

function previewModelMatrix(primitive: PrimitiveKind): THREE.Matrix4 {
  const widthRatio = primitive === 'text' ? 1.55 : 1;
  const heightRatio =
    primitive === 'torus' || primitive === 'ring'
      ? 7 / 24
      : primitive === 'half-sphere' || primitive === 'round-roof'
        ? 0.5
        : primitive === 'roof'
          ? 12 / 20
          : primitive === 'text'
            ? 0.2
            : primitive === 'star'
              ? 0.32
              : primitive === 'star-6'
                ? 0.24
                : primitive === 'heart'
                  ? 0.35
                  : 1;
  const rotation = primitive === 'roof' ? Math.PI / 2 - 0.1 : -0.1;
  const matrix = new THREE.Matrix4().makeRotationY(rotation);
  matrix.scale(new THREE.Vector3(widthRatio, heightRatio, 1));
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
  const camera = new THREE.OrthographicCamera(-0.95, 0.95, 0.85, -0.85, 0.1, 20);
  camera.position.set(2.65, 2.2, 3.05);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const modelMatrix = previewModelMatrix(primitive);
  const geometry = createPrimitiveGeometryForKind(primitive, 48);
  const fitted = fitTriangles(collectTriangles(geometry, camera, modelMatrix, color));
  drawShadow(context, fitted.bounds);
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
  for (const triangle of fitted.triangles) {
    context.fillStyle = operation === 'hole' && stripePattern ? stripePattern : triangle.color;
    context.strokeStyle = operation === 'hole' ? '#a5b0b6' : triangle.color;
    context.lineWidth = 1.1;
    drawTrianglePath(context, triangle);
    context.fill();
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
