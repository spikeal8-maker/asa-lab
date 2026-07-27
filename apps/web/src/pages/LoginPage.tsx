import { useId, useRef, useState, type FormEvent } from 'react';
import { api, type PublicUser } from '../api';

export function LoginPage({
  onLoggedIn,
  onCreateAccount,
}: {
  onLoggedIn: (user: PublicUser) => void;
  onCreateAccount: () => void;
}): JSX.Element {
  const [workspace, setWorkspace] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const workspaceHintId = useId();
  const workspaceRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Заполните код организации, email и пароль.');
      workspaceRef.current?.focus();
      return;
    }
    setBusy(true);
    // Personal accounts sign in without an organization; the code stays
    // available for accounts that still belong to a school workspace.
    const result = workspace.trim()
      ? await api.loginWithWorkspace(workspace.trim(), email.trim(), password)
      : await api.login(email.trim(), password);
    setBusy(false);
    if (result.ok) {
      onLoggedIn(result.data.user);
      return;
    }
    if (result.status === 400 || result.status === 401) {
      setError('Неверный код организации, email или пароль.');
    } else if (result.status === 0) {
      setError('Сервер недоступен. Попробуйте ещё раз.');
    } else {
      setError('Ошибка сервера. Попробуйте ещё раз.');
    }
    workspaceRef.current?.focus();
  }

  return (
    <div className="page-center">
      <main className="login-card" aria-busy={busy}>
        <h1 className="brand">ASA Lab</h1>
        <p className="subtitle">Вход</p>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor="workspace">Код организации (необязательно)</label>
          <input
            ref={workspaceRef}
            id="workspace"
            name="workspace"
            autoComplete="organization"
            value={workspace}
            disabled={busy}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={`${workspaceHintId}${error ? ` ${errorId}` : ''}`}
            onChange={(event) => setWorkspace(event.target.value)}
          />
          <p id={workspaceHintId} className="field-hint">
            Нужен только для входа в рабочее пространство школы. Личный аккаунт входит по email.
          </p>
          <label htmlFor="email">Email педагога</label>
          <input
            id="email"
            name="email"
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
          {error ? (
            <p id={errorId} className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Входим…' : 'Войти'}
          </button>
          <button type="button" className="btn-ghost login-secondary" onClick={onCreateAccount}>
            Создать аккаунт
          </button>
        </form>
      </main>
    </div>
  );
}
