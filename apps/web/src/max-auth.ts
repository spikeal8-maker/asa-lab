const MAX_LAUNCH_PATH = '/max-login';

type MaxBridgeGlobal = typeof globalThis & {
  readonly WebApp?: { readonly initData?: unknown };
};

/** MAX Bridge is the canonical source. The fragment fallback keeps older MAX
 * clients compatible without putting the signed value in an HTTP request. */
export function readMaxInitData(location: Location = window.location): string | null {
  const pathname = location.pathname.replace(/\/+$/, '') || '/';
  if (pathname !== MAX_LAUNCH_PATH) return null;
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
