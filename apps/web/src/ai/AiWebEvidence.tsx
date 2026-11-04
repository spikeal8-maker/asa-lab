import type { AiWebSearchEvidence } from '@asa-lab/contracts';
import { AiSearchImageCard } from './AiSearchImageCard';
import { readWebEvidence } from './ai-web-evidence';
import './ai-web-search.css';

const notices: Partial<Record<NonNullable<AiWebSearchEvidence['reason']>, string>> = {
  not_configured: 'Интернет-поиск ещё не подключён администратором.',
  provider_unavailable: 'Поиск сейчас недоступен. Ответ не подтверждён свежими источниками.',
  weather_unavailable: 'Точный прогноз недоступен. Ниже — найденные погодные источники.',
  location_required: 'Для прогноза укажите город.',
  location_ambiguous: 'Найдено несколько мест. Уточните город и регион.',
  rate_limit: 'Достигнут лимит интернет-поиска. Свежие источники не получены.',
};

export function AiWebEvidence({
  evidence,
  onChooseLocation,
  seatId,
  onUseImage,
}: {
  readonly evidence: unknown;
  readonly onChooseLocation?: (location: string) => void;
  readonly seatId?: string | undefined;
  readonly onUseImage?: ((file: File) => void) | undefined;
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
              <AiSearchImageCard
                path={image.thumbnailUrl}
                title={image.title}
                sourceUrl={image.sourceUrl}
                hasOriginal={!!image.originalUrl}
                seatId={seatId}
                onUseImage={onUseImage}
              />
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
                    <small>
                      {source.hostname}
                      {source.pageRead === 'read'
                        ? ' · Страница прочитана'
                        : source.pageRead === 'unavailable'
                          ? ' · Только поисковая выдержка'
                          : ''}
                    </small>
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
