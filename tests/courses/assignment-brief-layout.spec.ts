import { describe, expect, it } from 'vitest';
import {
  ASSIGNMENT_BRIEF_EDGE_INSET,
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

  it('clamps moved cards to the safe viewport area', () => {
    const rect = defaultAssignmentBriefRect(1440, 900);
    expect(moveAssignmentBriefRect(rect, -500, -900, 1440, 900).x).toBe(
      ASSIGNMENT_BRIEF_EDGE_INSET,
    );
    expect(moveAssignmentBriefRect(rect, -500, -900, 1440, 900).y).toBe(
      ASSIGNMENT_BRIEF_TOP_INSET + ASSIGNMENT_BRIEF_EDGE_INSET,
    );
    const right = moveAssignmentBriefRect(rect, 5000, 5000, 1440, 900);
    expect(right.x + right.width).toBe(1440 - ASSIGNMENT_BRIEF_EDGE_INSET);
    expect(right.y + right.height).toBe(900 - ASSIGNMENT_BRIEF_EDGE_INSET);
  });

  it('resizes from every side without shrinking below the readable minimum', () => {
    const rect = { x: 300, y: 200, width: 500, height: 400 };
    const left = resizeAssignmentBriefRect(rect, 'left', 400, 0, 1440, 900);
    expect(left.width).toBe(ASSIGNMENT_BRIEF_MIN_WIDTH);
    expect(left.x + left.width).toBe(rect.x + rect.width);

    const top = resizeAssignmentBriefRect(rect, 'top', 0, 400, 1440, 900);
    expect(top.height).toBe(ASSIGNMENT_BRIEF_MIN_HEIGHT);
    expect(top.y + top.height).toBe(rect.y + rect.height);

    const expanded = resizeAssignmentBriefRect(rect, 'bottom-right', 5000, 5000, 1440, 900);
    expect(expanded.x + expanded.width).toBeLessThanOrEqual(1440 - ASSIGNMENT_BRIEF_EDGE_INSET);
    expect(expanded.y + expanded.height).toBeLessThanOrEqual(900 - ASSIGNMENT_BRIEF_EDGE_INSET);
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
  });

  it('still returns an in-bounds card on a narrow viewport', () => {
    const rect = clampAssignmentBriefRect(
      { x: 0, y: 0, width: 460, height: 460 },
      390,
      700,
    );
    expect(rect.width).toBeLessThanOrEqual(390 - ASSIGNMENT_BRIEF_EDGE_INSET * 2);
    expect(rect.x).toBe(ASSIGNMENT_BRIEF_EDGE_INSET);
  });
});
