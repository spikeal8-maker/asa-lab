import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AiWebSearchAdminConfig, AiWebSearchAdminUpdate } from '@asa-lab/contracts';
import { call } from './admin-api';
import { InfoHint } from '../components/InfoHint';
import type { AiToolId } from '@asa-lab/contracts';
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
  selectedTool,
  onDirtyChange,
  presentation = 'all',
}: {
  readonly onAccessDenied: () => void;
  readonly selectedTool?: AiToolId;
  readonly presentation?: 'all' | 'parameters' | 'switches';
  readonly onDirtyChange?: (dirty: boolean) => void;
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
  const dirty =
    config !== null &&
    (enabled !== config.enabled ||
      weatherEnabled !== config.weatherEnabled ||
      limit !== String(config.operationsPerHour) ||
      allowedDomains !== (config.allowedDomains ?? []).join('\n') ||
      blockedDomains !== (config.blockedDomains ?? []).join('\n') ||
      searchInstructions !== (config.searchInstructions ?? '') ||
      resultsLimit !== String(config.resultsLimit ?? 8) ||
      pagesLimit !== String(config.pagesLimit ?? 2) ||
      pageCharLimit !== String(config.pageCharLimit ?? 4500));
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const show = (...ids: AiToolId[]) => selectedTool === undefined || ids.includes(selectedTool);
  const search = show('web_search', 'image_search');
  const pages = show('read_page');

  const AdvancedSettings = presentation === 'parameters' ? 'details' : 'div';
  return (
    <section
      className={'asa-ai-web-admin asa-cloud-connection asa-ai-network-' + presentation}
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
          <div className="asa-ai-web-section-heading">
            <h3>
              {presentation === 'switches' ? 'Доступ инструментов в интернет' : 'Параметры сети'}
            </h3>
            <InfoHint label="Общие настройки сетевых инструментов">
              <p>
                Поиск, чтение страниц, поиск изображений и погода используют общий сетевой доступ и
                часовой лимит. Изменения применяются к новым запросам. Разрешение каждого
                инструмента настраивается в списке инструментов.
              </p>
            </InfoHint>
          </div>
          <div className="asa-ai-web-common">
            <label className="asa-cloud-enabled" hidden={presentation === 'parameters'}>
              <input
                type="checkbox"
                checked={enabled}
                disabled={busy}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              Доступ в интернет
            </label>
            <label
              className="asa-cloud-field asa-ai-web-admin-limit"
              hidden={presentation === 'switches'}
            >
              <span>
                Операций в час{' '}
                <InfoHint label="Как работает часовой лимит">
                  <p>
                    Общий действующий лимит сетевых операций для сервиса. Ноль запрещает новые
                    операции; сохранение не отправляет поисковый запрос.
                  </p>
                </InfoHint>
              </span>
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
            </label>
          </div>
          {presentation === 'parameters' && !enabled ? (
            <p role="status">
              Доступ в интернет выключен.{' '}
              <a href="#/admin/ai?section=settings">Включить в Настройках →</a>
            </p>
          ) : null}
          {search && !config.configured ? (
            <p role="status">
              Не настроен адрес SearxNG на сервере. Проверьте конфигурацию поискового сервиса.
            </p>
          ) : null}
          <fieldset
            className="asa-ai-web-retrieval"
            disabled={busy || !retrievalSupported}
            hidden={presentation === 'switches' || (!search && !pages)}
          >
            <legend>
              Выдача и чтение{' '}
              <InfoHint label="Выдача и чтение страниц">
                <p>
                  Поиск даёт список ссылок с краткими описаниями. Модель сама выбирает страницы для
                  чтения отдельным инструментом. Эти параметры общие для поиска и чтения страниц.
                </p>
              </InfoHint>
            </legend>
            <div className="asa-ai-web-retrieval-grid">
              <label className="asa-cloud-field" hidden={!search}>
                <span>
                  Результатов{' '}
                  <InfoHint label="Количество результатов">
                    <p>От 1 до 12 ссылок или картинок в выдаче инструмента.</p>
                  </InfoHint>
                </span>
                <input
                  type="number"
                  min="1"
                  max="12"
                  step="1"
                  value={resultsLimit}
                  aria-label="Результатов поиска"
                  onChange={(event) => setResultsLimit(event.target.value)}
                />
              </label>
              <label className="asa-cloud-field" hidden={!pages}>
                <span>
                  Страниц{' '}
                  <InfoHint label="Количество читаемых страниц">
                    <p>Модель выбирает до двух страниц за запрос. Ноль отключает чтение страниц.</p>
                  </InfoHint>
                </span>
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="1"
                  value={pagesLimit}
                  aria-label="Страниц для чтения"
                  onChange={(event) => setPagesLimit(event.target.value)}
                />
              </label>
              <label className="asa-cloud-field" hidden={!pages}>
                <span>
                  Символов со страницы{' '}
                  <InfoHint label="Объём текста страницы">
                    <p>
                      От 500 до 8000 символов текста каждой выбранной страницы передаётся модели.
                    </p>
                  </InfoHint>
                </span>
                <input
                  type="number"
                  min="500"
                  max="8000"
                  step="1"
                  value={pageCharLimit}
                  aria-label="Символов со страницы"
                  onChange={(event) => setPageCharLimit(event.target.value)}
                />
              </label>
            </div>
          </fieldset>
          {!retrievalSupported && (search || pages) ? (
            <p role="status">Для настройки выдачи и чтения требуется обновление схемы поиска.</p>
          ) : null}
          <AdvancedSettings
            className={presentation === 'parameters' ? 'asa-ai-tool-disclosure' : undefined}
            hidden={presentation === 'switches' || (!search && !pages)}
          >
            {presentation === 'parameters' ? (
              <summary>Фильтры и ответы по источникам</summary>
            ) : null}
            {policySupported ? (
              <>
                <div className="asa-ai-web-admin-domains">
                  <label className="asa-cloud-field">
                    <span>
                      Разрешённые сайты{' '}
                      <InfoHint label="Правила разрешённых сайтов">
                        <p>
                          До 50 доменов, каждый с новой строки. Пустой список разрешает любые
                          публичные сайты. Поддомены включаются. Фильтр общий для поиска, чтения и
                          источников картинок.
                        </p>
                      </InfoHint>
                    </span>
                    <textarea
                      aria-label="Разрешённые сайты"
                      value={allowedDomains}
                      disabled={busy}
                      rows={3}
                      placeholder={'example.org\nнаука.рф'}
                      onChange={(event) => setAllowedDomains(event.target.value)}
                    />
                  </label>
                  <label className="asa-cloud-field">
                    <span>
                      Исключённые сайты{' '}
                      <InfoHint label="Правила исключённых сайтов">
                        <p>
                          Исключения важнее разрешений. До 50 доменов без https://, путей, портов и
                          масок.
                        </p>
                      </InfoHint>
                    </span>
                    <textarea
                      aria-label="Исключённые сайты"
                      value={blockedDomains}
                      disabled={busy}
                      rows={3}
                      placeholder="example.com"
                      onChange={(event) => setBlockedDomains(event.target.value)}
                    />
                  </label>
                </div>
                <label className="asa-cloud-field">
                  <span>
                    Инструкция для ответа по источникам{' '}
                    <InfoHint label="Как применяется инструкция поиска">
                      <p>
                        Дополняет системный промпт при работе с найденными материалами. Общая для
                        сетевых источников; до 3000 символов. Не меняет разрешения и проверки
                        безопасности.
                      </p>
                    </InfoHint>
                  </span>
                  <textarea
                    aria-label="Инструкции для ответов с интернет-поиском"
                    value={searchInstructions}
                    maxLength={3000}
                    disabled={busy}
                    rows={3}
                    placeholder="Сначала первоисточники, затем краткое сравнение."
                    onChange={(event) => setSearchInstructions(event.target.value)}
                  />
                </label>
                {!validPolicy ? (
                  <p role="alert">
                    Проверьте домены: до 50 в каждом списке, без адресов страниц, портов и масок.
                  </p>
                ) : null}
              </>
            ) : (
              <p role="status">
                Для фильтров сайтов и инструкции требуется обновление API и схемы поиска.
              </p>
            )}
          </AdvancedSettings>
          <section
            className="asa-ai-web-admin-weather"
            aria-label="Прогноз погоды"
            hidden={presentation === 'parameters' || !show('weather')}
          >
            <label className="asa-cloud-consent">
              <input
                type="checkbox"
                checked={weatherEnabled}
                disabled={busy}
                onChange={(event) => setWeatherEnabled(event.target.checked)}
              />
              Включить прогноз погоды
              <InfoHint label="Источники прогноза погоды">
                <p>
                  MET Norway — прогноз, OpenStreetMap — поиск города. Город берётся из запроса.
                  Источник и время отображаются в ответе. Фильтры сайтов не меняют фиксированные
                  источники погоды.
                </p>
                <a
                  href="https://operations.osmfoundation.org/policies/nominatim/"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Правила поиска городов
                </a>
              </InfoHint>
            </label>
            {!config.weatherConfigured ? (
              <p role="status">Не настроен источник прогноза или поиска городов на сервере.</p>
            ) : null}
          </section>
          {enabled && Number(limit) === 0 ? <p>Для поиска задайте лимит больше нуля.</p> : null}
          <div className="asa-cloud-bottom">
            <button
              type="submit"
              className="asa-cloud-apply"
              disabled={busy || loading || !validLimit || !validPolicy || !validRetrieval}
            >
              {busy
                ? 'Сохраняем…'
                : presentation === 'switches'
                  ? 'Сохранить доступ в интернет'
                  : 'Сохранить параметры сети'}
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
