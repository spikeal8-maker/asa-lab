import {
  PresentationProvider,
  usePresentationSessionLifetime,
} from './components/PresentationPreferences';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api, type ClassroomStudentSession, type SessionPayload } from './api';
import { LoginPage } from './pages/LoginPage';
import { MaxLinkPage } from './pages/MaxLinkPage';
import { RegisterPage } from './pages/RegisterPage';
import { OrganizationLoginPage } from './pages/OrganizationLoginPage';
import { JoinClassPage } from './pages/JoinClassPage';
import { studentSessionPayload } from './creator-portal/student-session';
import type { PublicIntent } from './pages/PublicEntryPage';
const PublicEntryPage = lazy(() =>
  import('./pages/PublicEntryPage').then((module) => ({ default: module.PublicEntryPage })),
);
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
);
const MyProjectsPage = lazy(() =>
  import('./pages/MyProjectsPage').then((module) => ({ default: module.MyProjectsPage })),
);
const GamesPage = lazy(() =>
  import('./pages/GamesPage').then((module) => ({ default: module.GamesPage })),
);
import { isGameModule } from './games/game-catalog';
const ProjectsPage = lazy(() =>
  import('./pages/ProjectsPage').then((module) => ({ default: module.ProjectsPage })),
);
const ClassroomPage = lazy(() =>
  import('./pages/ClassroomPage').then((module) => ({ default: module.ClassroomPage })),
);
const TeacherInvitePage = lazy(() =>
  import('./pages/TeacherInvitePage').then((module) => ({ default: module.TeacherInvitePage })),
);
const AccountPage = lazy(() =>
  import('./pages/AccountPage').then((module) => ({ default: module.AccountPage })),
);
const SeatAccountPage = lazy(() =>
  import('./pages/SeatAccountPage').then((module) => ({ default: module.SeatAccountPage })),
);
const SeatClassPage = lazy(() =>
  import('./pages/SeatClassPage').then((module) => ({ default: module.SeatClassPage })),
);
const CreatorHomePage = lazy(() =>
  import('./pages/CreatorHomePage').then((module) => ({ default: module.CreatorHomePage })),
);
const AttendedClassesPage = lazy(() =>
  import('./pages/AttendedClassesPage').then((module) => ({ default: module.AttendedClassesPage })),
);
const CreatorResourcePage = lazy(() =>
  import('./pages/CreatorResourcePage').then((module) => ({ default: module.CreatorResourcePage })),
);
const LearningPage = lazy(() =>
  import('./pages/LearningPage').then((module) => ({ default: module.LearningPage })),
);
const AssignmentLibraryPage = lazy(() =>
  import('./pages/AssignmentLibraryPage').then((module) => ({
    default: module.AssignmentLibraryPage,
  })),
);
const GalleryPage = lazy(() =>
  import('./pages/GalleryPage').then((module) => ({ default: module.GalleryPage })),
);
const GalleryWorkPage = lazy(() =>
  import('./pages/GalleryWorkPage').then((module) => ({ default: module.GalleryWorkPage })),
);
const KnowledgePage = lazy(() =>
  import('./pages/KnowledgePage').then((module) => ({ default: module.KnowledgePage })),
);
const CollectionsPage = lazy(() =>
  import('./pages/CollectionsPage').then((module) => ({ default: module.CollectionsPage })),
);
import type { AdminAccessState } from './admin/AdminPage';
import { adminApi } from './admin/admin-api';
import {
  adminHref,
  adminNavigationItems,
  adminSectionFromLocation,
  type AdminSection,
} from './admin/admin-navigation';
import { PortalHeader } from './components/PortalHeader';
import { SchoolTimeProvider, deviceTimeZone } from './components/school-time';
import { seatAvatar } from './creator-portal/default-avatars';
import { QuickProjectCreation } from './creator-portal/QuickProjectCreation';
import { AsaLabWordmark } from './brand/AsaLabBrand';
import { EditorErrorBoundary } from './modules/EditorErrorBoundary';
const ModuleEditorHost = lazy(() =>
  import('./modules/ModuleEditorHost')
    .then((module) => ({ default: module.ModuleEditorHost }))
    .catch(() => {
      throw new Error(
        'Не удалось загрузить рабочую среду. Проверьте соединение и попробуйте снова.',
      );
    }),
);
import { AppBootShell } from './components/AppBootShell';
import { PageDeliveryBoundary } from './components/PageDeliveryBoundary';
import { isMaxLaunchLocation, leaveMaxLaunch, readMaxInitData } from './max-auth';
import { onSessionLoggedOut } from './session-fetch';
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
import {
  requestSettingsNavigation,
  hasSettingsDraft,
  historyEntryIndex,
  pushSettingsAwareLocation,
  isSettingsNavigationPending,
} from './components/settings-navigation';
import './creator-portal/creator-portal.css';
import './creator-portal/portal-workspace.css';
import './creator-portal/home-workspace.css';

