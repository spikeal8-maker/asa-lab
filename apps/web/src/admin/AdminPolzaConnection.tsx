import { useEffect, useState, type FormEvent } from 'react';
import { call } from './admin-api';
import { isPolzaConfig, type AiPolzaAdminConfig } from './ai-polza-admin';
import './ai-media-admin.css';

interface CheckReceipt {
  readonly ready: true;
  readonly latencyMs: number;
  readonly checkedAt: string;
}

/** One server-owned credential: never reflect or persist the secret in browser storage. */
export function AdminPolzaConnection({
  onAccessDenied,
  onUpdated,
  onDirtyChange,
}: {
  readonly onAccessDenied: () => void;
  readonly onUpdated?: () => void;
  readonly onDirtyChange?: (dirty: boolean) => void;
}) {
  const [config, setConfig] = useState<AiPolzaAdminConfig | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void call<unknown>('/api/admin/v1/ai/polza').then((reply) => {
      if (!mounted) return;
      setLoading(false);
      if (reply.ok && isPolzaConfig(reply.data)) {
        setConfig(reply.data);
        setEnabled(reply.data.enabled);
        setKeyInput('');
        setClearKey(false);
        setError('');
      } else {
        setConfig(null);
        if (!reply.ok && (reply.status === 401 || reply.status === 403)) onAccessDenied();
        setError('Настройки Polza AI недоступны. Проверьте установку новой версии API.');
      }
    });
    return () => {
      mounted = false;
    };
  }, [reload, onAccessDenied]);

  const dirty = !!config && (enabled !== config.enabled || !!keyInput || clearKey);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const keyReady = !!keyInput || (!!config?.apiKeyConfigured && !clearKey);
  const canSave =
    !!config &&
    dirty &&
    !busy &&
    !loading &&
    config.encryptionReady &&
    (!enabled || keyReady) &&
    (!keyInput || /^pza_[A-Za-z0-9_-]{8,2040}$/.test(keyInput));

  async function check(): Promise<void> {
    const result = await call<CheckReceipt>('/api/admin/v1/ai/polza/check', {
      method: 'POST',
      body: '{}',
    });
    if (!result.ok) {
      if ([401, 403].includes(result.status)) onAccessDenied();
      setError(result.error.message);
      return;
    }
    setMessage('Подключение подтверждено · ' + (result.data.latencyMs / 1000).toFixed(1) + ' с');
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSave || !config) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await call<unknown>('/api/admin/v1/ai/polza', {
        method: 'PUT',
        body: JSON.stringify({
          configurationVersion: config.configurationVersion,
          enabled,
          transcriptionEnabled: enabled ? config.transcriptionEnabled : false,
          dailySecondsLimit: config.dailySecondsLimit,
          globalDailySecondsLimit: config.globalDailySecondsLimit,
          maxAudioSeconds: config.maxAudioSeconds,
          ...(keyInput ? { apiKey: keyInput } : {}),
          ...(clearKey ? { clearApiKey: true } : {}),
        }),
      });
      if (!result.ok || !isPolzaConfig(result.data)) {
        if (!result.ok && [401, 403].includes(result.status)) onAccessDenied();
        setError(
          !result.ok
            ? result.status === 409
              ? 'Настройки изменились. Обновите страницу перед сохранением.'
              : result.error.message
            : 'Сервер вернул несовместимые настройки.',
        );
        return;
      }
      setConfig(result.data);
      setEnabled(result.data.enabled);
      setKeyInput('');
      setClearKey(false);
      setMessage('Ключ и параметры сохранены на сервере');
      onUpdated?.();
      if (result.data.enabled) await check();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="asa-ai-integration-panel" aria-label="Подключение Polza AI">
      <header className="asa-ai-integration-header">
        <div>
          <h2>Polza AI</h2>
          <p>Единый ключ для речи и будущих текстовых и графических моделей.</p>
        </div>
        <span className="asa-ai-integration-state">
          {config?.enabled
            ? 'Включено'
            : config?.apiKeyConfigured
              ? 'Ключ сохранён'
              : 'Не подключено'}
        </span>
      </header>
      {loading ? <p role="status">Загрузка настроек…</p> : null}
      {error ? (
        <p role="alert" className="asa-ai-integration-error">
          {error}{' '}
          {!config ? (
            <button type="button" onClick={() => setReload((value) => value + 1)}>
              Повторить
            </button>
          ) : null}
        </p>
      ) : null}
      {config ? (
        <form className="asa-polza-form" onSubmit={(event) => void save(event)}>
          <div className="asa-polza-control-row">
            <label className="asa-polza-key">
              <span>API-ключ</span>
              <input
                type="password"
                aria-label="API-ключ Polza AI"
                autoComplete="new-password"
                spellCheck={false}
                maxLength={2048}
                value={keyInput}
                disabled={busy || clearKey || !config.encryptionReady}
                placeholder={
                  config.apiKeyConfigured ? 'Сохранён · введите новый для замены' : 'pza_…'
                }
                onChange={(event) => {
                  setKeyInput(event.target.value);
                  setMessage('');
                }}
              />
            </label>
            <label className="asa-polza-switch">
              <input
                type="checkbox"
                checked={enabled}
                disabled={busy || !config.encryptionReady}
                onChange={(event) => {
                  setEnabled(event.target.checked);
                  setMessage('');
                }}
              />
              Использовать Polza AI
            </label>
          </div>
          <div className="asa-polza-actions">
            <button className="asa-polza-primary" type="submit" disabled={!canSave}>
              {busy ? 'Сохраняем…' : enabled ? 'Сохранить и проверить' : 'Сохранить'}
            </button>
            <button
              type="button"
              className="asa-polza-secondary"
              disabled={busy || dirty || !config.apiKeyConfigured}
              onClick={() => void check()}
            >
              Проверить
            </button>
            <a href="https://polza.ai/dashboard/api-keys" target="_blank" rel="noopener noreferrer">
              Получить ключ
            </a>
            {message ? (
              <span role="status" className="asa-polza-confirmed">
                {message}
              </span>
            ) : null}
          </div>
          {!config.encryptionReady ? (
            <p role="alert" className="asa-ai-integration-error">
              На сервере недоступно шифрование ключей.
            </p>
          ) : null}
          <details className="asa-polza-advanced">
            <summary>Дополнительно</summary>
            <p>
              Ключ хранится только на сервере (AES-256-GCM). Проверка выполняет запрос списка
              моделей, без платной транскрибации.
            </p>
            {config.apiKeyConfigured ? (
              <label className="asa-polza-switch">
                <input
                  type="checkbox"
                  checked={clearKey}
                  disabled={busy}
                  onChange={(event) => {
                    setClearKey(event.target.checked);
                    if (event.target.checked) {
                      setEnabled(false);
                      setKeyInput('');
                    }
                  }}
                />
                Удалить сохранённый ключ при сохранении
              </label>
            ) : null}
          </details>
        </form>
      ) : null}
      <div className="asa-polza-capabilities" aria-label="Направления Polza AI">
        <div>
          <strong>Текст</strong>
          <span>Адаптер планируется</span>
        </div>
        <div>
          <strong>Изображения</strong>
          <span>Адаптер планируется</span>
        </div>
        <div>
          <strong>Транскрибация</strong>
          <span>{config?.transcriptionEnabled ? 'Включена' : 'Настраивается отдельно'}</span>
        </div>
      </div>
    </section>
  );
}
