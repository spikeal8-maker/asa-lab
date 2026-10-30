import { useEffect, useRef, useState } from 'react';
import { AiChatIcon } from './AiChatIcon';
import { copyImageBlob } from './copy-image-blob';
import { useCopyFeedback } from './use-copy-feedback';
import { fetchWithSessionRefresh } from '../session-fetch';
import { aiScopeHeaders } from './ai-scope-api';

function imageName(title: string, type: string): string {
  const name =
    Array.from(title, (c) => (c.charCodeAt(0) < 32 ? '-' : c))
      .join('')
      .replace(/[<>:"/\\|?*]/g, '-')
      .replace(/\.{2,}/g, '-')
      .replace(/^\.+/, '')
      .slice(0, 80)
      .trim() || 'asa-image';
  return `${name}.${type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png'}`;
}
interface Resource {
  blob: Blob;
  url: string;
}
function download(resource: Resource, title: string): void {
  const link = document.createElement('a');
  link.href = resource.url;
  link.download = imageName(title, resource.blob.type);
  document.body.append(link);
  link.click();
  link.remove();
}
function ImageViewer({
  src,
  title,
  sourceUrl,
  status,
  error,
  copied,
  onClose,
  onCopy,
  onDownload,
  onPreviewDownload,
}: {
  src: string;
  title: string;
  sourceUrl: string;
  status: string;
  error: string;
  copied: boolean;
  onClose: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onPreviewDownload: () => void;
}): JSX.Element {
  const dialog = useRef<HTMLDialogElement>(null);
  const [dimensions, setDimensions] = useState('');
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    dialog.current?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="asa-ai-image-viewer"
      aria-label="Просмотр изображения"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header>
        <div>
          <strong>{title}</strong>
          <span role="status">
            {status}
            {dimensions ? ` · ${dimensions}` : ''}
          </span>
        </div>
        <nav aria-label="Действия с изображением">
          <button
            type="button"
            aria-label={copied ? 'Изображение скопировано' : 'Копировать изображение'}
            data-copied={copied || undefined}
            data-ai-tooltip={copied ? 'Скопировано' : 'Копировать изображение'}
            onClick={onCopy}
          >
            <AiChatIcon name={copied ? 'check' : 'copy'} size={copied ? 22 : 19} />
          </button>
          <button
            type="button"
            aria-label="Скачать изображение"
            data-ai-tooltip="Скачать изображение"
            onClick={onDownload}
          >
            <AiChatIcon name="download" size={19} />
          </button>
          <a href={sourceUrl} target="_blank" rel="noreferrer noopener">
            Источник ↗
          </a>
          <button
            type="button"
            aria-label="Закрыть просмотр"
            data-ai-tooltip="Закрыть · Esc"
            onClick={onClose}
          >
            <svg
              width="21"
              height="21"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </nav>
      </header>
      <img
        src={src}
        alt={title}
        onLoad={(event) =>
          setDimensions(
            `${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`,
          )
        }
      />
      {error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={onPreviewDownload}>
            Скачать миниатюру
          </button>
        </p>
      ) : null}
    </dialog>
  );
}

