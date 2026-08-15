import { useEffect, useState, type FormEvent } from 'react';
import { api, type ClassroomStudentSession } from '../api';
import { AsaLabWordmark } from '../brand/AsaLabBrand';

type JoinState =
  | { kind: 'checking' }
  | { kind: 'code' }
  | {
      kind: 'handle';
      classroom: { id: string; title: string; teacherDisplayName: string; safeMode: boolean };
    }
  | { kind: 'student'; session: ClassroomStudentSession };

function initialCode(): string {
  const query = window.location.hash.split('?')[1] ?? '';
  return new URLSearchParams(query).get('code') ?? '';
}

export function JoinClassPage({ onBack }: { onBack: () => void }): JSX.Element {
  const [state, setState] = useState<JoinState>({ kind: 'checking' });
  const [code, setCode] = useState(initialCode);
  const [loginHandle, setLoginHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.classroomStudentMe().then((result) => {
      if (cancelled) return;
      if (result.ok && result.data.authenticated)
        setState({ kind: 'student', session: result.data });
      else setState({ kind: 'code' });
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
    setBusy(true);
    const result = await api.signInClassroomSeat(code, loginHandle);
    setBusy(false);
    if (result.ok) {
      setState({ kind: 'student', session: result.data });
      return;
    }
    setError(result.error.message || 'Не удалось войти в класс.');
  }

  if (state.kind === 'checking') {
    return (
      <div className="page-center" role="status">
        Проверяем вход в класс…
      </div>
    );
  }

  if (state.kind === 'student') {
    const { session } = state;
    return (
      <div className="student-class-shell">
        <header className="student-class-header">
          <AsaLabWordmark />
          <button
            type="button"
            className="btn-secondary"
            onClick={async () => {
              await api.classroomStudentLogout();
              setLoginHandle('');
              setState({ kind: 'code' });
            }}
          >
            Выйти
          </button>
        </header>
        <main className="student-class-home">
          <section className="student-class-welcome">
            <span>Класс · {session.classroom.title}</span>
            <h1>Здравствуйте, {session.student.displayName}</h1>
            <p>Педагог: {session.classroom.teacherDisplayName}</p>
          </section>
          <section className="student-safe-mode-card">
            <strong>
              {session.student.safeMode ? 'Безопасный режим включён' : 'Обычный режим'}
            </strong>
            <p>
              {session.student.safeMode
                ? 'Ваш профиль и проекты не публикуются для всех. Педагог класса может помогать с работами.'
                : 'Настройки публикации определяет педагог класса.'}
            </p>
          </section>
          <section className="student-class-empty">
            <h2>Работы класса</h2>
            <p>Пока педагог не добавил учебные проекты. Ваш вход сохранён на этом устройстве.</p>
          </section>
        </main>
      </div>
    );
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
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Входим…' : 'Войти в класс'}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
