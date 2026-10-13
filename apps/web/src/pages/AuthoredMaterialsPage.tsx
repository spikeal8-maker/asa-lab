import { AuthorVersionHistory } from '../components/AuthorVersionHistory';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  type AuthoredActivityDraft,
  type AuthoredActivityLearnerPreview,
  type Classroom,
  type ModuleSummary,
} from '../api';
import { AssignmentView } from '../components/AssignmentView';
import { AuthoredTaskBlocksEditor } from '../components/AuthoredTaskBlocksEditor';

async function readDraftImage(file: File): Promise<string> {
  const reader = new FileReader();
  return new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение.'));
    reader.readAsDataURL(file);
  });
}

function checkDraftImage(file: File): string | null {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    return 'Подойдёт PNG, JPEG или WebP.';
  }
  if (file.size < 1 || file.size > 400_000) {
    return 'Картинка должна быть до 400 КБ.';
  }
  return null;
}

function checkTaskPdf(file: File): string | null {
  if (file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf'))
    return 'Подойдёт файл PDF.';
  if (file.size < 5 || file.size > 400_000) return 'PDF должен быть до 400 КБ.';
  if (
    file.name.length > 160 ||
    file.name.includes('/') ||
    file.name.includes('\\') ||
    Array.from(file.name).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    return 'Проверьте имя PDF файла.';
  return null;
}

const initial: AuthoredActivityDraft = {
  title: '',
  goal: null,
  instructions: '',
  moduleKey: null,
  resultMode: 'completion',
  maxPoints: null,
  policies: {
    attemptPolicy: { maxAttempts: 1 },
    resultSelectionPolicy: { mode: 'latest_accepted' },
    completionPolicy: { mode: 'accepted' },
    latePolicy: { mode: 'allow_until_close' },
    assessmentPolicy: { mode: 'manual' },
    feedbackReleasePolicy: { mode: 'immediate' },
  },
};

function isAssignableModule(module: ModuleSummary): boolean {
  return module.creatable && module.learningCapabilities?.assignable === true;
}

function LearnerPreviewPanel({
  preview,
  modules,
}: {
  readonly preview: AuthoredActivityLearnerPreview;
  readonly modules: readonly ModuleSummary[];
}) {
  const maxAttempts = (preview.policies['attemptPolicy'] as Record<string, unknown> | null)?.[
    'maxAttempts'
  ];
  const lateMode = String(
    (preview.policies['latePolicy'] as Record<string, unknown> | null)?.['mode'] ?? '',
  );
  const lateLabel =
    lateMode === 'allow_until_close'
      ? 'Можно сдать до закрытия задания'
      : lateMode === 'block_at_due'
        ? 'Сдача после срока запрещена'
        : lateMode === 'allow_mark_late'
          ? 'Можно сдать с отметкой опоздания'
          : 'По правилам задания';
  const sourceLabel =
    preview.source.kind === 'draft'
      ? `Сохранённый черновик r${preview.source.draftRevision ?? '?'}`
      : `Опубликованная версия ${preview.source.versionNumber ?? '?'}`;
  const resultLabel =
    preview.resultMode === 'graded'
      ? 'Баллы'
      : preview.resultMode === 'completion'
        ? 'Выполнение'
        : 'Без оценки';
  return (
    <article aria-label="Предпросмотр как ученик" data-testid="learner-preview">
      <p className="account-hint">{sourceLabel} · только чтение.</p>
      <h3>{preview.assignment.title}</h3>
      <AssignmentView assignment={preview.assignment} />
      <dl>
        <div>
          <dt>Среда</dt>
          <dd>
            {preview.moduleKey === null
              ? 'Без редактора проекта'
              : (modules.find((module) => module.moduleKey === preview.moduleKey)?.displayName ??
                preview.moduleKey)}
          </dd>
        </div>
        <div>
          <dt>Результат</dt>
          <dd>
            {resultLabel}
            {preview.maxPoints === null ? '' : ` · макс. ${preview.maxPoints}`}
          </dd>
        </div>
        <div>
          <dt>Попыток</dt>
          <dd>
            {typeof maxAttempts === 'number' && Number.isFinite(maxAttempts)
              ? maxAttempts
              : 'По правилам задания'}
          </dd>
        </div>
        <div>
          <dt>После срока</dt>
          <dd>{lateLabel}</dd>
        </div>
      </dl>
      <p className="account-hint">
        Здесь можно прочитать задание. Запуск и сдача доступны только при прохождении.
      </p>
    </article>
  );
}

interface AssignmentAttempt {
  selected: Set<string>;
  dueDate: string;
  submittedDueAt: string | null | undefined;
  completed: Map<string, number>;
  requestIds: Map<string, string>;
}

interface PendingTaskMedia {
  role: 'image' | 'file';
  name: string;
  dataUrl: string;
}

function newAssignmentAttempt(): AssignmentAttempt {
  return {
    selected: new Set(),
    dueDate: '',
    submittedDueAt: undefined,
    completed: new Map(),
    requestIds: new Map(),
  };
}

function AssignmentAssignDialog({
  title,
  versionId,
  attempt,
  onClose,
  onAssigned,
}: {
  readonly title: string;
  readonly versionId: string;
  readonly attempt: AssignmentAttempt;
  readonly onClose: () => void;
  readonly onAssigned: (message: string) => void;
}): JSX.Element {
  const [classrooms, setClassrooms] = useState<Classroom[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(attempt.selected);
  const [dueDate, setDueDate] = useState(attempt.dueDate);
  const [submittedDueAt, setSubmittedDueAt] = useState<string | null | undefined>(
    attempt.submittedDueAt,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.listClassrooms().then((result) => {
      if (!active) return;
      if (result.ok) setClassrooms(result.data.items.filter((item) => item.archivedAt === null));
      else {
        setClassrooms([]);
        setError(result.error.message || 'Классы временно недоступны.');
      }
    });
    return () => {
      active = false;
    };
  }, []);

  async function assign(): Promise<void> {
    if (busy || selected.size === 0) return;
    setBusy(true);
    setError(null);
    // An idempotent retry must repeat the same dueAt for every classroom.
    const dueAt =
      submittedDueAt === undefined
        ? dueDate
          ? new Date(`${dueDate}T23:59:59`).toISOString()
          : null
        : submittedDueAt;
    if (submittedDueAt === undefined) {
      attempt.submittedDueAt = dueAt;
      setSubmittedDueAt(dueAt);
    }
    const targets = [...selected].filter((id) => !attempt.completed.has(id));
    for (const classroomId of targets) {
      let requestId = attempt.requestIds.get(classroomId);
      if (!requestId) {
        requestId = crypto.randomUUID();
        attempt.requestIds.set(classroomId, requestId);
      }
      const result = await api.assignLearningActivity(classroomId, {
        activityVersionId: versionId,
        audienceType: 'whole_class',
        seatIds: [],
        dueAt,
        requestId,
      });
      if (!result.ok) {
        const done = attempt.completed.size;
        setError(
          done > 0
            ? `Назначено в ${done} из ${selected.size} классов. Для остальных повторите назначение. ${result.error.message || ''}`
            : result.error.message || 'Не удалось назначить задание. Повторите попытку.',
        );
        setBusy(false);
        return;
      }
      attempt.completed.set(classroomId, result.data.assignedCount);
    }
    setBusy(false);
    const assigned = [...attempt.completed.values()].reduce((sum, value) => sum + value, 0);
    onAssigned(
      attempt.completed.size === 1
        ? `Задание назначено. Учеников: ${assigned}.`
        : `Задание назначено в классы: ${attempt.completed.size}. Учеников: ${assigned}.`,
    );
  }

  return (
    <div className="teacher-overlay-backdrop" role="presentation">
      <section
        className="teacher-assign-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assign-dialog-title"
      >
        <header>
          <div>
            <span>Назначение</span>
            <h2 id="assign-dialog-title">{title || 'Задание'}</h2>
          </div>
          <button
            type="button"
            className="teacher-icon-button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="teacher-assign-body">
          <fieldset>
            <legend>Кому</legend>
            {classrooms === null ? (
              <p role="status">Загружаем классы…</p>
            ) : classrooms.length === 0 ? (
              <p className="teacher-muted">Нет активных классов.</p>
            ) : (
              <div className="teacher-class-picker">
                {classrooms.map((classroom) => (
                  <label key={classroom.id}>
                    <input
                      type="checkbox"
                      checked={selected.has(classroom.id)}
                      disabled={attempt.completed.has(classroom.id)}
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(classroom.id);
                          else next.delete(classroom.id);
                          attempt.selected = next;
                          return next;
                        })
                      }
                    />
                    <span>
                      <strong>{classroom.title}</strong>
                      <small>
                        {attempt.completed.has(classroom.id)
                          ? 'Назначено'
                          : `${classroom.studentCount} учеников`}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <label className="teacher-field">
            <span>Срок</span>
            <input
              type="date"
              value={dueDate}
              disabled={busy || submittedDueAt !== undefined}
              onChange={(event) => {
                attempt.dueDate = event.target.value;
                setDueDate(event.target.value);
              }}
            />
            <small>
              {submittedDueAt === undefined
                ? 'Можно оставить пустым.'
                : 'Срок закреплён для повторной попытки.'}
            </small>
          </label>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || selected.size === 0}
            onClick={() => void assign()}
          >
            {busy ? 'Назначаем…' : 'Назначить'}
          </button>
        </footer>
      </section>
    </div>
  );
}

/** One authoring surface for authors and educators; it never reads a roster. */
export function AuthoredMaterialsPage({
  embedded = false,
  onChanged,
  onRegisterLeaveGuard,
}: {
  readonly embedded?: boolean;
  readonly onChanged?: () => void;
  readonly onRegisterLeaveGuard?: (guard: (() => boolean) | null) => void;
}): JSX.Element {
  const [items, setItems] = useState<
    { id: string; title: string; draftRevision: number; currentPublishedVersionId: string | null }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [modules, setModules] = useState<readonly ModuleSummary[]>([]);
  const [modulesLoading, setModulesLoading] = useState(true);
  const assignableModules = modules.filter(isAssignableModule);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<AuthoredActivityDraft>(initial);
  const [inheritedGoal, setInheritedGoal] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ id: string; revision: number } | null>(null);
  const [openedKind, setOpenedKind] = useState<string | null>(null);
  const [publishedVersionId, setPublishedVersionId] = useState<string | null>(null);
  const [draftSampleImage, setDraftSampleImage] = useState<string | null>(null);
  const [pendingDraftSample, setPendingDraftSample] = useState<string | null>(null);
  const [pendingTaskMedia, setPendingTaskMedia] = useState<PendingTaskMedia[]>([]);
  const [preview, setPreview] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; data: AuthoredActivityLearnerPreview }
    | { kind: 'error'; message: string }
    | null
  >(null);
  const [search, setSearch] = useState('');
  const [screen, setScreen] = useState<'list' | 'editor'>(embedded ? 'list' : 'editor');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'published'>('all');
  const [panel, setPanel] = useState<'settings' | 'preview' | 'history' | null>(null);
  const [assignVersionId, setAssignVersionId] = useState<string | null>(null);
  const assignmentAttempt = useRef<{ versionId: string; value: AssignmentAttempt } | null>(null);
  const request = useRef<{ payload: string; id: string } | null>(null);
  const savedPayload = useRef<string | null>(null);
  const previewRequest = useRef(0);
  const modulesRequest = useRef(0);
  useEffect(() => {
    previewRequest.current += 1;
    setPreview(null);
  }, [draft, opened, publishedVersionId, draftSampleImage, pendingDraftSample]);
  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await api.authoredActivities();
    if (result.ok) setItems(result.data.items);
    else setError(result.error.message || 'Материалы временно недоступны.');
    setLoading(false);
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const refreshModules = useCallback(async () => {
    const requestId = ++modulesRequest.current;
    setModulesLoading(true);
    const result = await api.listModules();
    if (requestId === modulesRequest.current) {
      if (result.ok) {
        setModules(result.data.items);
      } else {
        setModules([]);
        setError(result.error.message || 'Список учебных сред недоступен.');
      }
      setModulesLoading(false);
    }
  }, []);
  useEffect(() => {
    if (embedded && screen === 'list') return;
    void refreshModules();
    return () => {
      modulesRequest.current += 1;
    };
  }, [embedded, refreshModules, screen]);
  async function open(id: string) {
    previewRequest.current += 1;
    setPreview(null);
    setPanel(null);
    setAssignVersionId(null);
    assignmentAttempt.current = null;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await api.authoredActivity(id);
    if (result.ok) {
      const value = result.data.draft;
      setOpened({ id, revision: result.data.draftRevision });
      setOpenedKind(result.data.kind ?? (value.moduleKey === null ? 'manual' : 'project'));
      setPublishedVersionId(result.data.currentPublishedVersionId);
      setDraftSampleImage(result.data.draftSampleImage);
      setInheritedGoal(result.data.inheritedGoal);
      setPendingDraftSample(null);
      setPendingTaskMedia([]);
      const loaded: AuthoredActivityDraft = {
        title: value.title,
        // A legacy teacher-source draft may have no goal key. Keep that
        // absence until the author edits the goal, so another field's save
        // still inherits the teacher goal when the version is published.
        ...('goal' in value ? { goal: value.goal } : {}),
        ...('blocks' in value ? { blocks: value.blocks } : {}),
        instructions: value.instructions,
        resultMode: value.resultMode,
        maxPoints: value.maxPoints,
        moduleKey: value.moduleKey,
        policies: value.policies,
        quizVersionId: value.quizVersionId ?? null,
        starterProjectVersionId: value.starterProjectVersionId ?? null,
      };
      setDraft(loaded);
      savedPayload.current = JSON.stringify(loaded);
      setPreview(null);
      setScreen('editor');
    } else setError(result.error.message || 'Материал недоступен.');
    setBusy(false);
  }
  function startNew(): void {
    previewRequest.current += 1;
    setPreview(null);
    setPanel(null);
    setAssignVersionId(null);
    assignmentAttempt.current = null;
    setOpened(null);
    setOpenedKind(null);
    setPublishedVersionId(null);
    savedPayload.current = null;
    setDraftSampleImage(null);
    setPendingDraftSample(null);
    setPendingTaskMedia([]);
    setDraft(initial);
    setInheritedGoal(null);
    setNotice(null);
    setError(null);
    setScreen('editor');
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (busy || !draft.title.trim() || (!opened && !canSaveDraftModule)) return null;
    if (
      !opened &&
      draft.moduleKey === null &&
      !window.confirm(
        'Сохранить как материал для курса без проектной среды? Для назначаемой практики сначала выберите среду в настройках.',
      )
    )
      return null;
    const payload = JSON.stringify(draft);
    const textDirty = !opened || savedPayload.current !== payload;
    if (!textDirty && pendingDraftSample === null && pendingTaskMedia.length === 0) return opened;

    setBusy(true);
    setError(null);
    setNotice(null);

    let saved = opened;
    if (textDirty) {
      if (!opened && (!request.current || request.current.payload !== payload)) {
        request.current = { payload, id: crypto.randomUUID() };
      }
      const result = opened
        ? await api.saveAuthoredActivity(opened.id, opened.revision, draft)
        : await api.createActivityDraft(draft, request.current!.id);
      if (!result.ok) {
        setError(
          result.error.code?.includes('conflict')
            ? 'Материал изменён в другом окне. Откройте актуальную редакцию из списка.'
            : result.error.message,
        );
        setBusy(false);
        return null;
      }
      saved = { id: result.data.id, revision: result.data.draftRevision };
      setOpened(saved);
      if (!opened) setOpenedKind(draft.moduleKey === null ? 'manual' : 'project');
      savedPayload.current = payload;
      request.current = null;
    }

    if (!saved) {
      setBusy(false);
      return null;
    }

    if (pendingDraftSample !== null) {
      const imageResult = await api.saveAuthoredActivityDraftSample(
        saved.id,
        saved.revision,
        pendingDraftSample,
      );
      if (!imageResult.ok) {
        setError(
          imageResult.error.code === 'revision_conflict'
            ? 'Материал изменён в другом окне. Откройте актуальную редакцию из списка.'
            : imageResult.error.message,
        );
        setBusy(false);
        return null;
      }
      saved = { id: saved.id, revision: imageResult.data.draftRevision };
      setOpened(saved);
      setDraftSampleImage(imageResult.data.url);
      setPendingDraftSample(null);
    }

    let savedDraft = draft;
    for (const media of pendingTaskMedia) {
      const mediaResult: Awaited<ReturnType<typeof api.saveAuthoredActivityTaskImage>> =
        media.role === 'image'
          ? await api.saveAuthoredActivityTaskImage(saved.id, saved.revision, media.dataUrl)
          : await api.saveAuthoredActivityTaskFile(
              saved.id,
              saved.revision,
              media.name,
              media.dataUrl,
            );
      if (!mediaResult.ok) {
        setError(
          mediaResult.error.code === 'revision_conflict'
            ? 'Материал изменён в другом окне. Откройте актуальную редакцию из списка.'
            : mediaResult.error.message,
        );
        setBusy(false);
        return null;
      }
      const block =
        media.role === 'image'
          ? ({
              type: 'image',
              alt: 'Изображение задания',
              contentHash: mediaResult.data.contentHash,
            } as const)
          : ({
              type: 'file',
              name: media.name,
              contentHash: mediaResult.data.contentHash,
            } as const);
      const blocks = savedDraft.blocks ?? [];
      savedDraft = {
        ...savedDraft,
        blocks: blocks.some((item) => item.type === media.role)
          ? blocks.map((item) => (item.type === media.role ? block : item))
          : [...blocks, block],
      };
      saved = { id: saved.id, revision: mediaResult.data.draftRevision };
      setOpened(saved);
      setDraft(savedDraft);
      savedPayload.current = JSON.stringify(savedDraft);
      setPendingTaskMedia((current) => current.filter((item) => item.role !== media.role));
    }

    setPreview(null);
    setNotice('Черновик сохранён. Публикация — отдельное действие.');
    await refresh();
    onChanged?.();
    setBusy(false);
    return saved;
  }

  async function pickDraftSample(file: File) {
    const problem = checkDraftImage(file);
    if (problem) {
      setError(problem);
      return;
    }
    try {
      const dataUrl = await readDraftImage(file);
      setPendingDraftSample(dataUrl);
      setPreview(null);
      setError(null);
      setNotice(null);
    } catch (readError) {
      setError(
        readError instanceof Error ? readError.message : 'Не удалось прочитать изображение.',
      );
    }
  }

  async function uploadTaskImage(file: File) {
    const problem = checkDraftImage(file);
    if (problem) {
      setError(problem);
      return;
    }
    if (!opened) {
      try {
        const dataUrl = await readDraftImage(file);
        setPendingTaskMedia((current) => [
          ...current.filter((item) => item.role !== 'image'),
          { role: 'image', name: file.name, dataUrl },
        ]);
        setError(null);
        setNotice(null);
      } catch (readError) {
        setError(
          readError instanceof Error ? readError.message : 'Не удалось прочитать изображение.',
        );
      }
      return;
    }
    const saved = await save();
    if (!saved) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const imageDataUrl = await readDraftImage(file);
      const result = await api.saveAuthoredActivityTaskImage(
        saved.id,
        saved.revision,
        imageDataUrl,
      );
      if (!result.ok) {
        setError(
          result.error.code === 'revision_conflict'
            ? 'Материал изменён в другом окне. Откройте актуальную редакцию из списка.'
            : result.error.message,
        );
        return;
      }
      const blocks = draft.blocks ?? [];
      const nextBlocks = blocks.some((block) => block.type === 'image')
        ? blocks.map((block) =>
            block.type === 'image' ? { ...block, contentHash: result.data.contentHash } : block,
          )
        : [
            ...blocks,
            {
              type: 'image' as const,
              alt: 'Изображение задания',
              contentHash: result.data.contentHash,
            },
          ];
      const nextDraft = { ...draft, blocks: nextBlocks };
      setDraft(nextDraft);
      savedPayload.current = JSON.stringify(nextDraft);
      setOpened({ id: saved.id, revision: result.data.draftRevision });
      setPreview(null);
      setNotice('Изображение добавлено в содержание задания.');
      await refresh();
      onChanged?.();
    } catch (readError) {
      setError(
        readError instanceof Error ? readError.message : 'Не удалось прочитать изображение.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function uploadTaskFile(file: File) {
    const problem = checkTaskPdf(file);
    if (problem) {
      setError(problem);
      return;
    }
    if (!opened) {
      try {
        const dataUrl = await readDraftImage(file);
        setPendingTaskMedia((current) => [
          ...current.filter((item) => item.role !== 'file'),
          { role: 'file', name: file.name, dataUrl },
        ]);
        setError(null);
        setNotice(null);
      } catch (readError) {
        setError(readError instanceof Error ? readError.message : 'Не удалось прочитать PDF.');
      }
      return;
    }
    const saved = await save();
    if (!saved) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const fileDataUrl = await readDraftImage(file);
      const result = await api.saveAuthoredActivityTaskFile(
        saved.id,
        saved.revision,
        file.name,
        fileDataUrl,
      );
      if (!result.ok) {
        setError(
          result.error.code === 'revision_conflict'
            ? 'Материал изменён в другом окне. Откройте актуальную редакцию из списка.'
            : result.error.message,
        );
        return;
      }
      const blocks = draft.blocks ?? [];
      const nextBlocks = blocks.some((block) => block.type === 'file')
        ? blocks.map((block) =>
            block.type === 'file'
              ? { ...block, name: file.name, contentHash: result.data.contentHash }
              : block,
          )
        : [
            ...blocks,
            { type: 'file' as const, name: file.name, contentHash: result.data.contentHash },
          ];
      const nextDraft = { ...draft, blocks: nextBlocks };
      setDraft(nextDraft);
      savedPayload.current = JSON.stringify(nextDraft);
      setOpened({ id: saved.id, revision: result.data.draftRevision });
      setPreview(null);
      setNotice('PDF добавлен в содержание задания.');
      await refresh();
      onChanged?.();
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : 'Не удалось прочитать PDF.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteDraftSample() {
    if (busy) return;
    if (!opened || draftSampleImage === null) {
      setPendingDraftSample(null);
      setDraftSampleImage(null);
      setPreview(null);
      setError(null);
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await api.deleteAuthoredActivityDraftSample(opened.id, opened.revision);
    if (!result.ok) {
      setError(
        result.error.code === 'revision_conflict'
          ? 'Материал изменён в другом окне. Откройте актуальную редакцию из списка.'
          : result.error.message,
      );
      setBusy(false);
      return;
    }
    setOpened({ id: opened.id, revision: result.data.draftRevision });
    setDraftSampleImage(null);
    setPendingDraftSample(null);
    setPreview(null);
    setNotice('Изображение удалено.');
    await refresh();
    onChanged?.();
    setBusy(false);
  }
  async function publish(): Promise<string | null> {
    if (!canPublish) return null;
    const saved = await save();
    if (!saved) return null;
    setBusy(true);
    const result = await api.publishAuthoredActivity(
      saved.id,
      saved.revision,
      'publish:' + saved.id + ':' + saved.revision,
    );
    if (result.ok) {
      setPublishedVersionId(result.data.id);
      setPreview(null);
      setNotice(
        'Опубликована версия ' + result.data.versionNumber + '. Материал остаётся закрытым.',
      );
      await open(saved.id);
      setNotice(
        'Опубликована версия ' + result.data.versionNumber + '. Материал остаётся закрытым.',
      );
      await refresh();
      onChanged?.();
      setBusy(false);
      return result.data.id;
    }
    setError(result.error.message);
    setBusy(false);
    return null;
  }
  async function previewAsLearner(source: 'draft' | 'published') {
    if (!opened) {
      setPreview({ kind: 'error', message: 'Сначала сохраните материал.' });
      return;
    }
    if (
      source === 'draft' &&
      (savedPayload.current !== JSON.stringify(draft) || pendingDraftSample !== null)
    ) {
      setPreview({
        kind: 'error',
        message: 'Сохраните текущие изменения, чтобы предпросмотр черновика был точным.',
      });
      return;
    }
    if (source === 'published' && !publishedVersionId) {
      setPreview({ kind: 'error', message: 'Пока нет опубликованной версии.' });
      return;
    }
    setPreview({ kind: 'loading' });
    const requestId = ++previewRequest.current;
    const result =
      source === 'draft'
        ? await api.previewAuthoredActivityDraft(opened.id, opened.revision)
        : await api.previewAuthoredActivityVersion(opened.id, publishedVersionId!);
    if (requestId !== previewRequest.current) return;
    if (result.ok) {
      setPreview({ kind: 'ready', data: result.data });
      return;
    }
    setPreview({
      kind: 'error',
      message:
        result.error.code === 'preview_revision_conflict'
          ? 'Сохранённая ревизия изменилась. Откройте материал заново.'
          : result.status === 401
            ? 'Сессия завершена. Войдите снова, чтобы открыть предпросмотр.'
            : result.error.message || 'Предпросмотр недоступен.',
    });
  }

  async function openPreviewFlow(): Promise<void> {
    setPanel('preview');
    if (!opened) {
      setPreview({ kind: 'error', message: 'Сначала сохраните задание.' });
      return;
    }
    if (draftDirty) {
      setPreview({
        kind: 'error',
        message: 'Сохраните текущие изменения, чтобы предпросмотр был точным.',
      });
      return;
    }
    await previewAsLearner('draft');
  }

  async function openAssignFlow(): Promise<void> {
    const needsPublish =
      !publishedVersionId ||
      opened === null ||
      savedPayload.current !== JSON.stringify(draft) ||
      pendingDraftSample !== null ||
      pendingTaskMedia.length > 0;
    const saved = await save();
    if (!saved) return;

    let versionId = publishedVersionId;
    if (needsPublish) {
      setBusy(true);
      const result = await api.publishAuthoredActivity(
        saved.id,
        saved.revision,
        'assign-publish:' + saved.id + ':' + saved.revision,
      );
      setBusy(false);
      if (!result.ok) {
        setError(result.error.message || 'Не удалось подготовить версию для назначения.');
        return;
      }
      versionId = result.data.id;
      setPublishedVersionId(result.data.id);
      setNotice('Для назначения создана опубликованная версия ' + result.data.versionNumber + '.');
      await refresh();
      onChanged?.();
    }

    if (versionId) {
      if (assignmentAttempt.current?.versionId !== versionId) {
        assignmentAttempt.current = { versionId, value: newAssignmentAttempt() };
      }
      setAssignVersionId(versionId);
    }
  }

  function policy(key: keyof AuthoredActivityDraft['policies'], value: Record<string, unknown>) {
    setDraft((current) => ({
      ...current,
      policies: { ...current.policies, [key]: value },
    }));
  }
  const draftDirty =
    (opened !== null && savedPayload.current !== JSON.stringify(draft)) ||
    pendingDraftSample !== null ||
    pendingTaskMedia.length > 0;
  const canAssignDraftModule =
    !modulesLoading &&
    (openedKind === null || openedKind === 'project') &&
    draft.moduleKey !== null &&
    assignableModules.some((module) => module.moduleKey === draft.moduleKey);
  const canSaveDraftModule = draft.moduleKey === null || canAssignDraftModule;
  const canPublish = draft.moduleKey === null ? opened !== null : canAssignDraftModule;
  const displayedDraftSample = pendingDraftSample ?? draftSampleImage;
  const normalizedSearch = search.trim().toLocaleLowerCase('ru-RU');
  const publishedCount = items.filter((item) => item.currentPublishedVersionId !== null).length;
  const visibleItems = items.filter((item) => {
    const matchesSearch =
      normalizedSearch.length === 0 ||
      item.title.toLocaleLowerCase('ru-RU').includes(normalizedSearch);
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'published' && item.currentPublishedVersionId !== null) ||
      (statusFilter === 'draft' && item.currentPublishedVersionId === null);
    return matchesSearch && matchesStatus;
  });
  const newDraftDirty =
    opened === null &&
    (JSON.stringify(draft) !== JSON.stringify(initial) ||
      pendingDraftSample !== null ||
      pendingTaskMedia.length > 0);
  const hasUnsavedEditorChanges = opened === null ? newDraftDirty : draftDirty;

  function canLeaveEditor(): boolean {
    if (screen !== 'editor') return true;
    if (busy) return false;
    if (hasUnsavedEditorChanges) {
      return window.confirm('Есть несохранённые изменения. Покинуть редактор без сохранения?');
    }
    if (assignmentAttempt.current?.value.submittedDueAt !== undefined) {
      return window.confirm(
        'Назначение не завершено. Вернитесь к нему и повторите попытку, чтобы не создать дубликат. Всё равно покинуть редактор?',
      );
    }
    return true;
  }

  useEffect(() => {
    if (!onRegisterLeaveGuard) return;
    onRegisterLeaveGuard(canLeaveEditor);
    return () => onRegisterLeaveGuard(null);
  });

  useEffect(() => {
    if (
      screen !== 'editor' ||
      (!hasUnsavedEditorChanges &&
        !busy &&
        assignmentAttempt.current?.value.submittedDueAt === undefined)
    )
      return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [screen, hasUnsavedEditorChanges, busy, assignVersionId]);

  function returnToList(): void {
    if (!canLeaveEditor()) return;
    previewRequest.current += 1;
    setPreview(null);
    setPanel(null);
    setAssignVersionId(null);
    setError(null);
    setNotice(null);
    setScreen('list');
  }

  const Root = embedded ? 'section' : 'main';

  if (embedded && screen === 'list') {
    return (
      <Root className="authored-materials authored-assignment-list" aria-label="Задания">
        <section className="authored-assignment-workspace" aria-label="Список заданий">
          <div className="authored-assignment-toolbar" aria-label="Поиск и фильтры заданий">
            <label className="authored-assignment-search">
              <span className="sr-only">Поиск заданий</span>
              <input
                type="search"
                placeholder="Найти задание"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>

            <div
              className="authored-assignment-filter-group"
              role="group"
              aria-label="Фильтр по статусу"
            >
              <button
                type="button"
                className={`authored-assignment-filter${statusFilter === 'all' ? ' is-active' : ''}`}
                aria-pressed={statusFilter === 'all'}
                onClick={() => setStatusFilter('all')}
              >
                Все <span>{items.length}</span>
              </button>
              <button
                type="button"
                className={`authored-assignment-filter${statusFilter === 'draft' ? ' is-active' : ''}`}
                aria-pressed={statusFilter === 'draft'}
                onClick={() => setStatusFilter('draft')}
              >
                Черновики <span>{items.length - publishedCount}</span>
              </button>
              <button
                type="button"
                className={`authored-assignment-filter${statusFilter === 'published' ? ' is-active' : ''}`}
                aria-pressed={statusFilter === 'published'}
                onClick={() => setStatusFilter('published')}
              >
                Опубликованные <span>{publishedCount}</span>
              </button>
            </div>

            <button
              type="button"
              className="portal-create-button authored-assignment-create"
              disabled={busy}
              onClick={startNew}
            >
              + Новое задание
            </button>
          </div>

          {error ? (
            <div className="authored-assignment-state is-error" role="alert">
              <strong>Не удалось загрузить задания.</strong>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setError(null);
                  void refresh();
                }}
              >
                Повторить
              </button>
            </div>
          ) : loading ? (
            <div className="authored-assignment-state" role="status">
              Загружаем задания…
            </div>
          ) : items.length === 0 ? (
            <div className="authored-assignment-state">
              <strong>Заданий пока нет.</strong>
              <span>Создайте первое задание.</span>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="authored-assignment-state">
              <strong>Ничего не найдено.</strong>
              <span>Измените запрос или фильтр.</span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setSearch('');
                  setStatusFilter('all');
                }}
              >
                Сбросить
              </button>
            </div>
          ) : (
            <div className="authored-assignment-table">
              <div className="authored-assignment-columns" aria-hidden="true">
                <span>Задание</span>
                <span>Статус</span>
                <span />
              </div>
              <ul className="authored-assignment-rows">
                {visibleItems.map((item) => {
                  const published = item.currentPublishedVersionId !== null;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="authored-assignment-row"
                        disabled={busy}
                        aria-label={`Открыть задание «${item.title}»`}
                        onClick={() => void open(item.id)}
                      >
                        <span className="authored-assignment-row-title">{item.title}</span>
                        <span
                          className={`authored-assignment-status ${published ? 'is-published' : 'is-draft'}`}
                        >
                          <span className="authored-assignment-status-dot" aria-hidden="true" />
                          <span>{published ? 'Опубликовано' : 'Черновик'}</span>
                        </span>
                        <span className="authored-assignment-chevron" aria-hidden="true">
                          ›
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      </Root>
    );
  }

  if (embedded && screen === 'editor') {
    const moduleTitle =
      draft.moduleKey === null
        ? 'Материал без среды'
        : (modules.find((module) => module.moduleKey === draft.moduleKey)?.displayName ??
          draft.moduleKey);
    const attemptCount = Number(draft.policies.attemptPolicy?.['maxAttempts'] ?? 1);
    const resultTitle =
      draft.resultMode === 'graded'
        ? `Баллы · ${draft.maxPoints ?? '—'}`
        : draft.resultMode === 'completion'
          ? 'Выполнение'
          : 'Без оценки';
    const saveState = busy
      ? 'Сохраняем…'
      : error
        ? 'Проверьте ошибку'
        : hasUnsavedEditorChanges
          ? 'Есть несохранённые изменения'
          : opened
            ? 'Сохранено'
            : 'Новый черновик';

    return (
      <Root className="authored-materials assignment-document-shell" aria-label="Редактор задания">
        <form className="assignment-document-form" onSubmit={(event) => void save(event)}>
          <header className="assignment-document-topbar">
            <button
              type="button"
              className="assignment-document-back"
              disabled={busy}
              onClick={returnToList}
            >
              ← Задания
            </button>

            <div className="assignment-document-save-state" aria-live="polite">
              <span
                className={hasUnsavedEditorChanges ? 'is-dirty' : 'is-saved'}
                aria-hidden="true"
              />
              {saveState}
            </div>

            <div className="assignment-document-actions">
              <button
                type="submit"
                className="btn-secondary"
                disabled={
                  busy ||
                  !draft.title.trim() ||
                  (!opened && !canSaveDraftModule) ||
                  (draft.resultMode === 'graded' && !draft.maxPoints)
                }
              >
                {opened ? 'Сохранить' : 'Создать задание'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy || !opened || draftDirty}
                onClick={() => void openPreviewFlow()}
              >
                Предпросмотр
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={
                  busy ||
                  !draft.title.trim() ||
                  !canAssignDraftModule ||
                  (draft.resultMode === 'graded' && !draft.maxPoints)
                }
                onClick={() => void openAssignFlow()}
              >
                Назначить
              </button>
            </div>
          </header>

          {error ? (
            <div className="assignment-document-message is-error" role="alert">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="assignment-document-message is-success" role="status">
              {notice}
            </div>
          ) : null}

          <main className="assignment-document-canvas">
            <label className="assignment-document-title-field">
              <span className="sr-only">Название задания</span>
              <textarea
                aria-label="Название задания"
                required
                maxLength={255}
                rows={1}
                placeholder="Название задания"
                value={draft.title}
                disabled={busy}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, title: event.target.value }))
                }
              />
            </label>

            <label className="assignment-document-goal-field">
              <span className="sr-only">Цель задания</span>
              <input
                aria-label="Цель задания"
                maxLength={160}
                placeholder="Добавьте цель задания…"
                value={draft.goal === undefined ? (inheritedGoal ?? '') : (draft.goal ?? '')}
                disabled={busy}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, goal: event.target.value }))
                }
              />
            </label>

            <label className="assignment-document-body-field">
              <span className="sr-only">Содержание</span>
              <textarea
                aria-label="Содержание"
                maxLength={12000}
                rows={6}
                placeholder="Опишите, что должен сделать ученик…"
                value={draft.instructions ?? ''}
                disabled={busy}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, instructions: event.target.value }))
                }
              />
            </label>

            <AuthoredTaskBlocksEditor
              blocks={draft.blocks}
              instructions={draft.instructions}
              disabled={busy}
              onChange={(blocks) => setDraft((current) => ({ ...current, blocks }))}
              onImageUpload={(file) => void uploadTaskImage(file)}
              onFileUpload={(file) => void uploadTaskFile(file)}
              pendingMedia={pendingTaskMedia}
              onRemovePendingMedia={(role) =>
                setPendingTaskMedia((current) => current.filter((item) => item.role !== role))
              }
              {...(draft.moduleKey === null
                ? {}
                : { onSampleUpload: (file: File) => void pickDraftSample(file) })}
              imageUrl={(contentHash) =>
                opened
                  ? `/api/learning/activities/${encodeURIComponent(opened.id)}/draft-task-image?v=${encodeURIComponent(contentHash)}`
                  : ''
              }
            />

            {displayedDraftSample ? (
              <div className="assignment-document-legacy-sample">
                <img src={displayedDraftSample} alt="Схема / изображение задания" />
                <button type="button" onClick={() => void deleteDraftSample()} disabled={busy}>
                  Удалить образец
                </button>
              </div>
            ) : null}

            <footer className="assignment-document-meta">
              <span>{moduleTitle}</span>
              <span>
                {attemptCount} попыт{attemptCount === 1 ? 'ка' : 'ки'}
              </span>
              <span>{resultTitle}</span>
              <button type="button" onClick={() => setPanel('settings')}>
                Настройки
              </button>
              <button
                type="button"
                disabled={
                  busy ||
                  !canPublish ||
                  !draft.title.trim() ||
                  (draft.resultMode === 'graded' && !draft.maxPoints)
                }
                onClick={() => void publish()}
              >
                Опубликовать
              </button>
              {opened ? (
                <button type="button" onClick={() => setPanel('history')}>
                  История версий
                </button>
              ) : null}
            </footer>
            {draft.moduleKey === null ? (
              <p className="assignment-document-hint">
                {openedKind === 'manual'
                  ? 'Материал можно добавить в курс. Для отдельной практики создайте новое задание и выберите среду.'
                  : 'Материал можно добавить в курс; для отдельной практики выберите среду в параметрах.'}
              </p>
            ) : null}
          </main>

          {panel === 'settings' ? (
            <div className="teacher-drawer-backdrop teacher-settings-backdrop" role="presentation">
              <aside
                className="teacher-drawer teacher-settings-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="assignment-settings-title"
              >
                <header>
                  <div>
                    <span>Задание</span>
                    <h2 id="assignment-settings-title">Настройки</h2>
                  </div>
                  <button
                    type="button"
                    className="teacher-icon-button"
                    aria-label="Закрыть настройки"
                    onClick={() => setPanel(null)}
                  >
                    ×
                  </button>
                </header>

                <div className="teacher-drawer-body">
                  <label className="teacher-field">
                    <span>Среда</span>
                    <select
                      aria-label="Среда проекта"
                      value={draft.moduleKey ?? ''}
                      disabled={busy || modulesLoading || openedKind === 'manual'}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          moduleKey: event.target.value || null,
                        }))
                      }
                    >
                      <option value="" disabled={openedKind === 'project'}>
                        Материал без среды
                      </option>
                      {draft.moduleKey &&
                      !assignableModules.some((module) => module.moduleKey === draft.moduleKey) ? (
                        <option value={draft.moduleKey}>{draft.moduleKey}</option>
                      ) : null}
                      {assignableModules.map((module) => (
                        <option key={module.moduleKey} value={module.moduleKey}>
                          {module.displayName}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="teacher-field">
                    <span>Результат</span>
                    <select
                      aria-label="Результат"
                      value={draft.resultMode}
                      onChange={(event) => {
                        const resultMode = event.target
                          .value as AuthoredActivityDraft['resultMode'];
                        setDraft((current) => ({
                          ...current,
                          resultMode,
                          maxPoints: resultMode === 'graded' ? current.maxPoints : null,
                        }));
                      }}
                    >
                      <option value="completion">Выполнение</option>
                      <option value="graded">Баллы</option>
                      <option value="ungraded">Без оценки</option>
                    </select>
                  </label>

                  {draft.resultMode === 'graded' ? (
                    <label className="teacher-field">
                      <span>Максимум баллов</span>
                      <input
                        type="number"
                        min={1}
                        max={100000}
                        value={draft.maxPoints ?? ''}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            maxPoints: Number(event.target.value) || null,
                          }))
                        }
                      />
                    </label>
                  ) : null}

                  <label className="teacher-field">
                    <span>Попытки</span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={attemptCount}
                      onChange={(event) =>
                        policy('attemptPolicy', { maxAttempts: Number(event.target.value) })
                      }
                    />
                  </label>

                  <label className="teacher-field">
                    <span>После срока</span>
                    <select
                      value={String(draft.policies.latePolicy?.['mode'] ?? 'allow_until_close')}
                      onChange={(event) => policy('latePolicy', { mode: event.target.value })}
                    >
                      <option value="allow_until_close">Разрешать до закрытия</option>
                      <option value="allow_mark_late">Разрешать с отметкой</option>
                      <option value="block_at_due">Запретить после срока</option>
                    </select>
                  </label>

                  <details className="teacher-advanced-settings">
                    <summary>Дополнительные настройки</summary>
                    {draft.resultMode === 'graded' ? (
                      <label className="teacher-field">
                        <span>Как выбирать результат</span>
                        <select
                          value={String(
                            draft.policies.resultSelectionPolicy?.['mode'] ?? 'latest_accepted',
                          )}
                          onChange={(event) =>
                            policy('resultSelectionPolicy', { mode: event.target.value })
                          }
                        >
                          <option value="first">Первая попытка</option>
                          <option value="latest">Последняя попытка</option>
                          <option value="best">Лучший результат</option>
                          <option value="latest_accepted">Последняя принятая</option>
                          <option value="teacher_selected">Выбор преподавателя</option>
                        </select>
                      </label>
                    ) : null}
                  </details>
                </div>

                <footer>
                  <button type="button" className="btn-primary" onClick={() => setPanel(null)}>
                    Готово
                  </button>
                </footer>
              </aside>
            </div>
          ) : null}

          {panel === 'preview' ? (
            <div className="teacher-drawer-backdrop" role="presentation">
              <aside
                className="teacher-drawer teacher-preview-drawer"
                role="dialog"
                aria-modal="true"
                aria-labelledby="assignment-preview-title"
              >
                <header>
                  <div>
                    <span>Предпросмотр</span>
                    <h2 id="assignment-preview-title">Как увидит ученик</h2>
                  </div>
                  <button
                    type="button"
                    className="teacher-icon-button"
                    aria-label="Закрыть предпросмотр"
                    onClick={() => setPanel(null)}
                  >
                    ×
                  </button>
                </header>
                <div className="teacher-preview-switch">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy || !opened || draftDirty}
                    onClick={() => void previewAsLearner('draft')}
                  >
                    Черновик
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy || !opened || !publishedVersionId}
                    onClick={() => void previewAsLearner('published')}
                  >
                    Опубликованная версия
                  </button>
                </div>
                <div className="teacher-drawer-body">
                  {preview?.kind === 'loading' ? (
                    <p role="status">Загружаем точный предпросмотр…</p>
                  ) : null}
                  {preview?.kind === 'error' ? (
                    <p className="form-error" role="alert">
                      {preview.message}
                    </p>
                  ) : null}
                  {preview?.kind === 'ready' ? (
                    <LearnerPreviewPanel preview={preview.data} modules={modules} />
                  ) : null}
                </div>
              </aside>
            </div>
          ) : null}

          {panel === 'history' && opened ? (
            <div className="teacher-drawer-backdrop" role="presentation">
              <aside
                className="teacher-drawer"
                role="dialog"
                aria-modal="true"
                aria-labelledby="assignment-history-title"
              >
                <header>
                  <div>
                    <span>Задание</span>
                    <h2 id="assignment-history-title">История версий</h2>
                  </div>
                  <button
                    type="button"
                    className="teacher-icon-button"
                    aria-label="Закрыть историю версий"
                    onClick={() => setPanel(null)}
                  >
                    ×
                  </button>
                </header>
                <div className="teacher-drawer-body">
                  <AuthorVersionHistory
                    key={opened.id + '-' + publishedVersionId}
                    kind="activity"
                    onBusyChange={setBusy}
                    rootId={opened.id}
                    revision={opened.revision}
                    dirty={draftDirty}
                    onOpenDraft={async (sourceVersionNumber) => {
                      await open(opened.id);
                      if (sourceVersionNumber)
                        setNotice('Черновик создан на основе версии ' + sourceVersionNumber);
                    }}
                  />
                </div>
              </aside>
            </div>
          ) : null}
        </form>

        {assignVersionId ? (
          <AssignmentAssignDialog
            title={draft.title}
            versionId={assignVersionId}
            attempt={assignmentAttempt.current?.value ?? newAssignmentAttempt()}
            onClose={() => setAssignVersionId(null)}
            onAssigned={(message) => {
              setAssignVersionId(null);
              assignmentAttempt.current = null;
              setNotice(message);
            }}
          />
        ) : null}
      </Root>
    );
  }

  return (
    <Root className={embedded ? 'authored-materials' : 'portal-content'} aria-label="Мои материалы">
      {!embedded ? <h1>Курсы и задания</h1> : null}
      {embedded ? (
        <div className="authored-editor-nav">
          <button
            type="button"
            className="authored-editor-back"
            disabled={busy}
            onClick={returnToList}
          >
            ← Задания
          </button>
        </div>
      ) : null}
      {!embedded ? (
        <div className="library-filters">
          <input
            type="search"
            aria-label="Поиск материалов"
            placeholder="Найти материал"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => {
              setOpened(null);
              setOpenedKind(null);
              setPublishedVersionId(null);
              setPreview(null);
              savedPayload.current = null;
              setDraftSampleImage(null);
              setPendingDraftSample(null);
              setDraft(initial);
              setInheritedGoal(null);
              setNotice(null);
              setError(null);
            }}
          >
            Новый материал
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}{' '}
          <button
            type="button"
            onClick={() => {
              setError(null);
              void Promise.all([refresh(), refreshModules()]);
            }}
          >
            Повторить чтение
          </button>
        </p>
      ) : null}
      {notice ? (
        <p className="notice-success" role="status">
          {notice}
        </p>
      ) : null}
      <div className={`course-editor-grid${embedded ? ' authored-editor-single' : ''}`}>
        {!embedded ? (
          <aside aria-label="Библиотека материалов">
            {loading ? (
              <p role="status">Загружаем материалы…</p>
            ) : !items.length && !error ? (
              <p>Пока нет личных материалов.</p>
            ) : null}
            <ul className="library-list">
              {items
                .filter((item) =>
                  item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                )
                .map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="account-inline-action"
                      disabled={busy}
                      onClick={() => void open(item.id)}
                    >
                      {item.title}
                    </button>
                    <small>
                      {item.currentPublishedVersionId ? 'Есть опубликованная версия' : 'Черновик'}
                    </small>
                  </li>
                ))}
            </ul>
          </aside>
        ) : null}
        <form className="account-profile-form" onSubmit={(event) => void save(event)}>
          <h2>
            {embedded
              ? opened
                ? 'Редактирование задания'
                : 'Новое задание'
              : opened
                ? 'Редактирование материала'
                : 'Новый материал'}
          </h2>
          <label>
            {embedded ? 'Название задания' : 'Название материала'}
            <input
              aria-label={embedded ? 'Название задания' : 'Название материала'}
              required
              maxLength={255}
              value={draft.title}
              disabled={busy}
              onChange={(event) => {
                const title = event.target.value;
                setDraft((current) => ({ ...current, title }));
              }}
            />
          </label>
          <label>
            Цель задания
            <input
              aria-label="Цель задания"
              maxLength={160}
              value={draft.goal === undefined ? (inheritedGoal ?? '') : (draft.goal ?? '')}
              disabled={busy}
              onChange={(event) => {
                const goal = event.target.value;
                setDraft((current) => ({ ...current, goal }));
              }}
            />
          </label>
          {(draft.goal === undefined ? inheritedGoal !== null : draft.goal !== null) && (
            <button
              type="button"
              className="account-inline-action"
              disabled={busy}
              onClick={() => setDraft((current) => ({ ...current, goal: null }))}
            >
              Очистить цель задания
            </button>
          )}
          <label>
            Содержание
            <textarea
              aria-label="Содержание"
              maxLength={12000}
              rows={5}
              value={draft.instructions ?? ''}
              disabled={busy}
              onChange={(event) => {
                const instructions = event.target.value;
                setDraft((current) => ({ ...current, instructions }));
              }}
            />
          </label>
          <AuthoredTaskBlocksEditor
            blocks={draft.blocks}
            instructions={draft.instructions}
            disabled={busy}
            onChange={(blocks) => setDraft((current) => ({ ...current, blocks }))}
            onImageUpload={(file) => void uploadTaskImage(file)}
            onFileUpload={(file) => void uploadTaskFile(file)}
            imageUrl={(contentHash) =>
              opened
                ? `/api/learning/activities/${encodeURIComponent(opened.id)}/draft-task-image?v=${encodeURIComponent(contentHash)}`
                : ''
            }
          />
          <label>
            Среда проекта
            <select
              value={draft.moduleKey ?? ''}
              disabled={busy || modulesLoading || openedKind === 'manual'}
              onChange={(event) => {
                const moduleKey = event.target.value || null;
                setDraft((current) => ({ ...current, moduleKey }));
              }}
            >
              <option value="" disabled={openedKind === 'project'}>
                Материал без среды
              </option>
              {draft.moduleKey &&
              !assignableModules.some((module) => module.moduleKey === draft.moduleKey) ? (
                <option value={draft.moduleKey}>
                  {draft.moduleKey} · недоступно для назначения
                </option>
              ) : null}
              {assignableModules.map((module) => (
                <option key={module.moduleKey} value={module.moduleKey}>
                  {module.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Результат
            <select
              value={draft.resultMode}
              disabled={busy}
              onChange={(event) => {
                const resultMode = event.target.value as AuthoredActivityDraft['resultMode'];
                setDraft((current) => ({
                  ...current,
                  resultMode,
                  maxPoints: null,
                }));
              }}
            >
              <option value="ungraded">Без оценки</option>
              <option value="completion">Выполнение</option>
              <option value="graded">Баллы</option>
            </select>
          </label>
          {draft.resultMode === 'graded' ? (
            <>
              <label>
                Максимум баллов
                <input
                  required
                  type="number"
                  min={1}
                  max={100000}
                  value={draft.maxPoints ?? ''}
                  onChange={(event) => {
                    const maxPoints = Number(event.target.value) || null;
                    setDraft((current) => ({
                      ...current,
                      maxPoints,
                    }));
                  }}
                />
              </label>
              <label>
                Как выбирать результат
                <select
                  value={String(
                    draft.policies.resultSelectionPolicy?.['mode'] ?? 'latest_accepted',
                  )}
                  onChange={(event) =>
                    policy('resultSelectionPolicy', { mode: event.target.value })
                  }
                >
                  <option value="first">Первая попытка</option>
                  <option value="latest">Последняя попытка</option>
                  <option value="best">Лучший результат</option>
                  <option value="latest_accepted">Последняя принятая</option>
                  <option value="teacher_selected">Выбор преподавателя</option>
                </select>
              </label>
            </>
          ) : null}
          <label>
            Число попыток
            <input
              type="number"
              min={1}
              max={100}
              value={Number(draft.policies.attemptPolicy?.['maxAttempts'] ?? 1)}
              onChange={(event) =>
                policy('attemptPolicy', { maxAttempts: Number(event.target.value) })
              }
            />
          </label>
          <label>
            После срока
            <select
              value={String(draft.policies.latePolicy?.['mode'] ?? 'allow_until_close')}
              onChange={(event) => policy('latePolicy', { mode: event.target.value })}
            >
              <option value="allow_until_close">Разрешать до закрытия</option>
              <option value="allow_mark_late">Разрешать с отметкой опоздания</option>
              <option value="block_at_due">Запретить после срока</option>
            </select>
          </label>
          <fieldset className="authored-draft-image">
            <legend>Схема / изображение</legend>
            {displayedDraftSample ? (
              <img src={displayedDraftSample} alt="Схема / изображение задания" />
            ) : null}
            <div className="authored-draft-image-actions">
              <label className="btn-secondary">
                {displayedDraftSample ? 'Заменить' : 'Выбрать файл'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label="Файл схемы или изображения"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void pickDraftSample(file);
                  }}
                />
              </label>
              {displayedDraftSample ? (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => void deleteDraftSample()}
                >
                  Удалить
                </button>
              ) : null}
            </div>
            <p className="account-hint">PNG, JPEG или WebP, до 400 КБ.</p>
          </fieldset>
          <p className="account-hint">
            Закрытый материал. Публикация закрепляет версию для назначения и не открывает публичный
            доступ.
          </p>
          <div className="modal-actions">
            <button
              type="submit"
              className="btn-primary"
              disabled={
                busy ||
                !draft.title.trim() ||
                (!opened && !canSaveDraftModule) ||
                (draft.resultMode === 'graded' && !draft.maxPoints)
              }
            >
              {busy
                ? 'Сохраняем…'
                : opened
                  ? 'Сохранить'
                  : embedded
                    ? 'Создать задание'
                    : 'Создать материал'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={
                busy ||
                !draft.title.trim() ||
                !canPublish ||
                (draft.resultMode === 'graded' && !draft.maxPoints)
              }
              onClick={() => void publish()}
            >
              Опубликовать
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || !opened || draftDirty}
              onClick={() => void previewAsLearner('draft')}
            >
              Как ученик: сохранённый черновик
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || !opened || !publishedVersionId}
              onClick={() => void previewAsLearner('published')}
            >
              Как ученик: опубликованная версия
            </button>
          </div>
          {opened && draftDirty ? (
            <p className="account-hint">
              Сохраните изменения, чтобы предпросмотр черновика был точным.
            </p>
          ) : null}
          {opened ? (
            <AuthorVersionHistory
              key={opened.id + '-' + publishedVersionId}
              kind="activity"
              onBusyChange={setBusy}
              rootId={opened.id}
              revision={opened.revision}
              dirty={draftDirty}
              onOpenDraft={async (sourceVersionNumber) => {
                await open(opened.id);
                if (sourceVersionNumber)
                  setNotice('Черновик создан на основе версии ' + sourceVersionNumber);
              }}
            />
          ) : null}
          {preview?.kind === 'loading' ? <p role="status">Загружаем точный предпросмотр…</p> : null}
          {preview?.kind === 'error' ? (
            <p className="form-error" role="alert">
              {preview.message}
            </p>
          ) : null}
          {preview?.kind === 'ready' ? (
            <LearnerPreviewPanel preview={preview.data} modules={modules} />
          ) : null}
        </form>
      </div>
    </Root>
  );
}
