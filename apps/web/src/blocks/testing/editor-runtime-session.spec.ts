// @vitest-environment jsdom

import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlocksEditor } from '../BlocksEditor';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const RUNTIME_ORIGIN = 'http://127.0.0.1:4613';
const reactTestGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

function session(runtimeToken = 'real.runtime.token', expiresAt = 4_000_000_000) {
  return {
    runtimeOrigin: RUNTIME_ORIGIN,
    runtimeToken,
    expiresAt,
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

async function renderEditor(
  overrides: Partial<ComponentProps<typeof BlocksEditor>> = {},
): Promise<HTMLIFrameElement> {
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
        ...overrides,
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
  vi.useRealTimers();
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

  it('exposes one parent-owned explicit save and distinguishes success, failure and conflict', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(session())),
    );
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);
    await fireLoad(iframe);

    const init = initCalls(postMessage)[0]?.[0] as Record<string, unknown>;
    const childMessage = (extra: Record<string, unknown>) => ({
      protocolVersion: init['protocolVersion'],
      projectId: init['projectId'],
      sessionNonce: init['sessionNonce'],
      ...extra,
    });
    const dispatchChild = async (extra: Record<string, unknown>): Promise<void> => {
      await act(async () => {
        const event = new MessageEvent('message', {
          data: childMessage(extra),
          origin: RUNTIME_ORIGIN,
        });
        Object.defineProperty(event, 'source', { value: iframe.contentWindow });
        window.dispatchEvent(event);
        await flushAsync();
      });
    };

    const save = Array.from(container!.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Сохранить в ASA'),
    );
    if (!save) throw new Error('Save control was not rendered');
    expect(save.disabled).toBe(true);

    await dispatchChild({ messageType: 'ASA_BLOCKS_STATUS', status: 'editor-ready' });
    expect(save.disabled).toBe(false);

    await act(async () => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushAsync();
    });
    const flushCalls = () =>
      postMessage.mock.calls.filter(
        ([message]) =>
          (message as Record<string, unknown>)?.['messageType'] === 'ASA_BLOCKS_FLUSH_REQUEST',
      );
    expect(flushCalls()).toHaveLength(1);
    const firstRequest = flushCalls()[0]?.[0] as Record<string, unknown>;
    expect(firstRequest['requestId']).toMatch(/^[0-9a-f-]{36}$/i);
    expect(save.textContent).toContain('Сохранение…');
    expect(save.disabled).toBe(true);

    await act(async () => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushAsync();
    });
    expect(flushCalls()).toHaveLength(1);

    await dispatchChild({
      messageType: 'ASA_BLOCKS_FLUSH_RESULT',
      requestId: firstRequest['requestId'],
      ok: true,
      reason: null,
      revision: 18,
      snapshotGeneration: 0,
    });
    expect(save.textContent).toContain('Сохранено');
    expect(save.getAttribute('aria-label')).toBe('Сохранено в ASA, ревизия 18');
    expect(save.getAttribute('data-confirmed-revision')).toBe('18');

    await dispatchChild({
      messageType: 'ASA_BLOCKS_STATUS',
      status: 'project-dirty',
      generation: 1,
    });
    expect(save.textContent).toContain('Сохранить в ASA');
    expect(save.getAttribute('data-confirmed-revision')).toBeNull();
    expect(flushCalls()).toHaveLength(1);

    await act(async () => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushAsync();
    });
    const secondRequest = flushCalls()[1]?.[0] as Record<string, unknown>;
    expect(secondRequest['requestId']).not.toBe(firstRequest['requestId']);
    await dispatchChild({
      messageType: 'ASA_BLOCKS_FLUSH_RESULT',
      requestId: secondRequest['requestId'],
      ok: false,
      reason: 'revision_conflict',
    });
    expect(save.textContent).toContain('Конфликт сохранения');

    await act(async () => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushAsync();
    });
    const thirdRequest = flushCalls()[2]?.[0] as Record<string, unknown>;
    await dispatchChild({
      messageType: 'ASA_BLOCKS_FLUSH_RESULT',
      requestId: thirdRequest['requestId'],
      ok: false,
      reason: 'draft_write_failed',
    });
    expect(save.textContent).toContain('Ошибка сохранения');
  });

  it('refreshes expiring authority before Save with TOKEN_UPDATE then FLUSH and no second INIT', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const nowSeconds = Math.floor(Date.now() / 1000);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(session('initial.runtime.token', nowSeconds + 30)))
      .mockResolvedValueOnce(jsonResponse(session('fresh.runtime.token', nowSeconds + 600)));
    vi.stubGlobal('fetch', fetchMock);
    const storageSet = vi.spyOn(Storage.prototype, 'setItem');
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);
    await fireLoad(iframe);

    const init = initCalls(postMessage)[0]?.[0] as Record<string, unknown>;
    const dispatchChild = async (extra: Record<string, unknown>): Promise<void> => {
      await act(async () => {
        const event = new MessageEvent('message', {
          data: {
            protocolVersion: init['protocolVersion'],
            projectId: init['projectId'],
            sessionNonce: init['sessionNonce'],
            ...extra,
          },
          origin: RUNTIME_ORIGIN,
        });
        Object.defineProperty(event, 'source', { value: iframe.contentWindow });
        window.dispatchEvent(event);
        await flushAsync();
      });
    };
    await dispatchChild({ messageType: 'ASA_BLOCKS_STATUS', status: 'editor-ready' });

    const save = container!.querySelector<HTMLButtonElement>('[data-asa-blocks-save]');
    if (!save) throw new Error('Save control was not rendered');
    await act(async () => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushAsync();
    });

    const messages = postMessage.mock.calls.map(([message]) => message as Record<string, unknown>);
    const updateIndex = messages.findIndex(
      (message) => message['messageType'] === 'ASA_BLOCKS_TOKEN_UPDATE',
    );
    const flushIndex = messages.findIndex(
      (message) => message['messageType'] === 'ASA_BLOCKS_FLUSH_REQUEST',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(initCalls(postMessage)).toHaveLength(1);
    expect(updateIndex).toBeGreaterThan(0);
    expect(flushIndex).toBeGreaterThan(updateIndex);
    expect(messages[updateIndex]).toMatchObject({
      runtimeToken: 'fresh.runtime.token',
      sessionNonce: init['sessionNonce'],
    });
    expect(messages[flushIndex]).toMatchObject({ sessionNonce: init['sessionNonce'] });
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('keeps proactive refresh single-flight when Save joins an in-flight rotation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const nowSeconds = Math.floor(Date.now() / 1000);
    let resolveRefresh!: (value: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(session('initial.runtime.token', nowSeconds + 61)))
      .mockReturnValueOnce(refreshResponse);
    vi.stubGlobal('fetch', fetchMock);
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);
    await fireLoad(iframe);
    const init = initCalls(postMessage)[0]?.[0] as Record<string, unknown>;

    await act(async () => {
      const event = new MessageEvent('message', {
        data: {
          protocolVersion: init['protocolVersion'],
          projectId: init['projectId'],
          sessionNonce: init['sessionNonce'],
          messageType: 'ASA_BLOCKS_STATUS',
          status: 'editor-ready',
        },
        origin: RUNTIME_ORIGIN,
      });
      Object.defineProperty(event, 'source', { value: iframe.contentWindow });
      window.dispatchEvent(event);
      await vi.advanceTimersByTimeAsync(1_000);
      await flushAsync();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const save = container!.querySelector<HTMLButtonElement>('[data-asa-blocks-save]');
    if (!save) throw new Error('Save control was not rendered');
    await act(async () => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushAsync();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveRefresh(jsonResponse(session('fresh.runtime.token', nowSeconds + 600)));
      await flushAsync();
    });
    const messages = postMessage.mock.calls.map(([message]) => message as Record<string, unknown>);
    expect(
      messages.filter((message) => message['messageType'] === 'ASA_BLOCKS_TOKEN_UPDATE'),
    ).toHaveLength(1);
    expect(
      messages.filter((message) => message['messageType'] === 'ASA_BLOCKS_FLUSH_REQUEST'),
    ).toHaveLength(1);
  });

  it.each([401, 503])(
    'fails Save closed when mandatory capability refresh returns %s',
    async (status) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
      const nowSeconds = Math.floor(Date.now() / 1000);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(session('initial.runtime.token', nowSeconds + 30)))
        .mockResolvedValueOnce(jsonResponse({}, status));
      vi.stubGlobal('fetch', fetchMock);
      const iframe = await renderEditor();
      const postMessage = spyOnPostMessage(iframe);
      await fireLoad(iframe);
      const init = initCalls(postMessage)[0]?.[0] as Record<string, unknown>;

      await act(async () => {
        const event = new MessageEvent('message', {
          data: {
            protocolVersion: init['protocolVersion'],
            projectId: init['projectId'],
            sessionNonce: init['sessionNonce'],
            messageType: 'ASA_BLOCKS_STATUS',
            status: 'editor-ready',
          },
          origin: RUNTIME_ORIGIN,
        });
        Object.defineProperty(event, 'source', { value: iframe.contentWindow });
        window.dispatchEvent(event);
        await flushAsync();
      });
      const save = container!.querySelector<HTMLButtonElement>('[data-asa-blocks-save]');
      if (!save) throw new Error('Save control was not rendered');
      await act(async () => {
        save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flushAsync();
      });
      const messages = postMessage.mock.calls.map(
        ([message]) => message as Record<string, unknown>,
      );
      expect(
        messages.filter((message) => message['messageType'] === 'ASA_BLOCKS_TOKEN_UPDATE'),
      ).toHaveLength(0);
      expect(
        messages.filter((message) => message['messageType'] === 'ASA_BLOCKS_FLUSH_REQUEST'),
      ).toHaveLength(0);
      expect(save.textContent).toContain('Ошибка сохранения');
    },
  );

  it('does not extend revoked authority when refresh returns 404', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const nowSeconds = Math.floor(Date.now() / 1000);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(session('initial.runtime.token', nowSeconds + 30)))
      .mockResolvedValueOnce(jsonResponse({}, 404));
    vi.stubGlobal('fetch', fetchMock);
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);
    await fireLoad(iframe);
    const init = initCalls(postMessage)[0]?.[0] as Record<string, unknown>;

    await act(async () => {
      const event = new MessageEvent('message', {
        data: {
          protocolVersion: init['protocolVersion'],
          projectId: init['projectId'],
          sessionNonce: init['sessionNonce'],
          messageType: 'ASA_BLOCKS_STATUS',
          status: 'editor-ready',
        },
        origin: RUNTIME_ORIGIN,
      });
      Object.defineProperty(event, 'source', { value: iframe.contentWindow });
      window.dispatchEvent(event);
      await flushAsync();
    });
    const save = container!.querySelector<HTMLButtonElement>('[data-asa-blocks-save]');
    if (!save) throw new Error('Save control was not rendered');
    await act(async () => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushAsync();
    });
    const messages = postMessage.mock.calls.map(([message]) => message as Record<string, unknown>);
    expect(
      messages.filter((message) => message['messageType'] === 'ASA_BLOCKS_TOKEN_UPDATE'),
    ).toHaveLength(0);
    expect(
      messages.filter((message) => message['messageType'] === 'ASA_BLOCKS_FLUSH_REQUEST'),
    ).toHaveLength(0);
    expect(save.textContent).toContain('Ошибка сохранения');
  });

  it.each(['malformed', 'wrong-origin'])(
    'rejects %s mandatory refresh without TOKEN_UPDATE or FLUSH',
    async (kind) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
      const nowSeconds = Math.floor(Date.now() / 1000);
      const invalid =
        kind === 'malformed'
          ? { ...session('fresh.runtime.token', nowSeconds + 600), runtimeToken: 'not-a-token' }
          : {
              ...session('fresh.runtime.token', nowSeconds + 600),
              runtimeOrigin: 'http://127.0.0.1:4614',
            };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(session('initial.runtime.token', nowSeconds + 30)))
        .mockResolvedValueOnce(jsonResponse(invalid));
      vi.stubGlobal('fetch', fetchMock);
      const iframe = await renderEditor();
      const postMessage = spyOnPostMessage(iframe);
      await fireLoad(iframe);
      const init = initCalls(postMessage)[0]?.[0] as Record<string, unknown>;

      await act(async () => {
        const event = new MessageEvent('message', {
          data: {
            protocolVersion: init['protocolVersion'],
            projectId: init['projectId'],
            sessionNonce: init['sessionNonce'],
            messageType: 'ASA_BLOCKS_STATUS',
            status: 'editor-ready',
          },
          origin: RUNTIME_ORIGIN,
        });
        Object.defineProperty(event, 'source', { value: iframe.contentWindow });
        window.dispatchEvent(event);
        await flushAsync();
      });
      const save = container!.querySelector<HTMLButtonElement>('[data-asa-blocks-save]');
      if (!save) throw new Error('Save control was not rendered');
      await act(async () => {
        save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await flushAsync();
      });
      const messages = postMessage.mock.calls.map(
        ([message]) => message as Record<string, unknown>,
      );
      expect(
        messages.filter((message) => message['messageType'] === 'ASA_BLOCKS_TOKEN_UPDATE'),
      ).toHaveLength(0);
      expect(
        messages.filter((message) => message['messageType'] === 'ASA_BLOCKS_FLUSH_REQUEST'),
      ).toHaveLength(0);
      expect(save.textContent).toContain('Ошибка сохранения');
    },
  );

  it('ignores stale refresh response after iframe reload', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const nowSeconds = Math.floor(Date.now() / 1000);
    let resolveRefresh!: (value: Response) => void;
    const staleRefresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(session('initial.runtime.token', nowSeconds + 30)))
      .mockReturnValueOnce(staleRefresh)
      .mockResolvedValueOnce(jsonResponse(session('reload.runtime.token', nowSeconds + 600)));
    vi.stubGlobal('fetch', fetchMock);
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);
    await fireLoad(iframe);
    const firstInit = initCalls(postMessage)[0]?.[0] as Record<string, unknown>;

    await act(async () => {
      const event = new MessageEvent('message', {
        data: {
          protocolVersion: firstInit['protocolVersion'],
          projectId: firstInit['projectId'],
          sessionNonce: firstInit['sessionNonce'],
          messageType: 'ASA_BLOCKS_STATUS',
          status: 'editor-ready',
        },
        origin: RUNTIME_ORIGIN,
      });
      Object.defineProperty(event, 'source', { value: iframe.contentWindow });
      window.dispatchEvent(event);
      await flushAsync();
    });
    const save = container!.querySelector<HTMLButtonElement>('[data-asa-blocks-save]');
    if (!save) throw new Error('Save control was not rendered');
    await act(async () => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushAsync();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await fireLoad(iframe);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(async () => {
      resolveRefresh(jsonResponse(session('stale.runtime.token', nowSeconds + 600)));
      await flushAsync();
    });

    const messages = postMessage.mock.calls.map(([message]) => message as Record<string, unknown>);
    expect(initCalls(postMessage)).toHaveLength(2);
    expect(
      messages.some(
        (message) =>
          message['messageType'] === 'ASA_BLOCKS_TOKEN_UPDATE' &&
          message['runtimeToken'] === 'stale.runtime.token',
      ),
    ).toBe(false);
    expect(
      messages.filter((message) => message['messageType'] === 'ASA_BLOCKS_FLUSH_REQUEST'),
    ).toHaveLength(0);
  });

  it('does not claim current VM saved when a newer dirty generation arrives during Save', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(session())),
    );
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);
    await fireLoad(iframe);
    const init = initCalls(postMessage)[0]?.[0] as Record<string, unknown>;
    const dispatchChild = async (extra: Record<string, unknown>): Promise<void> => {
      await act(async () => {
        const event = new MessageEvent('message', {
          data: {
            protocolVersion: init['protocolVersion'],
            projectId: init['projectId'],
            sessionNonce: init['sessionNonce'],
            ...extra,
          },
          origin: RUNTIME_ORIGIN,
        });
        Object.defineProperty(event, 'source', { value: iframe.contentWindow });
        window.dispatchEvent(event);
        await flushAsync();
      });
    };
    await dispatchChild({ messageType: 'ASA_BLOCKS_STATUS', status: 'editor-ready' });
    await dispatchChild({
      messageType: 'ASA_BLOCKS_STATUS',
      status: 'project-dirty',
      generation: 5,
    });

    const save = container!.querySelector<HTMLButtonElement>('[data-asa-blocks-save]');
    if (!save) throw new Error('Save control was not rendered');
    await act(async () => {
      save.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushAsync();
    });
    const flushCalls = postMessage.mock.calls.filter(
      ([message]) =>
        (message as Record<string, unknown>)?.['messageType'] === 'ASA_BLOCKS_FLUSH_REQUEST',
    );
    const request = flushCalls[0]?.[0] as Record<string, unknown>;
    await dispatchChild({
      messageType: 'ASA_BLOCKS_STATUS',
      status: 'project-dirty',
      generation: 6,
    });
    await dispatchChild({
      messageType: 'ASA_BLOCKS_FLUSH_RESULT',
      requestId: request['requestId'],
      ok: true,
      reason: null,
      revision: 18,
      snapshotGeneration: 5,
    });

    expect(save.textContent).toContain('Сохранить в ASA');
    expect(save.getAttribute('data-confirmed-revision')).toBeNull();
    expect(flushCalls).toHaveLength(1);
  });

  it('uses the explicit ASA save warning before leaving', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(session())),
    );
    const onHomeClick = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const iframe = await renderEditor({ onHomeClick });
    spyOnPostMessage(iframe);
    await fireLoad(iframe);

    const home = container!.querySelector<HTMLButtonElement>('[data-asa-blocks-home-overlay]');
    if (!home) throw new Error('Home control was not rendered');
    await act(async () => {
      home.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flushAsync();
    });

    expect(confirm).toHaveBeenCalledWith(
      'Несохранённые изменения могут быть потеряны. Перед выходом используйте «Сохранить в ASA». Выйти?',
    );
    expect(onHomeClick).toHaveBeenCalledTimes(1);
  });
});
