import { useState } from 'react';
import type { LessonBlock } from '../api';

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
    block.id === sourceId && block.type === 'activity'
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
      if (block.type === 'activity') {
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
];

function blockLabel(block: LessonBlock): string {
  return ADD_OPTIONS.find((entry) => entry.type === block.type)?.label ?? 'Блок';
}

export function LessonBlockEditor({
  blocks,
  activities,
  onChange,
}: {
  readonly blocks: readonly LessonBlock[];
  readonly activities: readonly LessonActivityOption[];
  readonly onChange: (blocks: LessonBlock[]) => void;
}): JSX.Element {
  const [insertTarget, setInsertTarget] = useState<{
    blockId: string;
    placement: 'before' | 'after';
  } | null>(null);

  function replace(id: string, block: LessonBlock): void {
    onChange(blocks.map((entry) => (entry.id === id ? block : entry)));
  }

  return (
    <section className="lesson-block-editor" aria-labelledby="lesson-block-editor-title">
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
          >
            <header>
              <span>
                {blockLabel(block)}
                {block.hidden ? <small className="lesson-block-hidden-state">Скрыт</small> : null}
              </span>
              <div>
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
                  onClick={() => onChange(setLessonBlockHidden(blocks, block.id, !block.hidden))}
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
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Опустить блок ${index + 1}`}
                  disabled={index === blocks.length - 1}
                  onClick={() => onChange(moveLessonBlock(blocks, index, 1))}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Удалить блок ${index + 1}`}
                  onClick={() => onChange(deleteLessonBlock(blocks, block.id))}
                >
                  ×
                </button>
              </div>
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
              <textarea
                aria-label="Текст блока"
                value={block.text}
                rows={5}
                maxLength={12_000}
                placeholder="Объяснение, инструкция или вводный текст"
                onChange={(event) => replace(block.id, { ...block, text: event.target.value })}
              />
            ) : null}

            {block.type === 'heading' ? (
              <div className="lesson-block-fields is-heading">
                <select
                  aria-label="Уровень заголовка"
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
                <input
                  aria-label="Текст заголовка"
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
                <textarea
                  aria-label="Текст врезки"
                  value={block.text}
                  rows={3}
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
                <textarea
                  aria-label="Код"
                  value={block.text}
                  rows={7}
                  maxLength={CODE_TEXT_LIMIT}
                  spellCheck={false}
                  placeholder="Вставьте код без HTML-исполнения"
                  onChange={(event) => replace(block.id, { ...block, text: event.target.value })}
                />
              </div>
            ) : null}

            {block.type === 'formula' ? (
              <textarea
                aria-label="Формула"
                value={block.text}
                rows={2}
                maxLength={FORMULA_TEXT_LIMIT}
                placeholder="Например, U = I × R"
                onChange={(event) => replace(block.id, { ...block, text: event.target.value })}
              />
            ) : null}

            {block.type === 'table' ? (
              <div className="lesson-block-fields lesson-table-editor">
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
              <label className="lesson-block-fields">
                <span>Опубликованная активность</span>
                <select
                  aria-label="Опубликованная активность"
                  value={block.learningActivityVersionId}
                  onChange={(event) =>
                    onChange(setLessonActivityVersion(blocks, block.id, event.target.value))
                  }
                >
                  <option value="">Выберите опубликованную активность…</option>
                  {activities.map((entry) => (
                    <option
                      key={entry.id}
                      value={entry.currentPublishedVersionId ?? `draft:${entry.id}`}
                      disabled={!entry.currentPublishedVersionId}
                    >
                      {entry.title}
                      {entry.currentPublishedVersionId ? '' : ' · черновик — сначала опубликуйте'}
                    </option>
                  ))}
                  {block.learningActivityVersionId &&
                  !activities.some(
                    (entry) => entry.currentPublishedVersionId === block.learningActivityVersionId,
                  ) ? (
                    <option value={block.learningActivityVersionId}>Закреплённая версия</option>
                  ) : null}
                </select>
              </label>
            ) : null}

            {block.type === 'image' ? (
              <div className="lesson-block-fields">
                <input
                  aria-label="Ссылка на изображение"
                  type="text"
                  value={block.url}
                  maxLength={2_000}
                  placeholder="/assets/…"
                  onChange={(event) => replace(block.id, { ...block, url: event.target.value })}
                />
                <div className="lesson-block-fields is-split">
                  <input
                    aria-label="Описание изображения"
                    value={block.alt}
                    maxLength={300}
                    placeholder="Что изображено"
                    onChange={(event) => replace(block.id, { ...block, alt: event.target.value })}
                  />
                  <input
                    aria-label="Подпись изображения"
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
                  type="text"
                  value={block.url}
                  maxLength={2_000}
                  placeholder="/assets/…"
                  onChange={(event) => replace(block.id, { ...block, url: event.target.value })}
                />
                <input
                  aria-label="Название медиа"
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
                  type="text"
                  value={block.url}
                  maxLength={2_000}
                  placeholder="https://… или /assets/…"
                  onChange={(event) => replace(block.id, { ...block, url: event.target.value })}
                />
                <input
                  aria-label="Название файла"
                  value={block.label}
                  maxLength={300}
                  placeholder="Например, Памятка PDF"
                  onChange={(event) => replace(block.id, { ...block, label: event.target.value })}
                />
              </div>
            ) : null}
          </article>
        ))}
      </div>

      <div className="lesson-block-add" aria-label="Добавить блок">
        {ADD_OPTIONS.map((option) => (
          <button
            key={option.type}
            type="button"
            disabled={blocks.length >= MAX_LESSON_BLOCKS}
            onClick={() => onChange([...blocks, createLessonBlock(option.type)])}
          >
            + {option.label}
          </button>
        ))}
      </div>
      <small className="lesson-block-url-hint">
        Картинки, видео и аудио загружаются только с этой платформы: укажите путь /assets/… . Для
        файла можно оставить защищённую https-ссылку — она откроется отдельно.
      </small>
    </section>
  );
}
