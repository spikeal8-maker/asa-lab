import { useState, type FormEvent } from 'react';
import { api, type PublicUser } from '../api';

export function LoginPage({ onLoggedIn }: { onLoggedIn: (user: PublicUser) => void }): JSX.Element {
  const [workspace, setWorkspace] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!workspace.trim() || !email.trim() || !password) {
      setError('Заполните workspace, email и пароль.');
      return;
    }
    setBusy(true);
    const result = await api.login(workspace.trim(), email.trim(), password);
    setBusy(false);
    if (result.ok) {
      onLoggedIn(result.data.user);
      return;
    }
    if (result.status === 400 || result.status === 401) {
      setError('Неверный workspace, email или пароль.');
    } else if (result.status === 0) {
      setError('Сервер недоступен. Попробуйте ещё раз.');
    } else {
      setError('Ошибка сервера. Попробуйте ещё раз.');
    }
  }

  return (
    <div className="page-center">
      <main className="login-card">
        <h1 className="brand">ASA Lab</h1>
        <p className="subtitle">Кабинет педагога</p>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor="workspace">Workspace</label>
          <input
            id="workspace"
            name="workspace"
            autoComplete="organization"
            placeholder="school-1580"
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
          />
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            placeholder="teacher@school-1580.local"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="password">Пароль</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Входим…' : 'Войти'}
          </button>
        </form>
      </main>
    </div>
  );
}
