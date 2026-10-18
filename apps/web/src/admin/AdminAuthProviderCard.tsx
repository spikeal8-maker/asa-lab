import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AuthProviderAvailabilityReason, SocialAuthProvider } from '../api';
import { SOCIAL_PROVIDER_LABELS, socialLaunchUrl } from '../auth-providers';
import { adminApi, type AdminMaxConfiguration } from './admin-api';

const HEALTH_LABELS: Readonly<Record<AuthProviderAvailabilityReason, string>> = {
  ready: 'Доступен для входа',
  disabled: 'Выключен',
  not_configured: 'Нужно подключить бота',
  invalid_token: 'Токен недействителен',
  delivery_unavailable: 'Бот не принимает подтверждения',
  unavailable: 'Временно недоступен',
};

function checkedAt(value: string | null | undefined): string {
  return value
    ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(value),
      )
    : 'Не проверялось';
}

export function AdminAuthProviderCard({
  provider,
  refreshKey,
  onAccessDenied,
}: {
  provider: SocialAuthProvider;
  refreshKey: number;
  onAccessDenied: () => void;
}): JSX.Element {
  const [config, setConfig] = useState<AdminMaxConfiguration | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [botUsername, setBotUsername] = useState('');
  const [miniAppUrl, setMiniAppUrl] = useState('');
  const [botToken, setBotToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(
    null,
  );
  const initialized = useRef(false);
  const denied = useRef(onAccessDenied);
  denied.current = onAccessDenied;
  const label = SOCIAL_PROVIDER_LABELS[provider];

  useEffect(() => {
    let active = true;
    setLoading(true);
    void adminApi.authProviderConfiguration(provider).then((result) => {
      if (!active) return;
      setLoading(false);
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) denied.current();
        else setNotice({ kind: 'error', text: result.error.message });
        return;
      }
      setConfig(result.data);
      if (!initialized.current) {
        initialized.current = true;
        setEnabled(result.data.featureEnabled);
        setBotUsername(result.data.botUsername ?? '');
        setMiniAppUrl(
          result.data.miniAppUrl ??
            `${window.location.origin}${provider === 'max' ? '/max-login' : '/'}`,
        );
      }
    });
    return () => {
      active = false;
    };
  }, [provider, refreshKey]);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    const result = await adminApi.updateAuthProviderConfiguration(provider, {
      enabled,
      botUsername: botUsername.trim(),
      miniAppUrl: miniAppUrl.trim(),
      ...(botToken.trim() ? { botToken: botToken.trim() } : {}),
    });
    setSaving(false);
    if (!result.ok) {
      if (result.status === 401 || result.status === 403) denied.current();
      else setNotice({ kind: 'error', text: result.error.message });
      return;
    }
    setConfig(result.data);
    setEnabled(result.data.featureEnabled);
    setBotUsername(result.data.botUsername ?? '');
    setMiniAppUrl(result.data.miniAppUrl ?? '');
    setBotToken('');
    setNotice({
      kind: result.data.featureEnabled && !result.data.available ? 'info' : 'success',
      text: !result.data.featureEnabled
        ? `${label} выключен. Кнопка входа скрыта.`
        : result.data.available
          ? `${label} проверен и доступен для входа.`
          : `Настройки сохранены. ${label} пока недоступен, кнопка входа скрыта.`,
    });
  }

  const availability =
    config?.availabilityReason ?? (config?.featureEnabled ? 'unavailable' : 'disabled');
  const launchUrl =
    config?.available && config.launchUrl ? socialLaunchUrl(provider, config.launchUrl) : null;

  return (
    <form
      className="auth-admin-provider"
      onSubmit={(event) => void save(event)}
      aria-labelledby={`${provider}-channel-title`}
      aria-busy={loading || saving}
    >
      <header>
        <div>
          <span className={`auth-provider-mark auth-provider-${provider}`} aria-hidden="true">
            {provider === 'max' ? 'M' : 'T'}
          </span>
          <h3 id={`${provider}-channel-title`}>{label}</h3>
        </div>
        <label className="admin-channel-switch">
          <input
            type="checkbox"
            role="switch"
            aria-label={`Вход через ${label}`}
            checked={enabled}
            disabled={!config || saving}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span>{enabled ? 'Включён' : 'Выключен'}</span>
        </label>
      </header>
      <p
        className={`auth-channel-health ${config?.available ? 'is-ready' : 'is-unavailable'}`}
        role="status"
      >
        {loading && !config ? 'Проверяем подключение…' : HEALTH_LABELS[availability]}
      </p>
      {config ? (
        <>
          <div className="auth-admin-provider-fields">
            <label htmlFor={`${provider}-bot-username`}>Имя бота</label>
            <input
              id={`${provider}-bot-username`}
              value={botUsername}
              disabled={saving}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setBotUsername(event.target.value)}
            />
            <label htmlFor={`${provider}-bot-token`}>Токен бота</label>
            <input
              id={`${provider}-bot-token`}
              type="password"
              value={botToken}
              disabled={saving || !config.encryptionReady}
              autoComplete="new-password"
              placeholder={
                config.tokenConfigured
                  ? 'Оставьте пустым, чтобы сохранить текущий'
                  : 'Вставьте токен бота'
              }
              onChange={(event) => setBotToken(event.target.value)}
            />
            <p className="admin-field-note">
              {config.tokenConfigured
                ? 'Токен сохранён. Его значение не отображается.'
                : 'Токен ещё не сохранён.'}
            </p>
            <label htmlFor={`${provider}-mini-app-url`}>Адрес ASA Lab для возврата</label>
            <input
              id={`${provider}-mini-app-url`}
              type="url"
              value={miniAppUrl}
              disabled={saving}
              spellCheck={false}
              onChange={(event) => setMiniAppUrl(event.target.value)}
            />
          </div>
          <dl className="auth-admin-provider-facts">
            <div>
              <dt>Последняя проверка</dt>
              <dd>{checkedAt(config.healthCheckedAt)}</dd>
            </div>
            <div>
              <dt>Токен проверен</dt>
              <dd>{checkedAt(config.tokenVerifiedAt)}</dd>
            </div>
            <div>
              <dt>Приём подтверждений</dt>
              <dd>
                {config.webhookLastError
                  ? 'Требует проверки'
                  : config.webhookVerifiedAt
                    ? 'Подключён'
                    : 'Не подтверждён'}
              </dd>
            </div>
          </dl>
          {!config.encryptionReady ? (
            <p className="auth-settings-notice is-error" role="alert">
              Сервер не готов сохранять токены. Включение канала недоступно, выключить его можно.
            </p>
          ) : null}
          {config.featureEnabled && !config.available ? (
            <p className="admin-field-note">
              Пользователи увидят кнопку, когда сервер подтвердит работоспособность канала.
            </p>
          ) : null}
          <footer>
            <button
              type="submit"
              className="btn-primary"
              disabled={saving || (!config.encryptionReady && enabled)}
            >
              {saving ? 'Проверяем…' : 'Проверить и сохранить'}
            </button>
            {launchUrl ? (
              <a className="btn-secondary" href={launchUrl} target="_blank" rel="noreferrer">
                Открыть бота
              </a>
            ) : null}
          </footer>
        </>
      ) : null}
      {notice ? (
        <p
          className={`auth-settings-notice is-${notice.kind}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      ) : null}
    </form>
  );
}
