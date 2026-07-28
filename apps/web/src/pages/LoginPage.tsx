import { useId, useRef, useState, type FormEvent } from 'react';
import { api, type SessionPayload } from '../api';
import { AsaLabWordmark } from '../brand/AsaLabBrand';

/**
 * The universal Account sign-in.
 *
 * Creator, educator, guardian, registered student and administrator all use
 * this one form. It accepts an email address or a username, because a person
 * should not have to remember which of the two ASA Lab stored, and it never
 * asks for a role or an organization code.
 */
export function LoginPage({
  onSignedIn,
  onCreateAccount,
  onClassCode,
  onOrganizationLogin,
  onBack,
  intro,
}: {
  onSignedIn: (session: SessionPayload) => void;
  onCreateAccount: () => void;
  onClassCode: () => void;
  onOrganizationLogin: () => void;
  onBack: () => void;
  /** Shown when the sign-in was reached from a resolved class. */
  intro?: string;
}): JSX.Element {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const identifierRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!identifier.trim() || !password) {
      setError('Введите email или имя пользователя и пароль.');
      identifierRef.current?.focus();
      return;
    }
    setBusy(true);
    const result = await api.login(identifier.trim(), password);
    setBusy(false);
    if (result.ok) {
      onSignedIn(result.data);
      return;
    }
    if (result.status === 503) {
      setError(result.error.message);
    } else if (result.status === 400 || result.status === 401) {
      setError('Неверные данные для входа.');
    } else if (result.status === 0) {
      setError('Сервер недоступен. Попробуйте ещё раз.');
    } else {
      setError('Ошибка сервера. Попробуйте ещё раз.');
    }
    identifierRef.current?.focus();
  }

  return (
    <div className="page-center">
      <main className="login-card" aria-busy={busy}>
        <button type="button" className="btn-ghost entry-back" onClick={onBack}>
          ← Назад
        </button>
        <h1 className="brand-heading">
          <AsaLabWordmark />
        </h1>
        <p className="subtitle">Вход</p>
        {intro ? (
          <p className="field-hint entry-intro" data-testid="sign-in-intro">
            {intro}
          </p>
        ) : null}
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor="identifier">Email или имя пользователя</label>
          <input
            id="identifier"
            name="identifier"
            ref={identifierRef}
            autoFocus
            autoComplete="username"
            spellCheck={false}
            value={identifier}
            disabled={busy}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => setIdentifier(event.target.value)}
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
        </form>

        <nav className="login-links" aria-label="Другие способы">
          <button type="button" className="link-button" onClick={onCreateAccount}>
            Создать аккаунт
          </button>
          <button type="button" className="link-button" onClick={onClassCode}>
            Войти по коду класса
          </button>
        </nav>

        <p className="legacy-note">
          <button type="button" className="link-button link-muted" onClick={onOrganizationLogin}>
            Вход для ранее подключённой организации
          </button>
          <span className="legacy-hint">
            Временный совместимый путь; обычным аккаунтам он не нужен.
          </span>
        </p>
      </main>
    </div>
  );
}
