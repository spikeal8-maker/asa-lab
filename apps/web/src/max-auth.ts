const MAX_LAUNCH_PATH = '/max-login';

type MaxBridgeGlobal = typeof globalThis & {
  readonly WebApp?: { readonly initData?: unknown };
};

export function isMaxLaunchLocation(location: Location = window.location): boolean {
  return (location.pathname.replace(/\/+$/, '') || '/') === MAX_LAUNCH_PATH;
}

/** MAX Bridge is the canonical source. The fragment fallback keeps older MAX
 * clients compatible without putting the signed value in an HTTP request. */
export function readMaxInitData(location: Location = window.location): string | null {
  if (!isMaxLaunchLocation(location)) return null;
  const bridgeValue = (globalThis as MaxBridgeGlobal).WebApp?.initData;
  if (
    typeof bridgeValue === 'string' &&
    bridgeValue.length > 0 &&
    bridgeValue.length <= 16 * 1024
  ) {
    return bridgeValue;
  }
  const fragment = location.hash.replace(/^#\??/, '');
  if (!fragment) return null;
  const value = new URLSearchParams(fragment).get('WebAppData');
  return value && value.length <= 16 * 1024 ? value : null;
}

export function leaveMaxLaunch(): void {
  window.history.replaceState(null, '', '/#/');
}

/** Ordinary ASA Lab pages never request the MAX Mini App-only SDK.
 * A true launch waits for the Bridge before the App reads signed initData. */
export type MaxBridgeLoadResult = 'not-required' | 'loaded' | 'failed' | 'timed-out';

export function loadMaxBridgeForLaunch(
  location: Location = window.location,
  documentRef: Document = document,
  timeoutMs = 7_000,
): Promise<MaxBridgeLoadResult> {
  if (!isMaxLaunchLocation(location)) return Promise.resolve('not-required');

  return new Promise<MaxBridgeLoadResult>((resolve) => {
    const sdk = documentRef.createElement('script');
    sdk.src = 'https://st.max.ru/js/max-web-app.js';
    sdk.async = true;
    let complete = false;
    const settle = (outcome: MaxBridgeLoadResult): void => {
      if (complete) return;
      complete = true;
      clearTimeout(deadline);
      sdk.removeEventListener('load', onLoad);
      sdk.removeEventListener('error', onError);
      if (outcome !== 'loaded') sdk.remove();
      resolve(outcome);
    };
    const onLoad = (): void => settle('loaded');
    const onError = (): void => settle('failed');
    sdk.addEventListener('load', onLoad);
    sdk.addEventListener('error', onError);
    const deadline = setTimeout(() => settle('timed-out'), timeoutMs);
    try {
      documentRef.head.appendChild(sdk);
    } catch {
      settle('failed');
    }
  });
}
