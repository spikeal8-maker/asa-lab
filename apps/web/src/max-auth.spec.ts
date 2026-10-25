import { afterEach, describe, expect, it } from 'vitest';
import { isMaxLaunchLocation, loadMaxBridgeForLaunch, readMaxInitData } from './max-auth';

function location(pathname: string, hash = ''): Location {
  return { pathname, hash } as Location;
}

afterEach(() => {
  delete (globalThis as typeof globalThis & { WebApp?: unknown }).WebApp;
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

describe('conditional MAX SDK boot', () => {
  function fakeDocument() {
    const listeners: Record<string, (() => void) | undefined> = {};
    let appends = 0;
    let removed = false;
    const sdk = {
      src: '',
      async: false,
      addEventListener(type: string, listener: () => void) {
        listeners[type] = listener;
      },
      removeEventListener(type: string) {
        delete listeners[type];
      },
      remove() {
        removed = true;
      },
    } as unknown as HTMLScriptElement;
    const doc = {
      createElement: () => sdk,
      head: {
        appendChild: () => {
          appends += 1;
          return sdk;
        },
      },
    } as unknown as Document;
    return {
      doc,
      sdk,
      fire: (type: string) => listeners[type]?.(),
      appends: () => appends,
      removed: () => removed,
    };
  }

  it('makes no SDK request for ordinary home/projects/editor paths', async () => {
    const fake = fakeDocument();
    for (const path of ['/', '/home', '/projects']) {
      expect(await loadMaxBridgeForLaunch(location(path), fake.doc)).toBe('not-required');
    }
    expect(fake.appends()).toBe(0);
  });

  it('injects the official SDK and resolves only after the Bridge load', async () => {
    const fake = fakeDocument();
    const result = loadMaxBridgeForLaunch(location('/max-login'), fake.doc);
    expect(fake.appends()).toBe(1);
    expect(fake.sdk.src).toBe('https://st.max.ru/js/max-web-app.js');
    expect(fake.sdk.async).toBe(true);
    fake.fire('load');
    expect(await result).toBe('loaded');
    expect(fake.removed()).toBe(false);
  });

  it('reports a network error without manufacturing signed launch data', async () => {
    const fake = fakeDocument();
    const result = loadMaxBridgeForLaunch(location('/max-login/'), fake.doc);
    fake.fire('error');
    expect(await result).toBe('failed');
    expect(fake.removed()).toBe(true);
    expect(readMaxInitData(location('/max-login'))).toBeNull();
  });
});
