// @vitest-environment jsdom
import { act, createElement, Fragment, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { invalidatePortalSession } from './portal-requests';
import { setTelemetryContext } from './telemetry-context';
import type { SessionPayload } from './api';

const authChunks = vi.hoisted(() => {
  const chunk = () => {
    let reject!: (reason: Error) => void;
    const promise = new Promise<never>((_resolve, fail) => {
      reject = fail;
    });
    return { promise, reject, requested: vi.fn() };
  };
  return { login: chunk(), register: chunk(), organization: chunk() };
});
vi.mock('./pages/LoginPage', () => {
  authChunks.login.requested();
  return authChunks.login.promise;
});
vi.mock('./pages/RegisterPage', () => {
  authChunks.register.requested();
  return authChunks.register.promise;
});
vi.mock('./pages/OrganizationLoginPage', () => {
  authChunks.organization.requested();
  return authChunks.organization.promise;
});
vi.mock('./pages/PublicEntryPage', () => ({
  PublicEntryPage: () => createElement('p', null, 'Public home'),
}));

// Keep the actual App state machine, API client, scheduler and session transport.
// The page controls isolate the existing onSignedIn callback from form validation.
vi.mock('./games/game-notifications', () => ({ usePortalGameNotifications: () => undefined }));
vi.mock('./analytics-runtime', () => ({ observeAnalytics: () => undefined }));
vi.mock('./client-diagnostics', () => ({ reportClientDiagnostic: vi.fn() }));
vi.mock('./pages/JoinClassPage', () => ({
  JoinClassPage: ({ onSignedIn }: { onSignedIn: () => void }) =>
    createElement('button', { onClick: onSignedIn }, 'Class sign-in complete'),
}));
vi.mock('./pages/CreatorHomePage', () => ({
  CreatorHomePage: ({ session }: { session: SessionPayload }) =>
    createElement('p', null, `Learner portal: ${session.account.displayName}`),
}));
vi.mock('./components/PortalHeader', () => ({
  PortalHeader: () => null,
  PortalGuestHeader: () => null,
}));
vi.mock('./components/PresentationPreferences', () => ({
  PresentationProvider: ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children),
  usePresentationSessionLifetime: () => undefined,
}));
vi.mock('./creator-portal/QuickProjectCreation', () => ({
  QuickProjectCreation: ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
const flush = async () => {
  await act(async () => {
    for (let index = 0; index < 30; index++) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

let root: Root;
let container: HTMLDivElement;
const expectedChunkError = (event: ErrorEvent): void => {
  const cause = (event.error as { cause?: { message?: unknown } } | null)?.cause;
  if (
    typeof cause?.message === 'string' &&
    /^Fixture (?:auth|login) chunk unavailable$/.test(cause.message)
  )
    event.preventDefault();
};
beforeEach(() => {
  Object.values(authChunks).forEach((chunk) => chunk.requested.mockClear());
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('__ASA_BUILD_REVISION__', 'session-check-fixture');
  vi.stubGlobal('BroadcastChannel', undefined);
  window.addEventListener('error', expectedChunkError);
  window.history.replaceState(null, '', '/#/join-class');
  setTelemetryContext(null, false, 'public');
  invalidatePortalSession();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  window.removeEventListener('error', expectedChunkError);
  container.remove();
  invalidatePortalSession();
  setTelemetryContext(null, false, 'public');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('App checking transitions retain their replacement identity request', () => {
  it('lets the error-screen retry leave checking after a fresh deferred /me', async () => {
    const next = deferred<Response>();
    const signals: AbortSignal[] = [];
    const transport = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
      if (path === '/api/auth/me') {
        signals.push(init!.signal!);
        return signals.length === 1 ? new Response(null, { status: 503 }) : next.promise;
      }
      if (path === '/api/class-join/me') return Response.json({ authenticated: false });
      throw new Error(`Unexpected request: ${String(path)}`);
    });
    vi.stubGlobal('fetch', transport);
    await act(async () => root.render(createElement(App)));
    await flush();
    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Повторить',
    );
    expect(retry).toBeDefined();
    await act(async () => retry!.click());
    await flush();
    expect(signals).toHaveLength(2);
    expect(signals[1]!.aborted).toBe(false);
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    next.resolve(Response.json({ authenticated: false }));
    await flush();
    expect(container.textContent).toContain('Class sign-in complete');
    expect(container.querySelector('.app-boot-shell')).toBeNull();
  });

  it('checks the completed class sign-in and enters the learner portal', async () => {
    const next = deferred<Response>();
    const signals: AbortSignal[] = [];
    let seatReads = 0;
    const transport = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
      if (path === '/api/auth/me') {
        signals.push(init!.signal!);
        return signals.length === 1 ? Response.json({ authenticated: false }) : next.promise;
      }
      if (path === '/api/class-join/me') {
        seatReads += 1;
        return Response.json(
          seatReads === 1
            ? { authenticated: false }
            : {
                authenticated: true,
                student: {
                  seatId: '10000000-0000-4000-8000-000000000001',
                  displayName: 'Learner',
                  safeMode: true,
                  avatarKey: null,
                },
                classroom: {
                  id: '10000000-0000-4000-8000-000000000002',
                  title: 'Class',
                  teacherDisplayName: 'Teacher',
                },
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
              },
        );
      }
      if (path === '/api/class-join/me/assignment-counts')
        return Response.json({ open: 0, unfinished: 0 });
      throw new Error(`Unexpected request: ${String(path)}`);
    });
    vi.stubGlobal('fetch', transport);
    await act(async () => root.render(createElement(App)));
    await flush();
    const joined = container.querySelector('button');
    expect(joined?.textContent).toBe('Class sign-in complete');
    await act(async () => joined!.click());
    await flush();
    expect(signals).toHaveLength(2);
    expect(signals[1]!.aborted).toBe(false);
    next.resolve(Response.json({ authenticated: false }));
    await flush();
    await vi.waitFor(async () => {
      await flush();
      expect(container.textContent).toContain('Learner portal: Learner');
    });
    expect(container.querySelector('.app-boot-shell')).toBeNull();
    expect(seatReads).toBe(2);
    expect(transport.mock.calls.filter(([path]) => path === '/api/auth/me')).toHaveLength(2);
    Object.values(authChunks).forEach((chunk) => expect(chunk.requested).not.toHaveBeenCalled());
  });
});

describe('auth destinations load on navigation with a usable delivery boundary', () => {
  function anonymousTransport() {
    const transport = vi.fn<typeof fetch>().mockImplementation(async (path) => {
      if (path === '/api/auth/me' || path === '/api/class-join/me')
        return Response.json({ authenticated: false });
      throw new Error(`Unexpected request: ${String(path)}`);
    });
    vi.stubGlobal('fetch', transport);
    return transport;
  }

  async function leaveFailedDestination() {
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Страница не загрузилась',
    );
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons.some((button) => button.textContent === 'Попробовать снова')).toBe(true);
    const back = buttons.find((button) => button.textContent === 'На главную');
    expect(back).toBeDefined();
    await act(async () => back!.click());
    await vi.waitFor(async () => {
      await flush();
      expect(container.textContent).toContain('Public home');
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  }

  it.each([
    ['sign-in', 'login', 'Открываем вход'],
    ['sign-up', 'register', 'Открываем регистрацию'],
    ['organization-sign-in', 'organization', 'Открываем вход через организацию'],
  ] as const)(
    'bounds a pending or failed %s chunk without replacing its page UI',
    async (route, key, label) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const transport = anonymousTransport();
      window.history.replaceState(null, '', `/#/${route}`);
      await act(async () => root.render(createElement(App)));
      await vi.waitFor(async () => {
        await flush();
        expect(authChunks[key].requested).toHaveBeenCalledOnce();
        expect(container.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe(label);
      });
      await act(async () => authChunks[key].reject(new Error('Fixture auth chunk unavailable')));
      await flush();
      await leaveFailedDestination();
      expect(transport.mock.calls.filter(([path]) => path === '/api/auth/me')).toHaveLength(1);
    },
  );

  it('also leaves the MAX sign-in context when its shared login chunk is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const transport = anonymousTransport();
    window.history.replaceState(null, '', '/max-login');
    await act(async () => root.render(createElement(App)));
    await flush();
    await act(async () => authChunks.login.reject(new Error('Fixture login chunk unavailable')));
    await flush();
    await leaveFailedDestination();
    expect(window.location.pathname).toBe('/');
    expect(transport.mock.calls.map(([path]) => path)).toEqual(['/api/auth/me']);
  });
});
