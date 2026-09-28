import { useEffect, useState } from 'react';
import type { SafeTaskBlock } from '../api';
import './task-blocks.css';

function safeHref(value: string): string | null {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

function TaskImage({ block }: { readonly block: Extract<SafeTaskBlock, { type: 'image' }> }) {
  const [unavailable, setUnavailable] = useState(false);
  const src =
    block.src?.startsWith('/api/learning/activities/') === true
      ? block.src
      : `/api/assignments/task-images/${encodeURIComponent(block.contentHash)}`;
  useEffect(() => setUnavailable(false), [src]);
  return (
    <figure className="task-block-image">
      {unavailable ? (
        <p role="alert">Изображение задания недоступно. Обновите задание и попробуйте снова.</p>
      ) : (
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Открыть крупно: ${block.alt}`}
        >
          <img src={src} alt={block.alt} onError={() => setUnavailable(true)} />
        </a>
      )}
      <figcaption>{block.alt}</figcaption>
    </figure>
  );
}

/** Render ordered safe task blocks without interpreting author text as HTML. */
export function TaskBlocks({ blocks }: { readonly blocks: SafeTaskBlock[] }): JSX.Element {
  return (
    <div className="task-blocks" data-testid="task-blocks">
      {blocks.map((block, index) => {
        if (block.type === 'image') return <TaskImage key={index} block={block} />;
        if (block.type === 'heading')
          return (
            <h3 key={index} className="task-block-heading">
              {block.text}
            </h3>
          );
        if (block.type === 'paragraph')
          return (
            <p key={index} className="task-block-paragraph">
              {block.text}
            </p>
          );
        if (block.type === 'callout')
          return (
            <aside key={index} className="task-block-callout">
              {block.text}
            </aside>
          );
        if (block.type === 'list')
          return (
            <ul key={index} className="task-block-list">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          );
        if (block.type === 'link') {
          const href = safeHref(block.href);
          return (
            <p key={index} className="task-block-link">
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {block.text}
                </a>
              ) : (
                block.text
              )}
            </p>
          );
        }
        return null;
      })}
    </div>
  );
}
