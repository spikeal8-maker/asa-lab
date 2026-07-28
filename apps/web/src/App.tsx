import { useCallback, useEffect, useState } from 'react';
import { api, type ClassroomPreview, type SessionPayload } from './api';
import { LoginPage } from './pages/LoginPage';
import { OrganizationLoginPage } from './pages/OrganizationLoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { PublicEntryPage, type PublicIntent } from './pages/PublicEntryPage';
import { JoinClassPage } from './pages/JoinClassPage';
import { JoinPendingPage } from './pages/JoinPendingPage';
import { NextStagePage } from './pages/NextStagePage';
import { forgetJoinIntent, readJoinIntent, rememberJoinIntent } from './join-intent';
import { DashboardPage } from './pages/DashboardPage';
import { MyProjectsPage } from './pages/MyProjectsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { PortalHeader, type PortalSection } from './components/PortalHeader';
import { AsaLabWordmark } from './brand/AsaLabBrand';
import { ModuleEditorHost } from './modules/ModuleEditorHost';
import './brand/brand.css';
import './electronics/portal.css';
import './modules/project-hub.css';

type SessionState =
  | { kind: 'checking' }
  | { kind: 'anonymous' }
  | { kind: 'authenticated'; session: SessionPayload }
  | { kind: 'error' };

/**
 * Public screens before a session exists.
 *
 * Each of the three intentions goes straight to the screen that serves it, and
 * each one is a real address: `#/sign-in`, `#/sign-up`, `#/join-class` survive
 * a refresh and answer to Back and Forward like any other page.
 */
type PublicView =
  | { kind: 'entry' }
  | { kind: 'login' }
  | { kind: 'organization-login' }
  | { kind: 'register' }
  | { kind: 'join-class' }
  | { kind: 'next-stage'; title: string; explanation: string };

const PUBLIC_ROUTES: { readonly path: string; readonly view: PublicView }[] = [
  { path: '/sign-in', view: { kind: 'login' } },
  { path: '/sign-up', view: { kind: 'register' } },
  { path: '/join-class', view: { kind: 'join-class' } },
  { path: '/organization-sign-in', view: { kind: 'organization-login' } },
];

function publicViewToHash(view: PublicView): string {
  const match = PUBLIC_ROUTES.find((route) => route.view.kind === view.kind);
  return match ? `#${match.path}` : '#/';
}

