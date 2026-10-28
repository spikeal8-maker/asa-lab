import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  AiWebSearchAdminConfig,
  AiWebSearchAdminUpdate,
  AiWebSearchProbeResult,
} from '@asa-lab/contracts';
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

function probeShape(value: unknown): value is AiWebSearchProbeResult {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<AiWebSearchProbeResult>;
  return (
    data.schemaVersion === 1 &&
    typeof data.checkedAt === 'string' &&
    Number.isFinite(Date.parse(data.checkedAt)) &&
    Array.isArray(data.modes) &&
    data.modes.length === 2 &&
    (['web', 'images'] as const).every((mode) =>
      data.modes?.some(
        (item) =>
          item.mode === mode &&
          ['results', 'empty', 'invalid', 'filtered', 'partial', 'unavailable'].includes(
            item.status,
          ) &&
          Number.isFinite(item.durationMs) &&
          item.durationMs >= 0 &&
          (item.diagnostics === undefined ||
            (Number.isInteger(item.diagnostics.rawCount) &&
              Number.isInteger(item.diagnostics.validatedCount) &&
              Number.isInteger(item.diagnostics.postDomainCount) &&
              Number.isInteger(item.diagnostics.engineFailureCount) &&
              typeof item.diagnostics.partial === 'boolean')),
      ),
    )
  );
}

const probeStatus: Record<AiWebSearchProbeResult['modes'][number]['status'], string> = {
  results: 'Есть результаты в этой проверке',
  empty: 'Пусто в этом ограниченном запросе',
  invalid: 'В выдаче нет допустимых публичных URL',
  filtered: 'Результаты исключены правилами доменов',
  partial: 'Часть поисковых движков недоступна',
  unavailable: 'Не удалось проверить провайдера',
};

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
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [probeBusy, setProbeBusy] = useState(false);
  const [probe, setProbe] = useState<AiWebSearchProbeResult | null>(null);
  const [probeError, setProbeError] = useState('');
  const [reload, setReload] = useState(0);
  const inFlight = useRef(false);
  const apply = (data: AiWebSearchAdminConfig) => {
    setProbe(null);
    setConfig(data);
    setEnabled(data.enabled);
    setWeatherEnabled(data.weatherEnabled);
    setLimit(String(data.operationsPerHour));
    setAllowedDomains((data.allowedDomains ?? []).join('\n'));
    setBlockedDomains((data.blockedDomains ?? []).join('\n'));
    setSearchInstructions(data.searchInstructions ?? '');
  };
  async function runProbe() {
    if (!config || loading || busy || probeBusy) return;
    setProbeBusy(true);
    setProbe(null);
    setProbeError('');
    try {
      const reply = await call<unknown>('/api/admin/v1/ai/web-search/probe', {
        method: 'POST',
        body: '{}',
      });
      if (!reply.ok) {
        if (reply.status === 401 || reply.status === 403) onAccessDenied();
        setProbeError(
          reply.status === 429
            ? 'Ручную проверку можно повторить через минуту.'
            : 'Проверка поиска не удалась. Повторите её вручную.',
        );
      } else if (probeShape(reply.data)) setProbe(reply.data);
      else setProbeError('Сервер вернул несовместимый результат проверки.');
    } catch {
      setProbeError('Проверка поиска не удалась. Повторите её вручную.');
    } finally {
      setProbeBusy(false);
    }
  }
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
    if (!config || inFlight.current || loading || !validLimit || !validPolicy) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const payload: AiWebSearchAdminUpdate = {
      enabled,
      weatherEnabled,
      operationsPerHour: Number(limit),
      configurationVersion: config.configurationVersion,
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
          <section className="asa-ai-web-admin-probe" aria-label="Ручная проверка поиска">
            <h3>Ручная проверка поиска</h3>
            <p>
              Нейтральный запрос к фиксированному веб-поиску и поиску изображений. Проверка
              использует сохранённые фильтры сайтов даже при выключенном поиске. Она не изменяет
              настройки, не расходует пользовательскую квоту и ограничена одной проверкой в минуту
              на администратора на этом сервере. Результат не доказывает полноту интернета.
            </p>
            <button
              type="button"
              disabled={busy || probeBusy || loading}
              onClick={() => void runProbe()}
            >
              {probeBusy ? 'Проверяем…' : 'Проверить сейчас'}
            </button>
            {probeError ? <p role="alert">{probeError}</p> : null}
            {probe ? (
              <div role="status">
                <p>Проверено: {new Date(probe.checkedAt).toLocaleString('ru-RU')}</p>
                {probe.modes.map((result) => (
                  <p key={result.mode}>
                    {result.mode === 'web' ? 'Веб-поиск' : 'Поиск изображений'}:{' '}
                    {probeStatus[result.status]}; {result.durationMs} мс.
                    {result.diagnostics
                      ? ` Рассмотрено (до 32): ${result.diagnostics.rawCount}, допустимых URL: ${result.diagnostics.validatedCount}, после фильтра доменов: ${result.diagnostics.postDomainCount}, сбоев движков: ${result.diagnostics.engineFailureCount}.`
                      : ''}
                  </p>
                ))}
              </div>
            ) : null}
          </section>
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
              disabled={busy || loading || !validLimit || !validPolicy}
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
