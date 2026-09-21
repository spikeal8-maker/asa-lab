import { describe, expect, it } from 'vitest';
import {
  ASSIGNMENT_BRIEF_EDGE_INSET,
  ASSIGNMENT_BRIEF_MAX_HEIGHT_RATIO,
  ASSIGNMENT_BRIEF_MAX_WIDTH_RATIO,
  ASSIGNMENT_BRIEF_MIN_HEIGHT,
  ASSIGNMENT_BRIEF_MIN_WIDTH,
  ASSIGNMENT_BRIEF_TOP_INSET,
  clampAssignmentBriefRect,
  defaultAssignmentBriefRect,
  moveAssignmentBriefRect,
  parseAssignmentBriefRect,
  resizeAssignmentBriefRect,
} from '../../apps/web/src/components/assignment-brief-layout';

describe('learning work shell assignment brief geometry', () => {
  it('places a readable default card inside the desktop viewport', () => {
    expect(defaultAssignmentBriefRect(1440, 900)).toEqual({
      x: ASSIGNMENT_BRIEF_EDGE_INSET,
      y: 428,
      width: 460,
      height: 460,
    });
  });

  it('clamps movement on every viewport boundary', () => {
    const rect = defaultAssignmentBriefRect(1440, 900);
    const topLeft = moveAssignmentBriefRect(rect, -5000, -5000, 1440, 900);
    expect(topLeft.x).toBe(ASSIGNMENT_BRIEF_EDGE_INSET);
    expect(topLeft.y).toBe(ASSIGNMENT_BRIEF_TOP_INSET + ASSIGNMENT_BRIEF_EDGE_INSET);

    const bottomRight = moveAssignmentBriefRect(rect, 5000, 5000, 1440, 900);
    expect(bottomRight.x + bottomRight.width).toBe(1440 - ASSIGNMENT_BRIEF_EDGE_INSET);
    expect(bottomRight.y + bottomRight.height).toBe(900 - ASSIGNMENT_BRIEF_EDGE_INSET);
  });

  it('enforces readable minimum dimensions whenever the viewport allows them', () => {
    const rect = clampAssignmentBriefRect(
      { x: 300, y: 200, width: 1, height: 1 },
      1440,
      900,
    );
    expect(rect.width).toBe(ASSIGNMENT_BRIEF_MIN_WIDTH);
    expect(rect.height).toBe(ASSIGNMENT_BRIEF_MIN_HEIGHT);
  });

  it('resizes safely from all eight directions', () => {
    const rect = { x: 300, y: 250, width: 500, height: 400 };

    const left = resizeAssignmentBriefRect(rect, 'left', 400, 0, 1440, 900);
    expect(left.width).toBe(ASSIGNMENT_BRIEF_MIN_WIDTH);
    expect(left.x + left.width).toBe(rect.x + rect.width);

    const right = resizeAssignmentBriefRect(rect, 'right', -400, 0, 1440, 900);
    expect(right.width).toBe(ASSIGNMENT_BRIEF_MIN_WIDTH);
    expect(right.x).toBe(rect.x);

    const top = resizeAssignmentBriefRect(rect, 'top', 0, 400, 1440, 900);
    expect(top.height).toBe(ASSIGNMENT_BRIEF_MIN_HEIGHT);
    expect(top.y + top.height).toBe(rect.y + rect.height);

    const bottom = resizeAssignmentBriefRect(rect, 'bottom', 0, -400, 1440, 900);
    expect(bottom.height).toBe(ASSIGNMENT_BRIEF_MIN_HEIGHT);
    expect(bottom.y).toBe(rect.y);

    const topLeft = resizeAssignmentBriefRect(rect, 'top-left', 400, 400, 1440, 900);
    expect(topLeft.width).toBe(ASSIGNMENT_BRIEF_MIN_WIDTH);
    expect(topLeft.height).toBe(ASSIGNMENT_BRIEF_MIN_HEIGHT);
    expect(topLeft.x + topLeft.width).toBe(rect.x + rect.width);
    expect(topLeft.y + topLeft.height).toBe(rect.y + rect.height);

    const topRight = resizeAssignmentBriefRect(rect, 'top-right', -400, 400, 1440, 900);
    expect(topRight.width).toBe(ASSIGNMENT_BRIEF_MIN_WIDTH);
    expect(topRight.height).toBe(ASSIGNMENT_BRIEF_MIN_HEIGHT);
    expect(topRight.x).toBe(rect.x);
    expect(topRight.y + topRight.height).toBe(rect.y + rect.height);

    const bottomRight = resizeAssignmentBriefRect(
      rect,
      'bottom-right',
      -400,
      -400,
      1440,
      900,
    );
    expect(bottomRight.width).toBe(ASSIGNMENT_BRIEF_MIN_WIDTH);
    expect(bottomRight.height).toBe(ASSIGNMENT_BRIEF_MIN_HEIGHT);
    expect(bottomRight.x).toBe(rect.x);
    expect(bottomRight.y).toBe(rect.y);

    const bottomLeft = resizeAssignmentBriefRect(
      rect,
      'bottom-left',
      400,
      -400,
      1440,
      900,
    );
    expect(bottomLeft.width).toBe(ASSIGNMENT_BRIEF_MIN_WIDTH);
    expect(bottomLeft.height).toBe(ASSIGNMENT_BRIEF_MIN_HEIGHT);
    expect(bottomLeft.x + bottomLeft.width).toBe(rect.x + rect.width);
    expect(bottomLeft.y).toBe(rect.y);
  });

  it('limits a desktop task card to the normative viewport ratios', () => {
    const rect = clampAssignmentBriefRect(
      { x: 12, y: 70, width: 5000, height: 5000 },
      1440,
      900,
    );
    expect(rect.width).toBeLessThanOrEqual(
      Math.floor(1440 * ASSIGNMENT_BRIEF_MAX_WIDTH_RATIO),
    );
    const usableHeight = 900 - ASSIGNMENT_BRIEF_TOP_INSET - ASSIGNMENT_BRIEF_EDGE_INSET * 2;
    expect(rect.height).toBeLessThanOrEqual(
      Math.floor(usableHeight * ASSIGNMENT_BRIEF_MAX_HEIGHT_RATIO),
    );
  });

  it('recovers corrupt or off-screen stored geometry safely', () => {
    expect(parseAssignmentBriefRect('not-json', 1024, 768)).toEqual(
      defaultAssignmentBriefRect(1024, 768),
    );
    const parsed = parseAssignmentBriefRect(
      JSON.stringify({ x: -999, y: -999, width: 9999, height: 9999 }),
      1024,
      768,
    );
    expect(parsed.x).toBe(ASSIGNMENT_BRIEF_EDGE_INSET);
    expect(parsed.y).toBe(ASSIGNMENT_BRIEF_TOP_INSET + ASSIGNMENT_BRIEF_EDGE_INSET);
    expect(parsed.x + parsed.width).toBeLessThanOrEqual(1024 - ASSIGNMENT_BRIEF_EDGE_INSET);
    expect(parsed.y + parsed.height).toBeLessThanOrEqual(768 - ASSIGNMENT_BRIEF_EDGE_INSET);

    expect(
      parseAssignmentBriefRect(
        JSON.stringify({ x: 1, y: 2, width: Number.POSITIVE_INFINITY, height: 300 }),
        1024,
        768,
      ),
    ).toEqual(defaultAssignmentBriefRect(1024, 768));
  });

  it.each([
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ])('keeps narrow viewport geometry safe at $width px', ({ width, height }) => {
    const rect = clampAssignmentBriefRect(
      { x: -100, y: -100, width: 5000, height: 5000 },
      width,
      height,
    );
    const widthAvailable = width - ASSIGNMENT_BRIEF_EDGE_INSET * 2;
    const heightAvailable =
      height - ASSIGNMENT_BRIEF_TOP_INSET - ASSIGNMENT_BRIEF_EDGE_INSET * 2;

    expect(rect.width).toBeLessThanOrEqual(widthAvailable);
    expect(rect.height).toBeLessThanOrEqual(heightAvailable);
    expect(rect.x).toBe(ASSIGNMENT_BRIEF_EDGE_INSET);
    expect(rect.y).toBe(ASSIGNMENT_BRIEF_TOP_INSET + ASSIGNMENT_BRIEF_EDGE_INSET);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width - ASSIGNMENT_BRIEF_EDGE_INSET);
    expect(rect.y + rect.height).toBeLessThanOrEqual(height - ASSIGNMENT_BRIEF_EDGE_INSET);

    if (widthAvailable >= ASSIGNMENT_BRIEF_MIN_WIDTH) {
      expect(rect.width).toBeGreaterThanOrEqual(ASSIGNMENT_BRIEF_MIN_WIDTH);
    }
    if (heightAvailable >= ASSIGNMENT_BRIEF_MIN_HEIGHT) {
      expect(rect.height).toBeGreaterThanOrEqual(ASSIGNMENT_BRIEF_MIN_HEIGHT);
    }
  });
});
