import { useEffect, useRef, useState, type FormEvent } from 'react';
import { call, type AdminApiError } from './admin-api';
import './ai-ollama.css';

interface LlamaCppConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  revision: number;
  updatedAt: string | null;
  apiKeyConfigured: boolean;
  contextTokens: number | null;
  confirmedContextTokens: number | null;
  contextSource: 'metadata' | 'admin' | 'unknown';
  toolsVerified: boolean;
  temperature: number | null;
  topP: number | null;
  maxOutputTokens: number | null;
}

interface LlamaCppModel {
  id: string;
  contextTokens: number | null;
  tools: boolean;
}

interface LlamaCppApplied {
  config: LlamaCppConfig;
  verified: boolean;
  test: { model: string; contextTokens?: number | null; toolsVerified?: boolean } | null;
}

const diagnostics: Readonly<Record<string, string>> = {
  ai_llamacpp_auth: 'Сервер не принял API-ключ. Введите действующий ключ для этого адреса.',
  ai_llamacpp_admin_denied: 'Для изменения подключения нужны права администратора платформы.',
  ai_llamacpp_url_invalid: 'Введите IP, имя компьютера или HTTP(S)-адрес сервера без лишнего пути.',
  ai_llamacpp_url_denied: 'Адрес не разрешён сетевой политикой сервера ASA.',
  ai_llamacpp_key_invalid: 'Введите ключ заново для текущего адреса сервера.',
  ai_llamacpp_config_invalid: 'Проверьте выбранную модель и параметры генерации.',
  ai_llamacpp_context_invalid: 'Лимит контекста или ответа превышает возможности выбранной модели.',
  ai_llamacpp_config_changed: 'Настройки изменены другим администратором. Загрузите их заново.',
  ai_llamacpp_apply_pending:
    'Предыдущая проверка ещё выполняется. Повторите сохранение без изменения полей.',
  ai_llamacpp_replay_conflict:
    'Этот запрос уже использован для других настроек. Загрузите настройки заново.',
  ai_llamacpp_timeout: 'Сервер не ответил вовремя. Настройки не применены.',
  ai_llamacpp_busy:
    'Сервер занят. Попробуйте сохранить настройки после завершения текущего ответа.',
  ai_llamacpp_unreachable:
    'Нет связи с сервером llama.cpp. Проверьте адрес и сетевой доступ с ASA.',
  ai_llamacpp_upstream_error: 'Сервер llama.cpp вернул ошибку. Настройки не применены.',
  ai_llamacpp_unavailable: 'Подключение llama.cpp сейчас недоступно.',
};

function errorText(error: AdminApiError, status: number): string {
  return (
    diagnostics[error.code] ??
    (status === 0
      ? 'Ответ ASA не получен. Повтор сохранения без изменения полей проверит тот же запрос.'
      : 'Не удалось выполнить проверку. Предыдущие настройки сохранены.')
  );
}

function accessDenied(error: AdminApiError, status: number): boolean {
  return error.code !== 'ai_llamacpp_auth' && (status === 401 || status === 403);
}

function optionalNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function configShape(value: unknown): value is LlamaCppConfig {
  const data = value as LlamaCppConfig | null;
  return (
    !!data &&
    typeof data === 'object' &&
    typeof data.enabled === 'boolean' &&
    typeof data.baseUrl === 'string' &&
    typeof data.model === 'string' &&
    Number.isSafeInteger(data.revision) &&
    data.revision >= 0 &&
    (data.updatedAt === null || typeof data.updatedAt === 'string') &&
    typeof data.apiKeyConfigured === 'boolean' &&
    typeof data.toolsVerified === 'boolean' &&
    ['metadata', 'admin', 'unknown'].includes(data.contextSource) &&
    [
      data.contextTokens,
      data.confirmedContextTokens,
      data.temperature,
      data.topP,
      data.maxOutputTokens,
    ].every(optionalNumber)
  );
}

function modelsShape(value: unknown): value is { baseUrl: string; models: LlamaCppModel[] } {
  const data = value as { baseUrl?: unknown; models?: unknown } | null;
  return (
    !!data &&
    typeof data.baseUrl === 'string' &&
    Array.isArray(data.models) &&
    data.models.length <= 256 &&
    data.models.every(
      (model: LlamaCppModel) =>
        !!model &&
        typeof model.id === 'string' &&
        model.id.length > 0 &&
        typeof model.tools === 'boolean' &&
        (model.contextTokens === null ||
          (Number.isSafeInteger(model.contextTokens) && model.contextTokens > 0)),
    )
  );
}

