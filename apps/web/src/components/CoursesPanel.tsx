import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type JSX,
} from 'react';
import { createPortal } from 'react-dom';
import {
  api,
  visibilityLabel,
  type ApiResult,
  type Course,
  type CourseLesson,
  type CourseLessonInput,
  type CourseSection,
  type LessonBlock,
  type LibraryAssignment,
  type PublishedAuthorVersion,
} from '../api';
import { AuthorVersionHistory } from './AuthorVersionHistory';
import { CanonicalPracticePicker, PinnedPracticePreview } from './CanonicalPracticePicker';
import { PinnedManualMaterialPreview } from './CanonicalManualMaterialPicker';
import { CourseAssignDialog, type CourseAssignAttempt } from './CourseAssignDialog';
import { Dropdown } from './Dropdown';
import { CourseEditorDialog } from './CourseEditorDialog';
import { GrowingTextarea } from './GrowingTextarea';
import { LessonBlockEditor, lessonBlocksValid } from './LessonBlockEditor';
import { LessonBlocks } from './LessonBlocks';
import { ShareDialog } from './ShareDialog';
import type { CoursePrepublicationDiagnostic } from '../api-call';
import {
  coursePrepublicationDiagnostic,
  focusCourseDiagnostic,
  type CourseDiagnosticFocus,
} from '../learning/course-prepublication-diagnostic';
import './courses-panel.css';

type MutationResult = Promise<{ ok: boolean; error?: { message: string } }>;

type VisibilityWriteState = 'pending' | 'unconfirmed' | null;
const unconfirmedVisibilityMessage =
  'Не удалось подтвердить изменение видимости. Несохранённые правки остались в форме. Для продолжения откройте «Задания», подтвердите отмену правок и снова откройте курс.';

function visibilityReceiptIsValid(
  receipt: unknown,
  hidden: boolean,
  expectedRevision: number,
): receipt is { hidden: boolean; draftRevision: number } {
  if (receipt === null || typeof receipt !== 'object') return false;
  const value = receipt as { hidden?: unknown; draftRevision?: unknown };
  // These endpoints lock the course and either do nothing or increment once.
  // A later current revision is not a receipt for this visibility command.
  return (
    value.hidden === hidden &&
    typeof value.draftRevision === 'number' &&
    Number.isSafeInteger(value.draftRevision) &&
    value.draftRevision > 0 &&
    (value.draftRevision === expectedRevision || value.draftRevision === expectedRevision + 1)
  );
}

interface CourseFormValue {
  title: string;
  summary: string | null;
}

interface MetadataSaveReceipt {
  id: string;
  draftRevision: number;
}

interface MetadataSaveTarget {
  id: string | null;
  draftRevision: number | null;
}

type SaveMetadata = (
  value: CourseFormValue,
  target: MetadataSaveTarget,
) => Promise<ApiResult<MetadataSaveReceipt>>;

function metadataReceiptIsValid(
  receipt: unknown,
  target: MetadataSaveTarget,
): receipt is MetadataSaveReceipt {
  if (receipt === null || typeof receipt !== 'object') return false;
  const value = receipt as Partial<MetadataSaveReceipt>;
  // course_save_v2 creates revision 1 (outline_ensure only inserts a section).
  // A creation replay can return a later writer's current revision instead;
  // that revision is not a base for continuing this form's newer input.
  const initialCourse = target.id === null && target.draftRevision === null;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    (target.id === null || value.id === target.id) &&
    typeof value.draftRevision === 'number' &&
    Number.isSafeInteger(value.draftRevision) &&
    value.draftRevision > (target.draftRevision ?? 0) &&
    (!initialCourse || value.draftRevision === 1)
  );
}

