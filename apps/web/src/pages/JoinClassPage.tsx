import { useState, type FormEvent } from 'react';
import { api, type BotProof } from '../api';
import { AsaLabWordmark } from '../brand/AsaLabBrand';
import { BotCheck } from '../components/BotCheck';

type JoinState =
  | { kind: 'code' }
  | {
      kind: 'handle';
      classroom: { id: string; title: string; teacherDisplayName: string; safeMode: boolean };
    };

function initialCode(): string {
  const query = window.location.hash.split('?')[1] ?? '';
  return new URLSearchParams(query).get('code') ?? '';
}

/**
 * Signing in to a class. An existing seat session is not this page's business —
 * the application resolves that before routing here, so a learner who is
 * already signed in never sees a code field again.
 */
export function JoinClassPage({
  onBack,
  onSignedIn,
}: {
  onBack: () => void;
  onSignedIn: () => void;
}): JSX.Element {
  const [state, setState] = useState<JoinState>({ kind: 'code' });
  const [code, setCode] = useState(initialCode);
  const [loginHandle, setLoginHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [botProof, setBotProof] = useState<BotProof | null>(null);
  const [botReset, setBotReset] = useState(0);

  async function resolve(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await api.resolveClassroomCode(code);
    setBusy(false);
    if (result.ok) {
      setState({ kind: 'handle', classroom: result.data.classroom });
      return;
    }
    setError(result.error.message || 'Не удалось найти класс.');
  }

  async function signIn(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (!botProof) {
      setError('Поставьте галочку «Я не робот» и дождитесь проверки.');
      return;
    }
    setBusy(true);
    const result = await api.signInClassroomSeat(code, loginHandle, botProof);
    setBusy(false);
    if (result.ok) {
      onSignedIn();
      return;
    }
    setBotProof(null);
    setBotReset((value) => value + 1);
    setError(result.error.message || 'Не удалось войти в класс.');
  }

  return (
    <div className="page-center join-class-page">
      <main className="login-card join-class-card">
        <button
          type="button"
          className="btn-ghost entry-back"
          onClick={
            state.kind === 'handle'
              ? () => {
                  setError(null);
                  setBotProof(null);
                  setBotReset((value) => value + 1);
                  setState({ kind: 'code' });
                }
              : onBack
          }
        >
          ← Назад
        </button>
        <h1 className="brand-heading">
          <AsaLabWordmark />
        </h1>
        {state.kind === 'code' ? (
          <form onSubmit={(event) => void resolve(event)}>
            <h2>Введите код класса</h2>
            <p className="subtitle">Код выдаёт педагог. Аккаунт и электронная почта не нужны.</p>
            <label htmlFor="class-code">Код класса</label>
            <input
              id="class-code"
              autoFocus
              autoComplete="one-time-code"
              value={code}
              disabled={busy}
              placeholder="ABC DEF 234"
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Ищем класс…' : 'Продолжить'}
            </button>
          </form>
        ) : (
          <form onSubmit={(event) => void signIn(event)}>
            <div className="join-class-preview">
              <span>Класс</span>
              <strong>{state.classroom.title}</strong>
              <small>Педагог: {state.classroom.teacherDisplayName}</small>
              {state.classroom.safeMode ? <em>Безопасный режим</em> : null}
            </div>
            <h2>Ваше имя для входа</h2>
            <p className="subtitle">Введите имя, которое педагог выдал именно вам.</p>
            <label htmlFor="class-login-handle">Имя для входа</label>
            <input
              id="class-login-handle"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              value={loginHandle}
              disabled={busy}
              placeholder="alina-k"
              onChange={(event) => setLoginHandle(event.target.value.toLowerCase())}
            />
            <BotCheck
              key={`class-join-${botReset}`}
              action="class_join"
              disabled={busy}
              onVerified={setBotProof}
            />
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="btn-primary" disabled={busy || !botProof}>
              {busy ? 'Входим…' : 'Войти в класс'}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
