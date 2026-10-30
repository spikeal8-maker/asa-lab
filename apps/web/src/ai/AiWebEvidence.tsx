import type { AiWebSearchEvidence } from '@asa-lab/contracts';
import { useEffect, useRef, useState } from 'react';
import { AiChatIcon } from './AiChatIcon';
import { useCopyFeedback } from './use-copy-feedback';
import { copyImageBlob } from './copy-image-blob';
import { readWebEvidence } from './ai-web-evidence';
import { fetchWithSessionRefresh } from '../session-fetch';
import { aiScopeHeaders } from './ai-scope-api';
import './ai-web-search.css';

const notices: Partial<Record<NonNullable<AiWebSearchEvidence['reason']>, string>> = {
  not_configured: 'Интернет-поиск ещё не подключён администратором.',
  provider_unavailable: 'Поиск сейчас недоступен. Ответ не подтверждён свежими источниками.',
  weather_unavailable: 'Точный прогноз недоступен. Ниже — найденные погодные источники.',
  location_required: 'Для прогноза укажите город.',
  location_ambiguous: 'Найдено несколько мест. Уточните город и регион.',
  rate_limit: 'Достигнут лимит интернет-поиска. Свежие источники не получены.',
};

function ImagePreview({
  path,
  title,
  sourceUrl,
  seatId,
}: {
  readonly path: string;
  readonly title: string;
  readonly sourceUrl: string;
  readonly seatId?: string | undefined;
}): JSX.Element {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const bytes = useRef<Blob | null>(null);
  const [mediaType, setMediaType] = useState('image/png');
  const [actionError, setActionError] = useState('');
  const { copied, confirmCopy, resetCopy } = useCopyFeedback(path);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    let started = false;
    setSrc(null);
    setFailed(false);
    bytes.current = null;
    setActionError('');
    const load = async () => {
      if (started) return;
      started = true;
      try {
        const response = await fetchWithSessionRefresh(path, {
          headers: aiScopeHeaders(seatId),
          signal: controller.signal,
        });
        if (
          !response.ok ||
          !['image/png', 'image/jpeg', 'image/webp'].includes(
            response.headers.get('content-type')?.split(';')[0]?.trim() ?? '',
          )
        )
          throw new Error('image unavailable');
        const blob = await response.blob();
        if (blob.size > 2 * 1024 * 1024 || blob.size === 0) throw new Error('image size');
        if (controller.signal.aborted) return;
        bytes.current = blob;
        setMediaType(blob.type);
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    };
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                void load();
                observer?.disconnect();
              }
            },
            { rootMargin: '160px' },
          );
    if (observer && host.current) observer.observe(host.current);
    else void load();
    return () => {
      controller.abort();
      observer?.disconnect();
      bytes.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, seatId]);
  async function copy(): Promise<void> {
    if (!bytes.current) return;
    resetCopy();
    setActionError('');
    try {
      await copyImageBlob(bytes.current);
      confirmCopy();
    } catch {
      setActionError('Не удалось скопировать картинку. Используйте скачивание.');
    }
  }
  const extension =
    mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/webp' ? 'webp' : 'png';
  const safeTitle = Array.from(title, (c) => (c.charCodeAt(0) < 32 ? '-' : c)).join('');
  const fileName =
    (safeTitle
      .replace(/[<>:"/\\|?*]/g, '-')
      .slice(0, 80)
      .trim() || 'asa-image') +
    '.' +
    extension;
  return (
    <div ref={host} className="asa-ai-web-image-preview">
      {src && !failed ? (
        <>
          <a href={sourceUrl} target="_blank" rel="noreferrer noopener">
            <img
              src={src}
              alt={title}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setFailed(true)}
            />
          </a>
          <div className="asa-ai-web-image-actions">
            <button
              type="button"
              data-copied={copied || undefined}
              aria-label={copied ? 'Изображение скопировано' : 'Копировать изображение'}
              data-ai-tooltip={copied ? 'Скопировано' : 'Копировать изображение'}
              onClick={() => void copy()}
            >
              <AiChatIcon name={copied ? 'check' : 'copy'} size={copied ? 22 : 18} />
            </button>
            <a
              href={src}
              download={fileName}
              aria-label="Скачать изображение"
              data-ai-tooltip="Скачать показанное изображение"
            >
              <AiChatIcon name="download" size={18} />
            </a>
          </div>
          <span className="sr-only" role="status">
            {copied ? 'Изображение скопировано' : ''}
          </span>
        </>
      ) : (
        <span>{failed ? 'Изображение недоступно' : 'Загрузка изображения…'}</span>
      )}
      {actionError ? (
        <p role="alert" className="asa-ai-web-image-error">
          {actionError}
        </p>
      ) : null}
    </div>
  );
}

