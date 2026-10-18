const REFRESH_PATH = '/api/auth/refresh';
const SESSION_CHANNEL = 'asa-lab-session';
const LOCAL_LOGOUT_EVENT = 'asa-session-logout';

let refreshInFlight: { continuity: number; promise: Promise<boolean> } | null = null;

// The counter only fences asynchronous effects. Authentication is proved by
// the existing server identity endpoints, never by telemetry or a client role.
const continuity = () => telemetryContext().continuity;

async function identityAbsent(path: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (response.status === 401) return true;
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return (
      body !== null &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      (body as { authenticated?: unknown }).authenticated === false
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function confirmSessionAbsent(expected: number): Promise<boolean> {
  if (continuity() !== expected) return false;
  const absent = await Promise.all([
    identityAbsent('/api/auth/me'),
    identityAbsent('/api/class-join/me'),
  ]);
  return absent.every(Boolean) && continuity() === expected;
}

async function responseCode(response: Response): Promise<string | undefined> {
  try {
    return (await response.clone().json())?.error?.code;
  } catch {
    return undefined;
  }
}

function canRefresh(path: string): boolean {
  path = path.split('?')[0]!;
  // Observability is best-effort and cannot rotate credentials or log out the
  // user, including a StudentSeat without an Account refresh credential.
  if (isTelemetryPath(path)) return false;
  // Preview must not refresh or rotate authentication state after a 401.
  if (/^\/api\/learning\/activities\/[^/]+\/preview(?:\?|$)/.test(path)) return false;
  // A StudentSeat has its own session, never an Account refresh credential.
  if (path.startsWith('/api/class-join/')) return false;
  return ![
    REFRESH_PATH,
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/logout',
    '/api/auth/max/session',
  ].includes(path);
}

async function refreshSession(expected: number): Promise<boolean> {
  if (refreshInFlight?.continuity === expected) return refreshInFlight.promise;
  const flight = { continuity: expected, promise: Promise.resolve(false) };
  flight.promise = (async () => {
    const attempt = async (): Promise<Response | null> => {
      try {
        return await fetch(REFRESH_PATH, {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { accept: 'application/json' },
        });
      } catch {
        return null;
      }
    };
    let response = await attempt();
    const code = response?.status === 409 ? await responseCode(response) : undefined;
    // A valid Seat cannot use Account rotation. This is a deliberate skip,
    // recorded by the server, not a failed Account recovery or logout signal.
    if (code === 'refresh_not_applicable') return false;
    if (code === 'refresh_stale') {
      if (continuity() !== expected) return false;
      await new Promise((resolve) => window.setTimeout(resolve, 150));
      if (continuity() !== expected) return false;
      response = await attempt();
    }
    if (continuity() !== expected) return false;
    if (response?.ok) return true;
    reportClientDiagnostic('session_refresh_failed', 'auth', {
      phase: 'refresh',
      ...(response
        ? {
            httpStatus: response.status,
            relatedRequestId: response.headers.get('x-request-id') ?? undefined,
          }
        : {}),
    });
    if (
      response?.status === 401 &&
      (await confirmSessionAbsent(expected)) &&
      continuity() === expected
    ) {
      applySessionLoggedOut();
      // Automatic invalidation is a hint to other tabs, which must obtain
      // their own fresh proof. Explicit user logout keeps its existing event.
      broadcastSessionEvent('session-unavailable');
    }
    return false;
  })().finally(() => {
    if (refreshInFlight === flight) refreshInFlight = null;
  });
  refreshInFlight = flight;
  return flight.promise;
}

export async function fetchWithSessionRefresh(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const telemetryBeforeRequest = telemetryContext();
  const expected = continuity();
  const request = (): Promise<Response> =>
    fetch(path, { credentials: 'same-origin', ...init, cache: 'no-store' });
  const response = await request();
  if (response.status !== 401 || !canRefresh(path) || continuity() !== expected) return response;
  if (!(await refreshSession(expected)) || continuity() !== expected) return response;
  const retried = await request();
  if (retried.ok) confirmTelemetryProductSession(telemetryBeforeRequest);
  return retried;
}

function applySessionLoggedOut(): void {
  setTelemetryContext(null, false, telemetryContext().route);
  clearProtectedSessionCache();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LOCAL_LOGOUT_EVENT));
}

function broadcastSessionEvent(type: 'logged-out' | 'session-unavailable'): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(SESSION_CHANNEL);
    channel.postMessage({ type });
    channel.close();
  } catch {
    /* Another tab being unavailable cannot break the original request. */
  }
}

export function notifySessionLoggedOut(): void {
  applySessionLoggedOut();
  broadcastSessionEvent('logged-out');
}

export function onSessionLoggedOut(listener: () => void): () => void {
  if (typeof window !== 'undefined') window.addEventListener(LOCAL_LOGOUT_EVENT, listener);
  if (typeof BroadcastChannel === 'undefined') {
    return typeof window === 'undefined'
      ? () => undefined
      : () => window.removeEventListener(LOCAL_LOGOUT_EVENT, listener);
  }
  const channel = new BroadcastChannel(SESSION_CHANNEL);
  let closed = false;
  let checking = false;
  channel.onmessage = (event) => {
    const type = (event.data as { type?: unknown } | null)?.type;
    const acceptLogout = () => {
      setTelemetryContext(null, false, telemetryContext().route);
      clearProtectedSessionCache();
      listener();
    };
    if (type === 'logged-out') acceptLogout();
    else if (type === 'session-unavailable' && !checking) {
      checking = true;
      const expected = continuity();
      void confirmSessionAbsent(expected)
        .then((absent) => {
          if (absent && !closed && continuity() === expected) applySessionLoggedOut();
        })
        .catch(() => undefined)
        .finally(() => {
          checking = false;
        });
    }
  };
  return () => {
    closed = true;
    if (typeof window !== 'undefined') window.removeEventListener(LOCAL_LOGOUT_EVENT, listener);
    channel.close();
  };
}

function clearProtectedSessionCache(): void {
  if (typeof window === 'undefined') return;
  try {
    const keys = Object.keys(window.sessionStorage).filter(
      (key) =>
        key.startsWith('asa-seat-notes:') ||
        key.startsWith('asa-pending-create:') ||
        key.startsWith('asa-project-scroll:'),
    );
    for (const key of keys) window.sessionStorage.removeItem(key);
  } catch {
    /* Disabled storage must not prevent logout. */
  }
}
import { reportClientDiagnostic } from './client-diagnostics';
import { isTelemetryPath } from './telemetry-contract';
import {
  confirmTelemetryProductSession,
  setTelemetryContext,
  telemetryContext,
} from './telemetry-context';
