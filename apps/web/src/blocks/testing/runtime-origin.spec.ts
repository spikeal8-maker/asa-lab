// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlocksEditor } from '../BlocksEditor';

const environment = globalThis as typeof globalThis & {
  jsdom: { reconfigure(options: { url: string }): void };
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
const initialUrl = window.location.href;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

function editor() {
  return createElement(BlocksEditor, {
    projectId: '11111111-1111-4111-8111-111111111111',
    recoveryPrincipalKey: '33333333-3333-4333-8333-333333333333',
    onBack: vi.fn(),
    onHomeClick: vi.fn(),
    onAccountClick: vi.fn(),
    accountLabel: 'ASA test user',
    accountInitials: 'AT',
  });
}

async function assertLocalRuntime(origin: string, foreign?: string) {
  environment.jsdom.reconfigure({ url: `${origin}/product` });
  expect(window.location.origin).toBe(origin);
  // jsdom 26 caches the previous document base when reconfiguring its URL.
  // Keep relative URL resolution aligned with the real application origin.
  const base = document.createElement('base');
  base.href = `${origin}/`;
  document.head.append(base);
  const html = renderToStaticMarkup(editor());
  const markup = document.createElement('div');
  markup.innerHTML = html;
  const initialFrame = markup.querySelector('iframe');
  expect(initialFrame).not.toBeNull();
  expect(initialFrame!.hasAttribute('src')).toBe(false);
  expect(initialFrame!.hasAttribute('srcdoc')).toBe(false);
  expect(html).toContain('Загружаем рабочую среду');
  expect(html).not.toContain('role="alert"');
  if (foreign) expect(html).not.toContain(foreign);

  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({
          runtimeOrigin: origin,
          runtimeToken: 'test.runtime.capability',
          expiresAt: Math.floor(Date.now() / 1000) + 300,
          draftRevision: 1,
          projectJson: null,
          assets: [],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json', date: new Date().toUTCString() },
        },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(editor()));
  const frame = container.querySelector('iframe');
  expect(frame).not.toBeNull();
  expect(frame!.getAttribute('src')).toMatch(
    /^\/internal\/blocks\/\?asaStatus=parent&diagnosticInstance=[a-f0-9-]{36}$/,
  );
  expect(new URL(frame!.src).origin).toBe(origin);
  if (foreign) expect(frame!.src).not.toContain(foreign);

  const postMessage = vi.spyOn(frame!.contentWindow!, 'postMessage').mockImplementation(() => {});
  await act(async () => {
    frame!.dispatchEvent(new Event('load'));
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
  });
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/blocks/runtime-session')),
  ).toHaveLength(1);
  const initCalls = postMessage.mock.calls.filter(
    ([message]) => (message as Record<string, unknown>)['messageType'] === 'ASA_BLOCKS_INIT',
  );
  expect(initCalls).toHaveLength(1);
  expect(initCalls[0]![0]).toMatchObject({
    apiOrigin: origin,
    runtimeToken: 'test.runtime.capability',
  });
  expect(initCalls[0]![1]).toBe(origin);
  expect(postMessage.mock.calls.every(([, targetOrigin]) => targetOrigin === origin)).toBe(true);
}

describe('BlocksEditor single ASA entry', () => {
  beforeAll(() => {
    environment.IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => {
    environment.IS_REACT_ACT_ENVIRONMENT = false;
  });
  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    document.head.querySelector('base')?.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    environment.jsdom.reconfigure({ url: initialUrl });
  });
  it.each(['http://127.0.0.1:4610', 'https://asa-lab.ru', 'https://school.example.test'])(
    'embeds the editor within %s without another origin or port',
    async (origin) => assertLocalRuntime(origin),
  );
  it.each(['https://scratch.example.test', 'http://localhost:4613', 'javascript:alert(1)'])(
    'never sends editor capabilities to legacy configuration %s',
    async (foreign) => {
      vi.stubGlobal('__ASA_RUNTIME_CONFIG__', { blocksRuntimeOrigin: foreign });
      vi.stubGlobal('__ASA_BLOCKS_RUNTIME_ORIGIN__', foreign);
      await assertLocalRuntime('https://asa-lab.ru', foreign);
    },
  );
  it.each(['null', 'file://', 'javascript:alert(1)'])(
    'does not create an editor outside an HTTP(S) application: %s',
    (origin) => {
      vi.stubGlobal('window', { location: { origin } });
      const html = renderToStaticMarkup(editor());
      expect(html).not.toContain('<iframe');
      expect(html).toContain('Откройте проект через приложение ASA Lab.');
    },
  );
});
