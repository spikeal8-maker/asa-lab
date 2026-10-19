import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type MaxAccountStatus, type SessionPayload, type SocialAuthProvider } from '../api';
import { SocialAuthButtons, SOCIAL_PROVIDER_LABELS, useAuthProviders } from '../auth-providers';

const METHODS: readonly SocialAuthProvider[] = ['max', 'telegram'];

export function AccountSignInMethods({
  passwordConfigured,
  onSessionChanged,
}: {
  passwordConfigured: boolean;
  onSessionChanged: (session: SessionPayload) => void;
}): JSX.Element {
  const { providers, refresh: refreshProviders } = useAuthProviders();
  const [statuses, setStatuses] = useState<Record<SocialAuthProvider, MaxAccountStatus | null>>({
    max: null,
    telegram: null,
  });
  const [busy, setBusy] = useState<SocialAuthProvider | null>(null);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const generation = useRef(0);
  const callback = useRef(onSessionChanged);
  callback.current = onSessionChanged;
  const refresh = useCallback(async (): Promise<void> => {
    const current = ++generation.current;
    await Promise.all(
      METHODS.map(async (provider) => {
        const result = await api.socialStatus(provider);
        if (current !== generation.current) return;
        setStatuses((previous) => ({ ...previous, [provider]: result.ok ? result.data : null }));
      }),
    );
  }, []);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [passwordConfigured, refresh]);

  async function changed(): Promise<void> {
    setNotice({ kind: 'success', text: 'Способ входа подключён к вашему аккаунту.' });
    await Promise.all([refresh(), refreshProviders()]);
    const identity = await api.me();
    if (identity.ok && identity.data.authenticated) callback.current(identity.data);
  }

  async function unlink(provider: SocialAuthProvider): Promise<void> {
    const label = SOCIAL_PROVIDER_LABELS[provider];
    if (!window.confirm(`Отключить ${label} и завершить входы, выполненные через него?`)) return;
    setBusy(provider);
    setNotice(null);
    const result = await api.unlinkSocial(provider);
    setBusy(null);
    if (!result.ok) {
      setNotice({
        kind: 'error',
        text:
          result.error.code === 'last_sign_in_method'
            ? 'Сначала настройте пароль или подключите другой способ входа.'
            : result.error.message || `Не удалось отключить ${label}.`,
      });
      await refresh();
      return;
    }
    setNotice({ kind: 'success', text: `${label} отключён.` });
    await refresh();
    const identity = await api.me();
    if (identity.ok && identity.data.authenticated) callback.current(identity.data);
  }

  const unlinked = providers.filter(
    (provider) =>
      (provider.id === 'max' || provider.id === 'telegram') &&
      statuses[provider.id] !== null &&
      !statuses[provider.id]?.linked,
  );

  return (
    <section className="account-sign-in-methods" aria-labelledby="account-sign-in-methods-title">
      <div className="account-field-heading">
        <h3 id="account-sign-in-methods-title">Способы входа</h3>
        <button
          type="button"
          className="link-button"
          disabled={busy !== null}
          onClick={() => {
            void refresh();
            void refreshProviders();
          }}
        >
          Обновить
        </button>
      </div>
      <p>Подключите MAX или Telegram к текущему аккаунту для подтверждения и быстрого входа.</p>
      <div className="account-sign-in-method-list">
        {METHODS.map((provider) => {
          const status = statuses[provider];
          const available = providers.some((entry) => entry.id === provider && entry.available);
          return (
            <article
              key={provider}
              className="account-sign-in-method"
              aria-label={SOCIAL_PROVIDER_LABELS[provider]}
            >
              <div>
                <strong>{SOCIAL_PROVIDER_LABELS[provider]}</strong>
                <span>
                  {status === null
                    ? 'Статус недоступен'
                    : status.linked
                      ? 'Подтверждён'
                      : 'Не подключён'}
                </span>
                {status?.linked && !available ? (
                  <small>Вход через этот канал сейчас недоступен.</small>
                ) : null}
              </div>
              {status?.linked ? (
                <button
                  type="button"
                  className="account-revoke"
                  disabled={busy !== null || status.canUnlink !== true}
                  onClick={() => void unlink(provider)}
                >
                  {busy === provider
                    ? 'Отключаем…'
                    : `Отключить ${SOCIAL_PROVIDER_LABELS[provider]}`}
                </button>
              ) : null}
              {status?.linked && status.canUnlink === false ? (
                <p className="account-sign-in-method-note">
                  Для отключения сначала настройте пароль или другой способ входа.
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
      <SocialAuthButtons
        providers={unlinked}
        purpose="link"
        disabled={busy !== null}
        onAuthenticated={() => void changed()}
        onLinked={() => void changed()}
        onUnavailable={() => {
          void refreshProviders();
          void refresh();
        }}
      />
      {notice ? (
        <p
          className={`auth-settings-notice is-${notice.kind}`}
          role={notice.kind === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}
