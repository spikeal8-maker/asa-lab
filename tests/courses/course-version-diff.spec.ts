import { describe, expect, it } from 'vitest';
import type { PublishedAuthorVersion } from '../../apps/web/src/api';
import { courseVersionStructuralDiff } from '../../apps/web/src/components/course-version-diff';

function version(number: number): PublishedAuthorVersion {
  return {
    id: `v${number}`,
    versionNumber: number,
    outline: {
      course: { title: 'Основы', summary: 'Курс' },
      sections: [
        {
          sourceSectionId: 's1',
          title: 'Раздел 1',
          summary: null,
          lessons: [
            {
              sourceLessonId: 'l1',
              title: 'Урок 1',
              summary: null,
              content: 'Текст',
              blocks: [{ id: 'b1', type: 'paragraph', text: 'Текст' }],
              kind: 'assignment',
              estimatedMinutes: 15,
              learningActivityVersionId: 'lav1',
              assignment: {
                learningActivityVersionId: 'lav1',
                title: 'Практика',
                moduleKey: 'electronics',
                resultMode: 'graded',
                maxPoints: 10,
              },
            },
          ],
        },
      ],
    },
  };
}

describe('courseVersionStructuralDiff', () => {
  it('reports structural categories without character-level diff', () => {
    const left = version(1);
    const right = version(2);
    right.outline!.course.title = 'Основы 2';
    right.outline!.sections[0]!.title = 'Новый раздел';
    right.outline!.sections[0]!.lessons[0]!.title = 'Новый урок';
    right.outline!.sections[0]!.lessons[0]!.blocks = [
      { id: 'b1', type: 'paragraph', text: 'Другой текст' },
    ];
    right.outline!.sections[0]!.lessons[0]!.learningActivityVersionId = 'lav2';
    right.outline!.sections[0]!.lessons[0]!.assignment = {
      learningActivityVersionId: 'lav2',
      title: 'Практика 2',
      moduleKey: 'three-d',
      resultMode: 'completion',
      maxPoints: null,
    };
    right.outline!.sections[0]!.lessons[0]!.estimatedMinutes = 25;

    expect(courseVersionStructuralDiff(left, right)).toEqual([
      'Курс',
      'Разделы',
      'Уроки',
      'Блоки',
      'Задания',
      'Политика',
    ]);
  });

  it('returns no changes for the same immutable structure', () => {
    const left = version(1);
    const right = structuredClone(left);
    right.id = 'v2';
    right.versionNumber = 2;
    expect(courseVersionStructuralDiff(left, right)).toEqual([]);
  });
});
