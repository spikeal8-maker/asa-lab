import type { RoboticsPoint } from '@asa-lab/robotics/world-document';

export interface FieldViewport {
  readonly width: number;
  readonly height: number;
}
export interface FieldScreenPoint {
  readonly x: number;
  readonly y: number;
}
export interface FieldCamera {
  readonly xMeters: number;
  readonly yMeters: number;
  readonly pixelsPerMeter: number;
}
export interface FieldBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export const FIELD_CAMERA_MIN_SCALE = 1;
export const FIELD_CAMERA_MAX_SCALE = 10_000;

function finitePoint(point: FieldScreenPoint) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function limitScale(value: number) {
  return Math.max(FIELD_CAMERA_MIN_SCALE, Math.min(FIELD_CAMERA_MAX_SCALE, value));
}

/** All field rendering and pointer operations use this orthographic projection. */
export function fieldWorldToScreen(
  camera: FieldCamera,
  viewport: FieldViewport,
  point: RoboticsPoint,
): FieldScreenPoint {
  return {
    x: viewport.width / 2 + (point.xMeters - camera.xMeters) * camera.pixelsPerMeter,
    y: viewport.height / 2 - (point.yMeters - camera.yMeters) * camera.pixelsPerMeter,
  };
}

export function fieldScreenToWorld(
  camera: FieldCamera,
  viewport: FieldViewport,
  point: FieldScreenPoint,
): RoboticsPoint {
  return {
    xMeters: camera.xMeters + (point.x - viewport.width / 2) / camera.pixelsPerMeter,
    yMeters: camera.yMeters - (point.y - viewport.height / 2) / camera.pixelsPerMeter,
  };
}

/** The existing drawing uses millimetres with its Y axis directed downwards. */
export function fieldCameraViewBox(
  camera: FieldCamera,
  viewport: FieldViewport,
  fieldHeightMeters: number,
): string {
  const topLeft = fieldScreenToWorld(camera, viewport, { x: 0, y: 0 });
  return [
    topLeft.xMeters * 1000,
    (fieldHeightMeters - topLeft.yMeters) * 1000,
    (viewport.width / camera.pixelsPerMeter) * 1000,
    (viewport.height / camera.pixelsPerMeter) * 1000,
  ].join(' ');
}

export function fitFieldCamera(
  bounds: FieldBounds,
  viewport: FieldViewport,
  padding = 28,
): FieldCamera {
  const width = Math.max(0.05, bounds.maxX - bounds.minX);
  const height = Math.max(0.05, bounds.maxY - bounds.minY);
  const usableWidth = Math.max(1, viewport.width - Math.min(padding * 2, viewport.width * 0.3));
  const usableHeight = Math.max(1, viewport.height - Math.min(padding * 2, viewport.height * 0.3));
  return {
    xMeters: (bounds.minX + bounds.maxX) / 2,
    yMeters: (bounds.minY + bounds.maxY) / 2,
    pixelsPerMeter: limitScale(Math.min(usableWidth / width, usableHeight / height)),
  };
}

export function panFieldCamera(camera: FieldCamera, delta: FieldScreenPoint): FieldCamera {
  if (!finitePoint(delta)) return camera;
  const xMeters = camera.xMeters - delta.x / camera.pixelsPerMeter;
  const yMeters = camera.yMeters + delta.y / camera.pixelsPerMeter;
  return Number.isFinite(xMeters) && Number.isFinite(yMeters)
    ? { ...camera, xMeters, yMeters }
    : camera;
}

export function zoomFieldCameraAt(
  camera: FieldCamera,
  viewport: FieldViewport,
  anchor: FieldScreenPoint,
  factor: number,
): FieldCamera {
  if (!finitePoint(anchor) || !Number.isFinite(factor) || factor <= 0) return camera;
  const pixelsPerMeter = limitScale(camera.pixelsPerMeter * factor);
  const world = fieldScreenToWorld(camera, viewport, anchor);
  return {
    xMeters: world.xMeters - (anchor.x - viewport.width / 2) / pixelsPerMeter,
    yMeters: world.yMeters + (anchor.y - viewport.height / 2) / pixelsPerMeter,
    pixelsPerMeter,
  };
}

/** Pointer ownership is independent of object history and simulation state. */
export class FieldCameraGesture {
  private readonly pointers = new Map<number, FieldScreenPoint>();
  private mode: 'none' | 'pan' | 'touch' = 'none';

  get active() {
    return this.mode !== 'none';
  }

  has(pointerId: number) {
    return this.pointers.has(pointerId);
  }

  pointerDown(
    pointerId: number,
    pointerType: string,
    point: FieldScreenPoint,
    requestPan: boolean,
  ): boolean {
    if (!finitePoint(point)) return false;
    if (pointerType === 'touch') {
      this.pointers.set(pointerId, point);
      if (this.pointers.size >= 2) this.mode = 'touch';
      return this.active;
    }
    if (requestPan && this.pointers.size === 0) {
      this.pointers.set(pointerId, point);
      this.mode = 'pan';
      return true;
    }
    return false;
  }

  pointerMove(
    pointerId: number,
    point: FieldScreenPoint,
    camera: FieldCamera,
    viewport: FieldViewport,
  ): { handled: boolean; camera: FieldCamera } {
    const previous = this.pointers.get(pointerId);
    if (!previous || !finitePoint(point)) return { handled: false, camera };
    const before = [...this.pointers.values()];
    this.pointers.set(pointerId, point);
    if (this.mode === 'pan') {
      return {
        handled: true,
        camera: panFieldCamera(camera, { x: point.x - previous.x, y: point.y - previous.y }),
      };
    }
    if (this.mode === 'touch') {
      // Keep consuming the remaining finger after pinch; it must never become
      // an object drag or a drawing click when the other finger is lifted.
      if (before.length < 2) return { handled: true, camera };
      const after = [...this.pointers.values()];
      const midpoint = (points: FieldScreenPoint[]) => ({
        x: (points[0]!.x + points[1]!.x) / 2,
        y: (points[0]!.y + points[1]!.y) / 2,
      });
      const distance = (points: FieldScreenPoint[]) =>
        Math.hypot(points[1]!.x - points[0]!.x, points[1]!.y - points[0]!.y);
      const oldMidpoint = midpoint(before);
      const newMidpoint = midpoint(after);
      const oldDistance = distance(before);
      const newDistance = distance(after);
      const zoomed =
        oldDistance > 2 && newDistance > 2
          ? zoomFieldCameraAt(camera, viewport, oldMidpoint, newDistance / oldDistance)
          : camera;
      return {
        handled: true,
        camera: panFieldCamera(zoomed, {
          x: newMidpoint.x - oldMidpoint.x,
          y: newMidpoint.y - oldMidpoint.y,
        }),
      };
    }
    return { handled: false, camera };
  }

  pointerUp(pointerId: number): boolean {
    if (!this.pointers.has(pointerId)) return false;
    const handled = this.active;
    this.pointers.delete(pointerId);
    if (this.pointers.size === 0) this.mode = 'none';
    return handled;
  }

  cancel(): number[] {
    const ids = [...this.pointers.keys()];
    this.pointers.clear();
    this.mode = 'none';
    return ids;
  }
}
