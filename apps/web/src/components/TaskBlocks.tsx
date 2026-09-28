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

/** Render only the five explicitly authored plain-text block shapes. */
export function TaskBlocks({ blocks }: { readonly blocks: SafeTaskBlock[] }): JSX.Element {
  return (
    <div className="task-blocks" data-testid="task-blocks">
      {blocks.map((block, index) => {
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
