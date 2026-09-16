import type { PublishedAuthorVersion } from '../api';

export type CourseVersionDiffCategory =
  'Курс' | 'Разделы' | 'Уроки' | 'Блоки' | 'Задания' | 'Политика';

function stable(value: unknown): string {
  return JSON.stringify(value);
}

function lessons(version: PublishedAuthorVersion) {
  return (version.outline?.sections ?? []).flatMap((section) =>
    section.lessons.map((lesson) => ({ sectionId: section.sourceSectionId, ...lesson })),
  );
}

export function courseVersionStructuralDiff(
  left: PublishedAuthorVersion,
  right: PublishedAuthorVersion,
): CourseVersionDiffCategory[] {
  const changed: CourseVersionDiffCategory[] = [];
  const leftLessons = lessons(left);
  const rightLessons = lessons(right);
  if (
    stable(left.outline?.course ?? { title: left.title, summary: left.instructions }) !==
    stable(right.outline?.course ?? { title: right.title, summary: right.instructions })
  )
    changed.push('Курс');

  if (
    stable((left.outline?.sections ?? []).map((s) => [s.sourceSectionId, s.title, s.summary])) !==
    stable((right.outline?.sections ?? []).map((s) => [s.sourceSectionId, s.title, s.summary]))
  )
    changed.push('Разделы');

  if (
    stable(leftLessons.map((l) => [l.sectionId, l.sourceLessonId, l.title, l.summary, l.kind])) !==
    stable(rightLessons.map((l) => [l.sectionId, l.sourceLessonId, l.title, l.summary, l.kind]))
  )
    changed.push('Уроки');

  if (
    stable(leftLessons.map((l) => [l.sourceLessonId, l.blocks, l.content])) !==
    stable(rightLessons.map((l) => [l.sourceLessonId, l.blocks, l.content]))
  )
    changed.push('Блоки');
  if (
    stable(
      leftLessons.map((l) => [
        l.sourceLessonId,
        l.learningActivityVersionId,
        l.assignment?.learningActivityVersionId,
        l.assignment?.sourceAssignmentId,
        l.assignment?.title,
        l.assignment?.moduleKey,
      ]),
    ) !==
    stable(
      rightLessons.map((l) => [
        l.sourceLessonId,
        l.learningActivityVersionId,
        l.assignment?.learningActivityVersionId,
        l.assignment?.sourceAssignmentId,
        l.assignment?.title,
        l.assignment?.moduleKey,
      ]),
    )
  )
    changed.push('Задания');
  if (
    stable(
      leftLessons.map((l) => [
        l.sourceLessonId,
        l.estimatedMinutes,
        l.assignment?.resultMode,
        l.assignment?.maxPoints,
      ]),
    ) !==
    stable(
      rightLessons.map((l) => [
        l.sourceLessonId,
        l.estimatedMinutes,
        l.assignment?.resultMode,
        l.assignment?.maxPoints,
      ]),
    )
  )
    changed.push('Политика');

  return changed;
}
