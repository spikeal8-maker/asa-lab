import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { api, type SessionPayload } from '../api';
import { AsaLabWordmark } from '../brand/AsaLabBrand';
import { createAvatarDataUrl } from '../creator-portal/avatar-file';
import { portalNavigation, type CreatorPortalSection } from '../creator-portal/navigation';
import {
  ClassesIcon,
  CollapseIcon,
  CommentIcon,
  ExpandIcon,
  FolderIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
} from '../electronics/workbench-icons';
import { GridIcon, HomeIcon, RulerIcon } from '../three-d/three-d-icons';

export type PortalSection = CreatorPortalSection;

function sectionIcon(section: Exclude<PortalSection, 'account'>): JSX.Element {
  if (section === 'home') return <HomeIcon />;
  if (section === 'classes') return <ClassesIcon />;
  if (section === 'projects') return <GridIcon />;
  if (section === 'collections') return <FolderIcon />;
  if (section === 'learning') return <ListIcon />;
  if (section === 'challenges') return <RulerIcon />;
  return <CommentIcon />;
}

function AvatarVisual({
  avatarDataUrl,
  initials,
}: {
  avatarDataUrl: string | null;
  initials: string;
}): JSX.Element {
  return avatarDataUrl ? <img src={avatarDataUrl} alt="" /> : <span>{initials}</span>;
}

