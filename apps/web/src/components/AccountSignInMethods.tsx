import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, type MaxAccountStatus, type SessionPayload, type SocialAuthProvider } from '../api';
import { SocialAuthButtons, SOCIAL_PROVIDER_LABELS, useAuthProviders } from '../auth-providers';

const METHODS: readonly SocialAuthProvider[] = ['max', 'telegram'];
type AccountRequest = { accountId: string; lifetime: number; controller: AbortController };
type StatusRequest = { scope: AccountRequest; promise: Promise<void> };

export function AccountSignInMethods({
  accountId,
  passwordConfigured,
  onSessionChanged,
}: {
  accountId: string;
  passwordConfigured: boolean;
  onSessionChanged: (session: SessionPayload) => void;
}): JSX.Element {
  const { providers, refresh: refreshProviders } = useAuthProviders();
  const [statuses, setStatuses] = useState<Record<SocialAuthProvider, MaxAccountStatus | null>>({
    max: null,
    telegram: null,
  });
  const [busy, setBusy] = useState<SocialAuthProvider | 'link' | null>(null);
  const [accountMismatch, setAccountMismatch] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const mounted = useRef(false);
  const lifetime = useRef(0);
  const currentAccount = useRef(accountId);
  const operation = useRef<AccountRequest | null>(null);
  const statusRequest = useRef<StatusRequest | null>(null);
  const callback = useRef(onSessionChanged);
  currentAccount.current = accountId;
  callback.current = onSessionChanged;

  const isCurrent = useCallback(
    (request: AccountRequest): boolean =>
      mounted.current &&
      request.lifetime === lifetime.current &&
      request.accountId === currentAccount.current &&
      !request.controller.signal.aborted,
    [],
  );

  useLayoutEffect(() => {
    mounted.current = true;
    lifetime.current += 1;
    setStatuses({ max: null, telegram: null });
    setBusy(null);
    setNotice(null);
    setAccountMismatch(false);
    return () => {
      // Revoke authority in the unmount/account-change commit, before any late
      // continuation can update the parent or begin its next request.
      mounted.current = false;
      lifetime.current += 1;
      operation.current?.controller.abort();
      statusRequest.current?.scope.controller.abort();
      operation.current = null;
      statusRequest.current = null;
    };
  }, [accountId]);

  const refresh = useCallback(
    (afterMutation = false): Promise<void> => {
      if (!mounted.current || currentAccount.current !== accountId) return Promise.resolve();
      if (afterMutation) {
        statusRequest.current?.scope.controller.abort();
        statusRequest.current = null;
      }
      const existing = statusRequest.current;
      if (existing && isCurrent(existing.scope)) return existing.promise;
      const scope: AccountRequest = {
        accountId,
        lifetime: lifetime.current,
        controller: new AbortController(),
      };
      const request: StatusRequest = { scope, promise: Promise.resolve() };
      statusRequest.current = request;
      request.promise = (async () => {
        try {
          await Promise.all(
            METHODS.map(async (provider) => {
              const result = await api.socialStatus(provider, scope.controller.signal);
              if (!isCurrent(scope) || statusRequest.current !== request) return;
              setStatuses((previous) => ({
                ...previous,
                [provider]: result.ok ? result.data : null,
              }));
            }),
          );
        } finally {
          if (statusRequest.current === request) statusRequest.current = null;
        }
      })();
      return request.promise;
    },
    [accountId, isCurrent],
  );

  useEffect(() => {
    void refresh();
  }, [passwordConfigured, refresh]);

  function beginChange(kind: SocialAuthProvider | 'link'): AccountRequest | null {
    if (
      operation.current ||
      accountMismatch ||
      !mounted.current ||
      currentAccount.current !== accountId
    )
      return null;
    const request: AccountRequest = {
      accountId,
      lifetime: lifetime.current,
      controller: new AbortController(),
    };
    operation.current = request;
    setBusy(kind);
    setNotice(null);
    return request;
  }

  function finishChange(request: AccountRequest): void {
    if (operation.current !== request) return;
    operation.current = null;
    if (isCurrent(request)) setBusy(null);
  }

  async function refreshIdentity(request: AccountRequest): Promise<boolean> {
    if (!isCurrent(request) || operation.current !== request) return false;
    const identity = await api.me(request.controller.signal);
    if (!isCurrent(request) || operation.current !== request) return false;
    if (!identity.ok || !identity.data.authenticated) {
      setNotice({
        kind: 'error',
        text: !identity.ok
          ? identity.error.message
          : 'Не удалось подтвердить текущий аккаунт. Войдите заново.',
      });
      return false;
    }
    if (identity.data.account.id !== request.accountId) {
      setStatuses({ max: null, telegram: null });
      setAccountMismatch(true);
      setNotice({
        kind: 'error',
        text: 'Аккаунт в браузере изменился. Обновите страницу, чтобы продолжить.',
      });
      return false;
    }
    callback.current(identity.data);
    return true;
  }

  async function changed(): Promise<void> {
    const request = beginChange('link');
    if (!request) return;
    try {
      await Promise.all([refresh(true), refreshProviders()]);
      if (!isCurrent(request) || operation.current !== request) return;
      if (await refreshIdentity(request)) {
        if (isCurrent(request) && operation.current === request)
          setNotice({ kind: 'success', text: 'Способ входа подключён к вашему аккаунту.' });
      }
    } finally {
      finishChange(request);
    }
  }

  async function unlink(provider: SocialAuthProvider): Promise<void> {
    if (operation.current || accountMismatch) return;
    const label = SOCIAL_PROVIDER_LABELS[provider];
    if (!window.confirm(`Отключить ${label} и завершить входы, выполненные через него?`)) return;
    const request = beginChange(provider);
    if (!request) return;
    try {
      const result = await api.unlinkSocial(provider, request.controller.signal);
      if (!isCurrent(request) || operation.current !== request) return;
      if (!result.ok) {
        setNotice({
          kind: 'error',
          text:
            result.error.code === 'last_sign_in_method'
              ? 'Сначала настройте пароль или подключите другой способ входа.'
              : result.error.message || `Не удалось отключить ${label}.`,
        });
        await refresh(true);
        return;
      }
      await refresh(true);
      if (!isCurrent(request) || operation.current !== request) return;
      if (await refreshIdentity(request)) {
        if (isCurrent(request) && operation.current === request)
          setNotice({ kind: 'success', text: `${label} отключён.` });
      }
    } finally {
      finishChange(request);
    }
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
          disabled={busy !== null || accountMismatch}
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
                  disabled={busy !== null || accountMismatch || status.canUnlink !== true}
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
        disabled={busy !== null || accountMismatch}
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
