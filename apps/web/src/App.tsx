import { useCallback, useEffect, useState } from 'react';
import { api, type SessionPayload } from './api';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { OrganizationLoginPage } from './pages/OrganizationLoginPage';
import { JoinClassPage } from './pages/JoinClassPage';
import { PublicEntryPage, type PublicIntent } from './pages/PublicEntryPage';
import { DashboardPage } from './pages/DashboardPage';
import { MyProjectsPage } from './pages/MyProjectsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { AccountPage } from './pages/AccountPage';
import { CreatorHomePage } from './pages/CreatorHomePage';
import { CreatorResourcePage } from './pages/CreatorResourcePage';
import { PortalHeader } from './components/PortalHeader';
import { CreateProjectModal } from './components/CreateProjectModal';
import { AsaLabWordmark } from './brand/AsaLabBrand';
import { ModuleEditorHost } from './modules/ModuleEditorHost';
import {
  canUseClasses,
  creatorViewFromHash,
  creatorViewToHash,
  sectionForView,
  type CreatorPortalSection,
  type CreatorPortalView,
} from './creator-portal/navigation';
import './brand/brand.css';
import './electronics/portal.css';
import './modules/project-hub.css';
import './modules/classroom-hub.css';
import './account.css';
import './creator-portal/creator-portal.css';

type SessionState =
  | { kind: 'checking' }
  | { kind: 'anonymous' }
  | { kind: 'authenticated'; session: SessionPayload }
  | { kind: 'error' };

type ClassroomSwitchState =
  | { kind: 'idle' }
  | { kind: 'switching'; workspaceTitle: string }
  | { kind: 'error'; message: string };

type PublicView =
  | { kind: 'entry' }
  | { kind: 'sign-in' }
  | { kind: 'sign-up' }
  | { kind: 'join-class' }
  | { kind: 'organization-sign-in' };

const PUBLIC_ROUTES: { readonly path: string; readonly view: PublicView }[] = [
  { path: '/sign-in', view: { kind: 'sign-in' } },
  { path: '/sign-up', view: { kind: 'sign-up' } },
  { path: '/join-class', view: { kind: 'join-class' } },
  { path: '/organization-sign-in', view: { kind: 'organization-sign-in' } },
];

function publicViewToHash(view: PublicView): string {
  return `#${PUBLIC_ROUTES.find((route) => route.view.kind === view.kind)?.path ?? '/'}`;
}

