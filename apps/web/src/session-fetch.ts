const REFRESH_PATH = '/api/auth/refresh';
const SESSION_CHANNEL = 'asa-lab-session';
const LOCAL_LOGOUT_EVENT = 'asa-session-logout';
import { abortable, authRequest } from './auth-request';
import {
  invalidatePortalSession,
  portalSessionEpoch,
  retryAfterMilliseconds,
} from './portal-requests';

export interface SessionRequestInit extends RequestInit {
  /** Only the explicit project command contracts checked below may opt in. */
  retryAfterRefresh?: 'idempotent';
}

let refreshInFlight: { continuity: number; promise: Promise<boolean> } | null = null;
let recovery = { continuity: -1, generation: 0, failures: 0, retryAt: 0 };

// The counter only fences asynchronous effects. Authentication is proved by
// the existing server identity endpoints, never by telemetry or a client role.
const continuity = () => telemetryContext().continuity;

function recoveryFor(expected: number): typeof recovery {
  if (recovery.continuity !== expected)
    recovery = { continuity: expected, generation: 0, failures: 0, retryAt: 0 };
  return recovery;
}

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

async function refreshSession(expected: number, generation: number): Promise<boolean> {
  if (refreshInFlight?.continuity === expected) return refreshInFlight.promise;
  const state = recoveryFor(expected);
  // An old 401 from the same request wave must not rotate credentials again.
  if (state.generation > generation) return true;
  if (Date.now() < state.retryAt) return false;
  let failed = false;
  const backoff = (response?: Response | null): void => {
    if (failed || continuity() !== expected) return;
    failed = true;
    state.failures += 1;
    const ceiling = Math.min(30_000, 1000 * 2 ** Math.min(state.failures - 1, 5));
    const floor = Math.max(ceiling / 2, response ? (retryAfterMilliseconds(response) ?? 0) : 0);
    // Keep a positive random spread after the server's floor; max(floor, jitter)
    // would synchronize every pupil when Retry-After dominates the first retry.
    state.retryAt = Date.now() + floor + ceiling * (0.1 + Math.random() * 0.4);
  };
  const flight = { continuity: expected, promise: Promise.resolve(false) };
  flight.promise = authRequest(REFRESH_PATH, {}, async (refreshRequest) => {
    const attempt = async (): Promise<Response | null> => {
      try {
        return await abortable(
          () =>
            fetch(REFRESH_PATH, {
              method: 'POST',
              credentials: 'same-origin',
              cache: 'no-store',
              headers: { accept: 'application/json' },
              ...(refreshRequest.signal ? { signal: refreshRequest.signal } : {}),
            }),
          refreshRequest.signal,
        );
      } catch {
        return null;
      }
    };
    let response = await attempt();
    refreshRequest.signal?.throwIfAborted();
    const code =
      response?.status === 409
        ? await abortable(() => responseCode(response!), refreshRequest.signal)
        : undefined;
    // A valid Seat cannot use Account rotation. This is a deliberate skip,
    // recorded by the server, not a failed Account recovery or logout signal.
    if (code === 'refresh_not_applicable') {
      if (continuity() === expected) state.retryAt = Date.now() + 30_000;
      return false;
    }
    if (code === 'refresh_stale') {
      if (continuity() !== expected) return false;
      await abortable(
        () => new Promise((resolve) => window.setTimeout(resolve, 150)),
        refreshRequest.signal,
      );
      if (continuity() !== expected) return false;
      response = await attempt();
    }
    refreshRequest.signal?.throwIfAborted();
    if (continuity() !== expected) return false;
    if (response?.ok) {
      state.generation += 1;
      state.failures = 0;
      state.retryAt = 0;
      return true;
    }
    backoff(response);
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
      (await abortable(() => confirmSessionAbsent(expected), refreshRequest.signal)) &&
      continuity() === expected
    ) {
      applySessionLoggedOut();
      // Automatic invalidation is a hint to other tabs, which must obtain
      // their own fresh proof. Explicit user logout keeps its existing event.
      broadcastSessionEvent('session-unavailable');
    }
    return false;
  })
    .catch(() => {
      backoff();
      return false;
    })
    .finally(() => {
      if (refreshInFlight === flight) refreshInFlight = null;
    });
  refreshInFlight = flight;
  return flight.promise;
}

function mayReplay(path: string, init: SessionRequestInit): boolean {
  const method = (init.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return true;
  if (init.retryAfterRefresh !== 'idempotent') return false;
  path = path.split('?')[0]!;
  // session_v2_switch_context sets one exact workspace; its audit is conditional
  // on a changed workspace. Reapplying the same target cannot duplicate an action.
  if (method === 'POST' && path === '/api/session/context') {
    try {
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
      return (
        typeof body?.workspaceId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          body.workspaceId,
        )
      );
    } catch {
      return false;
    }
  }
  // ProjectsController requires the command key before create/duplicate. The
  // repository returns the original result for the same actor, key and body.
  if (
    method === 'POST' &&
    (path === '/api/projects' || /^\/api\/projects\/[^/]+\/duplicate$/.test(path))
  ) {
    return !!new Headers(init.headers).get('idempotency-key')?.trim();
  }
  // SaveDraftUseCase and its repository bind a mutation UUID, base revision and
  // document to one CAS receipt. Reuse the identical serialized command once.
  if (method === 'PUT' && /^\/api\/projects\/[^/]+\/draft$/.test(path)) {
    try {
      const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null;
      if (!body || typeof body !== 'object') return false;
      const command = body as { mutationId?: unknown; baseRevision?: unknown };
      return (
        typeof command.mutationId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          command.mutationId,
        ) &&
        Number.isSafeInteger(command.baseRevision) &&
        Number(command.baseRevision) >= 0
      );
    } catch {
      return false;
    }
  }
  return false;
}

export async function fetchWithSessionRefresh(
  path: string,
  init: SessionRequestInit = {},
): Promise<Response> {
  const telemetryBeforeRequest = telemetryContext();
  const expected = continuity();
  const expectedScope = portalSessionEpoch();
  const readOnly = ['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase());
  const generation = recoveryFor(expected).generation;
  const { retryAfterRefresh, ...transportInit } = init;
  void retryAfterRefresh;
  const request = (retry = false): Promise<Response> => {
    // Already-started direct reads retain their existing recovery contract during
    // a telemetry-only workspace pause. Canonical portal reads have a separate
    // hard fence in portalRead; their shared signal is aborted at that boundary.
    const dispatchScope = retry && readOnly ? portalSessionEpoch() : expectedScope;
    return abortable(() => {
      if (continuity() !== expected || portalSessionEpoch() !== dispatchScope)
        throw new DOMException('Request context changed', 'AbortError');
      return fetch(path, { credentials: 'same-origin', ...transportInit, cache: 'no-store' });
    }, init.signal);
  };
  const response = await request();
  if (response.status !== 401 || !canRefresh(path) || continuity() !== expected) return response;
  // A cancelled waiter leaves the shared refresh available to other callers.
  if (
    !(await abortable(() => refreshSession(expected, generation), init.signal)) ||
    continuity() !== expected ||
    (!readOnly && portalSessionEpoch() !== expectedScope) ||
    !mayReplay(path, init)
  )
    return response;
  const retried = await request(true);
  if (retried.ok) confirmTelemetryProductSession(telemetryBeforeRequest);
  return retried;
}

function applySessionLoggedOut(): void {
  invalidatePortalSession();
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
      invalidatePortalSession();
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
