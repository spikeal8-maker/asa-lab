import { describe, expect, it } from 'vitest';
import type { CourseActivityOccurrence, SeatCourseRun, SeatCourseRunLesson } from '../api';
import {
  courseActivityAssignmentShape,
  courseActivityOccurrenceForBlock,
} from './SeatCourses';

function occurrence(
  blockId: string,
  classroomAssignmentId: string,
  moduleKey: string,
  projectId: string | null,
): CourseActivityOccurrence {
  return {
    blockId,
    activityRunId: `run-${blockId}`,
    classroomAssignmentId,
    learningActivityVersionId: `version-${blockId}`,
    title: `Activity ${blockId}`,
    moduleKey,
    projectId,
    submittedAt: null,
    snapshotRevision: projectId ? 3 : null,
    updatedAt: projectId ? '2026-09-21T00:00:00.000Z' : null,
    canonicalState: null,
  };
}

const run = {
  id: 'course-run',
  dueAt: '2026-09-30T18:00:00.000Z',
  status: 'open',
} as SeatCourseRun;

describe('Course Activity learner mapping', () => {
  it('matches the exact runtime occurrence by blockId and uses its compatibility assignment', () => {
    const target = occurrence('block-b', 'assignment-b', 'three-d', null);
    const lesson = {
      activityOccurrences: [
        occurrence('block-a', 'assignment-a', 'electronics', 'project-a'),
        target,
      ],
    } as SeatCourseRunLesson;

    const matched = courseActivityOccurrenceForBlock(lesson, 'block-b');
    expect(matched).toBe(target);
    expect(courseActivityOccurrenceForBlock(lesson, 'missing')).toBeNull();

    const assignment = courseActivityAssignmentShape(run, target);
    expect(assignment).toMatchObject({
      id: 'assignment-b',
      title: 'Activity block-b',
      moduleKey: 'three-d',
      projectId: null,
      dueAt: '2026-09-30T18:00:00.000Z',
      status: 'open',
    });
  });

  it('keeps duplicate-module Activity blocks independent by occurrence identity', () => {
    const activityA = occurrence('activity-a', 'assignment-a', 'electronics', 'project-a');
    const activityB = occurrence('activity-b', 'assignment-b', 'electronics', null);
    const activityC = occurrence('activity-c', 'assignment-c', 'three-d', null);
    const lesson = {
      activityOccurrences: [activityA, activityB, activityC],
    } as SeatCourseRunLesson;

    const a = courseActivityOccurrenceForBlock(lesson, 'activity-a');
    const b = courseActivityOccurrenceForBlock(lesson, 'activity-b');
    const c = courseActivityOccurrenceForBlock(lesson, 'activity-c');
    expect(a?.projectId).toBe('project-a');
    expect(b?.projectId).toBeNull();
    expect(c?.projectId).toBeNull();

    expect(courseActivityAssignmentShape(run, a!).id).toBe('assignment-a');
    expect(courseActivityAssignmentShape(run, b!).id).toBe('assignment-b');
    expect(courseActivityAssignmentShape(run, c!).id).toBe('assignment-c');
  });
});
