import type { AiWebSearchEvidence } from '@asa-lab/contracts';
import { useEffect, useRef, useState } from 'react';
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
  seatId,
}: {
  readonly path: string;
  readonly title: string;
  readonly seatId?: string | undefined;
}): JSX.Element {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    let started = false;
    setSrc(null);
    setFailed(false);
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
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, seatId]);
  return (
    <div ref={host} className="asa-ai-web-image-preview">
      {src && !failed ? (
        <img
          src={src}
          alt={title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{failed ? 'Изображение недоступно' : 'Загрузка изображения…'}</span>
      )}
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
              <span>Прогноз погоды</span>
              <h3>{data.weather.location}</h3>
            </div>
            {data.weather.temperatureC !== null ? (
              <strong>
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
                  <strong>{Math.round(hour.temperatureC)}°</strong>
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
        <div className="asa-ai-web-images" aria-label="Найденные изображения">
          {data.images.map((image) => (
            <a key={image.id} href={image.sourceUrl} target="_blank" rel="noreferrer noopener">
              <ImagePreview path={image.thumbnailUrl} title={image.title} seatId={seatId} />
              <span>{image.title}</span>
              <small>{new URL(image.sourceUrl).hostname}</small>
            </a>
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