export function PortalHeader({
  session,
  active,
  canTeach,
  onNavigate,
  onSessionChanged,
  onLoggedOut,
  onCreate,
}: {
  session: SessionPayload;
  active: PortalSection;
  canTeach: boolean;
  onNavigate: (section: PortalSection) => void;
  onSessionChanged: (session: SessionPayload) => void;
  onLoggedOut: () => void;
  onCreate: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem('asa-portal-sidebar') === 'collapsed',
  );
  const accountMenu = useRef<HTMLDetailsElement>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const activeWorkspace = session.workspaces.find(
    (workspace) => workspace.workspaceId === session.activeWorkspace.workspaceId,
  );
  const avatarName = session.user.displayName.replace(/\([^)]*\)/g, ' ');
  const initials =
    (avatarName.match(/[\p{L}\p{N}]+/gu) ?? [])
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase('ru-RU') ?? '')
      .join('') || 'A';
  const navigationItems = portalNavigation(canTeach);
  const primaryNavigation = navigationItems.filter((item) => item.section !== 'help');
  const helpNavigation = navigationItems.find((item) => item.section === 'help');

  useEffect(() => {
    setError(null);
  }, [session.activeWorkspace.workspaceId]);

  useEffect(() => {
    let cancelled = false;
    void api.accountAvatar().then((result) => {
      if (!cancelled && result.ok) setAvatarDataUrl(result.data.avatarDataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [session.user.id]);

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || busy) return;
    setBusy('avatar');
    setError(null);
    try {
      const dataUrl = await createAvatarDataUrl(file);
      const result = await api.updateAccountAvatar(dataUrl);
      if (!result.ok) {
        setError('Не удалось сохранить фотографию профиля.');
        return;
      }
      setAvatarDataUrl(result.data.avatarDataUrl);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : 'Не удалось обработать фотографию профиля.',
      );
    } finally {
      setBusy(null);
    }
  }

  async function removeAvatar(): Promise<void> {
    if (busy || !avatarDataUrl) return;
    setBusy('avatar');
    setError(null);
    const result = await api.updateAccountAvatar(null);
    setBusy(null);
    if (!result.ok) {
      setError('Не удалось удалить фотографию профиля.');
      return;
    }
    setAvatarDataUrl(null);
  }

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
    const refreshed = await api.me();
    setBusy(null);
    if (
      refreshed.ok &&
      refreshed.data.authenticated &&
      refreshed.data.activeWorkspace.workspaceId === workspaceId
    ) {
      onSessionChanged(refreshed.data);
      accountMenu.current?.removeAttribute('open');
      onNavigate('home');
      return;
    }
    setError(
      result.ok
        ? 'Не удалось обновить рабочее пространство. Обновите страницу и повторите.'
        : 'Не удалось переключить рабочее пространство. Обновите страницу и повторите.',
    );
  }

  return (
    <>
      <header className="portal-header">
        <button type="button" className="portal-brand" onClick={() => onNavigate('home')}>
          <AsaLabWordmark />
        </button>
        <nav className="portal-global-nav" aria-label="Разделы ASA Lab">
          <button type="button" onClick={() => onNavigate('projects')}>
            Проекты
          </button>
          <button type="button" onClick={() => onNavigate('collections')}>
            Галерея
          </button>
          <button type="button" onClick={() => onNavigate('learning')}>
            Обучение
          </button>
          {canTeach ? (
            <button type="button" onClick={() => onNavigate('classes')}>
              Преподаватели
            </button>
          ) : null}
          <button type="button" onClick={() => onNavigate('help')}>
            Ресурсы
          </button>
        </nav>
        <button
          type="button"
          className="portal-header-search"
          aria-label="Поиск проектов"
          title="Поиск проектов"
          onClick={() => onNavigate('projects')}
        >
          <SearchIcon />
        </button>
        <button
          type="button"
          className="portal-header-create"
          aria-label="Создать проект"
          onClick={onCreate}
        >
          <span aria-hidden="true">＋</span>
          <span className="portal-header-create-label">Создать</span>
        </button>
        <details
          ref={accountMenu}
          className={active === 'account' ? 'portal-account active' : 'portal-account'}
        >
          <summary aria-label={`Меню аккаунта ${session.user.displayName}`}>
            <span className="portal-user-avatar" aria-hidden="true">
              <AvatarVisual avatarDataUrl={avatarDataUrl} initials={initials} />
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
            <div className="portal-account-avatar-actions">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => avatarInput.current?.click()}
              >
                {avatarDataUrl ? 'Изменить фотографию' : 'Загрузить фотографию'}
              </button>
              {avatarDataUrl ? (
                <button type="button" disabled={busy !== null} onClick={() => void removeAvatar()}>
                  Удалить
                </button>
              ) : null}
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
      <aside
        className={sidebarCollapsed ? 'portal-sidebar collapsed' : 'portal-sidebar'}
        aria-label="Основная навигация"
      >
        <div className="portal-sidebar-profile">
          <button
            type="button"
            className="portal-sidebar-avatar"
            aria-label={
              avatarDataUrl ? 'Изменить фотографию профиля' : 'Загрузить фотографию профиля'
            }
            title={avatarDataUrl ? 'Изменить фотографию' : 'Загрузить фотографию'}
            disabled={busy !== null}
            onClick={() => avatarInput.current?.click()}
          >
            <AvatarVisual avatarDataUrl={avatarDataUrl} initials={initials} />
            <span className="portal-avatar-upload-badge" aria-hidden="true">
              <PlusIcon />
            </span>
          </button>
          <input
            ref={avatarInput}
            className="portal-avatar-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label="Выбрать фотографию профиля"
            onChange={(event) => void uploadAvatar(event)}
          />
          <span className="portal-sidebar-profile-copy">
            <strong>{session.user.displayName}</strong>
            <small>{activeWorkspace?.title ?? 'Рабочее пространство'}</small>
          </span>
        </div>
        <nav className="portal-nav">
          {primaryNavigation.map((item) => (
            <button
              type="button"
              key={item.section}
              className={active === item.section ? 'portal-nav-item active' : 'portal-nav-item'}
              aria-current={active === item.section ? 'page' : undefined}
              onClick={() => onNavigate(item.section)}
            >
              <span className="portal-nav-glyph" aria-hidden="true">
                {sectionIcon(item.section)}
              </span>
              <span className="portal-nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
        {helpNavigation ? (
          <div className="portal-sidebar-footer">
            <button
              type="button"
              className={active === 'help' ? 'portal-nav-item active' : 'portal-nav-item'}
              aria-current={active === 'help' ? 'page' : undefined}
              onClick={() => onNavigate('help')}
            >
              <span className="portal-nav-glyph" aria-hidden="true">
                {sectionIcon('help')}
              </span>
              <span className="portal-nav-label">{helpNavigation.label}</span>
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className="portal-sidebar-collapse"
          aria-label={sidebarCollapsed ? 'Развернуть боковую панель' : 'Свернуть боковую панель'}
          title={sidebarCollapsed ? 'Развернуть' : 'Свернуть'}
          onClick={() => {
            const next = !sidebarCollapsed;
            setSidebarCollapsed(next);
            window.localStorage.setItem('asa-portal-sidebar', next ? 'collapsed' : 'expanded');
          }}
        >
          {sidebarCollapsed ? <ExpandIcon /> : <CollapseIcon />}
        </button>
      </aside>
      {error ? (
        <p className="portal-global-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
