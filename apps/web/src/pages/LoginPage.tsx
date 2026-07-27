import { useId, useRef, useState, type FormEvent } from 'react';
import { api, type SessionPayload } from '../api';

/**
 * Ordinary sign-in: an email address and a password.
 *
 * No organization code and no teacher wording — the account is just an
 * account, and the server decides what it may do.
 */
export function LoginPage({
  onSignedIn,
  onCreateAccount,
  onOrganizationLogin,
  onBack,
}: {
  onSignedIn: (session: SessionPayload) => void;
  onCreateAccount: () => void;
  onOrganizationLogin: () => void;
  onBack: () => void;
}): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const emailRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Введите email и пароль.');
      emailRef.current?.focus();
      return;
    }
    setBusy(true);
    const result = await api.login(email.trim(), password);
    setBusy(false);
    if (result.ok) {
      onSignedIn(result.data);
      return;
    }
    if (result.status === 503) {
      setError(result.error.message);
    } else if (result.status === 400 || result.status === 401) {
      setError('Неверный email или пароль.');
    } else if (result.status === 0) {
      setError('Сервер недоступен. Попробуйте ещё раз.');
    } else {
      setError('Ошибка сервера. Попробуйте ещё раз.');
    }
    emailRef.current?.focus();
  }

  return (
    <div className="page-center">
      <main className="login-card" aria-busy={busy}>
        <button type="button" className="btn-ghost entry-back" onClick={onBack}>
          ← Назад
        </button>
        <h1 className="brand">ASA Lab</h1>
        <p className="subtitle">Вход</p>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            ref={emailRef}
            autoFocus
            type="email"
            autoComplete="username"
            value={email}
            disabled={busy}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="password">Пароль</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p id={errorId} className="form-error" role="alert" hidden={!error}>
            {error}
          </p>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Входим…' : 'Войти'}
          </button>
          <button type="button" className="btn-ghost login-secondary" onClick={onCreateAccount}>
            Создать аккаунт
          </button>
        </form>

        <p className="legacy-note">
          <button type="button" className="link-button" onClick={onOrganizationLogin}>
            Войти через организацию
          </button>
          <span className="legacy-hint">Временный путь для школ, подключённых по коду.</span>
        </p>
      </main>
    </div>
  );
}
