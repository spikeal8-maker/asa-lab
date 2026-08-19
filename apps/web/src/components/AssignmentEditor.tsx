import { useRef, useState, type FormEvent, type JSX } from 'react';
import { api, type LibraryAssignment, type ModuleSummary } from '../api';
import { AssignmentGoal, BriefText } from './BriefText';
import './assignment-editor.css';

/**
 * Одна форма задания на весь продукт.
 *
 * Раньше их было две: в «Заданиях» — с целью, образцом и разметкой, а в классе
 * — окошко с названием и голым полем текста. Учитель, написавший задание в
 * классе, получал задание хуже — без цели и без картинки, — и не понимал,
 * почему. Форма здесь одна, а разница между «написать себе» и «выдать классу»
 * сводится к одному полю срока.
 *
 * Текст задания редактируется рядом с тем, как его увидит ученик. Разметку
 * набирают кнопками, а не наизусть: превращать «две звёздочки» в школьное
 * знание — не наша задача.
 */

const BRIEF_PLACEHOLDER = [
  '## Что делаем',
  '1. Первый шаг',
  '2. Второй шаг',
  '',
  '**Проверь себя:** деталь получилась одна.',
].join('\n');

/** Картинка, вставленная в текст, но ещё не отправленная на сервер. */
interface PendingImage {
  readonly ref: string;
  readonly dataUrl: string;
}

export interface AssignmentDraft {
  readonly title: string;
  readonly brief: string | null;
  readonly goal: string | null;
  readonly moduleKey: string;
  readonly dueAt: string | null;
}

async function readFile(file: File): Promise<string> {
  const reader = new FileReader();
  return new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function checkPicture(file: File): string | null {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    return 'Подойдёт PNG, JPEG или WebP.';
  }
  if (file.size > 400_000) return 'Картинка должна быть до 400 КБ.';
  return null;
}

