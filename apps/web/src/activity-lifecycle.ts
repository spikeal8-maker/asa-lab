import { newClientId } from './client-id';
export interface ActivityTransport {
  start(sessionId: string, projectId: string): Promise<boolean>;
  touch(sessionId: string, closed: boolean): Promise<boolean>;
  closeIntent?(sessionId: string): void;
  bindingVersion?(): string;
}

/** One tracker per accepted editor/frame/principal binding. Liveness never enters here. */
export function trackInputActivity(projectId: string, api: ActivityTransport, idleMs = 30_000) {
  let disposed = false;
  let ready = false;
  let lastInput = -Infinity;
  let lastAttempt = -Infinity;
  let idleTimer: number | null = null;
  let current: { id: string; accepted: boolean; pending: boolean; lastTouch: number } | null = null;
  let binding = api.bindingVersion?.();
  const renewBinding = (): void => {
    const next = api.bindingVersion?.();
    if (next === binding) return;
    binding = next;
    // Authentication recovery is no observation of the old period's end or new input.
    current = null;
    if (idleTimer !== null) window.clearTimeout(idleTimer);
    idleTimer = null;
    lastInput = -Infinity;
    lastAttempt = -Infinity;
  };

  const close = (): void => {
    renewBinding();
    const session = current;
    current = null;
    if (idleTimer !== null) window.clearTimeout(idleTimer);
    idleTimer = null;
    lastInput = -Infinity;
    if (session && api.closeIntent) api.closeIntent(session.id);
    else if (session?.accepted) void api.touch(session.id, true).catch(() => undefined);
    // A pending start closes itself if it eventually succeeds after detachment.
  };
  const eligible = (): boolean =>
    !disposed && ready && document.visibilityState === 'visible' && Date.now() - lastInput < idleMs;

  const start = (): void => {
    if (current || !eligible() || Date.now() - lastAttempt < 30_000) return;
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
          if (current === session) {
            current = null;
            api.closeIntent?.(session.id);
          }
          if (accepted && !api.closeIntent) void api.touch(session.id, true).catch(() => undefined);
        } else if (!accepted) current = null;
      });
  };

  const timer = window.setInterval(() => {
    renewBinding();
    if (!eligible()) {
      close();
      return;
    }
    if (!current) {
      start();
      return;
    }
    const session = current;
    if (!session.accepted || session.pending || Date.now() - session.lastTouch < 30_000) return;
    session.lastTouch = Date.now();
    session.pending = true;
    void api
      .touch(session.id, false)
      .catch(() => false)
      .then((accepted) => {
        session.pending = false;
        if (!accepted && current === session) close();
      });
  }, 30_000);
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
      renewBinding();
      if (disposed || !ready || document.visibilityState !== 'visible') return;
      lastInput = Date.now();
      if (idleTimer !== null) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(close, idleMs);
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
