import { useCallback, useEffect, useState } from 'react';
import { api, type PublicUser } from './api';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SchematicEditor } from './pages/SchematicEditor';

type SessionState =
  | { kind: 'checking' }
  | { kind: 'anonymous' }
  | { kind: 'authenticated'; user: PublicUser }
  | { kind: 'error' };

type View =
  | { kind: 'classrooms' }
  | { kind: 'projects'; classroomId: string; classroomTitle: string }
  | { kind: 'editor'; classroomId: string; classroomTitle: string; projectId: string };

/** The current view lives in the URL hash so a reload reopens the same screen
 * — a teacher who refreshes the editor must land back on the schematic. */
function viewToHash(view: View): string {
  if (view.kind === 'projects') {
    return `#/classrooms/${view.classroomId}/projects?title=${encodeURIComponent(view.classroomTitle)}`;
  }
  if (view.kind === 'editor') {
    return `#/classrooms/${view.classroomId}/projects/${view.projectId}?title=${encodeURIComponent(view.classroomTitle)}`;
  }
  return '#/classrooms';
}

function viewFromHash(): View {
  const raw = window.location.hash.replace(/^#/, '');
  const [path, query] = raw.split('?');
  const title = new URLSearchParams(query ?? '').get('title') ?? 'Класс';
  const projects = /^\/classrooms\/([^/]+)\/projects$/.exec(path ?? '');
  if (projects) {
    return { kind: 'projects', classroomId: projects[1] as string, classroomTitle: title };
  }
  const editor = /^\/classrooms\/([^/]+)\/projects\/([^/]+)$/.exec(path ?? '');
  if (editor) {
    return {
      kind: 'editor',
      classroomId: editor[1] as string,
      classroomTitle: title,
      projectId: editor[2] as string,
    };
  }
  return { kind: 'classrooms' };
}

export function App(): JSX.Element {
  const [session, setSession] = useState<SessionState>({ kind: 'checking' });
  const [view, setViewState] = useState<View>(() => viewFromHash());

  const setView = useCallback((next: View) => {
    setViewState(next);
    const hash = viewToHash(next);
    if (window.location.hash !== hash) {
      window.history.pushState(null, '', hash);
    }
  }, []);

  useEffect(() => {
    const onPopState = (): void => setViewState(viewFromHash());
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onPopState);
    };
  }, []);

  const checkSession = useCallback(async () => {
    setSession({ kind: 'checking' });
    const result = await api.me();
    if (result.ok) {
      setSession({ kind: 'authenticated', user: result.data.user });
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
    return <LoginPage onLoggedIn={(user) => setSession({ kind: 'authenticated', user })} />;
  }

  if (view.kind === 'projects') {
    return (
      <ProjectsPage
        classroomId={view.classroomId}
        classroomTitle={view.classroomTitle}
        onBack={() => setView({ kind: 'classrooms' })}
        onOpenProject={(projectId) => setView({ ...view, kind: 'editor', projectId })}
      />
    );
  }

  if (view.kind === 'editor') {
    return (
      <SchematicEditor
        projectId={view.projectId}
        onBack={() =>
          setView({
            kind: 'projects',
            classroomId: view.classroomId,
            classroomTitle: view.classroomTitle,
          })
        }
      />
    );
  }

  return (
    <DashboardPage
      user={session.user}
      onLoggedOut={() => {
        setView({ kind: 'classrooms' });
        setSession({ kind: 'anonymous' });
      }}
      onOpenProjects={(classroomId, classroomTitle) =>
        setView({ kind: 'projects', classroomId, classroomTitle })
      }
    />
  );
}
