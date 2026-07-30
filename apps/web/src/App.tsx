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
import { PortalHeader, type PortalSection } from './components/PortalHeader';
import { AsaLabWordmark } from './brand/AsaLabBrand';
import { ModuleEditorHost } from './modules/ModuleEditorHost';
import './brand/brand.css';
import './electronics/portal.css';
import './modules/project-hub.css';
import './account.css';

type SessionState =
  | { kind: 'checking' }
  | { kind: 'anonymous' }
  | { kind: 'authenticated'; session: SessionPayload }
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

type View =
  | { kind: 'my-projects' }
  | { kind: 'classrooms' }
  | { kind: 'account' }
  | { kind: 'classroom-projects'; classroomId: string; classroomTitle: string }
  | {
      kind: 'editor';
      projectId: string;
      returnTo:
        | { kind: 'my-projects' }
        | { kind: 'classroom-projects'; classroomId: string; classroomTitle: string };
    };

function viewToHash(view: View): string {
  if (view.kind === 'my-projects') return '#/projects';
  if (view.kind === 'classrooms') return '#/classrooms';
  if (view.kind === 'account') return '#/account';
  if (view.kind === 'classroom-projects') {
    return `#/classrooms/${view.classroomId}/projects?title=${encodeURIComponent(view.classroomTitle)}`;
  }
  if (view.returnTo.kind === 'classroom-projects') {
    return `#/classrooms/${view.returnTo.classroomId}/projects/${view.projectId}?title=${encodeURIComponent(view.returnTo.classroomTitle)}`;
  }
  return `#/projects/${view.projectId}`;
}

function viewFromHash(): View {
  const raw = window.location.hash.replace(/^#/, '');
  const [path, query] = raw.split('?');
  const title = new URLSearchParams(query ?? '').get('title') ?? 'Класс';
  const classEditor = /^\/classrooms\/([^/]+)\/projects\/([^/]+)$/.exec(path ?? '');
  if (classEditor) {
    return {
      kind: 'editor',
      projectId: classEditor[2] as string,
      returnTo: {
        kind: 'classroom-projects',
        classroomId: classEditor[1] as string,
        classroomTitle: title,
      },
    };
  }
  const classProjects = /^\/classrooms\/([^/]+)\/projects$/.exec(path ?? '');
  if (classProjects) {
    return {
      kind: 'classroom-projects',
      classroomId: classProjects[1] as string,
      classroomTitle: title,
    };
  }
  const personalEditor = /^\/projects\/([^/]+)$/.exec(path ?? '');
  if (personalEditor) {
    return {
      kind: 'editor',
      projectId: personalEditor[1] as string,
      returnTo: { kind: 'my-projects' },
    };
  }
  if (path === '/classrooms') return { kind: 'classrooms' };
  if (path === '/account') return { kind: 'account' };
  return { kind: 'my-projects' };
}

export function App(): JSX.Element {
  const [session, setSession] = useState<SessionState>({ kind: 'checking' });
  const [publicView, setPublicViewState] = useState<PublicView>(() => publicViewFromHash());
  const [view, setViewState] = useState<View>(() => viewFromHash());

  const setView = useCallback((next: View) => {
    setViewState(next);
    const hash = viewToHash(next);
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  }, []);

  const setPublicView = useCallback((next: PublicView) => {
    setPublicViewState(next);
    const hash = publicViewToHash(next);
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  }, []);

  useEffect(() => {
    const sync = (): void => {
      setViewState(viewFromHash());
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
      setView({ kind: 'my-projects' });
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

  const isEducator = session.session.capabilities.some(
    (entry) =>
      entry.capability === 'educator' &&
      (entry.state === 'verified' || entry.state === 'provisional'),
  );
  const canTeachHere = isEducator && session.session.activeWorkspace.kind === 'organization';

  if (view.kind === 'editor') {
    return (
      <ModuleEditorHost
        projectId={view.projectId}
        onBack={() => setView(view.returnTo)}
        user={session.session.user}
      />
    );
  }

  const active: PortalSection =
    view.kind === 'account'
      ? 'account'
      : canTeachHere && (view.kind === 'classrooms' || view.kind === 'classroom-projects')
        ? 'classes'
        : 'projects';
  return (
    <div className="portal-shell" data-build-revision={__ASA_BUILD_REVISION__}>
      <a className="skip-link" href="#main-content">
        Перейти к содержанию
      </a>
      <PortalHeader
        session={session.session}
        active={active}
        canTeach={canTeachHere}
        onNavigate={(section) => {
          if (section === 'account') setView({ kind: 'account' });
          else setView(section === 'projects' ? { kind: 'my-projects' } : { kind: 'classrooms' });
        }}
        onSessionChanged={(updated) => setSession({ kind: 'authenticated', session: updated })}
        onLoggedOut={() => {
          setSession({ kind: 'anonymous' });
          setPublicView({ kind: 'entry' });
        }}
      />
      {view.kind === 'my-projects' ||
      (!canTeachHere && (view.kind === 'classrooms' || view.kind === 'classroom-projects')) ? (
        <MyProjectsPage
          onOpenProject={(projectId) =>
            setView({ kind: 'editor', projectId, returnTo: { kind: 'my-projects' } })
          }
        />
      ) : null}
      {view.kind === 'classrooms' && canTeachHere ? (
        <DashboardPage
          onOpenProjects={(classroomId, classroomTitle) =>
            setView({ kind: 'classroom-projects', classroomId, classroomTitle })
          }
        />
      ) : null}
      {view.kind === 'classroom-projects' && canTeachHere ? (
        <ProjectsPage
          classroomId={view.classroomId}
          classroomTitle={view.classroomTitle}
          onBack={() => setView({ kind: 'classrooms' })}
          onOpenProject={(projectId) => setView({ kind: 'editor', projectId, returnTo: view })}
        />
      ) : null}
      {view.kind === 'account' ? (
        <AccountPage
          session={session.session}
          onSessionChanged={(updated) => setSession({ kind: 'authenticated', session: updated })}
        />
      ) : null}
    </div>
  );
}
