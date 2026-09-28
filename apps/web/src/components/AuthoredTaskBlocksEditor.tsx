import type { SafeTaskBlock } from '../api';

const choices = [
  ['heading', 'Заголовок'],
  ['paragraph', 'Абзац'],
  ['list', 'Список'],
  ['callout', 'Примечание'],
  ['link', 'Ссылка'],
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
  imageUrl,
}: {
  readonly blocks: SafeTaskBlock[] | undefined;
  readonly instructions: string | null;
  readonly disabled: boolean;
  readonly onChange: (blocks: SafeTaskBlock[]) => void;
  readonly onImageUpload: (file: File) => void;
  readonly imageUrl: (contentHash: string) => string;
}): JSX.Element {
  const items = blocks ?? [];
  const blockLimit = instructions?.trim() ? 31 : 32;
  function replace(index: number, block: SafeTaskBlock) {
    onChange(items.map((current, position) => (position === index ? block : current)));
  }
  function move(index: number, offset: number) {
    const reordered = [...items];
    const [block] = reordered.splice(index, 1);
    reordered.splice(index + offset, 0, block!);
    onChange(reordered);
  }
  return (
    <fieldset className="task-block-editor" aria-label="Блоки задания" disabled={disabled}>
      <legend>Блоки задания</legend>
      <p className="account-hint">
        Содержание показывается первым абзацем, затем эти блоки в указанном порядке. Текст выводится
        как текст, без HTML.
      </p>
      <div className="task-block-editor-add">
        {choices.map(([type, label]) => (
          <button
            type="button"
            className="btn-secondary"
            key={type}
            disabled={items.length >= blockLimit}
            onClick={() => onChange([...items, emptyBlock(type)])}
          >
            + {label}
          </button>
        ))}
        {!items.some((block) => block.type === 'image') ? (
          <label className="btn-secondary">
            + Изображение
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label="Файл блока изображения"
              disabled={disabled || items.length >= blockLimit}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) onImageUpload(file);
              }}
            />
          </label>
        ) : null}
      </div>
      {items.map((block, index) => (
        <div className="task-block-editor-item" key={index} data-testid="authored-task-block">
          <strong>
            {index + 1}.{' '}
            {block.type === 'image'
              ? 'Изображение'
              : choices.find(([type]) => type === block.type)?.[1]}
          </strong>
          <div className="task-block-editor-actions">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => move(index, -1)}
              aria-label={`Поднять блок ${index + 1}`}
            >
              ↑
            </button>
            <button
              type="button"
              disabled={index === items.length - 1}
              onClick={() => move(index, 1)}
              aria-label={`Опустить блок ${index + 1}`}
            >
              ↓
            </button>
            <button
              type="button"
              onClick={() => onChange(items.filter((_, position) => position !== index))}
              aria-label={`Удалить блок ${index + 1}`}
            >
              Удалить
            </button>
          </div>
          {block.type === 'image' ? (
            <>
              <img
                className="task-block-editor-image"
                src={imageUrl(block.contentHash)}
                alt={block.alt}
              />
              <label>
                Описание изображения
                <input
                  aria-label={`Описание блока ${index + 1}`}
                  maxLength={160}
                  value={block.alt}
                  onChange={(event) => replace(index, { ...block, alt: event.target.value })}
                />
              </label>
              <label className="btn-secondary">
                Заменить изображение
                <input
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
            </>
          ) : block.type === 'list' ? (
            <label>
              Пункты, по одному на строку
              <textarea
                aria-label={`Пункты блока ${index + 1}`}
                rows={4}
                value={block.items.join('\n')}
                onChange={(event) =>
                  replace(index, { type: 'list', items: event.target.value.split('\n') })
                }
              />
            </label>
          ) : (
            <label>
              Текст блока
              <textarea
                aria-label={`Текст блока ${index + 1}`}
                rows={block.type === 'paragraph' || block.type === 'callout' ? 4 : 2}
                value={block.text}
                onChange={(event) => replace(index, { ...block, text: event.target.value })}
              />
            </label>
          )}
          {block.type === 'link' ? (
            <label>
              Адрес HTTPS или HTTP
              <input
                aria-label={`Адрес блока ${index + 1}`}
                type="url"
                value={block.href}
                onChange={(event) => replace(index, { ...block, href: event.target.value })}
              />
            </label>
          ) : null}
        </div>
      ))}
    </fieldset>
  );
}
