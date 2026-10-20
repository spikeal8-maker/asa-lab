import { describe, expect, it } from 'vitest';
import type {
  CanonicalLearningWorkflowState,
  CourseActivityOccurrence,
  CoursePracticeCompletion,
  SeatCourseRun,
  SeatCourseRunLesson,
} from '../api';
import {
  courseCompletion,
  courseProgressLabel,
  lessonComplete,
  lessonExcused,
  lessonNextAction,
  practiceCompletion,
  practiceStatus,
} from './course-completion';

const readAt = '2026-10-20T10:00:00Z';
function occurrence(
  index: number,
  workflowState: CanonicalLearningWorkflowState = 'not_started',
): CourseActivityOccurrence {
  return {
    blockId: `block-${index}`,
    activityRunId: `run-${index}`,
    classroomAssignmentId: 'shared-handout',
    learningActivityVersionId: 'same-version',
    title: 'Одинаковое название',
    goal: null,
    moduleKey: index === 1 ? 'electronics' : 'three-d',
    sampleImage: null,
    projectId: workflowState === 'not_started' ? null : `project-${index}`,
    submittedAt: ['submitted', 'waiting_review', 'completed'].includes(workflowState)
      ? readAt
      : null,
    snapshotRevision: null,
    updatedAt: null,
    workOriginAmbiguous: false,
    canonicalState: { workflowState, selectedResult: null, flags: [], learnerMessageCode: null },
  };
}
function requirement(
  index: number,
  overrides: Partial<CoursePracticeCompletion> = {},
): CoursePracticeCompletion {
  return {
    activityRunId: `run-${index}`,
    blockId: `block-${index}`,
    required: true,
    completed: false,
    excused: false,
    unresolved: false,
    reviewRequired: true,
    completionPolicy: { mode: 'accepted' },
    blockedReason: null,
    ...overrides,
  };
}
function mixed(): SeatCourseRunLesson {
  return {
    id: 'mixed',
    kind: 'material',
    completedAt: readAt,
    submittedAt: readAt,
    canonicalState: null,
    activityOccurrences: [occurrence(1, 'completed'), occurrence(2)],
    completion: {
      lessonId: 'mixed',
      required: true,
      completed: false,
      excused: false,
      readingRequired: true,
      materialReadAt: readAt,
      practiceTotal: 2,
      practiceCompleted: 1,
      excusedPracticeCount: 0,
      unresolved: false,
      practices: [requirement(1, { completed: true }), requirement(2)],
    },
  } as SeatCourseRunLesson;
}
function run(lesson = mixed()): SeatCourseRun {
  return {
    id: 'course-run',
    courseId: 'course',
    courseVersionId: 'pinned-v1',
    versionNumber: 1,
    classroomTitle: 'Класс',
    title: 'Автоматический ночник',
    summary: null,
    dueAt: null,
    status: 'open',
    sections: [
      {
        id: 'section',
        title: 'Свет и сопротивление',
        summary: null,
        position: 0,
        lessons: [lesson],
      },
    ],
    completion: {
      completed: false,
      total: 1,
      completedCount: 0,
      lessonCount: 1,
      excusedCount: 0,
      reason: 'required_lessons_pending',
      resultPolicy: 'no_course_grade',
    },
  };
}

