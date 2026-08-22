const REFRESH_PATH = '/api/auth/refresh';
const SESSION_CHANNEL = 'asa-lab-session';
const LOCAL_LOGOUT_EVENT = 'asa-session-logout';

let refreshInFlight: Promise<boolean> | null = null;

function canRefresh(path: string): boolean {
  return ![
    REFRESH_PATH,
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/logout',
    '/api/auth/max/session',
  ].includes(path);
}

async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
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
    if (response?.status === 409) {
      await new Promise((resolve) => window.setTimeout(resolve, 150));
      response = await attempt();
    }
    if (response?.ok) return true;
    if (response?.status === 401) notifySessionLoggedOut();
    return false;
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function fetchWithSessionRefresh(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const request = (): Promise<Response> =>
    fetch(path, { credentials: 'same-origin', ...init, cache: 'no-store' });
  const response = await request();
  if (response.status !== 401 || !canRefresh(path)) return response;
  return (await refreshSession()) ? request() : response;
}

export function notifySessionLoggedOut(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LOCAL_LOGOUT_EVENT));
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(SESSION_CHANNEL);
  channel.postMessage({ type: 'logged-out' });
  channel.close();
}

export function onSessionLoggedOut(listener: () => void): () => void {
  if (typeof window !== 'undefined') window.addEventListener(LOCAL_LOGOUT_EVENT, listener);
  if (typeof BroadcastChannel === 'undefined') {
    return typeof window === 'undefined'
      ? () => undefined
      : () => window.removeEventListener(LOCAL_LOGOUT_EVENT, listener);
  }
  const channel = new BroadcastChannel(SESSION_CHANNEL);
  channel.onmessage = (event) => {
    if ((event.data as { type?: unknown } | null)?.type === 'logged-out') listener();
  };
  return () => {
    if (typeof window !== 'undefined') window.removeEventListener(LOCAL_LOGOUT_EVENT, listener);
    channel.close();
  };
}
