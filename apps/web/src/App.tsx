import { useCallback, useEffect, useState } from 'react';
import { api, type PublicUser } from './api';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardPage } from './pages/DashboardPage';
import { MyProjectsPage } from './pages/MyProjectsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { PortalHeader, type PortalSection } from './components/PortalHeader';
import { ModuleEditorHost } from './modules/ModuleEditorHost';
import './brand/brand.css';
import './electronics/portal.css';
import './modules/project-hub.css';

type SessionState =
  | { kind: 'checking' }
  | { kind: 'anonymous' }
  | { kind: 'authenticated'; user: PublicUser }
  | { kind: 'error' };

type View =
  | { kind: 'my-projects' }
  | { kind: 'classrooms' }
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
  return { kind: 'my-projects' };
}

export function App(): JSX.Element {
  const [session, setSession] = useState<SessionState>({ kind: 'checking' });
  const [registering, setRegistering] = useState(false);
  const [view, setViewState] = useState<View>(() => viewFromHash());

  const setView = useCallback((next: View) => {
    setViewState(next);
    const hash = viewToHash(next);
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  }, []);

  useEffect(() => {
    const sync = (): void => setViewState(viewFromHash());
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
    if (result.ok) setSession({ kind: 'authenticated', user: result.data.user });
    else if (result.status === 401) setSession({ kind: 'anonymous' });
    else setSession({ kind: 'error' });
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
    if (registering) {
      return (
        <RegisterPage
          onRegistered={() => {
            setRegistering(false);
            setView({ kind: 'my-projects' });
            void checkSession();
          }}
          onBackToLogin={() => setRegistering(false)}
        />
      );
    }
    return (
      <LoginPage
        onCreateAccount={() => setRegistering(true)}
        onLoggedIn={(user) => {
          setSession({ kind: 'authenticated', user });
          setView({ kind: 'my-projects' });
        }}
      />
    );
  }

  if (view.kind === 'editor') {
    return (
      <ModuleEditorHost
        projectId={view.projectId}
        onBack={() => setView(view.returnTo)}
        user={session.user}
      />
    );
  }

  const active: PortalSection =
    view.kind === 'classrooms' || view.kind === 'classroom-projects' ? 'classes' : 'projects';
  return (
    <div className="portal-shell">
      <a className="skip-link" href="#main-content">
        Перейти к содержанию
      </a>
      <PortalHeader
        user={session.user}
        active={active}
        onNavigate={(section) =>
          setView(section === 'projects' ? { kind: 'my-projects' } : { kind: 'classrooms' })
        }
        onLoggedOut={() => {
          setView({ kind: 'my-projects' });
          setSession({ kind: 'anonymous' });
        }}
      />
      {view.kind === 'my-projects' ? (
        <MyProjectsPage
          onOpenProject={(projectId) =>
            setView({ kind: 'editor', projectId, returnTo: { kind: 'my-projects' } })
          }
        />
      ) : null}
      {view.kind === 'classrooms' ? (
        <DashboardPage
          onOpenProjects={(classroomId, classroomTitle) =>
            setView({ kind: 'classroom-projects', classroomId, classroomTitle })
          }
        />
      ) : null}
      {view.kind === 'classroom-projects' ? (
        <ProjectsPage
          classroomId={view.classroomId}
          classroomTitle={view.classroomTitle}
          onBack={() => setView({ kind: 'classrooms' })}
          onOpenProject={(projectId) => setView({ kind: 'editor', projectId, returnTo: view })}
        />
      ) : null}
    </div>
  );
}
