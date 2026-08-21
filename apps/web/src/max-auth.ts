const MAX_LAUNCH_PATH = '/max-login';

/** MAX passes signed WebAppData in the fragment so it is not sent to servers,
 * proxies or access logs as part of the initial document request. */
export function readMaxInitData(location: Location = window.location): string | null {
  const pathname = location.pathname.replace(/\/+$/, '') || '/';
  if (pathname !== MAX_LAUNCH_PATH) return null;
  const fragment = location.hash.replace(/^#\??/, '');
  if (!fragment) return null;
  const value = new URLSearchParams(fragment).get('WebAppData');
  return value && value.length <= 16 * 1024 ? value : null;
}

export function leaveMaxLaunch(): void {
  window.history.replaceState(null, '', '/#/');
}
