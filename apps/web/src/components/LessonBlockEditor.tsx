import { useRef, useState } from 'react';
import type { LessonBlock } from '../api';
import { CanonicalPracticePicker } from './CanonicalPracticePicker';
import { CanonicalManualMaterialPicker } from './CanonicalManualMaterialPicker';
import { Dropdown } from './Dropdown';
import { LessonBlocks } from './LessonBlocks';
import { GrowingTextarea } from './GrowingTextarea';

const ASSET_URL = /^\/assets\/[A-Za-z0-9][A-Za-z0-9/_.%-]*$/;
const CODE_TEXT_LIMIT = 20_000;
const FORMULA_TEXT_LIMIT = 4_000;
const TABLE_ROW_LIMIT = 30;
const TABLE_COLUMN_LIMIT = 12;
const TABLE_CELL_TEXT_LIMIT = 1_000;
export const MAX_LESSON_BLOCKS = 40;
const CODE_LANGUAGE = /^[A-Za-z0-9][A-Za-z0-9_+.#-]{0,79}$/;
const ACTIVITY_VERSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface LessonActivityOption {
  readonly id: string;
  readonly title: string;
  readonly currentPublishedVersionId: string | null;
}

function localMediaUrl(value: string): boolean {
  return ASSET_URL.test(value) && !value.includes('..');
}

function fileUrl(value: string): boolean {
  return value.startsWith('https://') || localMediaUrl(value);
}

/** Preview only links that the existing CourseVersion validator can publish. */
function mediaPreviewReady(block: LessonBlock): boolean {
  if (block.type === 'image' || block.type === 'video' || block.type === 'audio')
    return localMediaUrl(block.url);
  if (block.type === 'file') return fileUrl(block.url) && block.label.trim().length > 0;
  return false;
}

type MediaLessonBlock = Extract<
  LessonBlock,
  { type: 'image' | 'video' | 'audio' | 'file' }
>;

function isMediaLessonBlock(block: LessonBlock): block is MediaLessonBlock {
  return (
    block.type === 'image' ||
    block.type === 'video' ||
    block.type === 'audio' ||
    block.type === 'file'
  );
}

function InlineMediaPreview({
  block,
  index,
}: {
  readonly block: MediaLessonBlock;
  readonly index: number;
}): JSX.Element | null {
  if (!block.url.trim()) return null;
  if (!mediaPreviewReady(block)) {
    return (
      <p className="lesson-block-url-hint" role="status">
        {block.type === 'file'
          ? 'Укажите название файла и ссылку HTTPS или /assets/…'
          : 'Для предпросмотра используйте ссылку на медиа /assets/…'}
      </p>
    );
  }
  return (
    <div
      className="lesson-block-edit-preview"
      role="region"
      aria-label={`Предпросмотр вложения блока ${index + 1}`}
    >
      <small>Как увидит ученик</small>
      <LessonBlocks
        blocks={[{ ...block, hidden: false }]}
        compact
        mediaScopeKey={`course-editor:${block.id}`}
      />
    </div>
  );
}

function nextId(): string {
  return `b-${crypto.randomUUID().replaceAll('-', '')}`;
}

function tableRowsValid(rows: readonly (readonly string[])[]): boolean {
  if (rows.length < 1 || rows.length > TABLE_ROW_LIMIT) return false;
  const columns = rows[0]?.length ?? 0;
  if (columns < 1 || columns > TABLE_COLUMN_LIMIT) return false;
  return rows.every(
    (row) =>
      row.length === columns &&
      row.every((cell) => typeof cell === 'string' && cell.length <= TABLE_CELL_TEXT_LIMIT),
  );
}

export function createLessonBlock(type: LessonBlock['type']): LessonBlock {
  const id = nextId();
  if (type === 'paragraph') return { id, type, text: '', hidden: false };
  if (type === 'heading') return { id, type, text: '', level: 2, hidden: false };
  if (type === 'callout') return { id, type, text: '', tone: 'note', hidden: false };
  if (type === 'image') return { id, type, url: '', alt: '', caption: '', hidden: false };
  if (type === 'video') return { id, type, url: '', title: '', hidden: false };
  if (type === 'audio') return { id, type, url: '', title: '', hidden: false };
  if (type === 'file') return { id, type, url: '', label: '', hidden: false };
  if (type === 'code') return { id, type, text: '', hidden: false };
  if (type === 'formula') return { id, type, text: '', hidden: false };
  if (type === 'table') return { id, type, rows: [['']], hidden: false };
  if (type === 'activity') return { id, type, learningActivityVersionId: '', hidden: false };
  if (type === 'manual-material') return { id, type, learningActivityVersionId: '', hidden: false };
  return { id, type: 'divider', hidden: false };
}

function cloneLessonBlock(source: LessonBlock): LessonBlock {
  if (source.type === 'table') {
    return {
      ...source,
      id: nextId(),
      rows: source.rows.map((row) => [...row]),
    };
  }
  return { ...source, id: nextId() };
}

export function duplicateLessonBlock(
  blocks: readonly LessonBlock[],
  sourceId: string,
): LessonBlock[] {
  if (blocks.length >= MAX_LESSON_BLOCKS) return [...blocks];
  const index = blocks.findIndex((block) => block.id === sourceId);
  if (index < 0) return [...blocks];
  const source = blocks[index];
  if (!source) return [...blocks];
  const next = [...blocks];
  next.splice(index + 1, 0, cloneLessonBlock(source));
  return next;
}

export function setLessonBlockHidden(
  blocks: readonly LessonBlock[],
  sourceId: string,
  hidden: boolean,
): LessonBlock[] {
  return blocks.map((block) => (block.id === sourceId ? { ...block, hidden } : block));
}

export function setLessonActivityVersion(
  blocks: readonly LessonBlock[],
  sourceId: string,
  learningActivityVersionId: string,
): LessonBlock[] {
  return blocks.map((block) =>
    block.id === sourceId && (block.type === 'activity' || block.type === 'manual-material')
      ? { ...block, learningActivityVersionId }
      : block,
  );
}

export function insertLessonBlock(
  blocks: readonly LessonBlock[],
  sourceId: string,
  placement: 'before' | 'after',
  type: LessonBlock['type'],
): LessonBlock[] {
  if (blocks.length >= MAX_LESSON_BLOCKS) return [...blocks];
  const index = blocks.findIndex((block) => block.id === sourceId);
  if (index < 0) return [...blocks];
  const next = [...blocks];
  next.splice(index + (placement === 'after' ? 1 : 0), 0, createLessonBlock(type));
  return next;
}

export function moveLessonBlock(
  blocks: readonly LessonBlock[],
  index: number,
  delta: -1 | 1,
): LessonBlock[] {
  const target = index + delta;
  if (index < 0 || index >= blocks.length || target < 0 || target >= blocks.length) {
    return [...blocks];
  }
  const next = [...blocks];
  [next[index], next[target]] = [next[target] as LessonBlock, next[index] as LessonBlock];
  return next;
}

export function deleteLessonBlock(blocks: readonly LessonBlock[], sourceId: string): LessonBlock[] {
  return blocks.filter((block) => block.id !== sourceId);
}

export function lessonBlocksValid(blocks: readonly LessonBlock[]): boolean {
  return (
    blocks.length <= MAX_LESSON_BLOCKS &&
    JSON.stringify(blocks).length <= 60_000 &&
    blocks.every((block) => {
      if (block.hidden !== undefined && typeof block.hidden !== 'boolean') return false;
      if (block.type === 'paragraph') return block.text.length <= 12_000;
      if (block.type === 'heading') {
        return block.text.trim().length > 0 && block.text.length <= 300;
      }
      if (block.type === 'callout') {
        return block.text.trim().length > 0 && block.text.length <= 3_000;
      }
      if (block.type === 'image') {
        return localMediaUrl(block.url) && block.alt.length <= 300 && block.caption.length <= 600;
      }
      if (block.type === 'video' || block.type === 'audio') {
        return localMediaUrl(block.url) && block.title.length <= 300;
      }
      if (block.type === 'file') {
        return fileUrl(block.url) && block.label.trim().length > 0 && block.label.length <= 300;
      }
      if (block.type === 'code') {
        return (
          block.text.length <= CODE_TEXT_LIMIT &&
          (block.language === undefined || CODE_LANGUAGE.test(block.language))
        );
      }
      if (block.type === 'formula') {
        return block.text.trim().length > 0 && block.text.length <= FORMULA_TEXT_LIMIT;
      }
      if (block.type === 'table') return tableRowsValid(block.rows);
      if (block.type === 'activity' || block.type === 'manual-material') {
        return ACTIVITY_VERSION_ID.test(block.learningActivityVersionId);
      }
      return block.type === 'divider';
    })
  );
}

const ADD_OPTIONS: Array<{ type: LessonBlock['type']; label: string }> = [
  { type: 'paragraph', label: 'Текст' },
  { type: 'heading', label: 'Заголовок' },
  { type: 'callout', label: 'Врезка' },
  { type: 'code', label: 'Код' },
  { type: 'formula', label: 'Формула' },
  { type: 'table', label: 'Таблица' },
  { type: 'divider', label: 'Разделитель' },
  { type: 'image', label: 'Картинка' },
  { type: 'video', label: 'Видео' },
  { type: 'audio', label: 'Аудио' },
  { type: 'file', label: 'Файл' },
  { type: 'activity', label: 'Практика' },
  { type: 'manual-material', label: 'Материал из библиотеки' },
];

function blockLabel(block: LessonBlock): string {
  return ADD_OPTIONS.find((entry) => entry.type === block.type)?.label ?? 'Блок';
}

export function LessonBlockEditor({
  blocks,
  onChange,
}: {
  readonly blocks: readonly LessonBlock[];
  readonly activities: readonly LessonActivityOption[];
  readonly onChange: (blocks: LessonBlock[]) => void;
}): JSX.Element {
  const editorRef = useRef<HTMLElement>(null);
  const [insertTarget, setInsertTarget] = useState<{
    blockId: string;
    placement: 'before' | 'after';
  } | null>(null);

  function replace(id: string, block: LessonBlock): void {
    onChange(blocks.map((entry) => (entry.id === id ? block : entry)));
  }
  function focusBlock(id: string, index: number): void {
    requestAnimationFrame(() => {
      const cards = [
        ...(editorRef.current?.querySelectorAll<HTMLElement>('[data-course-block-id]') ?? []),
      ];
      const card =
        cards.find((entry) => entry.dataset.courseBlockId === id) ?? cards[index] ?? cards.at(-1);
      const target =
        card?.querySelector<HTMLElement>('summary') ??
        editorRef.current?.querySelector<HTMLElement>('.lesson-block-add > summary');
      target?.focus();
    });
  }

  return (
    <section
      ref={editorRef}
      className="lesson-block-editor"
      aria-labelledby="lesson-block-editor-title"
      data-course-field="blocks"
      tabIndex={-1}
    >
      <div className="lesson-block-editor-head">
        <div>
          <strong id="lesson-block-editor-title">Содержание урока</strong>
          <small>Соберите страницу из коротких блоков</small>
        </div>
        <span>
          {blocks.length}/{MAX_LESSON_BLOCKS}
        </span>
      </div>

      <div className="lesson-block-list" data-testid="lesson-block-list">
        {blocks.length === 0 ? (
          <div className="lesson-block-empty">
            <strong>Страница пока пустая</strong>
            <span>Добавьте текст, медиа, практику или полезную ссылку.</span>
          </div>
        ) : null}
        {blocks.map((block, index) => (
          <article
            key={block.id}
            className={block.hidden ? 'lesson-block-card is-hidden' : 'lesson-block-card'}
            data-course-block-id={block.id}
            data-course-field="blocks"
            tabIndex={-1}
          >
            <header>
              <span>
                {blockLabel(block)}
                {block.hidden ? <small className="lesson-block-hidden-state">Скрыт</small> : null}
              </span>
              <Dropdown
                className="course-outline-menu lesson-block-menu"
                fitViewport
                ariaLabel={`Действия блока ${index + 1}`}
                label={<span aria-hidden="true">•••</span>}
              >
                {(close) => (
                  <div
                    onClick={() => {
                      close();
                      focusBlock(block.id, index);
                    }}
                  >
                    <button
                      type="button"
                      className="lesson-block-structural-button"
                      disabled={blocks.length >= MAX_LESSON_BLOCKS}
                      onClick={() => onChange(duplicateLessonBlock(blocks, block.id))}
                    >
                      Дублировать
                    </button>
                    <button
                      type="button"
                      className="lesson-block-structural-button"
                      onClick={() =>
                        onChange(setLessonBlockHidden(blocks, block.id, !block.hidden))
                      }
                      data-course-field="hidden"
                    >
                      {block.hidden ? 'Показать' : 'Скрыть'}
                    </button>
                    <button
                      type="button"
                      className="lesson-block-structural-button"
                      disabled={blocks.length >= MAX_LESSON_BLOCKS}
                      onClick={() => setInsertTarget({ blockId: block.id, placement: 'before' })}
                    >
                      Вставить выше
                    </button>
                    <button
                      type="button"
                      className="lesson-block-structural-button"
                      disabled={blocks.length >= MAX_LESSON_BLOCKS}
                      onClick={() => setInsertTarget({ blockId: block.id, placement: 'after' })}
                    >
                      Вставить ниже
                    </button>
                    <button
                      type="button"
                      aria-label={`Поднять блок ${index + 1}`}
                      disabled={index === 0}
                      onClick={() => onChange(moveLessonBlock(blocks, index, -1))}
                    >
                      Поднять
                    </button>
                    <button
                      type="button"
                      aria-label={`Опустить блок ${index + 1}`}
                      disabled={index === blocks.length - 1}
                      onClick={() => onChange(moveLessonBlock(blocks, index, 1))}
                    >
                      Опустить
                    </button>
                    <button
                      type="button"
                      aria-label={`Удалить блок ${index + 1}`}
                      onClick={() => onChange(deleteLessonBlock(blocks, block.id))}
                    >
                      Удалить
                    </button>
                  </div>
                )}
              </Dropdown>
            </header>

            {insertTarget?.blockId === block.id ? (
              <div
                className="lesson-block-insert-picker"
                aria-label="Выберите тип вставляемого блока"
              >
                <small>
                  {insertTarget.placement === 'before' ? 'Вставить выше' : 'Вставить ниже'}
                </small>
                <div>
                  {ADD_OPTIONS.map((option) => (
                    <button
                      key={option.type}
                      type="button"
                      onClick={() => {
                        onChange(
                          insertLessonBlock(blocks, block.id, insertTarget.placement, option.type),
                        );
                        setInsertTarget(null);
                      }}
                    >
                      + {option.label}
                    </button>
                  ))}
                  <button type="button" onClick={() => setInsertTarget(null)}>
                    Отмена
                  </button>
                </div>
              </div>
            ) : null}

            {block.type === 'paragraph' ? (
              <GrowingTextarea
                aria-label="Текст блока"
                data-course-field="text"
                value={block.text}
                maxLength={12_000}
                placeholder="Объяснение, инструкция или вводный текст"
                onChange={(event) => replace(block.id, { ...block, text: event.target.value })}
              />
            ) : null}

            {block.type === 'heading' ? (
              <div className="lesson-block-fields is-heading">
                <select
                  aria-label="Уровень заголовка"
                  data-course-field="level"
                  value={block.level}
                  onChange={(event) =>
                    replace(block.id, {
                      ...block,
                      level: Number(event.target.value) as 2 | 3,
                    })
                  }
                >
                  <option value={2}>Крупный</option>
                  <option value={3}>Средний</option>
                </select>
                <GrowingTextarea
                  aria-label="Текст заголовка"
                  data-course-field="text"
                  value={block.text}
                  maxLength={300}
                  placeholder="Новая тема"
                  onChange={(event) => replace(block.id, { ...block, text: event.target.value })}
                />
              </div>
            ) : null}

            {block.type === 'callout' ? (
              <div className="lesson-block-fields">
                <select
                  aria-label="Тип врезки"
                  data-course-field="tone"
                  value={block.tone}
                  onChange={(event) =>
                    replace(block.id, {
                      ...block,
                      tone: event.target.value as 'note' | 'tip' | 'warning',
                    })
                  }
                >
                  <option value="note">Важно</option>
                  <option value="tip">Совет</option>
                  <option value="warning">Предупреждение</option>
                </select>
                <GrowingTextarea
                  aria-label="Текст врезки"
                  data-course-field="text"
                  value={block.text}
                  maxLength={3_000}
                  placeholder="Коротко выделите главную мысль"
                  onChange={(event) => replace(block.id, { ...block, text: event.target.value })}
                />
              </div>
            ) : null}

            {block.type === 'code' ? (
              <div className="lesson-block-fields">
                <input
                  aria-label="Язык кода"
                  data-course-field="language"
                  value={block.language ?? ''}
                  maxLength={80}
                  placeholder="Например, javascript"
                  onChange={(event) => {
                    const language = event.target.value;
                    if (language) {
                      replace(block.id, { ...block, language });
                      return;
                    }
                    const withoutLanguage = { ...block };
                    delete withoutLanguage.language;
                    replace(block.id, withoutLanguage);
                  }}
                />
                <GrowingTextarea
                  aria-label="Код"
                  data-course-field="text"
                  value={block.text}
                  maxLength={CODE_TEXT_LIMIT}
                  spellCheck={false}
                  placeholder="Вставьте код без HTML-исполнения"
                  onChange={(event) => replace(block.id, { ...block, text: event.target.value })}
                />
              </div>
            ) : null}

            {block.type === 'formula' ? (
              <GrowingTextarea
                aria-label="Формула"
                data-course-field="text"
                value={block.text}
                maxLength={FORMULA_TEXT_LIMIT}
                placeholder="Например, U = I × R"
                onChange={(event) => replace(block.id, { ...block, text: event.target.value })}
              />
            ) : null}

            {block.type === 'table' ? (
              <div className="lesson-block-fields lesson-table-editor" data-course-field="rows">
                <div className="lesson-table-actions">
                  <button
                    type="button"
                    disabled={block.rows.length >= TABLE_ROW_LIMIT}
                    onClick={() =>
                      replace(block.id, {
                        ...block,
                        rows: [
                          ...block.rows,
                          Array.from({ length: block.rows[0]?.length ?? 1 }, () => ''),
                        ],
                      })
                    }
                  >
                    + Строка
                  </button>
                  <button
                    type="button"
                    disabled={block.rows.length <= 1}
                    onClick={() => replace(block.id, { ...block, rows: block.rows.slice(0, -1) })}
                  >
                    − Строка
                  </button>
                  <button
                    type="button"
                    disabled={(block.rows[0]?.length ?? 1) >= TABLE_COLUMN_LIMIT}
                    onClick={() =>
                      replace(block.id, {
                        ...block,
                        rows: block.rows.map((row) => [...row, '']),
                      })
                    }
                  >
                    + Столбец
                  </button>
                  <button
                    type="button"
                    disabled={(block.rows[0]?.length ?? 1) <= 1}
                    onClick={() =>
                      replace(block.id, {
                        ...block,
                        rows: block.rows.map((row) => row.slice(0, -1)),
                      })
                    }
                  >
                    − Столбец
                  </button>
                </div>
                <div
                  className="lesson-table-grid"
                  style={{
                    gridTemplateColumns: `repeat(${block.rows[0]?.length ?? 1}, minmax(8rem, 1fr))`,
                  }}
                >
                  {block.rows.flatMap((row, rowIndex) =>
                    row.map((cell, columnIndex) => (
                      <input
                        key={`${rowIndex}:${columnIndex}`}
                        aria-label={`Ячейка ${rowIndex + 1}:${columnIndex + 1}`}
                        value={cell}
                        maxLength={TABLE_CELL_TEXT_LIMIT}
                        onChange={(event) => {
                          const rows = block.rows.map((current) => [...current]);
                          const targetRow = rows[rowIndex];
                          if (!targetRow) return;
                          targetRow[columnIndex] = event.target.value;
                          replace(block.id, { ...block, rows });
                        }}
                      />
                    )),
                  )}
                </div>
              </div>
            ) : null}

            {block.type === 'divider' ? (
              <p className="lesson-divider-editor-note">Разделитель не содержит текста.</p>
            ) : null}

            {block.type === 'activity' ? (
              <div data-course-field="learningActivityVersionId">
                <CanonicalPracticePicker
                  value={block.learningActivityVersionId}
                  onChange={(versionId) =>
                    onChange(setLessonActivityVersion(blocks, block.id, versionId))
                  }
                />
              </div>
            ) : null}

            {block.type === 'manual-material' ? (
              <div data-course-field="learningActivityVersionId">
                <CanonicalManualMaterialPicker
                  value={block.learningActivityVersionId}
                  onChange={(versionId) =>
                    onChange(setLessonActivityVersion(blocks, block.id, versionId))
                  }
                />
              </div>
            ) : null}

            {block.type === 'image' ? (
              <div className="lesson-block-fields">
                <input
                  aria-label="Ссылка на изображение"
                  data-course-field="url"
                  type="text"
                  value={block.url}
                  maxLength={2_000}
                  placeholder="/assets/…"
                  onChange={(event) => replace(block.id, { ...block, url: event.target.value })}
                />
                <div className="lesson-block-fields is-split">
                  <GrowingTextarea
                    aria-label="Описание изображения"
                    data-course-field="alt"
                    value={block.alt}
                    maxLength={300}
                    placeholder="Что изображено"
                    onChange={(event) => replace(block.id, { ...block, alt: event.target.value })}
                  />
                  <GrowingTextarea
                    aria-label="Подпись изображения"
                    data-course-field="caption"
                    value={block.caption}
                    maxLength={600}
                    placeholder="Подпись, если нужна"
                    onChange={(event) =>
                      replace(block.id, { ...block, caption: event.target.value })
                    }
                  />
                </div>
              </div>
            ) : null}

            {block.type === 'video' || block.type === 'audio' ? (
              <div className="lesson-block-fields is-split">
                <input
                  aria-label={block.type === 'video' ? 'Ссылка на видео' : 'Ссылка на аудио'}
                  data-course-field="url"
                  type="text"
                  value={block.url}
                  maxLength={2_000}
                  placeholder="/assets/…"
                  onChange={(event) => replace(block.id, { ...block, url: event.target.value })}
                />
                <GrowingTextarea
                  aria-label="Название медиа"
                  data-course-field="title"
                  value={block.title}
                  maxLength={300}
                  placeholder="Название, если нужно"
                  onChange={(event) => replace(block.id, { ...block, title: event.target.value })}
                />
              </div>
            ) : null}

            {block.type === 'file' ? (
              <div className="lesson-block-fields is-split">
                <input
                  aria-label="Ссылка на файл"
                  data-course-field="url"
                  type="text"
                  value={block.url}
                  maxLength={2_000}
                  placeholder="https://… или /assets/…"
                  onChange={(event) => replace(block.id, { ...block, url: event.target.value })}
                />
                <GrowingTextarea
                  aria-label="Название файла"
                  data-course-field="label"
                  value={block.label}
                  maxLength={300}
                  placeholder="Например, Памятка PDF"
                  onChange={(event) => replace(block.id, { ...block, label: event.target.value })}
                />
              </div>
            ) : null}
              {isMediaLessonBlock(block) ? <InlineMediaPreview block={block} index={index} /> : null}
          </article>
        ))}
      </div>

      <Dropdown
        className="lesson-block-add"
        label="+ Добавить содержимое"
        fitViewport
        disabled={blocks.length >= MAX_LESSON_BLOCKS}
      >
        {(close) => (
          <div role="menu" aria-label="Добавить содержимое урока">
            {ADD_OPTIONS.filter((option) => option.type !== 'video' && option.type !== 'audio').map(
              (option) => (
                <button
                  key={option.type}
                  type="button"
                  role="menuitem"
                  disabled={blocks.length >= MAX_LESSON_BLOCKS}
                  onClick={() => {
                    onChange([...blocks, createLessonBlock(option.type)]);
                    close();
                  }}
                >
                  + {option.label}
                </button>
              ),
            )}
            <button
              type="button"
              role="menuitem"
              disabled={blocks.length >= MAX_LESSON_BLOCKS}
              onClick={() => {
                onChange([
                  ...blocks,
                  {
                    ...createLessonBlock('file'),
                    type: 'file',
                    url: '',
                    label: 'Видео · внешняя ссылка',
                  },
                ]);
                close();
              }}
            >
              + Видео по ссылке
            </button>
          </div>
        )}
      </Dropdown>
      <small className="lesson-block-url-hint">
        Файл и видео по HTTPS-ссылке открываются отдельно. Загрузка видео здесь недоступна.
        Существующие медиа платформы сохраняются.
      </small>
    </section>
  );
}
