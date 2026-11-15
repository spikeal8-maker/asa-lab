// @vitest-environment jsdom

import { act, createElement, StrictMode, useLayoutEffect, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlocksEditor } from '../BlocksEditor';
import { setTelemetryContext } from '../../telemetry-context';
const TELEMETRY_ACTOR = {
  kind: 'account' as const,
  accountId: '33333333-3333-4333-8333-333333333333',
  workspaceId: '55555555-5555-4555-8555-555555555555',
};
function telemetryResponse(input: RequestInfo | URL, options?: RequestInit): Response | null {
  const path = String(input);
  if (path === '/api/diagnostics/client') return jsonResponse({ accepted: true }, 202);
  if (path === '/api/diagnostics/quality') {
    const body = JSON.parse(options?.body as string) as Record<string, unknown>;
    return jsonResponse(
      {
        accepted: true,
        state: 'intake_acknowledged',
        schemaVersion: 2,
        eventId: body['eventId'],
        streamId: body['streamId'],
        sequence: body['sequence'],
        pipeline: body['pipeline'],
        acknowledgementStage: body['acknowledgementStage'],
      },
      202,
    );
  }
  if (!path.startsWith('/api/analytics/v2/')) return null;
  const body = JSON.parse(options?.body as string) as Record<string, unknown>;
  return jsonResponse({
    accepted: true,
    state: 'persisted',
    schemaVersion: 2,
    eventId: body['eventId'],
    receiptId: body['eventId'],
    operation: body['operation'] ?? body['eventType'] ?? 'quality',
    receivedAt: new Date().toISOString(),
    persistedAt: new Date().toISOString(),
    ...(body['operation']
      ? {
          sessionId: body['sessionId'],
          result: {
            creditedSeconds: 0,
            creditedFrom: null,
            creditedTo: null,
            sessionState: body['operation'] === 'close' ? 'closed' : 'open',
          },
        }
      : body['pipeline']
        ? {
            streamId: body['streamId'],
            sequence: body['sequence'],
            pipeline: body['pipeline'],
            acknowledgementStage: body['acknowledgementStage'],
          }
        : { recordId: 1 }),
  });
}

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const RUNTIME_ORIGIN = window.location.origin;
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
    headers: { 'content-type': 'application/json', date: new Date().toUTCString() },
  });
}

function spyOnPostMessage(iframe: HTMLIFrameElement) {
  return vi.spyOn(iframe.contentWindow!, 'postMessage').mockImplementation(() => undefined);
}

function initCalls(postMessage: ReturnType<typeof vi.spyOn>) {
  return postMessage.mock.calls.filter(
    ([message]: unknown[]) =>
      (message as Record<string, unknown>)?.['messageType'] === 'ASA_BLOCKS_INIT',
  );
}

async function dispatchChild(
  iframe: HTMLIFrameElement,
  init: Record<string, unknown>,
  extra: Record<string, unknown>,
): Promise<void> {
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
}

