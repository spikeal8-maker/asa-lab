import { useEffect, useState, type FormEvent } from 'react';
import { call } from './admin-api';
import './ai-admin.css';

type Provider = 'openai' | 'deepseek';
type Model = 'gpt-5-mini' | 'gpt-4.1-mini' | 'deepseek-chat';

interface AiAdminConfig {
  readonly enabled: boolean;
  readonly provider: Provider;
  readonly model: Model;
  readonly apiKeyConfigured: boolean;
  readonly encryptionReady: boolean;
  readonly keyFingerprint: string | null;
  readonly configurationVersion: number;
  readonly updatedAt: string | null;
}

export function AiAdminPage({
  onAccessDenied,
}: {
  readonly onAccessDenied: () => void;
}): JSX.Element {
  const [config, setConfig] = useState<AiAdminConfig | null>(null);
  const [provider, setProvider] = useState<Provider>('openai');
  const [model, setModel] = useState<Model>('gpt-5-mini');
  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void call<AiAdminConfig>('/api/admin/v1/ai')
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          if (result.status === 401 || result.status === 403) onAccessDenied();
          else setError(result.error.message);
          return;
        }
        setConfig(result.data);
        setProvider(result.data.provider);
        setModel(result.data.model);
        setEnabled(result.data.enabled);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onAccessDenied]);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const result = await call<AiAdminConfig>('/api/admin/v1/ai', {
        method: 'PUT',
        body: JSON.stringify({
          enabled,
          provider,
          model,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(clearKey ? { clearApiKey: true } : {}),
        }),
      });
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) onAccessDenied();
        else setError(result.error.message);
        return;
      }
      setConfig(result.data);
      setProvider(result.data.provider);
      setModel(result.data.model);
      setEnabled(result.data.enabled);
      setApiKey('');
      setClearKey(false);
      setMessage('Настройки сохранены. Новый API-ключ не возвращается в браузер.');
    } finally {
      setSaving(false);
    }
  }

  const switched = config !== null && provider !== config.provider;
  return (
    <section className="asa-ai-admin" aria-labelledby="asa-ai-admin-title">
      <div className="admin-section-heading">
        <div>
          <h2 id="asa-ai-admin-title">ИИ и модели</h2>
          <p>
            Подключение GPT к ASA Lab. Ключ хранится на сервере, доступен только администратору
            платформы.
          </p>
        </div>
      </div>
      {loading ? <p role="status">Загружаем настройки…</p> : null}
      {error ? (
        <p className="admin-inline-error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="asa-ai-admin-success" role="status">
          {message}
        </p>
      ) : null}
      {config ? (
        <form onSubmit={(event) => void save(event)} className="asa-ai-admin-form">
          <div className="asa-ai-admin-status">
            <div>
              <span>Состояние ИИ</span>
              <strong>{config.enabled ? 'Включён' : 'Выключен'}</strong>
            </div>
            <div>
              <span>API-ключ</span>
              <strong>{config.apiKeyConfigured ? 'Настроен' : 'Не задан'}</strong>
            </div>
            <div>
              <span>Шифрование</span>
              <strong>{config.encryptionReady ? 'Готово' : 'Требует настройки сервера'}</strong>
            </div>
          </div>
          <label>
            <span>Провайдер</span>
            <select
              value={provider}
              onChange={(event) => {
                const next = event.target.value as Provider;
                setProvider(next);
                setModel(next === 'openai' ? 'gpt-5-mini' : 'deepseek-chat');
                setEnabled(false);
                setClearKey(false);
              }}
            >
              <option value="openai">OpenAI (GPT)</option>
              <option value="deepseek">DeepSeek</option>
            </select>
          </label>
          <label>
            <span>Модель</span>
            <select value={model} onChange={(event) => setModel(event.target.value as Model)}>
              {provider === 'openai' ? (
                <>
                  <option value="gpt-5-mini">GPT-5 mini</option>
                  <option value="gpt-4.1-mini">GPT-4.1 mini</option>
                </>
              ) : (
                <option value="deepseek-chat">DeepSeek Chat</option>
              )}
            </select>
          </label>
          <label>
            <span>
              Новый API-ключ {switched ? '(обязателен при смене провайдера)' : '(по необходимости)'}
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => {
                setApiKey(event.target.value);
                if (event.target.value) setClearKey(false);
              }}
              autoComplete="new-password"
              placeholder={
                config.apiKeyConfigured
                  ? 'Оставьте пустым, чтобы сохранить прежний ключ'
                  : 'Введите ключ API'
              }
              maxLength={2048}
              spellCheck={false}
            />
          </label>
          {config.keyFingerprint ? (
            <p className="asa-ai-admin-fingerprint">
              Отпечаток сохранённого ключа: {config.keyFingerprint}
            </p>
          ) : null}
          <label className="asa-ai-admin-check">
            <input
              type="checkbox"
              checked={clearKey}
              onChange={(event) => {
                setClearKey(event.target.checked);
                if (event.target.checked) {
                  setApiKey('');
                  setEnabled(false);
                }
              }}
              disabled={!config.apiKeyConfigured}
            />
            <span>Удалить сохранённый API-ключ</span>
          </label>
          <label className="asa-ai-admin-check">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              disabled={clearKey || !config.encryptionReady}
            />
            <span>Разрешить ИИ-запросы для вошедших в аккаунт пользователей</span>
          </label>
          {!config.encryptionReady ? (
            <p className="asa-ai-admin-warning">
              В окружении API необходимо настроить ASA_SETTINGS_ENCRYPTION_KEY. API-ключ модели
              нельзя безопасно сохранять без серверного ключа шифрования.
            </p>
          ) : null}
          <div className="asa-ai-admin-actions">
            <button
              type="submit"
              className="btn-primary"
              disabled={saving || loading || (switched && !apiKey.trim())}
            >
              {saving ? 'Сохраняем…' : 'Сохранить настройки'}
            </button>
            <small>
              Настройки вступают в силу для следующих запросов. Использование API платное и
              ограничено квотой.
            </small>
          </div>
        </form>
      ) : null}
    </section>
  );
}
