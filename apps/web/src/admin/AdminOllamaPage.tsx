import { useEffect, useState, type FormEvent } from 'react';
import { call } from './admin-api';
import './ai-ollama.css';

interface OllamaConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  revision: number;
  updatedAt: string | null;
  thinking?: string;
  contextTokens?: number;
}
interface OllamaModel {
  name: string;
  size: number;
}
interface ModelDetail {
  thinking: { values: (boolean | string)[]; default: boolean | string | null } | null;
  contextMax: number | null;
}
function modeValue(value: boolean | string): string {
  return value === false ? 'off' : value === true ? 'on' : value;
}
function modeLabel(value: string): string {
  return (
    (
      {
        default: 'По умолчанию модели',
        off: 'Выключено',
        on: 'Включено',
        low: 'Низкое',
        medium: 'Среднее',
        high: 'Высокое',
        xhigh: 'Максимальное',
        max: 'Максимальное',
      } as Record<string, string>
    )[value] ?? value
  );
}
interface OllamaApplied {
  config: OllamaConfig;
  verified: boolean;
  test: { model: string; elapsedMs: number; testedAt: string } | null;
}

function readableSize(bytes: number): string {
  return Number.isFinite(bytes) && bytes > 0 ? (bytes / 1024 ** 3).toFixed(1) + ' ГиБ' : '';
}

function modelsLabel(count: number): string {
  const plural =
    count % 10 === 1 && count % 100 !== 11
      ? 'модель'
      : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)
        ? 'модели'
        : 'моделей';
  return 'Доступно · ' + count + ' ' + plural;
}

