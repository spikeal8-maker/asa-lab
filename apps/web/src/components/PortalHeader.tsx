import { useEffect, useRef, useState } from 'react';
import { api, type SessionPayload } from '../api';
import type { AdminNavigationItem, AdminSection } from '../admin/admin-navigation';
import { AsaLabWordmark } from '../brand/AsaLabBrand';
import {
  defaultAvatarForAccount,
  PROFILE_AVATAR_CHANGED_EVENT,
} from '../creator-portal/default-avatars';
import { portalNavigation, type CreatorPortalSection } from '../creator-portal/navigation';
import { QuickCreateMenu } from '../creator-portal/QuickProjectCreation';
import { classAttention } from '../creator-portal/attention';
import { PortalLink } from './PortalLink';
import {
  ChevronIcon,
  CloseIcon,
  CollapseIcon,
  ExpandIcon,
  PlusIcon,
} from '../electronics/workbench-icons';
import {
  ChallengesGlyph,
  ClassesGlyph,
  CollectionsGlyph,
  GalleryGlyph,
  HelpGlyph,
  HomeGlyph,
  LearningGlyph,
  ProjectsGlyph,
  SchoolGlyph,
  SettingsGlyph,
} from './portal-icons';

export type PortalSection = CreatorPortalSection;
const sectionHref = (section: PortalSection): string =>
  `/#/${section === 'classes' ? 'classrooms' : section}`;

