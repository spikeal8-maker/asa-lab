const MAX_LAUNCH_PATH = '/max-login';

type MaxBridgeGlobal = typeof globalThis & {
  readonly WebApp?: { readonly initData?: unknown };
};

export function isMaxLaunchLocation(location: Location = window.location): boolean {
  return location.pathname.replace(/\/+$/, '') === MAX_LAUNCH_PATH;
}

export function readBridgeInitData(): string | null {
  const value = (globalThis as MaxBridgeGlobal).WebApp?.initData;
  return typeof value === 'string' && value.length && value.length <= 16 * 1024 ? value : null;
}

/** MAX Bridge is the canonical source. The fragment fallback keeps older MAX
 * clients compatible without putting the signed value in an HTTP request. */
export function readMaxInitData(location: Location = window.location): string | null {
  if (!isMaxLaunchLocation(location)) return null;
  const value =
    readBridgeInitData() ??
    new URLSearchParams(location.hash.replace(/^#\??/, '')).get('WebAppData');
  return value && value.length <= 16 * 1024 ? value : null;
}

export function leaveMaxLaunch(): void {
  window.history.replaceState(null, '', '/#/');
}
