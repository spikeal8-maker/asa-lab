import type { LessonBlock } from '../api';

const ASSET_URL = /^\/assets\/[A-Za-z0-9][A-Za-z0-9/_.%-]*$/;

function safeUrl(value: string): boolean {
  return value.startsWith('https://') || (ASSET_URL.test(value) && !value.includes('..'));
}

function nextId(): string {
  return `b-${crypto.randomUUID().replaceAll('-', '')}`;
}

function newBlock(type: LessonBlock['type']): LessonBlock {
  const id = nextId();
  if (type === 'paragraph') return { id, type, text: '' };
  if (type === 'heading') return { id, type, text: '', level: 2 };
  if (type === 'callout') return { id, type, text: '', tone: 'note' };
  if (type === 'image') return { id, type, url: '', alt: '', caption: '' };
  if (type === 'video') return { id, type, url: '', title: '' };
  if (type === 'audio') return { id, type, url: '', title: '' };
  return { id, type, url: '', label: '' };
}

export function lessonBlocksValid(blocks: readonly LessonBlock[]): boolean {
  return (
    blocks.length <= 40 &&
    blocks.every((block) => {
      if (block.type === 'paragraph') return block.text.length <= 12_000;
      if (block.type === 'heading') return block.text.trim().length > 0;
      if (block.type === 'callout') return block.text.trim().length > 0;
      if (block.type === 'file') return safeUrl(block.url) && block.label.trim().length > 0;
      return safeUrl(block.url);
    })
  );
}

const ADD_OPTIONS: Array<{ type: LessonBlock['type']; label: string }> = [
  { type: 'paragraph', label: 'Текст' },
  { type: 'heading', label: 'Заголовок' },
  { type: 'callout', label: 'Врезка' },
  { type: 'image', label: 'Картинка' },
  { type: 'video', label: 'Видео' },
  { type: 'audio', label: 'Аудио' },
  { type: 'file', label: 'Файл' },
];

function blockLabel(block: LessonBlock): string {
  return ADD_OPTIONS.find((entry) => entry.type === block.type)?.label ?? 'Блок';
}

export function LessonBlockEditor({
  blocks,
  onChange,
}: {
  readonly blocks: readonly LessonBlock[];
  readonly onChange: (blocks: LessonBlock[]) => void;
}): JSX.Element {
  function replace(id: string, block: LessonBlock): void {
    onChange(blocks.map((entry) => (entry.id === id ? block : entry)));
  }

  function move(index: number, delta: -1 | 1): void {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target] as LessonBlock, next[index] as LessonBlock];
    onChange(next);
  }

  return (
    <section className="lesson-block-editor" aria-labelledby="lesson-block-editor-title">
      <div className="lesson-block-editor-head">
        <div>
          <strong id="lesson-block-editor-title">Содержание урока</strong>
          <small>Соберите страницу из коротких блоков</small>
        </div>
        <span>{blocks.length}/40</span>
      </div>

      <div className="lesson-block-list" data-testid="lesson-block-list">
        {blocks.length === 0 ? (
          <div className="lesson-block-empty">
            <strong>Страница пока пустая</strong>
            <span>Добавьте текст, медиа или полезную ссылку.</span>
          </div>
        ) : null}
        {blocks.map((block, index) => (
          <article key={block.id} className="lesson-block-card">
            <header>
              <span>{blockLabel(block)}</span>
              <div>
                <button
                  type="button"
                  aria-label={`Поднять блок ${index + 1}`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Опустить блок ${index + 1}`}
                  disabled={index === blocks.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  aria-label={`Удалить блок ${index + 1}`}
                  onClick={() => onChange(blocks.filter((entry) => entry.id !== block.id))}
                >
                  ×
                </button>
              </div>
            </header>

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

            {block.type === 'image' ? (
              <div className="lesson-block-fields">
                <input
                  aria-label="Ссылка на изображение"
                  type="text"
                  value={block.url}
                  maxLength={2_000}
                  placeholder="https://… или /assets/…"
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
                  placeholder="https://… или /assets/…"
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
            disabled={blocks.length >= 40}
            onClick={() => onChange([...blocks, newBlock(option.type)])}
          >
            + {option.label}
          </button>
        ))}
      </div>
      <small className="lesson-block-url-hint">
        Для медиа используйте защищённую https-ссылку или файл из /assets/.
      </small>
    </section>
  );
}
