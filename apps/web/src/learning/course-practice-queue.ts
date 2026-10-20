import type {
  CanonicalLearningWorkflowState,
  ClassroomCourseActivityOccurrence,
  GradebookEntry,
  LearningReviewContext,
} from '../api';

export type CoursePracticeFilter =
  CanonicalLearningWorkflowState | 'all' | 'withdrawn' | 'inactive';

/** The occurrence is obtained from the authorized frozen Course projection.
 * A handout match on its own cannot establish the origin of a legacy submission. */
export function exactCoursePracticeQueue(
  items: readonly GradebookEntry[],
  courseRunId: string,
  occurrence: ClassroomCourseActivityOccurrence,
): { items: GradebookEntry[]; error: string | null } {
  if (!occurrence.assignmentScopeExact) {
    return {
      items: [],
      error: 'Историческое назначение связано с несколькими практиками. Точная очередь недоступна.',
    };
  }
  const candidates = items.filter((item) => item.assignmentId === occurrence.classroomAssignmentId);
  if (
    candidates.some(
      (item) =>
        item.canonicalState?.activityRunId !== occurrence.activityRunId ||
        (item.courseRunId != null && item.courseRunId !== courseRunId),
    ) ||
    new Set(candidates.map((item) => item.seatId)).size !== candidates.length
  ) {
    return {
      items: [],
      error: 'Не удалось подтвердить точную практику для этой очереди. Обновите данные.',
    };
  }
  if (occurrence.canonicalCounts === null) {
    return { items: [], error: 'Состояние практики недоступно. Обновите данные.' };
  }
  if (candidates.length !== (occurrence.assignedCount ?? 0) + (occurrence.notAssignedCount ?? 0)) {
    return {
      items: [],
      error: 'Список учеников изменился или загружен не полностью. Обновите данные.',
    };
  }
  return { items: candidates, error: null };
}

const PRIORITY: Record<CanonicalLearningWorkflowState, number> = {
  waiting_review: 0,
  submitted: 1,
  changes_requested: 2,
  in_progress: 3,
  not_started: 4,
  completed: 5,
  invalidated: 6,
  not_applicable: 7,
};

export function filterCoursePracticeQueue(
  items: readonly GradebookEntry[],
  search: string,
  filter: CoursePracticeFilter,
): GradebookEntry[] {
  const term = search.trim().toLocaleLowerCase('ru');
  return items
    .filter((item) => {
      const state = item.canonicalState;
      return (
        item.displayLabel.toLocaleLowerCase('ru').includes(term) &&
        (filter === 'all' ||
          (filter === 'withdrawn'
            ? state?.flags.includes('withdrawn')
            : filter === 'inactive'
              ? state?.flags.includes('visibility_restricted') && !state.flags.includes('withdrawn')
              : state?.workflowState === filter))
      );
    })
    .sort(
      (a, b) =>
        PRIORITY[a.canonicalState?.workflowState ?? 'not_applicable'] -
          PRIORITY[b.canonicalState?.workflowState ?? 'not_applicable'] ||
        a.displayLabel.localeCompare(b.displayLabel, 'ru') ||
        a.seatId.localeCompare(b.seatId),
    );
}

export function canInspectCoursePractice(item: GradebookEntry): boolean {
  return item.canonicalState?.workflowState !== 'not_applicable' || item.attemptId !== null;
}

export function exactReviewContext(
  activityRunId: string | null | undefined,
  context: LearningReviewContext,
): boolean {
  return !!activityRunId && context.activityRunId === activityRunId;
}

export function exactReviewSubmission(
  attempt: LearningReviewContext['attempts'][number],
  submission: { submissionId: string; projectVersionId: string },
): boolean {
  return (
    !!attempt.submissionId &&
    !!attempt.projectVersionId &&
    submission.submissionId === attempt.submissionId &&
    submission.projectVersionId === attempt.projectVersionId
  );
}
