import { useState } from 'react';
import type { SafeTaskBlock } from '../api';

const choices = [
  ['paragraph', 'Текст'],
  ['heading', 'Заголовок'],
  ['list', 'Список'],
  ['callout', 'Примечание'],
  ['link', 'Ссылка на сайт или видео'],
] as const;

function emptyBlock(type: (typeof choices)[number][0]): SafeTaskBlock {
  return type === 'list'
    ? { type, items: [''] }
    : type === 'link'
      ? { type, text: '', href: '' }
      : { type, text: '' };
}

export function AuthoredTaskBlocksEditor({
  blocks,
  instructions,
  disabled,
  onChange,
  onImageUpload,
  onFileUpload,
  onSampleUpload,
  imageUrl,
}: {
  readonly blocks: SafeTaskBlock[] | undefined;
  readonly instructions: string | null;
  readonly disabled: boolean;
  readonly onChange: (blocks: SafeTaskBlock[]) => void;
  readonly onImageUpload: (file: File) => void;
  readonly onFileUpload: (file: File) => void;
  readonly onSampleUpload?: (file: File) => void;
  readonly imageUrl: (contentHash: string) => string;
}): JSX.Element {
  const items = blocks ?? [];
  const blockLimit = instructions?.trim() ? 31 : 32;
  const [addOpen, setAddOpen] = useState(false);

  function replace(index: number, block: SafeTaskBlock) {
    onChange(items.map((current, position) => (position === index ? block : current)));
  }

  function move(index: number, offset: number) {
    const reordered = [...items];
    const [block] = reordered.splice(index, 1);
    reordered.splice(index + offset, 0, block!);
    onChange(reordered);
  }

  function add(type: (typeof choices)[number][0]) {
    onChange([...items, emptyBlock(type)]);
    setAddOpen(false);
  }

  return (
    <fieldset className="task-document-blocks" aria-label="Блоки задания" disabled={disabled}>
      <legend className="sr-only">Блоки задания</legend>

      <div className="task-document-stack">
        {items.map((block, index) => (
          <section
            className={`task-document-block is-${block.type}`}
            key={index}
            data-testid="authored-task-block"
          >
            <div className="task-document-block-actions" aria-label={`Действия блока ${index + 1}`}>
              <button
                type="button"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label={`Поднять блок ${index + 1}`}
                title="Выше"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={index === items.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Опустить блок ${index + 1}`}
                title="Ниже"
              >
                ↓
              </button>
              <button
                type="button"
                className="is-danger"
                onClick={() => onChange(items.filter((_, position) => position !== index))}
                aria-label={`Удалить блок ${index + 1}`}
                title="Удалить"
              >
                ×
              </button>
            </div>

            {block.type === 'image' ? (
              <div className="task-document-media">
                <img
                  className="task-block-editor-image"
                  src={imageUrl(block.contentHash)}
                  alt={block.alt}
                />
                <div className="task-document-media-meta">
                  <label>
                    <span className="sr-only">Описание изображения</span>
                    <input
                      className="task-document-caption"
                      aria-label={`Описание блока ${index + 1}`}
                      maxLength={160}
                      placeholder="Описание изображения"
                      value={block.alt}
                      onChange={(event) => replace(index, { ...block, alt: event.target.value })}
                    />
                  </label>
                  <label className="task-file-action">
                    Заменить изображение
                    <input
                      className="task-file-input"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      aria-label={`Заменить файл блока ${index + 1}`}
                      disabled={disabled}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (file) onImageUpload(file);
                      }}
                    />
                  </label>
                </div>
              </div>
            ) : block.type === 'file' ? (
              <div className="task-document-file">
                <span className="task-document-file-icon" aria-hidden="true">
                  PDF
                </span>
                <span className="task-document-file-name">{block.name}</span>
                <label className="task-file-action">
                  Заменить
                  <input
                    className="task-file-input"
                    type="file"
                    accept="application/pdf,.pdf"
                    aria-label={`Заменить PDF блока ${index + 1}`}
                    disabled={disabled}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) onFileUpload(file);
                    }}
                  />
                </label>
              </div>
            ) : block.type === 'list' ? (
              <label className="task-document-field">
                <span className="sr-only">Пункты, по одному на строку</span>
                <textarea
                  className="task-document-input is-list"
                  aria-label={`Пункты блока ${index + 1}`}
                  rows={Math.max(2, Math.min(6, block.items.length + 1))}
                  placeholder="Пункт списка"
                  value={block.items.join('\n')}
                  onChange={(event) =>
                    replace(index, { type: 'list', items: event.target.value.split('\n') })
                  }
                />
              </label>
            ) : (
              <>
                <label className="task-document-field">
                  <span className="sr-only">Текст блока</span>
                  <textarea
                    className={`task-document-input is-${block.type}`}
                    aria-label={`Текст блока ${index + 1}`}
                    rows={block.type === 'paragraph' || block.type === 'callout' ? 3 : 1}
                    placeholder={
                      block.type === 'heading'
                        ? 'Заголовок'
                        : block.type === 'callout'
                          ? 'Примечание'
                          : block.type === 'link'
                            ? 'Текст ссылки'
                            : 'Введите текст'
                    }
                    value={block.text}
                    onChange={(event) => replace(index, { ...block, text: event.target.value })}
                  />
                </label>
                {block.type === 'link' ? (
                  <label className="task-document-link-url">
                    <span className="sr-only">Адрес HTTPS или HTTP</span>
                    <input
                      aria-label={`Адрес блока ${index + 1}`}
                      type="url"
                      placeholder="https://"
                      value={block.href}
                      onChange={(event) => replace(index, { ...block, href: event.target.value })}
                    />
                  </label>
                ) : null}
              </>
            )}
          </section>
        ))}
      </div>

      <div className="task-add-block">
        <button
          type="button"
          className="task-add-block-trigger"
          disabled={disabled || items.length >= blockLimit}
          aria-expanded={addOpen}
          aria-haspopup="menu"
          onClick={() => setAddOpen((value) => !value)}
        >
          + Добавить содержимое
        </button>

        {addOpen ? (
          <div className="task-add-block-menu" role="menu" aria-label="Добавить содержимое">
            {choices.map(([type, label]) => (
              <button key={type} type="button" role="menuitem" onClick={() => add(type)}>
                <span aria-hidden="true">
                  {type === 'paragraph'
                    ? 'Aa'
                    : type === 'heading'
                      ? 'H'
                      : type === 'list'
                        ? '☷'
                        : type === 'callout'
                          ? '!'
                          : '↗'}
                </span>
                {label}
              </button>
            ))}
            {!items.some((block) => block.type === 'image') ? (
              <label className="task-add-file-item">
                <span aria-hidden="true">▧</span>
                Изображение
                <input
                  className="task-file-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label="Файл блока изображения"
                  disabled={disabled || items.length >= blockLimit}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    setAddOpen(false);
                    if (file) onImageUpload(file);
                  }}
                />
              </label>
            ) : null}
            {!items.some((block) => block.type === 'file') ? (
              <label className="task-add-file-item">
                <span aria-hidden="true">PDF</span>
                PDF
                <input
                  className="task-file-input"
                  type="file"
                  accept="application/pdf,.pdf"
                  aria-label="PDF файл задания"
                  disabled={disabled || items.length >= blockLimit}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    setAddOpen(false);
                    if (file) onFileUpload(file);
                  }}
                />
              </label>
            ) : null}
            {onSampleUpload ? (
              <label className="task-add-file-item">
                <span aria-hidden="true">▧</span>
                Образец практики
                <input
                  className="task-file-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label="Файл схемы или изображения"
                  disabled={disabled}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    setAddOpen(false);
                    if (file) onSampleUpload(file);
                  }}
                />
              </label>
            ) : null}
          </div>
        ) : null}
      </div>
    </fieldset>
  );
}
