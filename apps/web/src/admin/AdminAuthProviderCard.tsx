import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AuthProviderAvailabilityReason, SocialAuthProvider } from '../api';
import { SOCIAL_PROVIDER_LABELS, SocialAuthButtons, providerWebhookUrl } from '../auth-providers';
import { adminApi, type AdminMaxConfiguration, type AdminProviderDiagnostic } from './admin-api';

const HEALTH_LABELS: Readonly<Record<AuthProviderAvailabilityReason, string>> = {
  ready: 'Можно начать подтверждение в боте',
  disabled: 'Выключен',
  not_configured: 'Нужно подключить бота',
  invalid_token: 'Токен недействителен',
  delivery_unavailable: 'Приём подтверждений недоступен',
  unavailable: 'Временно недоступен',
};

const DIAGNOSTIC_LABELS: Record<NonNullable<AdminProviderDiagnostic['reason']>, string> = {
  disabled: 'Выключено',
  not_configured: 'Нужна настройка',
  invalid_token: 'Токен недействителен',
  bot_mismatch: 'Имя бота не совпадает с токеном',
  subscription_missing: 'Подписка не найдена',
  subscription_mismatch: 'Бот подключён к другому адресу',
  ingress_invalid_url: 'Проверьте публичный HTTPS-адрес',
  ingress_dns_unavailable: 'Имя сервера не найдено',
  ingress_network_unavailable: 'Сервер недоступен по HTTPS',
  ingress_invalid_response: 'Адрес не подтвердил эту установку ASA Lab',
  unavailable: 'Временно недоступно',
};

function checkedAt(value: string | null | undefined): string {
  return value
    ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(value),
      )
    : 'Ещё не проверено';
}

