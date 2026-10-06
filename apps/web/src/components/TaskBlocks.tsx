import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SafeTaskBlock } from '../api';
import { TaskImageReferenceWindow } from './TaskImageReferenceWindow';
import './task-blocks.css';

function safeHref(value: string): string | null {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

export interface TaskImageSelection {
  readonly src: string;
  readonly alt: string;
}

function TaskFile({ block }: { readonly block: Extract<SafeTaskBlock, { type: 'file' }> }) {
  const [unavailable, setUnavailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const src =
    block.src?.startsWith('/api/learning/activities/') === true ||
    block.src?.startsWith('/api/class-join/course-runs/') === true
      ? block.src
      : `/api/assignments/task-files/${encodeURIComponent(block.contentHash)}`;
  useEffect(() => setUnavailable(false), [src]);
  async function download(): Promise<void> {
    setLoading(true);
    setUnavailable(false);
    try {
      const response = await fetch(src, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'application/pdf')
        throw new Error('file unavailable');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = block.name;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="task-block-file">
      <span className="task-block-file-name">{block.name}</span>
      <span className="account-hint">PDF</span>
      <button
        type="button"
        disabled={loading}
        onClick={() => void download()}
        aria-label={`Скачать PDF: ${block.name}`}
      >
        {loading ? 'Загрузка…' : 'Скачать PDF'}
      </button>
      {unavailable ? (
        <p role="alert">Файл задания недоступен. Обновите задание и попробуйте снова.</p>
      ) : null}
    </div>
  );
}

function TaskImage({
  block,
  onPinImage,
}: {
  readonly block: Extract<SafeTaskBlock, { type: 'image' }>;
  readonly onPinImage?: ((image: TaskImageSelection) => void) | undefined;
}) {
  const [unavailable, setUnavailable] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [pinned, setPinned] = useState(false);
  const zoomTrigger = useRef<HTMLButtonElement>(null);
  const zoomClose = useRef<HTMLButtonElement>(null);
  const src =
    block.src?.startsWith('/api/learning/activities/') === true ||
    block.src?.startsWith('/api/class-join/course-runs/') === true
      ? block.src
      : `/api/assignments/task-images/${encodeURIComponent(block.contentHash)}`;
  useEffect(() => {
    setUnavailable(false);
    setZoomed(false);
    setPinned(false);
  }, [src]);

  useEffect(() => {
    if (!zoomed) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeZoom();
      if (event.key === 'Tab') {
        event.preventDefault();
        zoomClose.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomed]);

  function closeZoom(): void {
    setZoomed(false);
    zoomTrigger.current?.focus();
  }

  function imageUnavailable(): void {
    setUnavailable(true);
    setZoomed(false);
    setPinned(false);
  }

  return (
    <figure className="task-block-image">
      {unavailable ? (
        <p role="alert">Изображение задания недоступно. Обновите задание и попробуйте снова.</p>
      ) : (
        <>
          <button
            ref={zoomTrigger}
            type="button"
            className="task-block-image-open"
            aria-label={`Открыть крупно: ${block.alt}`}
            onClick={() => setZoomed(true)}
          >
            <img src={src} alt={block.alt} onError={imageUnavailable} />
          </button>
          <div className="task-block-image-actions">
            <button
              type="button"
              aria-label={`Закрепить изображение: ${block.alt}`}
              onClick={() => (onPinImage ? onPinImage({ src, alt: block.alt }) : setPinned(true))}
            >
              Закрепить рядом
            </button>
          </div>
        </>
      )}
      <figcaption>{block.alt}</figcaption>
      {zoomed && !unavailable
        ? createPortal(
            <div
              className="task-block-image-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label={`Изображение задания: ${block.alt}`}
            >
              <button ref={zoomClose} type="button" autoFocus onClick={closeZoom}>
                Закрыть
              </button>
              <img src={src} alt={block.alt} onError={imageUnavailable} />
            </div>,
            document.body,
          )
        : null}
      {pinned && !unavailable
        ? createPortal(
            <TaskImageReferenceWindow
              src={src}
              assignmentTitle={block.alt}
              imageAlt={block.alt}
              title="Материал"
              onClose={() => setPinned(false)}
            />,
            document.body,
          )
        : null}
    </figure>
  );
}

/** Render ordered safe task blocks without interpreting author text as HTML. */
export function TaskBlocks({
  blocks,
  onPinImage,
}: {
  readonly blocks: SafeTaskBlock[];
  readonly onPinImage?: ((image: TaskImageSelection) => void) | undefined;
}): JSX.Element {
  return (
    <div className="task-blocks" data-testid="task-blocks">
      {blocks.map((block, index) => {
        if (block.type === 'image')
          return <TaskImage key={index} block={block} onPinImage={onPinImage} />;
        if (block.type === 'file') return <TaskFile key={index} block={block} />;
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
