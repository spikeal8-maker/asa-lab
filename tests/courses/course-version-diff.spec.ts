import { describe, expect, it } from 'vitest';
import type { PublishedAuthorVersion, PublishedCoursePin } from '../../apps/web/src/api';
import {
  courseVersionChanges,
  courseVersionStructuralDiff,
  courseVersionValueText,
} from '../../apps/web/src/components/course-version-diff';

function pin(id = 'lav1', number = 1): PublishedCoursePin {
  return {
    pointer: '/sections/0/lessons/0/assignment',
    pinKind: 'project',
    available: true,
    activityId: 'activity',
    versionId: id,
    versionNumber: number,
    title: 'Практика',
    instructions: 'Соберите схему',
    goal: null,
    blocks: [],
    moduleKey: 'electronics',
    resultMode: 'graded',
    maxPoints: 10,
    contentDigest: 'immutable-' + id,
    policySnapshot: {
      attemptPolicy: { maxAttempts: 1 },
      resultSelectionPolicy: { mode: 'latest_accepted' },
      completionPolicy: { mode: 'accepted' },
      latePolicy: { mode: 'allow_until_close' },
      assessmentPolicy: { mode: 'manual' },
      feedbackReleasePolicy: { mode: 'immediate' },
    },
  };
}

function version(number: number): PublishedAuthorVersion {
  return {
    id: `v${number}`,
    versionNumber: number,
    pinnedActivities: [pin()],
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

  it('recognizes an exact historical policy change even when task text and marks are unchanged', () => {
    const left = version(1);
    const right = version(2);
    right.outline!.sections[0]!.lessons[0]!.learningActivityVersionId = 'lav2';
    right.pinnedActivities = [
      {
        ...pin('lav2', 2),
        policySnapshot: {
          ...pin().policySnapshot,
          attemptPolicy: { maxAttempts: 2 },
        },
      },
    ];
    expect(courseVersionStructuralDiff(left, right)).toContain('Политика');
    expect(courseVersionChanges(left, right)).toContainEqual(
      expect.objectContaining({
        category: 'Политика',
        kind: 'changed',
        path: 'Курс «Основы» → Раздел «Раздел 1» → Урок «Урок 1» → Практика',
        field: 'Попытки и время выполнения · Число попыток',
        before: { state: 'value', value: 1 },
        after: { state: 'value', value: 2 },
      }),
    );
  });

  it('recognizes frozen assignment instructions that the historical outline actually contains', () => {
    const left = version(1);
    const right = version(2);
    Object.assign(left.outline!.sections[0]!.lessons[0]!.assignment!, { brief: 'Соберите лампу' });
    Object.assign(right.outline!.sections[0]!.lessons[0]!.assignment!, {
      brief: 'Добавьте выключатель',
    });
    expect(courseVersionStructuralDiff(left, right)).toContain('Задания');
  });

  it.each([
    ['attemptPolicy', 'Попытки и время выполнения'],
    ['resultSelectionPolicy', 'Выбор результата'],
    ['completionPolicy', 'Завершение задания'],
    ['latePolicy', 'После срока'],
    ['assessmentPolicy', 'Оценивание'],
    ['feedbackReleasePolicy', 'Показ замечаний'],
  ])(
    'compares every frozen policy group %s including explicit null versus missing',
    (key, name) => {
      const left = version(1),
        right = version(2);
      delete left.pinnedActivities![0]!.policySnapshot![key!];
      right.pinnedActivities![0]!.policySnapshot![key!] = null;
      expect(courseVersionChanges(left, right)).toContainEqual(
        expect.objectContaining({
          category: 'Политика',
          field: name,
          before: { state: 'missing' },
          after: { state: 'null' },
        }),
      );
    },
  );

  it('compares exact deadlines and nested conditions, independently of JSON key ordering', () => {
    const left = version(1),
      right = version(2);
    left.pinnedActivities![0]!.policySnapshot!['attemptPolicy'] = {
      window: { dueAt: '2026-11-01T12:00:00Z', timeZone: 'UTC' },
      maxAttempts: 1,
    };
    right.pinnedActivities![0]!.policySnapshot!['attemptPolicy'] = {
      maxAttempts: 1,
      window: { timeZone: 'UTC', dueAt: '2026-11-01T12:00:00Z' },
    };
    expect(courseVersionChanges(left, right)).toEqual([]);
    (
      right.pinnedActivities![0]!.policySnapshot!['attemptPolicy'] as { window: { dueAt: string } }
    ).window.dueAt = '2026-11-02T12:00:00Z';
    expect(courseVersionChanges(left, right)).toHaveLength(1);
    expect(courseVersionChanges(left, right)[0]).toMatchObject({
      before: { state: 'value', value: '2026-11-01T12:00:00Z' },
      after: { state: 'value', value: '2026-11-02T12:00:00Z' },
    });
  });

  it.each(['missing', 'unavailable', 'missing-policy'] as const)(
    'never invents current conditions for %s historical evidence',
    (mode) => {
      const left = version(1),
        right = version(2);
      if (mode === 'missing') delete left.pinnedActivities;
      if (mode === 'unavailable') left.pinnedActivities![0]!.available = false;
      if (mode === 'missing-policy') left.pinnedActivities![0]!.policySnapshot = null;
      const changes = courseVersionChanges(left, right);
      expect(changes.filter((change) => change.kind === 'unavailable')).toEqual([
        expect.objectContaining({
          category: 'Политика',
          before: { state: 'unavailable' },
          field: 'Исторические условия недоступны — нельзя точно сравнить',
        }),
      ]);
      expect(changes.some((change) => change.field.includes('Число попыток'))).toBe(false);
    },
  );

  it('rejects a pin descriptor for a different exact reference and does not expose its policies', () => {
    const left = version(1),
      right = version(2);
    left.pinnedActivities![0]!.versionId = 'foreign-version';
    left.pinnedActivities![0]!.policySnapshot = { attemptPolicy: { maxAttempts: 99 } };
    expect(courseVersionChanges(left, right)).toEqual([
      expect.objectContaining({ kind: 'unavailable', before: { state: 'unavailable' } }),
    ]);
  });

  it('inserts and removes a block without reporting unchanged neighbours as moved', () => {
    const left = version(1),
      right = version(2);
    left.outline!.sections[0]!.lessons[0]!.blocks = [
      { id: 'a', type: 'paragraph', text: 'A' },
      { id: 'b', type: 'paragraph', text: 'B' },
    ];
    right.outline!.sections[0]!.lessons[0]!.blocks = [
      left.outline!.sections[0]!.lessons[0]!.blocks[0]!,
      { id: 'new', type: 'heading', text: 'Новый блок', level: 2 },
      left.outline!.sections[0]!.lessons[0]!.blocks[1]!,
    ];
    expect(courseVersionChanges(left, right)).toEqual([
      expect.objectContaining({
        category: 'Блоки',
        kind: 'added',
        path: expect.stringContaining('Заголовок 2 «Новый блок»'),
        after: {
          state: 'value',
          value: expect.objectContaining({ Текст: 'Новый блок', 'Уровень заголовка': 2 }),
        },
      }),
    ]);
    expect(courseVersionChanges(right, left)).toEqual([
      expect.objectContaining({ category: 'Блоки', kind: 'removed' }),
    ]);
  });

  it('describes one real move with before/after locations instead of replacing every block', () => {
    const left = version(1),
      right = version(2);
    const blocks = ['A', 'B', 'C'].map((text) => ({ id: text, type: 'paragraph' as const, text }));
    left.outline!.sections[0]!.lessons[0]!.blocks = blocks;
    right.outline!.sections[0]!.lessons[0]!.blocks = [blocks[1]!, blocks[2]!, blocks[0]!];
    expect(courseVersionChanges(left, right)).toEqual([
      expect.objectContaining({
        category: 'Блоки',
        kind: 'moved',
        field: 'Положение',
        before: { state: 'value', value: expect.stringContaining('позиция 1') },
        after: { state: 'value', value: expect.stringContaining('позиция 3') },
      }),
    ]);
  });

  it('preserves lesson identity across sections and scopes repeated block IDs to their own lesson', () => {
    const left = version(1),
      right = version(2);
    const extra = structuredClone(left.outline!.sections[0]!.lessons[0]!);
    extra.sourceLessonId = 'l2';
    extra.title = 'Другой урок';
    left.outline!.sections.push({
      sourceSectionId: 's2',
      title: 'Второй раздел',
      summary: null,
      lessons: [extra],
    });
    right.outline = structuredClone(left.outline!);
    right.outline.sections[1]!.lessons[0]!.blocks = [
      { id: 'b1', type: 'paragraph', text: 'Только второй урок' },
    ];
    right.pinnedActivities = [
      ...left.pinnedActivities!,
      { ...pin(), pointer: '/sections/1/lessons/0/assignment' },
    ];
    left.pinnedActivities = structuredClone(right.pinnedActivities);
    const changed = courseVersionChanges(left, right);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({
      category: 'Блоки',
      path: expect.stringContaining('Другой урок'),
      before: { state: 'value', value: 'Текст' },
      after: { state: 'value', value: 'Только второй урок' },
    });
    right.outline.sections[1]!.lessons.push(right.outline.sections[0]!.lessons.shift()!);
    right.pinnedActivities![0]!.pointer = '/sections/1/lessons/1/assignment';
    const moves = courseVersionChanges(left, right).filter((change) => change.kind === 'moved');
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      category: 'Уроки',
      before: { state: 'value', value: expect.stringContaining('Раздел 1') },
      after: { state: 'value', value: expect.stringContaining('Второй раздел') },
    });
  });

  it('keeps course and section additions separate from move detection', () => {
    const left = version(1),
      right = version(2);
    right.outline!.sections.unshift({
      sourceSectionId: 'new-section',
      title: 'Введение',
      summary: null,
      lessons: [],
    });
    right.pinnedActivities![0]!.pointer = '/sections/1/lessons/0/assignment';
    expect(courseVersionChanges(left, right)).toEqual([
      expect.objectContaining({ category: 'Разделы', kind: 'added' }),
    ]);
  });

  it('compares an activity block by lesson-scoped ID after another block is inserted', () => {
    const left = version(1),
      right = version(2);
    const l = left.outline!.sections[0]!.lessons[0]!;
    l.kind = 'material';
    l.assignment = null;
    l.learningActivityVersionId = null;
    l.blocks = [{ id: 'practice', type: 'activity', learningActivityVersionId: 'lav1' }];
    left.pinnedActivities![0]!.pointer = '/sections/0/lessons/0/blocks/0';
    right.outline = structuredClone(left.outline!);
    right.outline.sections[0]!.lessons[0]!.blocks.unshift({
      id: 'intro',
      type: 'paragraph',
      text: 'Сначала прочитайте',
    });
    right.pinnedActivities![0]!.pointer = '/sections/0/lessons/0/blocks/1';
    expect(courseVersionChanges(left, right)).toEqual([
      expect.objectContaining({ kind: 'added', category: 'Блоки' }),
    ]);
  });

  it('shows the exact conditions when a practice is added or removed without treating absence as unavailable history', () => {
    const left = version(1),
      right = version(2);
    const lesson = left.outline!.sections[0]!.lessons[0]!;
    lesson.kind = 'material';
    lesson.assignment = null;
    lesson.learningActivityVersionId = null;
    left.pinnedActivities = [];
    const added = courseVersionChanges(left, right);
    expect(added).toContainEqual(
      expect.objectContaining({
        category: 'Задания',
        field: 'Инструкция задания',
        before: { state: 'missing' },
        after: { state: 'value', value: 'Соберите схему' },
      }),
    );
    expect(added).toContainEqual(
      expect.objectContaining({
        category: 'Политика',
        field: 'Попытки и время выполнения',
        before: { state: 'missing' },
        after: { state: 'value', value: { maxAttempts: 1 } },
      }),
    );
    expect(added.some((change) => change.kind === 'unavailable')).toBe(false);
    expect(courseVersionChanges(right, left)).toContainEqual(
      expect.objectContaining({
        category: 'Политика',
        field: 'Попытки и время выполнения',
        before: { state: 'value', value: { maxAttempts: 1 } },
        after: { state: 'missing' },
      }),
    );
    Object.assign(right.outline!.sections[0]!.lessons[0]!.assignment!, {
      sampleChecksum: 'exact-historical-image',
    });
    expect(courseVersionChanges(left, right)).toContainEqual(
      expect.objectContaining({
        field: 'Изображение образца',
        before: { state: 'missing' },
        after: { state: 'value', value: 'Образец версии 2' },
      }),
    );
  });

  it('reports a frozen assessment change once when both the outline and exact pin contain it', () => {
    const left = version(1),
      right = version(2);
    right.outline!.sections[0]!.lessons[0]!.assignment!.maxPoints = 20;
    right.pinnedActivities![0]!.maxPoints = 20;
    expect(courseVersionChanges(left, right)).toEqual([
      expect.objectContaining({
        category: 'Политика',
        field: 'Максимум баллов',
        before: { state: 'value', value: 10 },
        after: { state: 'value', value: 20 },
      }),
    ]);
    expect(
      courseVersionValueText({ state: 'value', value: { 'Тип блока': 'heading' } }, 'Элемент'),
    ).toBe('Тип блока: Заголовок');
  });

  it('does not mutate immutable inputs or translate literal text into enum labels', () => {
    const left = version(1),
      right = version(2);
    right.outline!.course.title = 'code';
    const frozen = JSON.stringify([left, right]);
    courseVersionChanges(left, right);
    expect(JSON.stringify([left, right])).toBe(frozen);
    expect(courseVersionValueText({ state: 'value', value: 'code' }, 'Название')).toBe('code');
    expect(courseVersionValueText({ state: 'value', value: 'code' }, 'Тип блока')).toBe('Код');
    expect(courseVersionValueText({ state: 'value', value: 'toString' }, 'Тип блока')).toBe(
      'toString',
    );
    expect(
      courseVersionValueText({ state: 'value', value: JSON.parse('{"__proto__":"literal"}') }),
    ).toBe('__proto__: literal');
    expect(courseVersionValueText({ state: 'missing' })).not.toBe(
      courseVersionValueText({ state: 'null' }),
    );
  });
});