export function AiSearchImageCard({
  path,
  title,
  sourceUrl,
  hasOriginal,
  seatId,
  onUseImage,
}: {
  path: string;
  title: string;
  sourceUrl: string;
  hasOriginal: boolean;
  seatId?: string | undefined;
  onUseImage?: ((file: File) => void) | undefined;
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController>(new AbortController());
  const preview = useRef<Resource | null>(null);
  const original = useRef<Promise<Resource> | null>(null);
  const urls = useRef<Set<string>>(new Set());
  const [src, setSrc] = useState('');
  const [originalSrc, setOriginalSrc] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dimensions, setDimensions] = useState('');
  const [open, setOpen] = useState(false);
  const { copied, confirmCopy, resetCopy } = useCopyFeedback(path);
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    let started = false;
    const ownedUrls = urls.current;
    const load = async () => {
      if (started) return;
      started = true;
      try {
        const response = await fetchWithSessionRefresh(path, {
          headers: aiScopeHeaders(seatId),
          signal: abort.signal,
        });
        if (
          !response.ok ||
          !['image/png', 'image/jpeg', 'image/webp'].includes(
            response.headers.get('content-type')?.split(';')[0]?.trim() ?? '',
          )
        )
          throw new Error();
        const blob = await response.blob();
        if (!blob.size || blob.size > 2 * 1024 * 1024) throw new Error();
        abort.signal.throwIfAborted();
        const url = URL.createObjectURL(blob);
        ownedUrls.add(url);
        preview.current = { blob, url };
        setSrc(url);
      } catch {
        if (!abort.signal.aborted) setFailed(true);
      }
    };
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              if (entries.some((item) => item.isIntersecting)) {
                void load();
                observer?.disconnect();
              }
            },
            { rootMargin: '160px' },
          );
    if (observer && host.current) observer.observe(host.current);
    else void load();
    return () => {
      abort.abort();
      observer?.disconnect();
      for (const url of ownedUrls) URL.revokeObjectURL(url);
      ownedUrls.clear();
      preview.current = null;
      original.current = null;
    };
  }, [path, seatId]);
  function full(): Promise<Resource> {
    if (!hasOriginal)
      return preview.current ? Promise.resolve(preview.current) : Promise.reject(new Error());
    if (original.current) return original.current;
    setBusy(true);
    setError('');
    const abort = controller.current;
    original.current = (async () => {
      try {
        const response = await fetchWithSessionRefresh(path + '?original=1', {
          headers: aiScopeHeaders(seatId),
          signal: abort.signal,
        });
        if (
          !response.ok ||
          !['image/png', 'image/jpeg', 'image/webp'].includes(
            response.headers.get('content-type')?.split(';')[0]?.trim() ?? '',
          )
        )
          throw new Error();
        const blob = await response.blob();
        if (!blob.size || blob.size > 8 * 1024 * 1024) throw new Error();
        abort.signal.throwIfAborted();
        const url = URL.createObjectURL(blob);
        urls.current.add(url);
        setOriginalSrc(url);
        return { blob, url };
      } catch (problem) {
        original.current = null;
        throw problem;
      } finally {
        if (!abort.signal.aborted) setBusy(false);
      }
    })();
    return original.current;
  }
  function failure(): void {
    if (!controller.current.signal.aborted)
      setError(
        hasOriginal
          ? 'Оригинал недоступен: сайт не отдал файл или он превышает безопасный размер.'
          : 'Не удалось выполнить действие с изображением.',
      );
  }
  function copy(): void {
    resetCopy();
    setError('');
    void copyImageBlob(full().then((resource) => resource.blob))
      .then(confirmCopy)
      .catch(() => {
        if (!controller.current.signal.aborted)
          setError('Не удалось скопировать изображение. Используйте скачивание.');
      });
  }
  function save(): void {
    void full()
      .then((resource) => download(resource, title))
      .catch(failure);
  }
  const info = `${title} · ${new URL(sourceUrl).hostname}${dimensions ? ' · миниатюра ' + dimensions : ''}`;
  return (
    <div ref={host} className="asa-ai-web-image-preview" aria-label={title}>
      {src && !failed ? (
        <>
          {busy ? (
            <span className="asa-ai-web-image-loading" role="status">
              Загружаем оригинал…
            </span>
          ) : null}
          <button
            type="button"
            className="asa-ai-web-image-open"
            aria-label={'Открыть изображение: ' + title}
            data-ai-tooltip={info}
            onClick={() => {
              setOpen(true);
              if (hasOriginal) void full().catch(failure);
            }}
          >
            <img
              src={src}
              alt={title}
              loading="lazy"
              onError={() => setFailed(true)}
              onLoad={(event) =>
                setDimensions(
                  `${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`,
                )
              }
            />
          </button>
          <div className="asa-ai-web-image-actions">
            <button
              type="button"
              data-copied={copied || undefined}
              aria-label={copied ? 'Изображение скопировано' : 'Копировать изображение'}
              data-ai-tooltip={
                copied
                  ? 'Скопировано'
                  : hasOriginal
                    ? 'Копировать оригинал'
                    : `Копировать миниатюру · ${dimensions}`
              }
              onClick={copy}
            >
              <AiChatIcon name={copied ? 'check' : 'copy'} size={copied ? 22 : 18} />
            </button>
            <button
              type="button"
              aria-label="Скачать изображение"
              data-ai-tooltip={
                hasOriginal ? 'Скачать оригинал' : `Скачать миниатюру · ${dimensions}`
              }
              onClick={save}
            >
              <AiChatIcon name="download" size={18} />
            </button>
            {onUseImage ? (
              <button
                type="button"
                aria-label="Использовать в чате"
                data-ai-tooltip={
                  hasOriginal
                    ? 'Использовать оригинал в чате'
                    : `Использовать миниатюру · ${dimensions}`
                }
                onClick={() => {
                  void full()
                    .then(({ blob }) =>
                      onUseImage(
                        new File([blob], imageName(title, blob.type), { type: blob.type }),
                      ),
                    )
                    .catch(failure);
                }}
              >
                <AiChatIcon name="attachment" size={18} />
              </button>
            ) : null}
          </div>
          <span className="sr-only" role="status">
            {copied ? 'Изображение скопировано' : busy ? 'Загрузка оригинала…' : ''}
          </span>
          {open ? (
            <ImageViewer
              src={originalSrc || src}
              title={title}
              sourceUrl={sourceUrl}
              status={
                busy
                  ? 'Загрузка оригинала…'
                  : originalSrc
                    ? 'Оригинал источника'
                    : 'Миниатюра поисковика'
              }
              error={error}
              copied={copied}
              onClose={() => setOpen(false)}
              onCopy={copy}
              onDownload={save}
              onPreviewDownload={() => {
                if (preview.current) download(preview.current, title);
              }}
            />
          ) : null}
        </>
      ) : (
        <span>{failed ? 'Изображение недоступно' : 'Загрузка изображения…'}</span>
      )}
      {error && !open ? (
        <div className="asa-ai-web-image-error" role="alert">
          {error}{' '}
          <button
            type="button"
            onClick={() => {
              if (preview.current) download(preview.current, title);
            }}
          >
            Скачать миниатюру
          </button>
        </div>
      ) : null}
    </div>
  );
}
