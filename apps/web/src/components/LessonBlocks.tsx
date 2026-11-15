import { useRef, useState, type ReactNode } from 'react';
import type { LessonBlock } from '../api';
import './lesson-blocks.css';

function visibleBlocks(
  blocks: readonly LessonBlock[],
  legacyContent: string | null,
): LessonBlock[] {
  if (blocks.length > 0) return blocks.filter((block) => block.hidden !== true);
  return legacyContent ? [{ id: 'legacy', type: 'paragraph', text: legacyContent }] : [];
}

function isLocalMedia(url: string): boolean {
  return url.startsWith('/assets/') && !url.includes('..');
}

function ExternalMediaLink({
  url,
  label,
}: {
  readonly url: string;
  readonly label: string;
}): JSX.Element {
  return (
    <a className="lesson-file-block" href={url} target="_blank" rel="noreferrer">
      <span aria-hidden="true">↗</span>
      <span>
        <strong>{label}</strong>
        <small>Открыть внешний материал</small>
      </span>
    </a>
  );
}

type LocalMedia = Extract<LessonBlock, { type: 'image' | 'video' | 'audio' }>;

function LocalMediaBlock({ block }: { readonly block: LocalMedia }): JSX.Element {
  const container = useRef<HTMLElement | null>(null);
  const [state, setState] = useState({ attempt: 0, failed: false });
  const attempt = state.attempt;
  const setContainer = (element: HTMLElement | null) => {
    container.current = element;
  };
  const setFailed = (failed: boolean) => {
    // An event queued by a removed element must not affect a later retry.
    setState((current) =>
      current.attempt === attempt && current.failed !== failed ? { ...current, failed } : current,
    );
  };
  const retry = () => {
    // Keep keyboard focus in this block when its retry button disappears.
    container.current?.focus({ preventScroll: true });
    setState((current) => ({ attempt: current.attempt + 1, failed: false }));
  };
  const failure = state.failed ? (
    <div className="lesson-media-error">
      <p role="alert">
        {block.type === 'image'
          ? 'Не удалось загрузить изображение'
          : block.type === 'video'
            ? 'Не удалось загрузить видео'
            : 'Не удалось загрузить аудио'}
      </p>
      <div className="lesson-media-error-actions">
        <button type="button" onClick={retry}>
          Повторить загрузку
        </button>
        <a href={block.url} target="_blank" rel="noreferrer">
          Открыть отдельно
        </a>
      </div>
    </div>
  ) : null;

  if (block.type === 'image') {
    return (
      <figure className="lesson-media-block" ref={setContainer} tabIndex={-1}>
        <img
          key={attempt}
          src={block.url}
          alt={block.alt}
          loading="lazy"
          onError={() => setFailed(true)}
          onLoad={() => setFailed(false)}
        />
        {block.caption ? <figcaption>{block.caption}</figcaption> : null}
        {failure}
      </figure>
    );
  }
  if (block.type === 'video') {
    return (
      <figure className="lesson-media-block" ref={setContainer} tabIndex={-1}>
        {block.title ? <figcaption>{block.title}</figcaption> : null}
        <video
          key={attempt}
          controls
          preload="metadata"
          src={block.url}
          onError={() => setFailed(true)}
          onLoadedData={() => setFailed(false)}
        />
        {failure}
      </figure>
    );
  }
  return (
    <div className="lesson-audio-block" ref={setContainer} tabIndex={-1}>
      {block.title ? <strong>{block.title}</strong> : null}
      <audio
        key={attempt}
        controls
        preload="metadata"
        src={block.url}
        onError={() => setFailed(true)}
        onLoadedData={() => setFailed(false)}
      />
      {failure}
    </div>
  );
}

export function LessonBlocks({
  blocks,
  legacyContent = null,
  compact = false,
  mediaScopeKey,
  renderActivity,
  renderMaterial,
}: {
  readonly blocks: readonly LessonBlock[];
  readonly legacyContent?: string | null;
  readonly compact?: boolean;
  /** Copied lessons can retain block IDs; only their media state needs a new scope. */
  readonly mediaScopeKey?: string;
  readonly renderActivity?: (block: Extract<LessonBlock, { type: 'activity' }>) => ReactNode;
  readonly renderMaterial?: (block: Extract<LessonBlock, { type: 'manual-material' }>) => ReactNode;
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
        if (block.type === 'code') {
          return (
            <pre key={block.id} className="lesson-code-block">
              <code data-language={block.language}>{block.text}</code>
            </pre>
          );
        }
        if (block.type === 'formula') {
          return (
            <div key={block.id} className="lesson-formula-block" role="math" aria-label="Формула">
              {block.text}
            </div>
          );
        }
        if (block.type === 'table') {
          return (
            <div key={block.id} className="lesson-table-wrap">
              <table className="lesson-table-block">
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, columnIndex) => (
                        <td key={columnIndex}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.type === 'divider') {
          return <hr key={block.id} className="lesson-divider-block" />;
        }
        if (block.type === 'image') {
          if (!isLocalMedia(block.url)) {
            return (
              <ExternalMediaLink
                key={block.id}
                url={block.url}
                label={block.caption || block.alt || 'Изображение'}
              />
            );
          }
          return (
            <LocalMediaBlock
              key={JSON.stringify([mediaScopeKey, block.id, block.type, block.url])}
              block={block}
            />
          );
        }
        if (block.type === 'video') {
          if (!isLocalMedia(block.url)) {
            return (
              <ExternalMediaLink key={block.id} url={block.url} label={block.title || 'Видео'} />
            );
          }
          return (
            <LocalMediaBlock
              key={JSON.stringify([mediaScopeKey, block.id, block.type, block.url])}
              block={block}
            />
          );
        }
        if (block.type === 'activity') {
          return (
            <section
              key={block.id}
              className="lesson-activity-block"
              data-testid="lesson-activity-block"
              data-block-id={block.id}
            >
              {renderActivity ? (
                renderActivity(block)
              ) : (
                <strong className="lesson-activity-placeholder">Практика</strong>
              )}
            </section>
          );
        }
        if (block.type === 'manual-material') {
          return (
            <section
              key={block.id}
              className="lesson-material-block"
              data-testid="lesson-material-block"
              data-block-id={block.id}
            >
              {renderMaterial ? renderMaterial(block) : <strong>Материал</strong>}
            </section>
          );
        }
        if (block.type === 'audio') {
          if (!isLocalMedia(block.url)) {
            return (
              <ExternalMediaLink key={block.id} url={block.url} label={block.title || 'Аудио'} />
            );
          }
          return (
            <LocalMediaBlock
              key={JSON.stringify([mediaScopeKey, block.id, block.type, block.url])}
              block={block}
            />
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