function publicViewFromHash(): PublicView {
  const path = window.location.hash.replace(/^#/, '').split('?')[0] ?? '';
  return PUBLIC_ROUTES.find((route) => route.path === path)?.view ?? { kind: 'entry' };
}

const STUDENT_ACCOUNT_STAGE = {
  title: 'Ученический аккаунт — следующий этап',
  explanation:
    'Постоянный аккаунт ученика с Safe Mode и подтверждением родителя или педагога готовится. Пока в класс заходят по коду и имени, которые выдаёт педагог.',
} as const;

function seatStage(preview: ClassroomPreview): { title: string; explanation: string } {
  return {
    title: 'Вход по имени от педагога',
    explanation: `Класс «${preview.title}» найден. Вход по выданному педагогом имени появится вместе с ученическими местами; пока в класс заходят через педагога.`,
  };
}

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
  const [publicViewState, setPublicViewState] = useState<PublicView>(() => publicViewFromHash());
  const [view, setViewState] = useState<View>(() => viewFromHash());
  // Survives sign-in and refresh, so a resolved class is never silently lost.
  const [joinIntent, setJoinIntent] = useState(() => readJoinIntent());

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
    if (result.ok) setSession({ kind: 'authenticated', session: result.data });
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
    const publicView = publicViewState;
    const signedIn = (payload: SessionPayload): void => {
      setSession({ kind: 'authenticated', session: payload });
      // The pending class, if any, is answered by the authenticated branch.
      setPublicView({ kind: 'entry' });
      setView({ kind: 'my-projects' });
    };

    if (publicView.kind === 'entry') {
      return (
        <PublicEntryPage
          onChoose={(intent: PublicIntent) => {
            if (intent === 'sign-up') setPublicView({ kind: 'register' });
            else if (intent === 'class-code') setPublicView({ kind: 'join-class' });
            else setPublicView({ kind: 'login' });
          }}
        />
      );
    }
    if (publicView.kind === 'join-class') {
      return (
        <JoinClassPage
          onBack={() => setPublicView({ kind: 'entry' })}
          onAccountPath={(preview) => {
            rememberJoinIntent(preview);
            setJoinIntent(readJoinIntent());
            setPublicView({ kind: 'login' });
          }}
          onHandlePath={(preview) => setPublicView({ kind: 'next-stage', ...seatStage(preview) })}
        />
      );
    }
    if (publicView.kind === 'organization-login') {
      return (
        <OrganizationLoginPage
          onSignedIn={signedIn}
          onBack={() => setPublicView({ kind: 'login' })}
        />
      );
    }
    if (publicView.kind === 'register') {
      return (
        <RegisterPage
          onRegistered={() => {
            setPublicView({ kind: 'entry' });
            setView({ kind: 'my-projects' });
            void checkSession();
          }}
          onBack={() => setPublicView({ kind: 'entry' })}
          onBackToLogin={() => setPublicView({ kind: 'login' })}
          onClassCode={() => setPublicView({ kind: 'join-class' })}
          onStudentNextStage={() => setPublicView({ kind: 'next-stage', ...STUDENT_ACCOUNT_STAGE })}
        />
      );
    }
    if (publicView.kind === 'next-stage') {
      return (
        <NextStagePage
          title={publicView.title}
          explanation={publicView.explanation}
          onSignIn={() => setPublicView({ kind: 'login' })}
          onBack={() => setPublicView({ kind: 'entry' })}
        />
      );
    }
    return (
      <LoginPage
        onSignedIn={signedIn}
        onCreateAccount={() => setPublicView({ kind: 'register' })}
        onClassCode={() => setPublicView({ kind: 'join-class' })}
        onOrganizationLogin={() => setPublicView({ kind: 'organization-login' })}
        onBack={() => setPublicView({ kind: 'entry' })}
        {...(joinIntent === null
          ? {}
          : { intro: `После входа мы вернёмся к классу «${joinIntent.title}».` })}
      />
    );
  }

  // A class was resolved before signing in: answer it before anything else,
  // and say plainly that joining is not built yet instead of pretending.
  if (joinIntent !== null) {
    return (
      <JoinPendingPage
        intent={joinIntent}
        onContinue={() => {
          forgetJoinIntent();
          setJoinIntent(null);
          setView({ kind: 'my-projects' });
        }}
      />
    );
  }

  const canTeach = session.session.capabilities.some(
    (entry) =>
      entry.capability === 'educator' &&
      (entry.state === 'verified' || entry.state === 'provisional'),
  );

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
    canTeach && (view.kind === 'classrooms' || view.kind === 'classroom-projects')
      ? 'classes'
      : 'projects';
  return (
    <div className="portal-shell">
      <a className="skip-link" href="#main-content">
        Перейти к содержанию
      </a>
      <PortalHeader
        user={session.session.user}
        active={active}
        canTeach={canTeach}
        onNavigate={(section) =>
          setView(section === 'projects' ? { kind: 'my-projects' } : { kind: 'classrooms' })
        }
        onLoggedOut={() => {
          setView({ kind: 'my-projects' });
          setSession({ kind: 'anonymous' });
        }}
      />
      {view.kind === 'my-projects' || !canTeach ? (
        <MyProjectsPage
          onOpenProject={(projectId) =>
            setView({ kind: 'editor', projectId, returnTo: { kind: 'my-projects' } })
          }
        />
      ) : null}
      {view.kind === 'classrooms' && canTeach ? (
        <DashboardPage
          onOpenProjects={(classroomId, classroomTitle) =>
            setView({ kind: 'classroom-projects', classroomId, classroomTitle })
          }
        />
      ) : null}
      {view.kind === 'classroom-projects' && canTeach ? (
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
