import { expect, it } from 'vitest';
import { cataloguePreview } from './course-preview';
it('projects exact instructional pins and routes media through the authorized release without secret fields', () => {
  const version = '11111111-1111-4111-8111-111111111111',
    pin = '22222222-2222-4222-8222-222222222222';
  const hash = 'a'.repeat(64);
  const row = {
    version_id: version,
    content_hash: 'a'.repeat(32),
    version_number: 1,
    title: 'v1',
    summary: null,
    published_at: 'now',
    outline: {
      sections: [
        {
          sourceSectionId: 's',
          title: 's',
          lessons: [
            {
              sourceLessonId: 'l',
              title: 'l',
              kind: 'assignment',
              learningActivityVersionId: pin,
              assignment: { policies: { answer: 'secret' }, projectDocument: 'secret' },
              blocks: [
                {
                  id: 'm',
                  type: 'manual-material',
                  learningActivityVersionId: pin,
                  policy: 'secret',
                },
                { id: 'hidden', type: 'paragraph', text: 'hidden secret', hidden: true },
              ],
            },
          ],
        },
      ],
    },
    pins: [
      {
        version_id: pin,
        version_number: 1,
        title: 'manual',
        instructions: null,
        goal: null,
        module_key: null,
        sample_hash: hash,
        blocks: [
          {
            type: 'file',
            name: 'v1.pdf',
            contentHash: hash,
            src: '/api/private',
            policies: 'secret',
          },
        ],
      },
    ],
  };
  const result = cataloguePreview(row, 'course');
  expect(result).toMatchObject({ versionId: version, contentHash: 'a'.repeat(32) });
  const serialized = JSON.stringify(result);
  expect(serialized).not.toMatch(/secret|private|policies|projectDocument/);
  expect(result.pinnedItems?.[pin]).toMatchObject({
    blocks: [
      {
        type: 'file',
        name: 'v1.pdf',
        contentHash: hash,
        src: `/api/catalogue/courses/course/versions/${version}/pins/${pin}/file/${hash}`,
      },
    ],
  });
  expect(result.sections[0]?.lessons[0]?.blocks).toHaveLength(1);
});
