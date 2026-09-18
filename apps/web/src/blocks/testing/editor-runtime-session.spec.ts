// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlocksEditor } from '../BlocksEditor';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const RUNTIME_ORIGIN = 'http://127.0.0.1:4613';
const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

function session(runtimeToken = 'real.runtime.token') {
  return {
    runtimeOrigin: RUNTIME_ORIGIN,
    runtimeToken,
    expiresAt: 4_000_000_000,
    draftRevision: 17,
    projectJson: { targets: [], monitors: [], extensions: [] },
    assets: [
      {
        assetId: 'a'.repeat(32),
        dataFormat: 'png',
        sha256: 'b'.repeat(64),
        sizeBytes: 123,
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function spyOnPostMessage(iframe: HTMLIFrameElement) {
  return vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => undefined);
}

function initCalls(postMessage: ReturnType<typeof vi.spyOn>) {
  return postMessage.mock.calls.filter(
    ([message]) => (message as Record<string, unknown>)?.['messageType'] === 'ASA_BLOCKS_INIT',
  );
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderEditor(): Promise<HTMLIFrameElement> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      createElement(BlocksEditor, {
        projectId: PROJECT_ID,
        onBack: vi.fn(),
        onHomeClick: vi.fn(),
        accountLabel: 'ASA test user',
        accountInitials: 'AT',
        onAccountClick: vi.fn(),
      }),
    );
    await flushAsync();
  });
  const iframe = container.querySelector('iframe');
  if (!iframe) throw new Error('Scratch iframe was not rendered');
  return iframe;
}

async function fireLoad(iframe: HTMLIFrameElement): Promise<void> {
  await act(async () => {
    iframe.dispatchEvent(new Event('load'));
    await flushAsync();
  });
}

beforeAll(() => {
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  reactTestGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});

beforeEach(() => {
  vi.stubGlobal('__ASA_BLOCKS_RUNTIME_ORIGIN__', RUNTIME_ORIGIN);
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('BlocksEditor runtime session bootstrap', () => {
  it('sends real bootstrap values in INIT without persisting the capability', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(session()));
    vi.stubGlobal('fetch', fetchMock);
    const storageSet = vi.spyOn(Storage.prototype, 'setItem');
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);

    await fireLoad(iframe);

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/blocks/runtime-session`,
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        body: '{}',
      }),
    );
    expect(initCalls(postMessage)).toHaveLength(1);
    expect(initCalls(postMessage)[0]?.[0]).toMatchObject({
      messageType: 'ASA_BLOCKS_INIT',
      projectId: PROJECT_ID,
      runtimeToken: 'real.runtime.token',
      draftRevision: 17,
      projectJson: session().projectJson,
      hasProjectJson: true,
      assets: session().assets,
      apiOrigin: window.location.origin,
    });
    expect(initCalls(postMessage)[0]?.[1]).toBe(RUNTIME_ORIGIN);
    expect(storageSet).not.toHaveBeenCalled();
  });

  it.each([401, 404, 409, 503])('does not INIT when runtime-session returns %s', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}, status)),
    );
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);

    await fireLoad(iframe);

    expect(initCalls(postMessage)).toHaveLength(0);
    expect(container?.textContent).toContain('Ошибка Scratch runtime');
  });

  it('does not INIT when the runtime-session request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network unavailable');
      }),
    );
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);

    await fireLoad(iframe);

    expect(initCalls(postMessage)).toHaveLength(0);
    expect(container?.textContent).toContain('Ошибка Scratch runtime');
  });

  it('fails closed when a successful response is malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          ...session(),
          runtimeToken: 'not-a-compact-jwt',
        }),
      ),
    );
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);

    await fireLoad(iframe);

    expect(initCalls(postMessage)).toHaveLength(0);
    expect(container?.textContent).toContain('Ошибка Scratch runtime');
  });

  it('fails closed when API runtimeOrigin differs from configured Scratch origin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          ...session(),

          runtimeOrigin: 'http://127.0.0.1:4614',
        }),
      ),
    );
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);

    await fireLoad(iframe);

    expect(initCalls(postMessage)).toHaveLength(0);
    expect(container?.textContent).toContain('Ошибка Scratch runtime');
  });

  it('requests a new capability after retry instead of reusing a failed session', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse(session('fresh.runtime.token')));
    vi.stubGlobal('fetch', fetchMock);
    const firstIframe = await renderEditor();
    const firstPostMessage = spyOnPostMessage(firstIframe);

    await fireLoad(firstIframe);
    expect(initCalls(firstPostMessage)).toHaveLength(0);

    const retry = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Повторить подключение'),
    );

    if (!retry) throw new Error('Retry button was not rendered');
    await act(async () => {
      retry.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushAsync();
    });

    const secondIframe = container!.querySelector('iframe');
    if (!secondIframe || secondIframe === firstIframe)
      throw new Error('Retry did not reload iframe');
    const secondPostMessage = spyOnPostMessage(secondIframe);
    await fireLoad(secondIframe);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(initCalls(secondPostMessage)).toHaveLength(1);
    expect(initCalls(secondPostMessage)[0]?.[0]).toMatchObject({
      runtimeToken: 'fresh.runtime.token',
    });
  });

  it('ignores an older runtime-session response after a newer iframe load', async () => {
    let resolveFirst!: (value: Response) => void;
    let resolveSecond!: (value: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<Response>((resolve) => {
      resolveSecond = resolve;
    });

    const fetchMock = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    vi.stubGlobal('fetch', fetchMock);
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);

    await act(async () => {
      iframe.dispatchEvent(new Event('load'));
      iframe.dispatchEvent(new Event('load'));
      await flushAsync();
    });
    await act(async () => {
      resolveSecond(jsonResponse(session('newer.runtime.token')));
      await flushAsync();
    });
    await act(async () => {
      resolveFirst(jsonResponse(session('stale.runtime.token')));
      await flushAsync();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(initCalls(postMessage)).toHaveLength(1);
    expect(initCalls(postMessage)[0]?.[0]).toMatchObject({
      runtimeToken: 'newer.runtime.token',
    });
  });
});
