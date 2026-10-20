import type { ApiError, CoursePrepublicationDiagnostic } from '../api-call';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = new Set([
  'blocks',
  'learningActivityVersionId',
  'text',
  'url',
  'alt',
  'caption',
  'title',
  'label',
  'level',
  'tone',
  'language',
  'rows',
  'hidden',
  'archivedAt',
  'lessons',
]);
const reasons = new Set([
  'course_archived',
  'course_empty',
  'block_invalid',
  'duplicate_block_id',
  'asset_invalid',
  'content_required',
  'legacy_assignment',
  'pin_unavailable',
  'module_unavailable',
]);

/** Only a diagnostic for this exact saved draft may move the course editor. */
export function coursePrepublicationDiagnostic(
  error: ApiError,
  courseId: string,
  draftRevision: number,
): CoursePrepublicationDiagnostic | null {
  const value = error.diagnostic;
  if (error.code !== 'prepublish_invalid' && error.code !== 'course_empty') return null;
  if (
    !value ||
    value.courseId !== courseId ||
    value.draftRevision !== draftRevision ||
    !Number.isSafeInteger(value.draftRevision) ||
    value.draftRevision < 1 ||
    ![value.sectionId, value.lessonId].every(
      (id) => id === null || (typeof id === 'string' && uuid.test(id)),
    ) ||
    !(
      value.blockId === null ||
      (typeof value.blockId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value.blockId))
    ) ||
    (value.lessonId === null
      ? value.sectionId !== null || value.blockId !== null
      : value.sectionId === null) ||
    !fields.has(value.field) ||
    !reasons.has(value.reason) ||
    typeof value.path !== 'string' ||
    typeof value.message !== 'string'
  )
    return null;
  return value;
}

export interface CourseDiagnosticFocus {
  readonly diagnostic: CoursePrepublicationDiagnostic;
}

/** Stable IDs select the region; field metadata selects its editable control. */
export function focusCourseDiagnostic(
  form: HTMLFormElement,
  diagnostic: CoursePrepublicationDiagnostic,
): boolean {
  const scope =
    diagnostic.blockId === null
      ? form
      : [...form.querySelectorAll<HTMLElement>('[data-course-block-id]')].find(
          (entry) => entry.dataset.courseBlockId === diagnostic.blockId,
        );
  if (!scope) return false;
  const field =
    scope.dataset.courseField === diagnostic.field
      ? scope
      : [...scope.querySelectorAll<HTMLElement>('[data-course-field]')].find(
          (entry) => entry.dataset.courseField === diagnostic.field,
        );
  const target =
    diagnostic.field === 'blocks' || field?.matches('input,textarea,select,button')
      ? field
      : (field?.querySelector<HTMLElement>('input,textarea,select') ??
        field?.querySelector<HTMLElement>('button:not(:disabled)') ??
        field);
  if (!target) return false;
  target.focus();
  target.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  return document.activeElement === target;
}
