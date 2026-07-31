import { useRef, useState } from 'react';
import { api, type SessionPayload } from '../api';
import { UserIcon } from '../electronics/workbench-icons';
import { AsaLabWordmark } from '../brand/AsaLabBrand';
import { portalNavigation, type CreatorPortalSection } from '../creator-portal/navigation';

export type PortalSection = CreatorPortalSection;

const SECTION_GLYPHS: Record<Exclude<PortalSection, 'account'>, string> = {
  home: '⌂',
  projects: '□',
  learning: '▤',
  collections: '◇',
  challenges: '✦',
  classes: '◎',
  help: '?',
};

export function PortalHeader({
  session,
  active,
  canTeach,
  onNavigate,
  onSessionChanged,
  onLoggedOut,
}: {
  session: SessionPayload;
  active: PortalSection;
  canTeach: boolean;
  onNavigate: (section: PortalSection) => void;
  onSessionChanged: (session: SessionPayload) => void;
  onLoggedOut: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accountMenu = useRef<HTMLDetailsElement>(null);
  const activeWorkspace = session.workspaces.find(
    (workspace) => workspace.workspaceId === session.activeWorkspace.workspaceId,
  );

  async function logout(): Promise<void> {
    if (busy) return;
    setBusy('logout');
    setError(null);
    const result = await api.logout();
    setBusy(null);
    if (result.ok) {
      accountMenu.current?.removeAttribute('open');
      onLoggedOut();
    } else
      setError(
        result.status === 0 ? 'Сервер недоступен — сессия не завершена.' : 'Не удалось выйти.',
      );
  }

  async function switchWorkspace(workspaceId: string): Promise<void> {
    if (busy || workspaceId === session.activeWorkspace.workspaceId) return;
    setBusy(`workspace:${workspaceId}`);
    setError(null);
    const result = await api.switchWorkspace(workspaceId);
    if (!result.ok) {
      setBusy(null);
      setError(result.error.message);
      return;
    }
    const refreshed = await api.me();
    setBusy(null);
    if (!refreshed.ok || !refreshed.data.authenticated) {
      setError('Не удалось обновить активное рабочее пространство.');
      return;
    }
    onSessionChanged(refreshed.data);
    accountMenu.current?.removeAttribute('open');
    onNavigate('home');
  }

  return (
    <>
      <header className="portal-header">
        <button type="button" className="portal-brand" onClick={() => onNavigate('home')}>
          <AsaLabWordmark />
        </button>
        <nav className="portal-nav" aria-label="Основная навигация">
          {portalNavigation(canTeach).map((item) => (
            <button
              type="button"
              key={item.section}
              className={active === item.section ? 'portal-nav-item active' : 'portal-nav-item'}
              aria-current={active === item.section ? 'page' : undefined}
              onClick={() => onNavigate(item.section)}
            >
              <span className="portal-nav-glyph" aria-hidden="true">
                {SECTION_GLYPHS[item.section]}
              </span>
              {item.label}
            </button>
          ))}
        </nav>
        <details
          ref={accountMenu}
          className={active === 'account' ? 'portal-account active' : 'portal-account'}
        >
          <summary aria-label={`Меню аккаунта ${session.user.displayName}`}>
            <span className="portal-user-avatar" aria-hidden="true">
              <UserIcon />
            </span>
            <span className="portal-user-copy">
              <strong>{session.user.displayName}</strong>
              <small>{activeWorkspace?.title ?? 'Рабочее пространство'}</small>
            </span>
          </summary>
          <div className="portal-account-menu">
            <div className="portal-account-identity">
              <strong>{session.user.displayName}</strong>
              <span>{session.user.email}</span>
            </div>
            <div className="portal-account-workspaces">
              <p>Рабочее пространство</p>
              {session.workspaces.map((workspace) => {
                const current = workspace.workspaceId === session.activeWorkspace.workspaceId;
                return (
                  <button
                    type="button"
                    key={workspace.workspaceId}
                    className={current ? 'current' : undefined}
                    disabled={busy !== null || current}
                    onClick={() => void switchWorkspace(workspace.workspaceId)}
                  >
                    <span>
                      <strong>{workspace.title}</strong>
                      <small>{workspace.kind === 'personal' ? 'Личное' : 'Организация'}</small>
                    </span>
                    <span aria-hidden="true">
                      {busy === `workspace:${workspace.workspaceId}` ? '…' : current ? '✓' : ''}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="portal-account-settings"
              onClick={() => {
                accountMenu.current?.removeAttribute('open');
                onNavigate('account');
              }}
            >
              Профиль и активные сессии
            </button>
            <button
              type="button"
              className="portal-account-logout"
              disabled={busy !== null}
              onClick={() => void logout()}
            >
              {busy === 'logout' ? 'Выходим…' : 'Выйти'}
            </button>
          </div>
        </details>
      </header>
      {error ? (
        <p className="portal-global-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