const numericDraft = (value: number | null): string => (value === null ? '' : String(value));
const numberOrNull = (value: string): number | null => (value.trim() === '' ? null : Number(value));
function inRange(value: string, min: number, max: number, integer = false): boolean {
  if (value.trim() === '') return true;
  const number = Number(value);
  return (
    Number.isFinite(number) &&
    number >= min &&
    number <= max &&
    (!integer || Number.isSafeInteger(number))
  );
}

export function AdminLlamaCppPage({
  onAccessDenied,
  onUpdated,
  onDirtyChange,
}: {
  readonly onAccessDenied: () => void;
  readonly onUpdated?: () => void;
  readonly onDirtyChange?: (dirty: boolean) => void;
}) {
  const [saved, setSaved] = useState<LlamaCppConfig | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyEndpoint, setApiKeyEndpoint] = useState('');
  const [clearApiKey, setClearApiKey] = useState(false);
  const [contextTokens, setContextTokens] = useState('');
  const [temperature, setTemperature] = useState('');
  const [topP, setTopP] = useState('');
  const [maxOutputTokens, setMaxOutputTokens] = useState('');
  const [models, setModels] = useState<readonly LlamaCppModel[]>([]);
  const [discovery, setDiscovery] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [modelsError, setModelsError] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const discoveryController = useRef<AbortController | null>(null);
  const discoveryVersion = useRef(0);
  const applyController = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const attempt = useRef<{ signature: string; id: string } | null>(null);

  function restore(config: LlamaCppConfig): void {
    setSaved(config);
    setEnabled(config.enabled);
    setBaseUrl(config.baseUrl);
    setModel(config.model);
    setContextTokens(numericDraft(config.contextTokens));
    setTemperature(numericDraft(config.temperature));
    setTopP(numericDraft(config.topP));
    setMaxOutputTokens(numericDraft(config.maxOutputTokens));
    setApiKey('');
    setApiKeyEndpoint('');
    setClearApiKey(false);
  }

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void call<unknown>('/api/admin/v1/ai/llamacpp', { signal: controller.signal }).then(
      (response) => {
        if (controller.signal.aborted) return;
        if (!response.ok) {
          if (accessDenied(response.error, response.status)) onAccessDenied();
          setError(errorText(response.error, response.status));
        } else if (configShape(response.data)) {
          restore(response.data);
          attempt.current = null;
        } else setError('ASA вернула несовместимые настройки подключения.');
      },
    );
    return () => controller.abort();
  }, [onAccessDenied, reload]);

  useEffect(
    () => () => {
      discoveryVersion.current++;
      discoveryController.current?.abort();
      applyController.current?.abort();
    },
    [],
  );

  // Invalidate synchronously in input handlers, before any effect or late promise can run.
  function invalidateDiscovery(): void {
    discoveryVersion.current++;
    discoveryController.current?.abort();
    setModels([]);
    setModelsError('');
    setDiscovery('idle');
    setFeedback('');
  }

  useEffect(() => {
    const version = ++discoveryVersion.current;
    const controller = new AbortController();
    discoveryController.current = controller;
    setModels([]);
    setModelsError('');
    if (!saved || !baseUrl.trim()) {
      setDiscovery('idle');
      return () => controller.abort();
    }
    setDiscovery('loading');
    const timer = setTimeout(() => {
      void call<unknown>('/api/admin/v1/ai/llamacpp/models', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          baseUrl: baseUrl.trim(),
          revision: saved.revision,
          ...(apiKey ? { apiKey, apiKeyEndpoint } : {}),
          ...(clearApiKey ? { clearApiKey: true } : {}),
        }),
      }).then((response) => {
        if (controller.signal.aborted || discoveryVersion.current !== version) return;
        if (!response.ok) {
          if (accessDenied(response.error, response.status)) onAccessDenied();
          setModelsError(errorText(response.error, response.status));
          setDiscovery('error');
        } else if (modelsShape(response.data)) {
          const available = response.data.models;
          setModels(available);
          setModel((previous) =>
            available.length === 1
              ? available[0]!.id
              : available.some((entry) => entry.id === previous)
                ? previous
                : '',
          );
          setDiscovery('ready');
        } else {
          setModelsError('Сервер вернул несовместимый список моделей.');
          setDiscovery('error');
        }
      });
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [baseUrl, apiKey, apiKeyEndpoint, clearApiKey, saved?.revision, onAccessDenied]);

  const dirty =
    !!saved &&
    (enabled !== saved.enabled ||
      baseUrl !== saved.baseUrl ||
      model !== saved.model ||
      !!apiKey ||
      clearApiKey ||
      contextTokens !== numericDraft(saved.contextTokens) ||
      temperature !== numericDraft(saved.temperature) ||
      topP !== numericDraft(saved.topP) ||
      maxOutputTokens !== numericDraft(saved.maxOutputTokens));
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const selected = models.find((entry) => entry.id === model);
  const confirmedContext = selected?.contextTokens ?? null;
  const effectiveContext = numberOrNull(contextTokens) ?? confirmedContext;
  const validOptions =
    inRange(contextTokens, 1, confirmedContext ?? 1048576, true) &&
    inRange(temperature, 0, 2) &&
    inRange(topP, Number.MIN_VALUE, 1) &&
    inRange(maxOutputTokens, 1, effectiveContext ?? 1048576, true);
  const canApply =
    !!saved &&
    !saving &&
    (!enabled || (discovery === 'ready' && !!selected && validOptions && !!baseUrl.trim()));

  async function apply(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!saved || !canApply || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError('');
    setFeedback('');
    // Disabling remains possible even when an unfinished draft is invalid or unreachable.
    const input = enabled
      ? {
          enabled,
          baseUrl: baseUrl.trim(),
          model,
          revision: saved.revision,
          contextTokens: numberOrNull(contextTokens),
          temperature: numberOrNull(temperature),
          topP: numberOrNull(topP),
          maxOutputTokens: numberOrNull(maxOutputTokens),
          ...(apiKey ? { apiKey, apiKeyEndpoint } : {}),
          ...(clearApiKey ? { clearApiKey: true } : {}),
        }
      : {
          enabled: false,
          baseUrl: saved.baseUrl,
          model: saved.model,
          revision: saved.revision,
          contextTokens: saved.contextTokens,
          temperature: saved.temperature,
          topP: saved.topP,
          maxOutputTokens: saved.maxOutputTokens,
          ...(clearApiKey ? { clearApiKey: true } : {}),
        };
    const signature = JSON.stringify(input);
    if (attempt.current?.signature !== signature)
      attempt.current = { signature, id: crypto.randomUUID() };
    const controller = new AbortController();
    applyController.current = controller;
    try {
      const response = await call<LlamaCppApplied>('/api/admin/v1/ai/llamacpp/apply', {
        method: 'PUT',
        signal: controller.signal,
        body: JSON.stringify({ ...input, requestId: attempt.current.id }),
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (accessDenied(response.error, response.status)) onAccessDenied();
        setError(errorText(response.error, response.status));
        if (response.status !== 0 && response.error.code !== 'ai_llamacpp_apply_pending')
          attempt.current = null;
      } else if (configShape(response.data.config)) {
        restore(response.data.config);
        attempt.current = null;
        setFeedback(
          response.data.verified
            ? 'Сохранено · модель ответила на проверку'
            : 'llama.cpp выключен · рабочие параметры сохранены',
        );
        onUpdated?.();
      } else setError('ASA не подтвердила сохранённую конфигурацию. Загрузите настройки заново.');
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  const status =
    discovery === 'loading'
      ? 'Подключаемся…'
      : discovery === 'error'
        ? 'Нет подключения'
        : discovery === 'ready'
          ? models.length
            ? `Доступно моделей: ${models.length}`
            : 'Модели не найдены'
          : saved
            ? 'Введите адрес сервера'
            : 'Загружаем настройки…';

  return (
    <section className="asa-ai-ollama" aria-label="Настройки llama.cpp">
      <form className="asa-ai-ollama-form" noValidate onSubmit={(event) => void apply(event)}>
        <div className="asa-ai-provider-top">
          <div className="asa-ai-provider-identity">
            <h2>llama.cpp</h2>
            <span className="asa-ai-provider-subtitle">
              Текстовые модели · локально или по сети
            </span>
          </div>
          <label className="asa-ai-ollama-toggle">
            <input
              type="checkbox"
              aria-label="Включить llama.cpp"
              checked={enabled}
              disabled={!saved || saving}
              onChange={(event) => {
                setEnabled(event.target.checked);
                setFeedback('');
              }}
            />
            <span>{enabled ? 'Включено' : 'Выключено'}</span>
          </label>
        </div>
        {error ? (
          <div role="alert" className="asa-ai-ollama-error">
            {error}
            <button
              type="button"
              className="asa-ai-inline-retry"
              disabled={saving}
              onClick={() => setReload((value) => value + 1)}
            >
              Загрузить настройки
            </button>
          </div>
        ) : null}
        <div className="asa-ai-ollama-settings">
          <label className="asa-ai-ollama-field">
            <span>Адрес сервера</span>
            <input
              type="text"
              aria-label="Адрес llama.cpp"
              value={baseUrl}
              autoComplete="off"
              spellCheck={false}
              maxLength={256}
              disabled={!saved || saving}
              placeholder="llama-server:8080"
              onChange={(event) => {
                invalidateDiscovery();
                setBaseUrl(event.target.value);
                setModel('');
                setApiKey('');
                setApiKeyEndpoint('');
                setClearApiKey(false);
              }}
            />
          </label>
          <div className="asa-ai-ollama-connection" role="status" aria-live="polite">
            <span
              className={
                'asa-ai-status-dot ' +
                (discovery === 'loading'
                  ? 'loading'
                  : discovery === 'error'
                    ? 'offline'
                    : models.length
                      ? 'online'
                      : '')
              }
              aria-hidden="true"
            />
            <span>{status}</span>
          </div>
        </div>
        <label className="asa-ai-ollama-field">
          <span>API-ключ · если требуется сервером</span>
          <input
            type="password"
            aria-label="API-ключ llama.cpp"
            value={apiKey}
            autoComplete="new-password"
            spellCheck={false}
            maxLength={4096}
            disabled={!saved || saving || !baseUrl.trim()}
            placeholder={
              saved?.apiKeyConfigured && baseUrl === saved.baseUrl && !clearApiKey
                ? 'Ключ сохранён на сервере ASA'
                : 'Без ключа, если сервер не требует авторизацию'
            }
            onChange={(event) => {
              invalidateDiscovery();
              setApiKey(event.target.value);
              setApiKeyEndpoint(baseUrl.trim());
              setClearApiKey(false);
            }}
          />
        </label>
        {saved?.apiKeyConfigured && baseUrl === saved.baseUrl ? (
          <label className="asa-ai-ollama-toggle">
            <input
              type="checkbox"
              checked={clearApiKey}
              disabled={saving}
              onChange={(event) => {
                invalidateDiscovery();
                setClearApiKey(event.target.checked);
                setApiKey('');
                setApiKeyEndpoint('');
              }}
            />
            <span>Удалить сохранённый API-ключ llama.cpp</span>
          </label>
        ) : null}
        {modelsError ? (
          <p className="asa-ai-field-error" role="alert">
            {modelsError}
          </p>
        ) : null}
        {models.length ? (
          <>
            <div className="asa-ai-models-title">
              <h3>Модель</h3>
              <span>Доступные на выбранном сервере</span>
            </div>
            <div className="asa-ai-ollama-model-options" role="group" aria-label="Модели llama.cpp">
              {models.map((item) => (
                <div
                  key={item.id}
                  className={'asa-ai-ollama-model-card' + (model === item.id ? ' is-selected' : '')}
                >
                  <button
                    type="button"
                    className="asa-ai-ollama-model-option"
                    aria-pressed={model === item.id}
                    disabled={saving}
                    onClick={() => {
                      setModel(item.id);
                      setFeedback('');
                    }}
                  >
                    <span className="asa-ai-ollama-model-name">{item.id}</span>
                    <span className="asa-ai-ollama-model-indicator" aria-hidden="true">
                      {model === item.id ? '✓' : ''}
                    </span>
                  </button>
                  <span className="asa-ai-provider-subtitle">
                    {item.contextTokens
                      ? 'Подтверждённый контекст: ' +
                        item.contextTokens.toLocaleString('ru-RU') +
                        ' токенов'
                      : 'Размер контекста не подтверждён сервером'}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : null}
        <details className="asa-ai-ollama-help">
          <summary>Параметры генерации</summary>
          <div className="asa-ai-ollama-form">
            <label className="asa-ai-ollama-field">
              <span>Лимит контекста ASA, токенов</span>
              <input
                type="number"
                aria-label="Лимит контекста llama.cpp"
                min={1}
                max={confirmedContext ?? 1048576}
                step={1}
                value={contextTokens}
                disabled={!saved || saving}
                placeholder="Из метаданных сервера"
                onChange={(event) => {
                  setContextTokens(event.target.value);
                  setFeedback('');
                }}
              />
            </label>
            <p>
              {confirmedContext
                ? 'Лимит ASA может уменьшить подтверждённый контекст сервера.'
                : contextTokens
                  ? 'Лимит задан администратором; сервер его размер не подтвердил.'
                  : 'Если сервер не сообщает размер контекста, задайте допустимый лимит вручную.'}
            </p>
            <label className="asa-ai-ollama-field">
              <span>Температура</span>
              <input
                type="number"
                aria-label="Температура llama.cpp"
                min={0}
                max={2}
                step="any"
                value={temperature}
                disabled={!saved || saving}
                placeholder="По умолчанию сервера"
                onChange={(event) => {
                  setTemperature(event.target.value);
                  setFeedback('');
                }}
              />
            </label>
            <label className="asa-ai-ollama-field">
              <span>Top P</span>
              <input
                type="number"
                aria-label="Top P llama.cpp"
                min={0}
                max={1}
                step="any"
                value={topP}
                disabled={!saved || saving}
                placeholder="По умолчанию сервера"
                onChange={(event) => {
                  setTopP(event.target.value);
                  setFeedback('');
                }}
              />
            </label>
            <label className="asa-ai-ollama-field">
              <span>Максимальный ответ, токенов</span>
              <input
                type="number"
                aria-label="Максимальный ответ llama.cpp"
                min={1}
                max={effectiveContext ?? 1048576}
                step={1}
                value={maxOutputTokens}
                disabled={!saved || saving}
                placeholder="По умолчанию ASA"
                onChange={(event) => {
                  setMaxOutputTokens(event.target.value);
                  setFeedback('');
                }}
              />
            </label>
            {!validOptions ? (
              <p role="alert" className="asa-ai-field-error">
                Проверьте диапазоны параметров. Лимит ответа не может превышать контекст.
              </p>
            ) : null}
          </div>
        </details>
        {saved?.toolsVerified &&
        baseUrl === saved.baseUrl &&
        model === saved.model &&
        !apiKey &&
        !clearApiKey ? (
          <span className="asa-ai-provider-subtitle">
            Вызов инструментов подтверждён проверкой модели.
          </span>
        ) : null}
        <div className="asa-ai-ollama-bottom">
          <button className="asa-ai-ollama-primary" type="submit" disabled={!canApply}>
            {saving
              ? enabled
                ? 'Проверяем модель…'
                : 'Выключаем…'
              : enabled
                ? 'Сохранить и проверить'
                : 'Выключить и сохранить'}
          </button>
          {feedback ? (
            <span role="status" className="asa-ai-ollama-confirmed">
              {feedback}
            </span>
          ) : dirty ? (
            <span className="asa-ai-provider-subtitle" role="status">
              Не сохранено
            </span>
          ) : null}
        </div>
      </form>
      <details className="asa-ai-ollama-help">
        <summary>Подключение и доступ в чате</summary>
        <p>
          Введите IP, имя компьютера или полный HTTP(S)-адрес. Для адреса без порта используется
          8080. Список моделей загружается автоматически. При смене адреса введите ключ заново.
        </p>
        <p>
          После сохранения доступ в чате определяется настройками ASA и правилами класса.{' '}
          <a href="#/admin/ai?section=settings&provider=llamacpp-local">Разрешённые модели</a>.
        </p>
        <p>MTP настраивается на сервере llama.cpp.</p>
      </details>
    </section>
  );
}
