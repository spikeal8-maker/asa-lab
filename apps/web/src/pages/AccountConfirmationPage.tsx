import { EmailVerification } from '../components/EmailVerification';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type AccountVerificationState, type SessionPayload } from '../api';
import { SocialAuthButtons } from '../auth-providers';
import { AuthHomeBrand } from '../components/AuthHomeBrand';

export function AccountConfirmationPage({
  session,
  verification,
  onSessionChanged,
  onSignedOut,
  onAdminSettings,
}: {
  session: SessionPayload;
  verification: AccountVerificationState;
  onSessionChanged: (session: SessionPayload) => void;
  onSignedOut: () => void;
  onAdminSettings?: () => void;
}): JSX.Element {
  const [state, setState] = useState(verification);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const request = useRef(0);
  const callbacks = useRef({ onSessionChanged, onSignedOut });
  callbacks.current = { onSessionChanged, onSignedOut };

  useEffect(() => {
    setState(verification);
  }, [verification]);

  const pending = useRef<AbortController | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  const check = useCallback(async (): Promise<void> => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const current = ++request.current;
    setChecking(true);
    try {
      const result = await api.accountVerification(controller.signal);
      if (current !== request.current || controller.signal.aborted) return;
      if (!result.ok) {
        // A client/network error cannot waive a server requirement.
        setState((previous) => ({ ...previous, providers: [] }));
        setMessage('Не удалось проверить способы подтверждения. Проверьте соединение и повторите.');
        if (result.status === 401) callbacks.current.onSignedOut();
        return;
      }
      setState(result.data);
      setMessage(null);
      if (result.data.required) return;
      const identity = await api.me(controller.signal);
      if (current !== request.current || controller.signal.aborted) return;
      if (identity.ok && identity.data.authenticated) {
        if (identity.data.account.id !== session.account.id) {
          setMessage('Аккаунт в браузере изменился. Выйдите и войдите в нужный аккаунт.');
          return;
        }
        callbacks.current.onSessionChanged(identity.data);
      } else if (identity.ok || identity.status === 401) {
        callbacks.current.onSignedOut();
      } else {
        setMessage('Не удалось продолжить вход. Проверьте соединение и повторите.');
      }
    } finally {
      if (pending.current === controller) pending.current = null;
      if (current === request.current) setChecking(false);
    }
  }, [session.account.id]);

  useEffect(() => {
    void check();
    const checkVisible = () => {
      if (document.visibilityState !== 'hidden') void check();
    };
    const timer = window.setInterval(checkVisible, 15_000);
    window.addEventListener('focus', checkVisible);
    document.addEventListener('visibilitychange', checkVisible);
    return () => {
      request.current += 1;
      pending.current?.abort();
      pending.current = null;
      window.clearInterval(timer);
      window.removeEventListener('focus', checkVisible);
      document.removeEventListener('visibilitychange', checkVisible);
    };
  }, [check]);

  async function signOut(): Promise<void> {
    // Logout is available while a status check waits; that check loses authority.
    const current = ++request.current;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setChecking(false);
    setSigningOut(true);
    try {
      const result = await api.logout(controller.signal);
      if (current !== request.current || controller.signal.aborted) return;
      if (result.ok) callbacks.current.onSignedOut();
      else setMessage('Не удалось завершить вход. Проверьте соединение и повторите.');
    } finally {
      if (pending.current === controller) pending.current = null;
      if (current === request.current) setSigningOut(false);
    }
  }

  return (
    <div className="page-center">
      <main className="login-card auth-confirmation-card">
        <AuthHomeBrand onHome={() => void check()} />
        <span className="auth-confirmation-kicker">Безопасность аккаунта</span>
        <h1 className="auth-title">Подтвердите аккаунт</h1>
        <p className="auth-confirmation-copy">
          Первые сутки завершились. Подтвердите один доступный способ, чтобы продолжить работу.
        </p>
        <div className="auth-confirmation-account">
          <strong>{session.account.displayName || session.account.email}</strong>
          <span>{session.account.email}</span>
          <small>Способ будет связан с этим аккаунтом. Ваши проекты и история сохранятся.</small>
        </div>
        <EmailVerification accountId={session.account.id} />
        <SocialAuthButtons
          providers={state.providers}
          purpose="link"
          onAuthenticated={() => void check()}
          onLinked={() => void check()}
          onUnavailable={() => void check()}
        />
        {state.providers.every((provider) => !provider.available) ? (
          <p className="auth-provider-feedback" role="status">
            {checking
              ? 'Проверяем доступность входа…'
              : 'Способы подтверждения сейчас недоступны. Проверим, можно ли продолжить вход.'}
          </p>
        ) : null}
        {message ? (
          <p className="form-error" role="alert">
            {message}
          </p>
        ) : null}
        <div className="auth-confirmation-actions">
          <button
            type="button"
            className="btn-secondary"
            disabled={checking || signingOut}
            onClick={() => void check()}
          >
            {checking ? 'Проверяем…' : 'Проверить и продолжить'}
          </button>
          <button
            type="button"
            className="link-button"
            disabled={signingOut}
            onClick={() => void signOut()}
          >
            {signingOut ? 'Выходим…' : 'Выйти'}
          </button>
        </div>
        {onAdminSettings ? (
          <button
            type="button"
            className="link-button auth-confirmation-admin"
            onClick={onAdminSettings}
          >
            Настройки подтверждения
          </button>
        ) : null}
      </main>
    </div>
  );
}
