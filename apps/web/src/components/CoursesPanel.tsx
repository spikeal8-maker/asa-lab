import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type JSX } from 'react';
import {
  api,
  visibilityLabel,
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
import { CourseAssignDialog, type CourseAssignAttempt } from './CourseAssignDialog';
import { Dropdown } from './Dropdown';
import { LessonBlockEditor, lessonBlocksValid } from './LessonBlockEditor';
import { LessonBlocks } from './LessonBlocks';
import { ShareDialog } from './ShareDialog';
import './courses-panel.css';

type MutationResult = Promise<{ ok: boolean; error?: { message: string } }>;

interface CourseFormValue {
  title: string;
  summary: string | null;
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
  onClose,
  onSave,
  onWorkChange,
}: {
  readonly course: Course | null;
  readonly onClose: () => void;
  readonly onSave: (value: CourseFormValue) => Promise<void>;
  readonly onWorkChange?: (value: boolean) => void;
}): JSX.Element {
  const [title, setTitle] = useState(course?.title ?? '');
  const [summary, setSummary] = useState(course?.summary ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = title !== (course?.title ?? '') || summary !== (course?.summary ?? '');
  useEffect(() => {
    onWorkChange?.(dirty || saving);
    return () => onWorkChange?.(false);
  }, [dirty, saving, onWorkChange]);
  function close(): void {
    if (!saving && (!dirty || window.confirm('Отменить несохранённые настройки курса?'))) onClose();
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({ title: title.trim(), summary: summary.trim() || null });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal course-form-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="course-form-title"
        onSubmit={(event) => void submit(event)}
      >
        <h2 id="course-form-title">{course ? 'Настройки курса' : 'Новый курс'}</h2>
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
        <div className="modal-actions">
          <button type="button" className="btn-secondary" disabled={saving} onClick={close}>
            Отмена
          </button>
          <button type="submit" className="btn-primary" disabled={!title.trim() || saving}>
            {saving ? 'Сохраняем…' : course ? 'Сохранить' : 'Создать курс'}
          </button>
        </div>
      </form>
    </div>
  );
}

function SectionFormDialog({
  section,
  onClose,
  onSave,
  onWorkChange,
}: {
  readonly section: CourseSection | null;
  readonly onClose: () => void;
  readonly onSave: (value: { title: string; summary: string | null }) => Promise<void>;
  readonly onWorkChange?: (value: boolean) => void;
}): JSX.Element {
  const [title, setTitle] = useState(section?.title ?? '');
  const [summary, setSummary] = useState(section?.summary ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = title !== (section?.title ?? '') || summary !== (section?.summary ?? '');
  useEffect(() => {
    onWorkChange?.(dirty || saving);
    return () => onWorkChange?.(false);
  }, [dirty, saving, onWorkChange]);
  function close(): void {
    if (!saving && (!dirty || window.confirm('Отменить несохранённый раздел?'))) onClose();
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({ title: title.trim(), summary: summary.trim() || null });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal course-form-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="section-form-title"
        onSubmit={(event) => void submit(event)}
      >
        <h2 id="section-form-title">{section ? 'Раздел курса' : 'Новый раздел'}</h2>
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
          <button type="submit" className="btn-primary" disabled={!title.trim() || saving}>
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
}: {
  readonly sections: readonly CourseSection[];
  readonly sectionId: string;
  readonly lesson: CourseLesson | null;
  readonly assignments: readonly LibraryAssignment[];
  readonly onSave: (input: CourseLessonInput) => Promise<void>;
  readonly onDelete: (() => Promise<void>) | null;
  readonly onDirty: () => void;
}): JSX.Element {
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
  const [saving, setSaving] = useState(false);
  const valid =
    title.trim().length > 0 &&
    (kind === 'material' || assignmentId.length > 0) &&
    lessonBlocksValid(blocks) &&
    !saving;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!valid) return;
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
    <form className="course-lesson-editor" onSubmit={(event) => void submit(event)}>
      <div className="course-editor-title">
        <div>
          <span className="course-eyebrow">{lesson ? 'Урок' : 'Новый урок'}</span>
          <h3>{lesson?.title ?? 'Добавьте материал или практику'}</h3>
        </div>
        {onDelete ? (
          <button type="button" className="course-text-danger" onClick={() => void onDelete()}>
            Удалить
          </button>
        ) : null}
      </div>

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

      <label className="course-field">
        <span>Название урока</span>
        <input
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
        <input
          value={summary}
          maxLength={600}
          onChange={(event) => {
            setSummary(event.target.value);
            onDirty();
          }}
          placeholder="Одна строка для содержания курса"
        />
      </label>

      {kind === 'assignment' ? (
        <div className="course-field">
          <span>Практика</span>
          {assignmentId && !assignmentId.startsWith('lav:') ? (
            <p>
              Сохранённое задание: {lesson?.assignmentTitle || 'название недоступно'}. Исходная
              ссылка сохранена.
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

      <label className="course-field course-duration-field">
        <span>Примерное время, минут</span>
        <input
          type="number"
          min={1}
          max={600}
          value={minutes}
          onChange={(event) => {
            setMinutes(event.target.value);
            onDirty();
          }}
          placeholder="15"
        />
      </label>

      <div className="course-editor-actions">
        <span>Изменения сохраняются после нажатия кнопки.</span>
        <button type="submit" className="btn-primary" disabled={!valid}>
          {saving ? 'Сохраняем…' : lesson ? 'Сохранить урок' : 'Добавить урок'}
        </button>
      </div>
    </form>
  );
}

function CoursePreview({
  course,
  sections,
  version,
}: {
  readonly course: Course;
  readonly sections: readonly CourseSection[];
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
    <article className="course-preview-page" data-testid="course-preview-page">
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
  assignments,
  onBack,
  onEditCourse,
  onShare,
  onChanged,
  canTeach,
  onRegisterLeaveGuard,
}: {
  readonly course: Course;
  readonly assignments: readonly LibraryAssignment[];
  readonly onBack: () => void;
  readonly onEditCourse: () => void;
  readonly onShare: () => void;
  readonly onChanged: () => void;
  readonly canTeach: boolean;
  readonly onRegisterLeaveGuard?: (guard: (() => boolean) | null) => void;
}): JSX.Element {
  const [localDirty, setLocalDirty] = useState(false);
  const localDirtyRef = useRef(false);
  const editGeneration = useRef(0);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const markDirty = () => {
    editGeneration.current += 1;
    localDirtyRef.current = true;
    setLocalDirty(true);
  };
  const [sections, setSections] = useState<CourseSection[] | null>(null);
  const [draftRevision, setDraftRevision] = useState(course.draftRevision);
  const draftRevisionRef = useRef(course.draftRevision);
  const revisionRefreshRef = useRef<Promise<boolean> | null>(null);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [newLessonSectionId, setNewLessonSectionId] = useState<string | null>(null);
  const createdLessonIdRef = useRef<string | null>(null);
  const [sectionForm, setSectionForm] = useState<CourseSection | null | 'new'>(null);
  const [preview, setPreview] = useState(false);
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
  const hasWork = localDirty || sectionWork || writing || previewBusy || restoreBusy;
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setSectionWorkState = useCallback((value: boolean) => setSectionWork(value), []);
  function canLeave(): boolean {
    if (writing || publishing || previewBusy || assignBusy || restoreBusy) return false;
    if (localDirtyRef.current || sectionWork)
      return window.confirm(
        'Есть несохранённые изменения курса. Покинуть редактор без сохранения?',
      );
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
      if (localDirtyRef.current && !force) return false;
      const generation = editGeneration.current;
      const result = await api.courseOutline(course.id);
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
    [course.id, course.draftRevision],
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
    if (localDirtyRef.current || sectionWork || writing || publishing || assignBusy) {
      setNotice(null);
      setError('Сначала сохраните изменения урока. Переход не выполнен, данные не потеряны.');
      return;
    }
    action();
  }

  async function act(run: () => MutationResult, done: string): Promise<boolean> {
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

  async function saveLesson(lessonId: string | null, input: CourseLessonInput): Promise<void> {
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
    if (publishing || localDirtyRef.current || sectionWork || writing || lessonCount === 0) return;
    if (revisionRefreshRef.current) {
      setError('Дождитесь обновления содержания курса и повторите публикацию.');
      return;
    }
    setPublishing(true);
    const result = await api.publishCourse(
      course.id,
      draftRevision,
      `course-publish:${course.id}:${draftRevision}`,
    );
    setPublishing(false);
    if (!result.ok) {
      setNotice(null);
      setError(result.error.message);
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
        ? `Версия ${result.data.versionNumber} уже актуальна.`
        : `Курс опубликован: версия ${result.data.versionNumber}.`,
    );
    await loadOutline();
    onChanged();
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
      <section className="course-system" data-testid="course-editor">
        <header className="course-compact-header">
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
              {(sections?.length ?? course.sectionCount) + ' разделов · ' + lessonCount + ' уроков'}
            </p>
          </div>
          <div className="course-header-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => withSavedDraft(onEditCourse)}
            >
              Настройки
            </button>
            {canTeach ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => withSavedDraft(onShare)}
              >
                Доступ
              </button>
            ) : null}
            {course.publicationState !== 'published' ? (
              <button
                type="button"
                className="btn-primary course-publish-button"
                disabled={publishing || hasWork || sectionWork || lessonCount === 0}
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
            <button
              type="button"
              className={preview ? 'btn-primary' : 'btn-secondary'}
              onClick={() =>
                withSavedDraft(() => {
                  setPublishedPreview(null);
                  setPreview((value) => !value);
                })
              }
            >
              {preview ? 'Редактировать' : 'Предпросмотр'}
            </button>
            {course.publishedVersion || publicationReceipt.current ? (
              <button
                type="button"
                className="btn-secondary"
                disabled={hasWork || publishing}
                onClick={() => void showPublished()}
              >
                Опубликованная версия
              </button>
            ) : null}
            {canTeach ? (
              <button
                type="button"
                className="btn-primary"
                disabled={hasWork || publishing || lessonCount === 0}
                onClick={() => void showPublished(true)}
              >
                Назначить курс
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
          <p className="notice-success course-inline-notice" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="form-error course-inline-notice" role="alert">
            {error}
          </p>
        ) : null}

        <AuthorVersionHistory
          kind="course"
          rootId={course.id}
          revision={draftRevision}
          dirty={localDirty || sectionForm !== null || newLessonSectionId !== null}
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
        {course.draftActive && course.draftBaseVersionNumber ? (
          <p>Черновик на основе версии {course.draftBaseVersionNumber}</p>
        ) : null}
        {sections === null ? (
          <p role="status">Загружаем содержание…</p>
        ) : preview ? (
          <CoursePreview
            course={course}
            sections={publishedPreview ? publishedCourseSections(publishedPreview) : sections}
            {...(publishedPreview ? { version: publishedPreview } : {})}
          />
        ) : (
          <div className="course-builder" onChange={markDirty}>
            <aside className="course-outline" aria-label="Содержание курса">
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
                                    api.moveCourseSection(course.id, section.id, -1, draftRevision),
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
                                    api.moveCourseSection(course.id, section.id, 1, draftRevision),
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
                                void act(
                                  () =>
                                    api.setCourseSectionHidden(
                                      course.id,
                                      section.id,
                                      !section.hidden,
                                      draftRevision,
                                    ),
                                  section.hidden ? 'Раздел показан.' : 'Раздел скрыт.',
                                );
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
                                    api.deleteCourseSection(course.id, section.id, draftRevision),
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
                                    void act(
                                      () =>
                                        api.setCourseLessonHidden(
                                          course.id,
                                          lesson.id,
                                          !lesson.hidden,
                                          draftRevision,
                                        ),
                                      lesson.hidden ? 'Урок показан.' : 'Урок скрыт.',
                                    );
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
                                      api.moveCourseLesson(course.id, lesson.id, -1, draftRevision),
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
                                      api.moveCourseLesson(course.id, lesson.id, 1, draftRevision),
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

        {sectionForm ? (
          <SectionFormDialog
            section={sectionForm === 'new' ? null : sectionForm}
            onWorkChange={setSectionWorkState}
            onClose={() => setSectionForm(null)}
            onSave={async (value) => {
              const id = sectionForm === 'new' ? null : sectionForm.id;
              const saved = await act(
                () =>
                  api.saveCourseSection(course.id, id, {
                    ...value,
                    expectedRevision: draftRevision,
                  }),
                id ? 'Раздел сохранён.' : 'Раздел добавлен.',
              );
              if (saved) setSectionForm(null);
            }}
          />
        ) : null}
        {assignVersion && assignmentAttempt.current ? (
          <CourseAssignDialog
            courseId={course.id}
            version={assignVersion}
            attempt={assignmentAttempt.current.value}
            onBusyChange={setAssignBusy}
            onClose={() => setAssignVersion(null)}
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
}: {
  readonly assignments: readonly LibraryAssignment[];
  readonly canTeach: boolean;
  readonly onChanged: () => void;
  readonly onRegisterLeaveGuard?: (guard: (() => boolean) | null) => void;
}): JSX.Element {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [courseForm, setCourseForm] = useState<Course | null | 'new'>(null);
  const [sharing, setSharing] = useState<Course | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const creationRequest = useRef<{ payload: string; id: string } | null>(null);

  const editorGuard = useRef<(() => boolean) | null>(null);
  const [formWork, setFormWork] = useState(false);
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
    const result = await api.listCourses();
    if (result.ok) {
      setCourses(result.data.items);
      setError(null);
    } else {
      setCourses([]);
      setError(result.error.message);
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
  const open =
    courses?.find((course) => course.id === openId && course.archivedAt === null) ?? null;
  if (open) {
    return (
      <>
        {error ? <p role="alert">{error}</p> : null}
        <CourseEditor
          course={open}
          assignments={assignments}
          onBack={() => setOpenId(null)}
          onEditCourse={() => setCourseForm(open)}
          onShare={() => setSharing(open)}
          onChanged={() => void reload()}
          canTeach={canTeach}
          onRegisterLeaveGuard={registerEditorGuard}
        />
        {courseForm ? (
          <CourseFormDialog
            onWorkChange={setFormWorkState}
            course={courseForm === 'new' ? null : courseForm}
            onClose={() => setCourseForm(null)}
            onSave={async (value) => {
              const saved = await act(
                () =>
                  api.saveCourse(open.id, {
                    ...value,
                    expectedRevision:
                      courseForm === 'new' ? open.draftRevision : courseForm.draftRevision,
                  }),
                'Настройки курса сохранены.',
              );
              if (saved) setCourseForm(null);
            }}
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
          onClose={() => setCourseForm(null)}
          onSave={async (value) => {
            const existing = courseForm === 'new' ? null : courseForm;
            const payload = JSON.stringify(value);
            if (creationRequest.current?.payload !== payload)
              creationRequest.current = { payload, id: crypto.randomUUID() };
            const result = await api.saveCourse(existing?.id ?? null, {
              ...value,
              ...(existing ? { expectedRevision: existing.draftRevision } : {}),
              requestId: creationRequest.current.id,
            });
            if (!result.ok) {
              setError(result.error.message);
              return;
            }
            setError(null);
            setNotice(existing ? 'Настройки курса сохранены.' : 'Курс создан.');
            setCourseForm(null);
            creationRequest.current = null;
            await reload();
            if (!existing) setOpenId(result.data.id);
            onChanged();
          }}
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