export function AiWebEvidence({
  evidence,
  onChooseLocation,
  seatId,
}: {
  readonly evidence: unknown;
  readonly onChooseLocation?: (location: string) => void;
  readonly seatId?: string | undefined;
}): JSX.Element | null {
  const data = readWebEvidence(evidence);
  if (!data) return null;
  const date = new Date(data.retrievedAt).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const notice = data.reason
    ? notices[data.reason]
    : data.status === 'empty'
      ? 'По этому запросу источники не найдены.'
      : null;
  return (
    <section className="asa-ai-web-evidence" aria-label="Результаты интернет-поиска">
      {notice ? (
        <p className="asa-ai-web-notice" role="status">
          {notice}
        </p>
      ) : null}
      {data.locationChoices?.length ? (
        <div className="asa-ai-web-locations" aria-label="Варианты города">
          {data.locationChoices.map((location) =>
            onChooseLocation ? (
              <button key={location} type="button" onClick={() => onChooseLocation(location)}>
                {location}
              </button>
            ) : (
              <span key={location}>{location}</span>
            ),
          )}
        </div>
      ) : null}
      {data.weather ? (
        <section className="asa-ai-weather" aria-label={'Прогноз: ' + data.weather.location}>
          <div className="asa-ai-weather-heading">
            <div>
              <span>Погода · MET Norway</span>
              <h3>{data.weather.location}</h3>
            </div>
            {data.weather.temperatureC !== null ? (
              <strong aria-label={`Температура ${Math.round(data.weather.temperatureC)} °C`}>
                <span aria-hidden="true">🌡️ </span>
                {Math.round(data.weather.temperatureC)}°<span>C</span>
              </strong>
            ) : null}
          </div>
          {data.weather.hours.length ? (
            <ol className="asa-ai-weather-hours">
              {data.weather.hours.map((hour) => (
                <li key={hour.time}>
                  <time dateTime={hour.time}>
                    {new Date(hour.time).toLocaleString('ru-RU', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                  <strong aria-label={`Температура ${Math.round(hour.temperatureC)} °C`}>
                    <span aria-hidden="true">🌡️ </span>
                    {Math.round(hour.temperatureC)}°C
                  </strong>
                  {hour.humidityPercent !== null ? (
                    <small>💧 {Math.round(hour.humidityPercent)}%</small>
                  ) : null}
                  {hour.windSpeedMs !== null ? (
                    <small>💨 {hour.windSpeedMs.toFixed(1)} м/с</small>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
          {data.weather.hours.length ? (
            <p>Время прогноза — в часовом поясе вашего устройства.</p>
          ) : null}
          <p className="asa-ai-weather-data-time">
            Прогноз на{' '}
            <time dateTime={data.weather.forecastAt}>
              {new Date(data.weather.forecastAt).toLocaleString('ru-RU')}
            </time>
            . Данные обновлены{' '}
            <time dateTime={data.weather.forecastUpdatedAt}>
              {new Date(data.weather.forecastUpdatedAt).toLocaleString('ru-RU')}
            </time>
            .
          </p>
          <a href={data.weather.sourceUrl} target="_blank" rel="noreferrer noopener">
            MET Norway · прогноз
          </a>
          <div className="asa-ai-weather-attribution">
            {data.weather.attributions.map((item) => (
              <a key={item.url} href={item.url} target="_blank" rel="noreferrer noopener">
                {item.title}
              </a>
            ))}
          </div>
        </section>
      ) : null}
      {data.images.length ? (
        <div
          className="asa-ai-web-images"
          role="region"
          tabIndex={0}
          aria-label="Найденные изображения, прокрутка по горизонтали"
        >
          {data.images.map((image) => (
            <article key={image.id} className="asa-ai-web-image-card">
              <ImagePreview
                path={image.thumbnailUrl}
                title={image.title}
                sourceUrl={image.sourceUrl}
                seatId={seatId}
              />
              <a
                className="asa-ai-web-image-caption"
                href={image.sourceUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                <span>{image.title}</span>
                <small>{new URL(image.sourceUrl).hostname}</small>
              </a>
            </article>
          ))}
        </div>
      ) : null}
      {data.sources.length ? (
        <details className="asa-ai-web-sources">
          <summary>
            Источники <span>{data.sources.length}</span>
          </summary>
          <ol>
            {data.sources.map((source) => (
              <li key={source.id}>
                <a href={source.url} target="_blank" rel="noreferrer noopener">
                  <span className="asa-ai-source-number">{source.id}</span>
                  <span>
                    <small>{source.hostname}</small>
                    <strong>{source.title}</strong>
                  </span>
                  <span aria-hidden="true">↗</span>
                </a>
                {source.snippet ? <p>{source.snippet}</p> : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      <p className="asa-ai-web-attribution">
        Интернет-поиск ·{' '}
        <time dateTime={data.retrievedAt}>
          {data.status === 'unavailable' ||
          data.status === 'limited' ||
          data.status === 'needs_location'
            ? 'попытка'
            : 'получено'}{' '}
          {date}
        </time>
      </p>
    </section>
  );
}
