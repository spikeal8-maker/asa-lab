import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { AuthHomeBrand } from '../components/AuthHomeBrand';

type JoinState =
  | { kind: 'code' }
  | {
      kind: 'student-code';
      classroom: { id: string; title: string; teacherDisplayName: string; safeMode: boolean };
    };

function initialCode(): string {
  const query = window.location.hash.split('?')[1] ?? '';
  return new URLSearchParams(query).get('code') ?? '';
}

function normalizeStudentCode(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase().slice(0, 6);
}

/** StudentSeat sign-in deliberately has only two human inputs: class code, then student code. */
export function JoinClassPage({
  onBack,
  onHome,
  onSignedIn,
}: {
  onBack: () => void;
  onHome: () => void;
  onSignedIn: () => void;
}): JSX.Element {
  const [state, setState] = useState<JoinState>({ kind: 'code' });
  const [code, setCode] = useState(initialCode);
  const [studentCode, setStudentCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resolve(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await api.resolveClassroomCode(code);
    setBusy(false);
    if (result.ok) {
      setState({ kind: 'student-code', classroom: result.data.classroom });
      return;
    }
    setError(result.error.message || 'Не удалось найти класс.');
  }

  async function signIn(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    if (studentCode.length !== 6) {
      setError('Введите шестизначный код ученика с карточки.');
      return;
    }
    setBusy(true);
    const result = await api.signInClassroomSeat(code, studentCode);
    setBusy(false);
    if (result.ok) {
      onSignedIn();
      return;
    }
    setError(result.error.message || 'Код класса или код ученика не подошёл.');
  }

  return (
    <div className="page-center join-class-page">
      <main className="login-card join-class-card">
        <button
          type="button"
          className="btn-ghost entry-back"
          onClick={
            state.kind === 'student-code'
              ? () => {
                  setError(null);
                  setStudentCode('');
                  setState({ kind: 'code' });
                }
              : onBack
          }
        >
          ← Назад
        </button>
        <AuthHomeBrand onHome={onHome} />
        {state.kind === 'code' ? (
          <form onSubmit={(event) => void resolve(event)}>
            <h2>Введите код класса</h2>
            <p className="subtitle">Код класса написан на карточке, которую выдал преподаватель.</p>
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
              <small>Преподаватель: {state.classroom.teacherDisplayName}</small>
              {state.classroom.safeMode ? <em>Безопасный режим</em> : null}
            </div>
            <h2>Введите код ученика</h2>
            <p className="subtitle">Шесть символов с вашей личной карточки доступа.</p>
            <label htmlFor="class-student-code">Код ученика</label>
            <input
              id="class-student-code"
              autoFocus
              autoComplete="one-time-code"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              value={studentCode}
              disabled={busy}
              minLength={6}
              maxLength={6}
              placeholder="K7M4Q2"
              onChange={(event) => setStudentCode(normalizeStudentCode(event.target.value))}
            />
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              className="btn-primary"
              disabled={busy || studentCode.length !== 6}
            >
              {busy ? 'Входим…' : 'Войти'}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
