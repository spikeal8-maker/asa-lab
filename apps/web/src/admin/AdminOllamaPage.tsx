import { useEffect, useState, type FormEvent } from 'react';
import { call } from './admin-api';
import './ai-ollama.css';

interface OllamaConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  revision: number;
  updatedAt: string | null;
}
interface OllamaModel {
  name: string;
  size: number;
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

export function AdminOllamaPage({ onAccessDenied }: { readonly onAccessDenied: () => void }) {
  const [saved, setSaved] = useState<OllamaConfig | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
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
  }, [baseUrl, saved?.revision]); // eslint-disable-line react-hooks/exhaustive-deps

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
      setEnabled(response.data.config.enabled);
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
              <button
                key={item.name}
                type="button"
                className={
                  'asa-ai-ollama-model-option' + (model === item.name ? ' is-selected' : '')
                }
                aria-pressed={model === item.name}
                disabled={saving}
                onClick={() => {
                  setModel(item.name);
                  setFeedback('');
                }}
              >
                <span className="asa-ai-ollama-model-name">{item.name}</span>
                <span className="asa-ai-ollama-model-size">{readableSize(item.size)}</span>
                <span className="asa-ai-ollama-model-indicator" aria-hidden="true">
                  {model === item.name ? '✓' : ''}
                </span>
              </button>
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
