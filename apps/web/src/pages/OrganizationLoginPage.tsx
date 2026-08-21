import { useId, useRef, useState, type FormEvent } from 'react';
import { api, type BotProof, type SessionPayload } from '../api';
import { AsaLabWordmark } from '../brand/AsaLabBrand';
import { BotCheck } from '../components/BotCheck';

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
  const [message, setMessage] = useState<string | null>(null);
  const [botProof, setBotProof] = useState<BotProof | null>(null);
  const [botReset, setBotReset] = useState(0);
  const messageId = useId();
  const workspaceRef = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setMessage(null);
    if (!workspace.trim() || !email.trim() || !password) {
      setMessage('Заполните код организации, email и пароль.');
      workspaceRef.current?.focus();
      return;
    }
    if (!botProof) {
      setMessage('Поставьте галочку «Я не робот» и дождитесь проверки.');
      return;
    }
    setBusy(true);
    const result = await api.loginWithWorkspace(workspace.trim(), email.trim(), password, botProof);
    setBusy(false);
    if (result.ok) {
      onSignedIn(result.data);
      return;
    }
    setBotProof(null);
    setBotReset((value) => value + 1);
    setMessage(
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
          Совместимый путь для школ, подключённых по коду организации.
        </p>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor="workspace">Код организации</label>
          <input
            id="workspace"
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
            type="email"
            autoComplete="username"
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="org-password">Пароль</label>
          <input
            id="org-password"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
          <BotCheck
            key={`organization-login-${botReset}`}
            action="login"
            disabled={busy}
            onVerified={setBotProof}
          />
          <p id={messageId} className="form-error" role="alert" hidden={!message}>
            {message}
          </p>
          <button type="submit" className="btn-primary" disabled={busy || !botProof}>
            {busy ? 'Входим…' : 'Войти через организацию'}
          </button>
        </form>
      </main>
    </div>
  );
}
