import { useCallback, useEffect, useState } from 'react';
import { api, type ClassroomStudentSession, type SessionPayload } from './api';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { OrganizationLoginPage } from './pages/OrganizationLoginPage';
import { JoinClassPage } from './pages/JoinClassPage';
import { studentSessionPayload } from './creator-portal/student-session';
import { PublicEntryPage, type PublicIntent } from './pages/PublicEntryPage';
import { DashboardPage } from './pages/DashboardPage';
import { MyProjectsPage } from './pages/MyProjectsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ClassroomPage } from './pages/ClassroomPage';
import { TeacherInvitePage } from './pages/TeacherInvitePage';
import { AccountPage } from './pages/AccountPage';
import { CreatorHomePage } from './pages/CreatorHomePage';
import { CreatorResourcePage } from './pages/CreatorResourcePage';
import { PortalHeader } from './components/PortalHeader';
import { CreateProjectModal } from './components/CreateProjectModal';
import { AsaLabWordmark } from './brand/AsaLabBrand';
import { ModuleEditorHost } from './modules/ModuleEditorHost';
import {
  canUseClasses,
  creatorViewFromLocation,
  creatorViewToHref,
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
  /** Signed in with a class seat: a learner, not an account holder. */
  | { kind: 'student'; session: ClassroomStudentSession }
  | { kind: 'error' };

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
    creatorViewFromLocation(window.location),
  );
  const [pendingTeacherInvite, setPendingTeacherInvite] = useState<string | null>(() => {
    const initial = creatorViewFromLocation(window.location);
    return initial.kind === 'teacher-invite' ? initial.token : null;
  });
  const [shellCreating, setShellCreating] = useState(false);
  const [accountPanel, setAccountPanel] = useState<'profile' | 'school'>('profile');

  const setView = useCallback((next: CreatorPortalView) => {
    setViewState(next);
    const href = creatorViewToHref(next);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (current !== href) window.history.pushState(null, '', href);
  }, []);

  const handleModuleResolved = useCallback((projectId: string, moduleKey: string): void => {
    setViewState((current) => {
      if (
        current.kind !== 'editor' ||
        current.projectId !== projectId ||
        current.moduleKey === moduleKey
      ) {
        return current;
      }
      const normalized: CreatorPortalView = { ...current, moduleKey };
      if (moduleKey === 'electronics') {
        window.history.replaceState(null, '', creatorViewToHref(normalized));
      }
      return normalized;
    });
  }, []);

  const setPublicView = useCallback((next: PublicView) => {
    setPublicViewState(next);
    const hash = publicViewToHash(next);
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  }, []);

  useEffect(() => {
    const sync = (): void => {
      const nextView = creatorViewFromLocation(window.location);
      setViewState(nextView);
      if (nextView.kind === 'teacher-invite') setPendingTeacherInvite(nextView.token);
      setPublicViewState(publicViewFromHash());
    };
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);

  /**
   * A class seat is a way of being signed in, not a state of the join page.
   * Asking about it here means a learner who reloads — on any address, after
   * an editor has rewritten the one in the bar — comes back to their own work
   * instead of to the front door.
   */
  const resolveStudent = useCallback(async (): Promise<void> => {
    const seat = await api.classroomStudentMe();
    setSession(
      seat.ok && seat.data.authenticated
        ? { kind: 'student', session: seat.data }
        : { kind: 'anonymous' },
    );
  }, []);

  const checkSession = useCallback(async () => {
    setSession({ kind: 'checking' });
    const result = await api.me();
    if (result.ok) {
      if (result.data.authenticated) {
        setSession({ kind: 'authenticated', session: result.data });
      } else {
        await resolveStudent();
      }
    } else if (result.status === 401) {
      await resolveStudent();
    } else {
      setSession({ kind: 'error' });
    }
  }, [resolveStudent]);

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
      if (pendingTeacherInvite) {
        setView({ kind: 'teacher-invite', token: pendingTeacherInvite });
        return;
      }
      setView(view.kind === 'editor' ? view : { kind: 'home' });
    };

    if (view.kind === 'teacher-invite' && publicView.kind === 'entry') {
      return (
        <TeacherInvitePage
          token={view.token}
          authenticated={false}
          onSignIn={() => {
            setPendingTeacherInvite(view.token);
            setPublicView({ kind: 'sign-in' });
          }}
          onRegister={() => {
            setPendingTeacherInvite(view.token);
            setPublicView({ kind: 'sign-up' });
          }}
          onBack={() => {
            setPendingTeacherInvite(null);
            setView({ kind: 'home' });
            setPublicView({ kind: 'entry' });
          }}
        />
      );
    }

    if (publicView.kind === 'sign-up') {
      return (
        <RegisterPage
          onRegistered={signedIn}
          onBackToLogin={() => setPublicView({ kind: 'sign-in' })}
        />
      );
    }
    if (publicView.kind === 'join-class') {
      return (
        <JoinClassPage
          onBack={() => setPublicView({ kind: 'entry' })}
          onSignedIn={() => void checkSession()}
        />
      );
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

  // A learner signed in with a class seat reaches the portal through the same
  // door as everyone else: the same shell, the same pages, the same editors.
  // What a seat cannot do is expressed as capabilities it does not hold, so
  // nothing below this line has to ask which kind of person is signed in.
  const isSeatLearner = session.kind === 'student';
  const portalSession: SessionPayload =
    session.kind === 'student' ? studentSessionPayload(session.session) : session.session;

  const hasTeachingCapability = portalSession.capabilities.some(
    (entry) =>
      entry.capability === 'educator' &&
      (entry.state === 'verified' || entry.state === 'provisional'),
  );
  const canTeachHere = canUseClasses(portalSession.navigation, portalSession.activeWorkspace.kind);
  const canManageClasses = canTeachHere && portalSession.navigation.classroomManagement;

  if (view.kind === 'editor') {
    return (
      <ModuleEditorHost
        projectId={view.projectId}
        onBack={() => setView(view.returnTo)}
        onModuleResolved={handleModuleResolved}
        returnTo={view.returnTo}
        user={portalSession.user}
      />
    );
  }

  const active = sectionForView(view, hasTeachingCapability);

  const navigate = (section: CreatorPortalSection): void => {
    if (section === 'home') setView({ kind: 'home' });
    else if (section === 'projects') setView({ kind: 'my-projects' });
    else if (section === 'learning') setView({ kind: 'learning' });
    else if (section === 'collections') setView({ kind: 'collections' });
    else if (section === 'challenges') setView({ kind: 'challenges' });
    else if (section === 'classes') setView({ kind: 'classrooms' });
    else if (section === 'help') setView({ kind: 'help' });
    else {
      setAccountPanel('profile');
      setView({ kind: 'account' });
    }
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
        session={portalSession}
        active={active}
        seatLearner={isSeatLearner}
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
          session={portalSession}
          canTeach={canTeachHere}
          onNavigate={navigate}
          onOpenProject={(projectId, moduleKey) =>
            setView({ kind: 'editor', projectId, moduleKey, returnTo: { kind: 'home' } })
          }
        />
      ) : null}
      {view.kind === 'my-projects' ? (
        <MyProjectsPage
          onOpenProject={(projectId, moduleKey) =>
            setView({ kind: 'editor', projectId, moduleKey, returnTo: { kind: 'my-projects' } })
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
            setView({ kind: 'classroom', classroomId, classroomTitle })
          }
        />
      ) : null}
      {view.kind === 'classroom' && canManageClasses ? (
        <ClassroomPage
          classroomId={view.classroomId}
          onBack={() => setView({ kind: 'classrooms' })}
          onOpenProjects={(classroomTitle) =>
            setView({
              kind: 'classroom-projects',
              classroomId: view.classroomId,
              classroomTitle,
            })
          }
          onOpenProject={(projectId, moduleKey) =>
            setView({
              kind: 'editor',
              projectId,
              moduleKey,
              returnTo: { kind: 'my-projects' },
            })
          }
        />
      ) : null}
      {view.kind === 'classroom-projects' && canManageClasses ? (
        <ProjectsPage
          classroomId={view.classroomId}
          classroomTitle={view.classroomTitle}
          onBack={() => setView({ kind: 'classrooms' })}
          onOpenProject={(projectId, moduleKey) =>
            setView({ kind: 'editor', projectId, moduleKey, returnTo: view })
          }
        />
      ) : null}
      {!hasTeachingCapability &&
      (view.kind === 'classrooms' ||
        view.kind === 'classroom' ||
        view.kind === 'classroom-projects') ? (
        <main className="portal-content" id="main-content" tabIndex={-1}>
          <section className="creator-access-message">
            <p className="portal-eyebrow">Классы</p>
            <h1>Хотите вести занятия?</h1>
            <p>Выберите роль «Педагог» в профиле — после этого можно сразу создать первый класс.</p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setAccountPanel('profile');
                setView({ kind: 'account' });
              }}
            >
              Настроить профиль
            </button>
          </section>
        </main>
      ) : null}
      {view.kind === 'teacher-invite' ? (
        <TeacherInvitePage
          token={view.token}
          authenticated
          onAccepted={(classroom) => {
            setPendingTeacherInvite(null);
            setView({
              kind: 'classroom',
              classroomId: classroom.id,
              classroomTitle: classroom.title,
            });
          }}
          onBack={() => {
            setPendingTeacherInvite(null);
            setView({ kind: 'classrooms' });
          }}
          onOpenProfile={() => {
            setAccountPanel('profile');
            setView({ kind: 'account' });
          }}
        />
      ) : null}
      {/* A seat has no account to configure, so that page is never reached. */}
      {view.kind === 'account' && !isSeatLearner ? (
        <AccountPage
          session={portalSession}
          onSessionChanged={(updated) => setSession({ kind: 'authenticated', session: updated })}
          onOpenClasses={() => navigate('classes')}
          initialPanel={accountPanel}
        />
      ) : null}
      {shellCreating ? (
        <CreateProjectModal
          scope="personal"
          onClose={() => setShellCreating(false)}
          onCreated={(project) => {
            setShellCreating(false);
            setView({
              kind: 'editor',
              projectId: project.id,
              moduleKey: project.moduleKey,
              returnTo: { kind: 'my-projects' },
            });
          }}
        />
      ) : null}
    </div>
  );
}
