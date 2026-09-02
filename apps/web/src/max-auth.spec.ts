import { afterEach, describe, expect, it } from 'vitest';
import { readMaxInitData } from './max-auth';

function location(pathname: string, hash = ''): Location {
  return { pathname, hash } as Location;
}

afterEach(() => {
  delete (globalThis as typeof globalThis & { WebApp?: unknown }).WebApp;
});

describe('MAX mini-app launch data', () => {
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
