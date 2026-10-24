import { describe, expect, it } from 'vitest';
import type { SeatCourseRunLesson } from '../api';
import { courseCompletion, lessonComplete } from './course-completion';

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

/** Pinned published mixed lesson: block identity, not module/title or latest author draft. */
function mixedLesson(
  theoryRead: boolean,
  practices: Array<{
    blockId: string;
    workflow: 'not_started' | 'waiting_review' | 'changes_requested' | 'completed';
    accepted?: boolean;
    submittedAt?: string | null;
    excused?: boolean;
  }>,
  hiddenBlockIds: string[] = [],
): SeatCourseRunLesson {
  return {
    kind: 'material',
    completedAt: theoryRead ? '2026-10-24T10:00:00Z' : null,
    blocks: practices.map((practice) => ({
      id: practice.blockId,
      type: 'activity' as const,
      learningActivityVersionId: practice.blockId,
      hidden: hiddenBlockIds.includes(practice.blockId),
    })),
    activityOccurrences: practices.map((practice) => ({
      blockId: practice.blockId,
      submittedAt: practice.submittedAt ?? null,
      canonicalState: {
        workflowState: practice.workflow,
        flags: practice.excused ? ['excused'] : [],
        selectedResult: practice.accepted ? { completionValue: true } : null,
      },
    })),
  } as SeatCourseRunLesson;
}

describe('LRN-UX-02 pinned mixed-lesson completion', () => {
  const unstarted = { blockId: '3d-block', workflow: 'not_started' } as const;
  const accepted = { blockId: 'electronics-block', workflow: 'completed', accepted: true } as const;

  it('does not complete an assigned mixed lesson when theory alone is read', () => {
    const lesson = mixedLesson(true, [
      { blockId: 'electronics-block', workflow: 'not_started' },
      unstarted,
    ]);
    expect(lessonComplete(lesson)).toBe(false);
    expect(courseCompletion([lesson])).toEqual({
      total: 1,
      completed: 0,
      excused: 0,
      complete: false,
    });
  });

  it('keeps the same pupil at 1/2 practices without completing the lesson/course', () => {
    const lesson = mixedLesson(true, [accepted, unstarted]);
    expect(lessonComplete(lesson)).toBe(false);
    expect(courseCompletion([lesson]).complete).toBe(false);
  });

  it('does not turn a submission awaiting review or requested revision into acceptance', () => {
    for (const workflow of ['waiting_review', 'changes_requested'] as const) {
      const lesson = mixedLesson(true, [
        accepted,
        {
          blockId: '3d-block',
          workflow,
          submittedAt: '2026-10-24T11:00:00Z',
        },
      ]);
      expect(lessonComplete(lesson)).toBe(false);
    }
  });

  it('requires reading and all selected accepted results; an excused practice is excluded', () => {
    const twoAccepted = [accepted, { blockId: '3d-block', workflow: 'completed', accepted: true } as const];
    expect(lessonComplete(mixedLesson(false, twoAccepted))).toBe(false);
    expect(lessonComplete(mixedLesson(true, twoAccepted))).toBe(true);
    expect(courseCompletion([mixedLesson(true, twoAccepted)]).complete).toBe(true);
    expect(lessonComplete(mixedLesson(true, [accepted, { ...unstarted, excused: true }]))).toBe(true);
  });

  it('never counts hidden new-version blocks against an already pinned old version', () => {
    const oldPublishedLesson = mixedLesson(true, [accepted, unstarted]);
    const newerHiddenDraft = mixedLesson(true, [accepted, unstarted], ['3d-block']);
    expect(lessonComplete(oldPublishedLesson)).toBe(false);
    expect(lessonComplete(newerHiddenDraft)).toBe(true);
    expect(lessonComplete(oldPublishedLesson)).toBe(false);
  });

  it('counts separately assigned blocks even when their content/module is identical', () => {
    const lesson = mixedLesson(true, [
      accepted,
      { blockId: 'electronics-block-2', workflow: 'waiting_review', submittedAt: '2026-10-24T11:00:00Z' },
    ]);
    expect(lessonComplete(lesson)).toBe(false);
  });
});
