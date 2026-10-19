import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, type BotProof, type SessionPayload } from '../api';
import { AuthHomeBrand } from '../components/AuthHomeBrand';
import { BotCheck } from '../components/BotCheck';
import { SocialAuthButtons, useAuthProviders } from '../auth-providers';

export function LoginPage({
  onSignedIn,
  onCreateAccount,
  onClassCodeLogin,
  onOrganizationLogin,
  onBack,
  onHome = onBack,
  contextMessage,
}: {
  onSignedIn: (session: SessionPayload) => void;
  onCreateAccount: () => void;
  onClassCodeLogin?: () => void;
  onOrganizationLogin: () => void;
  onBack: () => void;
  onHome?: () => void;
  contextMessage?: string;
}): JSX.Element {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [botProof, setBotProof] = useState<BotProof | null>(null);
  const [botReset, setBotReset] = useState(0);
  const { providers, refresh: refreshProviders } = useAuthProviders();
  const [socialRegistration, setSocialRegistration] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [localPreviewEnabled, setLocalPreviewEnabled] = useState(false);
  const messageId = useId();
  const identifierRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void api.localPreviewConfig().then((result) => {
      if (active && result.ok) setLocalPreviewEnabled(result.data.enabled);
    });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setMessage(null);
    if (!identifier.trim() || !password) {
      setMessage('Введите email или имя пользователя и пароль.');
      identifierRef.current?.focus();
      return;
    }
    if (!botProof) {
      setMessage('Поставьте галочку «Я не робот» и дождитесь проверки.');
      return;
    }
    setBusy(true);
    const result = await api.login(identifier.trim(), password, botProof);
    setBusy(false);
    if (result.ok) {
      onSignedIn(result.data);
      return;
    }
    setBotProof(null);
    setBotReset((value) => value + 1);
    if (result.status === 400 || result.status === 401) {
      setMessage('Неверные данные для входа.');
    } else if (result.status === 0) {
      setMessage('Сервер недоступен. Попробуйте ещё раз.');
    } else {
      setMessage('Ошибка сервера. Попробуйте ещё раз.');
    }
    identifierRef.current?.focus();
  }

  async function enterLocalPreview(): Promise<void> {
    setBusy(true);
    setMessage(null);
    const result = await api.localPreviewSession();
    setBusy(false);
    if (result.ok) {
      onSignedIn(result.data);
      return;
    }
    setMessage('Не удалось войти в локальный preview. Обновите страницу и попробуйте ещё раз.');
  }

  return (
    <div className="page-center">
      <main className="login-card" aria-busy={busy}>
        <button type="button" className="btn-ghost entry-back" onClick={onBack}>
          ← Назад
        </button>
        <AuthHomeBrand onHome={onHome} />
        <h1 className="auth-title">Вход</h1>
        {onClassCodeLogin ? (
          <nav className="auth-method-switch" aria-label="Способ входа">
            <button type="button" className="active" aria-current="page">
              Аккаунт
            </button>
            <button type="button" data-testid="login-class-code" onClick={onClassCodeLogin}>
              Код класса
            </button>
          </nav>
        ) : null}
        {contextMessage ? <p className="max-link-copy">{contextMessage}</p> : null}
        <form onSubmit={(event) => void submit(event)} noValidate hidden={socialRegistration}>
          <label htmlFor="identifier">Email или имя пользователя</label>
          <input
            id="identifier"
            ref={identifierRef}
            autoFocus
            autoComplete="username"
            spellCheck={false}
            value={identifier}
            disabled={busy}
            aria-invalid={message ? 'true' : undefined}
            aria-describedby={message ? messageId : undefined}
            onChange={(event) => setIdentifier(event.target.value)}
          />
          <label htmlFor="password">Пароль</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            aria-invalid={message ? 'true' : undefined}
            aria-describedby={message ? messageId : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            type="button"
            className="link-button auth-forgot-password"
            onClick={() => setRecoveryOpen((value) => !value)}
          >
            Не помню пароль
          </button>
          <BotCheck
            key={`login-${botReset}`}
            action="login"
            disabled={busy}
            onVerified={setBotProof}
          />
          <p id={messageId} className="form-error" role="alert" hidden={!message}>
            {message}
          </p>
          <button type="submit" className="btn-primary" disabled={busy || !botProof}>
            {busy ? 'Входим…' : 'Войти'}
          </button>
        </form>

        {!contextMessage ? (
          <SocialAuthButtons
            providers={providers}
            purpose="login"
            disabled={busy}
            onAuthenticated={onSignedIn}
            onUnavailable={() => void refreshProviders()}
            onUsePassword={() => {
              setSocialRegistration(false);
              window.setTimeout(() => identifierRef.current?.focus(), 0);
            }}
            onRegistrationActiveChange={setSocialRegistration}
          />
        ) : null}
        {recoveryOpen ? (
          <section className="auth-recovery-note" aria-label="Восстановление пароля">
            <strong>Как восстановить доступ</strong>
            <p>
              Если MAX или Telegram уже связан с аккаунтом и его кнопка доступна выше, подтвердите
              вход через него. После входа можно настроить пароль в разделе «Учётная запись». Если
              доступного способа нет, обратитесь к администратору портала.
            </p>
          </section>
        ) : null}

        {localPreviewEnabled ? (
          <button
            type="button"
            className="btn-secondary max-login-button"
            disabled={busy}
            onClick={() => void enterLocalPreview()}
          >
            Войти в тестовый стенд
          </button>
        ) : null}

        <p className="auth-account-switch">
          <span>Нет аккаунта?</span>{' '}
          <button type="button" className="link-button" onClick={onCreateAccount}>
            Создать
          </button>
        </p>
        <p className="auth-organization-link">
          <button
            type="button"
            className="link-button link-muted"
            data-testid="login-organization"
            onClick={onOrganizationLogin}
          >
            Для организации
          </button>
        </p>
      </main>
    </div>
  );
}
