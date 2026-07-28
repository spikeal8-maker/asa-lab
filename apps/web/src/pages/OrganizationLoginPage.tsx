import { useId, useRef, useState, type FormEvent } from 'react';
import { api, type SessionPayload } from '../api';
import { AsaLabWordmark } from '../brand/AsaLabBrand';

/**
 * Legacy sign-in through an organization code.
 *
 * Kept as a separate, temporary route so schools that were onboarded before
 * global accounts keep working. It is deliberately not the main form.
 */
export function OrganizationLoginPage({
  onSignedIn,
  onBack,
}: {
  onSignedIn: (session: SessionPayload) => void;
  onBack: () => void;
}): JSX.Element {
  const [workspace, setWorkspace] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const workspaceRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!workspace.trim() || !email.trim() || !password) {
      setError('Заполните код организации, email и пароль.');
      workspaceRef.current?.focus();
      return;
    }
    setBusy(true);
    const result = await api.loginWithWorkspace(workspace.trim(), email.trim(), password);
    setBusy(false);
    if (result.ok) {
      onSignedIn(result.data);
      return;
    }
    setError(
      result.status === 0
        ? 'Сервер недоступен. Попробуйте ещё раз.'
        : 'Неверный код организации, email или пароль.',
    );
    workspaceRef.current?.focus();
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
        <p className="subtitle">Вход через организацию</p>
        <p className="legacy-hint legacy-banner">
          Временный совместимый путь для школ, подключённых по коду организации.
        </p>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor="workspace">Код организации</label>
          <input
            id="workspace"
            name="workspace"
            ref={workspaceRef}
            autoFocus
            autoComplete="organization"
            value={workspace}
            disabled={busy}
            onChange={(event) => setWorkspace(event.target.value)}
          />
          <label htmlFor="org-email">Email</label>
          <input
            id="org-email"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="org-password">Пароль</label>
          <input
            id="org-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p id={errorId} className="form-error" role="alert" hidden={!error}>
            {error}
          </p>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Входим…' : 'Войти через организацию'}
          </button>
        </form>
      </main>
    </div>
  );
}