function sectionIcon(section: Exclude<PortalSection, 'account'>): JSX.Element {
  if (section === 'home') return <HomeGlyph />;
  if (section === 'classes') return <ClassesGlyph />;
  if (section === 'projects') return <ProjectsGlyph />;
  if (section === 'games') return <span className="portal-games-glyph">♟</span>;
  if (section === 'collections') return <CollectionsGlyph />;
  if (section === 'gallery') return <GalleryGlyph />;
  if (section === 'learning') return <LearningGlyph />;
  if (section === 'knowledge') return <LearningGlyph />;
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
  classroomBadge,
  seatAvatarUrl,
  unfinishedCount = 0,
  maxVerificationDue = false,
  adminNavigation,
  onNavigate,
  onSessionChanged,
  onLoggedOut,
}: {
  session: SessionPayload;
  active: PortalSection;
  canTeach: boolean;
  /** The picture a class seat chose; an account has none and uploads instead. */
  seatAvatarUrl?: string | undefined;
  /** Assignments a learner has not handed in; 0 hides the dot. */
  unfinishedCount?: number;
  /** Ненавязчивый индикатор после 24 часов без подтверждённого MAX. */
  maxVerificationDue?: boolean;
  /**
   * Signed in with a class seat. The shell is the same one everyone uses; a
   * seat simply has nowhere to go in the places an account owns — a class to
   * manage, a school to switch to, a profile to edit — so those are left out
   * rather than shown and refused.
   */
  seatLearner?: boolean;
  /** Сколько работ ждёт ответа — цифра рядом с «Классами» у преподавателя. */
  classroomBadge?: number | undefined;
  /** Shown only after the dedicated administrative endpoint confirms a grant. */
  adminNavigation?: {
    readonly active: boolean;
    readonly activeSection: AdminSection;
    readonly items: readonly AdminNavigationItem[];
    readonly onOpen: () => void;
    readonly onNavigate: (section: AdminSection) => void;
  };
  onNavigate: (section: PortalSection) => void;
  onSessionChanged: (session: SessionPayload) => void;
  onLoggedOut: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem('asa-portal-sidebar') === 'collapsed',
  );
  const accountMenu = useRef<HTMLDetailsElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const attention = classAttention(unfinishedCount, classroomBadge ?? 0);
  const go = (section: PortalSection): void => {
    setMobileOpen(false);
    onNavigate(section);
  };
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    const background = [
      ...document.querySelectorAll<HTMLElement>('.portal-shell > main, .portal-header'),
    ];
    const previousInert = background.map((element) => element.inert);
    background.forEach((element) => {
      element.inert = true;
    });
    document.body.style.overflow = 'hidden';
    sidebar.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const closeOnResize = (): void => {
      if (window.innerWidth > 820) setMobileOpen(false);
    };
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMobileOpen(false);
      if (event.key !== 'Tab') return;
      const elements = [
        ...(sidebar.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], summary',
        ) ?? []),
      ].filter((element) => element.getClientRects().length > 0);
      const first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('resize', closeOnResize);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      background.forEach((element, index) => {
        element.inert = previousInert[index] ?? false;
      });
      window.removeEventListener('resize', closeOnResize);
      document.removeEventListener('keydown', handleKey);
      menuButton.current?.focus();
    };
  }, [mobileOpen]);
  const activeWorkspace = session.workspaces.find(
    (workspace) => workspace.workspaceId === session.activeWorkspace.workspaceId,
  );
  const avatarName = session.user.displayName.replace(/\([^)]*\)/g, ' ');
  const initials =
    (avatarName.match(/[\p{L}\p{N}]+/gu) ?? [])
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase('ru-RU') ?? '')
      .join('') || 'A';
  /**
   * Whose face this is.
   *
   * An account uploads one. A class seat picks one from the built-in set, and
   * that choice has to arrive here — this used to fall straight through to the
   * automatic picture keyed by the seat id, so a learner could change their
   * avatar, see it change in settings, and watch the header keep the old one
   * forever. The teacher saw the new one, which made it look like it had worked.
   */
  const effectiveAvatarUrl =
    avatarDataUrl ?? seatAvatarUrl ?? defaultAvatarForAccount(session.user.id).src;
  const navigationItems = portalNavigation(canTeach);
  const primaryNavigation = navigationItems.filter(
    (item) => item.section !== 'help' && item.section !== 'gallery',
  );
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
        <button
          ref={menuButton}
          type="button"
          className="portal-menu-toggle"
          aria-label="Открыть меню"
          aria-description={attention ? `Классы — ${attention}` : undefined}
          aria-expanded={mobileOpen}
          aria-controls="portal-sidebar"
          onClick={() => setMobileOpen(true)}
        >
          <span aria-hidden="true">☰</span>
          {attention ? <span className="portal-attention-dot" aria-hidden="true" /> : null}
        </button>
        <button
          type="button"
          className="portal-brand"
          aria-label="ASA Lab — главная"
          onClick={() => onNavigate('home')}
        >
          <AsaLabWordmark />
        </button>
        <nav className="portal-global-nav" aria-label="Разделы ASA Lab">
          <PortalLink href={sectionHref('gallery')} onNavigate={() => onNavigate('gallery')}>
            <GalleryGlyph />
            <span>Проекты</span>
          </PortalLink>
          <PortalLink href={sectionHref('knowledge')} onNavigate={() => onNavigate('knowledge')}>
            <LearningGlyph />
            <span>Знания</span>
          </PortalLink>
        </nav>
        <QuickCreateMenu />
        <details
          ref={accountMenu}
          className={active === 'account' ? 'portal-account active' : 'portal-account'}
        >
          <summary
            aria-label={`Меню аккаунта ${session.user.displayName}`}
            aria-description={
              maxVerificationDue ? 'Подтвердите учётную запись через MAX' : undefined
            }
          >
            <span className="portal-user-avatar" aria-hidden="true">
              <AvatarVisual avatarDataUrl={effectiveAvatarUrl} initials={initials} />
              {maxVerificationDue ? <span className="portal-attention-dot" /> : null}
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
              {maxVerificationDue ? (
                <button
                  type="button"
                  className="portal-account-item portal-account-notice"
                  onClick={() => navigateFromAccount('account')}
                >
                  <span className="portal-account-item-icon" aria-hidden="true">
                    <SettingsGlyph />
                  </span>
                  <span>Подтвердить аккаунт через MAX</span>
                </button>
              ) : null}
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
              <button
                type="button"
                className="portal-account-item"
                onClick={() => navigateFromAccount('help')}
              >
                <span className="portal-account-item-icon" aria-hidden="true">
                  <HelpGlyph />
                </span>
                <span>Помощь и сообщество</span>
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
      {mobileOpen ? (
        <button
          className="portal-menu-backdrop"
          tabIndex={-1}
          aria-label="Закрыть меню"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}
      <aside
        ref={sidebar}
        id="portal-sidebar"
        className={`portal-sidebar${sidebarCollapsed ? ' collapsed' : ''}${mobileOpen ? ' mobile-open' : ''}`}
        role={mobileOpen ? 'dialog' : undefined}
        aria-modal={mobileOpen ? true : undefined}
        aria-label="Основная навигация"
      >
        <button
          type="button"
          className="portal-menu-close"
          aria-label="Закрыть меню"
          onClick={() => setMobileOpen(false)}
        >
          Закрыть <span aria-hidden="true">×</span>
        </button>
        <div className="portal-sidebar-profile">
          <div className="portal-sidebar-avatar">
            <AvatarVisual avatarDataUrl={effectiveAvatarUrl} initials={initials} />
          </div>
          <span className="portal-sidebar-profile-copy">
            <strong>{session.user.displayName}</strong>
            {/* Учащемуся под именем показываем класс, а не ссылку на смену
                аватара: аватар меняется в настройках, а лишняя строка здесь
                только занимала место. */}
            <small>{activeWorkspace?.title ?? 'Личные проекты'}</small>
          </span>
        </div>
        <nav className="portal-nav">
          <PortalLink
            href={sectionHref('gallery')}
            className="portal-nav-item portal-mobile-public"
            onNavigate={() => go('gallery')}
          >
            <span className="portal-nav-glyph">
              <GalleryGlyph />
            </span>
            <span>Проекты сообщества</span>
          </PortalLink>
          <PortalLink
            href={sectionHref('knowledge')}
            className="portal-nav-item portal-mobile-public"
            onNavigate={() => go('knowledge')}
          >
            <span className="portal-nav-glyph">
              <LearningGlyph />
            </span>
            <span>Знания</span>
          </PortalLink>
          {primaryNavigation.map((item) => (
            <PortalLink
              href={sectionHref(item.section)}
              key={item.section}
              className={active === item.section ? 'portal-nav-item active' : 'portal-nav-item'}
              aria-current={active === item.section ? 'page' : undefined}
              onNavigate={() => go(item.section)}
            >
              <span className="portal-nav-glyph" aria-hidden="true">
                {sectionIcon(item.section)}
              </span>
              <span className="portal-nav-label">{item.label}</span>
              {/* Одна и та же отметка о невыполненном: учащемуся — сколько он
                  не сдал, преподавателю — сколько работ ждёт его ответа. */}
              {item.section === 'classes' && attention ? (
                <span className="portal-section-attention">{attention}</span>
              ) : null}
            </PortalLink>
          ))}
          {adminNavigation ? (
            <div className="portal-admin-navigation">
              <button
                type="button"
                data-admin-navigation="true"
                className={adminNavigation.active ? 'portal-nav-item active' : 'portal-nav-item'}
                aria-expanded={adminNavigation.active}
                onClick={() => {
                  setMobileOpen(false);
                  adminNavigation.onOpen();
                }}
              >
                <span className="portal-nav-glyph" aria-hidden="true">
                  <SchoolGlyph />
                </span>
                <span className="portal-nav-label">Админ</span>
              </button>
              {adminNavigation.active ? (
                <div className="portal-admin-subnav" aria-label="Разделы администрирования">
                  {adminNavigation.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={
                        adminNavigation.activeSection === item.id
                          ? 'portal-admin-subnav-item active'
                          : 'portal-admin-subnav-item'
                      }
                      aria-current={adminNavigation.activeSection === item.id ? 'page' : undefined}
                      onClick={() => {
                        setMobileOpen(false);
                        adminNavigation.onNavigate(item.id);
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </nav>
        <div className="portal-mobile-account">
          <button type="button" className="portal-nav-item" onClick={() => go('account')}>
            Настройки
          </button>
          <button
            type="button"
            className="portal-nav-item"
            disabled={busy !== null}
            onClick={() => void logout()}
          >
            Выход
          </button>
        </div>
        {helpNavigation ? (
          <div className="portal-sidebar-footer">
            <button
              type="button"
              className={active === 'help' ? 'portal-nav-item active' : 'portal-nav-item'}
              aria-current={active === 'help' ? 'page' : undefined}
              onClick={() => go('help')}
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
