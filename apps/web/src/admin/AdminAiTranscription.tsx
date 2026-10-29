import { useEffect, useState, type FormEvent } from 'react';
import { call } from './admin-api';
import { isPolzaConfig, type AiPolzaAdminConfig } from './ai-polza-admin';
import './ai-media-admin.css';

/** Dedicated speech-to-text settings; text and image provider state stays independent. */
export function AdminAiTranscription({
  onAccessDenied,
  onDirtyChange,
}: {
  readonly onAccessDenied: () => void;
  readonly onDirtyChange?: (dirty: boolean) => void;
}) {
  const [config, setConfig] = useState<AiPolzaAdminConfig | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [duration, setDuration] = useState(20);
  const [daily, setDaily] = useState(600);
  const [globalDaily, setGlobalDaily] = useState(7200);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);

  function apply(value: AiPolzaAdminConfig) {
    setConfig(value);
    setEnabled(value.transcriptionEnabled);
    setDuration(value.maxAudioSeconds);
    setDaily(value.dailySecondsLimit);
    setGlobalDaily(value.globalDailySecondsLimit);
  }

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    void call<unknown>('/api/admin/v1/ai/polza').then((response) => {
      if (!mounted) return;
      setLoading(false);
      if (response.ok && isPolzaConfig(response.data)) {
        apply(response.data);
        setError('');
      } else {
        if (!response.ok && [401, 403].includes(response.status)) onAccessDenied();
        setError('Настройки транскрибации недоступны. Проверьте версию сервера.');
      }
    });
    return () => {
      mounted = false;
    };
  }, [onAccessDenied, reload]);

  const dirty =
    !!config &&
    (enabled !== config.transcriptionEnabled ||
      duration !== config.maxAudioSeconds ||
      daily !== config.dailySecondsLimit ||
      globalDaily !== config.globalDailySecondsLimit);
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const valid =
    duration >= 5 &&
    duration <= 30 &&
    daily >= 60 &&
    daily <= 3600 &&
    globalDaily >= 600 &&
    globalDaily <= 86400 &&
    Number.isInteger(duration) &&
    Number.isInteger(daily) &&
    Number.isInteger(globalDaily);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config || !dirty || !valid || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await call<unknown>('/api/admin/v1/ai/polza', {
        method: 'PUT',
        body: JSON.stringify({
          configurationVersion: config.configurationVersion,
          enabled: config.enabled,
          transcriptionEnabled: enabled,
          dailySecondsLimit: daily,
          globalDailySecondsLimit: globalDaily,
          maxAudioSeconds: duration,
        }),
      });
      if (response.ok && isPolzaConfig(response.data)) {
        apply(response.data);
        setNotice('Настройки транскрибации сохранены. Платный запрос не выполнялся.');
      } else {
        if (!response.ok && [401, 403].includes(response.status)) onAccessDenied();
        setError(
          !response.ok
            ? response.status === 409
              ? 'Настройки изменились. Загрузите актуальную версию.'
              : response.error.message
            : 'Сервер вернул несовместимые настройки.',
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="asa-ai-integration-panel" aria-label="Настройки транскрибации">
      <header className="asa-ai-integration-header">
        <div>
          <h2>Транскрибация</h2>
          <p>Распознавание речи из микрофона, без передачи записи в текстовую AI-модель.</p>
        </div>
        <span className="asa-ai-integration-state">
          {config?.transcriptionEnabled && config.enabled ? 'Включена' : 'Отключена'}
        </span>
      </header>
      {loading ? <p role="status">Загрузка настроек…</p> : null}
      {error ? (
        <p className="asa-ai-integration-error" role="alert">
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
            <div className="asa-polza-model">
              <span>Модель русского языка</span>
              <strong>GigaAM-v3</strong>
              <small>Polza AI · ai-sage/gigaam-v3</small>
            </div>
            <label className="asa-polza-switch">
              <input
                type="checkbox"
                checked={enabled}
                disabled={busy || !config.enabled || !config.apiKeyConfigured}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              Голосовой ввод в чате
            </label>
          </div>
          {!config.apiKeyConfigured || !config.enabled ? (
            <p className="asa-ai-integration-note">
              Сначала сохраните ключ и включите провайдера в разделе{' '}
              <a href="#/admin/ai?section=connections&provider=polza">Подключения → Polza AI</a>.
            </p>
          ) : null}
          <div className="asa-polza-limits">
            <label>
              Длина записи, секунд
              <input
                aria-label="Максимальная длина записи"
                type="number"
                min="5"
                max="30"
                value={duration}
                disabled={busy}
                onChange={(event) => setDuration(Number(event.target.value))}
              />
            </label>
            <label>
              На пользователя, сек/день
              <input
                aria-label="Дневной лимит на пользователя"
                type="number"
                min="60"
                max="3600"
                value={daily}
                disabled={busy}
                onChange={(event) => setDaily(Number(event.target.value))}
              />
            </label>
            <label>
              На платформу, сек/день
              <input
                aria-label="Дневной лимит платформы"
                type="number"
                min="600"
                max="86400"
                value={globalDaily}
                disabled={busy}
                onChange={(event) => setGlobalDaily(Number(event.target.value))}
              />
            </label>
          </div>
          <div className="asa-polza-actions">
            <button
              type="submit"
              className="asa-polza-primary"
              disabled={!dirty || busy || !valid || (enabled && !config.enabled)}
            >
              {busy ? 'Сохраняем…' : 'Сохранить настройки'}
            </button>
            {notice ? (
              <span role="status" className="asa-polza-confirmed">
                {notice}
              </span>
            ) : null}
          </div>
          <p className="asa-ai-integration-note">
            Секунды резервируются по максимальной длине каждого запроса; это защитный бюджет, а не
            сумма фактических списаний Polza AI. Аудио не сохраняется. Распознанный текст
            пользователь проверяет и отправляет самостоятельно. Для доступа к микрофону нужен HTTPS
            (или localhost).
          </p>
        </form>
      ) : null}
    </section>
  );
}
