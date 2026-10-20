import { describe, expect, it } from 'vitest';
import type {
  ClassroomCourseActivityOccurrence,
  GradebookEntry,
  LearningReviewContext,
} from '../api';
import {
  canInspectCoursePractice,
  exactCoursePracticeQueue,
  exactReviewContext,
  exactReviewSubmission,
  filterCoursePracticeQueue,
} from './course-practice-queue';

const occurrence: ClassroomCourseActivityOccurrence = {
  blockId: 'practice-a',
  activityRunId: 'runtime-a',
  classroomAssignmentId: 'assignment-a',
  learningActivityVersionId: 'same-version',
  title: 'Одинаковое название',
  goal: null,
  moduleKey: 'electronics',
  assignmentScopeExact: true,
  canonicalCounts: {
    notStarted: 0,
    inProgress: 0,
    submitted: 0,
    waitingReview: 1,
    changesRequested: 0,
    completed: 0,
  },
  assignedCount: 1,
  notAssignedCount: 0,
  withdrawnCount: 0,
  inactiveCount: 0,
  invalidatedCount: 0,
};
function entry(overrides: Partial<GradebookEntry> = {}): GradebookEntry {
  return {
    seatId: 'seat-a',
    displayLabel: 'Анна',
    assignmentId: 'assignment-a',
    assignmentTitle: 'Одинаковое название',
    attemptId: 'attempt-a',
    attemptNumber: 1,
    state: 'waiting_review',
    submittedAt: '2026-10-20T10:00:00Z',
    points: null,
    maxPoints: null,
    percentage: null,
    displayGrade: null,
    outcome: null,
    feedback: null,
    publishedAt: null,
    compatibilityDiagnostic: null,
    canonicalState: {
      activityRunId: 'runtime-a',
      workflowState: 'waiting_review',
      selectedResult: null,
      flags: [],
      learnerMessageCode: null,
    },
    ...overrides,
  };
}

describe('A8.1 exact course practice queue', () => {
  it('keeps repeated ActivityVersion/title occurrences separate and ignores neighboring lessons/courses', () => {
    const own = entry();
    const sibling = entry({
      assignmentId: 'assignment-b',
      canonicalState: { ...own.canonicalState!, activityRunId: 'runtime-b' },
    });
    const foreign = entry({ assignmentId: 'foreign', courseRunId: 'another-course' });
    expect(exactCoursePracticeQueue([sibling, foreign, own], 'course-a', occurrence)).toEqual({
      items: [own],
      error: null,
    });
  });

  it.each([
    [
      'a neighboring runtime',
      entry({ canonicalState: { ...entry().canonicalState!, activityRunId: 'runtime-b' } }),
    ],
    ['a neighboring course', entry({ courseRunId: 'course-b' })],
    ['missing canonical evidence', entry({ canonicalState: null })],
  ])('rejects %s instead of substituting it', (_name, wrong) => {
    expect(exactCoursePracticeQueue([wrong], 'course-a', occurrence)).toMatchObject({
      items: [],
      error: expect.any(String),
    });
  });

  it('does not treat ambiguous, incomplete or missing evidence as an empty normal queue', () => {
    for (const selected of [
      { ...occurrence, assignmentScopeExact: false },
      { ...occurrence, canonicalCounts: null },
      { ...occurrence, assignedCount: 2 },
    ])
      expect(exactCoursePracticeQueue([entry()], 'course-a', selected)).toMatchObject({
        items: [],
        error: expect.any(String),
      });
    expect(exactCoursePracticeQueue([], 'course-a', occurrence).error).not.toBeNull();
    expect(
      exactCoursePracticeQueue([entry(), entry()], 'course-a', occurrence).error,
    ).not.toBeNull();
    expect(exactCoursePracticeQueue([], 'course-a', { ...occurrence, assignedCount: 0 })).toEqual({
      items: [],
      error: null,
    });
  });

  it('retains named-audience exclusions and withdrawn history with truthful filters', () => {
    const unassigned = entry({
      seatId: 'seat-b',
      displayLabel: 'Борис',
      attemptId: null,
      canonicalState: { ...entry().canonicalState!, workflowState: 'not_applicable' },
    });
    const withdrawn = entry({
      seatId: 'seat-c',
      displayLabel: 'Вера',
      canonicalState: {
        ...entry().canonicalState!,
        workflowState: 'completed',
        flags: ['withdrawn'],
      },
    });
    const exact = exactCoursePracticeQueue([unassigned, withdrawn, entry()], 'course-a', {
      ...occurrence,
      assignedCount: 2,
      notAssignedCount: 1,
      withdrawnCount: 1,
    });
    expect(exact.error).toBeNull();
    expect(filterCoursePracticeQueue(exact.items, '', 'all').map((row) => row.seatId)).toEqual([
      'seat-a',
      'seat-c',
      'seat-b',
    ]);
    expect(filterCoursePracticeQueue(exact.items, ' ВЕ ', 'withdrawn')).toEqual([withdrawn]);
    expect(filterCoursePracticeQueue(exact.items, '', 'not_applicable')).toEqual([unassigned]);
    expect(filterCoursePracticeQueue(exact.items, '', 'waiting_review')).toEqual([entry()]);
    expect(canInspectCoursePractice(unassigned)).toBe(false);
    expect(canInspectCoursePractice({ ...unassigned, attemptId: 'historical-attempt' })).toBe(true);
    expect(canInspectCoursePractice(withdrawn)).toBe(true);
  });

  it('requires the selected exact ActivityRun, submission and immutable project version', () => {
    const context = { activityRunId: 'runtime-a' } as LearningReviewContext;
    const attempt = {
      submissionId: 'submission-a',
      projectVersionId: 'version-a',
    } as LearningReviewContext['attempts'][number];
    expect(exactReviewContext('runtime-a', context)).toBe(true);
    expect(exactReviewContext('runtime-b', context)).toBe(false);
    expect(exactReviewContext(null, context)).toBe(false);
    expect(
      exactReviewSubmission(attempt, {
        submissionId: 'submission-a',
        projectVersionId: 'version-a',
      }),
    ).toBe(true);
    expect(
      exactReviewSubmission(attempt, {
        submissionId: 'submission-b',
        projectVersionId: 'version-a',
      }),
    ).toBe(false);
    expect(
      exactReviewSubmission(attempt, {
        submissionId: 'submission-a',
        projectVersionId: 'current-draft-version',
      }),
    ).toBe(false);
    expect(
      exactReviewSubmission(
        { ...attempt, projectVersionId: null },
        { submissionId: 'submission-a', projectVersionId: 'version-a' },
      ),
    ).toBe(false);
  });

  it('shows an inactive learner without treating them as withdrawn or losing the official result', () => {
    const inactive = entry({
      canonicalState: {
        ...entry().canonicalState!,
        workflowState: 'completed',
        flags: ['visibility_restricted'],
        learnerMessageCode: 'access_suspended',
      },
      displayGrade: '5',
      points: 10,
      maxPoints: 10,
    });
    const queue = exactCoursePracticeQueue([inactive], 'course-a', {
      ...occurrence,
      inactiveCount: 1,
    });
    expect(queue.error).toBeNull();
    expect(filterCoursePracticeQueue(queue.items, '', 'inactive')).toEqual([inactive]);
    expect(filterCoursePracticeQueue(queue.items, '', 'withdrawn')).toEqual([]);
    expect(canInspectCoursePractice(inactive)).toBe(true);
  });
});
