import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPortalHistoryGuard, requestPortalNavigation } from './portal-navigation-guard';
import type { CreatorPortalView } from './navigation';

const settings = vi.hoisted(() => ({
  dirty: false,
  pending: null as (() => void) | null,
  requests: 0,
  observedUrl: '',
}));
vi.mock('../components/settings-navigation', () => ({
  historyEntryIndex: () => window.history.state?.asaRouteIndex ?? null,
  hasSettingsDraft: () => settings.dirty,
  isSettingsNavigationPending: () => settings.pending !== null,
  requestSettingsNavigation: (proceed: () => void) => {
    settings.requests++;
    settings.observedUrl = window.location.href;
    if (settings.dirty) settings.pending ??= proceed;
    else proceed();
  },
}));
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  settings.dirty = false;
  settings.pending = null;
  settings.requests = 0;
});

function historyFixture(
  route: 'challenges' | 'account' = 'challenges',
  routes = ['help', route, 'account'],
) {
  const entries = routes.map((hash, index) => ({
    href: 'http://asa.test/#/' + hash,
    state: { asaRouteIndex: index },
  }));
  let position = 1;
  let sync: () => void = () => {};
  const traversals: Array<() => void> = [];
  const pushes = vi.fn((state, _unused, href: string) => {
    entries.splice(position + 1);
    entries.push({ href: new URL(href, entries[position]!.href).href, state });
    position++;
  });
  const go = vi.fn((delta: number) => {
    traversals.push(() => {
      const next = position + delta;
      if (next < 0 || next >= entries.length) return;
      position = next;
      sync(); // Native traversal emits both popstate and hashchange.
      sync();
    });
  });
  vi.stubGlobal('window', {
    location: {
      get href() {
        return entries[position]!.href;
      },
    },
    history: {
      get state() {
        return entries[position]!.state;
      },
      pushState: pushes,
      replaceState: (state: { asaRouteIndex: number }, _unused: string, href: string) => {
        entries[position] = { state, href };
      },
      go,
      back: () => go(-1),
      forward: () => go(1),
    },
    dispatchEvent: vi.fn(),
  });
  const accepted = { location: { current: entries[1]!.href }, index: { current: 1 } };
  const editor = {
    route: route as string,
    draft: 'unsaved text',
    frozen: { requestId: 'same-request', version: 1 },
  };
  const currentView = { current: { kind: route as CreatorPortalView['kind'] } };
  const apply = vi.fn(() => {
    editor.route = window.location.href.split('/#/')[1]!;
    currentView.current.kind = editor.route as CreatorPortalView['kind'];
  });
  const mayLeave = vi.fn(() => true);
  const guard = createPortalHistoryGuard({
    accepted,
    currentView,
    mayLeaveLearning: mayLeave,
    applyLocation: apply,
  });
  sync = guard.sync;
  const flush = () => {
    for (let count = 0; traversals.length; count++) {
      expect(count, 'History must settle without traversal loops').toBeLessThan(20);
      traversals.shift()!();
    }
  };
  return { accepted, editor, entries, apply, mayLeave, pushes, go, flush, sync: guard.sync };
}

