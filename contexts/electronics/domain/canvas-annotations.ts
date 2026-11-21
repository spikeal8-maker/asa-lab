/** Persisted drawing content, deliberately outside the electrical component set. */
export interface CanvasAnnotation {
  readonly id: string;
  readonly text: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly size: { readonly width: number; readonly height: number };
  readonly fontSize: number;
}

export const CANVAS_ANNOTATION_LIMITS = {
  count: 200,
  textLength: 4096,
  coordinate: 1_000_000,
  minWidth: 40,
  minHeight: 24,
  maxSize: 2000,
  minFontSize: 6,
  maxFontSize: 128,
} as const;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

export function parseCanvasAnnotations(value: unknown): readonly CanvasAnnotation[] | string {
  if (!Array.isArray(value) || value.length > CANVAS_ANNOTATION_LIMITS.count)
    return 'annotations must be a bounded array';
  const ids = new Set<string>();
  const annotations: CanvasAnnotation[] = [];
  for (const raw of value) {
    if (
      !record(raw) ||
      Object.keys(raw).some(
        (key) => !['id', 'text', 'position', 'size', 'fontSize'].includes(key),
      ) ||
      typeof raw.id !== 'string' ||
      !/^[A-Za-z0-9:_-]{1,64}$/.test(raw.id) ||
      ids.has(raw.id) ||
      typeof raw.text !== 'string' ||
      raw.text.length > CANVAS_ANNOTATION_LIMITS.textLength ||
      // Persisted text must remain valid PostgreSQL JSONB, including NUL rejection.
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw.text) ||
      /[\uD800-\uDFFF]/u.test(raw.text) ||
      !record(raw.position) ||
      Object.keys(raw.position).some((key) => key !== 'x' && key !== 'y') ||
      !finite(
        raw.position.x,
        -CANVAS_ANNOTATION_LIMITS.coordinate,
        CANVAS_ANNOTATION_LIMITS.coordinate,
      ) ||
      !finite(
        raw.position.y,
        -CANVAS_ANNOTATION_LIMITS.coordinate,
        CANVAS_ANNOTATION_LIMITS.coordinate,
      ) ||
      !record(raw.size) ||
      Object.keys(raw.size).some((key) => key !== 'width' && key !== 'height') ||
      !finite(
        raw.size.width,
        CANVAS_ANNOTATION_LIMITS.minWidth,
        CANVAS_ANNOTATION_LIMITS.maxSize,
      ) ||
      !finite(
        raw.size.height,
        CANVAS_ANNOTATION_LIMITS.minHeight,
        CANVAS_ANNOTATION_LIMITS.maxSize,
      ) ||
      !finite(
        raw.fontSize,
        CANVAS_ANNOTATION_LIMITS.minFontSize,
        CANVAS_ANNOTATION_LIMITS.maxFontSize,
      ) ||
      !Number.isInteger(raw.fontSize)
    )
      return 'annotation text, identity or geometry is invalid';
    ids.add(raw.id);
    annotations.push({
      id: raw.id,
      text: raw.text,
      position: { x: raw.position.x, y: raw.position.y },
      size: { width: raw.size.width, height: raw.size.height },
      fontSize: raw.fontSize,
    });
  }
  return annotations;
}
