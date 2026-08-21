import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type ClassroomStudentSession, type SessionPayload } from './api';
import { LoginPage } from './pages/LoginPage';
import { MaxLinkPage } from './pages/MaxLinkPage';
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
import { SeatAccountPage } from './pages/SeatAccountPage';
import { SeatClassPage } from './pages/SeatClassPage';
import { CreatorHomePage } from './pages/CreatorHomePage';
import { AttendedClassesPage } from './pages/AttendedClassesPage';
import { CreatorResourcePage } from './pages/CreatorResourcePage';
import { AssignmentLibraryPage } from './pages/AssignmentLibraryPage';
import { GalleryPage } from './pages/GalleryPage';
import { GalleryWorkPage } from './pages/GalleryWorkPage';
import { CollectionsPage } from './pages/CollectionsPage';
import { AdminPage, type AdminAccessState } from './admin/AdminPage';
import { adminApi } from './admin/admin-api';
import { ADMIN_HREF, isAdminLocation } from './admin/admin-navigation';
import { PortalHeader } from './components/PortalHeader';
import { SchoolTimeProvider, deviceTimeZone } from './components/school-time';
import { seatAvatar } from './creator-portal/default-avatars';
import { CreateProjectModal } from './components/CreateProjectModal';
import { AsaLabWordmark } from './brand/AsaLabBrand';
import { ModuleEditorHost } from './modules/ModuleEditorHost';
import { leaveMaxLaunch, readMaxInitData } from './max-auth';
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
  /**
   * Сколько работ ждёт ответа во всех классах — цифра рядом с «Классами».
   *
   * Ради неё преподаватель и открывает продукт утром: без неё приходится
   * заходить в каждый класс по очереди, чтобы выяснить, есть ли что проверять.
   *
   * Хук стоит здесь, до всех ветвлений: он должен вызываться на каждом рендере
   * одинаково, а «спрашивать ли сервер» решается внутри.
   */
  const [awaitingReview, setAwaitingReview] = useState(0);

  const [view, setViewState] = useState<CreatorPortalView>(() =>
    creatorViewFromLocation(window.location),
  );
  const [pendingTeacherInvite, setPendingTeacherInvite] = useState<string | null>(() => {
    const initial = creatorViewFromLocation(window.location);
    return initial.kind === 'teacher-invite' ? initial.token : null;
  });
  const [shellCreating, setShellCreating] = useState(false);
  const [accountPanel, setAccountPanel] = useState<'profile' | 'school'>('profile');
  const [adminRoute, setAdminRoute] = useState(() => isAdminLocation(window.location));
  const [adminAccess, setAdminAccess] = useState<AdminAccessState>({ kind: 'idle' });
  const adminAccessRequest = useRef(0);
  const maxLaunchData = useRef<string | null>(readMaxInitData());
  const maxLaunchAttempted = useRef(false);
  const [pendingMaxLink, setPendingMaxLink] = useState<string | null>(null);
  const [maxLaunchMessage, setMaxLaunchMessage] = useState<string | null>(null);

  const setView = useCallback((next: CreatorPortalView) => {
    setAdminRoute(false);
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
      setAdminRoute(isAdminLocation(window.location));
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
    const launchData = maxLaunchData.current;
    const isMaxLaunch = launchData !== null;
    if (launchData && !maxLaunchAttempted.current) {
      maxLaunchAttempted.current = true;
      setPublicViewState({ kind: 'sign-in' });
      const maxResult = await api.maxSession(launchData);
      if (maxResult.ok) {
        maxLaunchData.current = null;
        leaveMaxLaunch();
        setSession({ kind: 'authenticated', session: maxResult.data });
        return;
      }
      if (maxResult.status === 409 && maxResult.error.code === 'max_link_required') {
        setPendingMaxLink(launchData);
      } else if (maxResult.error.code === 'max_init_data_expired') {
        setMaxLaunchMessage('Ссылка MAX устарела. Закройте и заново откройте ASA Lab в MAX.');
      } else if (maxResult.error.code === 'max_auth_disabled') {
        setMaxLaunchMessage('Вход через MAX пока не подключён. Войдите по почте.');
      } else {
        setMaxLaunchMessage('MAX не смог подтвердить вход. Откройте мини-приложение заново.');
      }
    }
    const result = await api.me();
    if (result.ok) {
      if (result.data.authenticated) {
        setSession({ kind: 'authenticated', session: result.data });
      } else if (isMaxLaunch) {
        setSession({ kind: 'anonymous' });
      } else {
        await resolveStudent();
      }
    } else if (result.status === 401) {
      if (isMaxLaunch) setSession({ kind: 'anonymous' });
      else await resolveStudent();
    } else {
      setSession({ kind: 'error' });
    }
  }, [resolveStudent]);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const loadAdminAccess = useCallback(async (): Promise<void> => {
    const request = ++adminAccessRequest.current;
    if (session.kind === 'student') {
      setAdminAccess({ kind: 'denied' });
      return;
    }
    if (session.kind !== 'authenticated') {
      setAdminAccess({ kind: 'idle' });
      return;
    }

    setAdminAccess({ kind: 'checking' });
    const result = await adminApi.me();
    if (request !== adminAccessRequest.current) return;
    if (result.ok) {
      setAdminAccess({ kind: 'granted', profile: result.data });
    } else if (result.status === 401 || result.status === 403) {
      setAdminAccess({ kind: 'denied' });
    } else {
      setAdminAccess({
        kind: 'error',
        message:
          result.status === 0
            ? 'Сервер недоступен. Проверьте соединение и повторите.'
            : 'Сервер не смог подтвердить административные права.',
      });
    }
  }, [session]);

  useEffect(() => {
    void loadAdminAccess();
    return () => {
      adminAccessRequest.current += 1;
    };
  }, [loadAdminAccess]);

  const openAdmin = useCallback((): void => {
    setAdminRoute(true);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (current !== ADMIN_HREF) window.history.pushState(null, '', ADMIN_HREF);
  }, []);

  /**
   * Where this teacher keeps time, asked once.
   *
   * The browser is the only thing that knows where the person is sitting, so it
   * reports its zone the first time an account arrives without one. After that
   * the answer belongs to the account: a teacher marking work on holiday reads
   * their own school's times, not the hotel's. `true` is that promise — the
   * server writes only into an empty setting.
   */
  /** Work a learner still owes, for the dot on their class. */
  const [unfinished, setUnfinished] = useState(0);
  useEffect(() => {
    if (session.kind !== 'student') {
      setUnfinished(0);
      return;
    }
    void api.seatAssignmentCounts().then((result) => {
      if (result.ok) setUnfinished(result.data.unfinished);
    });
  }, [session, view]);

  /**
   * Сколько работ ждёт ответа во всех классах преподавателя.
   *
   * Спрашиваем только у того, кто классы ведёт: у остальных этот запрос
   * отвечает отказом и засоряет консоль ошибкой на ровном месте. Сам вызов
   * хука безусловен, как и требуется.
   */
  useEffect(() => {
    if (session.kind !== 'authenticated') return;
    if (!session.session.navigation.classroomManagement) {
      setAwaitingReview(0);
      return;
    }
    void api.awaitingReviewTotal().then((result) => {
      setAwaitingReview(result.ok ? result.data.total : 0);
    });
  }, [session, view]);

  const zoneReported = useRef(false);
  useEffect(() => {
    if (session.kind !== 'authenticated' || session.session.timeZone !== null) return;
    if (zoneReported.current) return;
    zoneReported.current = true;
    void api.setAccountTimeZone(deviceTimeZone(), true).then((result) => {
      if (!result.ok) return;
      setSession((current) =>
        current.kind === 'authenticated'
          ? {
              kind: 'authenticated',
              session: { ...current.session, timeZone: result.data.timeZone },
            }
          : current,
      );
    });
  }, [session]);

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
  if (session.kind === 'authenticated' && pendingMaxLink) {
    return (
      <MaxLinkPage
        session={session.session}
        initData={pendingMaxLink}
        onLinked={() => {
          setPendingMaxLink(null);
          maxLaunchData.current = null;
          leaveMaxLaunch();
          setView({ kind: 'home' });
        }}
        onCancel={() => {
          setPendingMaxLink(null);
          maxLaunchData.current = null;
          leaveMaxLaunch();
          setView({ kind: 'home' });
        }}
      />
    );
  }
  if (session.kind === 'anonymous') {
    const signedIn = (payload: SessionPayload): void => {
      setSession({ kind: 'authenticated', session: payload });
      if (!pendingMaxLink && maxLaunchData.current) {
        setMaxLaunchMessage(null);
        maxLaunchData.current = null;
        leaveMaxLaunch();
      }
      if (pendingTeacherInvite) {
        setView({ kind: 'teacher-invite', token: pendingTeacherInvite });
        return;
      }
      setView(view.kind === 'editor' ? view : { kind: 'home' });
    };

    if (
      (pendingMaxLink || maxLaunchMessage) &&
      publicView.kind !== 'sign-up' &&
      publicView.kind !== 'organization-sign-in'
    ) {
      return (
        <LoginPage
          onSignedIn={signedIn}
          onCreateAccount={() => setPublicView({ kind: 'sign-up' })}
          onOrganizationLogin={() => setPublicView({ kind: 'organization-sign-in' })}
          contextMessage={
            pendingMaxLink
              ? 'Войдите в существующий аккаунт. Затем вы сможете подтвердить привязку MAX.'
              : (maxLaunchMessage ?? '')
          }
          onBack={() => {
            setPendingMaxLink(null);
            setMaxLaunchMessage(null);
            maxLaunchData.current = null;
            leaveMaxLaunch();
            setPublicViewState({ kind: 'entry' });
          }}
        />
      );
    }

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
      <SchoolTimeProvider timeZone={portalSession.timeZone}>
        <ModuleEditorHost
          projectId={view.projectId}
          onBack={() => setView(view.returnTo)}
          onModuleResolved={handleModuleResolved}
          returnTo={view.returnTo}
          seatLearner={isSeatLearner}
          user={portalSession.user}
        />
      </SchoolTimeProvider>
    );
  }

  const active = sectionForView(view, hasTeachingCapability);

  const navigate = (section: CreatorPortalSection): void => {
    if (section === 'home') setView({ kind: 'home' });
    else if (section === 'projects') setView({ kind: 'my-projects' });
    else if (section === 'learning') setView({ kind: 'learning' });
    else if (section === 'collections') setView({ kind: 'collections' });
    else if (section === 'gallery') setView({ kind: 'gallery' });
    else if (section === 'challenges') setView({ kind: 'challenges' });
    else if (section === 'classes') setView({ kind: 'classrooms' });
    else if (section === 'help') setView({ kind: 'help' });
    else {
      setAccountPanel('profile');
      setView({ kind: 'account' });
    }
  };

  return (
    <SchoolTimeProvider timeZone={portalSession.timeZone}>
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
          classroomBadge={canManageClasses ? awaitingReview : undefined}
          unfinishedCount={unfinished}
          {...(session.kind === 'student'
            ? {
                seatAvatarUrl: seatAvatar(
                  session.session.student.seatId,
                  session.session.student.avatarKey,
                ).src,
              }
            : {})}
          canTeach={hasTeachingCapability}
          {...(adminAccess.kind === 'granted'
            ? { adminNavigation: { active: adminRoute, onNavigate: openAdmin } }
            : {})}
          onNavigate={navigate}
          onSessionChanged={(updated) => setSession({ kind: 'authenticated', session: updated })}
          onLoggedOut={() => {
            setSession({ kind: 'anonymous' });
            setPublicView({ kind: 'entry' });
          }}
          onCreate={() => setShellCreating(true)}
        />
        {adminRoute ? (
          <AdminPage
            access={adminAccess}
            onRetry={() => void loadAdminAccess()}
            onBack={() => setView({ kind: 'home' })}
            onAccessDenied={() => setAdminAccess({ kind: 'denied' })}
          />
        ) : (
          <>
            {/* Главная одна для всех. Учащийся видит ту же страницу, что и любой
            другой: разница только в том, чего у него нет — не в том, что ему
            подсунули другую страницу. Всё классное живёт в «Классах». */}
            {view.kind === 'home' ? (
              <CreatorHomePage
                session={portalSession}
                onNavigate={navigate}
                onOpenProject={(projectId, moduleKey) =>
                  setView({ kind: 'editor', projectId, moduleKey, returnTo: { kind: 'home' } })
                }
              />
            ) : null}
            {view.kind === 'my-projects' ? (
              <MyProjectsPage
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
            {/* "Задачи" is a teacher's own library of work now, not a leaflet. A
            learner has no library — the tasks they were given live in their
            class — so they still get the informational page. */}
            {view.kind === 'challenges' && hasTeachingCapability && !isSeatLearner ? (
              <AssignmentLibraryPage />
            ) : null}
            {/* The gallery is the one place people see each other's work, and that
            is the whole point of it: inside a class nobody sees a classmate's
            model, because thirty children on one task shown each other's
            answers is a copying machine. Here the work is finished and was
            published on purpose. */}
            {/* No "open" on a card: a gallery entry belongs to another person and
            usually another school, and the picture is the point. */}
            {view.kind === 'gallery' ? (
              <GalleryPage
                canTeach={hasTeachingCapability && !isSeatLearner}
                onOpenWork={(projectId) => setView({ kind: 'gallery-work', projectId })}
              />
            ) : null}
            {view.kind === 'gallery-work' ? (
              <GalleryWorkPage
                projectId={view.projectId}
                onBack={() => setView({ kind: 'gallery' })}
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
            {/* Коллекции перестали быть заглушкой: это подборки работ из галереи,
            отложенных себе. Ни Задания, ни Проекты они не дублируют — там
            формулировки и своё, а здесь ссылки на чужое. */}
            {view.kind === 'collections' ? (
              <CollectionsPage
                onOpenWork={(projectId) => setView({ kind: 'gallery-work', projectId })}
              />
            ) : null}
            {view.kind === 'learning' ||
            (view.kind === 'challenges' && (!hasTeachingCapability || isSeatLearner)) ||
            view.kind === 'help' ? (
              <CreatorResourcePage
                section={view.kind === 'challenges' ? 'challenges' : view.kind}
                onNavigate={navigate}
              />
            ) : null}
            {/* A learner has one class and no register: the door marked Classes
            opens onto the work set for them. */}
            {view.kind === 'classrooms' && session.kind === 'student' ? (
              <SeatClassPage
                seat={session.session}
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
            {/* Учатся не только дети. Преподаватель проходит курс коллеги, студент
            берёт факультатив, взрослый учится ради себя — и всем им незачем
            второй вход по выданному логину и вторая полка работ. */}
            {view.kind === 'attending' ||
            (view.kind === 'classrooms' && !canManageClasses && !isSeatLearner) ? (
              <AttendedClassesPage
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
            {view.kind === 'classrooms' && canManageClasses ? (
              <DashboardPage
                onAttendClasses={() => setView({ kind: 'attending' })}
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
                {...(view.seatId ? { openSeatId: view.seatId } : {})}
                /* Leaving a learner's model returns to that learner, not to the
               teacher's own project list — which is where this used to land,
               and is nobody's idea of "back". */
                onOpenProject={(projectId, moduleKey, seatId) =>
                  setView({
                    kind: 'editor',
                    projectId,
                    moduleKey,
                    returnTo: {
                      kind: 'classroom',
                      classroomId: view.classroomId,
                      classroomTitle: view.classroomTitle,
                      ...(seatId ? { seatId } : {}),
                    },
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
            {/* An invitation to start teaching belongs to a grown-up who might. A
            child signed in on a class seat is shown their work here, and asking
            them to "выберите роль «Педагог»" under it is noise at best. */}
            {!hasTeachingCapability &&
            !isSeatLearner &&
            (view.kind === 'classroom' || view.kind === 'classroom-projects') ? (
              <main className="portal-content" id="main-content" tabIndex={-1}>
                <section className="creator-access-message">
                  <p className="portal-eyebrow">Классы</p>
                  <h1>Хотите вести занятия?</h1>
                  <p>
                    Выберите роль «Педагог» в профиле — после этого можно сразу создать первый
                    класс.
                  </p>
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
            {/* Settings, in the same shell for both. A seat owns fewer of them:
            its picture, and not the name its teacher keeps the register by. */}
            {view.kind === 'account' && !isSeatLearner ? (
              <AccountPage
                session={portalSession}
                onSessionChanged={(updated) =>
                  setSession({ kind: 'authenticated', session: updated })
                }
                onOpenClasses={() => navigate('classes')}
                initialPanel={accountPanel}
              />
            ) : null}
            {view.kind === 'account' && session.kind === 'student' ? (
              <SeatAccountPage
                seat={session.session}
                onSeatChanged={(updated) => setSession({ kind: 'student', session: updated })}
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
          </>
        )}
      </div>
    </SchoolTimeProvider>
  );
}