describe('combined portal navigation approval', () => {
  it.each(['dirty draft', 'frozen assignment', 'pending copy'])(
    'retains %s when Learning declines a click',
    () => {
      const f = historyFixture();
      f.mayLeave.mockReturnValue(false);
      const state = structuredClone(f.editor);
      requestPortalNavigation(f.mayLeave, () => f.pushes({ asaRouteIndex: 2 }, '', '#/account'));
      expect(f.editor).toEqual(state);
      expect(window.location.href).toBe(f.accepted.location.current);
      expect(f.pushes).not.toHaveBeenCalled();
      expect(settings.requests).toBe(0);
      expect(f.mayLeave).toHaveBeenCalledOnce();
    },
  );

  it('keeps pure Learning approval and both drafts when Settings cancels; clean approval pushes once', () => {
    const f = historyFixture();
    settings.dirty = true;
    const state = structuredClone(f.editor);
    requestPortalNavigation(f.mayLeave, () => f.pushes({ asaRouteIndex: 2 }, '', '#/account'));
    expect(f.mayLeave).toHaveBeenCalledOnce();
    expect(settings.pending).not.toBeNull();
    requestPortalNavigation(f.mayLeave, () => f.pushes({ asaRouteIndex: 2 }, '', '#/help'));
    expect(f.mayLeave).toHaveBeenCalledOnce();
    expect(settings.requests).toBe(1);
    settings.pending = null; // Settings Stay never calls the queued action.
    expect(f.editor).toEqual(state);
    expect(window.location.href).toBe(f.accepted.location.current);
    expect(f.pushes).not.toHaveBeenCalled();
    settings.dirty = false;
    requestPortalNavigation(f.mayLeave, () => f.pushes({ asaRouteIndex: 2 }, '', '#/account'));
    expect(f.pushes).toHaveBeenCalledOnce();
    expect(window.location.href).toBe('http://asa.test/#/account');
  });

  it.each([-1, 1])(
    'restores the accepted editor before Learning decides native traversal %i',
    (direction) => {
      const f = historyFixture();
      const state = structuredClone(f.editor);
      f.mayLeave.mockImplementation(() => {
        expect(window.location.href).toBe(f.accepted.location.current);
        expect(f.accepted.index.current).toBe(1);
        expect(f.apply).not.toHaveBeenCalled();
        return false;
      });
      f.go(direction);
      f.flush();
      expect(f.mayLeave).toHaveBeenCalledOnce();
      expect(f.editor).toEqual(state);
      expect(window.location.href).toBe(f.accepted.location.current);
      expect(f.entries).toHaveLength(3);
      expect(f.pushes).not.toHaveBeenCalled();
      f.mayLeave.mockReturnValue(true);
      f.go(direction);
      f.flush();
      expect(f.apply).toHaveBeenCalledOnce();
      expect(f.mayLeave).toHaveBeenCalledTimes(2);
      expect(f.accepted.index.current).toBe(1 + direction);
      f.go(-direction);
      f.flush();
      expect(f.editor.route).toBe('challenges');
      expect(f.entries).toHaveLength(3);
    },
  );

  it.each([-1, 1])(
    'protects the App view ref for distinct same-URL entry %i but not a true no-op',
    (direction) => {
      const f = historyFixture('challenges', ['challenges', 'challenges', 'challenges']);
      const state = structuredClone(f.editor);
      f.mayLeave.mockImplementation(() => {
        expect(window.location.href).toBe(f.accepted.location.current);
        expect(window.history.state.asaRouteIndex).toBe(1);
        expect(f.apply).not.toHaveBeenCalled();
        return false;
      });
      f.sync();
      expect(f.mayLeave).not.toHaveBeenCalled();
      f.go(direction);
      f.flush();
      expect(f.mayLeave).toHaveBeenCalledOnce();
      expect(f.accepted.index.current).toBe(1);
      expect(window.history.state.asaRouteIndex).toBe(1);
      expect(f.editor).toEqual(state);
      expect(f.apply).not.toHaveBeenCalled();
      expect(f.pushes).not.toHaveBeenCalled();
      expect(settings.requests).toBe(0);
      f.mayLeave.mockReturnValue(true);
      f.go(direction);
      f.flush();
      expect(f.accepted.index.current).toBe(1 + direction);
      expect(f.apply).toHaveBeenCalledOnce();
      expect(f.mayLeave).toHaveBeenCalledTimes(2);
      expect(f.editor).toEqual(state);
      expect(f.entries).toHaveLength(3);
      expect(f.pushes).not.toHaveBeenCalled();
      f.sync();
      expect(f.mayLeave).toHaveBeenCalledTimes(2);
    },
  );

  it('restores Settings before its dialog, retains the first destination through repeated Back/Forward, and preserves Forward after Stay', () => {
    const f = historyFixture('account');
    settings.dirty = true;
    const acceptedUrl = f.accepted.location.current;
    f.go(-1);
    f.flush();
    expect(settings.observedUrl).toBe(acceptedUrl);
    expect(window.location.href).toBe(acceptedUrl);
    expect(f.apply).not.toHaveBeenCalled();
    f.go(-1);
    f.flush();
    f.go(1);
    f.flush();
    expect(settings.requests).toBe(1);
    expect(window.location.href).toBe(acceptedUrl);
    settings.pending = null;
    f.go(-1);
    f.flush();
    expect(settings.requests).toBe(2);
    const proceed = settings.pending!;
    settings.pending = null;
    settings.dirty = false;
    proceed();
    f.flush();
    expect(f.editor.route).toBe('help');
    expect(f.apply).toHaveBeenCalledOnce();
    f.go(1);
    f.flush();
    expect(f.editor.route).toBe('account');
    expect(f.pushes).not.toHaveBeenCalled();
    expect(f.entries).toHaveLength(3);
  });
});