export function AssignmentEditorDialog({
  assignment,
  modules,
  withDueDate = false,
  heading,
  intro,
  submitLabel,
  onClose,
  onSaved,
}: {
  readonly assignment: LibraryAssignment | null;
  readonly modules: readonly ModuleSummary[];
  /** Внутри класса задание сразу выдаётся, поэтому спрашиваем срок. */
  readonly withDueDate?: boolean;
  readonly heading?: string;
  readonly intro?: string;
  readonly submitLabel?: string;
  readonly onClose: () => void;
  readonly onSaved: (assignmentId: string, draft: AssignmentDraft) => Promise<string | null>;
}): JSX.Element {
  const [title, setTitle] = useState(assignment?.title ?? '');
  const [brief, setBrief] = useState(assignment?.brief ?? '');
  const [goal, setGoal] = useState(assignment?.goal ?? '');
  const [moduleKey, setModuleKey] = useState(assignment?.moduleKey ?? modules[0]?.moduleKey ?? '');
  const [dueAt, setDueAt] = useState('');
  // undefined = оставить картинку как есть, null = убрать, строка = новая.
  const [sample, setSample] = useState<string | null | undefined>(undefined);
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const briefRef = useRef<HTMLTextAreaElement | null>(null);
  const nextRef = useRef(1);

  const shownSample = sample === undefined ? (assignment?.sampleImage ?? null) : sample;

  /**
   * Текст для показа: ссылки на ещё не отправленные картинки подменяются самими
   * картинками. Учитель видит верстку целиком, не дожидаясь сохранения.
   */
  const previewText = pending.reduce(
    (text, image) => text.split(`(${image.ref})`).join(`(${image.dataUrl})`),
    brief,
  );

  function replaceSelection(before: string, after: string, placeholder: string): void {
    const field = briefRef.current;
    if (!field) return;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const selected = brief.slice(start, end) || placeholder;
    setBrief(`${brief.slice(0, start)}${before}${selected}${after}${brief.slice(end)}`);
    window.requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  function prefixLine(prefix: string): void {
    const field = briefRef.current;
    if (!field) return;
    const caret = field.selectionStart;
    const lineStart = brief.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
    setBrief(`${brief.slice(0, lineStart)}${prefix}${brief.slice(lineStart)}`);
    window.requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(caret + prefix.length, caret + prefix.length);
    });
  }

  /** Вставка на своей строке: картинка и заголовок посреди абзаца не читаются. */
  function insertBlock(text: string): void {
    const field = briefRef.current;
    const caret = field ? field.selectionStart : brief.length;
    const before = brief.slice(0, caret);
    const after = brief.slice(caret);
    const lead = before.length === 0 || before.endsWith('\n') ? '' : '\n';
    const tail = after.startsWith('\n') || after.length === 0 ? '' : '\n';
    const next = `${before}${lead}${text}${tail}${after}`;
    setBrief(next);
    window.requestAnimationFrame(() => {
      field?.focus();
      const at = before.length + lead.length + text.length;
      field?.setSelectionRange(at, at);
    });
  }

  async function addBriefImage(file: File): Promise<void> {
    const problem = checkPicture(file);
    if (problem) {
      setError(problem);
      return;
    }
    const dataUrl = await readFile(file);
    const ref = `pending:${nextRef.current}`;
    nextRef.current += 1;
    setPending((current) => [...current, { ref, dataUrl }]);
    setError(null);
    insertBlock(`![${file.name.replace(/\.[^.]+$/, '')}](${ref})`);
  }

  async function pickSample(file: File): Promise<void> {
    const problem = checkPicture(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSample(await readFile(file));
  }

  function addLink(): void {
    const href = window.prompt('Адрес ссылки', 'https://');
    if (!href || !/^https?:\/\//i.test(href)) return;
    replaceSelection('[', `](${href})`, 'ссылка');
  }

  /**
   * Сохранение.
   *
   * Картинки текста отправляются после того, как у задания появился номер:
   * ссылки в тексте ведут на них, а не на строку в тысячу знаков. Поэтому текст
   * дописывается вторым заходом — уже с настоящими адресами.
   */
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim()) {
      setError('Введите название задания.');
      return;
    }
    if (!moduleKey) {
      setError('Выберите среду, в которой ученики будут работать.');
      return;
    }
    setBusy(true);
    setError(null);
    const fields = {
      title: title.trim(),
      brief: brief.trim() || null,
      goal: goal.trim() || null,
      moduleKey,
    };
    const saved = await api.saveLibraryAssignment(assignment?.id ?? null, fields);
    if (!saved.ok) {
      setBusy(false);
      setError(saved.error.message || 'Не удалось сохранить задание.');
      return;
    }
    const assignmentId = saved.data.id;

    if (sample !== undefined) {
      const attached = await api.setAssignmentSample(assignmentId, sample);
      if (!attached.ok) {
        setBusy(false);
        setError(attached.error.message || 'Не удалось сохранить картинку.');
        return;
      }
    }

    if (pending.length > 0) {
      let text = brief;
      for (const image of pending) {
        if (!text.includes(`(${image.ref})`)) continue;
        const uploaded = await api.addAssignmentImage(assignmentId, image.dataUrl);
        if (!uploaded.ok) {
          setBusy(false);
          setError(uploaded.error.message || 'Не удалось загрузить картинку из текста.');
          return;
        }
        text = text.split(`(${image.ref})`).join(`(${uploaded.data.url})`);
      }
      const rewritten = await api.saveLibraryAssignment(assignmentId, { ...fields, brief: text });
      if (!rewritten.ok) {
        setBusy(false);
        setError(rewritten.error.message || 'Не удалось сохранить текст задания.');
        return;
      }
      setBrief(text);
      setPending([]);
    }

    const message = await onSaved(assignmentId, {
      ...fields,
      // Дата без времени — это конец того дня: так учитель и говорит «до пятницы».
      dueAt: dueAt ? new Date(`${dueAt}T23:59:59`).toISOString() : null,
    });
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal assignment-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assignment-editor-heading"
      >
        <h2 id="assignment-editor-heading">
          {heading ?? (assignment ? 'Задание' : 'Новое задание')}
        </h2>
        <p>
          {intro ??
            (assignment
              ? 'Изменения увидят все классы, которым это задание выдано.'
              : 'Задание останется у вас, и его можно выдать любым классам.')}
        </p>
        <form onSubmit={(event) => void submit(event)}>
          {/* Что за работа — слева, как она выглядит — справа. Образец это
              половина задания: «сделай замок» и увиденный замок — разные вещи. */}
          <div className="assignment-editor-head">
            <div className="assignment-editor-fields">
              <label htmlFor="assignment-editor-title">Название</label>
              <input
                id="assignment-editor-title"
                autoFocus
                maxLength={255}
                value={title}
                disabled={busy}
                placeholder="Брелок с именем"
                onChange={(event) => setTitle(event.target.value)}
              />

              <label htmlFor="assignment-editor-module">Среда</label>
              <select
                id="assignment-editor-module"
                value={moduleKey}
                disabled={busy}
                onChange={(event) => setModuleKey(event.target.value)}
              >
                {modules.map((module) => (
                  <option key={module.moduleKey} value={module.moduleKey}>
                    {module.displayName}
                  </option>
                ))}
              </select>

              <label htmlFor="assignment-editor-goal">Цель — одной строкой</label>
              <input
                id="assignment-editor-goal"
                maxLength={160}
                value={goal}
                disabled={busy}
                placeholder="Научиться соединять две фигуры в одну деталь"
                onChange={(event) => setGoal(event.target.value)}
              />
              <p className="account-hint">Ученик увидит её первой, выделенной.</p>

              {withDueDate ? (
                <>
                  <label htmlFor="assignment-editor-due">Срок сдачи</label>
                  <input
                    id="assignment-editor-due"
                    type="date"
                    value={dueAt}
                    disabled={busy}
                    onChange={(event) => setDueAt(event.target.value)}
                  />
                </>
              ) : null}
            </div>

            <div className="assignment-editor-sample">
              <span className="field-label">Что должно получиться</span>
              {shownSample ? (
                <img src={shownSample} alt="Образец задания" />
              ) : (
                <span className="assignment-editor-sample-empty">
                  Ученик увидит эту картинку первой — и на своей странице, и рядом с работой.
                </span>
              )}
              <div className="assignment-editor-sample-actions">
                <label className="btn-secondary library-file-button">
                  {shownSample ? 'Заменить' : 'Загрузить'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void pickSample(file);
                      event.target.value = '';
                    }}
                  />
                </label>
                {shownSample ? (
                  <button
                    type="button"
                    className="assignment-remove"
                    disabled={busy}
                    onClick={() => setSample(null)}
                  >
                    Убрать
                  </button>
                ) : null}
              </div>
              <span className="account-hint">PNG, JPEG или WebP, до 400 КБ.</span>
            </div>
          </div>

          <div className="brief-editor-head">
            <label htmlFor="assignment-editor-brief">Что нужно сделать</label>
            <div className="brief-toolbar" role="group" aria-label="Форматирование">
              <button
                type="button"
                title="Заголовок раздела"
                disabled={busy}
                onClick={() => prefixLine('## ')}
              >
                Заголовок
              </button>
              <button
                type="button"
                title="Полужирный"
                disabled={busy}
                onClick={() => replaceSelection('**', '**', 'важное')}
              >
                <strong>Ж</strong>
              </button>
              <button type="button" title="Список" disabled={busy} onClick={() => prefixLine('- ')}>
                • Список
              </button>
              <button
                type="button"
                title="Нумерованные шаги"
                disabled={busy}
                onClick={() => prefixLine('1. ')}
              >
                1. Шаги
              </button>
              <button type="button" title="Ссылка" disabled={busy} onClick={addLink}>
                Ссылка
              </button>
              <label className="brief-toolbar-file" title="Картинка в текст">
                Картинка
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void addBriefImage(file);
                    event.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>

          {/* Текст и то, как его увидит ученик, — рядом. Разметку набирают
              редко, а результат важен каждый раз, так что показываем сразу. */}
          <div className="assignment-editor-split">
            <textarea
              id="assignment-editor-brief"
              ref={briefRef}
              maxLength={8000}
              value={brief}
              disabled={busy}
              placeholder={BRIEF_PLACEHOLDER}
              onChange={(event) => setBrief(event.target.value)}
            />
            <div className="brief-preview" data-testid="brief-preview">
              <span className="brief-preview-label">Так увидит ученик</span>
              <AssignmentGoal goal={goal.trim() || null} />
              {previewText.trim() ? (
                <BriefText text={previewText} />
              ) : (
                <p className="account-hint">Текст задания появится здесь.</p>
              )}
            </div>
          </div>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="modal-actions">
            <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Сохраняем…' : (submitLabel ?? 'Сохранить')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
