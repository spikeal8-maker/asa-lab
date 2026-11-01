import { AiImageViewer } from './AiImageViewer';
import { useEffect, useRef, useState } from 'react';
import { AiChatIcon } from './AiChatIcon';
import { aiScopeHeaders } from './ai-scope-api';
import { fetchWithSessionRefresh } from '../session-fetch';

export interface AiSavedAttachment {
  readonly uploadId: string;
  readonly fileName: string | null;
  readonly sizeBytes: number;
  readonly mediaType: string;
  readonly kind: string;
}

export function AiHistoryAttachment({
  file,
  seatId,
  onDownload,
  onUse,
}: {
  file: AiSavedAttachment;
  seatId?: string | undefined;
  onDownload: () => void;
  onUse?: (file: File) => void;
}): JSX.Element {
  const card = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const bytes = useRef<Blob | null>(null);
  const [failed, setFailed] = useState(false);
  const image = file.kind === 'image' && /^image\/(png|jpeg|webp)$/.test(file.mediaType);

  useEffect(() => {
    setPreview(null);
    setFailed(false);
    if (!image) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    let started = false;
    const load = async (): Promise<void> => {
      if (started) return;
      started = true;
      try {
        const response = await fetchWithSessionRefresh(
          '/api/ai/attachments/' + encodeURIComponent(file.uploadId) + '/bytes',
          { headers: aiScopeHeaders(seatId), cache: 'no-store', signal: controller.signal },
        );
        if (!response.ok) throw new Error('preview unavailable');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        if (blob.type !== file.mediaType || blob.size !== file.sizeBytes)
          throw new Error('invalid preview');
        bytes.current = blob;
        objectUrl = URL.createObjectURL(blob);
        setPreview(objectUrl);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    };
    // Only visible cards read private bytes; old paginated turns do not eagerly
    // download every full-size image or retain their object URLs after unmount.
    const observer: IntersectionObserver | null =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
              observer?.disconnect();
              void load();
            }
          })
        : null;
    if (observer && card.current) observer.observe(card.current);
    else void load();
    return () => {
      observer?.disconnect();
      controller.abort();
      bytes.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.uploadId, file.mediaType, file.sizeBytes, image, seatId]);

  const name = file.fileName ?? 'Вложение';
  const type = image
    ? 'Изображение'
    : name.includes('.')
      ? name.split('.').at(-1)!.toUpperCase()
      : 'Файл';
  const size =
    file.sizeBytes < 1024 * 1024
      ? Math.max(1, Math.ceil(file.sizeBytes / 1024)) + ' КБ'
      : (file.sizeBytes / (1024 * 1024)).toFixed(1) + ' МБ';
  return (
    <>
      <button
        ref={card}
        type="button"
        className={'chat-saved-file' + (image ? ' is-image' : '')}
        onClick={() => (image && preview ? setExpanded(true) : onDownload())}
        data-ai-tooltip={`${name} · ${size}`}
        title={image ? `Открыть: ${name} · ${size}` : 'Скачать: ' + name}
        aria-label={(image ? 'Открыть: ' : 'Скачать: ') + name}
      >
        {preview && !failed ? (
          <img src={preview} alt={name} onError={() => setFailed(true)} />
        ) : (
          <span className="chat-saved-file-icon">
            <AiChatIcon name={image ? 'image' : 'file'} size={26} />
          </span>
        )}
        <span className={image ? 'sr-only' : 'chat-saved-file-info'}>
          <span className="chat-saved-file-name">{name}</span>
          <small>
            {failed ? 'Миниатюра недоступна · ' : ''}
            {type} · {size}
          </small>
        </span>
      </button>
      {image && preview ? (
        <span className="ai-private-image-actions">
          <button
            type="button"
            data-ai-tooltip="Скачать изображение"
            aria-label="Скачать изображение"
            onClick={onDownload}
          >
            <AiChatIcon name="download" size={18} />
          </button>
          {onUse ? (
            <button
              type="button"
              data-ai-tooltip="Использовать в чате"
              aria-label="Использовать в чате"
              onClick={() => {
                if (bytes.current) onUse(new File([bytes.current], name, { type: file.mediaType }));
              }}
            >
              <AiChatIcon name="attachment" size={18} />
            </button>
          ) : null}
        </span>
      ) : null}
      {expanded && preview ? (
        <AiImageViewer src={preview} name={name} onClose={() => setExpanded(false)} />
      ) : null}
    </>
  );
}
