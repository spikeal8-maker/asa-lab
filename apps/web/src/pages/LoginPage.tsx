import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api, type BotProof, type SessionPayload } from '../api';
import { AuthHomeBrand } from '../components/AuthHomeBrand';
import { BotCheck } from '../components/BotCheck';

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
  const [maxLaunchUrl, setMaxLaunchUrl] = useState<string | null>(null);
  const [localPreviewEnabled, setLocalPreviewEnabled] = useState(false);
  const messageId = useId();
  const identifierRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void api.maxConfig().then((result) => {
      if (active && result.ok && result.data.enabled) setMaxLaunchUrl(result.data.launchUrl);
    });
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
        <p className="subtitle">Вход в ASA Lab</p>
        {onClassCodeLogin ? (
          <section className="login-methods" aria-labelledby="login-methods-title">
            <h2 id="login-methods-title">Выберите способ входа</h2>
            <div className="login-method-list">
              <div className="login-method login-method-current">
                <strong>Личная учётная запись</strong>
                <span>Email или имя пользователя и пароль</span>
              </div>
              <button
                type="button"
                className="login-method login-method-button"
                data-testid="login-class-code"
                onClick={onClassCodeLogin}
              >
                <strong>Войти по коду класса</strong>
                <span>Для ученика с кодом от преподавателя</span>
              </button>
            </div>
          </section>
        ) : null}
        {contextMessage ? <p className="max-link-copy">{contextMessage}</p> : null}
        <form onSubmit={(event) => void submit(event)} noValidate>
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

        {maxLaunchUrl ? (
          <a className="btn-secondary max-login-button" href={maxLaunchUrl}>
            Войти через MAX
          </a>
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

        <nav className="login-links" aria-label="Другие способы">
          <button type="button" className="link-button" onClick={onCreateAccount}>
            Создать аккаунт
          </button>
        </nav>
        <p className="legacy-note">
          <button type="button" className="link-button link-muted" onClick={onOrganizationLogin}>
            Вход через организацию
          </button>
          <span className="legacy-hint">Для школ, ранее подключённых по коду организации.</span>
        </p>
      </main>
    </div>
  );
}
