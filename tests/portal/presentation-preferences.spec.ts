// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import * as client from '../../apps/web/src/api-call';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '../../contexts/identity/application/active-context.usecase.js';
import {
  PresentationPreferencesUseCase,
  type PresentationWrite,
  type PresentationSnapshot,
} from '../../contexts/identity/application/presentation-preferences.js';
import { PresentationPreferencesController } from '../../apps/api/src/presentation-preferences.controller.js';
import {
  PresentationProvider,
  PresentationControls,
  usePresentation,
  usePresentationSessionLifetime,
} from '../../apps/web/src/components/PresentationPreferences';
import {
  hasSettingsDraft,
  requestSettingsNavigation,
  useSettingsDraftGuard,
} from '../../apps/web/src/components/settings-navigation';
let root: Root, container: HTMLDivElement, state: ReturnType<typeof usePresentation>;
const defaults = { motion: 'system', sidebar: 'expanded', revision: 0 };
const accountA = '20000000-0000-4000-8000-000000000001';
const accountB = '20000000-0000-4000-8000-000000000002';
const success = (data = defaults) => ({ ok: true as const, status: 200, data });
function Probe() {
  state = usePresentation();
  const guard = useSettingsDraftGuard([state]);
  return createElement(
    'div',
    null,
    createElement('span', null, state.draft.motion),
    createElement(PresentationControls),
    guard,
  );
}
function Lifetime({ actor, expiresAt }: { actor: string | null; expiresAt?: string }) {
  usePresentationSessionLifetime(actor, expiresAt);
  return null;
}
async function mount(actor = accountA, seat = false, expiresAt = '2030-01-01T00:00:00Z') {
  await act(async () =>
    root.render(
      createElement(PresentationProvider, {
        key: actor,
        actor,
        seat,
        expiresAt,
        children: createElement(Probe),
      }),
    ),
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  sessionStorage.clear();
  localStorage.clear();
  vi.spyOn(client, 'call').mockResolvedValue(success());
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = false;
});
describe('presentation canonical shell state', () => {
  it('previews, cancels and resets only presentation; header saves same canonicalset', async () => {
    const call = vi.mocked(client.call);
    await mount();
    await act(async () => state.preview({ motion: 'reduce', sidebar: 'collapsed' }));
    expect(state.dirty).toBe(true);
    await act(async () => state.toggleSidebar());
    expect(call).toHaveBeenCalledTimes(1);
    await act(async () => state.discard());
    expect(state.draft.motion).toBe('system');
    call.mockResolvedValueOnce(success({ motion: 'system', sidebar: 'collapsed', revision: 1 }));
    await act(async () => state.toggleSidebar());
    expect(state.draft.sidebar).toBe('collapsed');
    expect(state.dirty).toBe(false);
    await act(async () => state.reset());
    expect(state.draft).toEqual({ motion: 'system', sidebar: 'expanded' });
    expect(state.dirty).toBe(true);
    const command = JSON.parse(call.mock.calls[1][1]!.body as string);
    expect(Object.keys(command).sort()).toEqual(['motion', 'requestId', 'revision', 'sidebar']);
    for (const [, init] of call.mock.calls)
      expect(init?.headers).toEqual({ 'x-asa-presentation-account': accountA });
  });
  it('retries lost response with same request identity and keeps failure draft', async () => {
    const call = vi.mocked(client.call);
    await mount();
    await act(async () => state.preview({ motion: 'reduce', sidebar: 'expanded' }));
    call.mockResolvedValueOnce({
      ok: false,
      status: 0,
      error: { code: 'network', message: 'offline' },
    });
    await act(async () => {
      expect(await state.save()).toBe(false);
    });
    expect(state.dirty).toBe(true);
    expect(state.error).toContain('не сохранено');
    call.mockResolvedValueOnce(success({ motion: 'reduce', sidebar: 'expanded', revision: 1 }));
    await act(async () => {
      expect(await state.save()).toBe(true);
    });
    expect(call.mock.calls[1][1]!.body).toEqual(call.mock.calls[2][1]!.body);
    expect(call.mock.calls[2][1]!.headers).toEqual({ 'x-asa-presentation-account': accountA });
    expect(state.dirty).toBe(false);
  });
  it.each(['save', 'header', 'reload', 'initial load'] as const)(
    'actual controller rejects %s when cookie changes to B while Account A remains mounted',
    async (action) => {
      let cookie = action === 'initial load' ? 'b' : 'a';
      const snapshots = new Map<string, PresentationSnapshot>([
        [accountA, { ...defaults }],
        [accountB, { ...defaults }],
      ]);
      const read = vi.fn(async (id: string) => snapshots.get(id) ?? null);
      const write = vi.fn(async (id: string, input: PresentationWrite) => {
        const saved = snapshots.get(id);
        if (!saved) return { code: 'not_found' as const };
        if (saved.revision !== input.revision) return { code: 'conflict' as const };
        const snapshot = {
          motion: input.motion,
          sidebar: input.sidebar,
          revision: saved.revision + 1,
        };
        snapshots.set(id, snapshot);
        return { code: 'ok' as const, snapshot };
      });
      const controller = new PresentationPreferencesController(
        {
          resolve: vi.fn(async (token: string) => ({
            accountId: token === 'a' ? accountA : accountB,
          })),
        } as unknown as ActiveContextUseCase,
        new PresentationPreferencesUseCase({ read, write }),
      );
      vi.mocked(client.call).mockImplementation(async (_path, init) => {
        const req = { cookies: { asa_session: cookie }, headers: init?.headers } as FastifyRequest;
        try {
          const data =
            init?.method === 'PUT'
              ? await controller.write(req, JSON.parse(init.body as string))
              : await controller.read(req);
          return { ok: true, status: 200, data };
        } catch (failure) {
          const error = failure as {
            getStatus(): number;
            getResponse(): { error: client.ApiError };
          };
          return { ok: false, status: error.getStatus(), ...error.getResponse() };
        }
      });
      await mount(accountA);
      if (action === 'save')
        await act(async () => state.preview({ motion: 'reduce', sidebar: 'collapsed' }));
      const captured = state;
      cookie = 'b'; // No rerender, logout event or global session mutation.
      if (action === 'save') await act(async () => expect(await state.save()).toBe(false));
      if (action === 'header') await act(async () => state.toggleSidebar());
      if (action === 'reload') await act(async () => state.reload());
      expect(state.actorChanged).toBe(true);
      expect(state.error).toContain('Аккаунт изменился');
      expect(state.error).not.toContain('Оформление изменено');
      expect(state.loaded).toBe(false);
      expect(state.busy).toBe(false);
      expect(state.dirty).toBe(false);
      expect(state.notice).toBe('');
      expect(state.draft).toMatchObject({ motion: 'system', sidebar: 'expanded' });
      expect(hasSettingsDraft()).toBe(false);
      expect(write).not.toHaveBeenCalled();
      expect(read.mock.calls.some(([id]) => id === accountB)).toBe(false);
      expect([...snapshots.values()]).toEqual([{ ...defaults }, { ...defaults }]);
      const calls = vi.mocked(client.call).mock.calls.length;
      await act(async () => captured.discard());
      await act(async () => captured.preview({ motion: 'reduce', sidebar: 'collapsed' }));
      await act(async () => state.reload());
      expect(await captured.save()).toBe(false);
      expect(vi.mocked(client.call)).toHaveBeenCalledTimes(calls);
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('Обновите страницу');
      expect(
        [...container.querySelectorAll('button')].some(
          (b) => b.textContent === 'Обновить страницу',
        ),
      ).toBe(true);
      expect(
        [...container.querySelectorAll('button')].some(
          (b) => b.textContent === 'Загрузить сохранённое оформление',
        ),
      ).toBe(false);
    },
  );
  it('does not silently overwrite after conflict; Cancel then reload accepts latest', async () => {
    const call = vi.mocked(client.call);
    await mount();
    await act(async () => state.preview({ motion: 'reduce', sidebar: 'expanded' }));
    call.mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: { code: 'conflict', message: 'changed' },
    });
    await act(async () => state.save());
    expect(state.dirty).toBe(true);
    await act(async () => state.reload());
    expect(call).toHaveBeenCalledTimes(2);
    await act(async () => state.discard());
    expect(state.error).toContain('другом окне');
    call.mockResolvedValueOnce(success({ motion: 'system', sidebar: 'collapsed', revision: 3 }));
    await act(async () => state.reload());
    expect(state.draft.sidebar).toBe('collapsed');
    expect(state.dirty).toBe(false);
  });
  it('ignores delayed load and delayed save after changing actor', async () => {
    const call = vi.mocked(client.call),
      load = deferred<ReturnType<typeof success>>();
    call.mockReturnValueOnce(load.promise);
    await mount('a');
    const oldLoadSignal = call.mock.calls[0][1]!.signal;
    await mount('b');
    expect(oldLoadSignal?.aborted).toBe(true);
    await act(async () =>
      load.resolve(success({ motion: 'reduce', sidebar: 'collapsed', revision: 9 })),
    );
    expect(state.draft.motion).toBe('system');
    await act(async () => state.preview({ motion: 'reduce', sidebar: 'expanded' }));
    const save = deferred<ReturnType<typeof success>>();
    call.mockReturnValueOnce(save.promise);
    let result!: Promise<boolean>;
    await act(async () => {
      result = state.save();
    });
    const oldSaveSignal = call.mock.calls.at(-1)![1]!.signal;
    await mount('c');
    expect(oldSaveSignal?.aborted).toBe(true);
    await act(async () =>
      save.resolve(success({ motion: 'reduce', sidebar: 'expanded', revision: 1 })),
    );
    expect(await result).toBe(false);
    expect(state.draft.motion).toBe('system');
    expect(state.dirty).toBe(false);
  });
  it('aborted actor request cannot replay its presentation write through Account refresh with a new cookie', async () => {
    vi.mocked(client.call).mockRestore();
    const refresh = deferred<Response>();
    let deliveredPuts = 0;
    let newActor = false;
    const fetch = vi.fn().mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (path === '/api/auth/refresh') return refresh.promise;
      if (path === '/api/account/presentation' && init?.method === 'PUT') {
        deliveredPuts++;
        expect(newActor).toBe(false);
        return new Response('{}', { status: 401 });
      }
      return new Response(JSON.stringify(defaults), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetch);
    await mount('actor-a');
    await act(async () => state.preview({ motion: 'reduce', sidebar: 'expanded' }));
    let result!: Promise<boolean>;
    await act(async () => {
      result = state.save();
    });
    expect(fetch.mock.calls.some((args) => args[0] === '/api/auth/refresh')).toBe(true);
    newActor = true;
    await mount('actor-b');
    await act(async () => refresh.resolve(new Response('{}', { status: 200 })));
    expect(await result).toBe(false);
    expect(deliveredPuts).toBe(1);
    expect(state.draft.motion).toBe('system');
    vi.unstubAllGlobals();
  });
  it('old backend or malformed successful payload leaves truthful unavailable state without global sidebarinheritance', async () => {
    const call = vi.mocked(client.call);
    localStorage.setItem('asa-portal-sidebar', 'collapsed');
    call.mockResolvedValueOnce({
      ok: false,
      status: 404,
      error: { code: 'not_found', message: 'old backend' },
    });
    await mount();
    expect(state.loaded).toBe(false);
    expect(state.draft.sidebar).toBe('expanded');
    expect(await state.save()).toBe(false);
    call.mockResolvedValueOnce(success({ motion: 'dark', sidebar: 'expanded', revision: 0 }));
    await act(async () => state.reload());
    expect(state.loaded).toBe(false);
    expect(localStorage.getItem('asa-portal-sidebar')).toBe('collapsed');
  });
  it('Seat temporary scope never calls Account API, survives own reload and clears on actor change/logout', async () => {
    await mount('seat-a', true);
    await act(async () => state.preview({ motion: 'reduce', sidebar: 'expanded' }));
    await act(async () => state.save());
    expect(client.call).not.toHaveBeenCalled();
    await act(async () => root.render(null));
    await mount('seat-a', true);
    expect(state.draft.motion).toBe('reduce');
    await mount('seat-b', true);
    expect(state.draft.motion).toBe('system');
    expect(sessionStorage.getItem('asa-seat-presentation-session')).toBeNull();
    await act(async () => state.preview({ motion: 'reduce', sidebar: 'expanded' }));
    await act(async () => state.save());
    await act(async () => window.dispatchEvent(new Event('asa-session-logout')));
    expect(sessionStorage.getItem('asa-seat-presentation-session')).toBeNull();
    expect(state.draft.motion).toBe('system');
    await act(async () => state.discard());
    expect(state.draft.motion).toBe('system');
    expect(state.dirty).toBe(false);
    expect(state.loaded).toBe(false);
    expect(state.busy).toBe(false);
    expect(state.notice).toBe('');
  });
  it('Seat expiry clears the saved snapshot so Cancel and navigation cannot revive it', async () => {
    vi.useFakeTimers();
    const expiry = new Date(Date.now() + 1000).toISOString();
    await mount('seat-a', true, expiry);
    await act(async () => state.preview({ motion: 'reduce', sidebar: 'expanded' }));
    await act(async () => {
      expect(await state.save()).toBe(true);
    });
    expect(state.notice).toContain('Сохранено');
    const expiredDraft = state;
    await act(async () => vi.advanceTimersByTime(1001));
    expect(sessionStorage.getItem('asa-seat-presentation-session')).toBeNull();
    expect(state.draft).toMatchObject({ motion: 'system', sidebar: 'expanded' });
    expect(state.dirty).toBe(false);
    expect(state.loaded).toBe(false);
    expect(state.busy).toBe(false);
    expect(state.notice).toBe('');
    expect(hasSettingsDraft()).toBe(false);
    const cancel = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Отменить оформление',
    )!;
    expect(cancel.disabled).toBe(true);
    await act(async () => expiredDraft.discard());
    await act(async () => expiredDraft.preview({ motion: 'reduce', sidebar: 'expanded' }));
    expect(await expiredDraft.save()).toBe(false);
    await act(async () => state.discard());
    await act(async () => state.reload());
    await act(async () => state.preview({ motion: 'reduce', sidebar: 'expanded' }));
    expect(await state.save()).toBe(false);
    expect(state.draft).toMatchObject({ motion: 'system', sidebar: 'expanded' });
    expect(state.dirty).toBe(false);
    expect(state.loaded).toBe(false);
    const navigate = vi.fn();
    await act(async () => requestSettingsNavigation(navigate));
    expect(navigate).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
    expect(client.call).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });
  it('Discard and navigate after Seat expiry preserves defaults even with a pending guard', async () => {
    vi.useFakeTimers();
    const expiry = new Date(Date.now() + 1000).toISOString();
    await mount('seat-a', true, expiry);
    await act(async () => state.preview({ motion: 'reduce', sidebar: 'expanded' }));
    await act(async () => state.save());
    await act(async () => state.preview({ motion: 'system', sidebar: 'expanded' }));
    const navigate = vi.fn();
    await act(async () => requestSettingsNavigation(navigate));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(1001));
    const discard = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Отменить изменения и перейти',
    )!;
    await act(async () => discard.click());
    expect(navigate).toHaveBeenCalledOnce();
    expect(state.draft).toMatchObject({ motion: 'system', sidebar: 'expanded' });
    expect(state.dirty).toBe(false);
    expect(state.loaded).toBe(false);
    expect(hasSettingsDraft()).toBe(false);
    expect(sessionStorage.getItem('asa-seat-presentation-session')).toBeNull();
  });
  it('Seat save detects expiry before its timer runs and clears the old saved snapshot', async () => {
    vi.useFakeTimers();
    const expiry = new Date(Date.now() + 1000).toISOString();
    await mount('seat-a', true, expiry);
    await act(async () => state.preview({ motion: 'reduce', sidebar: 'expanded' }));
    await act(async () => state.save());
    await act(async () => state.preview({ motion: 'system', sidebar: 'expanded' }));
    vi.setSystemTime(Date.parse(expiry) + 1);
    await act(async () => {
      expect(await state.save()).toBe(false);
    });
    expect(sessionStorage.getItem('asa-seat-presentation-session')).toBeNull();
    expect(state.dirty).toBe(false);
    expect(state.loaded).toBe(false);
    expect(state.busy).toBe(false);
    expect(state.notice).toBe('');
    await act(async () => state.discard());
    expect(state.draft).toMatchObject({ motion: 'system', sidebar: 'expanded' });
    expect(hasSettingsDraft()).toBe(false);
    expect(client.call).not.toHaveBeenCalled();
  });
  it.each(['', 'not-a-date', '2000-01-01T00:00:00Z', undefined])(
    'invalid or expired Seat expiry %s cannot load or create a draft',
    async (expiry) => {
      sessionStorage.setItem(
        'asa-seat-presentation-session',
        JSON.stringify({
          actor: `seat-a:${expiry ?? ''}`,
          value: { ...defaults, motion: 'reduce' },
        }),
      );
      await act(async () =>
        root.render(
          createElement(PresentationProvider, {
            actor: 'seat-a',
            seat: true,
            expiresAt: expiry,
            children: createElement(Probe),
          }),
        ),
      );
      expect(state.loaded).toBe(false);
      expect(state.error).toContain('Учебный вход завершён');
      await act(async () => state.reload());
      await act(async () => state.preview({ motion: 'reduce', sidebar: 'expanded' }));
      await act(async () => state.discard());
      expect(await state.save()).toBe(false);
      expect(state.draft).toMatchObject({ motion: 'system', sidebar: 'expanded' });
      expect(state.dirty).toBe(false);
      expect(state.loaded).toBe(false);
      expect(state.busy).toBe(false);
      expect(hasSettingsDraft()).toBe(false);
      expect(sessionStorage.getItem('asa-seat-presentation-session')).toBeNull();
      expect(client.call).not.toHaveBeenCalled();
    },
  );
  it('logout clears saved state and busy save; late response and reload cannot revive it', async () => {
    const call = vi.mocked(client.call);
    call.mockResolvedValueOnce(success({ motion: 'reduce', sidebar: 'collapsed', revision: 4 }));
    await mount();
    await act(async () => state.preview({ motion: 'system', sidebar: 'expanded' }));
    const loggedOutDraft = state;
    const save = deferred<ReturnType<typeof success>>();
    call.mockReturnValueOnce(save.promise);
    let result!: Promise<boolean>;
    await act(async () => {
      result = state.save();
    });
    const signal = call.mock.calls.at(-1)![1]!.signal;
    expect(state.busy).toBe(true);
    await act(async () => window.dispatchEvent(new Event('asa-session-logout')));
    expect(signal?.aborted).toBe(true);
    expect(state.busy).toBe(false);
    expect(state.loaded).toBe(false);
    expect(state.dirty).toBe(false);
    expect(state.notice).toBe('');
    expect(state.error).toBe('');
    await act(async () => loggedOutDraft.discard());
    await act(async () => loggedOutDraft.preview({ motion: 'reduce', sidebar: 'collapsed' }));
    expect(await loggedOutDraft.save()).toBe(false);
    await act(async () => state.discard());
    await act(async () => state.reload());
    await act(async () =>
      save.resolve(success({ motion: 'reduce', sidebar: 'collapsed', revision: 5 })),
    );
    expect(await result).toBe(false);
    expect(state.draft).toMatchObject({ motion: 'system', sidebar: 'expanded' });
    expect(state.dirty).toBe(false);
    expect(state.loaded).toBe(false);
    expect(call).toHaveBeenCalledTimes(2);
    const logout = vi.fn();
    await act(async () => requestSettingsNavigation(logout));
    expect(logout).toHaveBeenCalledOnce();
  });
  it('Seat expiration still clears storage while shell is replaced by an editor', async () => {
    vi.useFakeTimers();
    const expiry = new Date(Date.now() + 1000).toISOString();
    sessionStorage.setItem(
      'asa-seat-presentation-session',
      JSON.stringify({ actor: `seat-a:${expiry}`, value: { ...defaults, motion: 'reduce' } }),
    );
    await act(async () =>
      root.render(createElement(Lifetime, { actor: 'seat-a', expiresAt: expiry })),
    );
    await act(async () => vi.advanceTimersByTime(1001));
    expect(sessionStorage.getItem('asa-seat-presentation-session')).toBeNull();
  });
  it('Seat storage failure keeps preview unsaved and never falls back to persistent storage', async () => {
    await mount('seat-a', true);
    await act(async () => state.preview({ motion: 'reduce', sidebar: 'expanded' }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await act(async () => {
      expect(await state.save()).toBe(false);
    });
    expect(state.dirty).toBe(true);
    expect(state.error).toContain('Хранилище сеанса недоступно');
    expect(client.call).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });
});