function useMetadataForm({
  initial,
  target,
  unavailable,
  onSave,
  onClose,
  onWorkChange,
}: {
  initial: CourseFormValue | null;
  target: MetadataSaveTarget;
  unavailable: boolean;
  onSave: SaveMetadata;
  onClose: (receipt?: MetadataSaveReceipt) => void;
  onWorkChange: ((value: boolean) => void) | undefined;
}) {
  const [title, setTitleValue] = useState(initial?.title ?? '');
  const [summary, setSummaryValue] = useState(initial?.summary ?? '');
  const [savedValue, setSavedValue] = useState({
    title: initial?.title ?? '',
    summary: initial?.summary ?? '',
  });
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveBlocked, setSaveBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const editGeneration = useRef(0);
  // This form's base advances only with its own save receipt. An outline/list
  // refresh can include somebody else's later edit and must not rebase this input.
  const targetRef = useRef(target);
  const dirty = title !== savedValue.title || summary !== savedValue.summary;

  useEffect(() => {
    onWorkChange?.(dirty || saving);
    return () => onWorkChange?.(false);
  }, [dirty, saving, onWorkChange]);

  function setTitle(value: string): void {
    editGeneration.current += 1;
    setTitleValue(value);
  }

  function setSummary(value: string): void {
    editGeneration.current += 1;
    setSummaryValue(value);
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim() || savingRef.current || saveBlocked || unavailable) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setNotice(null);
    const generation = editGeneration.current;
    const sent = { title, summary };
    const savingTarget = targetRef.current;
    try {
      const result = await onSave(
        { title: sent.title.trim(), summary: sent.summary.trim() || null },
        savingTarget,
      );
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const receipt = result.data;
      if (!metadataReceiptIsValid(receipt, savingTarget)) {
        const changedCreationReplay =
          savingTarget.id === null &&
          savingTarget.draftRevision === null &&
          Number((receipt as Partial<MetadataSaveReceipt> | null | undefined)?.draftRevision) > 1;
        setSaveBlocked(true);
        setError(
          changedCreationReplay
            ? 'Курс уже существует и был изменён после создания. Скопируйте последние изменения, затем откройте курс заново и проверьте его содержание.'
            : 'Не удалось подтвердить сохранение. Скопируйте последние изменения и обновите страницу перед повторной попыткой.',
        );
        return;
      }
      targetRef.current = receipt;
      setSavedValue(sent);
      if (editGeneration.current !== generation) {
        setNotice('Отправленные данные сохранены. Последние изменения ещё не сохранены.');
      } else {
        onClose(receipt);
      }
    } catch {
      setError('Не удалось сохранить. Последние изменения остались в форме. Повторите попытку.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return {
    title,
    summary,
    setTitle,
    setSummary,
    saving,
    saveBlocked,
    dirty,
    error,
    notice,
    existing: targetRef.current.id !== null,
    submit,
  };
}

function publicationLabel(course: Course): string {
  if (course.publicationState === 'draft') return 'Черновик';
  if (course.publicationState === 'changed') {
    return `Есть изменения · v${course.publishedVersion ?? 1}`;
  }
  return `Опубликован · v${course.publishedVersion ?? 1}`;
}

function publicationClass(course: Course): string {
  if (course.publicationState === 'published') return 'is-published';
  if (course.publicationState === 'changed') return 'is-changed';
  return 'is-draft';
}

function CourseFormDialog({
  course,
  unavailableMessage,
  onClose,
  onSave,
  onWorkChange,
}: {
  readonly course: Course | null;
  readonly unavailableMessage: string | null;
  readonly onClose: (receipt?: MetadataSaveReceipt) => void;
  readonly onSave: SaveMetadata;
  readonly onWorkChange?: (value: boolean) => void;
}): JSX.Element {
  const form = useMetadataForm({
    initial: course,
    target: { id: course?.id ?? null, draftRevision: course?.draftRevision ?? null },
    unavailable: unavailableMessage !== null,
    onSave,
    onClose,
    onWorkChange,
  });
  const { title, summary, setTitle, setSummary, saving, dirty } = form;
  function close(): void {
    if (!saving && (!dirty || window.confirm('Отменить несохранённые настройки курса?'))) onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal course-form-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="course-form-title"
        onSubmit={(event) => void form.submit(event)}
      >
        <h2 id="course-form-title">{form.existing ? 'Настройки курса' : 'Новый курс'}</h2>
        <label className="course-field">
          <span>Название</span>
          <input
            value={title}
            maxLength={160}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Например, Основы 3D-моделирования"
          />
        </label>
        <label className="course-field">
          <span>Короткое описание</span>
          <textarea
            value={summary}
            maxLength={600}
            rows={3}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="Что освоит ученик и для кого этот курс"
          />
        </label>
        {unavailableMessage || form.error ? (
          <p role="alert">{unavailableMessage ?? form.error}</p>
        ) : null}
        {form.notice ? <p role="status">{form.notice}</p> : null}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" disabled={saving} onClick={close}>
            Отмена
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={!title.trim() || saving || form.saveBlocked || unavailableMessage !== null}
          >
            {saving ? 'Сохраняем…' : form.existing ? 'Сохранить' : 'Создать курс'}
          </button>
        </div>
      </form>
    </div>
  );
}

function SectionFormDialog({
  section,
  draftRevision,
  unavailableMessage,
  onClose,
  onSave,
  onWorkChange,
}: {
  readonly section: CourseSection | null;
  readonly draftRevision: number;
  readonly unavailableMessage: string | null;
  readonly onClose: (receipt?: MetadataSaveReceipt) => void;
  readonly onSave: SaveMetadata;
  readonly onWorkChange?: (value: boolean) => void;
}): JSX.Element {
  const form = useMetadataForm({
    initial: section,
    target: { id: section?.id ?? null, draftRevision },
    unavailable: unavailableMessage !== null,
    onSave,
    onClose,
    onWorkChange,
  });
  const { title, summary, setTitle, setSummary, saving, dirty } = form;
  function close(): void {
    if (!saving && (!dirty || window.confirm('Отменить несохранённый раздел?'))) onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal course-form-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="section-form-title"
        onSubmit={(event) => void form.submit(event)}
      >
        <h2 id="section-form-title">{form.existing ? 'Раздел курса' : 'Новый раздел'}</h2>
        <label className="course-field">
          <span>Название</span>
          <input
            value={title}
            maxLength={160}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Например, Базовые формы"
          />
        </label>
        {unavailableMessage || form.error ? (
          <p role="alert">{unavailableMessage ?? form.error}</p>
        ) : null}
        {form.notice ? <p role="status">{form.notice}</p> : null}
        <label className="course-field">
          <span>Описание, если нужно</span>
          <textarea
            value={summary}
            maxLength={600}
            rows={2}
            onChange={(event) => setSummary(event.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" disabled={saving} onClick={close}>
            Отмена
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={!title.trim() || saving || form.saveBlocked || unavailableMessage !== null}
          >
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </div>
  );
}

function LessonEditor({
  sections,
  sectionId,
  lesson,
  onSave,
  onDirty,
  onDelete,
  saveBlockedMessage,
  diagnosticFocus,
  saveTarget,
}: {
  readonly sections: readonly CourseSection[];
  readonly sectionId: string;
  readonly lesson: CourseLesson | null;
  readonly assignments: readonly LibraryAssignment[];
  readonly onSave: (input: CourseLessonInput) => Promise<void>;
  readonly onDelete: (() => Promise<void>) | null;
  readonly onDirty: () => void;
  readonly saveBlockedMessage: string | null;
  readonly diagnosticFocus?: CourseDiagnosticFocus | null;
  readonly saveTarget: HTMLElement | null;
}): JSX.Element {
  const formRef = useRef<HTMLFormElement>(null);
  const formId = useId();
  const minutesRef = useRef<HTMLInputElement>(null);
  const minutesErrorId = useId();
  const focusMinutesOnOpen = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [minutesInvalid, setMinutesInvalid] = useState(false);
  const minutesError = 'Укажите целое число минут от 1 до 600 или оставьте поле пустым.';
  useEffect(() => {
    if (settingsOpen && focusMinutesOnOpen.current) {
      minutesRef.current?.focus();
      focusMinutesOnOpen.current = false;
    }
  }, [settingsOpen]);
  useEffect(() => {
    if (formRef.current && diagnosticFocus && diagnosticFocus.diagnostic.lessonId === lesson?.id) {
      focusCourseDiagnostic(formRef.current, diagnosticFocus.diagnostic);
    }
  }, [diagnosticFocus, lesson?.id]);
  const [targetSection, setTargetSection] = useState(sectionId);
  const [title, setTitle] = useState(lesson?.title ?? '');
  const [summary, setSummary] = useState(lesson?.summary ?? '');
  const [blocks, setBlocks] = useState<LessonBlock[]>(() => {
    if (lesson?.blocks.length) return lesson.blocks;
    if (lesson?.content) return [{ id: 'legacy', type: 'paragraph', text: lesson.content }];
    return lesson ? [] : [{ id: 'intro', type: 'paragraph', text: '' }];
  });
  const [kind, setKind] = useState<'material' | 'assignment'>(lesson?.kind ?? 'material');
  const [assignmentId, setAssignmentId] = useState(
    lesson?.learningActivityVersionId
      ? 'lav:' + lesson.learningActivityVersionId
      : (lesson?.assignmentId ?? ''),
  );
  const [minutes, setMinutes] = useState(
    lesson?.estimatedMinutes === null || lesson?.estimatedMinutes === undefined
      ? ''
      : String(lesson.estimatedMinutes),
  );
  useEffect(() => {
    setMinutesInvalid(minutesRef.current?.validity.valid === false);
  }, [minutes]);
  const [saving, setSaving] = useState(false);
  const valid =
    title.trim().length > 0 &&
    (kind === 'material' || assignmentId.startsWith('lav:')) &&
    lessonBlocksValid(blocks) &&
    !saveBlockedMessage &&
    !saving;

  function correctMinutes(): void {
    if (settingsOpen) minutesRef.current?.focus();
    else {
      focusMinutesOnOpen.current = true;
      setSettingsOpen(true);
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!valid) return;
    if (minutesRef.current && !minutesRef.current.validity.valid) {
      setMinutesInvalid(true);
      correctMinutes();
      return;
    }
    setSaving(true);
    try {
      await onSave({
        sectionId: targetSection,
        title: title.trim(),
        summary: summary.trim() || null,
        content: null,
        blocks,
        kind,
        assignmentId:
          kind === 'assignment' && !assignmentId.startsWith('lav:') ? assignmentId : null,
        learningActivityVersionId:
          kind === 'assignment' && assignmentId.startsWith('lav:') ? assignmentId.slice(4) : null,
        estimatedMinutes: minutes ? Number(minutes) : null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      id={formId}
      ref={formRef}
      className="course-lesson-editor"
      onSubmit={(event) => void submit(event)}
    >
      <div className="course-editor-title">
        <span className="course-eyebrow">
          {sections.find((entry) => entry.id === targetSection)?.title} ·{' '}
          {lesson ? 'Урок' : 'Новый урок'}
        </span>
        <button type="button" className="btn-secondary" onClick={() => setSettingsOpen(true)}>
          Параметры урока
        </button>
      </div>

      <CourseEditorDialog
        open={settingsOpen}
        title="Параметры урока"
        closeLabel="Вернуться к уроку"
        onClose={() => setSettingsOpen(false)}
      >
        <div className="course-editor-grid">
          <label className="course-field">
            <span>Раздел</span>
            <select
              value={targetSection}
              onChange={(event) => {
                setTargetSection(event.target.value);
                onDirty();
              }}
            >
              {sections.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title}
                </option>
              ))}
            </select>
          </label>
          <label className="course-field">
            <span>Тип урока</span>
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as 'material' | 'assignment');
                onDirty();
              }}
            >
              <option value="material">Материал</option>
              <option value="assignment">Практическое задание</option>
            </select>
          </label>
        </div>
        <label className="course-field course-duration-field">
          <span>Примерное время, минут</span>
          <input
            ref={minutesRef}
            type="number"
            min={1}
            max={600}
            step={1}
            value={minutes}
            aria-invalid={minutesInvalid || undefined}
            aria-describedby={minutesInvalid ? minutesErrorId : undefined}
            onChange={(event) => {
              setMinutes(event.target.value);
              setMinutesInvalid(!event.currentTarget.validity.valid);
              onDirty();
            }}
            onInvalid={(event) => {
              event.preventDefault();
              setMinutesInvalid(true);
              correctMinutes();
            }}
            placeholder="15"
          />
        </label>
        {minutesInvalid && settingsOpen ? (
          <p id={minutesErrorId} className="form-error" role="alert">
            {minutesError}
          </p>
        ) : null}
        <p className="course-parameters-note">Параметры сохраняются вместе с уроком.</p>
        {onDelete ? (
          <button
            type="button"
            className="course-text-danger"
            onClick={() => {
              setSettingsOpen(false);
              void onDelete();
            }}
          >
            Удалить
          </button>
        ) : null}
      </CourseEditorDialog>

      {minutesInvalid && !settingsOpen ? (
        <div>
          <p id={minutesErrorId} className="form-error" role="alert">
            {minutesError}
          </p>
          <button type="button" className="btn-secondary" onClick={correctMinutes}>
            Исправить время урока
          </button>
        </div>
      ) : null}

      <label className="course-field course-document-title">
        <span>Название урока</span>
        <GrowingTextarea
          aria-label="Название урока"
          data-course-field="title"
          value={title}
          maxLength={160}
          onChange={(event) => {
            setTitle(event.target.value);
            onDirty();
          }}
          placeholder="Короткое и понятное название"
        />
      </label>

      <label className="course-field">
        <span>Что будет в уроке</span>
        <GrowingTextarea
          aria-label="Что будет в уроке"
          value={summary}
          maxLength={600}
          onChange={(event) => {
            setSummary(event.target.value);
            onDirty();
          }}
          placeholder="Что ученик узнает и сделает"
        />
      </label>

      {kind === 'assignment' ? (
        <div className="course-field" data-course-field="learningActivityVersionId">
          <span>Практика</span>
          {assignmentId && !assignmentId.startsWith('lav:') ? (
            <p role="alert">
              Сохранённое задание: {lesson?.assignmentTitle || 'название недоступно'}. Исходная
              ссылка сохранена. Задание из старого банка нельзя включить в новую публикацию курса.
              Выберите опубликованную практику из своей библиотеки, затем сохраните урок.
            </p>
          ) : null}
          <CanonicalPracticePicker
            value={assignmentId.startsWith('lav:') ? assignmentId.slice(4) : ''}
            onChange={(versionId, practiceTitle) => {
              if (!title.trim()) setTitle(practiceTitle);
              setAssignmentId('lav:' + versionId);
              onDirty();
            }}
          />
        </div>
      ) : null}

      <LessonBlockEditor
        blocks={blocks}
        activities={[]}
        onChange={(value) => {
          setBlocks(value);
          onDirty();
        }}
      />

      {saveBlockedMessage ? <p role="status">{saveBlockedMessage}</p> : null}
      {saveTarget
        ? createPortal(
            <button type="submit" form={formId} className="btn-primary" disabled={!valid}>
              {saving ? 'Сохраняем…' : lesson ? 'Сохранить урок' : 'Добавить урок'}
            </button>,
            saveTarget,
          )
        : null}
    </form>
  );
}

