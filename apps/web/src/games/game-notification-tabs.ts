import type { GameNotificationActivity } from './game-notification-coordinator';

interface NotificationTabEnvironment {
  document: Pick<
    Document,
    'visibilityState' | 'hasFocus' | 'addEventListener' | 'removeEventListener'
  >;
  window: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  navigator: Pick<Navigator, 'onLine'>;
}

/**
 * Safe independent-tab fallback: no inbox, player identity or actor-scoped
 * payload crosses tabs. A stale App actor cannot forward a different cookie's
 * response to another user. Hidden/offline tabs stop polling; visible inactive
 * windows poll slowly and catch up when focused. This is not leader election.
 */
export function observeGameNotificationActivity(
  onActivity: (activity: GameNotificationActivity) => void,
  environment: NotificationTabEnvironment = { document, window, navigator },
): () => void {
  let pageHidden = false;
  let disposed = false;
  let current: GameNotificationActivity | undefined;
  const update = () => {
    if (disposed) return;
    const next =
      pageHidden ||
      environment.document.visibilityState === 'hidden' ||
      environment.navigator.onLine === false
        ? 'paused'
        : environment.document.hasFocus()
          ? 'active'
          : 'background';
    if (next === current) return;
    current = next;
    onActivity(next);
  };
  const pagehide = () => {
    pageHidden = true;
    update();
  };
  const pageshow = () => {
    pageHidden = false;
    update();
  };
  environment.document.addEventListener('visibilitychange', update);
  for (const event of ['focus', 'blur', 'online', 'offline'])
    environment.window.addEventListener(event, update);
  environment.window.addEventListener('pagehide', pagehide);
  environment.window.addEventListener('pageshow', pageshow);
  update();
  return () => {
    disposed = true;
    environment.document.removeEventListener('visibilitychange', update);
    for (const event of ['focus', 'blur', 'online', 'offline'])
      environment.window.removeEventListener(event, update);
    environment.window.removeEventListener('pagehide', pagehide);
    environment.window.removeEventListener('pageshow', pageshow);
  };
}
