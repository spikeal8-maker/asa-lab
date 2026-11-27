import { isMaxLaunchLocation, readBridgeInitData } from './max-auth';

const MAX_BRIDGE_URL = 'https://st.max.ru/js/max-web-app.js';

/** Only the dedicated MAX mini-app needs its external Bridge. Start it after
 * the document load barrier, and admit the existing fragment/email fallback
 * even if the provider never responds. Ordinary routes do not request it. */
export function prepareMaxLaunch(signal: AbortSignal): Promise<void> | null {
  if (signal.aborted || !isMaxLaunchLocation() || readBridgeInitData() !== null) return null;

  return new Promise<void>((resolve) => {
    const script = document.createElement('script');
    script.src = MAX_BRIDGE_URL;
    script.async = true;

    function finish() {
      signal.removeEventListener('abort', finish);
      window.removeEventListener('load', start);
      script.onload = null;
      script.onerror = null;
      script.remove();
      resolve();
    }

    function start() {
      if (!isMaxLaunchLocation()) {
        finish();
        return;
      }
      try {
        document.head.append(script);
      } catch {
        finish();
      }
    }

    signal.addEventListener('abort', finish, { once: true });
    script.onload = finish;
    script.onerror = finish;
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
  });
}
