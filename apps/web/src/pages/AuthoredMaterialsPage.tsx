import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type AuthoredActivityDraft, type AuthoredActivityLearnerPreview } from '../api';
import { AssignmentView } from '../components/AssignmentView';

const initial: AuthoredActivityDraft = {
  title: '',
  instructions: '',
  moduleKey: 'electronics',
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

function LearnerPreviewPanel({ preview }: { readonly preview: AuthoredActivityLearnerPreview }) {
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
            {preview.moduleKey === 'electronics'
              ? 'Электроника'
              : preview.moduleKey === 'three-d'
                ? '3D'
                : preview.moduleKey === null
                  ? 'Без редактора проекта'
                  : 'Среда проекта'}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<AuthoredActivityDraft>(initial);
  const [opened, setOpened] = useState<{ id: string; revision: number } | null>(null);
  const [publishedVersionId, setPublishedVersionId] = useState<string | null>(null);
  const [preview, setPreview] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; data: AuthoredActivityLearnerPreview }
    | { kind: 'error'; message: string }
    | null
  >(null);
  const [search, setSearch] = useState('');
  const request = useRef<{ payload: string; id: string } | null>(null);
  const savedPayload = useRef<string | null>(null);
  const previewRequest = useRef(0);
  useEffect(() => {
    previewRequest.current += 1;
    setPreview(null);
  }, [draft, opened, publishedVersionId]);
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
      const loaded: AuthoredActivityDraft = {
        title: value.title,
        instructions: value.instructions,
        resultMode: value.resultMode,
        maxPoints: value.maxPoints,
        moduleKey: value.moduleKey,
        policies: value.policies,
      };
      setDraft(loaded);
      savedPayload.current = JSON.stringify(loaded);
      setPreview(null);
    } else setError(result.error.message || 'Материал недоступен.');
    setBusy(false);
  }
  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (busy || !draft.title.trim()) return null;
    const payload = JSON.stringify(draft);
    if (opened && savedPayload.current === payload) return opened;
    setBusy(true);
    setError(null);
    setNotice(null);
    if (!request.current || request.current.payload !== payload)
      request.current = { payload, id: crypto.randomUUID() };
    const result = opened
      ? await api.saveAuthoredActivity(opened.id, opened.revision, draft)
      : await api.createActivityDraft(draft, request.current.id);
    if (result.ok) {
      const saved = { id: result.data.id, revision: result.data.draftRevision };
      setOpened(saved);
      setPreview(null);
      savedPayload.current = payload;
      request.current = null;
      setNotice('Черновик сохранён. Публикация — отдельное действие.');
      await refresh();
      onChanged?.();
      setBusy(false);
      return saved;
    }
    setError(
      result.error.code?.includes('conflict')
        ? 'Материал изменён в другом окне. Откройте актуальную редакцию из списка.'
        : result.error.message,
    );
    setBusy(false);
    return null;
  }
  async function publish() {
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
    if (source === 'draft' && savedPayload.current !== JSON.stringify(draft)) {
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
    setDraft({ ...draft, policies: { ...draft.policies, [key]: value } });
  }
  const Root = embedded ? 'section' : 'main';
  return (
    <Root className={embedded ? 'authored-materials' : 'portal-content'} aria-label="Мои материалы">
      {!embedded ? <h1>Курсы и задания</h1> : null}
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
            setPublishedVersionId(null);
            setPreview(null);
            savedPayload.current = null;
            setDraft(initial);
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
          <button type="button" onClick={() => void refresh()}>
            Повторить чтение
          </button>
        </p>
      ) : null}
      {notice ? (
        <p className="notice-success" role="status">
          {notice}
        </p>
      ) : null}
      <div className="course-editor-grid">
        <aside aria-label="Библиотека материалов">
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
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          <label>
            Содержание
            <textarea
              aria-label="Содержание"
              maxLength={12000}
              rows={5}
              value={draft.instructions ?? ''}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
            />
          </label>
          <label>
            Среда проекта
            <select
              value={draft.moduleKey ?? ''}
              disabled={busy || draft.moduleKey === null}
              onChange={(event) => setDraft({ ...draft, moduleKey: event.target.value })}
            >
              {draft.moduleKey === null ? <option value="">Материал без редактора</option> : null}
              <option value="electronics">Электроника</option>
              <option value="three-d">3D-моделирование</option>
            </select>
          </label>
          <label>
            Результат
            <select
              value={draft.resultMode}
              disabled={busy}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  resultMode: event.target.value as AuthoredActivityDraft['resultMode'],
                  maxPoints: null,
                })
              }
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
                  onChange={(event) =>
                    setDraft({ ...draft, maxPoints: Number(event.target.value) || null })
                  }
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
          <p className="account-hint">
            Закрытый материал. Публикация закрепляет версию для назначения и не открывает публичный
            доступ.
          </p>
          <div className="modal-actions">
            <button
              type="submit"
              className="btn-primary"
              disabled={
                busy || !draft.title.trim() || (draft.resultMode === 'graded' && !draft.maxPoints)
              }
            >
              {busy ? 'Сохраняем…' : opened ? 'Сохранить' : 'Создать материал'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={
                busy || !draft.title.trim() || (draft.resultMode === 'graded' && !draft.maxPoints)
              }
              onClick={() => void publish()}
            >
              Опубликовать
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || !opened || savedPayload.current !== JSON.stringify(draft)}
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
          {opened && savedPayload.current !== JSON.stringify(draft) ? (
            <p className="account-hint">
              Сохраните изменения, чтобы предпросмотр черновика был точным.
            </p>
          ) : null}
          {preview?.kind === 'loading' ? <p role="status">Загружаем точный предпросмотр…</p> : null}
          {preview?.kind === 'error' ? (
            <p className="form-error" role="alert">
              {preview.message}
            </p>
          ) : null}
          {preview?.kind === 'ready' ? <LearnerPreviewPanel preview={preview.data} /> : null}
        </form>
      </div>
    </Root>
  );
}
