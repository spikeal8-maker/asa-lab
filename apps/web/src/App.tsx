import { useEffect, useState } from 'react';
import { api, type PublicUser } from './api';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';

export function App(): JSX.Element {
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState<PublicUser | null>(null);

  useEffect(() => {
    void api.me().then((result) => {
      if (result.ok) {
        setUser(result.data.user);
      }
      setChecking(false);
    });
  }, []);

  if (checking) {
    return (
      <div className="page-center" role="status" aria-live="polite">
        Загрузка…
      </div>
    );
  }
  if (!user) {
    return <LoginPage onLoggedIn={setUser} />;
  }
  return (
    <DashboardPage
      user={user}
      onLoggedOut={() => {
        setUser(null);
      }}
    />
  );
}
