// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMaxLaunchLocation, readMaxInitData } from './max-auth';
import { prepareMaxLaunch } from './max-bridge';

function location(pathname: string, hash = ''): Location {
  return { pathname, hash } as Location;
}

afterEach(() => {
  delete (globalThis as typeof globalThis & { WebApp?: unknown }).WebApp;
  document
    .querySelectorAll('script[src="https://st.max.ru/js/max-web-app.js"]')
    .forEach((script) => script.remove());
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

describe('MAX mini-app launch data', () => {
  it('recognizes the dedicated mini-app path even before Bridge supplies initData', () => {
    expect(isMaxLaunchLocation(location('/max-login'))).toBe(true);
    expect(isMaxLaunchLocation(location('/max-login/'))).toBe(true);
    expect(isMaxLaunchLocation(location('/'))).toBe(false);
  });

  it('prefers the signed value from MAX Bridge', () => {
    (globalThis as typeof globalThis & { WebApp?: unknown }).WebApp = {
      initData: 'query_id=bridge&hash=signed',
    };

    expect(
      readMaxInitData(location('/max-login', '#WebAppData=query_id%3Dlegacy%26hash%3Dold')),
    ).toBe('query_id=bridge&hash=signed');
  });

  it('keeps the fragment fallback for older clients', () => {
    expect(
      readMaxInitData(location('/max-login/', '#WebAppData=query_id%3Dlegacy%26hash%3Dsigned')),
    ).toBe('query_id=legacy&hash=signed');
  });

  it('never consumes launch data outside the dedicated route', () => {
    (globalThis as typeof globalThis & { WebApp?: unknown }).WebApp = {
      initData: 'query_id=bridge&hash=signed',
    };

    expect(readMaxInitData(location('/'))).toBeNull();
  });
});

describe('route-scoped MAX Bridge preparation', () => {
  const bridge = () =>
    document.querySelector<HTMLScriptElement>('script[src="https://st.max.ru/js/max-web-app.js"]');

  it.each(['/', '/confirm-email', '/projects/example', '/max-login-other'])(
    'does not load or wait for MAX at %s',
    (path) => {
      window.history.replaceState(null, '', path);
      expect(prepareMaxLaunch(new AbortController().signal)).toBeNull();
      expect(bridge()).toBeNull();
    },
  );

  it('uses an already supplied Bridge without a network request', () => {
    window.history.replaceState(null, '', '/max-login/');
    (globalThis as typeof globalThis & { WebApp?: unknown }).WebApp = {
      initData: 'hash=bridge',
    };
    expect(prepareMaxLaunch(new AbortController().signal)).toBeNull();
    expect(readMaxInitData()).toBe('hash=bridge');
    expect(bridge()).toBeNull();
  });

  it('does not put the remote script in the document load barrier and preserves Bridge precedence', async () => {
    window.history.replaceState(null, '', '/max-login/#WebAppData=hash%3Dlegacy');
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive');
    const ready = prepareMaxLaunch(new AbortController().signal)!;
    expect(bridge()).toBeNull();
    window.dispatchEvent(new Event('load'));
    const script = bridge()!;
    expect(script.async).toBe(true);
    (globalThis as typeof globalThis & { WebApp?: unknown }).WebApp = {
      initData: 'hash=bridge',
    };
    script.dispatchEvent(new Event('load'));
    await ready;
    expect(readMaxInitData()).toBe('hash=bridge');
    expect(bridge()).toBeNull();
  });

  it.each(['error', 'deadline'] as const)(
    'preserves the legacy fallback when the Bridge ends by %s',
    async (outcome) => {
      vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
      window.history.replaceState(null, '', '/max-login#WebAppData=hash%3Dlegacy');
      const controller = new AbortController();
      const ready = prepareMaxLaunch(controller.signal)!;
      const script = bridge()!;
      expect(script).not.toBeNull();
      if (outcome === 'error') script.dispatchEvent(new Event('error'));
      else controller.abort();
      await ready;
      expect(readMaxInitData()).toBe('hash=legacy');
      expect(bridge()).toBeNull();
    },
  );

  it('expires even if document load does not fire, without a later SDK request', async () => {
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('interactive');
    window.history.replaceState(null, '', '/max-login');
    const controller = new AbortController();
    const ready = prepareMaxLaunch(controller.signal)!;
    controller.abort();
    await ready;
    window.dispatchEvent(new Event('load'));
    expect(bridge()).toBeNull();
    expect(readMaxInitData()).toBeNull();
    expect(prepareMaxLaunch(controller.signal)).toBeNull();
    expect(bridge()).toBeNull();
  });
});