async function flushAsync(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderEditor(
  overrides: Partial<ComponentProps<typeof BlocksEditor>> = {},
  onLayout?: (iframe: HTMLIFrameElement) => void,
  strictMode = false,
): Promise<HTMLIFrameElement> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);

  const editor = createElement(BlocksEditor, {
    projectId: PROJECT_ID,
    recoveryPrincipalKey: '33333333-3333-4333-8333-333333333333',
    onBack: vi.fn(),
    onHomeClick: vi.fn(),
    accountLabel: 'ASA test user',
    accountInitials: 'AT',
    onAccountClick: vi.fn(),
    ...overrides,
  });
  function CommitProbe() {
    useLayoutEffect(() => {
      const iframe = container!.querySelector('iframe');
      if (!iframe) throw new Error('Scratch iframe missing during commit');
      onLayout?.(iframe);
    }, []);
    return editor;
  }
  await act(async () => {
    const rendered = onLayout ? createElement(CommitProbe) : editor;
    root?.render(strictMode ? createElement(StrictMode, null, rendered) : rendered);
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
  setTelemetryContext(null, true, 'public');
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('BlocksEditor runtime session bootstrap', () => {
  it('starts cached runtime navigation only after DOM insertion and identity layout', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async (input, options) => telemetryResponse(input, options) ?? jsonResponse(session()),
    );
    vi.stubGlobal('fetch', fetchMock);
    const appendChild = Node.prototype.appendChild;
    const srcSetter = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')!.set!;
    let loaded = false;
    let ancestorLayoutComplete = false;
    let navigatedDuringInsertion = false;
    let postMessage!: ReturnType<typeof spyOnPostMessage>;
    vi.spyOn(Node.prototype, 'appendChild').mockImplementation(function <T extends Node>(
      this: Node,
      child: T,
    ): T {
      const result = appendChild.call(this, child) as T;
      const frame =
        child instanceof HTMLIFrameElement
          ? child
          : child instanceof Element
            ? child.querySelector('iframe')
            : null;
      if (!loaded && frame?.isConnected) {
        loaded = true;
        navigatedDuringInsertion = frame.hasAttribute('src');
        frame.dispatchEvent(new Event('load'));
      }
      return result;
    });
    vi.spyOn(HTMLIFrameElement.prototype, 'src', 'set').mockImplementation(function (
      this: HTMLIFrameElement,
      value: string,
    ) {
      expect(ancestorLayoutComplete).toBe(true);
      srcSetter.call(this, value);
      postMessage = spyOnPostMessage(this);
      // A cached real navigation may finish synchronously from the setter.
      this.dispatchEvent(new Event('load'));
    });
    const iframe = await renderEditor({}, () => {
      expect(loaded).toBe(true);
      ancestorLayoutComplete = true;
    });
    expect(loaded).toBe(true);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/blocks/runtime-session')),
    ).toHaveLength(1);
    expect(initCalls(postMessage)).toHaveLength(1);
    expect(navigatedDuringInsertion).toBe(false);
    const init = initCalls(postMessage)[0]![0] as Record<string, unknown>;
    await dispatchChild(iframe, init, { messageType: 'ASA_BLOCKS_STATUS', status: 'editor-ready' });
    expect(
      container!.querySelector<HTMLElement>('[data-asa-blocks-loading-overlay]')?.dataset.state,
    ).toBe('ready');
  });

  it('ignores the initial blank load before passive effects and bootstraps the real runtime', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async (input, options) => telemetryResponse(input, options) ?? jsonResponse(session()),
    );
    vi.stubGlobal('fetch', fetchMock);
    const iframe = await renderEditor({}, (frame) => {
      expect(frame.hasAttribute('src')).toBe(false);
      frame.dispatchEvent(new Event('load'));
    });
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/blocks/runtime-session')),
    ).toHaveLength(0);
    const postMessage = spyOnPostMessage(iframe);
    await fireLoad(iframe);
    const grants = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/blocks/runtime-session'),
    );
    expect(grants).toHaveLength(1);
    expect(initCalls(postMessage)).toHaveLength(1);
    const init = initCalls(postMessage)[0]![0] as Record<string, unknown>;
    await dispatchChild(iframe, init, { messageType: 'ASA_BLOCKS_STATUS', status: 'editor-ready' });
    expect(
      container!.querySelector<HTMLElement>('[data-asa-blocks-loading-overlay]')?.dataset.state,
    ).toBe('ready');
  });

  it('reuses one real navigation through StrictMode replay and ignores load after disposal', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async (input, options) => telemetryResponse(input, options) ?? jsonResponse(session()),
    );
    vi.stubGlobal('fetch', fetchMock);
    const srcSetter = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')!.set!;
    let navigations = 0;
    let postMessage!: ReturnType<typeof spyOnPostMessage>;
    vi.spyOn(HTMLIFrameElement.prototype, 'src', 'set').mockImplementation(function (
      this: HTMLIFrameElement,
      value: string,
    ) {
      navigations += 1;
      srcSetter.call(this, value);
      postMessage = spyOnPostMessage(this);
      this.dispatchEvent(new Event('load'));
    });
    const iframe = await renderEditor({}, undefined, true);
    expect(navigations).toBe(1);
    expect(initCalls(postMessage)).toHaveLength(1);
    const init = initCalls(postMessage)[0]![0] as Record<string, unknown>;
    await dispatchChild(iframe, init, { messageType: 'ASA_BLOCKS_STATUS', status: 'editor-ready' });
    expect(
      container!.querySelector<HTMLElement>('[data-asa-blocks-loading-overlay]')?.dataset.state,
    ).toBe('ready');
    await act(async () => root?.unmount());
    root = null;
    const grantsBefore = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/blocks/runtime-session'),
    ).length;
    await fireLoad(iframe);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/blocks/runtime-session')),
    ).toHaveLength(grantsBefore);
  });

  it('binds activity after ancestor identity layout even when frame load arrives during commit', async () => {
    const telemetry: Array<Record<string, unknown>> = [];
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    setTelemetryContext(null, false, 'unknown');
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input, options) => {
        if (String(input) === '/api/analytics/v2/module-session') {
          telemetry.push(JSON.parse(options?.body as string) as Record<string, unknown>);
        }
        return telemetryResponse(input, options) ?? jsonResponse(session());
      }),
    );
    const iframe = await renderEditor({ telemetryActor: TELEMETRY_ACTOR }, (frame) => {
      // React runs descendant layout effects before this ancestor identity proof.
      setTelemetryContext(TELEMETRY_ACTOR, true, 'editor.blocks');
      frame.dispatchEvent(new Event('load'));
    });
    const postMessage = spyOnPostMessage(iframe);
    await fireLoad(iframe);
    expect(initCalls(postMessage)).toHaveLength(1);
    const init = initCalls(postMessage)[0]![0] as Record<string, unknown>;
    await dispatchChild(iframe, init, { messageType: 'ASA_BLOCKS_STATUS', status: 'editor-ready' });
    expect(telemetry).toHaveLength(0);
    await dispatchChild(iframe, init, { messageType: 'ASA_BLOCKS_USER_ACTIVITY' });
    expect(telemetry.filter((event) => event['operation'] === 'start')).toHaveLength(1);
    expect(telemetry[0]?.['actorExpectation']).toEqual(TELEMETRY_ACTOR);
  });

  it.each(['project', 'principal'] as const)(
    'closes analytics and binds a fresh iframe on %s change',
    async (change: 'project' | 'principal') => {
      const telemetry: Array<Record<string, unknown>> = [];
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async (input: RequestInfo | URL, options?: RequestInit) => {
          if (String(input) === '/api/analytics/v2/module-session') {
            const body = JSON.parse(options?.body as string) as Record<string, unknown>;
            telemetry.push(body);
            return telemetryResponse(input, options)!;
          }
          return telemetryResponse(input, options) ?? jsonResponse(session());
        }),
      );
      setTelemetryContext(TELEMETRY_ACTOR, true, 'editor.blocks');
      await flushAsync();
      const iframe = await renderEditor({ telemetryActor: TELEMETRY_ACTOR });
      const post = spyOnPostMessage(iframe);
      await fireLoad(iframe);
      const init = initCalls(post)[0]![0] as Record<string, unknown>;
      await dispatchChild(iframe, init, {
        messageType: 'ASA_BLOCKS_STATUS',
        status: 'editor-ready',
      });
      await dispatchChild(iframe, init, { messageType: 'ASA_BLOCKS_USER_ACTIVITY' });
      const replacementProject =
        change === 'project' ? '22222222-2222-4222-8222-222222222222' : PROJECT_ID;
      await act(async () => {
        root?.render(
          createElement(BlocksEditor, {
            projectId: replacementProject,
            telemetryActor: TELEMETRY_ACTOR,
            recoveryPrincipalKey:
              change === 'principal'
                ? '44444444-4444-4444-8444-444444444444'
                : '33333333-3333-4333-8333-333333333333',
            onBack: vi.fn(),
            onHomeClick: vi.fn(),
            accountLabel: 'ASA test user',
            accountInitials: 'AT',
            onAccountClick: vi.fn(),
          }),
        );
        await flushAsync();
      });
      expect(telemetry[1]?.['operation']).toBe('close');
      const next = container!.querySelector('iframe')!;
      expect(next).not.toBe(iframe);
      const nextPost = spyOnPostMessage(next);
      await fireLoad(next);
      const nextInit = initCalls(nextPost)[0]![0] as Record<string, unknown>;
      await dispatchChild(iframe, init, { messageType: 'ASA_BLOCKS_USER_ACTIVITY' });
      expect(telemetry).toHaveLength(2);
      await dispatchChild(next, nextInit, {
        messageType: 'ASA_BLOCKS_STATUS',
        status: 'editor-ready',
      });
      await dispatchChild(next, nextInit, { messageType: 'ASA_BLOCKS_USER_ACTIVITY' });
      expect(telemetry[2]?.['projectId']).toBe(replacementProject);
      expect(telemetry[2]?.['sessionId']).not.toBe(telemetry[0]?.['sessionId']);
    },
  );
  it('routes only bound child activity to analytics; heartbeat, stale frames and hidden tabs cannot start it', async () => {
    vi.useFakeTimers();
    const telemetry: Array<{ path: string; body: Record<string, unknown> }> = [];
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input: RequestInfo | URL, options?: RequestInit) => {
        const path = String(input);
        if (path === '/api/analytics/v2/module-session') {
          const body = JSON.parse(options?.body as string) as Record<string, unknown>;
          telemetry.push({ path, body });
          return telemetryResponse(input, options)!;
        }
        return telemetryResponse(input, options) ?? jsonResponse(session());
      }),
    );
    setTelemetryContext(TELEMETRY_ACTOR, true, 'editor.blocks');
    await flushAsync();
    const iframe = await renderEditor({ telemetryActor: TELEMETRY_ACTOR });
    const post = spyOnPostMessage(iframe);
    await fireLoad(iframe);
    const init = initCalls(post)[0]![0] as Record<string, unknown>;
    await dispatchChild(iframe, init, { messageType: 'ASA_BLOCKS_USER_ACTIVITY' });
    expect(telemetry).toHaveLength(0); // Not ready yet.
    await dispatchChild(iframe, init, { messageType: 'ASA_BLOCKS_STATUS', status: 'editor-ready' });
    await dispatchChild(iframe, init, {
      messageType: 'ASA_BLOCKS_STATUS',
      status: 'runtime-heartbeat',
    });
    await dispatchChild(iframe, init, {
      messageType: 'ASA_BLOCKS_STATUS',
      status: 'project-dirty',
      generation: 1,
    });
    expect(telemetry).toHaveLength(0); // Neither health nor autonomous VM changes are user input.
    await act(async () => {
      const forged = new MessageEvent('message', {
        origin: RUNTIME_ORIGIN,
        data: { ...init, messageType: 'ASA_BLOCKS_USER_ACTIVITY' },
      });
      Object.defineProperty(forged, 'source', { value: {} });
      window.dispatchEvent(forged);
      await flushAsync();
    });
    expect(telemetry).toHaveLength(0);
    await dispatchChild(iframe, init, { messageType: 'ASA_BLOCKS_USER_ACTIVITY' });
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]?.body).toEqual({
      schemaVersion: 2,
      eventId: expect.any(String),
      actorExpectation: TELEMETRY_ACTOR,
      operation: 'start',
      visitId: expect.any(String),
      clientOccurredAt: expect.any(String),
      sessionId: expect.any(String),
      projectId: PROJECT_ID,
      moduleKey: 'blocks',
    });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await flushAsync();
    });
    expect(telemetry[1]?.body['operation']).toBe('close');
    await dispatchChild(iframe, init, { messageType: 'ASA_BLOCKS_USER_ACTIVITY' });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(telemetry).toHaveLength(2);
    await dispatchChild(iframe, init, { messageType: 'ASA_BLOCKS_USER_ACTIVITY' });
    expect(telemetry).toHaveLength(3);
    expect(telemetry[2]?.body['sessionId']).not.toBe(telemetry[0]?.body['sessionId']);
    await fireLoad(iframe);
    expect(telemetry[3]?.body['operation']).toBe('close');
    await dispatchChild(iframe, init, { messageType: 'ASA_BLOCKS_USER_ACTIVITY' });
    expect(telemetry).toHaveLength(4); // Reload invalidated the old bridge/nonce.
    await act(async () => root?.unmount());
    root = null;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(telemetry).toHaveLength(4);
  });
  it('detects missing child heartbeats, reports recovery, and ignores hidden tabs', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>(
      async (input, options) => telemetryResponse(input, options) ?? jsonResponse(session()),
    );
    vi.stubGlobal('fetch', fetchMock);
    const iframe = await renderEditor();
    const post = spyOnPostMessage(iframe);
    await fireLoad(iframe);
    const init = initCalls(post)[0]![0] as Record<string, unknown>;
    await dispatchChild(iframe, init, { messageType: 'ASA_BLOCKS_STATUS', status: 'editor-ready' });
    const codes = () =>
      fetchMock.mock.calls
        .filter((call) => (call as unknown[])[0] === '/api/diagnostics/client')
        .map(
          (call) =>
            JSON.parse(((call as unknown[])[1] as RequestInit).body as string).code as string,
        );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(75_000);
    });
    expect(codes()).toContain('editor_unresponsive');
    await dispatchChild(iframe, init, {
      messageType: 'ASA_BLOCKS_STATUS',
      status: 'runtime-heartbeat',
    });
    expect(codes()).toContain('editor_recovered');
    const count = codes().filter((c) => c === 'editor_unresponsive').length;
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(codes().filter((c) => c === 'editor_unresponsive')).toHaveLength(count);
  });
  it('shows the ASA loading overlay on first render without raw runtime status UI', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(session())),
    );
    await renderEditor();

    const overlay = container!.querySelector<HTMLElement>('[data-asa-blocks-loading-overlay]');
    expect(overlay).not.toBeNull();
    expect(overlay?.dataset.state).toBe('loading');
    expect(overlay?.textContent).toContain('Загружаем рабочую среду…');
    expect(overlay?.textContent).toContain('Открываем ваш проект');
    expect(overlay?.querySelector<HTMLImageElement>('.blocks-editor-loading-mark')?.src).toContain(
      '/asa-lab-mark.svg',
    );
    expect(overlay?.querySelector('.blocks-editor-loading-spinner')).not.toBeNull();
    expect(container!.querySelector('.blocks-editor-connection-status')).toBeNull();
    expect(overlay?.textContent).not.toContain('Scratch');
  });

  it('keeps technical child statuses hidden and dismisses the overlay only on editor-ready', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(session())),
    );
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);
    await fireLoad(iframe);
    const init = initCalls(postMessage)[0]?.[0] as Record<string, unknown>;
    const overlay = container!.querySelector<HTMLElement>('[data-asa-blocks-loading-overlay]');
    expect(overlay?.dataset.state).toBe('loading');

    for (const status of ['init-accepted', 'token-updated', 'project-dirty']) {
      await dispatchChild(iframe, init, {
        messageType: 'ASA_BLOCKS_STATUS',
        status,
        ...(status === 'project-dirty' ? { generation: 1 } : {}),
      });
      expect(overlay?.dataset.state).toBe('loading');
      expect(container?.textContent).not.toContain(status);
    }
    await dispatchChild(iframe, init, { messageType: 'ASA_BLOCKS_READY' });
    expect(overlay?.dataset.state).toBe('loading');
    expect(container?.textContent).not.toContain('Scratch готов');

    await dispatchChild(iframe, init, {
      messageType: 'ASA_BLOCKS_STATUS',
      status: 'editor-ready',
    });
    expect(overlay?.dataset.state).toBe('ready');
    expect(overlay?.getAttribute('aria-hidden')).toBe('true');
  });

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
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}, status)),
    );
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);

    await fireLoad(iframe);
    if (status === 503) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000);
        await flushAsync();
      });
    }

    expect(initCalls(postMessage)).toHaveLength(0);
    expect(container?.textContent).toContain('Не удалось открыть среду');
  });

  it('does not INIT when the runtime-session request fails', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network unavailable');
      }),
    );
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);

    await fireLoad(iframe);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
      await flushAsync();
    });

    expect(initCalls(postMessage)).toHaveLength(0);
    expect(container?.textContent).toContain('Не удалось открыть среду');
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
    expect(container?.textContent).toContain('Не удалось открыть среду');
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
    expect(container?.textContent).toContain('Не удалось открыть среду');
  });

  it('requests a new capability after retry instead of reusing a failed session', async () => {
    let sessions = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/diagnostics/client') return jsonResponse({}, 202);
      return ++sessions === 1
        ? jsonResponse({}, 400)
        : jsonResponse(session('fresh.runtime.token'));
    });
    vi.stubGlobal('fetch', fetchMock);
    const firstIframe = await renderEditor();
    const firstPostMessage = spyOnPostMessage(firstIframe);

    await fireLoad(firstIframe);
    expect(initCalls(firstPostMessage)).toHaveLength(0);

    const retry = Array.from(container!.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Повторить',
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

    expect(sessions).toBe(2);
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

  it('uploads a trusted native thumbnail through the authenticated parent snapshot API', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === `/api/projects/${PROJECT_ID}/snapshot`) {
        return jsonResponse({
          snapshot: {
            projectId: PROJECT_ID,
            contentType: 'image/png',
            width: 480,
            height: 360,
            sourceRevision: 18,
            capturedAt: '2026-09-19T20:00:00.000Z',
          },
        });
      }
      return jsonResponse(session());
    });
    vi.stubGlobal('fetch', fetchMock);
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);
    await fireLoad(iframe);
    const init = initCalls(postMessage)[0]?.[0] as Record<string, unknown>;

    await dispatchChild(iframe, init, {
      messageType: 'ASA_BLOCKS_THUMBNAIL_READY',
      sourceRevision: 18,
      imageDataUrl: 'data:image/png;base64,AAAA',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/projects/${PROJECT_ID}/snapshot`,
      expect.objectContaining({
        method: 'PUT',
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({
          imageDataUrl: 'data:image/png;base64,AAAA',
          sourceRevision: 18,
        }),
      }),
    );
  });

  it('does not expose a parent save control', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(session())),
    );
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);
    await fireLoad(iframe);

    const init = initCalls(postMessage)[0]?.[0] as Record<string, unknown>;
    await dispatchChild(iframe, init, { messageType: 'ASA_BLOCKS_STATUS', status: 'editor-ready' });
    await dispatchChild(iframe, init, {
      messageType: 'ASA_BLOCKS_STATUS',
      status: 'project-dirty',
      generation: 1,
    });

    expect(container!.querySelector('[data-asa-blocks-save]')).toBeNull();
    expect(container!.textContent).not.toContain('Сохранить в ASA');
  });

  it.each([-3, 3])(
    'opens and refreshes with a %s hour client offset and a later clock jump',
    async (hours) => {
      vi.useFakeTimers();
      const serverStart = Date.UTC(2030, 0, 1);
      vi.setSystemTime(serverStart + hours * 3_600_000);
      let grants = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input, options) => {
          const telemetry = telemetryResponse(input, options);
          if (telemetry) return telemetry;
          grants += 1;
          const serverNow = serverStart + performance.now();
          const answer = jsonResponse(
            session(`grant.number.${grants}`, Math.floor(serverNow / 1000) + 600),
          );
          answer.headers.set('date', new Date(serverNow).toUTCString());
          return answer;
        }),
      );
      const iframe = await renderEditor();
      const post = spyOnPostMessage(iframe);
      await fireLoad(iframe);
      expect(initCalls(post)).toHaveLength(1);
      vi.setSystemTime(serverStart + 86_400_000);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(539_000);
      });
      expect(grants).toBe(2);
      expect(initCalls(post)).toHaveLength(1);
      expect(
        post.mock.calls.filter(
          ([m]) => (m as Record<string, unknown>)['messageType'] === 'ASA_BLOCKS_TOKEN_UPDATE',
        ),
      ).toHaveLength(1);
    },
  );

  it('refreshes on resume even when monotonic time froze, coalesces events and stops after unmount', async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(0);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    let grants = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, options) => {
        const telemetry = telemetryResponse(input, options);
        if (telemetry) return telemetry;
        grants += 1;
        return jsonResponse(session(`grant.number.${grants}`));
      }),
    );
    const iframe = await renderEditor();
    const post = spyOnPostMessage(iframe);
    await fireLoad(iframe);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pageshow'));
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(grants).toBe(2);
    expect(initCalls(post)).toHaveLength(1);
    await act(async () => root?.unmount());
    root = null;
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(grants).toBe(2);
  });

  it('discards a pre-suspension refresh response and waits for a fresh grant in the same flight', async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(0);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    let resolveOld!: (value: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => {
      resolveOld = resolve;
    });
    let grants = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, options) => {
        const telemetry = telemetryResponse(input, options);
        if (telemetry) return telemetry;
        grants += 1;
        if (grants === 2) return oldResponse;
        return jsonResponse(
          session(grants === 1 ? 'initial.runtime.token' : 'fresh.runtime.token'),
        );
      }),
    );
    const iframe = await renderEditor();
    const post = spyOnPostMessage(iframe);
    await fireLoad(iframe);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(grants).toBe(2);
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      resolveOld(jsonResponse(session('stale.runtime.token')));
      await flushAsync();
    });
    expect(grants).toBe(3);
    const updates = post.mock.calls
      .map(([m]) => m as Record<string, unknown>)
      .filter((m) => m['messageType'] === 'ASA_BLOCKS_TOKEN_UPDATE');
    expect(updates.map((m) => m['runtimeToken'])).toEqual(['fresh.runtime.token']);
    expect(initCalls(post)).toHaveLength(1);
  });

  it('refreshes expiring authority proactively with TOKEN_UPDATE and no second INIT', async () => {
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await flushAsync();
    });

    const messages = postMessage.mock.calls.map(([message]) => message as Record<string, unknown>);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(initCalls(postMessage)).toHaveLength(1);
    expect(
      messages.filter((message) => message['messageType'] === 'ASA_BLOCKS_TOKEN_UPDATE'),
    ).toHaveLength(1);
    expect(storageSet).not.toHaveBeenCalled();
  });

  it('cancels a long Retry-After when the startup deadline expires', async () => {
    vi.useFakeTimers();
    let grants = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, options) => {
        const telemetry = telemetryResponse(input, options);
        if (telemetry) return telemetry;
        grants += 1;
        const response = jsonResponse({}, 429);
        response.headers.set('retry-after', '60');
        return response;
      }),
    );
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);
    await fireLoad(iframe);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await flushAsync();
    });
    expect(grants).toBe(1);
    expect(initCalls(postMessage)).toHaveLength(0);
    expect(container?.textContent).toContain('Не удалось открыть среду');
  });

  it('does not initialize from a response that arrives after the startup deadline', async () => {
    vi.useFakeTimers();
    let resolveGrant!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveGrant = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, options) => telemetryResponse(input, options) ?? pending),
    );
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);
    await fireLoad(iframe);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
      resolveGrant(jsonResponse(session()));
      await flushAsync();
    });
    expect(initCalls(postMessage)).toHaveLength(0);
    expect(container?.textContent).toContain('Не удалось открыть среду');
  });

  it('retries a transient capability refresh without remounting or replacing the project', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const nowSeconds = Math.floor(Date.now() / 1000);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(session('initial.runtime.token', nowSeconds + 30)))
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse(session('fresh.runtime.token', nowSeconds + 600)));
    vi.stubGlobal('fetch', fetchMock);
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);
    await fireLoad(iframe);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await flushAsync();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      await flushAsync();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(initCalls(postMessage)).toHaveLength(1);
    expect(
      postMessage.mock.calls.some(
        ([message]) =>
          (message as Record<string, unknown>)['messageType'] === 'ASA_BLOCKS_TOKEN_UPDATE',
      ),
    ).toBe(true);
  });

  it('retries startup throttling using Retry-After without creating another iframe', async () => {
    vi.useFakeTimers();
    const limited = jsonResponse({}, 429);
    limited.headers.set('retry-after', '3');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(limited)
      .mockResolvedValueOnce(jsonResponse(session()));
    vi.stubGlobal('fetch', fetchMock);
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);
    await fireLoad(iframe);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
      await flushAsync();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await flushAsync();
    });
    expect(initCalls(postMessage)).toHaveLength(1);
    expect(container?.querySelector('iframe')).toBe(iframe);
  });

  it('keeps proactive refresh single-flight when child refresh demand joins an in-flight rotation', async () => {
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
      await vi.advanceTimersByTimeAsync(1_000);
      await flushAsync();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await dispatchChild(iframe, init, { messageType: 'ASA_BLOCKS_TOKEN_REFRESH_REQUIRED' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveRefresh(jsonResponse(session('fresh.runtime.token', nowSeconds + 600)));
      await flushAsync();
    });

    const messages = postMessage.mock.calls.map(([message]) => message as Record<string, unknown>);
    expect(
      messages.filter((message) => message['messageType'] === 'ASA_BLOCKS_TOKEN_UPDATE'),
    ).toHaveLength(1);
  });

  it.each([401, 503])(
    'fails proactive capability refresh closed when it returns %s',
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

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
        await flushAsync();
      });

      const messages = postMessage.mock.calls.map(
        ([message]) => message as Record<string, unknown>,
      );
      expect(
        messages.filter((message) => message['messageType'] === 'ASA_BLOCKS_TOKEN_UPDATE'),
      ).toHaveLength(0);
    },
  );

  it('does not extend revoked authority when proactive refresh returns 404', async () => {
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await flushAsync();
    });

    const messages = postMessage.mock.calls.map(([message]) => message as Record<string, unknown>);
    expect(
      messages.filter((message) => message['messageType'] === 'ASA_BLOCKS_TOKEN_UPDATE'),
    ).toHaveLength(0);
    expect(initCalls(postMessage)).toHaveLength(1);
  });

  it.each(['malformed', 'wrong-origin'])(
    'rejects %s proactive refresh without TOKEN_UPDATE',
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

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
        await flushAsync();
      });

      const messages = postMessage.mock.calls.map(
        ([message]) => message as Record<string, unknown>,
      );
      expect(
        messages.filter((message) => message['messageType'] === 'ASA_BLOCKS_TOKEN_UPDATE'),
      ).toHaveLength(0);
      expect(initCalls(postMessage)).toHaveLength(1);
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
      .mockResolvedValueOnce(jsonResponse(session('initial.runtime.token', nowSeconds + 61)))
      .mockReturnValueOnce(staleRefresh)
      .mockResolvedValueOnce(jsonResponse(session('reload.runtime.token', nowSeconds + 600)));
    vi.stubGlobal('fetch', fetchMock);
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);
    await fireLoad(iframe);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
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
  });

  it('accepts dirty generation status without parent-side save orchestration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(session())),
    );
    const iframe = await renderEditor();
    const postMessage = spyOnPostMessage(iframe);
    await fireLoad(iframe);
    const init = initCalls(postMessage)[0]?.[0] as Record<string, unknown>;

    await dispatchChild(iframe, init, {
      messageType: 'ASA_BLOCKS_STATUS',
      status: 'project-dirty',
      generation: 6,
    });

    expect(container!.querySelector('[data-asa-blocks-save]')).toBeNull();
  });

  it('waits for upstream save-before-exit success before leaving through Home', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(session())),
    );
    const onHomeClick = vi.fn();
    const confirm = vi.spyOn(window, 'confirm');
    const iframe = await renderEditor({ onHomeClick });
    const postMessage = spyOnPostMessage(iframe);
    await fireLoad(iframe);
    const init = initCalls(postMessage)[0]?.[0] as Record<string, unknown>;

    await dispatchChild(iframe, init, {
      messageType: 'ASA_BLOCKS_HOME_REQUEST',
    });

    const request = postMessage.mock.calls
      .map(([message]) => message as Record<string, unknown>)
      .find((message) => message['messageType'] === 'ASA_BLOCKS_SAVE_BEFORE_EXIT_REQUEST');
    expect(request?.['requestId']).toEqual(expect.any(String));
    expect(confirm).not.toHaveBeenCalled();
    expect(onHomeClick).not.toHaveBeenCalled();

    await dispatchChild(iframe, init, {
      messageType: 'ASA_BLOCKS_SAVE_BEFORE_EXIT_RESULT',
      requestId: request?.['requestId'],
      ok: true,
      reason: null,
      revision: 17,
      savedGeneration: 0,
    });
    expect(onHomeClick).toHaveBeenCalledTimes(1);
  });

  it('stays in the editor when upstream save-before-exit fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(session())),
    );
    const onHomeClick = vi.fn();
    const iframe = await renderEditor({ onHomeClick });
    const postMessage = spyOnPostMessage(iframe);
    await fireLoad(iframe);
    const init = initCalls(postMessage)[0]?.[0] as Record<string, unknown>;

    await dispatchChild(iframe, init, {
      messageType: 'ASA_BLOCKS_HOME_REQUEST',
    });
    await dispatchChild(iframe, init, {
      messageType: 'ASA_BLOCKS_HOME_REQUEST',
    });
    const requests = postMessage.mock.calls
      .map(([message]) => message as Record<string, unknown>)
      .filter((message) => message['messageType'] === 'ASA_BLOCKS_SAVE_BEFORE_EXIT_REQUEST');
    expect(requests).toHaveLength(1);

    await dispatchChild(iframe, init, {
      messageType: 'ASA_BLOCKS_SAVE_BEFORE_EXIT_RESULT',
      requestId: requests[0]?.['requestId'],
      ok: false,
      reason: 'draft_write_failed',
    });
    expect(onHomeClick).not.toHaveBeenCalled();
  });
});
