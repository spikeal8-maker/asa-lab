import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AiWebSearchAdminConfig, AiWebSearchAdminUpdate } from '@asa-lab/contracts';
import { call } from './admin-api';
import './ai-web-search-admin.css';

function configShape(value: unknown): value is AiWebSearchAdminConfig {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<AiWebSearchAdminConfig>;
  return (
    data.schemaVersion === 1 &&
    data.provider === 'searxng' &&
    typeof data.enabled === 'boolean' &&
    typeof data.configured === 'boolean' &&
    typeof data.weatherEnabled === 'boolean' &&
    Number.isInteger(data.configurationVersion) &&
    Number.isInteger(data.operationsPerHour)
  );
}

export function AdminAiWebSearch({
  onAccessDenied,
}: {
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [config, setConfig] = useState<AiWebSearchAdminConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [weatherEnabled, setWeatherEnabled] = useState(false);
  const [limit, setLimit] = useState('0');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const inFlight = useRef(false);
  const apply = (data: AiWebSearchAdminConfig) => {
    setConfig(data);
    setEnabled(data.enabled);
    setWeatherEnabled(data.weatherEnabled);
    setLimit(String(data.operationsPerHour));
  };
  useEffect(() => {
    let live = true;
    setLoading(true);
    void call<unknown>('/api/admin/v1/ai/web-search')
      .then((reply) => {
        if (!live) return;
        if (!reply.ok) {
          if (reply.status === 401 || reply.status === 403) onAccessDenied();
          setError(
            reply.status === 404
              ? 'Для интернет-поиска требуется обновление API и схемы ASA.'
              : 'Не удалось загрузить настройки поиска.',
          );
        } else if (configShape(reply.data)) {
          apply(reply.data);
          setError('');
        } else setError('Настройки интернет-поиска несовместимы с этой версией.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [onAccessDenied, reload]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!config || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const payload: AiWebSearchAdminUpdate = {
      enabled,
      weatherEnabled,
      operationsPerHour: Number(limit),
      configurationVersion: config.configurationVersion,
    };
    try {
      const reply = await call<unknown>('/api/admin/v1/ai/web-search', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      if (!reply.ok) {
        if (reply.status === 401 || reply.status === 403) onAccessDenied();
        setError(
          reply.status === 409
            ? 'Настройки изменились. Обновите страницу и повторите.'
            : 'Не удалось сохранить настройки поиска.',
        );
      } else if (configShape(reply.data)) {
        apply(reply.data);
        setNotice('Настройки сохранены. Поисковый запрос не выполнялся.');
      } else setError('Сервер вернул несовместимые настройки. Обновите страницу.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const validLimit =
    /^\d+$/.test(limit) && Number.isSafeInteger(Number(limit)) && Number(limit) <= 100000;
  return (
    <section
      className="asa-ai-web-admin asa-cloud-connection"
      aria-label="Настройки интернет-поиска"
    >
      {loading ? <p role="status">Загружаем настройки поиска…</p> : null}
      {error ? (
        <p role="alert" className="asa-cloud-error">
          {error}{' '}
          {!config ? (
            <button type="button" onClick={() => setReload((value) => value + 1)}>
              Повторить
            </button>
          ) : null}
        </p>
      ) : null}
      {config ? (
        <form onSubmit={(event) => void save(event)} className="asa-cloud-form">
          <div className="asa-cloud-top">
            <div>
              <h2>Интернет-поиск · SearxNG</h2>
              <span>Поиск по вебу и изображениям на сервере ASA</span>
            </div>
            <label className="asa-cloud-enabled">
              <input
                type="checkbox"
                checked={enabled}
                disabled={busy}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              {enabled ? 'Включено' : 'Выключено'}
            </label>
          </div>
          <p className="asa-ai-web-admin-description">
            Собственный компонент поиска без платных внешних API и ключей.{' '}
            {config.configured
              ? 'Адрес компонента настроен на сервере.'
              : 'Компонент поиска ещё не подключён на сервере. Обычный чат продолжает работать.'}
          </p>
          <label className="asa-cloud-field asa-ai-web-admin-limit">
            <span>Лимит поисковых операций за час</span>
            <input
              aria-label="Лимит поисковых операций за час"
              type="number"
              min="0"
              max="100000"
              step="1"
              value={limit}
              disabled={busy}
              onChange={(event) => setLimit(event.target.value)}
            />
            <small>Ограничивает нагрузку на поиск. Нулевой лимит отключает новые запросы.</small>
          </label>
          <details className="asa-ai-web-admin-weather">
            <summary>Прогноз погоды</summary>
            <label className="asa-cloud-consent">
              <input
                type="checkbox"
                checked={weatherEnabled}
                disabled={busy}
                onChange={(event) => setWeatherEnabled(event.target.checked)}
              />
              Включить прогноз погоды
            </label>
            <p>
              Прогноз MET Norway и поиск городов OpenStreetMap. Геокодирование выполняется после
              отправки вопроса, без подсказок при вводе. Источники и время прогноза отображаются в
              ответе.
            </p>
            <a
              href="https://operations.osmfoundation.org/policies/nominatim/"
              target="_blank"
              rel="noreferrer noopener"
            >
              Правила использования поиска городов
            </a>
          </details>
          {enabled && Number(limit) === 0 ? <p>Для поиска задайте лимит больше нуля.</p> : null}
          <div className="asa-cloud-bottom">
            <button type="submit" className="asa-cloud-apply" disabled={busy || !validLimit}>
              {busy ? 'Сохраняем…' : 'Сохранить поиск'}
            </button>
            {notice ? (
              <span role="status" className="asa-cloud-confirmed">
                {notice}
              </span>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
