import { useEffect, useState } from 'react';
import type { AiGeneratedImage as ImageReceipt } from '@asa-lab/contracts';
import { fetchWithSessionRefresh } from '../session-fetch';
import { aiScopeHeaders } from './ai-scope-api';

export function generatedImagePath(threadId: string, requestId: string): string {
  return (
    '/api/ai/threads/' +
    encodeURIComponent(threadId) +
    '/image-generations/' +
    encodeURIComponent(requestId) +
    '/image'
  );
}

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
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    setUrl('');
    setError('');
    void (async () => {
      try {
        // Derive the closed route; a receipt never supplies a browser fetch URL.
        const response = await fetchWithSessionRefresh(
          generatedImagePath(threadId, image.requestId),
          {
            headers: aiScopeHeaders(seatId),
            signal: controller.signal,
            cache: 'no-store',
          },
        );
        if (!response.ok) throw new Error('unavailable');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        if (blob.type !== 'image/png' || blob.size !== image.sizeBytes)
          throw new Error('invalid image');
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (!controller.signal.aborted) setError('Изображение недоступно. Обновите переписку.');
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image.requestId, image.sizeBytes, seatId, threadId]);
  return (
    <figure className="ai-generated-image">
      {url ? (
        <>
          <img src={url} alt="Созданное изображение" />
          <a href={url} download={'asa-image-' + image.requestId + '.png'}>
            Скачать PNG
          </a>
        </>
      ) : (
        <p role="status">{error || 'Загружаем изображение…'}</p>
      )}
      <figcaption>
        {image.width} × {image.height} · PNG
      </figcaption>
    </figure>
  );
}
