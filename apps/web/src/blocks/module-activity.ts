import { newClientId } from '../client-id';

export const BLOCKS_ACTIVITY_POLL_MS = 30_000;
export const BLOCKS_ACTIVITY_IDLE_MS = 30_000;

interface ActivityTransport {
  start(sessionId: string, projectId: string): Promise<boolean>;
  touch(sessionId: string, closed: boolean): Promise<boolean>;
}

// Telemetry uses the existing ProductAnalytics endpoints, but must never rotate
// authentication or broadcast logout after a telemetry-only 401.
async function record(
  path: string,
  body: Record<string, unknown>,
  keepalive = false,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`/api/analytics/v1/module-session/${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      keepalive,
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return false;
    const value: unknown = await response.json();
    return Boolean(
      value &&
      typeof value === 'object' &&
      'accepted' in value &&
      value.accepted === true &&
      (path !== 'start' || ('sessionId' in value && value.sessionId === body['sessionId'])),
    );
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

const transport: ActivityTransport = {
  start: (sessionId, projectId) => record('start', { sessionId, projectId, moduleKey: 'blocks' }),
  touch: (sessionId, closed) => record('touch', { sessionId, closed }, closed),
};

/** One tracker per accepted editor/frame/principal binding. Liveness never enters here. */
export function trackBlocksActivity(projectId: string, api: ActivityTransport = transport) {
  let disposed = false;
  let ready = false;
  let lastInput = -Infinity;
  let lastAttempt = -Infinity;
  let idleTimer: number | null = null;
  let current: { id: string; accepted: boolean; pending: boolean; lastTouch: number } | null = null;

  const close = (): void => {
    const session = current;
    current = null;
    if (idleTimer !== null) window.clearTimeout(idleTimer);
    idleTimer = null;
    lastInput = -Infinity;
    if (session?.accepted) void api.touch(session.id, true).catch(() => undefined);
    // A pending start closes itself if it eventually succeeds after detachment.
  };
  const eligible = (): boolean =>
    !disposed &&
    ready &&
    document.visibilityState === 'visible' &&
    Date.now() - lastInput < BLOCKS_ACTIVITY_IDLE_MS;

  const start = (): void => {
    if (current || !eligible() || Date.now() - lastAttempt < BLOCKS_ACTIVITY_POLL_MS) return;
    lastAttempt = Date.now();
    let id: string;
    try {
      id = newClientId();
    } catch {
      return;
    }
    const session = { id, accepted: false, pending: true, lastTouch: Date.now() };
    current = session;
    void api
      .start(session.id, projectId)
      .catch(() => false)
      .then((accepted) => {
        session.pending = false;
        session.accepted = accepted;
        session.lastTouch = Date.now();
        if (current !== session || !eligible()) {
          if (current === session) current = null;
          if (accepted) void api.touch(session.id, true).catch(() => undefined);
        } else if (!accepted) current = null;
      });
  };

  const timer = window.setInterval(() => {
    if (!eligible()) {
      close();
      return;
    }
    if (!current) {
      start();
      return;
    }
    const session = current;
    if (
      !session.accepted ||
      session.pending ||
      Date.now() - session.lastTouch < BLOCKS_ACTIVITY_POLL_MS
    )
      return;
    session.lastTouch = Date.now();
    session.pending = true;
    void api
      .touch(session.id, false)
      .catch(() => false)
      .then((accepted) => {
        session.pending = false;
        if (!accepted && current === session) close();
      });
  }, BLOCKS_ACTIVITY_POLL_MS);
  const visibility = (): void => {
    if (document.visibilityState !== 'visible') close();
  };
  const pagehide = (): void => {
    ready = false;
    close();
  };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', pagehide);

  return {
    setReady(value: boolean): void {
      ready = value;
      if (!value) close();
    },
    input(): void {
      if (disposed || !ready || document.visibilityState !== 'visible') return;
      lastInput = Date.now();
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(close, BLOCKS_ACTIVITY_IDLE_MS);
      start();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pagehide);
      close();
    },
  };
}