function publicViewFromHash(): PublicView {
  const path = window.location.hash.replace(/^#/, '').split('?')[0] ?? '';
  return PUBLIC_ROUTES.find((route) => route.path === path)?.view ?? { kind: 'entry' };
}

export function App(): JSX.Element {
  const [session, setSession] = useState<SessionState>({ kind: 'checking' });
  const [publicView, setPublicViewState] = useState<PublicView>(() => publicViewFromHash());
  const [view, setViewState] = useState<CreatorPortalView>(() =>
    creatorViewFromHash(window.location.hash),
  );
  const [shellCreating, setShellCreating] = useState(false);
  const [classroomSwitch, setClassroomSwitch] = useState<ClassroomSwitchState>({ kind: 'idle' });

  const setView = useCallback((next: CreatorPortalView) => {
    setViewState(next);
    const hash = creatorViewToHash(next);
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  }, []);

  const setPublicView = useCallback((next: PublicView) => {
    setPublicViewState(next);
    const hash = publicViewToHash(next);
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  }, []);

  useEffect(() => {
    const sync = (): void => {
      setViewState(creatorViewFromHash(window.location.hash));
      setPublicViewState(publicViewFromHash());
    };
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);

  const checkSession = useCallback(async () => {
    setSession({ kind: 'checking' });
    const result = await api.me();
    if (result.ok) {
      setSession(
        result.data.authenticated
          ? { kind: 'authenticated', session: result.data }
          : { kind: 'anonymous' },
      );
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
          <h1 className="brand-heading">
            <AsaLabWordmark />
          </h1>
          <p>Не удалось проверить активную сессию.</p>
          <button type="button" className="btn-primary" onClick={() => void checkSession()}>
            Повторить
          </button>
        </section>
      </main>
    );
  }
  if (session.kind === 'anonymous') {
    const signedIn = (payload: SessionPayload): void => {
      setSession({ kind: 'authenticated', session: payload });
      setView({ kind: 'home' });
    };

    if (publicView.kind === 'sign-up') {
      return (
        <RegisterPage
          onRegistered={signedIn}
          onBackToLogin={() => setPublicView({ kind: 'sign-in' })}
        />
      );
    }
    if (publicView.kind === 'join-class') {
      return <JoinClassPage onBack={() => setPublicView({ kind: 'entry' })} />;
    }
    if (publicView.kind === 'organization-sign-in') {
      return (
        <OrganizationLoginPage
          onSignedIn={signedIn}
          onBack={() => setPublicView({ kind: 'sign-in' })}
        />
      );
    }
    if (publicView.kind === 'sign-in') {
      return (
        <LoginPage
          onSignedIn={signedIn}
          onCreateAccount={() => setPublicView({ kind: 'sign-up' })}
          onOrganizationLogin={() => setPublicView({ kind: 'organization-sign-in' })}
          onBack={() => setPublicView({ kind: 'entry' })}
        />
      );
    }
    return (
      <PublicEntryPage
        onChoose={(intent: PublicIntent) => {
          if (intent === 'sign-up') setPublicView({ kind: 'sign-up' });
          else if (intent === 'class-code') setPublicView({ kind: 'join-class' });
          else setPublicView({ kind: 'sign-in' });
        }}
      />
    );
  }

  const hasTeachingCapability = session.session.capabilities.some(
    (entry) =>
      entry.capability === 'educator' &&
      (entry.state === 'verified' || entry.state === 'provisional'),
  );
  const classroomWorkspaces = session.session.workspaces.filter(
    (workspace) =>
      workspace.kind === 'organization' &&
      ['owner', 'educator', 'school_admin'].includes(workspace.role),
  );
  const canTeachHere = canUseClasses(
    session.session.navigation,
    session.session.activeWorkspace.kind,
  );
  const canManageClasses = canTeachHere && session.session.navigation.classroomManagement;

  if (view.kind === 'editor') {
    return (
      <ModuleEditorHost
        projectId={view.projectId}
        onBack={() => setView(view.returnTo)}
        returnTo={view.returnTo}
        user={session.session.user}
      />
    );
  }

  const active = sectionForView(view, hasTeachingCapability);

  const switchToClassroomWorkspace = async (workspaceId: string, workspaceTitle: string) => {
    if (workspaceId === session.session.activeWorkspace.workspaceId) return;
    setClassroomSwitch({ kind: 'switching', workspaceTitle });
    const switched = await api.switchWorkspace(workspaceId);
    const refreshed = switched.ok ? await api.me() : null;
    if (
      refreshed?.ok &&
      refreshed.data.authenticated &&
      refreshed.data.activeWorkspace.workspaceId === workspaceId
    ) {
      setSession({ kind: 'authenticated', session: refreshed.data });
      setClassroomSwitch({ kind: 'idle' });
      setView({ kind: 'classrooms' });
      return;
    }
    setClassroomSwitch({
      kind: 'error',
      message: 'Не удалось открыть пространство школы. Обновите страницу и повторите.',
    });
  };

  const navigate = (section: CreatorPortalSection): void => {
    if (section === 'home') setView({ kind: 'home' });
    else if (section === 'projects') setView({ kind: 'my-projects' });
    else if (section === 'learning') setView({ kind: 'learning' });
    else if (section === 'collections') setView({ kind: 'collections' });
    else if (section === 'challenges') setView({ kind: 'challenges' });
    else if (section === 'classes') {
      setView({ kind: 'classrooms' });
      const onlyWorkspace = classroomWorkspaces.length === 1 ? classroomWorkspaces[0] : undefined;
      if (
        hasTeachingCapability &&
        session.session.activeWorkspace.kind !== 'organization' &&
        onlyWorkspace
      ) {
        void switchToClassroomWorkspace(onlyWorkspace.workspaceId, onlyWorkspace.title);
      }
    } else if (section === 'help') setView({ kind: 'help' });
    else setView({ kind: 'account' });
  };

  return (
    <div className="portal-shell" data-build-revision={__ASA_BUILD_REVISION__}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Перейти к содержанию
      </a>
      <PortalHeader
        session={session.session}
        active={active}
        canTeach={hasTeachingCapability}
        onNavigate={navigate}
        onSessionChanged={(updated) => setSession({ kind: 'authenticated', session: updated })}
        onLoggedOut={() => {
          setSession({ kind: 'anonymous' });
          setPublicView({ kind: 'entry' });
        }}
        onCreate={() => setShellCreating(true)}
      />
      {view.kind === 'home' ? (
        <CreatorHomePage
          session={session.session}
          canTeach={canTeachHere}
          onNavigate={navigate}
          onOpenProject={(projectId) =>
            setView({ kind: 'editor', projectId, returnTo: { kind: 'home' } })
          }
        />
      ) : null}
      {view.kind === 'my-projects' ? (
        <MyProjectsPage
          onOpenProject={(projectId) =>
            setView({ kind: 'editor', projectId, returnTo: { kind: 'my-projects' } })
          }
        />
      ) : null}
      {view.kind === 'learning' ||
      view.kind === 'collections' ||
      view.kind === 'challenges' ||
      view.kind === 'help' ? (
        <CreatorResourcePage section={view.kind} onNavigate={navigate} />
      ) : null}
      {view.kind === 'classrooms' && canManageClasses ? (
        <DashboardPage
          onOpenProjects={(classroomId, classroomTitle) =>
            setView({ kind: 'classroom-projects', classroomId, classroomTitle })
          }
        />
      ) : null}
      {view.kind === 'classroom-projects' && canManageClasses ? (
        <ProjectsPage
          classroomId={view.classroomId}
          classroomTitle={view.classroomTitle}
          onBack={() => setView({ kind: 'classrooms' })}
          onOpenProject={(projectId) => setView({ kind: 'editor', projectId, returnTo: view })}
        />
      ) : null}
      {hasTeachingCapability &&
      !canManageClasses &&
      (view.kind === 'classrooms' || view.kind === 'classroom-projects') ? (
        <main className="portal-content" id="main-content" tabIndex={-1}>
          <section className="creator-access-message">
            <p className="portal-eyebrow">Классы</p>
            <h1>
              {classroomSwitch.kind === 'switching'
                ? `Открываем классы «${classroomSwitch.workspaceTitle}»`
                : 'Вы вошли как педагог'}
            </h1>
            <p>Подтверждение email для работы с классами не требуется.</p>
            {classroomWorkspaces.length > 0 ? (
              <>
                <p>
                  Управление учениками и заданиями находится в пространстве школы. Выберите его —
                  аккаунт и все личные проекты сохранятся.
                </p>
                {classroomWorkspaces.map((workspace) => (
                  <button
                    key={workspace.workspaceId}
                    type="button"
                    className="btn-secondary"
                    disabled={classroomSwitch.kind === 'switching'}
                    onClick={() =>
                      void switchToClassroomWorkspace(workspace.workspaceId, workspace.title)
                    }
                  >
                    {classroomSwitch.kind === 'switching'
                      ? 'Открываем…'
                      : `Перейти к классам: ${workspace.title}`}
                  </button>
                ))}
              </>
            ) : (
              <p>
                Режим педагога включён, но к аккаунту ещё не подключено пространство школы. Именно
                школьное пространство, а не подтверждение почты, необходимо для создания классов.
              </p>
            )}
            {classroomSwitch.kind === 'error' ? (
              <p className="notice-error" role="alert">
                {classroomSwitch.message}
              </p>
            ) : null}
            <button type="button" className="btn-ghost" onClick={() => navigate('account')}>
              Открыть настройки аккаунта
            </button>
          </section>
        </main>
      ) : null}
      {!hasTeachingCapability &&
      (view.kind === 'classrooms' || view.kind === 'classroom-projects') ? (
        <main className="portal-content" id="main-content" tabIndex={-1}>
          <section className="creator-access-message">
            <p className="portal-eyebrow">Классы</p>
            <h1>Email не блокирует доступ к классам</h1>
            <p>
              Проверка почты пока не подключена и не является условием доступа. Чтобы создавать
              собственные классы, включите режим педагога и подключите пространство школы.
            </p>
            <button type="button" className="btn-secondary" onClick={() => navigate('account')}>
              Открыть настройки аккаунта
            </button>
          </section>
        </main>
      ) : null}
      {view.kind === 'account' ? (
        <AccountPage
          session={session.session}
          onSessionChanged={(updated) => setSession({ kind: 'authenticated', session: updated })}
        />
      ) : null}
      {shellCreating ? (
        <CreateProjectModal
          scope="personal"
          onClose={() => setShellCreating(false)}
          onCreated={(project) => {
            setShellCreating(false);
            setView({ kind: 'editor', projectId: project.id, returnTo: { kind: 'my-projects' } });
          }}
        />
      ) : null}
    </div>
  );
}
