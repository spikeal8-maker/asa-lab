export interface TaskImageReferenceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type TaskImageReferenceResizeEdge =
  'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

export const TASK_IMAGE_REFERENCE_EDGE_INSET = 16;
export const TASK_IMAGE_REFERENCE_TOP_INSET = 58;
export const TASK_IMAGE_REFERENCE_MIN_WIDTH = 280;
export const TASK_IMAGE_REFERENCE_MIN_HEIGHT = 220;
export const TASK_IMAGE_REFERENCE_DEFAULT_WIDTH = 360;
export const TASK_IMAGE_REFERENCE_DEFAULT_HEIGHT = 320;
export const TASK_IMAGE_REFERENCE_MAX_WIDTH_RATIO = 0.68;
export const TASK_IMAGE_REFERENCE_MAX_HEIGHT_RATIO = 0.78;

function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function availableWidth(viewportWidth: number): number {
  return Math.max(1, viewportWidth - TASK_IMAGE_REFERENCE_EDGE_INSET * 2);
}

function availableHeight(viewportHeight: number): number {
  return Math.max(
    1,
    viewportHeight - TASK_IMAGE_REFERENCE_TOP_INSET - TASK_IMAGE_REFERENCE_EDGE_INSET * 2,
  );
}

export function defaultTaskImageReferenceRect(
  viewportWidth: number,
  viewportHeight: number,
): TaskImageReferenceRect {
  const width = Math.min(TASK_IMAGE_REFERENCE_DEFAULT_WIDTH, availableWidth(viewportWidth));
  const height = Math.min(TASK_IMAGE_REFERENCE_DEFAULT_HEIGHT, availableHeight(viewportHeight));
  return clampTaskImageReferenceRect(
    {
      x: viewportWidth - width - TASK_IMAGE_REFERENCE_EDGE_INSET,
      y: TASK_IMAGE_REFERENCE_TOP_INSET + TASK_IMAGE_REFERENCE_EDGE_INSET,
      width,
      height,
    },
    viewportWidth,
    viewportHeight,
  );
}

export function clampTaskImageReferenceRect(
  rect: TaskImageReferenceRect,
  viewportWidth: number,
  viewportHeight: number,
): TaskImageReferenceRect {
  const widthAvailable = availableWidth(viewportWidth);
  const heightAvailable = availableHeight(viewportHeight);
  const minWidth = Math.min(TASK_IMAGE_REFERENCE_MIN_WIDTH, widthAvailable);
  const minHeight = Math.min(TASK_IMAGE_REFERENCE_MIN_HEIGHT, heightAvailable);
  const maxWidth = Math.min(
    widthAvailable,
    Math.max(minWidth, Math.floor(viewportWidth * TASK_IMAGE_REFERENCE_MAX_WIDTH_RATIO)),
  );
  const maxHeight = Math.min(
    heightAvailable,
    Math.max(minHeight, Math.floor(heightAvailable * TASK_IMAGE_REFERENCE_MAX_HEIGHT_RATIO)),
  );
  const width = clamp(rect.width, minWidth, maxWidth);
  const height = clamp(rect.height, minHeight, maxHeight);
  const minX = TASK_IMAGE_REFERENCE_EDGE_INSET;
  const maxX = Math.max(minX, viewportWidth - width - TASK_IMAGE_REFERENCE_EDGE_INSET);
  const minY = TASK_IMAGE_REFERENCE_TOP_INSET + TASK_IMAGE_REFERENCE_EDGE_INSET;
  const maxY = Math.max(minY, viewportHeight - height - TASK_IMAGE_REFERENCE_EDGE_INSET);

  return {
    x: clamp(rect.x, minX, maxX),
    y: clamp(rect.y, minY, maxY),
    width,
    height,
  };
}

export function moveTaskImageReferenceRect(
  rect: TaskImageReferenceRect,
  deltaX: number,
  deltaY: number,
  viewportWidth: number,
  viewportHeight: number,
): TaskImageReferenceRect {
  return clampTaskImageReferenceRect(
    { ...rect, x: rect.x + deltaX, y: rect.y + deltaY },
    viewportWidth,
    viewportHeight,
  );
}

export function resizeTaskImageReferenceRect(
  rect: TaskImageReferenceRect,
  edge: TaskImageReferenceResizeEdge,
  deltaX: number,
  deltaY: number,
  viewportWidth: number,
  viewportHeight: number,
): TaskImageReferenceRect {
  let { x, y, width, height } = rect;
  if (edge.includes('left')) {
    x += deltaX;
    width -= deltaX;
  }
  if (edge.includes('right')) width += deltaX;
  if (edge.includes('top')) {
    y += deltaY;
    height -= deltaY;
  }
  if (edge.includes('bottom')) height += deltaY;

  const candidate = clampTaskImageReferenceRect(
    { x, y, width, height },
    viewportWidth,
    viewportHeight,
  );
  const adjusted = {
    ...candidate,
    ...(edge.includes('left')
      ? {
          x: Math.max(TASK_IMAGE_REFERENCE_EDGE_INSET, rect.x + rect.width - candidate.width),
        }
      : {}),
    ...(edge.includes('top')
      ? {
          y: Math.max(
            TASK_IMAGE_REFERENCE_TOP_INSET + TASK_IMAGE_REFERENCE_EDGE_INSET,
            rect.y + rect.height - candidate.height,
          ),
        }
      : {}),
  };
  return clampTaskImageReferenceRect(adjusted, viewportWidth, viewportHeight);
}

export function parseTaskImageReferenceRect(
  value: string | null,
  viewportWidth: number,
  viewportHeight: number,
): TaskImageReferenceRect {
  if (!value) return defaultTaskImageReferenceRect(viewportWidth, viewportHeight);
  try {
    const parsed = JSON.parse(value) as Partial<TaskImageReferenceRect>;
    if (
      typeof parsed.x !== 'number' ||
      typeof parsed.y !== 'number' ||
      typeof parsed.width !== 'number' ||
      typeof parsed.height !== 'number' ||
      !Number.isFinite(parsed.x) ||
      !Number.isFinite(parsed.y) ||
      !Number.isFinite(parsed.width) ||
      !Number.isFinite(parsed.height)
    ) {
      return defaultTaskImageReferenceRect(viewportWidth, viewportHeight);
    }
    return clampTaskImageReferenceRect(
      parsed as TaskImageReferenceRect,
      viewportWidth,
      viewportHeight,
    );
  } catch {
    return defaultTaskImageReferenceRect(viewportWidth, viewportHeight);
  }
}