function diagnosticLabel(value: AdminProviderDiagnostic | undefined, unknown: boolean): string {
  if (unknown || !value) return 'Статус недоступен';
  if (value.state === 'ok') return 'Проверено';
  if (value.state === 'not_checked') return 'Ещё не проверено';
  return value.reason ? DIAGNOSTIC_LABELS[value.reason] : 'Проверка не пройдена';
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
  const [unknown, setUnknown] = useState(false);
  const [pairingActive, setPairingActive] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success' | 'info'; text: string } | null>(
    null,
  );
  const initialized = useRef(false);
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const denied = useRef(onAccessDenied);
  denied.current = onAccessDenied;
  const label = SOCIAL_PROVIDER_LABELS[provider];

  function acceptConfig(value: AdminMaxConfiguration, updateFields: boolean): void {
    setConfig(value);
    setUnknown(false);
    if (!updateFields) return;
    setEnabled(value.featureEnabled);
    setBotUsername(value.botUsername ?? '');
    setMiniAppUrl(
      value.miniAppUrl ??
        (window.location.protocol === 'https:'
          ? `${window.location.origin}${provider === 'max' ? '/max-login' : '/'}`
          : ''),
    );
  }

  useEffect(() => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const current = ++generation.current;
    setLoading(true);
    void adminApi.authProviderConfiguration(provider, controller.signal).then((result) => {
      if (pending.current === controller) pending.current = null;
      if (current !== generation.current || controller.signal.aborted) return;
      setLoading(false);
      if (!result.ok) {
        setUnknown(true);
        if (result.status === 401 || result.status === 403) denied.current();
        else setNotice({ kind: 'error', text: result.error.message });
        return;
      }
      acceptConfig(result.data, !initialized.current);
      initialized.current = true;
      setNotice(null);
    });
    return () => {
      controller.abort();
      if (pending.current === controller) pending.current = null;
    };
  }, [provider, refreshKey]);

  useEffect(
    () => () => {
      generation.current += 1;
      pending.current?.abort();
    },
    [],
  );

  async function checkConfiguration(): Promise<void> {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const current = ++generation.current;
    setLoading(true);
    setNotice(null);
    const result = await adminApi.checkAuthProviderConfiguration(provider, controller.signal);
    if (pending.current === controller) pending.current = null;
    if (current !== generation.current || controller.signal.aborted) return;
    setLoading(false);
    if (!result.ok) {
      setUnknown(true);
      if (result.status === 401 || result.status === 403) denied.current();
      else setNotice({ kind: 'error', text: result.error.message });
      return;
    }
    acceptConfig(result.data, false);
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending.current || pairingActive) return;
    if ((enabled || botToken.trim()) && !providerWebhookUrl(provider, miniAppUrl.trim())) {
      setNotice({
        kind: 'error',
        text: 'Укажите публичный HTTPS-адрес этой установки ASA Lab. Адрес по HTTP не подходит для бота.',
      });
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    const current = ++generation.current;
    setSaving(true);
    setNotice(null);
    const result = await adminApi.updateAuthProviderConfiguration(
      provider,
      {
        enabled,
        botUsername: botUsername.trim(),
        miniAppUrl: miniAppUrl.trim(),
        ...(botToken.trim() ? { botToken: botToken.trim() } : {}),
      },
      controller.signal,
    );
    if (pending.current === controller) pending.current = null;
    if (current !== generation.current || controller.signal.aborted) return;
    setSaving(false);
    if (!result.ok) {
      if (result.error.code === 'auth_timeout') setUnknown(true);
      if (result.status === 401 || result.status === 403) denied.current();
      else setNotice({ kind: 'error', text: result.error.message });
      return;
    }
    acceptConfig(result.data, true);
    setBotToken('');
    setNotice({
      kind: result.data.featureEnabled ? 'info' : 'success',
      text: !result.data.featureEnabled
        ? `${label} выключен. Кнопка входа скрыта.`
        : result.data.available
          ? 'Настройки сохранены. Подтвердите действие в боте, чтобы проверить весь путь.'
          : `Настройки сохранены. ${label} пока недоступен, кнопка входа скрыта.`,
    });
  }

  const availability = config?.availabilityReason;
  const callback = providerWebhookUrl(provider, miniAppUrl.trim());
  const busy = loading || saving;
  const dirty =
    !!config &&
    (enabled !== config.featureEnabled ||
      botUsername.trim() !== (config.botUsername ?? '') ||
      miniAppUrl.trim() !== (config.miniAppUrl ?? '') ||
      botToken.trim() !== '');
  const native = config?.diagnostics?.nativeConfirmation;
  const nativeConfirmed =
    !unknown &&
    native?.current === true &&
    native.configurationVersion === config?.configurationVersion &&
    !!native.verifiedAt;
  const startable = !unknown && config?.available === true;
  const diagnostic = config?.diagnostics;

  return (
    <form
      className="auth-admin-provider"
      onSubmit={(event) => void save(event)}
      aria-labelledby={`${provider}-channel-title`}
      aria-busy={busy}
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
            disabled={!config || busy || pairingActive}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span>{unknown || !config ? 'Статус недоступен' : enabled ? 'Включён' : 'Выключен'}</span>
        </label>
      </header>
      <p
        className={`auth-channel-health ${startable ? 'is-ready' : 'is-unavailable'}`}
        role="status"
      >
        {loading && !config
          ? 'Проверяем подключение…'
          : unknown || !availability
            ? 'Статус недоступен'
            : HEALTH_LABELS[availability]}
      </p>
      {config ? (
        <>
          <div className="auth-admin-provider-fields">
            <label htmlFor={`${provider}-bot-username`}>Имя бота</label>
            <input
              id={`${provider}-bot-username`}
              value={botUsername}
              disabled={busy || pairingActive}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setBotUsername(event.target.value)}
            />
            <label htmlFor={`${provider}-bot-token`}>Токен бота</label>
            <input
              id={`${provider}-bot-token`}
              type="password"
              value={botToken}
              disabled={busy || pairingActive || !config.encryptionReady}
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
            <label htmlFor={`${provider}-mini-app-url`}>Публичный HTTPS-адрес ASA Lab</label>
            <input
              id={`${provider}-mini-app-url`}
              type="url"
              value={miniAppUrl}
              disabled={busy || pairingActive}
              spellCheck={false}
              aria-describedby={`${provider}-receiver-help`}
              placeholder="https://…"
              onChange={(event) => setMiniAppUrl(event.target.value)}
            />
            <p className="admin-field-note" id={`${provider}-receiver-help`}>
              Адрес сайта, доступный боту через интернет.
            </p>
          </div>
          <p className="admin-field-note">
            {unknown
              ? 'Обновите состояние подключения.'
              : config.enforcementEligible
                ? 'Канал готов для подтверждения аккаунтов.'
                : 'После сохранения подтвердите подключение в боте.'}
          </p>
          <details className="confirmation-connection-details">
            <summary>Подробности подключения</summary>
            <p className="admin-field-note" style={{ overflowWrap: 'anywhere' }}>
              Webhook: <code>{callback ?? 'укажите корректный HTTPS-адрес'}</code>
            </p>
            {config.webhookUrl && config.webhookUrl !== callback ? (
              <p className="admin-field-note" style={{ overflowWrap: 'anywhere' }}>
                Сохранённый webhook: <code>{config.webhookUrl}</code>
              </p>
            ) : null}
            <dl className="auth-admin-provider-facts">
              <div>
                <dt>Последняя проверка</dt>
                <dd>{unknown ? 'Статус недоступен' : checkedAt(config.healthCheckedAt)}</dd>
              </div>
              <div>
                <dt>Токен бота</dt>
                <dd>{diagnosticLabel(diagnostic?.token, unknown)}</dd>
              </div>
              <div>
                <dt>Подписка бота</dt>
                <dd>{diagnosticLabel(diagnostic?.subscription, unknown)}</dd>
              </div>
              <div>
                <dt>Публичный адрес</dt>
                <dd>{diagnosticLabel(diagnostic?.ingress, unknown)}</dd>
              </div>
              <div>
                <dt>Подтверждение человеком</dt>
                <dd>
                  {unknown
                    ? 'Статус недоступен'
                    : nativeConfirmed
                      ? `Проверено — ${checkedAt(native?.verifiedAt)}`
                      : 'Ещё не проверено'}
                </dd>
              </div>
            </dl>
            <p className="admin-field-note">
              Для получения подтверждений нужен публичный HTTPS-адрес этой установки. Для другой
              установки используйте отдельного бота. Проверка подключения проверяет сервер; кнопка
              «Подтвердить в боте» проверяет весь путь сообщения.
            </p>
          </details>
          {!config.encryptionReady ? (
            <p className="auth-settings-notice is-error" role="alert">
              Защита токенов недоступна. Восстановите ключ настроек установки. Канал можно
              выключить.
            </p>
          ) : null}
          <footer className="auth-social-actions">
            <button
              type="submit"
              className="btn-primary"
              disabled={busy || pairingActive || (!config.encryptionReady && enabled)}
            >
              {saving ? 'Проверяем…' : 'Проверить и сохранить'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || pairingActive}
              onClick={() => void checkConfiguration()}
            >
              Проверить подключение
            </button>
          </footer>
          {dirty && startable ? (
            <p className="admin-field-note">Сохраните изменения перед подтверждением в боте.</p>
          ) : null}
          <SocialAuthButtons
            providers={[
              {
                id: provider,
                available: startable,
                reason: availability ?? 'unavailable',
                checkedAt: config.healthCheckedAt ?? null,
                enforcementEligible: config.enforcementEligible === true,
                ...(config.enforcementReason
                  ? { enforcementReason: config.enforcementReason }
                  : {}),
              },
            ]}
            purpose="link"
            linkActionLabel="Подтвердить в боте"
            disabled={busy || dirty}
            onAuthenticated={() => void checkConfiguration()}
            onLinked={() => void checkConfiguration()}
            onUnavailable={() => void checkConfiguration()}
            onFlowActiveChange={setPairingActive}
          />
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
