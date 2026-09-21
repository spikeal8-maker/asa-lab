export interface AssignmentBriefRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type AssignmentBriefResizeEdge =
  'top' | 'right' | 'bottom' | 'left' | 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left';

export const ASSIGNMENT_BRIEF_EDGE_INSET = 12;
export const ASSIGNMENT_BRIEF_TOP_INSET = 58;
export const ASSIGNMENT_BRIEF_MIN_WIDTH = 320;
export const ASSIGNMENT_BRIEF_MIN_HEIGHT = 220;
export const ASSIGNMENT_BRIEF_DEFAULT_WIDTH = 460;
export const ASSIGNMENT_BRIEF_DEFAULT_HEIGHT = 460;

function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function availableWidth(viewportWidth: number): number {
  return Math.max(1, viewportWidth - ASSIGNMENT_BRIEF_EDGE_INSET * 2);
}

function availableHeight(viewportHeight: number): number {
  return Math.max(1, viewportHeight - ASSIGNMENT_BRIEF_TOP_INSET - ASSIGNMENT_BRIEF_EDGE_INSET * 2);
}

export function defaultAssignmentBriefRect(
  viewportWidth: number,
  viewportHeight: number,
): AssignmentBriefRect {
  const width = Math.min(ASSIGNMENT_BRIEF_DEFAULT_WIDTH, availableWidth(viewportWidth));
  const height = Math.min(ASSIGNMENT_BRIEF_DEFAULT_HEIGHT, availableHeight(viewportHeight));
  return clampAssignmentBriefRect(
    {
      x: ASSIGNMENT_BRIEF_EDGE_INSET,
      y: viewportHeight - height - ASSIGNMENT_BRIEF_EDGE_INSET,
      width,
      height,
    },
    viewportWidth,
    viewportHeight,
  );
}

export function clampAssignmentBriefRect(
  rect: AssignmentBriefRect,
  viewportWidth: number,
  viewportHeight: number,
): AssignmentBriefRect {
  const maxWidth = availableWidth(viewportWidth);
  const maxHeight = availableHeight(viewportHeight);
  const minWidth = Math.min(ASSIGNMENT_BRIEF_MIN_WIDTH, maxWidth);
  const minHeight = Math.min(ASSIGNMENT_BRIEF_MIN_HEIGHT, maxHeight);
  const width = clamp(rect.width, minWidth, maxWidth);
  const height = clamp(rect.height, minHeight, maxHeight);
  const minX = ASSIGNMENT_BRIEF_EDGE_INSET;
  const maxX = Math.max(minX, viewportWidth - width - ASSIGNMENT_BRIEF_EDGE_INSET);
  const minY = ASSIGNMENT_BRIEF_TOP_INSET + ASSIGNMENT_BRIEF_EDGE_INSET;
  const maxY = Math.max(minY, viewportHeight - height - ASSIGNMENT_BRIEF_EDGE_INSET);
  return {
    x: clamp(rect.x, minX, maxX),
    y: clamp(rect.y, minY, maxY),
    width,
    height,
  };
}

export function moveAssignmentBriefRect(
  rect: AssignmentBriefRect,
  deltaX: number,
  deltaY: number,
  viewportWidth: number,
  viewportHeight: number,
): AssignmentBriefRect {
  return clampAssignmentBriefRect(
    { ...rect, x: rect.x + deltaX, y: rect.y + deltaY },
    viewportWidth,
    viewportHeight,
  );
}

export function resizeAssignmentBriefRect(
  rect: AssignmentBriefRect,
  edge: AssignmentBriefResizeEdge,
  deltaX: number,
  deltaY: number,
  viewportWidth: number,
  viewportHeight: number,
): AssignmentBriefRect {
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

  const candidate = clampAssignmentBriefRect(
    { x, y, width, height },
    viewportWidth,
    viewportHeight,
  );

  // When a left/top edge hits the minimum size, keep the opposite edge stationary.
  const adjusted = {
    ...candidate,
    ...(edge.includes('left')
      ? {
          x: Math.max(ASSIGNMENT_BRIEF_EDGE_INSET, rect.x + rect.width - candidate.width),
        }
      : {}),
    ...(edge.includes('top')
      ? {
          y: Math.max(
            ASSIGNMENT_BRIEF_TOP_INSET + ASSIGNMENT_BRIEF_EDGE_INSET,
            rect.y + rect.height - candidate.height,
          ),
        }
      : {}),
  };
  return clampAssignmentBriefRect(adjusted, viewportWidth, viewportHeight);
}

export function parseAssignmentBriefRect(
  value: string | null,
  viewportWidth: number,
  viewportHeight: number,
): AssignmentBriefRect {
  if (!value) return defaultAssignmentBriefRect(viewportWidth, viewportHeight);
  try {
    const parsed = JSON.parse(value) as Partial<AssignmentBriefRect>;
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
      return defaultAssignmentBriefRect(viewportWidth, viewportHeight);
    }
    return clampAssignmentBriefRect(parsed as AssignmentBriefRect, viewportWidth, viewportHeight);
  } catch {
    return defaultAssignmentBriefRect(viewportWidth, viewportHeight);
  }
}
