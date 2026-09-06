/** Safe learner projection: no answer keys, teacher-only assignment payloads or draft data. */
type LessonBlock = Record<string, unknown> & { id: string; type: string };
function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export interface CataloguePreviewRow {
  version_number: number | string;
  title: string;
  summary: string | null;
  outline: Record<string, unknown>;
  published_at: Date | string;
}

export function cataloguePreview(row: CataloguePreviewRow) {
  const sections = Array.isArray(row.outline['sections']) ? row.outline['sections'] : [];
  return {
    versionNumber: Number(row.version_number),
    title: row.title,
    summary: row.summary,
    publishedAt: iso(row.published_at),
    sections: sections.flatMap((candidate, sectionIndex) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
      const section = candidate as Record<string, unknown>;
      const lessons = Array.isArray(section['lessons']) ? section['lessons'] : [];
      return [
        {
          id: String(section['sourceSectionId'] ?? `section-${sectionIndex}`),
          title: String(section['title'] ?? 'Раздел'),
          summary: typeof section['summary'] === 'string' ? section['summary'] : null,
          position: Number(section['position'] ?? sectionIndex + 1),
          lessons: lessons.flatMap((lessonCandidate, lessonIndex) => {
            if (
              !lessonCandidate ||
              typeof lessonCandidate !== 'object' ||
              Array.isArray(lessonCandidate)
            ) {
              return [];
            }
            const lesson = lessonCandidate as Record<string, unknown>;
            return [
              {
                id: String(lesson['sourceLessonId'] ?? `lesson-${sectionIndex}-${lessonIndex}`),
                title: String(lesson['title'] ?? 'Урок'),
                summary: typeof lesson['summary'] === 'string' ? lesson['summary'] : null,
                content: typeof lesson['content'] === 'string' ? lesson['content'] : null,
                blocks: Array.isArray(lesson['blocks']) ? (lesson['blocks'] as LessonBlock[]) : [],
                kind:
                  lesson['kind'] === 'assignment' ? ('assignment' as const) : ('material' as const),
                estimatedMinutes:
                  typeof lesson['estimatedMinutes'] === 'number'
                    ? lesson['estimatedMinutes']
                    : null,
                position: Number(lesson['position'] ?? lessonIndex + 1),
              },
            ];
          }),
        },
      ];
    }),
  };
}