export function AdminOllamaPage({
  onAccessDenied,
  onUpdated,
}: {
  readonly onAccessDenied: () => void;
  readonly onUpdated?: () => void;
}) {
  const [saved, setSaved] = useState<OllamaConfig | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [thinking, setThinking] = useState('default');
  const [contextTokens, setContextTokens] = useState(65536);
  const [detail, setDetail] = useState<ModelDetail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [models, setModels] = useState<readonly OllamaModel[]>([]);
  const [checkingModels, setCheckingModels] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void call<OllamaConfig>('/api/admin/v1/ai/ollama').then((response) => {
      if (!active) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) onAccessDenied();
        setError(response.error.message || 'Не удалось загрузить настройки.');
        return;
      }
      setSaved(response.data);
      setEnabled(response.data.enabled);
      setBaseUrl(response.data.baseUrl);
      setModel(response.data.model);
      setThinking(response.data.thinking ?? 'default');
      setContextTokens(response.data.contextTokens ?? 65536);
      setError('');
    });
    return () => {
      active = false;
    };
  }, [attempt, onAccessDenied]);

  // Detect models on entry and after changing the endpoint, not from a separate action.
  useEffect(() => {
    if (!saved || !baseUrl.trim()) {
      setModels([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      setCheckingModels(true);
      setModelsError('');
      void call<{ models: OllamaModel[] }>('/api/admin/v1/ai/ollama/models', {
        method: 'POST',
        body: JSON.stringify({ baseUrl: baseUrl.trim() }),
      })
        .then((response) => {
          if (!active) return;
          if (response.ok) {
            setModels(response.data.models);
            setModelsError('');
          } else {
            setModels([]);
            setModelsError(response.error.message || 'Нет связи с Ollama.');
          }
        })
        .finally(() => {
          if (active) setCheckingModels(false);
        });
    }, 450);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [baseUrl, saved?.revision]);

  useEffect(() => {
    setDetail(null);
    setDetailError('');
    if (!saved || !baseUrl.trim() || !model.trim()) return;
    let active = true;
    setDetailLoading(true);
    const timer = setTimeout(() => {
      void call<ModelDetail>('/api/admin/v1/ai/ollama/model-detail', {
        method: 'POST',
        body: JSON.stringify({ baseUrl: baseUrl.trim(), model: model.trim() }),
      })
        .then((response) => {
          if (!active) return;
          if (response.ok) setDetail(response.data);
          else setDetailError(response.error.message || 'Возможности не определены');
        })
        .finally(() => {
          if (active) setDetailLoading(false);
        });
    }, 450);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [baseUrl, model, saved?.revision]);

  async function apply(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!saved || saving) return;
    setSaving(true);
    setError('');
    setFeedback('');
    try {
      const response = await call<OllamaApplied>('/api/admin/v1/ai/ollama/apply', {
        method: 'PUT',
        body: JSON.stringify({
          enabled,
          baseUrl: baseUrl.trim(),
          model: model.trim(),
          revision: saved.revision,
          thinking,
          contextTokens,
        }),
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) onAccessDenied();
        setError(response.error.message || 'Настройки не сохранены: проверка не прошла.');
        return;
      }
      setSaved(response.data.config);
      setBaseUrl(response.data.config.baseUrl);
      setModel(response.data.config.model);
      setThinking(response.data.config.thinking ?? 'default');
      setContextTokens(response.data.config.contextTokens ?? 65536);
      setEnabled(response.data.config.enabled);
      onUpdated?.();
      setFeedback(
        response.data.verified && response.data.test
          ? 'Сохранено · ' +
              response.data.test.model +
              ' · ' +
              (response.data.test.elapsedMs / 1000).toFixed(1) +
              ' с'
          : 'Отключено · настройки сохранены',
      );
    } finally {
      setSaving(false);
    }
  }

  const defaultMode =
    detail?.thinking?.default !== false && detail?.thinking?.default != null
      ? detail.thinking.default
      : detail?.thinking?.values.find((v) => v !== false);
  const selectedMode =
    thinking === 'default' && defaultMode !== undefined
      ? 'По умолчанию · ' + modeLabel(modeValue(defaultMode))
      : modeLabel(thinking);

  const inferenceControls = (
    <div className="asa-ai-ollama-inference">
      <details className="asa-ai-ollama-reasoning">
        <summary>
          <span>
            Размышление ·{' '}
            {detailLoading
              ? 'Определяем…'
              : detailError
                ? 'Не определено'
                : detail?.thinking?.values.some((v) => v !== false)
                  ? selectedMode
                  : detail
                    ? 'Не поддерживается'
                    : 'Не определено'}
          </span>
          <span aria-hidden="true">▾</span>
        </summary>
        <div className="asa-ai-ollama-reasoning-menu">
          {detailError ? <p role="alert">{detailError}</p> : null}
          {detail?.thinking ? (
            <label>
              Режим размышления
              <select
                aria-label="Режим размышления Ollama"
                value={thinking}
                disabled={saving}
                onChange={(event) => {
                  setThinking(event.target.value);
                  setFeedback('');
                }}
              >
                <option value="default">
                  По умолчанию модели
                  {defaultMode !== undefined ? ' · ' + modeLabel(modeValue(defaultMode)) : ''}
                </option>
                {detail.thinking.values.map((value) => (
                  <option key={String(value)} value={modeValue(value)}>
                    {modeLabel(modeValue(value))}
                  </option>
                ))}
                {thinking !== 'default' &&
                !detail.thinking.values.some((v) => modeValue(v) === thinking) ? (
                  <option value={thinking} disabled>
                    Ранее выбранный режим недоступен
                  </option>
                ) : null}
              </select>
              <small>
                По умолчанию размышление включено, если модель предоставляет такой режим.
              </small>
            </label>
          ) : (
            <p>
              {detailLoading
                ? 'Получаем возможности модели…'
                : 'Ollama не сообщила доступные режимы размышления.'}
            </p>
          )}
        </div>
      </details>
      <label className="asa-ai-ollama-context">
        <span>Контекст · токены</span>
        <input
          type="number"
          list="asa-ollama-context-presets"
          aria-label="Контекст Ollama"
          min={2048}
          max={Math.min(detail?.contextMax ?? 1048576, 1048576)}
          step={1}
          required
          value={contextTokens || ''}
          disabled={!saved || saving}
          onChange={(event) => {
            setContextTokens(event.target.valueAsNumber);
            setFeedback('');
          }}
        />
        <datalist id="asa-ollama-context-presets">
          {[8192, 16384, 32768, 65536, 120000, 131072]
            .filter((v) => v <= (detail?.contextMax ?? 1048576))
            .map((v) => (
              <option key={v} value={v} />
            ))}
        </datalist>
      </label>
    </div>
  );

  return (
    <section className="asa-ai-ollama" aria-label="Настройки Ollama">
      <form className="asa-ai-ollama-form" onSubmit={(event) => void apply(event)}>
        <div className="asa-ai-provider-top">
          <div className="asa-ai-provider-identity">
            <h2>Ollama</h2>
            <span className="asa-ai-provider-subtitle">
              Текстовые модели · локально или по сети
            </span>
          </div>
          <label className="asa-ai-ollama-toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => {
                setEnabled(event.target.checked);
                setFeedback('');
              }}
              disabled={!saved || saving}
            />
            <span>{enabled ? 'Включено' : 'Выключено'}</span>
          </label>
        </div>

        {error ? (
          <div role="alert" className="asa-ai-ollama-error">
            {error}
            {!saved ? (
              <button
                type="button"
                className="asa-ai-inline-retry"
                onClick={() => setAttempt((v) => v + 1)}
              >
                Повторить
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="asa-ai-ollama-settings">
          <label className="asa-ai-ollama-field">
            <span>Адрес сервера</span>
            <input
              type="url"
              aria-label="Адрес Ollama"
              value={baseUrl}
              onChange={(event) => {
                setBaseUrl(event.target.value);
                setFeedback('');
              }}
              placeholder="http://host.docker.internal:11434"
              autoComplete="off"
              spellCheck={false}
              maxLength={256}
              required
              disabled={!saved || saving}
            />
          </label>
          <div className="asa-ai-ollama-connection" role="status" aria-live="polite">
            <span
              className={
                'asa-ai-status-dot ' +
                (checkingModels
                  ? 'loading'
                  : modelsError
                    ? 'offline'
                    : models.length
                      ? 'online'
                      : '')
              }
              aria-hidden="true"
            />
            <span>
              {checkingModels
                ? 'Подключаемся…'
                : modelsError
                  ? 'Нет связи'
                  : models.length
                    ? modelsLabel(models.length)
                    : 'Модели не найдены'}
            </span>
          </div>
        </div>
        {modelsError ? (
          <p className="asa-ai-field-error" role="alert">
            {modelsError}
          </p>
        ) : null}

        <div className="asa-ai-models-title">
          <h3>Модель</h3>
          <span>
            {models.length ? 'Установленные на выбранном сервере' : 'Введите название модели'}
          </span>
        </div>
        {models.length ? (
          <div
            className="asa-ai-ollama-model-options"
            role="group"
            aria-label="Установленные модели Ollama"
          >
            {models.map((item) => (
              <div key={item.name} className="asa-ai-ollama-model-card">
                <button
                  type="button"
                  className={
                    'asa-ai-ollama-model-option' + (model === item.name ? ' is-selected' : '')
                  }
                  aria-pressed={model === item.name}
                  disabled={saving}
                  onClick={() => {
                    setModel(item.name);
                    if (item.name !== model) setThinking('default');
                    setFeedback('');
                  }}
                >
                  <span className="asa-ai-ollama-model-name">{item.name}</span>
                  <span className="asa-ai-ollama-model-size">{readableSize(item.size)}</span>
                  <span className="asa-ai-ollama-model-indicator" aria-hidden="true">
                    {model === item.name ? '✓' : ''}
                  </span>
                </button>
                {model === item.name ? inferenceControls : null}
              </div>
            ))}
          </div>
        ) : (
          <label className="asa-ai-ollama-field">
            <span className="asa-ai-visually-hidden">Модель</span>
            <input
              aria-label="Модель Ollama"
              value={model}
              maxLength={100}
              required
              onChange={(event) => {
                setModel(event.target.value);
                setFeedback('');
              }}
              spellCheck={false}
              disabled={!saved || saving}
              placeholder="Например: gemma4:12b"
            />
          </label>
        )}

        {!models.length ? inferenceControls : null}
        <p className="asa-ai-ollama-inference-hint">
          Контекст применяется со следующим запросом и может потребовать перераспределения памяти
          Ollama. Для общего сервера согласуйте его с другими приложениями.
        </p>

        <div className="asa-ai-ollama-bottom">
          <button
            className="asa-ai-ollama-primary"
            type="submit"
            disabled={!saved || saving || !model.trim() || !baseUrl.trim()}
          >
            {saving
              ? 'Проверяем модель…'
              : enabled
                ? 'Сохранить и проверить'
                : 'Сохранить выключенным'}
          </button>
          {feedback ? (
            <span role="status" className="asa-ai-ollama-confirmed">
              {feedback}
            </span>
          ) : null}
        </div>
      </form>
      <details className="asa-ai-ollama-help">
        <summary>Подключение по сети или SSH</summary>
        <p>
          Этот компьютер: <code>http://host.docker.internal:11434</code>. Другой компьютер в сети:
          <code>http://192.168.1.20:11434</code>. Через SSH-туннель используйте адрес его локального
          порта на Docker-хосте.
        </p>
      </details>
    </section>
  );
}
