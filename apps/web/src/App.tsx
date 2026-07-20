import { useCallback, useEffect, useState } from 'react';
import { api, type PublicUser } from './api';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';

type SessionState =
  | { kind: 'checking' }
  | { kind: 'anonymous' }
  | { kind: 'authenticated'; user: PublicUser }
  | { kind: 'error' };

export function App(): JSX.Element {
  const [session, setSession] = useState<SessionState>({ kind: 'checking' });

  const checkSession = useCallback(async () => {
    setSession({ kind: 'checking' });
    const result = await api.me();
    if (result.ok) {
      setSession({ kind: 'authenticated', user: result.data.user });
    } else if (result.status === 401) {
      setSession({ kind: 'anonymous' });
    } else {
      setSession({ kind: 'error' });
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  if (session.kind === 'checking') {
    return (
      <div className="page-center" role="status" aria-live="polite">
        Загрузка…
      </div>
    );
  }

  if (session.kind === 'error') {
    return (
      <main className="page-center">
        <section className="login-card" role="alert">
          <h1 className="brand">ASA Lab</h1>
          <p>Не удалось проверить активную сессию.</p>
          <button type="button" className="btn-primary" onClick={() => void checkSession()}>
            Повторить
          </button>
        </section>
      </main>
    );
  }

  if (session.kind === 'anonymous') {
    return <LoginPage onLoggedIn={(user) => setSession({ kind: 'authenticated', user })} />;
  }

  return (
    <DashboardPage
      user={session.user}
      onLoggedOut={() => {
        setSession({ kind: 'anonymous' });
      }}
    />
  );
}
