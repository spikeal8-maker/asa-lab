import { useEffect, useRef, useState } from 'react';
import { api, type SessionPayload } from '../api';
import { AsaLabWordmark } from '../brand/AsaLabBrand';
import {
  defaultAvatarForAccount,
  PROFILE_AVATAR_CHANGED_EVENT,
} from '../creator-portal/default-avatars';
import { portalNavigation, type CreatorPortalSection } from '../creator-portal/navigation';
import {
  ChevronIcon,
  CloseIcon,
  CollapseIcon,
  ExpandIcon,
  PlusIcon,
  SearchIcon,
} from '../electronics/workbench-icons';
import {
  BellGlyph,
  ChallengesGlyph,
  ClassesGlyph,
  CollectionsGlyph,
  HelpGlyph,
  HomeGlyph,
  LearningGlyph,
  ProjectsGlyph,
  SchoolGlyph,
  SettingsGlyph,
} from './portal-icons';

export type PortalSection = CreatorPortalSection;

function sectionIcon(section: Exclude<PortalSection, 'account'>): JSX.Element {
  if (section === 'home') return <HomeGlyph />;
  if (section === 'classes') return <ClassesGlyph />;
  if (section === 'projects') return <ProjectsGlyph />;
  if (section === 'collections') return <CollectionsGlyph />;
  if (section === 'learning') return <LearningGlyph />;
  if (section === 'challenges') return <ChallengesGlyph />;
  return <HelpGlyph />;
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
  seatLearner = false,
  onNavigate,
  onSessionChanged,
  onLoggedOut,
  onCreate,
}: {
  session: SessionPayload;
  active: PortalSection;
  canTeach: boolean;
  /**
   * Signed in with a class seat. The shell is the same one everyone uses; a
   * seat simply has nowhere to go in the places an account owns — a class to
   * manage, a school to switch to, a profile to edit — so those are left out
   * rather than shown and refused.
   */
  seatLearner?: boolean;
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
  const activeWorkspace = session.workspaces.find(
    (workspace) => workspace.workspaceId === session.activeWorkspace.workspaceId,
  );
  const avatarName = session.user.displayName.replace(/\([^)]*\)/g, ' ');
  const initials =
    (avatarName.match(/[\p{L}\p{N}]+/gu) ?? [])
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase('ru-RU') ?? '')
      .join('') || 'A';
  const effectiveAvatarUrl = avatarDataUrl ?? defaultAvatarForAccount(session.user.id).src;
  const navigationItems = portalNavigation(canTeach, { classes: !seatLearner });
  const primaryNavigation = navigationItems.filter((item) => item.section !== 'help');
  const helpNavigation = navigationItems.find((item) => item.section === 'help');

  useEffect(() => {
    setError(null);
  }, [session.activeWorkspace.workspaceId]);

  useEffect(() => {
    // A seat has no account and therefore no uploaded picture; asking for one
    // is a guaranteed 401. The generated avatar below covers it.
    if (seatLearner) return;
    let cancelled = false;
    void api.accountAvatar().then((result) => {
      if (!cancelled && result.ok) setAvatarDataUrl(result.data.avatarDataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [seatLearner, session.user.id]);

  useEffect(() => {
    function updateAvatarFromPage(event: Event): void {
      setAvatarDataUrl((event as CustomEvent<string | null>).detail);
    }

    window.addEventListener(PROFILE_AVATAR_CHANGED_EVENT, updateAvatarFromPage);
    return () => window.removeEventListener(PROFILE_AVATAR_CHANGED_EVENT, updateAvatarFromPage);
  }, []);

  useEffect(() => {
    function closeAccountMenu(event: PointerEvent): void {
      const menu = accountMenu.current;
      if (!menu?.open || !(event.target instanceof Node) || menu.contains(event.target)) return;
      menu.removeAttribute('open');
    }

    function closeAccountMenuWithEscape(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || !accountMenu.current?.open) return;
      accountMenu.current.removeAttribute('open');
      accountMenu.current.querySelector('summary')?.focus();
    }

    document.addEventListener('pointerdown', closeAccountMenu);
    document.addEventListener('keydown', closeAccountMenuWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeAccountMenu);
      document.removeEventListener('keydown', closeAccountMenuWithEscape);
    };
  }, []);

  function closeAccountMenu(): void {
    accountMenu.current?.removeAttribute('open');
  }

  function openAccountMenu(): void {
    if (!accountMenu.current) return;
    accountMenu.current.open = true;
    window.requestAnimationFrame(() => accountMenu.current?.querySelector('summary')?.focus());
  }

  function navigateFromAccount(section: PortalSection): void {
    closeAccountMenu();
    onNavigate(section);
  }

  async function logout(): Promise<void> {
    if (busy) return;
    setBusy('logout');
    setError(null);
    // A seat's session is a different cookie with a different lifetime; ending
    // it is the same act for the learner and a different call here.
    const result = seatLearner ? await api.classroomStudentLogout() : await api.logout();
    setBusy(null);
    if (result.ok) {
      closeAccountMenu();
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
      closeAccountMenu();
      onNavigate('home');
      return;
    }
    setError(
      result.ok
        ? 'Не удалось открыть выбранный аккаунт или школу. Обновите страницу и повторите.'
        : 'Не удалось переключиться. Обновите страницу и повторите.',
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
              <AvatarVisual avatarDataUrl={effectiveAvatarUrl} initials={initials} />
            </span>
            <span className="portal-user-copy">
              <strong>{session.user.displayName}</strong>
              <small>{activeWorkspace?.title ?? 'Личные проекты'}</small>
            </span>
          </summary>
          <div className="portal-account-menu" aria-label="Центр аккаунта">
            <div className="portal-account-profile-row">
              <button
                type="button"
                className="portal-account-profile-avatar"
                aria-label="Открыть выбор аватара"
                title="Выбрать или загрузить аватар"
                disabled={busy !== null}
                onClick={() => navigateFromAccount('account')}
              >
                <AvatarVisual avatarDataUrl={effectiveAvatarUrl} initials={initials} />
                <span className="portal-account-avatar-edit" aria-hidden="true">
                  <PlusIcon />
                </span>
              </button>
              <button
                type="button"
                className="portal-account-identity"
                onClick={() => navigateFromAccount('account')}
              >
                <strong>{session.user.displayName}</strong>
                <span>{session.user.email}</span>
              </button>
            </div>

            <div className="portal-account-group">
              <button
                type="button"
                className="portal-account-item"
                onClick={() => {
                  closeAccountMenu();
                  onCreate();
                }}
              >
                <span className="portal-account-item-icon" aria-hidden="true">
                  <PlusIcon />
                </span>
                <span>Новый проект</span>
              </button>
              <button
                type="button"
                className="portal-account-item"
                onClick={() => navigateFromAccount('projects')}
              >
                <span className="portal-account-item-icon" aria-hidden="true">
                  <ProjectsGlyph />
                </span>
                <span>Мои проекты</span>
              </button>
              <div
                className="portal-account-item portal-account-notifications"
                aria-label="Уведомления: новых нет"
              >
                <span className="portal-account-item-icon" aria-hidden="true">
                  <BellGlyph />
                </span>
                <span>Уведомления</span>
                <span className="portal-account-item-meta">Нет новых</span>
              </div>
              {/* A seat has settings too — fewer of them. It owns its picture,
                  which is the one thing about themselves a learner should not
                  have to ask a teacher for. */}
              <button
                type="button"
                className="portal-account-item"
                onClick={() => navigateFromAccount('account')}
              >
                <span className="portal-account-item-icon" aria-hidden="true">
                  <SettingsGlyph />
                </span>
                <span>Настройки</span>
              </button>
            </div>

            {seatLearner ? null : (
              <div className="portal-account-group">
                <button
                  type="button"
                  className="portal-account-item"
                  onClick={() => navigateFromAccount('classes')}
                >
                  <span className="portal-account-item-icon" aria-hidden="true">
                    <ClassesGlyph />
                  </span>
                  <span>Мои классы</span>
                </button>
              </div>
            )}

            {/* A seat belongs to one class and has nowhere to switch to. */}
            <div className="portal-account-group" hidden={seatLearner}>
              <details className="portal-account-workspaces">
                <summary className="portal-account-item">
                  <span className="portal-account-item-icon" aria-hidden="true">
                    <SchoolGlyph />
                  </span>
                  <span className="portal-account-workspace-copy">
                    <strong>Аккаунт и школы</strong>
                    <small>{activeWorkspace?.title ?? 'Личные проекты'}</small>
                  </span>
                  <ChevronIcon className="portal-account-chevron" aria-hidden="true" />
                </summary>
                <div className="portal-account-workspace-list">
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
                          <small>
                            {workspace.kind === 'personal'
                              ? 'Личные проекты'
                              : workspace.role === 'school_admin' || workspace.role === 'owner'
                                ? 'Администратор школы'
                                : workspace.role === 'educator'
                                  ? 'Педагог'
                                  : 'Школа'}
                          </small>
                        </span>
                        <span aria-hidden="true">
                          {busy === `workspace:${workspace.workspaceId}` ? '…' : current ? '✓' : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </details>
            </div>

            <div className="portal-account-group portal-account-exit-group">
              <button
                type="button"
                className="portal-account-item portal-account-logout"
                disabled={busy !== null}
                onClick={() => void logout()}
              >
                <span className="portal-account-item-icon" aria-hidden="true">
                  <CloseIcon />
                </span>
                <span>{busy === 'logout' ? 'Выходим…' : 'Выход'}</span>
              </button>
            </div>
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
            aria-label={`Открыть меню аккаунта ${session.user.displayName}`}
            title="Открыть меню аккаунта"
            disabled={busy !== null}
            onClick={openAccountMenu}
          >
            <AvatarVisual avatarDataUrl={effectiveAvatarUrl} initials={initials} />
            <span className="portal-avatar-upload-badge" aria-hidden="true">
              <ChevronIcon />
            </span>
          </button>
          <span className="portal-sidebar-profile-copy">
            <strong>{session.user.displayName}</strong>
            <small>{activeWorkspace?.title ?? 'Личные проекты'}</small>
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
