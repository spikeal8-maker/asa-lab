import { AuthorVersionHistory } from '../components/AuthorVersionHistory';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  api,
  type AuthoredActivityDraft,
  type AuthoredActivityLearnerPreview,
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
  moduleKey: '',
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

const PREFERRED_AUTHOR_MODULE_KEY = 'electronics';

function isAssignableModule(module: ModuleSummary): boolean {
  return module.creatable && module.learningCapabilities?.assignable === true;
}

function defaultAssignableModuleKey(modules: readonly ModuleSummary[]): string {
  const assignable = modules.filter(isAssignableModule);
  return (
    assignable.find((module) => module.moduleKey === PREFERRED_AUTHOR_MODULE_KEY)?.moduleKey ??
    assignable[0]?.moduleKey ??
    ''
  );
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

/** One authoring surface for authors and educators; it never reads a roster. */
export function AuthoredMaterialsPage({
  embedded = false,
  onChanged,
}: {
  readonly embedded?: boolean;
  readonly onChanged?: () => void;
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
  const [publishedVersionId, setPublishedVersionId] = useState<string | null>(null);
  const [draftSampleImage, setDraftSampleImage] = useState<string | null>(null);
  const [pendingDraftSample, setPendingDraftSample] = useState<string | null>(null);
  const [preview, setPreview] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; data: AuthoredActivityLearnerPreview }
    | { kind: 'error'; message: string }
    | null
  >(null);
  const [search, setSearch] = useState('');
  const [screen, setScreen] = useState<'list' | 'editor'>(embedded ? 'list' : 'editor');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'published'>('all');
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
        setDraft((current) =>
          current.moduleKey === ''
            ? { ...current, moduleKey: defaultAssignableModuleKey(result.data.items) }
            : current,
        );
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
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await api.authoredActivity(id);
    if (result.ok) {
      const value = result.data.draft;
      setOpened({ id, revision: result.data.draftRevision });
      setPublishedVersionId(result.data.currentPublishedVersionId);
      setDraftSampleImage(result.data.draftSampleImage);
      setInheritedGoal(result.data.inheritedGoal);
      setPendingDraftSample(null);
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
    setOpened(null);
    setPublishedVersionId(null);
    savedPayload.current = null;
    setDraftSampleImage(null);
    setPendingDraftSample(null);
    setDraft({ ...initial, moduleKey: defaultAssignableModuleKey(modules) });
    setInheritedGoal(null);
    setNotice(null);
    setError(null);
    setScreen('editor');
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (busy || !draft.title.trim() || draft.moduleKey === '' || (!opened && !canAssignDraftModule))
      return null;
    const payload = JSON.stringify(draft);
    const textDirty = !opened || savedPayload.current !== payload;
    if (!textDirty && pendingDraftSample === null) return opened;

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
  async function publish() {
    if (!canPublish) return;
    const saved = await save();
    if (!saved) return;
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
    } else setError(result.error.message);
    setBusy(false);
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

  function policy(key: keyof AuthoredActivityDraft['policies'], value: Record<string, unknown>) {
    setDraft((current) => ({
      ...current,
      policies: { ...current.policies, [key]: value },
    }));
  }
  const draftDirty =
    (opened !== null && savedPayload.current !== JSON.stringify(draft)) ||
    pendingDraftSample !== null;
  const canAssignDraftModule =
    !modulesLoading &&
    draft.moduleKey !== null &&
    assignableModules.some((module) => module.moduleKey === draft.moduleKey);
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
    (draft.title.trim().length > 0 ||
      String(draft.goal ?? '').trim().length > 0 ||
      (draft.instructions ?? '').trim().length > 0 ||
      (draft.blocks?.length ?? 0) > 0 ||
      pendingDraftSample !== null);
  const hasUnsavedEditorChanges = opened === null ? newDraftDirty : draftDirty;

  function returnToList(): void {
    if (
      hasUnsavedEditorChanges &&
      !window.confirm('Есть несохранённые изменения. Вернуться к списку и оставить их?')
    ) {
      return;
    }
    previewRequest.current += 1;
    setPreview(null);
    setError(null);
    setNotice(null);
    setScreen('list');
  }

  const Root = embedded ? 'section' : 'main';

  if (embedded && screen === 'list') {
    return (
      <Root
        className="authored-materials authored-assignment-list"
        aria-labelledby="assignment-list-title"
      >
        <div className="authored-assignment-list-head">
          <div>
            <h2 id="assignment-list-title">Задания</h2>
            <p>Создавайте задания, находите нужное и открывайте его для редактирования.</p>
          </div>
          <button type="button" className="portal-create-button" disabled={busy} onClick={startNew}>
            + Новое задание
          </button>
        </div>

        <div className="authored-assignment-toolbar" aria-label="Поиск и фильтры заданий">
          <label className="authored-assignment-search">
            <span className="sr-only">Поиск заданий</span>
            <input
              type="search"
              placeholder="Поиск заданий"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="authored-assignment-status-filter">
            <span>Статус</span>
            <select
              aria-label="Фильтр по статусу"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as 'all' | 'draft' | 'published')
              }
            >
              <option value="all">Все ({items.length})</option>
              <option value="draft">Черновики ({items.length - publishedCount})</option>
              <option value="published">Опубликованные ({publishedCount})</option>
            </select>
          </label>
        </div>

        {error ? (
          <div className="authored-assignment-state is-error" role="alert">
            <strong>Не удалось загрузить задания.</strong>
            <span>{error}</span>
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
            <span>Создайте первое задание — оно появится в этом списке.</span>
            <button type="button" className="btn-secondary" onClick={startNew}>
              Создать задание
            </button>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="authored-assignment-state">
            <strong>Ничего не найдено.</strong>
            <span>Измените поиск или фильтр статуса.</span>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setSearch('');
                setStatusFilter('all');
              }}
            >
              Сбросить фильтры
            </button>
          </div>
        ) : (
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
                      {published ? 'Опубликовано' : 'Черновик'}
                    </span>
                    <span className="authored-assignment-open-label">
                      Открыть <span aria-hidden="true">→</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
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
      <div className="library-filters" hidden={embedded}>
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
            setPublishedVersionId(null);
            setPreview(null);
            savedPayload.current = null;
            setDraftSampleImage(null);
            setPendingDraftSample(null);
            setDraft({ ...initial, moduleKey: defaultAssignableModuleKey(modules) });
            setInheritedGoal(null);
            setNotice(null);
            setError(null);
          }}
        >
          Новый материал
        </button>
      </div>
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
        <aside aria-label="Библиотека материалов" hidden={embedded}>
          {loading ? (
            <p role="status">Загружаем материалы…</p>
          ) : !items.length && !error ? (
            <p>Пока нет личных материалов.</p>
          ) : null}
          <ul className="library-list">
            {items
              .filter((item) => item.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
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
        <form className="account-profile-form" onSubmit={(event) => void save(event)}>
          <h2>{opened ? 'Редактирование материала' : 'Новый материал'}</h2>
          <label>
            Название материала
            <input
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
              disabled={
                busy || draft.moduleKey === null || modulesLoading || assignableModules.length === 0
              }
              onChange={(event) => {
                const moduleKey = event.target.value;
                setDraft((current) => ({ ...current, moduleKey }));
              }}
            >
              {draft.moduleKey === '' ? (
                <option value="" disabled>
                  Выберите среду
                </option>
              ) : null}
              {draft.moduleKey === null ? <option value="">Материал без редактора</option> : null}
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
                draft.moduleKey === '' ||
                (!opened && !canAssignDraftModule) ||
                (draft.resultMode === 'graded' && !draft.maxPoints)
              }
            >
              {busy ? 'Сохраняем…' : opened ? 'Сохранить' : 'Создать материал'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={
                busy ||
                !draft.title.trim() ||
                draft.moduleKey === '' ||
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
