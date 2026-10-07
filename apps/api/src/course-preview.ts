/** Safe learner projection: no answer keys, teacher-only assignment payloads or draft data. */
type LessonBlock = Record<string, unknown> & { id: string; type: string };
function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export interface CataloguePreviewRow {
  version_id?: string;
  content_hash?: string;
  pins?: Array<{
    version_id: string;
    version_number: number;
    title: string;
    instructions: string | null;
    goal: string | null;
    blocks: Array<Record<string, unknown>>;
    module_key: string | null;
    sample_hash: string | null;
  }>;
  version_number: number | string;
  title: string;
  summary: string | null;
  outline: Record<string, unknown>;
  published_at: Date | string;
}

export function cataloguePreview(row: CataloguePreviewRow, courseId?: string) {
  const pinnedItems = Object.fromEntries(
    (row.pins ?? []).map((pin) => {
      const base = `/api/catalogue/courses/${courseId}/versions/${row.version_id}/pins/${pin.version_id}`;
      return [
        pin.version_id,
        {
          versionId: pin.version_id,
          versionNumber: Number(pin.version_number),
          title: pin.title,
          moduleKey: pin.module_key,
          goal: pin.goal,
          brief: pin.instructions,
          blocks: pin.blocks.map((block) => {
            const fields = ['type', 'text', 'items', 'href', 'alt', 'name', 'contentHash'];
            const safe = Object.fromEntries(
              fields.filter((field) => field in block).map((field) => [field, block[field]]),
            );
            return block['type'] === 'image' || block['type'] === 'file'
              ? { ...safe, src: `${base}/${block['type']}/${block['contentHash']}` }
              : safe;
          }),
          sampleImage: pin.sample_hash ? `${base}/sample/${pin.sample_hash}` : null,
        },
      ];
    }),
  );
  const sections = Array.isArray(row.outline['sections']) ? row.outline['sections'] : [];
  return {
    ...(row.version_id
      ? { versionId: row.version_id, contentHash: row.content_hash, pinnedItems }
      : {}),
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
                blocks: Array.isArray(lesson['blocks'])
                  ? (lesson['blocks'] as LessonBlock[])
                      .filter((block) => block.hidden !== true)
                      .map((block) => {
                        const fields = [
                          'id',
                          'type',
                          'text',
                          'level',
                          'tone',
                          'url',
                          'alt',
                          'caption',
                          'title',
                          'label',
                          'language',
                          'rows',
                          'learningActivityVersionId',
                        ];
                        return Object.fromEntries(
                          fields
                            .filter((field) => field in block)
                            .map((field) => [field, block[field]]),
                        ) as LessonBlock;
                      })
                  : [],
                ...(typeof lesson['learningActivityVersionId'] === 'string'
                  ? { learningActivityVersionId: lesson['learningActivityVersionId'] }
                  : {}),
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
