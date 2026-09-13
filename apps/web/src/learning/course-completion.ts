import type { SeatCourseRunLesson } from '../api';

export function lessonExcused(lesson: SeatCourseRunLesson): boolean {
  return lesson.kind !== 'material' && lesson.canonicalState?.flags.includes('excused') === true;
}

export function lessonComplete(lesson: SeatCourseRunLesson): boolean {
  return lesson.kind === 'material'
    ? lesson.completedAt !== null
    : lesson.canonicalState
      ? lesson.canonicalState.selectedResult?.completionValue === true
      : lesson.submittedAt !== null; // Explicit legacy compatibility, not a new course result.
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
