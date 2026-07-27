import { useState } from 'react';
import { api, type PublicUser } from '../api';
import { AsaLabWordmark } from '../brand/AsaLabBrand';
import { ClassesIcon, FolderIcon, UserIcon } from '../electronics/workbench-icons';

export type PortalSection = 'projects' | 'classes';

export function PortalHeader({
  user,
  active,
  onNavigate,
  onLoggedOut,
}: {
  user: PublicUser;
  active: PortalSection;
  onNavigate: (section: PortalSection) => void;
  onLoggedOut: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await api.logout();
    setBusy(false);
    if (result.ok) onLoggedOut();
    else
      setError(
        result.status === 0 ? 'Сервер недоступен — сессия не завершена.' : 'Не удалось выйти.',
      );
  }

  return (
    <>
      <header className="portal-header">
        <button
          type="button"
          className="portal-brand"
          onClick={() => onNavigate('projects')}
          aria-label="ASA Lab — открыть мои проекты"
        >
          <AsaLabWordmark />
        </button>
        <nav className="portal-nav" aria-label="Основная навигация">
          <button
            type="button"
            className={active === 'projects' ? 'portal-nav-item active' : 'portal-nav-item'}
            onClick={() => onNavigate('projects')}
          >
            <FolderIcon />
            Мои проекты
          </button>
          <button
            type="button"
            className={active === 'classes' ? 'portal-nav-item active' : 'portal-nav-item'}
            onClick={() => onNavigate('classes')}
          >
            <ClassesIcon />
            Классы
          </button>
          <span
            className="portal-nav-item disabled"
            aria-disabled="true"
            title="Появится в следующих этапах"
          >
            Учебные материалы
          </span>
        </nav>
        <div className="portal-user">
          <span className="portal-user-avatar" aria-hidden="true">
            <UserIcon />
          </span>
          <span className="portal-user-name">{user.displayName}</span>
          <button
            type="button"
            className="portal-logout"
            disabled={busy}
            onClick={() => void logout()}
          >
            {busy ? 'Выходим…' : 'Выйти'}
          </button>
        </div>
      </header>
      {error ? (
        <p className="portal-global-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
