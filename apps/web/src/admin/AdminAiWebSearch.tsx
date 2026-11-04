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
    Number.isInteger(data.operationsPerHour) &&
    (data.allowedDomains === undefined ||
      (Array.isArray(data.allowedDomains) &&
        data.allowedDomains.every((item) => typeof item === 'string'))) &&
    (data.blockedDomains === undefined ||
      (Array.isArray(data.blockedDomains) &&
        data.blockedDomains.every((item) => typeof item === 'string'))) &&
    (data.searchInstructions === undefined || typeof data.searchInstructions === 'string')
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
  const [allowedDomains, setAllowedDomains] = useState('');
  const [blockedDomains, setBlockedDomains] = useState('');
  const [searchInstructions, setSearchInstructions] = useState('');
  const [resultsLimit, setResultsLimit] = useState('8');
  const [pagesLimit, setPagesLimit] = useState('2');
  const [pageCharLimit, setPageCharLimit] = useState('4500');
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
    setAllowedDomains((data.allowedDomains ?? []).join('\n'));
    setBlockedDomains((data.blockedDomains ?? []).join('\n'));
    setSearchInstructions(data.searchInstructions ?? '');
    setResultsLimit(String(data.resultsLimit ?? 8));
    setPagesLimit(String(data.pagesLimit ?? 2));
    setPageCharLimit(String(data.pageCharLimit ?? 4500));
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
    if (!config || inFlight.current || loading || !validLimit || !validPolicy || !validRetrieval)
      return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const payload: AiWebSearchAdminUpdate = {
      enabled,
      weatherEnabled,
      operationsPerHour: Number(limit),
      configurationVersion: config.configurationVersion,
      ...(retrievalSupported
        ? {
            resultsLimit: Number(resultsLimit),
            pagesLimit: Number(pagesLimit),
            pageCharLimit: Number(pageCharLimit),
          }
        : {}),
      ...(policySupported
        ? {
            allowedDomains: allowedDomainList,
            blockedDomains: blockedDomainList,
            searchInstructions,
          }
        : {}),
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
  const retrievalSupported =
    config?.resultsLimit !== undefined &&
    config.pagesLimit !== undefined &&
    config.pageCharLimit !== undefined;
  const validRetrieval =
    !retrievalSupported ||
    [
      [resultsLimit, 1, 12],
      [pagesLimit, 0, 2],
      [pageCharLimit, 500, 8000],
    ].every(
      ([value, min, max]) =>
        /^\d+$/.test(String(value)) &&
        Number.isSafeInteger(Number(value)) &&
        Number(value) >= Number(min) &&
        Number(value) <= Number(max),
    );
  const policySupported =
    config !== null &&
    Array.isArray(config.allowedDomains) &&
    Array.isArray(config.blockedDomains) &&
    typeof config.searchInstructions === 'string';
  const domainLines = (value: string) =>
    value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  const allowedDomainList = domainLines(allowedDomains);
  const blockedDomainList = domainLines(blockedDomains);
  const validDomains = (domains: readonly string[]) =>
    domains.length <= 50 &&
    domains.every((domain) => {
      if (domain.length > 253 || /[\s/:@*?#\\]/u.test(domain)) return false;
      try {
        const hostname = new URL('https://' + domain).hostname;
        return (
          hostname.length <= 253 &&
          hostname.includes('.') &&
          !hostname.includes('..') &&
          hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))
        );
      } catch {
        return false;
      }
    });
  const validPolicy =
    !policySupported ||
    (validDomains(allowedDomainList) &&
      validDomains(blockedDomainList) &&
      searchInstructions.length <= 3000);
  return (
    <section
      className="asa-ai-web-admin asa-cloud-connection"
      aria-label="Настройки интернет-поиска"
    >
      {loading ? <p role="status">Загружаем настройки поиска…</p> : null}
      {error ? (
        <p role="alert" className="asa-cloud-error">
          {error}{' '}
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => setReload((value) => value + 1)}
          >
            {config ? 'Загрузить актуальные настройки' : 'Повторить'}
          </button>
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
          <fieldset className="asa-ai-web-retrieval" disabled={busy || !retrievalSupported}>
            <legend>Выдача и чтение страниц</legend>
            <div className="asa-ai-web-retrieval-grid">
              <label className="asa-cloud-field">
                <span>Результатов поиска</span>
                <input
                  type="number"
                  min="1"
                  max="12"
                  step="1"
                  value={resultsLimit}
                  aria-label="Результатов поиска"
                  onChange={(event) => setResultsLimit(event.target.value)}
                />
                <small>От 1 до 12 ссылок или картинок в ответе.</small>
              </label>
              <label className="asa-cloud-field">
                <span>Страниц для чтения</span>
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="1"
                  value={pagesLimit}
                  aria-label="Страниц для чтения"
                  onChange={(event) => setPagesLimit(event.target.value)}
                />
                <small>Модель выбирает до двух страниц. 0 — не читать.</small>
              </label>
              <label className="asa-cloud-field">
                <span>Символов со страницы</span>
                <input
                  type="number"
                  min="500"
                  max="8000"
                  step="1"
                  value={pageCharLimit}
                  aria-label="Символов со страницы"
                  onChange={(event) => setPageCharLimit(event.target.value)}
                />
                <small>От 500 до 8000 символов текста каждой страницы.</small>
              </label>
            </div>
          </fieldset>
          {!retrievalSupported ? (
            <p className="asa-ai-web-admin-description">
              Новые настройки станут доступны после обновления схемы поиска.
            </p>
          ) : (
            <p className="asa-ai-web-admin-description">
              Поиск возвращает список; модель сама решает, какие страницы читать инструментом
              read_page. Чтение доступно моделям с подключёнными инструментами. Настройки применятся
              к новым запросам.
            </p>
          )}
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
          {policySupported ? (
            <>
              <div className="asa-ai-web-admin-domains">
                <label className="asa-cloud-field">
                  <span>Разрешённые сайты</span>
                  <textarea
                    aria-label="Разрешённые сайты"
                    value={allowedDomains}
                    disabled={busy}
                    rows={5}
                    placeholder={'example.org\nнаука.рф'}
                    onChange={(event) => setAllowedDomains(event.target.value)}
                  />
                  <small>
                    По одному домену на строку, до 50. Пустой список разрешает любые сайты.
                    Поддомены включаются.
                  </small>
                </label>
                <label className="asa-cloud-field">
                  <span>Исключённые сайты</span>
                  <textarea
                    aria-label="Исключённые сайты"
                    value={blockedDomains}
                    disabled={busy}
                    rows={5}
                    placeholder="example.com"
                    onChange={(event) => setBlockedDomains(event.target.value)}
                  />
                  <small>
                    Исключения важнее разрешений. Указывайте домен без https://, пути и символа *.
                  </small>
                </label>
              </div>
              <label className="asa-cloud-field">
                <span>Инструкции для ответов с интернет-поиском</span>
                <textarea
                  aria-label="Инструкции для ответов с интернет-поиском"
                  value={searchInstructions}
                  maxLength={3000}
                  disabled={busy}
                  rows={5}
                  placeholder="Например: сначала используй первоисточники и кратко сравни найденные сведения."
                  onChange={(event) => setSearchInstructions(event.target.value)}
                />
                <small>
                  Дополняют системный промпт при работе с найденными материалами.{' '}
                  {searchInstructions.length} / 3000 символов.
                </small>
              </label>
              <p className="asa-ai-web-admin-description">
                Фильтры применяются к веб-страницам и источникам найденных картинок. Прогноз погоды
                использует фиксированные источники MET Norway и OpenStreetMap.
              </p>
              {!validPolicy ? (
                <p role="alert">
                  Проверьте домены: до 50 в каждом списке, без адресов страниц, портов и масок.
                </p>
              ) : null}
            </>
          ) : (
            <p className="asa-ai-web-admin-description">
              Фильтры сайтов и инструкции появятся после обновления API и схемы ASA.
            </p>
          )}
          <section className="asa-ai-web-admin-weather" aria-label="Прогноз погоды">
            <h3>Прогноз погоды</h3>
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
          </section>
          {enabled && Number(limit) === 0 ? <p>Для поиска задайте лимит больше нуля.</p> : null}
          <div className="asa-cloud-bottom">
            <button
              type="submit"
              className="asa-cloud-apply"
              disabled={busy || loading || !validLimit || !validPolicy || !validRetrieval}
            >
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
