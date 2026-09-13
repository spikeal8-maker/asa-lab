import { describe, expect, it } from 'vitest';
import type { SeatCourseRunLesson } from '../api';
import { courseCompletion } from './course-completion';

function lesson(
  kind: 'material' | 'assignment',
  done = false,
  excused = false,
): SeatCourseRunLesson {
  return {
    kind,
    completedAt: kind === 'material' && done ? '2026-09-10T10:00:00Z' : null,
    submittedAt: '2026-09-10T09:00:00Z',
    canonicalState:
      kind === 'material'
        ? null
        : {
            workflowState: 'waiting_review',
            flags: excused ? ['excused'] : [],
            selectedResult: done ? { completionValue: true } : null,
          },
  } as SeatCourseRunLesson;
}
describe('minimal course completion mirrors required lessons, not login or current Attempt', () => {
  it('requires explicit theory and selected accepted project; a submission alone is not complete', () => {
    expect(courseCompletion([lesson('material'), lesson('assignment')])).toEqual({
      total: 2,
      completed: 0,
      excused: 0,
      complete: false,
    });
    expect(courseCompletion([lesson('material', true), lesson('assignment', true)])).toEqual({
      total: 2,
      completed: 2,
      excused: 0,
      complete: true,
    });
  });
  it('preserves a selected accepted result while a new attempt is awaiting review', () => {
    expect(courseCompletion([lesson('assignment', true)]).complete).toBe(true);
  });
  it('explains exempt work without manufacturing completion or a grade for an empty denominator', () => {
    expect(courseCompletion([lesson('material', true), lesson('assignment', false, true)])).toEqual(
      { total: 1, completed: 1, excused: 1, complete: true },
    );
    expect(courseCompletion([lesson('assignment', false, true)])).toEqual({
      total: 0,
      completed: 0,
      excused: 1,
      complete: false,
    });
    expect(courseCompletion([]).complete).toBe(false);
  });
});
