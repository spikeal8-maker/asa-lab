import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { coursePrepublicationDiagnostic } from '../../apps/web/src/learning/course-prepublication-diagnostic';

const courseId = '11111111-1111-4111-8111-111111111111';
const diagnostic = {
  courseId,
  draftRevision: 7,
  sectionId: '22222222-2222-4222-8222-222222222222',
  lessonId: '33333333-3333-4333-8333-333333333333',
  blockId: 'second-practice',
  field: 'learningActivityVersionId',
  reason: 'pin_unavailable',
  path: 'Название с → разделителями',
  message: 'Выберите опубликованную практику.',
};
const document = parse(readFileSync('schemas/openapi.yaml', 'utf8'));
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile({
  $ref: '#/components/schemas/CoursePublicationError',
  components: document.components,
});
describe('course prepublication wire contract', () => {
  it('documents the actual publication endpoint and retains an exact location independently of its display label', () => {
    expect(
      document.paths['/api/courses/{courseId}/publish'].post.responses['409'].content[
        'application/json'
      ].schema.$ref,
    ).toBe('#/components/schemas/CoursePublicationError');
    const error = { code: 'prepublish_invalid', message: diagnostic.message, diagnostic };
    expect(validate({ error }), JSON.stringify(validate.errors)).toBe(true);
    expect(coursePrepublicationDiagnostic(error, courseId, 7)).toEqual(diagnostic);
    expect(
      coursePrepublicationDiagnostic(
        { ...error, diagnostic: { ...diagnostic, path: 'другая локализация' } },
        courseId,
        7,
      )?.blockId,
    ).toBe('second-practice');
  });
  it('accepts non-location conflicts and course-level diagnostics', () => {
    expect(validate({ error: { code: 'draft_conflict', message: 'Обновите курс.' } })).toBe(true);
    expect(
      validate({
        error: {
          code: 'course_empty',
          message: 'Добавьте урок.',
          diagnostic: {
            ...diagnostic,
            sectionId: null,
            lessonId: null,
            blockId: null,
            field: 'lessons',
            reason: 'course_empty',
          },
        },
      }),
    ).toBe(true);
  });
  it('requires structured coordinates on prepublish failures and rejects invented or inconsistent coordinates', () => {
    expect(validate({ error: { code: 'prepublish_invalid', message: 'Ошибка.' } })).toBe(false);
    for (const changed of [
      { field: 'unknown' },
      { reason: 'unknown' },
      { blockId: 'bad selector ]' },
      { sectionId: null },
      { lessonId: null },
      { draftRevision: 0 },
    ]) {
      expect(
        validate({
          error: {
            code: 'prepublish_invalid',
            message: 'Ошибка.',
            diagnostic: { ...diagnostic, ...changed },
          },
        }),
      ).toBe(false);
    }
  });
  it('does not offer navigation for a different course, stale receipt, unknown field or other error category', () => {
    const error = { code: 'prepublish_invalid', message: diagnostic.message, diagnostic };
    expect(coursePrepublicationDiagnostic(error, 'another-course', 7)).toBeNull();
    expect(coursePrepublicationDiagnostic(error, courseId, 8)).toBeNull();
    expect(
      coursePrepublicationDiagnostic({ ...error, code: 'course_not_found' }, courseId, 7),
    ).toBeNull();
    for (const changed of [
      { field: 'unknown' },
      { reason: 'unknown' },
      { sectionId: null },
      { lessonId: null },
    ]) {
      expect(
        coursePrepublicationDiagnostic(
          { ...error, diagnostic: { ...diagnostic, ...changed } },
          courseId,
          7,
        ),
      ).toBeNull();
    }
  });
});
