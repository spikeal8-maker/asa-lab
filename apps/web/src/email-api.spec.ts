// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, it, expect, vi } from 'vitest';
import { emailApi } from './email-api';
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('bounds stalled public proof requests, aborts them and returns an ambiguous failure without replay', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const fetch = vi.fn((_path: unknown, init?: RequestInit) => {
    signal = init?.signal as AbortSignal;
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal('fetch', fetch);
  const result = emailApi.confirm('A'.repeat(43));
  await vi.advanceTimersByTimeAsync(15001);
  expect(await result).toEqual({ confirmed: false });
  expect(signal?.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0]![1]).toMatchObject({
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
  });
});

it('strips proof before third-party scripts, without persistent storage or an enumerable global token', () => {
  const source = readFileSync('apps/web/public/email-proof-bootstrap.js', 'utf8'),
    token = 'B'.repeat(43),
    replaceState = vi.fn();
  const window = {
    location: { pathname: '/confirm-email', hash: '#' + token },
    history: { replaceState },
  } as {
    location: { pathname: string; hash: string };
    history: { replaceState: typeof replaceState };
    __asaTakeEmailProof?: () => string;
  };
  replaceState.mockImplementation(() => {
    window.location.hash = '';
  });
  vm.runInNewContext(source, { window });
  expect(replaceState).toHaveBeenCalledWith(null, '', '/confirm-email');
  expect(Object.keys(window)).not.toContain('__asaTakeEmailProof');
  expect(JSON.stringify(window)).not.toContain(token);
  expect(window.__asaTakeEmailProof!()).toBe(token);
  expect(window.__asaTakeEmailProof).toBeUndefined();
  const html = readFileSync('apps/web/index.html', 'utf8');
  expect(html.indexOf('/email-proof-bootstrap.js')).toBeLessThan(
    html.indexOf('/runtime-config.js'),
  );
  expect(html.indexOf('/email-proof-bootstrap.js')).toBeLessThan(html.indexOf('https://st.max.ru'));
});
