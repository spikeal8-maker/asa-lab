import { useEffect, useRef, useState } from 'react';
import type { AiGeneratedImage as ImageReceipt } from '@asa-lab/contracts';
import { readGeneratedImage } from './read-generated-image';
import { imageModelLabel } from './image-model-label';
import type { AiImageRecipe } from '@asa-lab/contracts';
import { AiImagePrompt } from './AiImagePrompt';
import { useCopyFeedback } from './use-copy-feedback';
import { AiChatIcon } from './AiChatIcon';
import { createAiScopeCall } from './ai-scope-api';
import type { AiImageGenerationJob } from '@asa-lab/contracts';
export { generatedImagePath } from './read-generated-image';

export function AiGeneratedImage({
  image,
  threadId,
  seatId,
}: {
  image: ImageReceipt;
  threadId: string;
  seatId?: string | undefined;
}) {
  const [url, setUrl] = useState('');
  const [prompt, setPrompt] = useState('');
  const [recipe, setRecipe] = useState<AiImageRecipe>();
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const { copied, confirmCopy, resetCopy } = useCopyFeedback(image.requestId);
  const bytes = useRef<Blob | null>(null);
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    setUrl('');
    setPrompt('');
    setRecipe(undefined);
    setError('');
    setActionError('');
    resetCopy();
    bytes.current = null;
    let started = false;
    const load = async () => {
      if (started || controller.signal.aborted) return;
      started = true;
      void createAiScopeCall(seatId)<AiImageGenerationJob>(
        '/api/ai/threads/' +
          encodeURIComponent(threadId) +
          '/image-generations/' +
          encodeURIComponent(image.requestId),
      )
        .then((reply) => {
          if (!controller.signal.aborted && reply.ok) {
            setPrompt(reply.data.prompt);
            setRecipe(reply.data.recipe);
          }
        })
        .catch(() => undefined);
      try {
        // Derive the closed route; a receipt never supplies a browser fetch URL.
        const blob = await readGeneratedImage(image, threadId, seatId, controller.signal);
        if (controller.signal.aborted) return;
        bytes.current = blob;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (!controller.signal.aborted) setError('Изображение недоступно. Обновите переписку.');
      }
    };
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                observer?.disconnect();
                void load();
              }
            },
            { rootMargin: '160px' },
          );
    if (observer && card.current) observer.observe(card.current);
    else void load();
    return () => {
      observer?.disconnect();
      controller.abort();
      bytes.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image.requestId, image.sizeBytes, seatId, threadId, resetCopy]);
  async function copyImage(): Promise<void> {
    setActionError('');
    resetCopy();
    if (!bytes.current) return;
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      setActionError('Копирование изображений недоступно в этом браузере. Скачайте PNG.');
      return;
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': bytes.current })]);
      confirmCopy();
    } catch {
      setActionError('Не удалось скопировать изображение. Скачайте PNG.');
    }
  }
  const imageDetails = `${image.width}×${image.height} · PNG · ${image.sizeBytes.toLocaleString('ru-RU')} байт`;
  return (
    <figure ref={card} className="ai-generated-image">
      {prompt ? (
        <AiImagePrompt
          prompt={prompt}
          label={`Промпт · ${image.width} × ${image.height} · ${imageModelLabel(recipe)}`}
        />
      ) : null}
      {url ? (
        <>
          <img src={url} alt="Созданное изображение" />
          <figcaption className="ai-generated-image-footer">
            <span className="ai-generated-image-actions">
              <button
                type="button"
                onClick={() => void copyImage()}
                data-copied={copied || undefined}
                aria-label={
                  copied ? 'Изображение скопировано' : `Копировать изображение · ${imageDetails}`
                }
                title={`Копировать изображение · ${imageDetails}`}
              >
                <AiChatIcon name={copied ? 'check' : 'copy'} size={copied ? 22 : 18} />
              </button>
              <a
                href={url}
                download={'asa-image-' + image.requestId + '.png'}
                aria-label={`Скачать изображение · ${imageDetails}`}
                title={`Скачать изображение · ${imageDetails}`}
              >
                <AiChatIcon name="download" size={18} />
              </a>
            </span>
            <span className="sr-only" role="status">
              {copied ? 'Изображение скопировано' : ''}
            </span>
          </figcaption>
          {actionError ? (
            <p className="ai-generated-image-error" role="alert">
              {actionError}
            </p>
          ) : null}
        </>
      ) : (
        <p role="status">{error || 'Загружаем изображение…'}</p>
      )}
    </figure>
  );
}