describe('mixed lesson presentation consumes the server completion projection', () => {
  it('does not complete a read mixed lesson while the server still requires a second practice', () => {
    const lesson = mixed();
    expect(lesson.completedAt).toBe(readAt);
    expect(lessonComplete(lesson)).toBe(false);
    expect(courseCompletion(run(lesson))).toEqual({
      total: 1,
      completed: 0,
      excused: 0,
      complete: false,
      available: true,
    });
    expect(courseProgressLabel(run(lesson))).toBe('Уроки: 0 из 1');
    expect(practiceStatus(lesson, lesson.activityOccurrences[0]!)).toBe('Принято');
    expect(lessonNextAction(run(lesson), lesson)).toMatchObject({
      kind: 'practice',
      resume: false,
      occurrence: { activityRunId: 'run-2', blockId: 'block-2', moduleKey: 'three-d' },
    });
  });

  it('keeps identical titles, versions and shared handouts separated by exact occurrence', () => {
    const lesson = mixed();
    expect(
      practiceCompletion(lesson, { ...lesson.activityOccurrences[1]!, blockId: 'block-1' }),
    ).toBeNull();
    expect(practiceCompletion(lesson, lesson.activityOccurrences[1]!)?.completed).toBe(false);
    expect(lessonNextAction(run(lesson), lesson)).toMatchObject({
      occurrence: { activityRunId: 'run-2' },
    });
  });

  it.each([
    {
      state: 'submitted',
      status: 'Сдано · результат ещё не опубликован',
      next: {
        kind: 'blocked',
        message: 'Результат сданной работы ещё не опубликован. Обратитесь к преподавателю.',
      },
    },
    { state: 'waiting_review', status: 'На проверке', next: { kind: 'waiting_review' } },
  ] as const)(
    'keeps $state distinct from review, completion and a new start',
    ({ state, status, next }) => {
      const lesson = mixed();
      lesson.activityOccurrences[1] = occurrence(2, state);
      // The learner-safe legacy projection also has submitted + no result + no diagnostic flags.
      expect(lesson.activityOccurrences[1]!.canonicalState?.selectedResult).toBeNull();
      expect(lesson.activityOccurrences[1]!.canonicalState?.flags).toEqual([]);
      expect(lessonComplete(lesson)).toBe(false);
      expect(courseCompletion(run(lesson)).complete).toBe(false);
      expect(practiceStatus(lesson, lesson.activityOccurrences[1]!)).toBe(status);
      expect(lessonNextAction(run(lesson), lesson)).toEqual(next);
    },
  );

  it('explains the missing result when one pending practice is submitted and another awaits review', () => {
    const lesson = mixed();
    lesson.activityOccurrences = [occurrence(1, 'waiting_review'), occurrence(2, 'submitted')];
    lesson.completion!.practices[0]!.completed = false;
    lesson.completion!.practiceCompleted = 0;
    expect(lessonNextAction(run(lesson), lesson)).toEqual({
      kind: 'blocked',
      message: 'Результат сданной работы ещё не опубликован. Обратитесь к преподавателю.',
    });
    expect(lessonComplete(lesson)).toBe(false);
  });

  it.each(['not_started', 'changes_requested'] as const)(
    'keeps the next exact %s practice available while another submission has no result',
    (state) => {
      const lesson = mixed();
      lesson.activityOccurrences = [occurrence(1, 'submitted'), occurrence(2, state)];
      lesson.completion!.practices[0]!.completed = false;
      lesson.completion!.practiceCompleted = 0;
      expect(lessonNextAction(run(lesson), lesson)).toMatchObject({
        kind: 'practice',
        resume: state === 'changes_requested',
        occurrence: { activityRunId: 'run-2', blockId: 'block-2' },
      });
    },
  );

  it('does not infer review or completion from a submitted timestamp without canonical state', () => {
    const lesson = mixed();
    lesson.activityOccurrences[1]!.canonicalState = null;
    lesson.activityOccurrences[1]!.submittedAt = readAt;
    expect(practiceStatus(lesson, lesson.activityOccurrences[1]!)).toBe('Статус уточняется');
    expect(lessonNextAction(run(lesson), lesson).kind).toBe('blocked');
    expect(lessonComplete(lesson)).toBe(false);
  });

  it.each(['in_progress', 'changes_requested'] as const)(
    'resumes the exact %s work before another unstarted practice',
    (state) => {
      const lesson = mixed();
      lesson.activityOccurrences = [occurrence(1), occurrence(2, state)];
      lesson.completion!.practices[0]!.completed = false;
      lesson.completion!.materialReadAt = null;
      expect(lessonNextAction(run(lesson), lesson)).toMatchObject({
        kind: 'practice',
        resume: true,
        occurrence: { projectId: 'project-2' },
      });
    },
  );

  it('requires explicit reading and both server-accepted practices', () => {
    const lesson = mixed();
    lesson.completion!.practices[1]!.completed = true;
    lesson.completion!.practiceCompleted = 2;
    lesson.completion!.materialReadAt = null;
    expect(lessonNextAction(run(lesson), lesson)).toEqual({ kind: 'reading' });
    expect(lessonComplete(lesson)).toBe(false);
    lesson.completion!.materialReadAt = readAt;
    lesson.completion!.completed = true;
    const course = run(lesson);
    course.completion!.completed = true;
    course.completion!.completedCount = 1;
    expect(lessonComplete(lesson)).toBe(true);
    expect(courseCompletion(course).complete).toBe(true);
    expect(lessonNextAction(course, lesson)).toEqual({ kind: 'complete' });
  });

  it.each(['submitted', 'waiting_review'] as const)(
    'preserves a server-selected accepted result while the new attempt is %s',
    (state) => {
      const lesson = mixed();
      lesson.activityOccurrences[0] = occurrence(1, state);
      expect(practiceStatus(lesson, lesson.activityOccurrences[0]!)).toBe('Принято');
      expect(lessonNextAction(run(lesson), lesson)).toMatchObject({
        occurrence: { activityRunId: 'run-2' },
      });
    },
  );

  it('labels a server-completed automatic activity without inventing teacher acceptance', () => {
    const lesson = mixed();
    lesson.completion!.practices[0]!.reviewRequired = false;
    expect(practiceStatus(lesson, lesson.activityOccurrences[0]!)).toBe('Выполнено');
  });

  it.each(['not_open', 'after_due', 'closed', 'unresolved_origin'])(
    'does not offer a blocked practice: %s',
    (blockedReason) => {
      const lesson = mixed();
      lesson.completion!.practices[1]!.blockedReason = blockedReason;
      expect(lessonNextAction(run(lesson), lesson)).toMatchObject({
        kind: 'blocked',
        message: expect.any(String),
      });
    },
  );

  it('does not resume a foreign/ambiguous project or an inactive course', () => {
    const lesson = mixed();
    lesson.activityOccurrences[1]!.workOriginAmbiguous = true;
    expect(lessonNextAction(run(lesson), lesson).kind).toBe('blocked');
    const course = run(lesson);
    course.status = 'closed';
    expect(lessonNextAction(course, lesson).kind).toBe('blocked');
  });

  it('explains excused work and zero requirements without claiming completion', () => {
    const lesson = mixed();
    lesson.completion!.practices[1] = requirement(2, {
      required: false,
      excused: true,
      blockedReason: 'excused',
    });
    expect(practiceStatus(lesson, lesson.activityOccurrences[1]!)).toBe('Освобождён');
    lesson.completion!.required = false;
    lesson.completion!.excused = true;
    expect(lessonExcused(lesson)).toBe(true);
    expect(lessonNextAction(run(lesson), lesson)).toEqual({ kind: 'none' });
    const course = run(lesson);
    course.completion = {
      completed: false,
      total: 0,
      completedCount: 0,
      lessonCount: 1,
      excusedCount: 1,
      reason: 'no_required_lessons',
      resultPolicy: 'no_course_grade',
    };
    expect(courseCompletion(course).complete).toBe(false);
    expect(courseProgressLabel(course)).toBe('Нет обязательных занятий');
  });

  it('does not manufacture completion from legacy read/submission timestamps without a projection', () => {
    const lesson = mixed();
    lesson.completion = null;
    const course = run(lesson);
    course.completion = null;
    expect(lessonComplete(lesson)).toBe(false);
    expect(courseCompletion(course).complete).toBe(false);
    expect(courseProgressLabel(course)).toBe('Прогресс уточняется');
    expect(lessonNextAction(course, lesson).kind).toBe('blocked');
  });

  it('keeps the standalone assignment lesson on its server-authorized start path', () => {
    const lesson = mixed();
    lesson.kind = 'assignment';
    lesson.courseStartAllowed = true;
    lesson.canonicalState = occurrence(2).canonicalState;
    lesson.completion!.readingRequired = false;
    lesson.completion!.practices = [requirement(2, { blockId: null })];
    expect(lessonNextAction(run(lesson), lesson)).toEqual({ kind: 'assignment', resume: false });
  });

  it.each(['submitted', 'waiting_review'] as const)(
    'keeps standalone assignment %s distinct from an unsupported review promise',
    (state) => {
      const lesson = mixed();
      lesson.kind = 'assignment';
      lesson.projectId = 'project-2';
      lesson.canonicalState = occurrence(2, state).canonicalState;
      lesson.activityOccurrences = [];
      lesson.completion!.readingRequired = false;
      lesson.completion!.practiceTotal = 1;
      lesson.completion!.practiceCompleted = 0;
      lesson.completion!.practices = [requirement(2, { blockId: null })];
      expect(lessonNextAction(run(lesson), lesson)).toEqual(
        state === 'waiting_review'
          ? { kind: 'waiting_review' }
          : {
              kind: 'blocked',
              message: 'Результат сданной работы ещё не опубликован. Обратитесь к преподавателю.',
            },
      );
      expect(lessonComplete(lesson)).toBe(false);
    },
  );
});
