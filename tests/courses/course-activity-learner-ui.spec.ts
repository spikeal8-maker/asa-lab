import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  CourseActivityOccurrence,
  LessonBlock,
  SeatCourseRun,
  SeatCourseRunLesson,
} from '../../apps/web/src/api';
import { LessonBlocks } from '../../apps/web/src/components/LessonBlocks';
import {
  courseActivityAssignmentShape,
  courseActivityOccurrenceForBlock,
} from '../../apps/web/src/components/SeatCourses';

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

describe('E1-FIX-11D5 Course Activity learner UI', () => {
  it('renders mixed blocks in source order, keeps hidden Activity absent and previews Activity', () => {
    const blocks: LessonBlock[] = [
      { id: 'intro', type: 'paragraph', text: 'Перед практикой' },
      {
        id: 'activity-a',
        type: 'activity',
        learningActivityVersionId: '11111111-1111-4111-8111-111111111111',
      },
      { id: 'note', type: 'callout', text: 'Между практиками', tone: 'note' },
      {
        id: 'activity-b',
        type: 'activity',
        learningActivityVersionId: '22222222-2222-4222-8222-222222222222',
      },
      { id: 'file', type: 'file', url: 'https://example.test/help.pdf', label: 'Памятка' },
      {
        id: 'hidden-activity',
        type: 'activity',
        learningActivityVersionId: '33333333-3333-4333-8333-333333333333',
        hidden: true,
      },
    ];
    const markup = renderToStaticMarkup(
      createElement(LessonBlocks, {
        blocks,
        renderActivity: (block) => createElement('span', null, `Runtime ${block.id}`),
      }),
    );
    const sequence = [
      'Перед практикой',
      'Runtime activity-a',
      'Между практиками',
      'Runtime activity-b',
      'Памятка',
    ].map((value) => markup.indexOf(value));
    expect(sequence.every((position) => position >= 0)).toBe(true);
    expect(sequence).toEqual([...sequence].sort((left, right) => left - right));
    expect(markup).not.toContain('Runtime hidden-activity');

    const preview = renderToStaticMarkup(
      createElement(LessonBlocks, {
        blocks: [
          {
            id: 'preview-activity',
            type: 'activity',
            learningActivityVersionId: '44444444-4444-4444-8444-444444444444',
          },
        ],
      }),
    );
    expect(preview).toContain('Практика');
    expect(preview).toContain('data-block-id="preview-activity"');
  });

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
