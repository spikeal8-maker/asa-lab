import type {
  CourseActivityOccurrence,
  CoursePracticeCompletion,
  SeatCourseRun,
  SeatCourseRunLesson,
} from '../api';

export function lessonExcused(lesson: SeatCourseRunLesson): boolean {
  return lesson.completion?.excused === true;
}

export function lessonComplete(lesson: SeatCourseRunLesson): boolean {
  return lesson.completion?.completed === true;
}

/** Presentation only: the browser never derives course truth from read/submitted timestamps. */
export function courseCompletion(run: SeatCourseRun) {
  const completion = run.completion;
  return {
    total: completion?.total ?? 0,
    completed: completion?.completedCount ?? 0,
    excused: completion?.excusedCount ?? 0,
    complete: completion?.completed === true,
    available: completion !== undefined && completion !== null,
  };
}

export function courseProgressLabel(run: SeatCourseRun): string {
  const completion = courseCompletion(run);
  if (!completion.available) return 'Прогресс уточняется';
  if (run.completion?.reason === 'completion_unresolved') return 'Прогресс уточняется';
  if (completion.total === 0) return 'Нет обязательных занятий';
  return `Уроки: ${completion.completed} из ${completion.total}`;
}

export function practiceCompletion(
  lesson: SeatCourseRunLesson,
  occurrence: CourseActivityOccurrence,
): CoursePracticeCompletion | null {
  return (
    lesson.completion?.practices.find(
      (practice) =>
        practice.activityRunId === occurrence.activityRunId &&
        practice.blockId === occurrence.blockId,
    ) ?? null
  );
}

export function practiceStatus(
  lesson: SeatCourseRunLesson,
  occurrence: CourseActivityOccurrence,
): string {
  const completion = practiceCompletion(lesson, occurrence);
  if (completion?.excused) return 'Освобождён';
  if (completion && !completion.required) return 'Не назначено';
  if (completion?.unresolved) return 'Статус уточняется';
  if (completion?.completed) {
    return completion.reviewRequired ? 'Принято' : 'Выполнено';
  }
  switch (occurrence.canonicalState?.workflowState) {
    case 'submitted':
    case 'waiting_review':
      return 'На проверке';
    case 'changes_requested':
      return 'Нужна доработка';
    case 'in_progress':
      return 'В работе';
    case 'not_started':
      return 'Не начато';
    case 'not_applicable':
      return 'Не назначено';
    default:
      return 'Статус уточняется';
  }
}

const BLOCKED_REASONS: Record<string, string> = {
  not_open: 'Практика откроется в назначенное время.',
  after_due: 'Срок выполнения истёк. Обратитесь к преподавателю.',
  closed: 'Приём работ закрыт. Обратитесь к преподавателю.',
  not_assigned: 'Эта практика вам не назначена.',
  excused: 'Вы освобождены от этой практики.',
  unresolved_origin: 'Связь исторической работы уточняется. Обратитесь к преподавателю.',
};

export type LessonNextAction =
  | { kind: 'practice'; occurrence: CourseActivityOccurrence; resume: boolean }
  | { kind: 'assignment'; resume: boolean }
  | { kind: 'reading' }
  | { kind: 'waiting_review' }
  | { kind: 'complete' }
  | { kind: 'none' }
  | { kind: 'blocked'; message: string };

export function lessonNextAction(
  run: SeatCourseRun,
  lesson: SeatCourseRunLesson,
): LessonNextAction {
  const completion = lesson.completion;
  if (!completion || completion.unresolved) {
    return { kind: 'blocked', message: 'Прогресс уточняется. Обратитесь к преподавателю.' };
  }
  if (completion.completed) return { kind: 'complete' };
  if (!completion.required) return { kind: 'none' };
  if (run.status === 'closed') return { kind: 'blocked', message: BLOCKED_REASONS['closed']! };
  const pending = completion.practices.filter(
    (practice) => practice.required && !practice.completed,
  );
  const work = pending.map((practice) => ({
    practice,
    occurrence: lesson.activityOccurrences.find(
      (occurrence) =>
        occurrence.activityRunId === practice.activityRunId &&
        occurrence.blockId === practice.blockId,
    ),
  }));
  const rootPractice = pending.find((practice) => practice.blockId === null);
  const rootState = lesson.canonicalState?.workflowState;
  const rootAvailable =
    rootPractice &&
    !rootPractice.blockedReason &&
    ((rootState === 'not_started' && lesson.courseStartAllowed === true) ||
      (!!lesson.projectId && ['in_progress', 'changes_requested'].includes(rootState ?? '')));
  const available = work.filter(
    ({ practice, occurrence }) =>
      !practice.blockedReason &&
      occurrence &&
      !occurrence.workOriginAmbiguous &&
      ['not_started', 'in_progress', 'changes_requested'].includes(
        occurrence.canonicalState?.workflowState ?? '',
      ) &&
      (occurrence.canonicalState?.workflowState === 'not_started' || !!occurrence.projectId),
  );
  if (rootAvailable && rootState !== 'not_started') return { kind: 'assignment', resume: true };
  const started = available.find(({ occurrence }) =>
    ['changes_requested', 'in_progress'].includes(occurrence!.canonicalState!.workflowState),
  );
  if (started?.occurrence) {
    return { kind: 'practice', occurrence: started.occurrence, resume: true };
  }
  if (completion.readingRequired && !completion.materialReadAt) return { kind: 'reading' };
  if (rootAvailable) return { kind: 'assignment', resume: false };
  const next = available[0]?.occurrence;
  if (next) return { kind: 'practice', occurrence: next, resume: false };
  if (
    work.length > 0 &&
    work.every(({ practice, occurrence }) =>
      ['submitted', 'waiting_review'].includes(
        (practice.blockId === null ? rootState : occurrence?.canonicalState?.workflowState) ?? '',
      ),
    )
  )
    return { kind: 'waiting_review' };
  const blocked = work.find(({ practice }) => practice.blockedReason)?.practice.blockedReason;
  return {
    kind: 'blocked',
    message:
      blocked && BLOCKED_REASONS[blocked]
        ? BLOCKED_REASONS[blocked]!
        : 'Следующее действие пока недоступно. Обратитесь к преподавателю.',
  };
}
