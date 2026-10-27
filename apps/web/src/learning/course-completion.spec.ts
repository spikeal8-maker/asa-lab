import { describe, expect, it } from 'vitest';
import type { SeatCourseRunLesson } from '../api';
import {
  courseCompletion,
  coursePracticeProgress,
  lessonComplete,
  lessonPracticeProgress,
} from './course-completion';

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
  it('requires a published result for historical standalone submissions without canonical evidence', () => {
    const historical = lesson('assignment');
    historical.canonicalState = null;
    historical.submittedAt = '2026-09-10T09:00:00Z';
    expect(lessonComplete(historical)).toBe(false);
    expect(courseCompletion([historical]).complete).toBe(false);
  });
  it('preserves a selected accepted result while a new attempt is awaiting review', () => {
    expect(courseCompletion([lesson('assignment', true)]).complete).toBe(true);
  });
  it('explains exempt work without manufacturing completion or a grade for an empty denominator', () => {
    expect(courseCompletion([lesson('material', true), lesson('assignment', false, true)])).toEqual(
      {
        total: 1,
        completed: 1,
        excused: 1,
        complete: true,
      },
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

interface ScenarioPractice {
  blockId: string;
  workflow: 'not_started' | 'waiting_review' | 'changes_requested' | 'completed';
  accepted?: boolean;
  submittedAt?: string | null;
  excused?: boolean;
  canonicalMissing?: boolean;
  requirement?: 'required' | 'excused' | 'not_assigned' | 'unknown';
}

/** Pinned published mixed lesson: block identity, not module/title or latest author draft. */
function mixedLesson(
  theoryRead: boolean,
  practices: ScenarioPractice[],
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
      requirement: practice.requirement ?? (practice.excused ? 'excused' : 'required'),
      submittedAt: practice.submittedAt ?? null,
      canonicalState: practice.canonicalMissing
        ? null
        : {
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
    const studentLesson = mixedLesson(true, [
      { blockId: 'electronics-block', workflow: 'not_started' },
      unstarted,
    ]);
    expect(lessonComplete(studentLesson)).toBe(false);
    expect(lessonPracticeProgress(studentLesson)).toMatchObject({
      total: 2,
      completed: 0,
      unavailable: 0,
    });
    expect(courseCompletion([studentLesson])).toEqual({
      total: 1,
      completed: 0,
      excused: 0,
      complete: false,
    });
  });

  it('counts 1/2 accepted practices without completing the lesson or course', () => {
    const studentLesson = mixedLesson(true, [accepted, unstarted]);
    expect(lessonPracticeProgress(studentLesson)).toEqual({
      total: 2,
      completed: 1,
      excused: 0,
      waitingReview: 0,
      changesRequested: 0,
      unavailable: 0,
    });
    expect(coursePracticeProgress([studentLesson])).toEqual(lessonPracticeProgress(studentLesson));
    expect(lessonComplete(studentLesson)).toBe(false);
    expect(courseCompletion([studentLesson]).complete).toBe(false);
  });

  it('does not turn a submission awaiting review or a returned revision into acceptance', () => {
    for (const workflow of ['waiting_review', 'changes_requested'] as const) {
      const studentLesson = mixedLesson(true, [
        accepted,
        {
          blockId: '3d-block',
          workflow,
          submittedAt: '2026-10-24T11:00:00Z',
        },
      ]);
      expect(lessonComplete(studentLesson)).toBe(false);
      const progress = lessonPracticeProgress(studentLesson);
      expect(progress.completed).toBe(1);
      expect(progress.waitingReview).toBe(workflow === 'waiting_review' ? 1 : 0);
      expect(progress.changesRequested).toBe(workflow === 'changes_requested' ? 1 : 0);
    }
  });

  it('never promotes a legacy submission timestamp without a canonical selected result', () => {
    const studentLesson = mixedLesson(true, [
      accepted,
      {
        blockId: '3d-block',
        workflow: 'waiting_review',
        canonicalMissing: true,
        submittedAt: '2026-10-24T11:00:00Z',
      },
    ]);
    expect(lessonPracticeProgress(studentLesson).waitingReview).toBe(1);
    expect(lessonComplete(studentLesson)).toBe(false);
  });

  it('requires theory and both accepted practices; excused work is not a debt', () => {
    const twoAccepted = [
      accepted,
      { blockId: '3d-block', workflow: 'completed', accepted: true } as const,
    ];
    expect(lessonComplete(mixedLesson(false, twoAccepted))).toBe(false);
    expect(lessonPracticeProgress(mixedLesson(true, twoAccepted))).toMatchObject({
      total: 2,
      completed: 2,
      unavailable: 0,
    });
    expect(lessonComplete(mixedLesson(true, twoAccepted))).toBe(true);
    expect(courseCompletion([mixedLesson(true, twoAccepted)]).complete).toBe(true);
    const excused = mixedLesson(true, [accepted, { ...unstarted, excused: true }]);
    expect(lessonPracticeProgress(excused)).toMatchObject({
      total: 1,
      completed: 1,
      excused: 1,
    });
    expect(lessonComplete(excused)).toBe(true);
  });

  it('honors authoritative excusal when no canonical work state exists', () => {
    const excused = mixedLesson(true, [
      accepted,
      { ...unstarted, excused: true, canonicalMissing: true },
    ]);
    expect(lessonPracticeProgress(excused)).toMatchObject({
      total: 1,
      completed: 1,
      excused: 1,
      unavailable: 0,
    });
    expect(lessonComplete(excused)).toBe(true);
    const notAssigned = mixedLesson(true, [
      accepted,
      { ...unstarted, requirement: 'not_assigned', canonicalMissing: true },
    ]);
    expect(lessonPracticeProgress(notAssigned)).toMatchObject({
      total: 1,
      completed: 1,
      excused: 0,
      unavailable: 0,
    });
    expect(lessonComplete(notAssigned)).toBe(true);
  });

  it('leaves a pinned practice without participation unresolved, not excused', () => {
    const mixed = mixedLesson(true, [
      accepted,
      { ...unstarted, requirement: 'not_assigned', canonicalMissing: true },
    ]);
    expect(lessonPracticeProgress(mixed)).toMatchObject({
      total: 1,
      completed: 1,
      excused: 0,
      unavailable: 1,
    });
    expect(lessonComplete(mixed)).toBe(false);
    expect(courseCompletion([mixed]).complete).toBe(false);
  });

  it('does not complete a lesson when applicability has no exact provenance', () => {
    const unknown = mixedLesson(true, [
      accepted,
      { ...unstarted, requirement: 'unknown', canonicalMissing: true },
    ]);
    expect(lessonPracticeProgress(unknown)).toMatchObject({
      total: 1,
      completed: 1,
      excused: 0,
      unavailable: 1,
    });
    expect(lessonComplete(unknown)).toBe(false);
  });

  it('retains the pinned old version while a new version hides a practice', () => {
    const oldPublishedLesson = mixedLesson(true, [accepted, unstarted]);
    const newerHiddenDraft = mixedLesson(true, [accepted, unstarted], ['3d-block']);
    expect(lessonComplete(oldPublishedLesson)).toBe(false);
    expect(lessonPracticeProgress(newerHiddenDraft)).toMatchObject({
      total: 1,
      completed: 1,
    });
    expect(lessonComplete(newerHiddenDraft)).toBe(true);
    expect(lessonComplete(oldPublishedLesson)).toBe(false);
  });

  it('counts repeated activity modules by different published block IDs', () => {
    const studentLesson = mixedLesson(true, [
      accepted,
      {
        blockId: 'electronics-block-2',
        workflow: 'waiting_review',
        submittedAt: '2026-10-24T11:00:00Z',
      },
    ]);
    expect(lessonPracticeProgress(studentLesson)).toMatchObject({
      total: 2,
      completed: 1,
    });
    expect(lessonComplete(studentLesson)).toBe(false);
  });

  it('does not invent a required assignment when an activity block has no occurrence', () => {
    const studentLesson = mixedLesson(true, [accepted, unstarted]);
    studentLesson.activityOccurrences = studentLesson.activityOccurrences.slice(0, 1);
    expect(lessonPracticeProgress(studentLesson)).toMatchObject({
      total: 1,
      completed: 1,
      unavailable: 1,
    });
    // A missing server occurrence is unknown, not evidence the work was excused
    // or successfully completed. Keep the known required denominator unchanged.
    expect(lessonComplete(studentLesson)).toBe(false);
    expect(courseCompletion([studentLesson]).complete).toBe(false);
  });

  it('counts standalone required and excused assignment lessons alongside embedded practices', () => {
    const studentLesson = mixedLesson(true, [accepted, unstarted]);
    expect(
      coursePracticeProgress([
        studentLesson,
        lesson('assignment', true),
        lesson('assignment', false, true),
      ]),
    ).toMatchObject({
      total: 3,
      completed: 2,
      excused: 1,
    });
  });
});
