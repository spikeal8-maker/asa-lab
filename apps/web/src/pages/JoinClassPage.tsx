import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { AuthHomeBrand } from '../components/AuthHomeBrand';

type JoinState =
  | { kind: 'code' }
  | { kind: 'resolving' }
  | {
      kind: 'student-code';
      classroom: { id: string; title: string; teacherDisplayName: string; safeMode: boolean };
    };

function initialCode(): string {
  const hashQuery = window.location.hash.split('?')[1] ?? '';
  const query = hashQuery || window.location.search.replace(/^\?/, '');
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
  const [initialClassCode] = useState(initialCode);
  const [state, setState] = useState<JoinState>(() =>
    initialClassCode ? { kind: 'resolving' } : { kind: 'code' },
  );
  const [code, setCode] = useState(initialClassCode);
  const [studentCode, setStudentCode] = useState('');
  const [busy, setBusy] = useState(initialClassCode.length > 0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialClassCode) return;
    let cancelled = false;
    void api.resolveClassroomCode(initialClassCode).then((result) => {
      if (cancelled) return;
      setBusy(false);
      if (result.ok) {
        setState({ kind: 'student-code', classroom: result.data.classroom });
        return;
      }
      setState({ kind: 'code' });
      setError(result.error.message || 'Не удалось открыть класс по ссылке.');
    });
    return () => {
      cancelled = true;
    };
  }, [initialClassCode]);

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
        {state.kind === 'resolving' ? (
          <div className="join-class-resolving" role="status" aria-live="polite">
            <strong>Открываем класс…</strong>
            <span>Код класса уже получен из QR-ссылки.</span>
          </div>
        ) : null}
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
        ) : null}
        {state.kind === 'student-code' ? (
          <form onSubmit={(event) => void signIn(event)}>
            <div className="join-class-preview">
              <div>
                <strong>{state.classroom.title}</strong>
                <small>Преподаватель: {state.classroom.teacherDisplayName}</small>
              </div>
              {state.classroom.safeMode ? (
                <small className="join-class-safe-mode">Безопасный режим класса</small>
              ) : null}
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
        ) : null}
      </main>
    </div>
  );
}
