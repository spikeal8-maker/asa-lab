import { useEffect, useRef, useState } from 'react';
import type { AiGeneratedImage as ImageReceipt } from '@asa-lab/contracts';
import { readGeneratedImage } from './read-generated-image';
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
  const [error, setError] = useState('');
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    setUrl('');
    setError('');
    let started = false;
    const load = async () => {
      if (started || controller.signal.aborted) return;
      started = true;
      try {
        // Derive the closed route; a receipt never supplies a browser fetch URL.
        const blob = await readGeneratedImage(image, threadId, seatId, controller.signal);
        if (controller.signal.aborted) return;
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
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image.requestId, image.sizeBytes, seatId, threadId]);
  return (
    <figure ref={card} className="ai-generated-image">
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