function CoursePreview({
  course,
  sections,
  draftRevision,
  version,
}: {
  readonly course: Course;
  readonly sections: readonly CourseSection[];
  readonly draftRevision: number;
  readonly version?: PublishedAuthorVersion;
}): JSX.Element {
  let number = 0;
  const visibleSections = sections
    .filter((section) => !section.hidden)
    .map((section) => ({
      ...section,
      lessons: section.lessons.filter((lesson) => !lesson.hidden),
    }));
  return (
    <article
      className="course-preview-page"
      data-testid="course-preview-page"
      data-course-version-id={version?.id}
      data-draft-revision={version ? undefined : draftRevision}
    >
      <header>
        <span className="course-eyebrow">
          {version
            ? `Опубликованная версия ${version.versionNumber} · только чтение`
            : 'Предпросмотр сохранённого черновика'}
        </span>
        <h2>{version ? version.outline?.course.title : course.title}</h2>
        {(version ? version.outline?.course.summary : course.summary) ? (
          <p>{version ? version.outline?.course.summary : course.summary}</p>
        ) : null}
      </header>
      {visibleSections.map((section) => (
        <section key={section.id}>
          <div className="course-preview-section-head">
            <h3>{section.title}</h3>
            <span>{section.lessons.length} уроков</span>
          </div>
          {section.summary ? <p>{section.summary}</p> : null}
          <ol>
            {section.lessons.map((lesson) => {
              number += 1;
              return (
                <li key={lesson.id}>
                  <span className="course-preview-number">{number}</span>
                  <div>
                    <strong>{lesson.title}</strong>
                    <small>
                      {lesson.kind === 'assignment' ? 'Практическое задание' : 'Материал'}
                      {lesson.estimatedMinutes ? ' · ' + lesson.estimatedMinutes + ' мин' : ''}
                    </small>
                    {lesson.summary ? <p>{lesson.summary}</p> : null}
                    <LessonBlocks
                      blocks={lesson.blocks}
                      legacyContent={lesson.content}
                      compact
                      renderActivity={(block) => (
                        <PinnedPracticePreview versionId={block.learningActivityVersionId} />
                      )}
                      renderMaterial={(block) => (
                        <PinnedManualMaterialPreview versionId={block.learningActivityVersionId} />
                      )}
                    />
                    {lesson.learningActivityVersionId ? (
                      <PinnedPracticePreview versionId={lesson.learningActivityVersionId} />
                    ) : lesson.assignmentTitle ? (
                      <div className="course-preview-assignment">
                        <span>Задание</span>
                        <strong>{lesson.assignmentTitle}</strong>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </article>
  );
}

export function publishedCourseSections(version: PublishedAuthorVersion): CourseSection[] {
  if (!version.outline) throw new Error('Содержание опубликованной версии недоступно.');
  return version.outline.sections.map((section, position) => ({
    id: section.sourceSectionId,
    title: section.title,
    summary: section.summary,
    position,
    hidden: false,
    lessons: section.lessons.map((lesson, lessonPosition) => ({
      id: lesson.sourceLessonId,
      title: lesson.title,
      summary: lesson.summary ?? null,
      content: lesson.content,
      blocks: lesson.blocks,
      kind: lesson.kind ?? 'material',
      estimatedMinutes: lesson.estimatedMinutes ?? null,
      position: lessonPosition,
      hidden: false,
      assignmentId: lesson.assignment?.sourceAssignmentId ?? null,
      learningActivityVersionId:
        lesson.learningActivityVersionId ?? lesson.assignment?.learningActivityVersionId ?? null,
      assignmentTitle: lesson.assignment?.title ?? null,
      moduleKey: lesson.assignment?.moduleKey ?? null,
    })),
  }));
}

function CourseEditor({
  course,
  unavailableMessage,
  assignments,
  onBack,
  onEditCourse,
  onShare,
  onChanged,
  canTeach,
  onRegisterLeaveGuard,
  onSectionWorkChange,
  onEditorWorkChange,
}: {
  readonly course: Course;
  readonly unavailableMessage: string | null;
  readonly assignments: readonly LibraryAssignment[];
  readonly onBack: () => void;
  readonly onEditCourse: () => void;
  readonly onShare: () => void;
  readonly onChanged: () => void;
  readonly canTeach: boolean;
  readonly onRegisterLeaveGuard?: (guard: (() => boolean) | null) => void;
  readonly onSectionWorkChange: (value: boolean) => void;
  readonly onEditorWorkChange: (value: boolean) => void;
}): JSX.Element {
  const [localDirty, setLocalDirty] = useState(false);
  const localDirtyRef = useRef(false);
  const editGeneration = useRef(0);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const markDirty = () => {
    editGeneration.current += 1;
    localDirtyRef.current = true;
    setDiagnosticFocus(null);
    setLocalDirty(true);
    onEditorWorkChange(true);
  };
  const [sections, setSections] = useState<CourseSection[] | null>(null);
  const [draftRevision, setDraftRevision] = useState(course.draftRevision);
  const draftRevisionRef = useRef(course.draftRevision);
  const revisionRefreshRef = useRef<Promise<boolean> | null>(null);
  const visibilityWriteRef = useRef<VisibilityWriteState>(null);
  const [visibilityWrite, setVisibilityWrite] = useState<VisibilityWriteState>(null);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [newLessonSectionId, setNewLessonSectionId] = useState<string | null>(null);
  const createdLessonIdRef = useRef<string | null>(null);
  const [sectionForm, setSectionForm] = useState<CourseSection | null | 'new'>(null);
  const [saveTarget, setSaveTarget] = useState<HTMLDivElement | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const compactHeaderRef = useRef<HTMLElement>(null);
  // The outline's sticky offset follows the actual responsive header height.
  useEffect(() => {
    const header = compactHeaderRef.current;
    const editor = header?.closest('.course-document-editor');
    if (!header || !(editor instanceof HTMLElement)) return;
    const updateOffset = () => {
      editor.style.setProperty(
        '--course-compact-header-height',
        `${Math.ceil(header.getBoundingClientRect().height)}px`,
      );
    };
    updateOffset();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateOffset);
    observer?.observe(header);
    return () => {
      observer?.disconnect();
      editor.style.removeProperty('--course-compact-header-height');
    };
  }, []);
  const [wideLayout, setWideLayout] = useState(
    () => window.matchMedia('(min-width: 761px)').matches,
  );
  useEffect(() => {
    const media = window.matchMedia('(min-width: 761px)');
    const update = () => {
      setWideLayout(media.matches);
      setOutlineOpen(false);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const editor = compactHeaderRef.current?.closest('.course-document-editor');
    const heading = editor?.querySelector('.course-outline-head');
    if (!(editor instanceof HTMLElement) || !(heading instanceof HTMLElement)) return;
    const updateHeight = () => {
      editor.style.setProperty(
        '--course-outline-head-height',
        `${Math.ceil(heading.getBoundingClientRect().height)}px`,
      );
    };
    updateHeight();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateHeight);
    observer?.observe(heading);
    return () => {
      observer?.disconnect();
      editor.style.removeProperty('--course-outline-head-height');
    };
  }, [sections, wideLayout]);
  const [preview, setPreview] = useState(false);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const [publishedPreview, setPublishedPreview] = useState<PublishedAuthorVersion | null>(null);
  const publicationReceipt = useRef<{ id: string; versionNumber: number } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [sectionWork, setSectionWork] = useState(false);
  const [assignVersion, setAssignVersion] = useState<PublishedAuthorVersion | null>(null);
  const assignmentAttempt = useRef<{
    versionId: string;
    version: PublishedAuthorVersion;
    value: CourseAssignAttempt;
  } | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const hasWork =
    localDirty || sectionWork || writing || previewBusy || restoreBusy || visibilityWrite !== null;
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publicationProblem, setPublicationProblem] =
    useState<CoursePrepublicationDiagnostic | null>(null);
  const [diagnosticFocus, setDiagnosticFocus] = useState<CourseDiagnosticFocus | null>(null);
  const visibilitySaveBlock =
    visibilityWrite === 'pending'
      ? 'Изменяем видимость. Дождитесь подтверждения перед сохранением урока.'
      : visibilityWrite === 'unconfirmed'
        ? 'Сохранение недоступно: изменение видимости не подтверждено.'
        : null;
  const lessonSaveBlock = unavailableMessage
    ? 'Курс недоступен. Сохранение урока остановлено.'
    : visibilitySaveBlock;
  useEffect(() => {
    // Read the refs as well: an older effect must not clear work reported
    // synchronously by input or by a just-started visibility command.
    onEditorWorkChange(hasWork || localDirtyRef.current || visibilityWriteRef.current !== null);
  }, [hasWork, onEditorWorkChange]);

  const setSectionWorkState = useCallback(
    (value: boolean) => {
      setSectionWork(value);
      onSectionWorkChange(value);
    },
    [onSectionWorkChange],
  );
  function canLeave(): boolean {
    if (
      writing ||
      publishing ||
      previewBusy ||
      assignBusy ||
      restoreBusy ||
      visibilityWriteRef.current === 'pending'
    )
      return false;
    if (localDirtyRef.current || sectionWork)
      return window.confirm(
        'Есть несохранённые изменения курса. Покинуть редактор без сохранения?',
      );
    if (visibilityWriteRef.current === 'unconfirmed')
      return window.confirm('Изменение видимости не подтверждено. Всё равно покинуть редактор?');
    if (assignmentAttempt.current?.value.submitted && !assignmentAttempt.current.value.completed)
      return window.confirm(
        'Назначение курса не подтверждено. Вернитесь и повторите попытку, чтобы избежать дубликата. Всё равно покинуть редактор?',
      );
    return true;
  }
  useEffect(() => {
    onRegisterLeaveGuard?.(canLeave);
    return () => onRegisterLeaveGuard?.(null);
  });
  useEffect(() => {
    if (
      !hasWork &&
      !publishing &&
      !assignBusy &&
      !(assignmentAttempt.current?.value.submitted && !assignmentAttempt.current.value.completed)
    )
      return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasWork, publishing, assignBusy, assignVersion]);

  const loadOutline = useCallback(
    async (force = false) => {
      if (unavailableMessage) return false;
      if (visibilityWriteRef.current) return false;
      if (localDirtyRef.current && !force) return false;
      const generation = editGeneration.current;
      const result = await api.courseOutline(course.id);
      if (visibilityWriteRef.current) return false;
      // A request started before a local edit must not replace the save
      // receipt's revision or report a stale fetch error. A newer remote
      // revision is still worth reporting while that edit remains unsaved.
      if (generation !== editGeneration.current) {
        if (
          result.ok &&
          localDirtyRef.current &&
          result.data.draftRevision > draftRevisionRef.current
        ) {
          setError('Курс изменён в другом окне. Локальные правки сохранены в форме.');
        }
        return false;
      }
      if (!result.ok) {
        if (!force && !localDirtyRef.current) {
          setSections([]);
        }
        setError(result.error.message);
        return false;
      }
      if (result.data.draftRevision < draftRevisionRef.current) return false;
      if (localDirtyRef.current) {
        if (result.data.draftRevision > draftRevisionRef.current) {
          setError('Курс изменён в другом окне. Локальные правки сохранены в форме.');
          return false;
        }
        // A saved lesson may move to another section/position while the author
        // types again. Applying that outline would remount and discard the form.
        return true;
      }
      draftRevisionRef.current = result.data.draftRevision;
      setDraftRevision(result.data.draftRevision);
      localDirtyRef.current = false;
      setLocalDirty(false);
      setSections(result.data.sections);
      setSelectedLessonId((current) => {
        if (
          current &&
          result.data.sections.some((section) =>
            section.lessons.some((lesson) => lesson.id === current),
          )
        ) {
          return current;
        }
        return result.data.sections.flatMap((section) => section.lessons)[0]?.id ?? null;
      });
      return true;
    },
    [course.id, course.draftRevision, unavailableMessage],
  );

  useEffect(() => {
    void loadOutline();
  }, [loadOutline]);

  const selected = useMemo(() => {
    for (const section of sections ?? []) {
      const lesson = section.lessons.find((entry) => entry.id === selectedLessonId);
      if (lesson) return { section, lesson };
    }
    return null;
  }, [sections, selectedLessonId]);
  function withSavedDraft(action: () => void): void {
    if (unavailableMessage) {
      setNotice(null);
      setError(unavailableMessage);
      return;
    }
    if (visibilityWriteRef.current) {
      setNotice(null);
      setError(
        visibilityWriteRef.current === 'unconfirmed'
          ? unconfirmedVisibilityMessage
          : 'Дождитесь подтверждения изменения видимости.',
      );
      return;
    }
    if (localDirtyRef.current || sectionWork || writing || publishing || assignBusy) {
      setNotice(null);
      setError('Сначала сохраните изменения урока. Переход не выполнен, данные не потеряны.');
      return;
    }
    action();
  }

  async function act(run: () => MutationResult, done: string): Promise<boolean> {
    if (unavailableMessage) {
      setNotice(null);
      setError(unavailableMessage);
      return false;
    }
    if (visibilityWriteRef.current) {
      setNotice(null);
      setError(
        visibilityWriteRef.current === 'unconfirmed'
          ? unconfirmedVisibilityMessage
          : 'Дождитесь подтверждения изменения видимости.',
      );
      return false;
    }
    if (localDirtyRef.current || writing || publishing || assignBusy) {
      setNotice(null);
      setError('Сначала сохраните изменения урока. Структура курса не изменена.');
      return false;
    }
    if (revisionRefreshRef.current) {
      setError('Дождитесь обновления содержания курса и повторите действие.');
      return false;
    }
    setWriting(true);
    onEditorWorkChange(true);
    try {
      const result = await run();
      if (!result.ok) {
        setError(result.error?.message ?? 'Не получилось.');
        return false;
      }
      setError(null);
      setNotice(done);
      await loadOutline();
      onChanged();
      return true;
    } finally {
      setWriting(false);
    }
  }

  async function setVisibility(
    kind: 'lesson' | 'section',
    id: string,
    hidden: boolean,
  ): Promise<void> {
    const expectedRevision = draftRevisionRef.current;
    const done =
      kind === 'lesson'
        ? hidden
          ? 'Урок скрыт.'
          : 'Урок показан.'
        : hidden
          ? 'Раздел скрыт.'
          : 'Раздел показан.';
    const completed = await act(async () => {
      visibilityWriteRef.current = 'pending';
      setVisibilityWrite('pending');
      setNotice(null);
      const unconfirmed = () => {
        visibilityWriteRef.current = 'unconfirmed';
        setVisibilityWrite('unconfirmed');
        return { ok: false, error: { message: unconfirmedVisibilityMessage } };
      };
      try {
        const result =
          kind === 'lesson'
            ? await api.setCourseLessonHidden(course.id, id, hidden, expectedRevision)
            : await api.setCourseSectionHidden(course.id, id, hidden, expectedRevision);
        if (!result.ok) {
          if (result.status === 0 || result.status >= 500) return unconfirmed();
          visibilityWriteRef.current = null;
          setVisibilityWrite(null);
          return result;
        }
        if (
          !visibilityReceiptIsValid(result.data, hidden, expectedRevision) ||
          draftRevisionRef.current !== expectedRevision
        )
          return unconfirmed();
        // Retain the live lesson form and its generation. Only this command's
        // exact revision and visibility flag may advance while the author types.
        draftRevisionRef.current = result.data.draftRevision;
        setDraftRevision(result.data.draftRevision);
        setSections(
          (current) =>
            current?.map((section) =>
              kind === 'section' && section.id === id
                ? { ...section, hidden }
                : kind === 'lesson'
                  ? {
                      ...section,
                      lessons: section.lessons.map((lesson) =>
                        lesson.id === id ? { ...lesson, hidden } : lesson,
                      ),
                    }
                  : section,
            ) ?? null,
        );
        visibilityWriteRef.current = null;
        setVisibilityWrite(null);
        return result;
      } catch {
        return unconfirmed();
      }
    }, done);
    if (completed && localDirtyRef.current)
      setNotice(done + ' Последние изменения урока ещё не сохранены.');
  }

  async function saveLesson(lessonId: string | null, input: CourseLessonInput): Promise<void> {
    if (unavailableMessage) {
      setNotice(null);
      setError(unavailableMessage);
      return;
    }
    if (visibilityWriteRef.current) {
      setError(
        visibilityWriteRef.current === 'unconfirmed'
          ? unconfirmedVisibilityMessage
          : 'Дождитесь подтверждения изменения видимости.',
      );
      return;
    }
    setWriting(true);
    try {
      const savingGeneration = editGeneration.current;
      const pendingRefresh = revisionRefreshRef.current;
      if (pendingRefresh) {
        try {
          await pendingRefresh;
        } finally {
          if (revisionRefreshRef.current === pendingRefresh) revisionRefreshRef.current = null;
        }
      }
      const expectedRevision = draftRevisionRef.current;
      const result = await api.saveCourseLesson(course.id, lessonId, {
        ...input,
        expectedRevision,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (
        !Number.isSafeInteger(result.data.draftRevision) ||
        result.data.draftRevision <= expectedRevision
      ) {
        if (!lessonId) createdLessonIdRef.current = result.data.id;
        setError(
          'Не удалось подтвердить версию курса. Обновите страницу перед повторным сохранением.',
        );
        return;
      }
      draftRevisionRef.current = result.data.draftRevision;
      setDraftRevision(result.data.draftRevision);
      const editedSinceSave = editGeneration.current !== savingGeneration;
      setError(null);
      setNotice(
        editedSinceSave
          ? 'Урок сохранён. Последние изменения ещё не сохранены.'
          : lessonId
            ? 'Урок сохранён.'
            : 'Урок добавлен.',
      );
      if (editedSinceSave) {
        if (!lessonId) createdLessonIdRef.current = result.data.id;
      } else {
        localDirtyRef.current = false;
        setLocalDirty(false);
        createdLessonIdRef.current = null;
        setNewLessonSectionId(null);
        setSelectedLessonId(result.data.id);
      }
      setWriting(false);
      const refresh = loadOutline(true);
      revisionRefreshRef.current = refresh;
      try {
        await refresh;
      } finally {
        if (revisionRefreshRef.current === refresh) revisionRefreshRef.current = null;
      }
      onChanged();
    } finally {
      setWriting(false);
    }
  }

  async function deleteLesson(): Promise<void> {
    if (!selected) return;
    if (!window.confirm('Удалить урок «' + selected.lesson.title + '»?')) return;
    const removed = await act(
      () => api.deleteCourseLesson(course.id, selected.lesson.id, draftRevision),
      'Урок удалён.',
    );
    if (removed) setSelectedLessonId(null);
  }

  const lessonCount = (sections ?? []).reduce((sum, section) => sum + section.lessons.length, 0);

  async function publishCourse(): Promise<void> {
    if (unavailableMessage) {
      setNotice(null);
      setError(unavailableMessage);
      return;
    }
    if (
      publishing ||
      localDirtyRef.current ||
      sectionWork ||
      writing ||
      visibilityWriteRef.current ||
      lessonCount === 0
    )
      return;
    if (revisionRefreshRef.current) {
      setError('Дождитесь обновления содержания курса и повторите публикацию.');
      return;
    }
    setPublishing(true);
    setPublicationProblem(null);
    const result = await api.publishCourse(
      course.id,
      draftRevision,
      `course-publish:${course.id}:${draftRevision}`,
    );
    setPublishing(false);
    if (!result.ok) {
      setNotice(null);
      setError(result.error.message);
      setPublicationProblem(coursePrepublicationDiagnostic(result.error, course.id, draftRevision));
      return;
    }
    publicationReceipt.current = {
      id: result.data.versionId,
      versionNumber: result.data.versionNumber,
    };
    setPublishedPreview(null);
    setError(null);
    setNotice(
      result.data.reused
        ? `Публикация подтверждена: версия ${result.data.versionNumber}.`
        : `Курс опубликован: версия ${result.data.versionNumber}.`,
    );
    await loadOutline();
    onChanged();
  }

  function correctPublicationProblem(): void {
    withSavedDraft(() => {
      if (!publicationProblem) return;
      const targetSection = sections?.find((entry) => entry.id === publicationProblem.sectionId);
      const targetLesson = targetSection?.lessons.find(
        (entry) => entry.id === publicationProblem.lessonId,
      );
      if (
        publicationProblem.draftRevision !== draftRevisionRef.current ||
        !targetLesson ||
        (publicationProblem.blockId !== null &&
          !targetLesson.blocks.some((block) => block.id === publicationProblem.blockId))
      ) {
        setError(
          'Содержание курса изменилось. Повторите публикацию, чтобы проверить текущую редакцию.',
        );
        setPublicationProblem(null);
        return;
      }
      setPreview(false);
      setPublishedPreview(null);
      setNewLessonSectionId(null);
      setSelectedLessonId(targetLesson.id);
      setDiagnosticFocus({ diagnostic: publicationProblem });
    });
  }

  async function exactPublished(): Promise<PublishedAuthorVersion | null> {
    const versionNumber = publicationReceipt.current?.versionNumber ?? course.publishedVersion;
    if (!versionNumber) {
      setError('Сначала опубликуйте курс, чтобы показать или назначить точную версию.');
      return null;
    }
    setPreviewBusy(true);
    try {
      const versions = await api.authorVersions('course', course.id);
      if (!versions.ok) {
        setError(versions.error.message);
        return null;
      }
      const version = versions.data.items.find(
        (item) =>
          item.versionNumber === versionNumber &&
          (!publicationReceipt.current || item.id === publicationReceipt.current.id),
      );
      if (!version?.outline) {
        setError('Точная опубликованная версия недоступна. Черновик не подставлен.');
        return null;
      }
      setError(null);
      setPublishedPreview(version);
      return version;
    } finally {
      setPreviewBusy(false);
    }
  }
  async function showPublished(assign = false): Promise<void> {
    if (unavailableMessage) {
      setNotice(null);
      setError(unavailableMessage);
      return;
    }
    if (hasWork || publishing || assignBusy) {
      setError('Сначала сохраните изменения курса.');
      return;
    }
    const pending =
      assign &&
      assignmentAttempt.current?.value.submitted &&
      !assignmentAttempt.current.value.completed
        ? assignmentAttempt.current
        : null;
    const version = pending ? pending.version : await exactPublished();
    if (!version) return;
    setPublishedPreview(version);
    setPreview(true);
    if (assign) {
      if (assignmentAttempt.current?.versionId !== version.id)
        assignmentAttempt.current = {
          versionId: version.id,
          version,
          value: { classroomId: '', dueDate: '' },
        };
      setAssignVersion(version);
    }
  }

  return (
    <fieldset disabled={restoreBusy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <section className="course-system course-document-editor" data-testid="course-editor">
        <div className="course-editor-document" hidden={preview && assignVersion === null}>
          <header className="course-compact-header" ref={compactHeaderRef}>
            <button
              type="button"
              className="course-back-button"
              onClick={() =>
                withSavedDraft(() => {
                  if (canLeave()) onBack();
                })
              }
            >
              <span aria-hidden="true">←</span>
              <span>Курсы</span>
            </button>
            <div className="course-compact-title">
              <div>
                <h2>{course.title}</h2>
                <span className={`course-status-pill ${publicationClass(course)}`}>
                  {publicationLabel(course)}
                </span>
              </div>
              <p>
                {(sections?.length ?? course.sectionCount) +
                  ' разделов · ' +
                  lessonCount +
                  ' уроков'}
              </p>
            </div>
            <Dropdown
              className="course-outline-menu course-actions-menu"
              fitViewport
              ariaLabel="Действия курса"
              label="Ещё"
            >
              {(close) => (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      withSavedDraft(onEditCourse);
                    }}
                  >
                    Настройки
                  </button>
                  {canTeach ? (
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        withSavedDraft(onShare);
                      }}
                    >
                      Доступ
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      setHistoryOpen(true);
                    }}
                  >
                    История версий
                  </button>
                  {course.publishedVersion || publicationReceipt.current ? (
                    <button
                      type="button"
                      disabled={hasWork || publishing}
                      onClick={() => {
                        close();
                        void showPublished();
                      }}
                    >
                      Опубликованная версия
                    </button>
                  ) : null}
                  {canTeach ? (
                    <button
                      type="button"
                      disabled={hasWork || publishing || lessonCount === 0}
                      onClick={() => {
                        close();
                        void showPublished(true);
                      }}
                    >
                      Назначить курс
                    </button>
                  ) : null}
                </>
              )}
            </Dropdown>
            <div className="course-header-actions">
              <div className="course-save-slot" ref={setSaveTarget} />
              <span
                className="course-save-state"
                role="status"
                aria-label="Состояние сохранения курса"
                data-testid="course-save-state"
              >
                {lessonSaveBlock
                  ? lessonSaveBlock
                  : writing || restoreBusy
                    ? 'Сохраняем изменения…'
                    : localDirty || sectionWork || newLessonSectionId
                      ? 'Есть несохранённые изменения'
                      : sections === null
                        ? 'Загружаем содержание…'
                        : 'Изменения сохранены'}
                <small>Черновик · редакция {draftRevision}</small>
              </span>
              <button
                ref={previewTrigger}
                type="button"
                className="btn-secondary"
                onClick={() =>
                  withSavedDraft(() => {
                    setPublishedPreview(null);
                    setPreview(true);
                  })
                }
              >
                Предпросмотр
              </button>
              {course.publicationState !== 'published' ? (
                <button
                  type="button"
                  className="btn-secondary course-publish-button"
                  disabled={
                    publishing ||
                    hasWork ||
                    sectionWork ||
                    lessonCount === 0 ||
                    !!unavailableMessage
                  }
                  title={lessonCount === 0 ? 'Сначала добавьте хотя бы один урок' : undefined}
                  onClick={() => void publishCourse()}
                >
                  {publishing
                    ? 'Публикуем…'
                    : course.publicationState === 'changed'
                      ? `Опубликовать v${(course.publishedVersion ?? 0) + 1}`
                      : 'Опубликовать'}
                </button>
              ) : null}
            </div>
          </header>

          {course.publicationState === 'draft' && course.visibility !== 'private' ? (
            <p className="course-publication-note" role="status">
              Доступ настроен, но коллеги увидят курс в каталоге только после первой публикации.
            </p>
          ) : null}

          {notice ? (
            <p
              className="notice-success course-inline-notice"
              role="status"
              aria-label="Уведомление курса"
            >
              {notice}
            </p>
          ) : null}
          {unavailableMessage || error ? (
            <p className="form-error course-inline-notice" role="alert">
              {unavailableMessage ?? error}
              {!unavailableMessage && publicationProblem?.lessonId ? (
                <button
                  type="button"
                  className="btn-secondary course-correction-button"
                  onClick={correctPublicationProblem}
                >
                  Перейти к исправлению
                </button>
              ) : null}
            </p>
          ) : null}

          <section
            className="course-history-panel"
            hidden={!historyOpen}
            aria-label="История версий"
          >
            <div className="course-dialog-header">
              <h3>История версий</h3>
              <button type="button" className="btn-secondary" onClick={() => setHistoryOpen(false)}>
                Закрыть историю
              </button>
            </div>
            <AuthorVersionHistory
              kind="course"
              rootId={course.id}
              revision={draftRevision}
              dirty={
                localDirty ||
                sectionForm !== null ||
                newLessonSectionId !== null ||
                visibilityWrite !== null ||
                unavailableMessage !== null
              }
              onBusyChange={setRestoreBusy}
              onOpenDraft={async (sourceVersionNumber) => {
                setPreview(false);
                setSelectedLessonId(null);
                setNewLessonSectionId(null);
                setSectionForm(null);
                await loadOutline(true);
                setEditorEpoch((value) => value + 1);
                onChanged();
                setNotice(
                  sourceVersionNumber
                    ? 'Черновик создан на основе версии ' + sourceVersionNumber
                    : 'Открыт существующий черновик.',
                );
              }}
            />
          </section>
          {course.draftActive && course.draftBaseVersionNumber ? (
            <p>Черновик на основе версии {course.draftBaseVersionNumber}</p>
          ) : null}
          {sections === null ? (
            <p role="status">Загружаем содержание…</p>
          ) : (
            <div className="course-builder" onChange={markDirty}>
              <button
                type="button"
                className="btn-secondary course-structure-button"
                aria-haspopup="dialog"
                aria-expanded={outlineOpen}
                onClick={() => setOutlineOpen(true)}
              >
                Структура курса
              </button>
              <CourseEditorDialog
                open={outlineOpen}
                inline={wideLayout}
                className="course-outline-dialog"
                title="Структура курса"
                closeLabel="Закрыть структуру"
                onClose={() => setOutlineOpen(false)}
              >
                <aside
                  className="course-outline"
                  aria-label="Содержание курса"
                  onClick={(event) => {
                    if (event.target instanceof Element && event.target.closest('button'))
                      setOutlineOpen(false);
                  }}
                >
                  <div className="course-outline-head">
                    <div>
                      <span>Содержание</span>
                      <small>{lessonCount} уроков</small>
                    </div>
                    <button
                      type="button"
                      className="course-icon-button"
                      aria-label="Добавить раздел"
                      title="Добавить раздел"
                      onClick={() => withSavedDraft(() => setSectionForm('new'))}
                    >
                      +
                    </button>
                  </div>
                  <div className="course-outline-scroll">
                    {sections.map((section, sectionIndex) => (
                      <section key={section.id} className="course-outline-section">
                        <div className="course-outline-section-head">
                          <button
                            type="button"
                            className="course-section-name"
                            onClick={() => withSavedDraft(() => setSectionForm(section))}
                          >
                            <span>{sectionIndex + 1}</span>
                            <strong>{section.title}</strong>
                            {section.hidden ? <small>Скрыт</small> : null}
                          </button>
                          <Dropdown
                            className="course-outline-menu"
                            ariaLabel={'Действия раздела «' + section.title + '»'}
                            label={<span aria-hidden="true">•••</span>}
                          >
                            {(close) => (
                              <>
                                <button
                                  type="button"
                                  disabled={sectionIndex === 0}
                                  onClick={() => {
                                    close();
                                    void act(
                                      () =>
                                        api.moveCourseSection(
                                          course.id,
                                          section.id,
                                          -1,
                                          draftRevision,
                                        ),
                                      'Раздел перемещён.',
                                    );
                                  }}
                                >
                                  Выше
                                </button>
                                <button
                                  type="button"
                                  disabled={sectionIndex === sections.length - 1}
                                  onClick={() => {
                                    close();
                                    void act(
                                      () =>
                                        api.moveCourseSection(
                                          course.id,
                                          section.id,
                                          1,
                                          draftRevision,
                                        ),
                                      'Раздел перемещён.',
                                    );
                                  }}
                                >
                                  Ниже
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    close();
                                    void act(
                                      () =>
                                        api.duplicateCourseSection(
                                          course.id,
                                          section.id,
                                          draftRevision,
                                          `course-duplicate:section:${section.id}:${draftRevision}`,
                                        ),
                                      'Раздел продублирован.',
                                    );
                                  }}
                                >
                                  Дублировать
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    close();
                                    void setVisibility('section', section.id, !section.hidden);
                                  }}
                                >
                                  {section.hidden ? 'Показать' : 'Скрыть'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    close();
                                    withSavedDraft(() => setSectionForm(section));
                                  }}
                                >
                                  Переименовать
                                </button>
                                <button
                                  type="button"
                                  className="is-danger"
                                  onClick={() => {
                                    close();
                                    void act(
                                      () =>
                                        api.deleteCourseSection(
                                          course.id,
                                          section.id,
                                          draftRevision,
                                        ),
                                      'Раздел удалён.',
                                    );
                                  }}
                                >
                                  Удалить пустой
                                </button>
                              </>
                            )}
                          </Dropdown>
                        </div>
                        <ol>
                          {section.lessons.map((lesson, lessonIndex) => (
                            <li key={lesson.id}>
                              <button
                                type="button"
                                className={
                                  selectedLessonId === lesson.id && !newLessonSectionId
                                    ? 'course-lesson-link is-active'
                                    : 'course-lesson-link'
                                }
                                aria-current={
                                  selectedLessonId === lesson.id && !newLessonSectionId
                                    ? 'page'
                                    : undefined
                                }
                                onClick={() =>
                                  withSavedDraft(() => {
                                    setSelectedLessonId(lesson.id);
                                    setNewLessonSectionId(null);
                                  })
                                }
                              >
                                <span>{lessonIndex + 1}</span>
                                <span>
                                  <strong>{lesson.title}</strong>
                                  <small>
                                    {lesson.hidden ? 'Скрыт · ' : ''}
                                    {lesson.kind === 'assignment' ? 'Задание' : 'Материал'}
                                    {lesson.estimatedMinutes
                                      ? ' · ' + lesson.estimatedMinutes + ' мин'
                                      : ''}
                                  </small>
                                </span>
                              </button>
                              <Dropdown
                                className="course-outline-menu"
                                ariaLabel={'Действия урока «' + lesson.title + '»'}
                                label={<span aria-hidden="true">•••</span>}
                              >
                                {(close) => (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        close();
                                        void act(
                                          () =>
                                            api.duplicateCourseLesson(
                                              course.id,
                                              lesson.id,
                                              draftRevision,
                                              `course-duplicate:lesson:${lesson.id}:${draftRevision}`,
                                            ),
                                          'Урок продублирован.',
                                        );
                                      }}
                                    >
                                      Дублировать
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        close();
                                        void setVisibility('lesson', lesson.id, !lesson.hidden);
                                      }}
                                    >
                                      {lesson.hidden ? 'Показать' : 'Скрыть'}
                                    </button>
                                  </>
                                )}
                              </Dropdown>
                              {selectedLessonId === lesson.id && !newLessonSectionId ? (
                                <div className="course-lesson-order" aria-label="Порядок урока">
                                  <button
                                    type="button"
                                    disabled={lessonIndex === 0}
                                    aria-label={'Выше: ' + lesson.title}
                                    onClick={() =>
                                      void act(
                                        () =>
                                          api.moveCourseLesson(
                                            course.id,
                                            lesson.id,
                                            -1,
                                            draftRevision,
                                          ),
                                        'Урок перемещён.',
                                      )
                                    }
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    disabled={lessonIndex === section.lessons.length - 1}
                                    aria-label={'Ниже: ' + lesson.title}
                                    onClick={() =>
                                      void act(
                                        () =>
                                          api.moveCourseLesson(
                                            course.id,
                                            lesson.id,
                                            1,
                                            draftRevision,
                                          ),
                                        'Урок перемещён.',
                                      )
                                    }
                                  >
                                    ↓
                                  </button>
                                </div>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                        <button
                          type="button"
                          className="course-add-lesson"
                          onClick={() =>
                            withSavedDraft(() => {
                              createdLessonIdRef.current = null;
                              setSelectedLessonId(null);
                              setNewLessonSectionId(section.id);
                            })
                          }
                        >
                          + Урок
                        </button>
                      </section>
                    ))}
                  </div>
                </aside>
              </CourseEditorDialog>

              <div className="course-workspace">
                {newLessonSectionId ? (
                  <LessonEditor
                    key={'new-' + newLessonSectionId}
                    sections={sections}
                    sectionId={newLessonSectionId}
                    lesson={null}
                    assignments={assignments}
                    onSave={(input) => saveLesson(createdLessonIdRef.current, input)}
                    onDirty={markDirty}
                    onDelete={null}
                    saveBlockedMessage={lessonSaveBlock}
                    saveTarget={saveTarget}
                  />
                ) : selected ? (
                  <LessonEditor
                    key={selected.lesson.id + '-' + selected.lesson.position + '-' + editorEpoch}
                    sections={sections}
                    sectionId={selected.section.id}
                    lesson={selected.lesson}
                    assignments={assignments}
                    onSave={(input) => saveLesson(selected.lesson.id, input)}
                    onDirty={markDirty}
                    onDelete={deleteLesson}
                    saveBlockedMessage={lessonSaveBlock}
                    diagnosticFocus={diagnosticFocus}
                    saveTarget={saveTarget}
                  />
                ) : (
                  <div className="course-workspace-empty">
                    <span aria-hidden="true">＋</span>
                    <h3>Добавьте первый урок</h3>
                    <p>Материал объясняет тему, а задание открывает практику из вашего банка.</p>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() =>
                        withSavedDraft(() => {
                          createdLessonIdRef.current = null;
                          setNewLessonSectionId(sections[0]?.id ?? null);
                        })
                      }
                    >
                      Добавить урок
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <CourseEditorDialog
          open={preview && assignVersion === null}
          screen
          returnFocusRef={previewTrigger}
          className="course-preview-dialog"
          title="Как увидит ученик"
          closeLabel="Редактировать"
          closeDisabled={previewBusy || assignBusy}
          onClose={() => setPreview(false)}
        >
          <div className="course-preview-sources" aria-label="Содержимое предпросмотра">
            <button
              type="button"
              className="btn-secondary"
              aria-pressed={!publishedPreview}
              onClick={() => setPublishedPreview(null)}
            >
              Сохранённый черновик
            </button>
            {course.publishedVersion || publicationReceipt.current ? (
              <button
                type="button"
                className="btn-secondary"
                aria-pressed={!!publishedPreview}
                disabled={previewBusy}
                onClick={() => void showPublished()}
              >
                Опубликованная версия
              </button>
            ) : null}
            {canTeach ? (
              <button
                type="button"
                className="btn-secondary"
                disabled={hasWork || publishing || lessonCount === 0}
                onClick={() => void showPublished(true)}
              >
                Назначить курс
              </button>
            ) : null}
          </div>
          {previewBusy ? <p role="status">Открываем опубликованную версию…</p> : null}
          {preview && error ? <p role="alert">{error}</p> : null}
          {preview && sections ? (
            <CoursePreview
              course={course}
              draftRevision={draftRevision}
              sections={publishedPreview ? publishedCourseSections(publishedPreview) : sections}
              {...(publishedPreview ? { version: publishedPreview } : {})}
            />
          ) : null}
        </CourseEditorDialog>

        {sectionForm ? (
          <SectionFormDialog
            section={sectionForm === 'new' ? null : sectionForm}
            draftRevision={draftRevision}
            unavailableMessage={unavailableMessage}
            onWorkChange={setSectionWorkState}
            onClose={() => setSectionForm(null)}
            onSave={async (value, target) => {
              if (
                unavailableMessage ||
                localDirtyRef.current ||
                writing ||
                publishing ||
                assignBusy ||
                revisionRefreshRef.current ||
                target.draftRevision === null
              ) {
                return {
                  ok: false,
                  status: 409,
                  error: {
                    code: 'course_busy',
                    message:
                      unavailableMessage ??
                      'Дождитесь сохранения и обновления курса, затем повторите действие.',
                  },
                };
              }
              setWriting(true);
              try {
                const result = await api.saveCourseSection(course.id, target.id, {
                  ...value,
                  expectedRevision: target.draftRevision,
                });
                if (!result.ok) {
                  setError(result.error.message);
                  return result;
                }
                if (!metadataReceiptIsValid(result.data, target)) return result;
                if (result.data.draftRevision > draftRevisionRef.current) {
                  draftRevisionRef.current = result.data.draftRevision;
                  setDraftRevision(result.data.draftRevision);
                }
                setError(null);
                setNotice(target.id ? 'Раздел сохранён.' : 'Раздел добавлен.');
                try {
                  await loadOutline();
                  onChanged();
                } catch {
                  setError(
                    'Не удалось обновить содержание курса. Последние изменения остались в форме.',
                  );
                }
                return result;
              } finally {
                setWriting(false);
              }
            }}
          />
        ) : null}
        {assignVersion && assignmentAttempt.current ? (
          <CourseAssignDialog
            courseId={course.id}
            version={assignVersion}
            attempt={assignmentAttempt.current.value}
            onBusyChange={setAssignBusy}
            onClose={() => {
              setPreview(false);
              setAssignVersion(null);
            }}
          />
        ) : null}
      </section>
    </fieldset>
  );
}

/**
 * Методическая мастерская преподавателя.
 *
 * Course stores an outline of sections and lessons. Assignments remain in the
 * bank and may be attached to a lesson, so authoring and class delivery do not
 * become the same screen.
 */
export function CoursesPanel({
  assignments,
  canTeach,
  onChanged,
  onRegisterLeaveGuard,
  initialCourseId,
}: {
  readonly assignments: readonly LibraryAssignment[];
  readonly canTeach: boolean;
  readonly onChanged: () => void;
  readonly onRegisterLeaveGuard?: (guard: (() => boolean) | null) => void;
  readonly initialCourseId?: string | null;
}): JSX.Element {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialCourseId ?? null);
  const [openSnapshot, setOpenSnapshot] = useState<Course | null>(null);
  const [courseForm, setCourseForm] = useState<Course | null | 'new'>(null);
  const [sharing, setSharing] = useState<Course | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const creationRequest = useRef<{ payload: string; id: string } | null>(null);

  const editorGuard = useRef<(() => boolean) | null>(null);
  const [formWork, setFormWork] = useState(false);
  const [sectionFormWork, setSectionFormWork] = useState(false);
  const [editorWork, setEditorWork] = useState(false);
  const setFormWorkState = useCallback((value: boolean) => setFormWork(value), []);
  const registerEditorGuard = useCallback((guard: (() => boolean) | null) => {
    editorGuard.current = guard;
  }, []);
  useEffect(() => {
    onRegisterLeaveGuard?.(() => {
      if (formWork) {
        setError('Сохраните настройки курса или явно отмените изменения.');
        return false;
      }
      return editorGuard.current?.() ?? true;
    });
    return () => onRegisterLeaveGuard?.(null);
  }, [formWork, onRegisterLeaveGuard]);
  useEffect(() => {
    if (!formWork) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [formWork]);

  const reload = useCallback(async () => {
    try {
      const result = await api.listCourses();
      if (result.ok && Array.isArray(result.data?.items)) {
        setCourses(result.data.items);
        setError(null);
        return;
      }
      // A refresh failure must not unmount an open course or its unsaved form.
      setCourses((current) => current ?? []);
      setError(result.ok ? 'Не удалось обновить список курсов.' : result.error.message);
    } catch {
      setCourses((current) => current ?? []);
      setError('Не удалось обновить список курсов. Последние изменения остались в форме.');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function act(run: () => MutationResult, done: string): Promise<boolean> {
    const result = await run();
    if (!result.ok) {
      setError(result.error?.message ?? 'Не получилось.');
      return false;
    }
    setError(null);
    setNotice(done);
    await reload();
    onChanged();
    return true;
  }

  async function saveCourseMetadata(
    value: CourseFormValue,
    target: MetadataSaveTarget,
  ): Promise<ApiResult<MetadataSaveReceipt>> {
    let requestId: string | undefined;
    if (!target.id) {
      const payload = JSON.stringify(value);
      if (creationRequest.current?.payload !== payload)
        creationRequest.current = { payload, id: crypto.randomUUID() };
      requestId = creationRequest.current.id;
    }
    const result = await api.saveCourse(target.id, {
      ...value,
      ...(target.draftRevision !== null ? { expectedRevision: target.draftRevision } : {}),
      ...(requestId ? { requestId } : {}),
    });
    if (!result.ok) {
      setError(result.error.message);
      return result;
    }
    if (!metadataReceiptIsValid(result.data, target)) return result;
    setError(null);
    setNotice(target.id ? 'Настройки курса сохранены.' : 'Курс создан.');
    creationRequest.current = null;
    try {
      await reload();
      onChanged();
    } catch {
      setError('Не удалось обновить список курсов. Последние изменения остались в форме.');
    }
    return result;
  }

  async function ensureDemoCourse(): Promise<void> {
    if (creatingDemo) return;
    setCreatingDemo(true);
    const result = await api.ensureDemoCourse();
    setCreatingDemo(false);
    if (!result.ok) {
      setNotice(null);
      setError(result.error.message);
      return;
    }
    setError(null);
    setNotice(
      result.data.created
        ? 'Готовый демо-курс добавлен и опубликован.'
        : 'Демо-курс уже есть в вашей библиотеке.',
    );
    await reload();
    setOpenId(result.data.id);
    onChanged();
  }

  const visibleCourses = (courses ?? []).filter(
    (course) => (course.archivedAt !== null) === showArchived,
  );
  const listedOpen =
    courses?.find((course) => course.id === openId && course.archivedAt === null) ?? null;
  const hasOpenWork = formWork || sectionFormWork || editorWork;
  useEffect(() => {
    if (listedOpen) {
      setOpenSnapshot(listedOpen);
    } else if (courses !== null && !hasOpenWork) {
      setOpenSnapshot(null);
      setOpenId(null);
    }
  }, [listedOpen, courses, hasOpenWork]);
  // Retain the already open presentation while any editor/form has work.
  // The server list stays unchanged; this snapshot never restores an entity.
  const open = listedOpen ?? (hasOpenWork && openSnapshot?.id === openId ? openSnapshot : null);
  const unavailableMessage =
    'Курс больше недоступен для редактирования. Последние изменения остались в форме. Скопируйте их перед закрытием.';
  const courseFormUnavailable =
    courseForm &&
    courseForm !== 'new' &&
    courses !== null &&
    !courses.some((course) => course.id === courseForm.id && course.archivedAt === null)
      ? unavailableMessage
      : null;
  if (open) {
    return (
      <>
        {error ? <p role="alert">{error}</p> : null}
        <CourseEditor
          course={open}
          unavailableMessage={listedOpen ? null : unavailableMessage}
          assignments={assignments}
          onBack={() => setOpenId(null)}
          onEditCourse={() => setCourseForm(open)}
          onShare={() => setSharing(open)}
          onChanged={() => void reload()}
          canTeach={canTeach}
          onRegisterLeaveGuard={registerEditorGuard}
          onSectionWorkChange={setSectionFormWork}
          onEditorWorkChange={setEditorWork}
        />
        {courseForm ? (
          <CourseFormDialog
            onWorkChange={setFormWorkState}
            course={courseForm === 'new' ? null : courseForm}
            unavailableMessage={courseFormUnavailable}
            onClose={() => setCourseForm(null)}
            onSave={saveCourseMetadata}
          />
        ) : null}
        {sharing ? (
          <ShareDialog
            kind="course"
            subjectId={sharing.id}
            title={sharing.title}
            visibility={sharing.visibility}
            onClose={() => setSharing(null)}
            onChanged={() => void reload()}
          />
        ) : null}
      </>
    );
  }

  return (
    <section className="courses-panel">
      <div className="courses-toolbar">
        <div className="courses-toolbar-copy">
          <strong>Ваши курсы</strong>
          <span>
            Собирайте уроки и материалы, затем назначайте опубликованный курс классу из редактора.
          </span>
        </div>
        <div className="courses-toolbar-actions">
          <button
            type="button"
            className={!showArchived ? 'btn-primary' : 'btn-secondary'}
            aria-pressed={!showArchived}
            onClick={() => setShowArchived(false)}
          >
            Активные
          </button>
          <button
            type="button"
            className={showArchived ? 'btn-primary' : 'btn-secondary'}
            aria-pressed={showArchived}
            onClick={() => setShowArchived(true)}
          >
            Архив
          </button>
          {canTeach && !showArchived ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={creatingDemo}
              onClick={() => void ensureDemoCourse()}
            >
              {creatingDemo ? 'Добавляем…' : 'Добавить демо-курс'}
            </button>
          ) : null}
          {!showArchived ? (
            <button
              type="button"
              className="portal-create-button"
              onClick={() => setCourseForm('new')}
            >
              Создать курс
            </button>
          ) : null}
        </div>
      </div>

      {notice ? (
        <p className="notice-success" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {courses === null ? (
        <p role="status">Загружаем курсы…</p>
      ) : visibleCourses.length === 0 ? (
        <div className="course-list-empty">
          <span aria-hidden="true">＋</span>
          <div>
            <h3>{showArchived ? 'Архив пуст' : 'Создайте первый курс'}</h3>
            <p>
              {showArchived
                ? 'Архивированные курсы появятся здесь.'
                : 'Разделы задают порядок, уроки объединяют объяснение и практику.'}
            </p>
          </div>
          {!showArchived ? (
            <div className="course-list-empty-actions">
              {canTeach ? (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={creatingDemo}
                  onClick={() => void ensureDemoCourse()}
                >
                  {creatingDemo ? 'Добавляем…' : 'Посмотреть готовый пример'}
                </button>
              ) : null}
              <button type="button" className="btn-primary" onClick={() => setCourseForm('new')}>
                Создать свой курс
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <ul className="courses-list" data-testid="courses-list">
          {visibleCourses.map((course) => (
            <li key={course.id}>
              <button
                type="button"
                className="course-row-main"
                disabled={showArchived}
                onClick={() => setOpenId(course.id)}
              >
                <span className="course-row-mark" aria-hidden="true">
                  {course.title.slice(0, 1).toLocaleUpperCase('ru-RU')}
                </span>
                <span className="course-row-copy">
                  <span>
                    <strong>{course.title}</strong>
                    <em className={publicationClass(course)}>{publicationLabel(course)}</em>
                    {course.copiedFromCourseId ? <em>из каталога</em> : null}
                  </span>
                  {course.summary ? <small>{course.summary}</small> : null}
                </span>
                <span className="course-row-stats">
                  <span>
                    <strong>{course.sectionCount}</strong>
                    <small>разделов</small>
                  </span>
                  <span>
                    <strong>{course.lessonCount}</strong>
                    <small>уроков</small>
                  </span>
                  <span className="course-row-visibility">
                    {visibilityLabel(course.visibility)}
                  </span>
                </span>
              </button>
              {showArchived ? (
                <button
                  type="button"
                  className="btn-secondary course-open-button"
                  onClick={() =>
                    void act(
                      () => api.archiveCourse(course.id, false, course.draftRevision),
                      'Курс «' + course.title + '» восстановлен.',
                    )
                  }
                >
                  Восстановить
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn-secondary course-open-button"
                    onClick={() => setOpenId(course.id)}
                  >
                    Открыть
                  </button>
                  <Dropdown
                    className="course-row-menu"
                    ariaLabel={'Ещё: ' + course.title}
                    label={<span aria-hidden="true">•••</span>}
                  >
                    {(close) => (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            close();
                            setCourseForm(course);
                          }}
                        >
                          Настройки
                        </button>
                        {canTeach ? (
                          <button
                            type="button"
                            onClick={() => {
                              close();
                              setSharing(course);
                            }}
                          >
                            Кому видно
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            close();
                            if (!window.confirm('Архивировать курс «' + course.title + '»?'))
                              return;

                            void act(
                              () => api.archiveCourse(course.id, true, course.draftRevision),
                              'Курс «' + course.title + '» перемещён в архив.',
                            );
                          }}
                        >
                          Архивировать
                        </button>
                      </>
                    )}
                  </Dropdown>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {courseForm ? (
        <CourseFormDialog
          onWorkChange={setFormWorkState}
          course={courseForm === 'new' ? null : courseForm}
          unavailableMessage={courseFormUnavailable}
          onClose={(receipt) => {
            setCourseForm(null);
            if (receipt && courseForm === 'new') setOpenId(receipt.id);
          }}
          onSave={saveCourseMetadata}
        />
      ) : null}

      {sharing ? (
        <ShareDialog
          kind="course"
          subjectId={sharing.id}
          title={sharing.title}
          visibility={sharing.visibility}
          onClose={() => setSharing(null)}
          onChanged={() => void reload()}
        />
      ) : null}
    </section>
  );
}
