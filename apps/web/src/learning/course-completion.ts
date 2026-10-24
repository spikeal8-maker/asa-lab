import type { SeatCourseRunLesson } from '../api';

/** Counts are scoped to the assigned, visible blocks of the pinned CourseVersion. */
export interface PracticeProgress {
  total: number;
  completed: number;
  excused: number;
  waitingReview: number;
  changesRequested: number;
  unavailable: number;
}

export function lessonExcused(lesson: SeatCourseRunLesson): boolean {
  return lesson.kind !== 'material' && lesson.canonicalState?.flags.includes('excused') === true;
}

export function lessonPracticeProgress(lesson: SeatCourseRunLesson): PracticeProgress {
  const result: PracticeProgress = {
    total: 0,
    completed: 0,
    excused: 0,
    waitingReview: 0,
    changesRequested: 0,
    unavailable: 0,
  };
  if (lesson.kind !== 'material') return result;

  // Lesson blocks come from the immutable version assigned to this learner.
  // Do not count hidden author blocks, a shared activity title, or an orphan run.
  const visibleBlockIds = new Set(
    (lesson.blocks ?? [])
      .filter((block) => block.type === 'activity' && block.hidden !== true)
      .map((block) => block.id),
  );
  const seenBlockIds = new Set<string>();

  for (const occurrence of lesson.activityOccurrences ?? []) {
    if (!visibleBlockIds.has(occurrence.blockId) || seenBlockIds.has(occurrence.blockId)) continue;
    seenBlockIds.add(occurrence.blockId);
    const state = occurrence.canonicalState;
    const requirement = occurrence.requirement;
    if (requirement === 'not_assigned') continue;
    if (requirement === 'excused' || (requirement === undefined && state?.flags.includes('excused'))) {
      result.excused += 1;
      continue;
    }
    if (
      requirement === 'unknown' ||
      (requirement === undefined && state === null && occurrence.submittedAt === null)
    ) {
      // No exact participation or result provenance: neither fabricated due
      // work nor a false completion is allowed.
      result.unavailable += 1;
      continue;
    }
    result.total += 1;
    if (state?.selectedResult?.completionValue === true) {
      // The canonical selected result, not submittedAt or a transient workflow,
      // satisfies this practice's published completion policy.
      result.completed += 1;
    } else if (state?.workflowState === 'submitted' || state?.workflowState === 'waiting_review') {
      result.waitingReview += 1;
    } else if (state?.workflowState === 'changes_requested') {
      result.changesRequested += 1;
    } else if (state === null && occurrence.submittedAt !== null) {
      // The legacy timestamp has no authoritative result: it is pending/unknown,
      // not evidence of acceptance.
      result.waitingReview += 1;
    }
  }

  // No assignment means no charge against the learner. Keep the missing
  // projection distinguishable so the UI can explain unavailable practices.
  result.unavailable += visibleBlockIds.size - seenBlockIds.size;
  return result;
}

export function lessonComplete(lesson: SeatCourseRunLesson): boolean {
  if (lesson.kind === 'material') {
    if (!lesson.completedAt) return false;
    const practices = lessonPracticeProgress(lesson);
    // If a published visible Activity lacks its assigned runtime occurrence,
    // completion is unproven. Do not manufacture a due practice in the counter,
    // but also do not silently mark the whole lesson complete.
    return practices.unavailable === 0 && practices.total === practices.completed;
  }
  return lesson.canonicalState
    ? lesson.canonicalState.selectedResult?.completionValue === true
    : lesson.submittedAt !== null; // Existing explicit noncanonical legacy lesson compatibility.
}

export function courseCompletion(lessons: SeatCourseRunLesson[]) {
  const required = lessons.filter((lesson) => !lessonExcused(lesson));
  const completed = required.filter(lessonComplete).length;
  return {
    total: required.length,
    completed,
    excused: lessons.length - required.length,
    complete: required.length > 0 && completed === required.length,
  };
}

export function coursePracticeProgress(lessons: SeatCourseRunLesson[]): PracticeProgress {
  const total: PracticeProgress = {
    total: 0,
    completed: 0,
    excused: 0,
    waitingReview: 0,
    changesRequested: 0,
    unavailable: 0,
  };
  for (const lesson of lessons) {
    const progress = lessonPracticeProgress(lesson);
    for (const key of Object.keys(progress) as Array<keyof PracticeProgress>) {
      total[key] += progress[key];
    }
    if (lesson.kind !== 'assignment') continue;
    if (lessonExcused(lesson)) {
      total.excused += 1;
      continue;
    }
    total.total += 1;
    if (lessonComplete(lesson)) {
      total.completed += 1;
    } else if (
      lesson.canonicalState?.workflowState === 'submitted' ||
      lesson.canonicalState?.workflowState === 'waiting_review'
    ) {
      total.waitingReview += 1;
    } else if (lesson.canonicalState?.workflowState === 'changes_requested') {
      total.changesRequested += 1;
    }
  }
  return total;
}
