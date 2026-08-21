import type { LessonBlock } from '../api';
import './lesson-blocks.css';

function visibleBlocks(
  blocks: readonly LessonBlock[],
  legacyContent: string | null,
): LessonBlock[] {
  if (blocks.length > 0) return [...blocks];
  return legacyContent ? [{ id: 'legacy', type: 'paragraph', text: legacyContent }] : [];
}

export function LessonBlocks({
  blocks,
  legacyContent = null,
  compact = false,
}: {
  readonly blocks: readonly LessonBlock[];
  readonly legacyContent?: string | null;
  readonly compact?: boolean;
}): JSX.Element | null {
  const content = visibleBlocks(blocks, legacyContent);
  if (content.length === 0) return null;

  return (
    <div className={compact ? 'lesson-blocks is-compact' : 'lesson-blocks'}>
      {content.map((block) => {
        if (block.type === 'paragraph') {
          return <p key={block.id}>{block.text}</p>;
        }
        if (block.type === 'heading') {
          return block.level === 3 ? (
            <h3 key={block.id}>{block.text}</h3>
          ) : (
            <h2 key={block.id}>{block.text}</h2>
          );
        }
        if (block.type === 'callout') {
          return (
            <aside key={block.id} className={`lesson-callout is-${block.tone}`}>
              <strong>
                {block.tone === 'tip'
                  ? 'Совет'
                  : block.tone === 'warning'
                    ? 'Обратите внимание'
                    : 'Важно'}
              </strong>
              <p>{block.text}</p>
            </aside>
          );
        }
        if (block.type === 'image') {
          return (
            <figure key={block.id} className="lesson-media-block">
              <img src={block.url} alt={block.alt} loading="lazy" />
              {block.caption ? <figcaption>{block.caption}</figcaption> : null}
            </figure>
          );
        }
        if (block.type === 'video') {
          return (
            <figure key={block.id} className="lesson-media-block">
              {block.title ? <figcaption>{block.title}</figcaption> : null}
              <video controls preload="metadata" src={block.url} />
            </figure>
          );
        }
        if (block.type === 'audio') {
          return (
            <div key={block.id} className="lesson-audio-block">
              {block.title ? <strong>{block.title}</strong> : null}
              <audio controls preload="metadata" src={block.url} />
            </div>
          );
        }
        return (
          <a
            key={block.id}
            className="lesson-file-block"
            href={block.url}
            target="_blank"
            rel="noreferrer"
          >
            <span aria-hidden="true">↗</span>
            <span>
              <strong>{block.label}</strong>
              <small>Открыть материал</small>
            </span>
          </a>
        );
      })}
    </div>
  );
}