const AdminPage = lazy(() =>
  import('./admin/AdminPage').then((module) => ({ default: module.AdminPage })),
);

type SessionState =
  | { kind: 'checking' }
  | { kind: 'anonymous' }
  | { kind: 'authenticated'; session: SessionPayload }
  /** Signed in with a class seat: a learner, not an account holder. */
  | { kind: 'student'; session: ClassroomStudentSession }
  | { kind: 'error'; conflict?: boolean };

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
  if (isMaxLaunchLocation()) return { kind: 'sign-in' };
  const path = window.location.hash.replace(/^#/, '').split('?')[0] ?? '';
  return PUBLIC_ROUTES.find((route) => route.path === path)?.view ?? { kind: 'entry' };
}

export function App(): JSX.Element {
  const [session, setSession] = useState<SessionState>({ kind: 'checking' });
  usePresentationSessionLifetime(
    session.kind === 'checking'
      ? undefined
      : session.kind === 'student'
        ? session.session.student.seatId
        : null,
    session.kind === 'student' ? session.session.expiresAt : undefined,
  );
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
  const [accountPanel, setAccountPanel] = useState<
    'profile' | 'school' | 'security' | 'capabilities'
  >('profile');
  const [adminSection, setAdminSection] = useState<AdminSection | null>(() =>
    adminSectionFromLocation(window.location),
  );
  const adminRoute = adminSection !== null;
  const [adminAccess, setAdminAccess] = useState<AdminAccessState>({ kind: 'idle' });
  const [maxVerificationDue, setMaxVerificationDue] = useState(false);
  const adminAccessRequest = useRef(0);
  const maxLaunchData = useRef<string | null>(readMaxInitData());
  const maxLaunchAttempted = useRef(false);
  const [pendingMaxLink, setPendingMaxLink] = useState<string | null>(null);
  const [maxLaunchMessage, setMaxLaunchMessage] = useState<string | null>(() =>
    isMaxLaunchLocation() && maxLaunchData.current === null
      ? 'Вернитесь на страницу входа ASA Lab и нажмите «Войти через MAX». В боте останется нажать «Начать».'
      : null,
  );

  const acceptedLocation = useRef(window.location.href);
  const acceptedHistoryIndex = useRef(historyEntryIndex() ?? 0);
  const allowedTraversal = useRef<{ href: string; index: number } | null>(null);
  const setView = useCallback(
    (next: CreatorPortalView) =>
      requestSettingsNavigation(() => {
        setAdminSection(null);
        setViewState(next);
        const href = creatorViewToHref(next);
        const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (current !== href) pushSettingsAwareLocation(href);
        acceptedLocation.current = window.location.href;
        acceptedHistoryIndex.current = historyEntryIndex() ?? acceptedHistoryIndex.current;
      }),
    [],
  );

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

  const goToPublicHome = useCallback(() => {
    setPendingTeacherInvite(null);
    setView({ kind: 'home' });
    setPublicView({ kind: 'entry' });
  }, [setPublicView, setView]);

  useEffect(() => {
    if (window.history.state?.asaRouteIndex === undefined)
      window.history.replaceState(
        { ...window.history.state, asaRouteIndex: 0 },
        '',
        window.location.href,
      );
    let observedLocation = window.location.href;
    let observedHistoryIndex = historyEntryIndex();
    let observedAcceptedLocation = acceptedLocation.current;
    let observedAcceptedHistoryIndex = acceptedHistoryIndex.current;
    const sync = (event: Event): void => {
      let destination = window.location.href;
      let destinationIndex = historyEntryIndex();
      if (destinationIndex === null) {
        // Native hash assignment creates an entry with null state. Our accepted
        // entries are stamped, so this is a new entry, not an assumed Back.
        destinationIndex = acceptedHistoryIndex.current + 1;
        window.history.replaceState(
          { ...window.history.state, asaRouteIndex: destinationIndex },
          '',
          destination,
        );
      }
      if (
        allowedTraversal.current !== null &&
        destinationIndex === allowedTraversal.current.index &&
        destination !== allowedTraversal.current.href
      ) {
        // A native hash change during the draft dialog can replace the forward
        // entry. Resume the saved address, not whichever URL now occupies its slot.
        window.history.replaceState(window.history.state, '', allowedTraversal.current.href);
        destination = window.location.href;
      }
      if (
        observedAcceptedLocation !== acceptedLocation.current ||
        observedAcceptedHistoryIndex !== acceptedHistoryIndex.current
      ) {
        observedLocation = acceptedLocation.current;
        observedHistoryIndex = acceptedHistoryIndex.current;
        observedAcceptedLocation = acceptedLocation.current;
        observedAcceptedHistoryIndex = acceptedHistoryIndex.current;
      }
      // A same-document navigation emits both popstate and hashchange. Handle
      // its entry once, including while a draft dialog is already open.
      if (destination === observedLocation && destinationIndex === observedHistoryIndex) return;
      observedLocation = destination;
      observedHistoryIndex = destinationIndex;
      if (
        destination === acceptedLocation.current &&
        destinationIndex === acceptedHistoryIndex.current
      )
        return;
      const delta = acceptedHistoryIndex.current - destinationIndex;
      if (isSettingsNavigationPending()) {
        // Keep the original requested destination, but also undo a second Back
        // or Forward. Ignoring it would leave the URL ahead of the visible form.
        if (delta !== 0) window.history.go(delta);
        return;
      }
      const apply = () => {
        acceptedLocation.current = destination;
        acceptedHistoryIndex.current =
          destinationIndex ?? acceptedHistoryIndex.current + (event.type === 'popstate' ? -1 : 1);
        if (window.history.state?.asaRouteIndex === undefined)
          window.history.replaceState(
            { ...window.history.state, asaRouteIndex: acceptedHistoryIndex.current },
            '',
            destination,
          );
        const nextView = creatorViewFromLocation(window.location);
        setViewState(nextView);
        setAdminSection(adminSectionFromLocation(window.location));
        if (nextView.kind === 'teacher-invite') setPendingTeacherInvite(nextView.token);
        setPublicViewState(publicViewFromHash());
        window.dispatchEvent(new Event('settings-route'));
      };
      if (
        allowedTraversal.current?.href === destination &&
        allowedTraversal.current.index === destinationIndex
      ) {
        allowedTraversal.current = null;
        apply();
        return;
      }
      if (!hasSettingsDraft()) {
        apply();
        return;
      }
      // Restore the previous entry while the user decides; both history entries
      // survive Stay, Back and Forward. Chromium supplies the actual entry index.
      if (delta !== 0) {
        requestSettingsNavigation(() => {
          allowedTraversal.current = { href: destination, index: destinationIndex };
          window.history.go(-delta);
        });
        window.history.go(delta);
      } else {
        // Native same-document hash changes create a new entry on older browsers.
        requestSettingsNavigation(() => {
          allowedTraversal.current = { href: destination, index: destinationIndex };
          window.history.forward();
        });
        window.history.back();
      }
    };
    const acceptSettingsRoute = () => {
      acceptedLocation.current = window.location.href;
      acceptedHistoryIndex.current = historyEntryIndex() ?? acceptedHistoryIndex.current;
      observedLocation = window.location.href;
      observedHistoryIndex = acceptedHistoryIndex.current;
      observedAcceptedLocation = acceptedLocation.current;
      observedAcceptedHistoryIndex = acceptedHistoryIndex.current;
    };
    window.addEventListener('settings-route', acceptSettingsRoute);
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('settings-route', acceptSettingsRoute);
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
    const isMaxLaunch = isMaxLaunchLocation();
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
        setMaxLaunchMessage(
          'Ссылка MAX устарела. Вернитесь на страницу входа и откройте бота ещё раз.',
        );
      } else if (maxResult.error.code === 'max_auth_disabled') {
        setMaxLaunchMessage('Вход через MAX пока не подключён. Войдите по почте.');
      } else {
        setMaxLaunchMessage(
          'MAX не смог подтвердить вход. Вернитесь на страницу входа и откройте бота ещё раз.',
        );
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
      setSession({
        kind: 'error',
        conflict: result.status === 409 && result.error.code === 'session_conflict',
      });
    }
  }, [resolveStudent]);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  useEffect(
    () =>
      onSessionLoggedOut(() => {
        setSession({ kind: 'anonymous' });
        setAdminAccess({ kind: 'idle' });
        setPublicViewState({ kind: 'entry' });
      }),
    [],
  );

  useEffect(() => {
    if (session.kind !== 'authenticated') {
      setMaxVerificationDue(false);
      return;
    }
    let cancelled = false;
    void api.maxStatus().then((result) => {
      if (!cancelled) {
        setMaxVerificationDue(result.ok && result.data.available && result.data.promptDue);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

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
    const hasPlatformAdminCapability = session.session.capabilities.some(
      (entry) => entry.capability === 'platform_admin' && entry.state === 'verified',
    );
    if (!hasPlatformAdminCapability) {
      setAdminAccess({ kind: 'denied' });
      return;
    }

    setAdminAccess({ kind: 'checking' });
    const result = await adminApi.me();
    if (request !== adminAccessRequest.current) return;
    if (result.ok) {
      setAdminAccess({ kind: 'granted', profile: result.data });
    } else if (result.status === 401) {
      setSession({ kind: 'anonymous' });
      setAdminAccess({ kind: 'idle' });
    } else if (result.status === 403) {
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

  const openAdminSection = useCallback((section: AdminSection): void => {
    requestSettingsNavigation(() => {
      setAdminSection(section);
      const href = adminHref(section);
      const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (current !== href) pushSettingsAwareLocation(href);
      acceptedLocation.current = window.location.href;
      acceptedHistoryIndex.current = historyEntryIndex() ?? acceptedHistoryIndex.current;
    });
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
  const attentionIdentity =
    session.kind === 'authenticated'
      ? session.session.user.id
      : session.kind === 'student'
        ? session.session.student.seatId
        : session.kind;
  useEffect(() => {
    setUnfinished(0);
    setAwaitingReview(0);
  }, [attentionIdentity]);
  useEffect(() => {
    let current = true;
    if (session.kind === 'student') {
      void api.seatAssignmentCounts().then((result) => {
        if (current && result.ok) setUnfinished(result.data.unfinished);
      });
    } else if (
      session.kind === 'authenticated' &&
      !session.session.navigation.classroomManagement
    ) {
      void api.attendedAssignments().then((result) => {
        if (current && result.ok)
          setUnfinished(
            result.data.items.filter((item) => item.status === 'open' && !item.submittedAt).length,
          );
      });
    }
    return () => {
      current = false;
    };
  }, [session, view]);

  /**
   * Сколько работ ждёт ответа во всех классах преподавателя.
   *
   * Спрашиваем только у того, кто классы ведёт: у остальных этот запрос
   * отвечает отказом и засоряет консоль ошибкой на ровном месте. Сам вызов
   * хука безусловен, как и требуется.
   */
  useEffect(() => {
    let current = true;
    if (session.kind !== 'authenticated') return;
    if (!session.session.navigation.classroomManagement) {
      setAwaitingReview(0);
      return;
    }
    void api.awaitingReviewTotal().then((result) => {
      if (current && result.ok) setAwaitingReview(result.data.total);
    });
    return () => {
      current = false;
    };
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
    return <AppBootShell />;
  }
  if (session.kind === 'error') {
    return (
      <main className="page-center">
        <section className="login-card" role="alert">
          <h1 className="brand-heading">
            <AsaLabWordmark />
          </h1>
          <p>
            {session.conflict
              ? 'В этом браузере обнаружены два разных входа. Завершите их и войдите заново.'
              : 'Не удалось проверить активную сессию.'}
          </p>
          {session.conflict ? (
            <button
              type="button"
              className="btn-primary"
              onClick={async () => {
                await api.classroomStudentLogout();
                await api.logout();
                await checkSession();
              }}
            >
              Завершить входы
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={() => void checkSession()}>
              Повторить
            </button>
          )}
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
      if (!pendingMaxLink && (maxLaunchData.current || isMaxLaunchLocation())) {
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
        <PageDeliveryBoundary
          key={view.token}
          label="Открываем приглашение"
          backLabel="На главную"
          onBack={() => {
            setPendingTeacherInvite(null);
            setView({ kind: 'home' });
            setPublicView({ kind: 'entry' });
          }}
        >
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
        </PageDeliveryBoundary>
      );
    }

    if (publicView.kind === 'sign-up') {
      return (
        <RegisterPage
          onRegistered={signedIn}
          {...(pendingMaxLink
            ? {
                maxInitData: pendingMaxLink,
                onMaxRegistered: (payload: SessionPayload) => {
                  setPendingMaxLink(null);
                  setMaxLaunchMessage(null);
                  maxLaunchData.current = null;
                  leaveMaxLaunch();
                  signedIn(payload);
                },
              }
            : {})}
          onBackToLogin={() => setPublicView({ kind: 'sign-in' })}
          onHome={goToPublicHome}
        />
      );
    }
    if (publicView.kind === 'join-class') {
      return (
        <JoinClassPage
          onBack={() => setPublicView({ kind: 'sign-in' })}
          onHome={goToPublicHome}
          onSignedIn={() => void checkSession()}
        />
      );
    }
    if (publicView.kind === 'organization-sign-in') {
      return (
        <OrganizationLoginPage
          onSignedIn={signedIn}
          onBack={() => setPublicView({ kind: 'sign-in' })}
          onHome={goToPublicHome}
        />
      );
    }
    if (publicView.kind === 'sign-in') {
      return (
        <LoginPage
          onSignedIn={signedIn}
          onCreateAccount={() => setPublicView({ kind: 'sign-up' })}
          onClassCodeLogin={() => setPublicView({ kind: 'join-class' })}
          onOrganizationLogin={() => setPublicView({ kind: 'organization-sign-in' })}
          onBack={() => setPublicView({ kind: 'entry' })}
          onHome={goToPublicHome}
        />
      );
    }
    return (
      <PageDeliveryBoundary
        label="Открываем ASA Lab"
        backLabel="Войти"
        onBack={() => setPublicView({ kind: 'sign-in' })}
      >
        <PublicEntryPage
          onChoose={(intent: PublicIntent) => {
            if (intent === 'sign-up') setPublicView({ kind: 'sign-up' });
            else if (intent === 'class-code') setPublicView({ kind: 'join-class' });
            else setPublicView({ kind: 'sign-in' });
          }}
        />
      </PageDeliveryBoundary>
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
  const canAuthor = portalSession.navigation.contentAuthoring === true && !isSeatLearner;

  if (view.kind === 'editor') {
    const game = isGameModule(view.moduleKey) || view.returnTo.kind === 'games';
    const onBack = (): void =>
      setView(
        isGameModule(view.moduleKey) &&
          (view.returnTo.kind === 'home' || view.returnTo.kind === 'my-projects')
          ? { kind: 'games' }
          : view.returnTo,
      );
    return (
      <SchoolTimeProvider timeZone={portalSession.timeZone}>
        <EditorErrorBoundary
          key={view.projectId}
          onBack={onBack}
          backLabel={game ? 'К играм' : 'К проектам'}
        >
          <Suspense
            fallback={<AppBootShell label={game ? 'Открываем игру' : 'Открываем проект'} />}
          >
            <ModuleEditorHost
              projectId={view.projectId}
              {...(view.moduleKey ? { moduleKey: view.moduleKey } : {})}
              onBack={onBack}
              onModuleResolved={handleModuleResolved}
              returnTo={view.returnTo}
              seatLearner={isSeatLearner}
              user={portalSession.user}
            />
          </Suspense>
        </EditorErrorBoundary>
      </SchoolTimeProvider>
    );
  }

  const active = sectionForView(view, hasTeachingCapability);

  const navigate = (section: CreatorPortalSection): void => {
    if (section === 'home') setView({ kind: 'home' });
    else if (section === 'projects') setView({ kind: 'my-projects' });
    else if (section === 'games') setView({ kind: 'games' });
    else if (section === 'learning') setView({ kind: 'learning' });
    else if (section === 'knowledge') setView({ kind: 'knowledge' });
    else if (section === 'collections') setView({ kind: 'collections' });
    else if (section === 'gallery') setView({ kind: 'gallery' });
    else if (section === 'challenges') setView({ kind: 'challenges' });
    else if (section === 'classes') setView({ kind: 'classrooms' });
    else if (section === 'help') setView({ kind: 'help' });
    else {
      setAccountPanel(maxVerificationDue ? 'security' : 'profile');
      setView({ kind: 'account' });
    }
  };

  return (
    <PresentationProvider
      key={
        session.kind === 'student'
          ? `seat:${session.session.student.seatId}:${session.session.expiresAt}`
          : `account:${portalSession.user.id}`
      }
      actor={portalSession.user.id}
      seat={isSeatLearner}
      {...(session.kind === 'student' ? { expiresAt: session.session.expiresAt } : {})}
    >
      <SchoolTimeProvider timeZone={portalSession.timeZone}>
        <QuickProjectCreation
          key={`${portalSession.user.id}:${portalSession.activeWorkspace.workspaceId}`}
          contextKey={`${portalSession.user.id}:${portalSession.activeWorkspace.workspaceId}`}
          onCreated={(project) =>
            setView({
              kind: 'editor',
              projectId: project.id,
              moduleKey: project.moduleKey,
              returnTo: view.kind === 'my-projects' ? view : { kind: 'home' },
            })
          }
        >
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
              maxVerificationDue={!isSeatLearner && maxVerificationDue}
              {...(session.kind === 'student'
                ? {
                    seatSession: session.session,
                    onSeatChanged: (updated: ClassroomStudentSession) => {
                      const seatId = session.session.student.seatId;
                      const expiresAt = session.session.expiresAt;
                      setSession((current) =>
                        current.kind === 'student' &&
                        current.session.student.seatId === seatId &&
                        current.session.expiresAt === expiresAt &&
                        updated.student.seatId === seatId
                          ? { kind: 'student', session: updated }
                          : current,
                      );
                    },
                    seatAvatarUrl: seatAvatar(
                      session.session.student.seatId,
                      session.session.student.avatarKey,
                    ).src,
                  }
                : {})}
              canTeach={hasTeachingCapability}
              {...(adminAccess.kind === 'granted'
                ? {
                    adminNavigation: {
                      active: adminRoute,
                      activeSection: adminSection ?? 'overview',
                      items: adminNavigationItems(adminAccess.profile),
                      onOpen: () => openAdminSection('overview'),
                      onNavigate: openAdminSection,
                    },
                  }
                : {})}
              onNavigate={navigate}
              onSessionChanged={(updated) =>
                setSession({ kind: 'authenticated', session: updated })
              }
              onLoggedOut={() => {
                setSession({ kind: 'anonymous' });
                setPublicView({ kind: 'entry' });
              }}
            />
            {adminRoute ? (
              <Suspense
                fallback={
                  <main className="portal-content admin-page" aria-busy="true">
                    <span className="sr-only">Загрузка администрирования</span>
                  </main>
                }
              >
                <AdminPage
                  access={adminAccess}
                  section={adminSection ?? 'overview'}
                  onNavigate={openAdminSection}
                  onRetry={() => void loadAdminAccess()}
                  onBack={() => setView({ kind: 'home' })}
                  onAccessDenied={() => setAdminAccess({ kind: 'denied' })}
                />
              </Suspense>
            ) : (
              <Suspense
                fallback={
                  <main className="portal-content" aria-busy="true">
                    <span className="sr-only">Загрузка раздела</span>
                  </main>
                }
              >
                {/* Главная одна для всех. Учащийся видит ту же страницу, что и любой
            другой: разница только в том, чего у него нет — не в том, что ему
            подсунули другую страницу. Всё классное живёт в «Классах». */}
                {view.kind === 'home' ? (
                  <PageDeliveryBoundary
                    label="Открываем главную"
                    backLabel="Мои проекты"
                    onBack={() => setView({ kind: 'my-projects' })}
                    embedded
                  >
                    <CreatorHomePage
                      session={portalSession}
                      onNavigate={navigate}
                      onAllProjects={(module) =>
                        setView({ kind: 'my-projects', ...(module ? { module } : {}) })
                      }
                      onOpenWork={(projectId) => setView({ kind: 'gallery-work', projectId })}
                      onOpenCourse={(courseId) => setView({ kind: 'knowledge-course', courseId })}
                      onOpenProject={(projectId, moduleKey) =>
                        setView({
                          kind: 'editor',
                          projectId,
                          moduleKey,
                          returnTo: { kind: 'home' },
                        })
                      }
                    />
                  </PageDeliveryBoundary>
                ) : null}
                {view.kind === 'my-projects' ? (
                  <MyProjectsPage
                    view={view}
                    onView={setView}
                    onOpenProject={(projectId, moduleKey) =>
                      setView({
                        kind: 'editor',
                        projectId,
                        moduleKey,
                        returnTo: view,
                      })
                    }
                  />
                ) : null}
                {view.kind === 'games' ? (
                  <GamesPage
                    onOpenGame={(projectId, moduleKey) =>
                      setView({ kind: 'editor', projectId, moduleKey, returnTo: { kind: 'games' } })
                    }
                  />
                ) : null}
                {/* "Задачи" is a teacher's own library of work now, not a leaflet. A
            learner has no library — the tasks they were given live in their
            class — so they still get the informational page. */}
                {view.kind === 'challenges' && canAuthor ? (
                  <AssignmentLibraryPage canTeach={canManageClasses} />
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
                {view.kind === 'knowledge' || view.kind === 'knowledge-course' ? (
                  <KnowledgePage
                    {...(view.kind === 'knowledge-course' ? { courseId: view.courseId } : {})}
                    onOpen={(courseId) => setView({ kind: 'knowledge-course', courseId })}
                    onBack={() => setView({ kind: 'knowledge' })}
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
                {view.kind === 'learning' ? (
                  <LearningPage
                    seat={session.kind === 'student' ? session.session : null}
                    onOpenProject={(projectId, moduleKey) =>
                      setView({
                        kind: 'editor',
                        projectId,
                        moduleKey,
                        returnTo: { kind: 'learning' },
                      })
                    }
                  />
                ) : null}
                {(view.kind === 'challenges' && !canAuthor) || view.kind === 'help' ? (
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
                {(view.kind === 'classroom' || view.kind === 'classroom-projects') &&
                !canManageClasses ? (
                  <main id="main-content" className="portal-content" tabIndex={-1}>
                    <h1>Доступ к управлению классом закрыт</h1>
                    <p>Ваши занятия и работы находятся в «Моём обучении».</p>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => setView({ kind: 'learning' })}
                    >
                      Моё обучение
                    </button>
                  </main>
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
                        Подключите преподавание в разделе «Возможности». Доступ к чужим классам это
                        не предоставляет.
                      </p>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          setAccountPanel('capabilities');
                          setView({ kind: 'account' });
                        }}
                      >
                        Возможности
                      </button>
                    </section>
                  </main>
                ) : null}
                {view.kind === 'teacher-invite' ? (
                  <PageDeliveryBoundary
                    key={view.token}
                    label="Открываем приглашение"
                    backLabel="Вернуться к классам"
                    onBack={() => {
                      setPendingTeacherInvite(null);
                      setView({ kind: 'classrooms' });
                    }}
                    embedded
                  >
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
                  </PageDeliveryBoundary>
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
                  <SeatAccountPage seat={session.session} />
                ) : null}
              </Suspense>
            )}
          </div>
        </QuickProjectCreation>
      </SchoolTimeProvider>
    </PresentationProvider>
  );
}
