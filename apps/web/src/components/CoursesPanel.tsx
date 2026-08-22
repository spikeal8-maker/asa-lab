import { useCallback, useEffect, useMemo, useState, type FormEvent, type JSX } from 'react';
import {
  api,
  visibilityLabel,
  type Course,
  type CourseLesson,
  type CourseLessonInput,
  type CourseSection,
  type LessonBlock,
  type LibraryAssignment,
} from '../api';
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
}: {
  readonly course: Course | null;
  readonly onClose: () => void;
  readonly onSave: (value: CourseFormValue) => Promise<void>;
}): JSX.Element {
  const [title, setTitle] = useState(course?.title ?? '');
  const [summary, setSummary] = useState(course?.summary ?? '');
  const [saving, setSaving] = useState(false);

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
          <button type="button" className="btn-secondary" onClick={onClose}>
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
}: {
  readonly section: CourseSection | null;
  readonly onClose: () => void;
  readonly onSave: (value: { title: string; summary: string | null }) => Promise<void>;
}): JSX.Element {
  const [title, setTitle] = useState(section?.title ?? '');
  const [summary, setSummary] = useState(section?.summary ?? '');
  const [saving, setSaving] = useState(false);

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
          <button type="button" className="btn-secondary" onClick={onClose}>
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
  assignments,
  onSave,
  onDelete,
}: {
  readonly sections: readonly CourseSection[];
  readonly sectionId: string;
  readonly lesson: CourseLesson | null;
  readonly assignments: readonly LibraryAssignment[];
  readonly onSave: (input: CourseLessonInput) => Promise<void>;
  readonly onDelete: (() => Promise<void>) | null;
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
  const [assignmentId, setAssignmentId] = useState(lesson?.assignmentId ?? '');
  const [minutes, setMinutes] = useState(
    lesson?.estimatedMinutes === null || lesson?.estimatedMinutes === undefined
      ? ''
      : String(lesson.estimatedMinutes),
  );
  const [saving, setSaving] = useState(false);
  const activeAssignments = assignments.filter((entry) => entry.archivedAt === null);
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
        assignmentId: kind === 'assignment' ? assignmentId : null,
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
          <select value={targetSection} onChange={(event) => setTargetSection(event.target.value)}>
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
            onChange={(event) => setKind(event.target.value as 'material' | 'assignment')}
          >
            <option value="material">Материал</option>
            <option value="assignment">Задание из банка</option>
          </select>
        </label>
      </div>

      <label className="course-field">
        <span>Название урока</span>
        <input
          value={title}
          maxLength={160}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Короткое и понятное название"
        />
      </label>

      <label className="course-field">
        <span>Что будет в уроке</span>
        <input
          value={summary}
          maxLength={600}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="Одна строка для содержания курса"
        />
      </label>

      {kind === 'assignment' ? (
        <label className="course-field">
          <span>Задание из банка</span>
          <select
            aria-label="Задание из банка"
            value={assignmentId}
            onChange={(event) => {
              setAssignmentId(event.target.value);
              if (!title.trim()) {
                setTitle(
                  activeAssignments.find((entry) => entry.id === event.target.value)?.title ?? '',
                );
              }
            }}
          >
            <option value="">Выберите задание…</option>
            {activeAssignments.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <LessonBlockEditor blocks={blocks} onChange={setBlocks} />

      <label className="course-field course-duration-field">
        <span>Примерное время, минут</span>
        <input
          type="number"
          min={1}
          max={600}
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
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
}: {
  readonly course: Course;
  readonly sections: readonly CourseSection[];
}): JSX.Element {
  let number = 0;
  return (
    <article className="course-preview-page" data-testid="course-preview-page">
      <header>
        <span className="course-eyebrow">Предпросмотр ученика</span>
        <h2>{course.title}</h2>
        {course.summary ? <p>{course.summary}</p> : null}
      </header>
      {sections.map((section) => (
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
                    <LessonBlocks blocks={lesson.blocks} legacyContent={lesson.content} compact />
                    {lesson.assignmentTitle ? (
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

function CourseEditor({
  course,
  assignments,
  onBack,
  onEditCourse,
  onShare,
  onChanged,
}: {
  readonly course: Course;
  readonly assignments: readonly LibraryAssignment[];
  readonly onBack: () => void;
  readonly onEditCourse: () => void;
  readonly onShare: () => void;
  readonly onChanged: () => void;
}): JSX.Element {
  const [sections, setSections] = useState<CourseSection[] | null>(null);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [newLessonSectionId, setNewLessonSectionId] = useState<string | null>(null);
  const [sectionForm, setSectionForm] = useState<CourseSection | null | 'new'>(null);
  const [preview, setPreview] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadOutline = useCallback(async () => {
    const result = await api.courseOutline(course.id);
    if (!result.ok) {
      setSections([]);
      setError(result.error.message);
      return;
    }
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
  }, [course.id]);

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

  async function act(run: () => MutationResult, done: string): Promise<boolean> {
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
  }

  async function saveLesson(input: CourseLessonInput): Promise<void> {
    const lessonId = selected?.lesson.id ?? null;
    const result = await api.saveCourseLesson(course.id, lessonId, input);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setNotice(lessonId ? 'Урок сохранён.' : 'Урок добавлен.');
    setNewLessonSectionId(null);
    setSelectedLessonId(result.data.id);
    await loadOutline();
    onChanged();
  }

  async function deleteLesson(): Promise<void> {
    if (!selected) return;
    if (!window.confirm('Удалить урок «' + selected.lesson.title + '»?')) return;
    const removed = await act(
      () => api.deleteCourseLesson(course.id, selected.lesson.id),
      'Урок удалён.',
    );
    if (removed) setSelectedLessonId(null);
  }

  const lessonCount = (sections ?? []).reduce((sum, section) => sum + section.lessons.length, 0);

  async function publishCourse(): Promise<void> {
    if (publishing || lessonCount === 0) return;
    setPublishing(true);
    const result = await api.publishCourse(course.id);
    setPublishing(false);
    if (!result.ok) {
      setNotice(null);
      setError(result.error.message);
      return;
    }
    setError(null);
    setNotice(
      result.data.reused
        ? `Версия ${result.data.versionNumber} уже актуальна.`
        : `Курс опубликован: версия ${result.data.versionNumber}.`,
    );
    onChanged();
  }

  return (
    <section className="course-system" data-testid="course-editor">
      <header className="course-compact-header">
        <button type="button" className="course-back-button" onClick={onBack}>
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
          <button type="button" className="btn-secondary" onClick={onEditCourse}>
            Настройки
          </button>
          <button type="button" className="btn-secondary" onClick={onShare}>
            Доступ
          </button>
          {course.publicationState !== 'published' ? (
            <button
              type="button"
              className="btn-primary course-publish-button"
              disabled={publishing || lessonCount === 0}
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
            onClick={() => setPreview((value) => !value)}
          >
            {preview ? 'Редактировать' : 'Предпросмотр'}
          </button>
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

      {sections === null ? (
        <p role="status">Загружаем содержание…</p>
      ) : preview ? (
        <CoursePreview course={course} sections={sections} />
      ) : (
        <div className="course-builder">
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
                onClick={() => setSectionForm('new')}
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
                      onClick={() => setSectionForm(section)}
                    >
                      <span>{sectionIndex + 1}</span>
                      <strong>{section.title}</strong>
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
                                () => api.moveCourseSection(course.id, section.id, -1),
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
                                () => api.moveCourseSection(course.id, section.id, 1),
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
                              setSectionForm(section);
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
                                () => api.deleteCourseSection(course.id, section.id),
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
                          onClick={() => {
                            setSelectedLessonId(lesson.id);
                            setNewLessonSectionId(null);
                          }}
                        >
                          <span>{lessonIndex + 1}</span>
                          <span>
                            <strong>{lesson.title}</strong>
                            <small>
                              {lesson.kind === 'assignment' ? 'Задание' : 'Материал'}
                              {lesson.estimatedMinutes
                                ? ' · ' + lesson.estimatedMinutes + ' мин'
                                : ''}
                            </small>
                          </span>
                        </button>
                        {selectedLessonId === lesson.id && !newLessonSectionId ? (
                          <div className="course-lesson-order" aria-label="Порядок урока">
                            <button
                              type="button"
                              disabled={lessonIndex === 0}
                              aria-label={'Выше: ' + lesson.title}
                              onClick={() =>
                                void act(
                                  () => api.moveCourseLesson(course.id, lesson.id, -1),
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
                                  () => api.moveCourseLesson(course.id, lesson.id, 1),
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
                    onClick={() => {
                      setSelectedLessonId(null);
                      setNewLessonSectionId(section.id);
                    }}
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
                onSave={saveLesson}
                onDelete={null}
              />
            ) : selected ? (
              <LessonEditor
                key={selected.lesson.id + '-' + selected.lesson.position}
                sections={sections}
                sectionId={selected.section.id}
                lesson={selected.lesson}
                assignments={assignments}
                onSave={saveLesson}
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
                  onClick={() => setNewLessonSectionId(sections[0]?.id ?? null)}
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
          onClose={() => setSectionForm(null)}
          onSave={async (value) => {
            const id = sectionForm === 'new' ? null : sectionForm.id;
            const saved = await act(
              () => api.saveCourseSection(course.id, id, value),
              id ? 'Раздел сохранён.' : 'Раздел добавлен.',
            );
            if (saved) setSectionForm(null);
          }}
        />
      ) : null}
    </section>
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
  onChanged,
}: {
  readonly assignments: readonly LibraryAssignment[];
  readonly onChanged: () => void;
}): JSX.Element {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [courseForm, setCourseForm] = useState<Course | null | 'new'>(null);
  const [sharing, setSharing] = useState<Course | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingDemo, setCreatingDemo] = useState(false);

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

  const open = courses?.find((course) => course.id === openId) ?? null;
  if (open) {
    return (
      <>
        <CourseEditor
          course={open}
          assignments={assignments}
          onBack={() => setOpenId(null)}
          onEditCourse={() => setCourseForm(open)}
          onShare={() => setSharing(open)}
          onChanged={() => void reload()}
        />
        {courseForm ? (
          <CourseFormDialog
            course={courseForm === 'new' ? null : courseForm}
            onClose={() => setCourseForm(null)}
            onSave={async (value) => {
              const saved = await act(
                () => api.saveCourse(open.id, value),
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
          <span>Собирайте уроки и материалы, а назначайте их уже внутри класса.</span>
        </div>
        <div className="courses-toolbar-actions">
          <button
            type="button"
            className="btn-secondary"
            disabled={creatingDemo}
            onClick={() => void ensureDemoCourse()}
          >
            {creatingDemo ? 'Добавляем…' : 'Добавить демо-курс'}
          </button>
          <button
            type="button"
            className="portal-create-button"
            onClick={() => setCourseForm('new')}
          >
            Создать курс
          </button>
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
      ) : courses.length === 0 ? (
        <div className="course-list-empty">
          <span aria-hidden="true">＋</span>
          <div>
            <h3>Создайте первый курс</h3>
            <p>Разделы задают порядок, уроки объединяют объяснение и практику.</p>
          </div>
          <div className="course-list-empty-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={creatingDemo}
              onClick={() => void ensureDemoCourse()}
            >
              {creatingDemo ? 'Добавляем…' : 'Посмотреть готовый пример'}
            </button>
            <button type="button" className="btn-primary" onClick={() => setCourseForm('new')}>
              Создать свой курс
            </button>
          </div>
        </div>
      ) : (
        <ul className="courses-list" data-testid="courses-list">
          {courses.map((course) => (
            <li key={course.id}>
              <button
                type="button"
                className="course-row-main"
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
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        setSharing(course);
                      }}
                    >
                      Кому видно
                    </button>
                    <button
                      type="button"
                      className="is-danger"
                      onClick={() => {
                        close();
                        if (!window.confirm('Удалить курс «' + course.title + '»?')) return;
                        void act(
                          () => api.deleteCourse(course.id),
                          'Курс «' + course.title + '» удалён.',
                        );
                      }}
                    >
                      Удалить
                    </button>
                  </>
                )}
              </Dropdown>
            </li>
          ))}
        </ul>
      )}

      {courseForm ? (
        <CourseFormDialog
          course={courseForm === 'new' ? null : courseForm}
          onClose={() => setCourseForm(null)}
          onSave={async (value) => {
            const existing = courseForm === 'new' ? null : courseForm;
            const result = await api.saveCourse(existing?.id ?? null, value);
            if (!result.ok) {
              setError(result.error.message);
              return;
            }
            setError(null);
            setNotice(existing ? 'Настройки курса сохранены.' : 'Курс создан.');
            setCourseForm(null);
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
